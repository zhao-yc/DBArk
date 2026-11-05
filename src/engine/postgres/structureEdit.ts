import { randomUUID } from 'node:crypto';
import type { PostgresCreateTableOutcome, PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import { startPostgresDdl, validatePostgresDefaults } from './createTable';
import { readPostgresStructureFacts } from './relationStructure';
import type { PostgresConnection } from './connection';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Facts = Awaited<ReturnType<typeof readPostgresStructureFacts>>;
type Draft = PostgresStructureInput & { editStamp: string };
interface Plan {
  table: string;
  statements: string[];
  checks?: Parameters<typeof validatePostgresDefaults>[1];
  protocol?: 'extended';
  materializedGuard?: string;
  before?(connection: PostgresConnection): Promise<void>;
  verify(facts: Facts): boolean;
}
const budget = () => ({ rows: 1, bytes: 8192 });
interface Prepared {
  input: Scoped<Draft>;
  plan: Plan;
  token: string;
  expires: number;
}

/** 结构改动使用独立事务，预览和提交绑定真实文档及同一关系。 */
export class PostgresStructureEditWorkspace<T extends Draft> {
  private readonly plans = new Map<string, Prepared>();
  private readonly pending = new Set<string>();

  constructor(private readonly label: string, private readonly compile: (facts: Facts, draft: T, connection: PostgresConnection) => Plan | Promise<Plan>) {}

  /** 同窗口、同表只保留一个预览。 */
  private key(input: Scoped<PostgresStructureInput>) {
    return JSON.stringify([input.owner, input.connectionId, input.database, input.table]);
  }

  /** 读取原表并校验默认值，预览阶段不发送 DDL。 */
  async preview(input: Scoped<T>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const key = this.key(input);
    if (this.pending.has(key)) throw Error('目标已有' + this.label + '操作');
    this.pending.add(key);
    this.plans.delete(key);
    try {
      const { owner, connectionRevision, connectionId, database, table, editStamp } = input;
      const plan = await connect(async connection => {
        if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
        await startPostgresDdl(connection, true);
        const plan = await this.compile(await readPostgresStructureFacts(connection, input.table), input, connection);
        if (plan.checks) await validatePostgresDefaults(connection, plan.checks);
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT') throw Error('原表预览读取未完成');
        return plan;
      });
      const now = Date.now();
      for (const [key, entry] of this.plans) if (entry.expires <= now) this.plans.delete(key);
      if (this.plans.size >= 128) throw Error('PostgreSQL ' + this.label + '预览已满');
      const token = randomUUID();
      this.plans.set(key, { input: { connectionId, database, table, editStamp, owner, connectionRevision }, plan, token, expires: now + 300_000 });
      return { token, statements: plan.materializedGuard ? [plan.materializedGuard, ...plan.statements] : plan.statements };
    } finally { this.pending.delete(key); }
  }

  /** 在首次等待之前消费能力，原事务终态优先于物理连接收尾。 */
  async apply(input: Scoped<PostgresStructureInput & { token: string }>, connect: Connect): Promise<PostgresCreateTableOutcome> {
    const key = this.key(input), prepared = this.plans.get(key);
    if (this.pending.has(key) || !prepared || prepared.token !== input.token || prepared.expires <= Date.now() ||
        prepared.input.connectionRevision !== input.connectionRevision)
      return { outcome: 'notSent', message: 'PostgreSQL ' + this.label + '预览已失效，请重新预览' };
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

  /** 锁定前后核对原表身份，由各设计器校验同一事务中的真实结果。 */
  private async execute(connection: PostgresConnection, { input, plan }: Prepared): Promise<PostgresCreateTableOutcome> {
    let sent = false, committing = false;
    try {
      if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
      await startPostgresDdl(connection, false);
      if (plan.materializedGuard) {
        await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
        // LOCK TABLE 不支持物化视图；先持有原对象锁，再读取最新的目录快照。
        sent = true;
        const lock = await connection.query(plan.materializedGuard, undefined, budget(), undefined, 'extended');
        if (lock.postgresCommand !== 'ALTER') throw Error('原物化视图锁未确认');
      }
      const original = await readPostgresStructureFacts(connection, input.table);
      if (plan.materializedGuard) {
        if (original.output.kind !== 'm' || original.output.indexEditStamp !== input.editStamp)
          throw Error('原物化视图或索引结构已变化，请重新读取');
        await connection.query("SET LOCAL statement_timeout = '120s'", undefined, budget());
      } else {
        if (original.output.editStamp !== input.editStamp) throw Error('原表结构已变化，请重新读取');
        const lock = await connection.query('LOCK TABLE ONLY ' + plan.table + ' IN ACCESS EXCLUSIVE MODE', undefined, budget());
        if (lock.postgresCommand !== 'LOCK') throw Error('原表锁未确认');
        const locked = await readPostgresStructureFacts(connection, input.table);
        if (locked.output.editStamp !== input.editStamp || locked.oid !== original.oid) throw Error('加锁后原表结构已变化，请重新读取');
      }
      if (plan.checks) await validatePostgresDefaults(connection, plan.checks);
      await plan.before?.(connection);
      for (const sql of plan.statements) {
        sent = true;
        const result = await connection.query(sql, undefined, budget(), undefined, plan.protocol);
        if (result.postgresCommand !== sql.split(' ', 1)[0]) throw Error(this.label + '结构回执不符');
      }
      const final = await readPostgresStructureFacts(connection, input.table);
      if (final.oid !== original.oid || final.output.kind !== original.output.kind || !plan.verify(final))
        throw Error('实际' + this.label + '与预览不一致');
      committing = true;
      const result = await connection.query('COMMIT', undefined, budget());
      if (result.postgresCommand === 'ROLLBACK') return { outcome: 'rolledBack', message: '服务器已回滚' + this.label + '修改' };
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error(this.label + '提交未确认');
      return { outcome: 'committed', table: input.table, message: 'PostgreSQL ' + this.label + '修改已确认提交' };
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
