import { randomUUID } from 'node:crypto';
import {
  postgresCreateTablePlan, type PostgresCreateTableApply, type PostgresCreateTableInput,
  type PostgresCreateTableOutcome, type PostgresCreateTablePreview, type PostgresCreateTableTarget,
} from '../../shared/postgresCreateTable';
import type { PostgresConnection } from './connection';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Plan = ReturnType<typeof postgresCreateTablePlan>;
interface Prepared {
  input: Scoped<PostgresCreateTableInput>;
  token: string;
  expires: number;
  schemaOid: string;
  plan: Plan;
}

const budget = () => ({ rows: 2, bytes: 16 * 1024 });

/** 读取当前身份可建表的普通 schema，并保持实际搜索路径优先。 */
export async function postgresCreateSchemas(connection: PostgresConnection): Promise<string[]> {
  const result = await connection.query(`
    SELECT nspname FROM pg_catalog.pg_namespace
    WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(oid, 'USAGE')
      AND pg_catalog.has_schema_privilege(oid, 'CREATE')
    ORDER BY pg_catalog.array_position(pg_catalog.current_schemas(false), nspname) NULLS LAST, nspname
    LIMIT 1001
  `, undefined, { rows: 1001, bytes: 256 * 1024 });
  if (result.truncated || result.rows.length > 1000 || result.rows.some(row => typeof row.c0 !== 'string')) {
    throw Error('PostgreSQL 可建表 schema 超过预算或回包不完整');
  }
  return result.rows.map(row => String(row.c0));
}

/** 设置本次事务边界，只有内置类型能参与默认值校验与建表。 */
export async function startPostgresDdl(connection: PostgresConnection, readOnly: boolean): Promise<void> {
  await connection.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN', undefined, budget());
  for (const sql of [
    'SET LOCAL search_path = pg_catalog', 'SET LOCAL standard_conforming_strings = on', "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '20s'",
  ]) await connection.query(sql, undefined, budget());
}

/** 通过服务器真实目录验证 schema、权限及名称，保留 OID 识别同名替换。 */
async function preflight(connection: PostgresConnection, input: PostgresCreateTableInput): Promise<string> {
  if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
  const result = await connection.query(`
    SELECT n.oid,
      EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = n.oid AND c.relname::text = $2),
      pg_catalog.current_setting('max_identifier_length')::int
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname::text = $1 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')
  `, [input.schema, input.table], budget());
  const schema = result.rows[0];
  if (typeof schema?.c0 !== 'string') throw Error('PostgreSQL schema 不存在或缺少建表权限');
  if (schema.c1 === 't') throw Error('目标 schema 已存在同名关系');
  const max = Number(schema.c2);
  if (!Number.isInteger(max) || [input.table, ...input.columns.map(field => field.name)].some(name => Buffer.byteLength(name) > max)) {
    throw Error('表名或字段名超过目标服务器标识符长度');
  }
  return schema.c0;
}

/** 校验服务器真实类型转换，同时拒绝 varchar 显式转换可能造成的默认文字截断。 */
export async function validatePostgresDefaults(connection: PostgresConnection, checks: { type: string; value: string; length?: number }[]): Promise<void> {
  if (!checks.length) return;
  const values = checks.map(field => field.value);
  const expressions = checks.map((field, index) => {
    const arg = '$' + (index + 1), length = field.length;
    const cast = '((' + arg + '::text)::' + field.type + ' IS NOT NULL)';
    return length === undefined ? cast : '(' + cast + ' AND pg_catalog.char_length(' + arg + '::text) <= ' + length + ')';
  });
  const result = await connection.query('SELECT ' + expressions.join(', '), values, budget());
  if (!result.rows[0] || Object.values(result.rows[0]).some(value => value !== 't')) throw Error('默认值与字段类型或长度不符');
}

/** 在同一事务核对实际 schema 和字段顺序，禁止标识符截断或目标替换后仍提交。 */
async function verify(connection: PostgresConnection, input: PostgresCreateTableInput, schemaOid: string): Promise<void> {
  const result = await connection.query(`
    SELECT a.attname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.oid = $1::oid AND n.nspname::text = $2 AND c.relname::text = $3 AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
  `, [schemaOid, input.schema, input.table], { rows: input.columns.length + 1, bytes: 128 * 1024 });
  if (result.truncated || result.rows.length !== input.columns.length ||
      result.rows.some((row, i) => row.c0 !== input.columns[i].name)) {
    throw Error('新表的实际 schema 或字段与预览不同，未提交');
  }
}

/** 原文档、目标数据库及连接修订共同约束一次性建表预览。 */
export class PostgresCreateTableWorkspace {
  private readonly plans = new Map<string, Prepared>();
  private readonly pending = new Set<string>();

  /** 同文档与目标库只保留最新预览，避免关闭弹窗后积累能力。 */
  private key(input: Scoped<PostgresCreateTableTarget>): string {
    return JSON.stringify([input.owner, input.connectionId, input.database]);
  }

  /** 预览只进行目录和内置类型校验，返回与实际执行相同的 SQL。 */
  async prepare(input: Scoped<PostgresCreateTableInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    const key = this.key(input);
    if (this.pending.has(key)) throw Error('目标已有建表操作');
    this.pending.add(key);
    this.plans.delete(key);
    try {
      const { owner, connectionRevision, connectionId, database, schema, table, columns, comment } = input;
      const draft = { connectionId, database, schema, table, columns, comment };
      const plan = postgresCreateTablePlan(draft);
      const schemaOid = await connect(async connection => {
        await startPostgresDdl(connection, true);
        const oid = await preflight(connection, draft);
        await validatePostgresDefaults(connection, plan.checks.map(check => ({
          ...check, length: draft.columns.find(column => column.name === check.name)?.length,
        })));
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT') throw Error('预览读取未完成');
        return oid;
      });
      const now = Date.now();
      for (const [id, old] of this.plans) if (old.expires <= now) this.plans.delete(id);
      if (this.plans.size >= 128) throw Error('PostgreSQL 建表预览已满，请稍后重试');
      const token = randomUUID();
      this.plans.set(key, { input: { ...draft, owner, connectionRevision }, token, schemaOid, plan, expires: now + 300_000 });
      return { token, statements: plan.statements };
    } finally { this.pending.delete(key); }
  }

  /** 只消费一次原预览，真实提交结果优先于后续连接关闭。 */
  async apply(input: Scoped<PostgresCreateTableApply>, connect: Connect): Promise<PostgresCreateTableOutcome> {
    const key = this.key(input), prepared = this.plans.get(key);
    if (this.pending.has(key)) throw Error('目标已有建表操作');
    if (!prepared || prepared.token !== input.token || prepared.expires <= Date.now() ||
        input.connectionRevision !== prepared.input.connectionRevision) throw Error('PostgreSQL 建表预览已失效，请重新预览');
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

  /** 创建、注释和核对属于同一事务，断线且终态无法确认时保留未知。 */
  private async execute(connection: PostgresConnection, prepared: Prepared): Promise<PostgresCreateTableOutcome> {
    let sent = false;
    try {
      await startPostgresDdl(connection, false);
      if (await preflight(connection, prepared.input) !== prepared.schemaOid) throw Error('原 schema 已被替换，请重新预览');
      for (const statement of prepared.plan.statements) {
        sent = true;
        const result = await connection.query(statement, undefined, budget());
        if (result.postgresCommand !== (statement.startsWith('CREATE ') ? 'CREATE' : 'COMMENT')) {
          throw Error('PostgreSQL 未返回预期的结构回执');
        }
      }
      await verify(connection, prepared.input, prepared.schemaOid);
      const result = await connection.query('COMMIT', undefined, budget());
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) {
        throw Error('PostgreSQL 建表提交未确认');
      }
      return { outcome: 'committed', table: prepared.plan.table, message: 'PostgreSQL 新表已确认创建' };
    } catch (reason) {
      const message = connection.error(reason).message;
      if (!sent) return { outcome: 'notSent', message };
      if (!connection.state().transactionKnown) return { outcome: 'unknown', message };
      try {
        if (connection.state().transactionOpen) {
          const rollback = await connection.query('ROLLBACK', undefined, budget());
          if (rollback.postgresCommand !== 'ROLLBACK') throw Error('未确认回滚');
        }
        if (connection.state().transactionKnown && !connection.state().transactionOpen) return { outcome: 'rolledBack', message };
      } catch { /* 连接异常由原回执保留，禁止重放。 */ }
      return { outcome: 'unknown', message };
    }
  }

  /** 原连接断开或换目标后不再允许消费已签发预览。 */
  clear(connectionId: string): void {
    for (const [id, value] of this.plans) if (value.input.connectionId === connectionId) this.plans.delete(id);
  }

  /** 冷打开的建表预览也要参与连接关闭路由。 */
  connectionIds(): string[] {
    return [...new Set([...this.plans.values()].map(value => value.input.connectionId))];
  }
}
