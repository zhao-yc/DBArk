import { randomUUID } from 'node:crypto';
import { matchesPostgresColumnPlan, postgresColumnPlan, type PostgresColumnApplyInput, type PostgresColumnPreviewInput } from '../../shared/postgresColumnEdit';
import type { PostgresCreateTableOutcome, PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import { startPostgresDdl, validatePostgresDefaults } from './createTable';
import { readPostgresStructureFacts } from './relationStructure';
import type { PostgresConnection } from './connection';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Plan = ReturnType<typeof postgresColumnPlan>;
const budget = () => ({ rows: 1, bytes: 8192 });
interface Prepared {
  input: Scoped<PostgresColumnPreviewInput>;
  plan: Plan;
  token: string;
  expires: number;
}

/** 结构改动使用独立事务，预览和提交绑定真实文档及同一关系。 */
export class PostgresColumnWorkspace {
  private readonly plans = new Map<string, Prepared>();
  private readonly pending = new Set<string>();

  /** 同窗口、同表只保留一个预览。 */
  private key(input: Scoped<PostgresStructureInput>) {
    return JSON.stringify([input.owner, input.connectionId, input.database, input.table]);
  }

  /** 读取原表并校验默认值，预览阶段不发送 DDL。 */
  async preview(input: Scoped<PostgresColumnPreviewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const key = this.key(input);
    if (this.pending.has(key)) throw Error('目标已有字段操作');
    this.pending.add(key);
    this.plans.delete(key);
    try {
      const { owner, connectionRevision, connectionId, database, table, editStamp, changes } = input;
      const draft = { connectionId, database, table, editStamp, changes };
      const plan = await connect(async connection => {
        if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
        await startPostgresDdl(connection, true);
        const { output } = await readPostgresStructureFacts(connection, input.table);
        const plan = postgresColumnPlan(output, draft);
        await validatePostgresDefaults(connection, plan.checks);
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT') throw Error('原表预览读取未完成');
        return plan;
      });
      const now = Date.now();
      for (const [key, entry] of this.plans) if (entry.expires <= now) this.plans.delete(key);
      if (this.plans.size >= 128) throw Error('PostgreSQL 字段预览已满');
      const token = randomUUID();
      this.plans.set(key, { input: { ...draft, owner, connectionRevision }, plan, token, expires: now + 300_000 });
      return { token, statements: plan.statements };
    } finally { this.pending.delete(key); }
  }

  /** 在首次等待之前消费能力，原事务终态优先于物理连接收尾。 */
  async apply(input: Scoped<PostgresColumnApplyInput>, connect: Connect): Promise<PostgresCreateTableOutcome> {
    const key = this.key(input), prepared = this.plans.get(key);
    if (this.pending.has(key) || !prepared || prepared.token !== input.token || prepared.expires <= Date.now() ||
        prepared.input.connectionRevision !== input.connectionRevision)
      return { outcome: 'notSent', message: 'PostgreSQL 字段预览已失效，请重新预览' };
    this.plans.delete(key);
    this.pending.add(key);
    let receipt: PostgresCreateTableOutcome | undefined;
    try {
      await connect(async connection => { receipt = await this.execute(connection, prepared); }, true);
      return receipt!;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      return receipt ? { ...receipt, message: receipt.message + '；连接收尾异常：' + message } : { outcome: 'notSent', message };
    } finally { this.pending.delete(key); }
  }

  /** 锁定前后核对原身份，实际列顺序和原列序号核对后才提交。 */
  private async execute(connection: PostgresConnection, { input, plan }: Prepared): Promise<PostgresCreateTableOutcome> {
    let sent = false, committing = false;
    try {
      if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
      await startPostgresDdl(connection, false);
      const original = await readPostgresStructureFacts(connection, input.table);
      if (original.output.editStamp !== input.editStamp) throw Error('原表结构已变化，请重新读取');
      const lock = await connection.query('LOCK TABLE ONLY ' + plan.table + ' IN ACCESS EXCLUSIVE MODE', undefined, budget());
      if (lock.postgresCommand !== 'LOCK') throw Error('原表锁未确认');
      const locked = await readPostgresStructureFacts(connection, input.table);
      if (locked.output.editStamp !== input.editStamp || locked.oid !== original.oid) throw Error('加锁后原表结构已变化，请重新读取');
      await validatePostgresDefaults(connection, plan.checks);
      for (const sql of plan.statements) {
        sent = true;
        const result = await connection.query(sql, undefined, budget());
        if (result.postgresCommand !== (sql.startsWith('ALTER ') ? 'ALTER' : 'COMMENT')) throw Error('字段结构回执不符');
      }
      const final = await readPostgresStructureFacts(connection, input.table);
      if (final.oid !== original.oid || !matchesPostgresColumnPlan(final.output.columns, plan.columns))
        throw Error('实际字段与预览不一致');
      committing = true;
      const result = await connection.query('COMMIT', undefined, budget());
      if (result.postgresCommand === 'ROLLBACK') return { outcome: 'rolledBack', message: '服务器已回滚字段修改' };
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('字段提交未确认');
      return { outcome: 'committed', table: input.table, message: 'PostgreSQL 字段修改已确认提交' };
    } catch (reason) {
      const message = connection.error(reason).message;
      if (!sent) return { outcome: 'notSent', message };
      try {
        if (connection.state().transactionKnown && connection.state().transactionOpen &&
            (await connection.query('ROLLBACK', undefined, budget())).postgresCommand === 'ROLLBACK' &&
            connection.state().transactionKnown && !connection.state().transactionOpen) return { outcome: 'rolledBack', message };
      } catch { /* 未确认原事务终态时禁止重放。 */ }
      if (!committing && connection.state().transactionKnown && !connection.state().transactionOpen) return { outcome: 'rolledBack', message };
      return { outcome: 'unknown', message };
    }
  }

  /** 断开连接时回收其结构预览。 */
  clear(connectionId: string) {
    for (const [key, entry] of this.plans) if (entry.input.connectionId === connectionId) this.plans.delete(key);
  }

  /** 冷启动预览也参与连接关闭和客户端退出路由。 */
  connectionIds(): string[] {
    return [...new Set([...this.plans.values()].map(entry => entry.input.connectionId))];
  }
}
