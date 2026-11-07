import type { PostgresConnection } from './connection';
import { postgresSearchPathCandidates, postgresSearchPathChangeSchema, postgresSearchPathSnapshotSchema,
  type PostgresSearchPathChange, type PostgresSearchPathSnapshot } from '../../shared/postgresSearchPath';

const readSql = `SELECT pg_catalog.current_setting('search_path'), current_user,
  pg_catalog.array_to_json(pg_catalog.current_schemas(true))::pg_catalog.text,
  pg_catalog.array_to_json(ARRAY(
    SELECT n.nspname FROM pg_catalog.pg_namespace n
    WHERE pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND n.nspname::pg_catalog.text OPERATOR(pg_catalog.!~) '^pg_(temp_|toast_temp_)'
    ORDER BY n.nspname LIMIT ${postgresSearchPathCandidates + 1}
  ))::pg_catalog.text`;
const applySql = "SELECT pg_catalog.set_config('search_path', $1::pg_catalog.text, false)";
const budget = () => ({rows: 1, bytes: 128 * 1024});
const identity = (connection: PostgresConnection) => ({
  processId: connection.processId, backendStart: connection.backendStart, database: connection.database,
});

/** 在原会话查询实际身份和路径。活动事务不执行目录 SELECT，避免提前固定事务快照。 */
export async function readPostgresSearchPath(connection: PostgresConnection, check: () => void): Promise<PostgresSearchPathSnapshot> {
  const assertIdle = () => {
    check();
    const state = connection.state();
    if (connection.broken || state.broken || !state.transactionKnown || state.transactionOpen || state.transactionFailed)
      throw Error('请先明确提交或回滚原事务，再读取搜索路径');
  };
  assertIdle();
  const original = identity(connection);
  const result = await connection.query(readSql, undefined, budget());
  assertIdle();
  if (result.postgresCommand !== 'SELECT' || result.truncated || result.rows.length !== 1 || result.columns.length !== 4 ||
      connection.processId !== original.processId || connection.backendStart !== original.backendStart || connection.database !== original.database)
    throw Error('PostgreSQL 未返回原会话的完整搜索路径');
  const {c0: path, c1: role, c2: effectiveJson, c3: candidatesJson} = result.rows[0];
  try {
    if (typeof effectiveJson !== 'string' || typeof candidatesJson !== 'string') throw Error();
    const candidates: unknown = JSON.parse(candidatesJson);
    if (!Array.isArray(candidates) || candidates.length > postgresSearchPathCandidates + 1) throw Error();
    return postgresSearchPathSnapshotSchema.parse({...original, path, role, effective: JSON.parse(effectiveJson),
      candidates: candidates.slice(0, postgresSearchPathCandidates), candidatesTruncated: candidates.length > postgresSearchPathCandidates});
  } catch {
    throw Error('PostgreSQL 搜索路径或候选列表无效或超过读取范围');
  }
}

function sameIdentity(left: PostgresSearchPathSnapshot, right: PostgresSearchPathSnapshot): boolean {
  return left.processId === right.processId && left.backendStart === right.backendStart &&
    left.database === right.database && left.role === right.role;
}

/** 比较原身份与旧路径后发送一次绑定参数。发送后异常只要求重新读取，避免重试覆盖会话设置。 */
export async function applyPostgresSearchPath(connection: PostgresConnection, expected: PostgresSearchPathSnapshot,
  change: PostgresSearchPathChange, check: () => void): Promise<PostgresSearchPathSnapshot> {
  const before = postgresSearchPathSnapshotSchema.parse(expected);
  const next = postgresSearchPathChangeSchema.parse(change);
  const actual = await readPostgresSearchPath(connection, check);
  if (!sameIdentity(before, actual) || before.path !== actual.path || JSON.stringify(before.effective) !== JSON.stringify(actual.effective))
    throw Error('原会话身份或搜索路径已变化，请重新读取');
  check();
  try {
    const result = await connection.query(applySql, [next.mode === 'set' ? next.path : null], budget());
    const applied = result.rows[0]?.c0;
    if (result.postgresCommand !== 'SELECT' || result.truncated || result.columns.length !== 1 ||
        result.rows.length !== 1 || typeof applied !== 'string') throw Error();
    const verified = await readPostgresSearchPath(connection, check);
    if (!sameIdentity(before, verified) || verified.path !== applied) throw Error();
    return verified;
  } catch {
    throw Error('未取得完整的设置回执。请重新读取搜索路径，检查语法和当前值');
  }
}
