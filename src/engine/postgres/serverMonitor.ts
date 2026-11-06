import type { CellValue, QueryResult } from '../../shared/contracts';
import { postgresMonitorStatusNames, serverMonitorLimits, validateServerMonitorInput, type ServerMonitorInput,
  type ServerMonitorSection, type ServerMonitorSession, type ServerMonitorSignalAction, type ServerMonitorSignalResult,
  type ServerMonitorSnapshot } from '../../shared/serverMonitor';
import { finalizeServerMonitorSnapshot } from '../serverMonitor';
import type { PostgresConnection } from './connection';

const summarySql = `SELECT pg_catalog.current_setting('server_version'), pg_catalog.left(pg_catalog.version(), 255),
  pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.inet_server_port()::text, CURRENT_USER::text,
  pg_catalog.pg_backend_pid()::text, pg_catalog.current_database()`;
const statusSql = `SELECT ${postgresMonitorStatusNames.map(name => name + '::text').join(', ')},
  pg_catalog.to_char(stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM pg_catalog.pg_stat_database WHERE datname = pg_catalog.current_database()`;
const instance = `pg_catalog.jsonb_build_array(pg_catalog.inet_server_addr(), pg_catalog.inet_server_port(),
  EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()), pg_catalog.current_database())::text`;

export interface PostgresMonitorSignalTarget {
  pid: string;
  user: string;
  database: string;
  backendStart: string;
  instance: string;
  query?: { start: string; digest: string };
}
export type PostgresMonitorPrivateSnapshot = ServerMonitorSnapshot & { signalTargets?: PostgresMonitorSignalTarget[] };

/** 排除当前读快照的连接和无数据库的系统进程，保留普通账号能看到但详情受限的行。 */
function sessionsSql(limit: number) {
  return `SELECT pid::text, usename::text, pg_catalog.host(client_addr), datname::text, backend_type,
    CASE WHEN activity.started IS NOT NULL THEN
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM pg_catalog.statement_timestamp() - activity.started)))::bigint::text END,
    state, pg_catalog.left(activity.sql, ${serverMonitorLimits.sqlCharacters}), pg_catalog.char_length(activity.sql)::text,
    NULLIF(pg_catalog.concat_ws(': ', wait_event_type, wait_event), ''),
    EXTRACT(EPOCH FROM backend_start)::text, ${instance},
    CASE WHEN state = 'active' AND activity.sql IS NOT NULL THEN EXTRACT(EPOCH FROM query_start)::text END,
    CASE WHEN state = 'active' THEN pg_catalog.md5(activity.sql) END
    FROM pg_catalog.pg_stat_activity
    CROSS JOIN LATERAL (VALUES (CASE WHEN state = 'active' THEN query_start ELSE state_change END,
      CASE WHEN state IS NOT NULL AND query NOT IN ('<insufficient privilege>', '<command string not enabled>') THEN query END)
    ) AS activity(started, sql)
    WHERE datname IS NOT NULL AND pid <> pg_catalog.pg_backend_pid() ORDER BY pid LIMIT ${limit + 1}`;
}

function text(value: CellValue | undefined, limit: number, nullable: true): string | null;
function text(value: CellValue | undefined, limit: number, nullable?: false): string;
function text(value: CellValue | undefined, limit: number, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || [...value].length > limit) throw Error('PostgreSQL 监控字段格式或长度无效');
  return value;
}

function counter(value: CellValue | undefined): string {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value)) throw Error('PostgreSQL 监控计数格式无效');
  return value;
}

function single(result: QueryResult) {
  if (result.rows.length !== 1) throw Error('PostgreSQL 监控回包条数无效');
  return result.rows[0];
}
const epoch = (value: unknown): value is string => typeof value === 'string' && /^-?\d{1,16}(?:\.\d{1,6})?$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

/** 只运行固定的目录 SQL。各段独立处理权限不足，取消和连接错误由原任务处理。 */
export async function readPostgresServerMonitor(connection: PostgresConnection, input: ServerMonitorInput,
  check: () => void): Promise<PostgresMonitorPrivateSnapshot> {
  validateServerMonitorInput(input);
  const startedAt = new Date().toISOString(), limit = input.sessionLimit ?? serverMonitorLimits.defaultSessions;
  async function section<T>(sql: string, rows: number, bytes: number, map: (result: QueryResult) => T): Promise<ServerMonitorSection<T>> {
    check();
    try {
      const result = await connection.query(sql, undefined, { rows, bytes });
      check();
      if (result.truncated) throw Error('PostgreSQL 监控回包超过读取预算');
      return { status: 'available', value: map(result) };
    } catch (reason) {
      check();
      const state = (reason as { postgresSqlState?: string }).postgresSqlState;
      if (state === '42501') return { status: 'unavailable', reason: '当前账号没有读取此项的权限' };
      if (state && ['42P01', '42703', '42883'].includes(state)) return { status: 'unavailable', reason: '服务器未提供此监控项' };
      throw reason;
    }
  }

  const summary = await section(summarySql, 1, 8192, result => {
    const { c0, c1, c2, c3, c4, c5, c6 } = single(result);
    return { version: text(c0, 128), versionComment: text(c1, 255), hostname: text(c2, 255, true),
      port: c3 === null ? null : counter(c3), currentUser: text(c4, 512), connectionId: counter(c5), database: text(c6, 128) };
  });
  let statisticsReset: string | null | undefined;
  const globalStatus = await section(statusSql, 1, 8192, result => {
    const row = single(result);
    statisticsReset = text(row['c' + postgresMonitorStatusNames.length], 64, true);
    return postgresMonitorStatusNames.map((name, index) => ({ name, value: counter(row['c' + index]) }));
  });
  const signalTargets: PostgresMonitorSignalTarget[] = [];
  const sessions = await section(sessionsSql(limit), limit + 1, serverMonitorLimits.snapshotBytes, result => {
    const rows = result.rows.slice(0, limit).map((row): ServerMonitorSession => {
      const { c0, c1, c2, c3, c4, c5, c6, c7, c8, c9 } = row;
      const sqlLength = c8 === null ? null : counter(c8);
      const session = { id: counter(c0), user: text(c1, 128, true), host: text(c2, 255, true), database: text(c3, 128, true),
        command: text(c4, 128, true), seconds: c5 === null ? null : counter(c5), state: text(c6, 255, true),
        sql: text(c7, serverMonitorLimits.sqlCharacters, true), sqlLength,
        sqlTruncated: sqlLength !== null && BigInt(sqlLength) > BigInt(serverMonitorLimits.sqlCharacters), waitEvent: text(c9, 255, true) };
      // 身份数据仅交给 Main 签发本窗口的一次性能力。看不到后端启动时间的会话保持只读。
      if (session.command === 'client backend' && session.user !== null && session.database !== null &&
          epoch(row.c10) && typeof row.c11 === 'string' && row.c11.length <= 512) {
        signalTargets.push({ pid: session.id, user: session.user, database: session.database, backendStart: row.c10, instance: row.c11,
          ...(epoch(row.c12) && digest(row.c13) ? { query: { start: row.c12, digest: row.c13 } } : {}) });
      }
      return session;
    });
    return { rows, limit, truncated: result.rows.length > limit, visibility: 'account-visible-unconfirmed' as const };
  });
  check();
  const snapshot = finalizeServerMonitorSnapshot({ dialect: 'postgresql', startedAt, summary, globalStatus, statisticsReset, sessions });
  return signalTargets.length ? { ...snapshot, signalTargets } : snapshot;
}

/** 信号只调用一次。同一 SQL 核对实例、进程代次和原查询，后续只观察目标状态。 */
export async function signalPostgresMonitorTarget(connection: PostgresConnection, target: PostgresMonitorSignalTarget,
  action: ServerMonitorSignalAction, beforeSend: () => void): Promise<ServerMonitorSignalResult> {
  const cancel = action === 'cancel-query';
  if (!epoch(target.backendStart) || cancel && (!epoch(target.query?.start) || !digest(target.query?.digest))) return { status: 'stale' };
  const parameters = [target.pid, target.user, target.database, target.backendStart, target.instance];
  if (cancel) parameters.push(target.query!.start, target.query!.digest);
  const matching = `FROM pg_catalog.pg_stat_activity WHERE pid = $1::integer AND pid <> pg_catalog.pg_backend_pid()
    AND backend_type = 'client backend' AND usename::text = $2 AND datname::text = $3
    AND EXTRACT(EPOCH FROM backend_start) = $4::numeric AND ${instance} = $5` +
    (cancel ? " AND state = 'active' AND EXTRACT(EPOCH FROM query_start) = $6::numeric AND pg_catalog.md5(query) = $7" : '');
  const budget = () => ({ rows: 1, bytes: 1024 });
  await connection.query("SET statement_timeout = '5s'", undefined, budget());
  beforeSend();
  try {
    const result = await connection.query(`SELECT pg_catalog.${cancel ? 'pg_cancel_backend' : 'pg_terminate_backend'}(pid) ${matching}`, parameters, budget());
    if (result.truncated || result.rows.length > 1) return { status: 'unknown' };
    if (!result.rows.length) return { status: 'stale' };
    if (result.rows[0].c0 === 'f') return { status: 'rejected' };
    if (result.rows[0].c0 !== 't') return { status: 'unknown' };
  } catch (reason) {
    return { status: (reason as { postgresSqlState?: string }).postgresSqlState === '42501' ? 'denied' : 'unknown' };
  }
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const observation = await connection.query(`SELECT CASE WHEN ${instance} <> $5 OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1::integer AND backend_start IS NULL)
        THEN NULL ELSE EXISTS (SELECT 1 ${matching}) END`, parameters, budget());
      if (observation.truncated || observation.rows[0]?.c0 !== 't' && observation.rows[0]?.c0 !== 'f')
        return { status: 'accepted', observation: 'unknown' };
      if (observation.rows[0].c0 === 'f') return { status: 'accepted', observation: 'ended' };
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { status: 'accepted', observation: 'still-present' };
  } catch { return { status: 'accepted', observation: 'unknown' }; }
}
