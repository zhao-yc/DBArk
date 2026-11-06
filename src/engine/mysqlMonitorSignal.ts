import type { ResultSetHeader } from 'mysql2';
import { isServerMonitorNumericId, serverMonitorLimits, type ServerMonitorSession, type ServerMonitorSignalAction,
  type ServerMonitorSignalResult, type ServerMonitorSnapshot } from '../shared/serverMonitor';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

export interface MysqlMonitorSignalTarget {
  dialect: 'mysql' | 'mariadb';
  pid: string;
  instance: string;
  user: string;
  host: string;
  database: string | null;
  threadId?: string;
  query?: string;
}
export type MysqlMonitorPrivateSnapshot = ServerMonitorSnapshot & { signalTargets?: MysqlMonitorSignalTarget[] };

type Row = Record<string, unknown>;
type Dialect = MysqlMonitorSignalTarget['dialect'];
type Metadata = 'statement' | 'thread' | 'query-id';
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** 旧版本或最小权限账号仍可读取普通监控快照，连接异常和取消继续由任务处理。 */
async function optionalRows(context: StructureTaskContext, sql: string): Promise<Row[] | undefined> {
  try { return (await structureTaskQuery<Row[]>(context, sql)).rows; }
  catch (reason) {
    context.checkCancelled();
    const code = (reason as { code?: string }).code;
    if (['ER_ACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR',
      'ER_DBACCESS_DENIED_ERROR', 'ER_UNKNOWN_TABLE', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR',
      'ER_UNKNOWN_SYSTEM_VARIABLE', 'ER_NOT_SUPPORTED_YET'].includes(code ?? '')) return undefined;
    throw reason;
  }
}

/** 同一语句取服务器标识和启动秒，避免两次读取恰好跨秒而误判为另一实例。 */
async function instanceId(context: StructureTaskContext, dialect: Dialect) {
  const mysql = dialect === 'mysql';
  const uid = mysql ? '@@server_uuid' : '@@server_uid';
  const statusTable = mysql ? 'performance_schema.global_status' : 'information_schema.GLOBAL_STATUS';
  const rows = await optionalRows(context, `SELECT SHA2(JSON_ARRAY(${uid}, @@server_id, @@hostname, @@port, VERSION(),
    CURRENT_USER(), UNIX_TIMESTAMP() - CAST(VARIABLE_VALUE AS UNSIGNED)), 256) AS instance
    FROM ${statusTable} WHERE VARIABLE_NAME = 'Uptime' AND CAST(VARIABLE_VALUE AS UNSIGNED) >= 2
    AND ${uid} NOT IN ('', 'unknown')`);
  const instance = rows?.length === 1 ? rows[0].instance : undefined;
  return isDigest(instance) ? instance : undefined;
}

/** 仅查已显示的数字 ID；所有可插值内容均为固定模板或经范围校验的十进制数字。 */
function readIdentities(context: StructureTaskContext, dialect: Dialect, ids: string[], metadata: Metadata) {
  if (!ids.length || ids.length > serverMonitorLimits.sessions || !ids.every(isServerMonitorNumericId))
    throw Error('服务器监控连接 ID 无效');
  const thread = metadata !== 'query-id';
  const statements = dialect === 'mysql' && metadata === 'statement';
  const active = "p.COMMAND IN ('Query', 'Execute') AND p.INFO IS NOT NULL";
  const query = dialect === 'mariadb' ? `CASE WHEN ${active} THEN CAST(p.QUERY_ID AS CHAR) END`
    : statements ? `CASE WHEN ${active} AND BINARY LEFT(e.SQL_TEXT, ${serverMonitorLimits.sqlCharacters}) = BINARY LEFT(p.INFO, ${serverMonitorLimits.sqlCharacters}) THEN CAST(e.EVENT_ID AS CHAR) END` : 'NULL';
  return optionalRows(context, `SELECT CAST(p.ID AS CHAR) AS id, p.USER AS user, p.HOST AS host, p.DB AS databaseName,
    p.COMMAND AS command, LEFT(p.INFO, ${serverMonitorLimits.sqlCharacters}) AS sqlText,
    ${thread ? 'CAST(t.THREAD_ID AS CHAR)' : 'NULL'} AS threadId, ${query} AS queryId
    FROM information_schema.PROCESSLIST p
    ${thread ? "LEFT JOIN performance_schema.threads t ON t.PROCESSLIST_ID = p.ID AND t.TYPE = 'FOREGROUND'" : ''}
    ${statements ? 'LEFT JOIN performance_schema.events_statements_current e ON e.THREAD_ID = t.THREAD_ID AND e.END_EVENT_ID IS NULL' : ''}
    WHERE p.ID IN (${ids.join(', ')}) AND p.ID <> CONNECTION_ID()
    AND p.USER NOT IN ('', 'system user', 'event_scheduler', 'unauthenticated user')`);
}

/** 监控仍以 PROCESSLIST 的可见范围为准，Performance Schema 只补充匹配行的身份。 */
export async function captureMysqlMonitorTargets(context: StructureTaskContext, sessions: ServerMonitorSession[]): Promise<MysqlMonitorSignalTarget[]> {
  const dialect = context.managed?.status?.dialect;
  if ((dialect !== 'mysql' && dialect !== 'mariadb') || !context.managed.status.version) return [];
  const ids = sessions.map(row => row.id).filter(isServerMonitorNumericId);
  if (!ids.length) return [];
  const instance = await instanceId(context, dialect);
  if (!instance) return [];
  const rows = await readIdentities(context, dialect, ids, dialect === 'mysql' ? 'statement' : 'thread') ??
    await readIdentities(context, dialect, ids, dialect === 'mysql' ? 'thread' : 'query-id');
  if (!rows || rows.length > ids.length) return [];
  const identities = new Map(rows.map(row => [row.id, row]));
  if (identities.size !== rows.length) return [];
  return sessions.flatMap(session => {
    const row = identities.get(session.id);
    if (!row || !session.user || !session.host || row.user !== session.user || row.host !== session.host || row.databaseName !== session.database) return [];
    const threadId = isServerMonitorNumericId(row.threadId) ? row.threadId : undefined;
    const query = row.command === session.command && row.sqlText === session.sql && isServerMonitorNumericId(row.queryId) &&
      (dialect === 'mariadb' || threadId) ? row.queryId : undefined;
    return threadId || query ? [{ dialect, instance, pid: session.id, user: session.user, host: session.host,
      database: session.database, threadId, query }] : [];
  });
}

/** MariaDB 直接按原语句 ID 取消；MySQL 只有连接 ID 可发送，故在发送前再次检查原语句事件。 */
export async function signalMysqlMonitorTarget(context: StructureTaskContext, target: MysqlMonitorSignalTarget,
  action: ServerMonitorSignalAction, beforeSend: () => void): Promise<ServerMonitorSignalResult> {
  const { dialect, pid, query, threadId } = target;
  const cancel = action === 'cancel-query';
  if (context.managed.status.dialect !== dialect || !isServerMonitorNumericId(pid) || !isDigest(target.instance) ||
      (cancel && !isServerMonitorNumericId(query)) ||
      ((!cancel || dialect === 'mysql' || threadId !== undefined) && !isServerMonitorNumericId(threadId)))
    return { status: 'stale' };

  const mode = dialect === 'mysql' && cancel ? 'statement' : threadId ? 'thread' : 'query-id';
  const observe = async (verify: boolean): Promise<'matching' | 'gone' | 'unavailable'> => {
    if (await instanceId(context, dialect) !== target.instance) return 'unavailable';
    const rows = await readIdentities(context, dialect, [pid], mode);
    if (!rows || rows.length > 1) return 'unavailable';
    const row = rows[0];
    if (!row) return 'gone';
    if (verify && (row.user !== target.user || row.host !== target.host || row.databaseName !== target.database)) return 'gone';
    if (threadId && !isServerMonitorNumericId(row.threadId)) return 'unavailable';
    if (threadId && row.threadId !== threadId) return 'gone';
    if (!cancel || row.queryId === query) return 'matching';
    if ((row.command === 'Query' || row.command === 'Execute') && row.sqlText !== null && !isServerMonitorNumericId(row.queryId))
      return 'unavailable';
    return 'gone';
  };
  if (await observe(true) !== 'matching') return { status: 'stale' };

  const sql = dialect === 'mariadb'
    ? cancel ? `KILL SOFT QUERY ID ${query}` : `KILL SOFT CONNECTION ${pid}`
    : cancel ? `KILL QUERY ${pid}` : `KILL CONNECTION ${pid}`;
  let sent = false;
  try {
    const { rows } = await structureTaskQuery<ResultSetHeader>(context, sql, () => { beforeSend(); sent = true; });
    if (rows?.fieldCount !== 0 || rows.affectedRows !== 0) return { status: 'unknown' };
  } catch (reason) {
    if (!sent) throw reason;
    const errno = (reason as { errno?: number }).errno;
    if (errno === 1094 || errno === 1957) return { status: 'stale' };
    if (errno === 1095 || errno === 1227) return { status: 'denied' };
    return { status: 'unknown' };
  }
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const state = await observe(false);
      if (state === 'gone') return { status: 'accepted', observation: 'ended' };
      if (state === 'unavailable') break;
      if (attempt === 5) return { status: 'accepted', observation: 'still-present' };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch { /* 已有服务器回执，后续观察失败不能覆盖接收事实。 */ }
  return { status: 'accepted', observation: 'unknown' };
}
