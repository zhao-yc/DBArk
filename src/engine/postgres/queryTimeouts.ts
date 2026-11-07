import type { PostgresConnection } from './connection';
import { postgresQueryTimeoutChange, postgresQueryTimeoutSnapshot,
  type PostgresQueryTimeoutChange, type PostgresQueryTimeoutSnapshot } from '../../shared/postgresQueryTimeouts';

const readSql = `SELECT name, setting, reset_val, unit FROM pg_catalog.pg_settings
  WHERE name OPERATOR(pg_catalog.=) 'statement_timeout' OR name OPERATOR(pg_catalog.=) 'lock_timeout'`;
// 同一条语句应用两项 GUC。第二项报错时由 PostgreSQL 回滚这条语句的设置。
const applySql = `SELECT pg_catalog.set_config('statement_timeout', $1::pg_catalog.text, false),
  pg_catalog.set_config('lock_timeout', $2::pg_catalog.text, false)`;
const budget = () => ({rows: 2, bytes: 4096});
const identity = (connection: PostgresConnection) => ({
  processId: connection.processId, backendStart: connection.backendStart, database: connection.database,
});

function sameBackend(a: ReturnType<typeof identity>, b: ReturnType<typeof identity>) {
  return a.processId === b.processId && a.backendStart === b.backendStart && a.database === b.database;
}

/** 目录直接返回毫秒整数，避免根据本地语言或 SHOW 的显示单位猜测。 */
export async function readPostgresQueryTimeouts(connection: PostgresConnection, check: () => void): Promise<PostgresQueryTimeoutSnapshot> {
  const assertIdle = () => {
    check();
    const state = connection.state();
    if (connection.broken || state.broken || !state.transactionKnown || state.transactionOpen || state.transactionFailed)
      throw Error('请先明确提交或回滚原事务，再读取查询超时');
  };
  assertIdle();
  const original = identity(connection);
  const result = await connection.query(readSql, undefined, budget());
  assertIdle();
  const invalid = 'PostgreSQL 未返回原会话的完整毫秒设置';
  if (!sameBackend(original, identity(connection)) || result.postgresCommand !== 'SELECT' || result.truncated ||
      result.columns.length !== 4 || result.rows.length !== 2) throw Error(invalid);
  const read = (name: string) => {
    const row = result.rows.find(row => row.c0 === name);
    if (row?.c3 !== 'ms' || typeof row.c1 !== 'string' || typeof row.c2 !== 'string' ||
        !/^\d{1,10}$/.test(row.c1) || !/^\d{1,10}$/.test(row.c2)) throw Error(invalid);
    return {value: Number(row.c1), reset: Number(row.c2)};
  };
  const statement = read('statement_timeout'), lock = read('lock_timeout');
  return postgresQueryTimeoutSnapshot.parse({...original, statementMs: statement.value, lockMs: lock.value,
    defaults: {statementMs: statement.reset, lockMs: lock.reset}});
}

/** 发送前复核原值和物理会话，发送后的不确定回执要求显式重新读取。 */
export async function applyPostgresQueryTimeouts(connection: PostgresConnection, expected: PostgresQueryTimeoutSnapshot,
  change: PostgresQueryTimeoutChange, check: () => void): Promise<PostgresQueryTimeoutSnapshot> {
  const before = postgresQueryTimeoutSnapshot.parse(expected), next = postgresQueryTimeoutChange.parse(change);
  const actual = await readPostgresQueryTimeouts(connection, check);
  if (!sameBackend(before, actual) || before.statementMs !== actual.statementMs || before.lockMs !== actual.lockMs ||
      before.defaults.statementMs !== actual.defaults.statementMs || before.defaults.lockMs !== actual.defaults.lockMs)
    throw Error('原会话或查询超时已变化，请重新读取');
  const values = next.mode === 'set' ? next.values : actual.defaults;
  check();
  try {
    const result = await connection.query(applySql, next.mode === 'set' ? [String(values.statementMs), String(values.lockMs)] : [null, null], budget());
    if (result.postgresCommand !== 'SELECT' || result.truncated || result.columns.length !== 2 || result.rows.length !== 1) throw Error();
    const verified = await readPostgresQueryTimeouts(connection, check);
    if (!sameBackend(before, verified) || verified.statementMs !== values.statementMs || verified.lockMs !== values.lockMs) throw Error();
    return verified;
  } catch {
    throw Error('查询超时可能已改变，请重新读取原会话核对');
  }
}
