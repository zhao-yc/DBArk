import { randomUUID } from 'node:crypto';
import {
  postgresCreateTablePlan, type PostgresCreateTableApply, type PostgresCreateTableInput,
  type PostgresCreateTableOutcome, type PostgresCreateTablePreview, type PostgresCreateTableTarget,
} from '../../shared/postgresCreateTable';
import type { PostgresConnection } from './connection';
import { postgresCreateViewPlan, postgresEditViewPreviewSchema, postgresViewManagePreviewSchema, postgresViewQuery,
  type PostgresCreateViewInput, type PostgresEditViewInput, type PostgresViewManageInput } from '../../shared/postgresCreateView';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import { postgresMaterializedRefreshSchema, type PostgresMaterializedRefreshInput } from '../../shared/postgresMaterializedView';
import { readPostgresMaterializedFacts } from './materializedView';
import { postgresViewOptionsSql, readPostgresViewFacts } from './viewDefinition';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type RelationKind = 'table' | 'view' | 'viewEdit' | 'viewManage' | 'materializedRefresh';
interface Plan {
  table: string;
  statements: string[];
  preflight(connection: PostgresConnection): Promise<string>;
  validate?(connection: PostgresConnection): Promise<void>;
  verify(connection: PostgresConnection, schemaOid: string): Promise<void>;
  protocol?: 'extended';
  success: string;
  guard?: { sql: string; stamp: string; parseOnly?: true };
  statementTimeout?: '120s';
  firstCommand?: 'SELECT';
}
interface Prepared {
  input: Scoped<PostgresCreateTableTarget>;
  token: string;
  expires: number;
  targetStamp: string;
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
async function preflight(connection: PostgresConnection, input: PostgresCreateTableTarget & { schema: string }, name: string,
  fields: string[], label: string): Promise<string> {
  if (connection.database !== input.database) throw Error('PostgreSQL 原数据库已变化');
  const result = await connection.query(`
    SELECT n.oid,
      EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = n.oid AND c.relname::text = $2),
      pg_catalog.current_setting('max_identifier_length')::int
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname::text = $1 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')
  `, [input.schema, name], budget());
  const schema = result.rows[0];
  if (typeof schema?.c0 !== 'string') throw Error('PostgreSQL schema 不存在或缺少建' + label + '权限');
  if (schema.c1 === 't') throw Error('目标 schema 已存在同名关系');
  const max = Number(schema.c2);
  if (!Number.isInteger(max) || [name, ...fields].some(identifier => Buffer.byteLength(identifier) > max)) {
    throw Error(label + '名或字段名超过目标服务器标识符长度');
  }
  return schema.c0;
}

/** 同 schema 的操作仅锁原视图，避免 LOCK TABLE 递归锁底层关系。 */
function viewGuard(schema: string, name: string, table: string, stamp: string): Pick<Plan, 'guard' | 'preflight' | 'protocol'> {
  return {
    guard: { sql: 'ALTER VIEW ' + table + ' SET SCHEMA ' + postgresIdentifier(schema), stamp },
    preflight: async connection => (await readPostgresViewFacts(connection, schema, name)).stamp,
    protocol: 'extended',
  };
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

/** 原文档、目标数据库、关系类别及连接修订共同约束一次性创建预览。 */
export class PostgresCreateTableWorkspace {
  private readonly plans = new Map<string, Prepared>();
  private readonly pending = new Set<string>();

  /** 同文档与目标库只保留最新预览，避免关闭弹窗后积累能力。 */
  private key(input: Scoped<PostgresCreateTableTarget>, kind: RelationKind): string {
    return JSON.stringify([input.owner, input.connectionId, input.database, kind]);
  }

  /** 预览只进行目录和内置类型校验，返回与实际执行相同的 SQL。 */
  async prepare(input: Scoped<PostgresCreateTableInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'table', connect, () => {
      const draft = { connectionId: input.connectionId, database: input.database, schema: input.schema,
        table: input.table, columns: input.columns, comment: input.comment };
      const plan = postgresCreateTablePlan(draft);
      return { ...plan, success: 'PostgreSQL 新表已确认创建',
        preflight: connection => preflight(connection, draft, draft.table, draft.columns.map(column => column.name), '表'),
        validate: connection => validatePostgresDefaults(connection, plan.checks.map(check => ({
          ...check, length: draft.columns.find(column => column.name === check.name)?.length,
        }))),
        verify: (connection, oid) => verify(connection, draft, oid),
      };
    });
  }

  /** 预览仅读取目标目录；视图定义由服务器在确认后的扩展协议 DDL 中校验。 */
  async prepareView(input: Scoped<PostgresCreateViewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'view', connect, () => {
      const { connectionId, database, schema, view, definition, comment, materialized } = input;
      const draft = { connectionId, database, schema, view, definition, comment, materialized };
      const plan = postgresCreateViewPlan(draft);
      const label = materialized ? '物化视图' : '视图';
      return { ...plan, success: 'PostgreSQL 新' + label + '已确认创建', protocol: 'extended',
        // 立即填充的原生命令回执为 SELECT 行数，仍须回读新建对象后才能提交。
        ...(materialized?.populate ? { statementTimeout: '120s' as const, firstCommand: 'SELECT' as const } : {}),
        preflight: connection => preflight(connection, draft, view, [], label),
        async verify(connection, oid) {
          const result = await connection.query(`
            SELECT pg_catalog.obj_description(c.oid, 'pg_class'), c.relispopulated
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.oid = $1::oid AND n.nspname::text = $2 AND c.relname::text = $3
              AND c.relkind = $4::pg_catalog."char" AND c.relpersistence = 'p'
          `, [oid, schema, view, materialized ? 'm' : 'v'], budget());
          const row = result.rows[0];
          if (result.truncated || result.rows.length !== 1 || row.c0 !== (comment || null) ||
              materialized && row.c1 !== (materialized.populate ? 't' : 'f'))
            throw Error('新视图的实际 schema、类别、注释或填充状态与预览不同，未提交');
        },
      };
    });
  }

  /** 将定义和原选项编成同一预览，提交前锁住原视图并再次核对目录。 */
  async prepareViewEdit(input: Scoped<PostgresEditViewInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'viewEdit', connect, () => {
      const { connectionId, database, table, definition, stamp } = input;
      const draft = postgresEditViewPreviewSchema.parse({ connectionId, database, table, definition, stamp });
      const { schema, name } = postgresRelationName(draft.table);
      const qualified = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
      const query = postgresViewQuery(draft.definition);
      return async connection => {
        const original = await readPostgresViewFacts(connection, schema, name);
        if (original.stamp !== draft.stamp) throw Error('原视图已变化，请刷新结构后编辑');
        return {
          ...viewGuard(schema, name, qualified, original.stamp),
          table: qualified, success: 'PostgreSQL 视图定义已确认更新',
          statements: ['CREATE OR REPLACE VIEW ' + qualified + postgresViewOptionsSql(original.options) + ' AS\n' + query],
          async verify(current) {
            const actual = await readPostgresViewFacts(current, schema, name);
            if (actual.preserved !== original.preserved) throw Error('视图身份、所有者、授权、注释或选项已变化，未提交');
          },
        };
      };
    });
  }

  /** 重命名与受限删除绑定原视图身份，并在提交前复核实际目录。 */
  async prepareViewManage(input: Scoped<PostgresViewManageInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'viewManage', connect, () => {
      const { connectionId, database, table, stamp, action } = input;
      const target = { connectionId, database, table, stamp, action };
      const draft = postgresViewManagePreviewSchema.parse(input.action === 'rename' ? { ...target, name: input.name } : target);
      const { schema, name } = postgresRelationName(draft.table);
      const prefix = postgresIdentifier(schema) + '.';
      const qualified = prefix + postgresIdentifier(name);
      return async connection => {
        const original = await readPostgresViewFacts(connection, schema, name);
        if (original.stamp !== draft.stamp) throw Error('原视图已变化，请刷新结构后继续');
        const guard = viewGuard(schema, name, qualified, original.stamp);
        if (draft.action === 'rename') {
          if (draft.name === name) throw Error('请输入不同的视图名称');
          await preflight(connection, { connectionId, database, schema }, draft.name, [], '视图');
          const identifier = postgresIdentifier(draft.name);
          return {
            ...guard, table: prefix + identifier, success: 'PostgreSQL 视图已确认重命名',
            statements: ['ALTER VIEW ' + qualified + ' RENAME TO ' + identifier],
            async verify(current) {
              const actual = await readPostgresViewFacts(current, schema, draft.name);
              if (actual.preserved !== original.preserved || actual.revision !== original.revision)
                throw Error('重命名后的视图身份、定义或属性与原视图不同，未提交');
            },
          };
        }
        return {
          ...guard, table: qualified, success: 'PostgreSQL 视图已确认删除',
          statements: ['DROP VIEW ' + qualified + ' RESTRICT'],
          async verify(current) {
            const result = await current.query(`SELECT EXISTS (
              SELECT FROM pg_catalog.pg_class c
              WHERE c.oid = $1::oid OR (c.relnamespace = $2::oid AND c.relname::text = $3)
            )`, [original.oid, original.namespace, name], budget());
            if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f')
              throw Error('未确认原视图已从目录删除');
          },
        };
      };
    });
  }

  /** 用仅解析的语句固定物化视图关系，确认后交给 PostgreSQL 的原生刷新。 */
  async prepareMaterializedRefresh(input: Scoped<PostgresMaterializedRefreshInput>, connect: Connect): Promise<PostgresCreateTablePreview> {
    return this.prepareRelation(input, 'materializedRefresh', connect, () => {
      const { connectionId, database, table, stamp, mode } = input;
      const draft = postgresMaterializedRefreshSchema.parse({ connectionId, database, table, stamp, mode });
      const { schema, name } = postgresRelationName(draft.table);
      const qualified = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
      return async connection => {
        const original = await readPostgresMaterializedFacts(connection, schema, name);
        if (!original.state.stamp || original.state.stamp !== draft.stamp)
          throw Error('物化视图或刷新权限已变化，请刷新结构后继续');
        if (mode === 'concurrent' && !(original.state.populated && original.state.uniqueIndex))
          throw Error('并发刷新要求已填充数据并具有有效的全行唯一列索引');
        const populate = mode !== 'empty';
        return {
          table: qualified, protocol: 'extended', statementTimeout: '120s',
          success: populate ? 'PostgreSQL 物化视图已确认刷新' : 'PostgreSQL 物化视图已确认清除填充数据',
          // 只发送 Parse / Sync，保留关系共享锁，无需 SELECT 权限，也不执行查询。
          guard: { sql: 'SELECT 1 FROM ONLY ' + qualified + ' WHERE FALSE', stamp: original.state.stamp, parseOnly: true },
          statements: ['REFRESH MATERIALIZED VIEW ' + (mode === 'concurrent' ? 'CONCURRENTLY ' : '') +
            qualified + (populate ? ' WITH DATA' : ' WITH NO DATA')],
          preflight: async current => (await readPostgresMaterializedFacts(current, schema, name)).state.stamp ?? '',
          async verify(current) {
            const actual = await readPostgresMaterializedFacts(current, schema, name);
            if (actual.identity !== original.identity || actual.state.populated !== populate)
              throw Error('未确认原物化视图身份或填充状态');
          },
        };
      };
    });
  }

  /** 关系创建及视图维护共用预检、令牌、预算和事务回执。 */
  private async prepareRelation(input: Scoped<PostgresCreateTableTarget>, kind: RelationKind, connect: Connect, compile: () => Plan | ((connection: PostgresConnection) => Promise<Plan>)) {
    const key = this.key(input, kind);
    if (this.pending.has(key)) throw Error('目标已有关系创建操作');
    this.pending.add(key);
    this.plans.delete(key);
    try {
      const { owner, connectionRevision, connectionId, database } = input;
      const compiled = compile();
      const { plan, targetStamp } = await connect(async connection => {
        await startPostgresDdl(connection, true);
        const plan = typeof compiled === 'function' ? await compiled(connection) : compiled;
        const targetStamp = plan.guard?.stamp ?? await plan.preflight(connection);
        await plan.validate?.(connection);
        if ((await connection.query('COMMIT', undefined, budget())).postgresCommand !== 'COMMIT') throw Error('预览读取未完成');
        return { plan, targetStamp };
      });
      const now = Date.now();
      for (const [id, old] of this.plans) if (old.expires <= now) this.plans.delete(id);
      if (this.plans.size >= 128) throw Error('PostgreSQL 关系创建预览已满，请稍后重试');
      const token = randomUUID();
      this.plans.set(key, { input: { connectionId, database, owner, connectionRevision }, token, targetStamp, plan, expires: now + 300_000 });
      return { token, statements: plan.guard && !plan.guard.parseOnly ? [plan.guard.sql, ...plan.statements] : plan.statements };
    } finally { this.pending.delete(key); }
  }

  /** 只消费一次原预览，真实提交结果优先于后续连接关闭。 */
  async apply(input: Scoped<PostgresCreateTableApply>, connect: Connect, kind: RelationKind = 'table'): Promise<PostgresCreateTableOutcome> {
    const key = this.key(input, kind), prepared = this.plans.get(key);
    if (this.pending.has(key)) throw Error('目标已有关系创建操作');
    if (!prepared || prepared.token !== input.token || prepared.expires <= Date.now() ||
        input.connectionRevision !== prepared.input.connectionRevision) throw Error('PostgreSQL 创建预览已失效，请重新预览');
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
    let sent = false, committing = false;
    try {
      await startPostgresDdl(connection, false);
      const { plan, targetStamp } = prepared;
      if (plan.guard) {
        await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED', undefined, budget());
        // 先取目标锁，再读取会取得共享锁的反编译定义，避免并发替换时先阻塞在读路径。
        if (plan.guard.parseOnly) {
          await connection.query(plan.guard.sql, undefined, budget(), undefined, 'parse');
        } else {
          sent = true;
          if ((await connection.query(plan.guard.sql, undefined, budget(), undefined, 'extended')).postgresCommand !== 'ALTER')
            throw Error('服务器未确认锁定原视图');
        }
      }
      if (await plan.preflight(connection) !== targetStamp)
        throw Error(plan.guard ? '原视图已变化，请刷新结构后继续' : '原 schema 已被替换，请重新预览');
      if (plan.statementTimeout) await connection.query(
        "SELECT pg_catalog.set_config('statement_timeout', $1, true)", [plan.statementTimeout], budget());
      for (const [index, statement] of plan.statements.entries()) {
        sent = true;
        const result = await connection.query(statement, undefined, budget(), undefined, prepared.plan.protocol);
        const command = index === 0 && plan.firstCommand || statement.slice(0, statement.indexOf(' '));
        if (result.postgresCommand !== command) {
          throw Error('PostgreSQL 未返回预期的结构回执');
        }
      }
      await prepared.plan.verify(connection, prepared.targetStamp);
      committing = true;
      const result = await connection.query('COMMIT', undefined, budget());
      if (result.postgresCommand === 'ROLLBACK') return { outcome: 'rolledBack', message: '服务器已回滚结构操作' };
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) {
        throw Error('PostgreSQL 结构提交未确认');
      }
      return { outcome: 'committed', table: prepared.plan.table, message: prepared.plan.success };
    } catch (reason) {
      const message = connection.error(reason).message;
      if (!sent) return { outcome: 'notSent', message };
      if (!connection.state().transactionKnown) return { outcome: 'unknown', message };
      try {
        if (connection.state().transactionOpen) {
          const rollback = await connection.query('ROLLBACK', undefined, budget());
          if (rollback.postgresCommand === 'ROLLBACK' && connection.state().transactionKnown && !connection.state().transactionOpen)
            return { outcome: 'rolledBack', message };
        }
        if (!committing && connection.state().transactionKnown && !connection.state().transactionOpen) return { outcome: 'rolledBack', message };
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
