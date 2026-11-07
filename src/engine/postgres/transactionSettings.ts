import type { PostgresConnection } from './connection';
import { postgresTransactionDefaultsSchema, postgresTransactionDefaultsSql, postgresTransactionSnapshotSchema,
  type PostgresTransactionDefaults, type PostgresTransactionSnapshot } from '../../shared/postgresTransactionSettings';

/** 只用固定 SHOW 读取默认值，不执行 SELECT 或更改原查询事务。失败事务先由用户回滚。 */
export async function readPostgresTransactionSettings(connection: PostgresConnection, check: () => void): Promise<PostgresTransactionSnapshot> {
  const original = connection.state();
  check();
  if (connection.broken || original.broken || !original.transactionKnown || original.transactionFailed) throw Error('原会话状态未知或事务已失败，请先明确处理事务');
  const identity = {processId: connection.processId, backendStart: connection.backendStart, database: connection.database};
  const values: string[] = [];
  for (const name of ['default_transaction_isolation', 'default_transaction_read_only', 'default_transaction_deferrable']) {
    check();
    const result = await connection.query('SHOW ' + name, undefined, {rows: 2, bytes: 1024});
    check();
    if (result.postgresCommand !== 'SHOW' || result.truncated || result.columns.length !== 1 || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
      throw Error('PostgreSQL 未返回完整的事务默认设置');
    values.push(result.rows[0].c0);
  }
  const state = connection.state();
  if (connection.broken || state.broken || !state.transactionKnown || state.transactionFailed || state.transactionOpen !== original.transactionOpen ||
      connection.processId !== identity.processId || connection.backendStart !== identity.backendStart || connection.database !== identity.database)
    throw Error('读取期间原物理会话或事务状态已变化');
  const isolation = {'read uncommitted': 'READ UNCOMMITTED', 'read committed': 'READ COMMITTED', 'repeatable read': 'REPEATABLE READ', serializable: 'SERIALIZABLE'} as const;
  const boolean = (value: string) => { if (value === 'on') return true; if (value === 'off') return false; throw Error('PostgreSQL 返回未知事务布尔值'); };
  if (!Object.hasOwn(isolation, values[0])) throw Error('PostgreSQL 返回未知隔离级别');
  return postgresTransactionSnapshotSchema.parse({...identity, isolation: isolation[values[0] as keyof typeof isolation],
    readOnly: boolean(values[1]), deferrable: boolean(values[2]), transactionOpen: state.transactionOpen, transactionFailed: state.transactionFailed});
}

/** SET 前只读复核旧值及物理身份；SET 后失败不重发，不自动回滚或假称未改变。 */
export async function applyPostgresTransactionSettings(connection: PostgresConnection, expected: PostgresTransactionSnapshot,
  defaults: PostgresTransactionDefaults, check: () => void): Promise<PostgresTransactionSnapshot> {
  const before = postgresTransactionSnapshotSchema.parse(expected), next = postgresTransactionDefaultsSchema.parse(defaults);
  const actual = await readPostgresTransactionSettings(connection, check);
  if (actual.transactionOpen || before.transactionOpen) throw Error('请先明确提交或回滚原事务，再重新读取后修改默认值');
  if (Object.keys(actual).some(key => actual[key as keyof typeof actual] !== before[key as keyof typeof before])) throw Error('原会话事务默认值或物理身份已变化，请重新读取');
  check();
  try {
    const result = await connection.query(postgresTransactionDefaultsSql(next), undefined, {rows: 0, bytes: 1024});
    if (result.postgresCommand !== 'SET') throw Error('PostgreSQL 未确认 SET');
    const verified = await readPostgresTransactionSettings(connection, check);
    if (verified.processId !== before.processId || verified.backendStart !== before.backendStart || verified.database !== before.database || verified.transactionOpen ||
        verified.isolation !== next.isolation || verified.readOnly !== next.readOnly || verified.deferrable !== next.deferrable)
      throw Error('事务默认值读回不一致');
    return verified;
  } catch (reason) {
    throw Error('设置可能已改变，请显式重新读取核对；未重发设置。' + connection.error(reason).message);
  }
}
