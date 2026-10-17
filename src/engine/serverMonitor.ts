import { serverMonitorLimits, serverMonitorStatusNames, validateServerMonitorInput, type ServerMonitorInput, type ServerMonitorSnapshot, type ServerMonitorSection, type ServerMonitorSession, type ServerMonitorSummary } from '../shared/serverMonitor';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

type Row = Record<string, unknown>;
const summarySql = 'SELECT LEFT(VERSION(), 128) AS version, LEFT(@@version_comment, 255) AS versionComment, LEFT(@@hostname, 255) AS hostname, CAST(@@port AS CHAR) AS port, LEFT(CURRENT_USER(), 512) AS currentUser, CAST(CONNECTION_ID() AS CHAR) AS connectionId';
const statusSql = `SHOW GLOBAL STATUS WHERE Variable_name IN (${serverMonitorStatusNames.map(name => `'${name}'`).join(', ')})`;
/** 在服务器端投影 SQL 摘要和真实字符数，巨型语句不会先传到客户端。 */
export function serverMonitorSessionsSql(limit: number): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > serverMonitorLimits.sessions) throw new Error('服务器监控会话条数无效');
  return `SELECT CAST(ID AS CHAR) AS id, LEFT(USER, 128) AS user, LEFT(HOST, 255) AS host, LEFT(DB, 128) AS databaseName, LEFT(COMMAND, 64) AS command, CAST(TIME AS CHAR) AS seconds, LEFT(STATE, 255) AS state, LEFT(INFO, ${serverMonitorLimits.sqlCharacters}) AS sqlText, CAST(CHAR_LENGTH(INFO) AS CHAR) AS sqlLength FROM information_schema.PROCESSLIST ORDER BY ID LIMIT ${limit + 1}`;
}
/** 只接受驱动返回的精确字符串；禁止将已丢失精度的数字转成貌似准确的计数。 */
function text(row: Row, key: string, maximum: number, nullable = false): string | null {
  const value = row[key];
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || [...value].length > maximum) throw new Error(`服务器监控字段 ${key} 格式或长度无效`);
  return value;
}
function counter(row: Row, key: string, nullable = false): string | null {
  const value = text(row, key, 40, nullable);
  if (value !== null && !/^\d+$/.test(value)) throw new Error(`服务器监控计数字段 ${key} 无效`);
  return value;
}
/** 仅将权限/版本缺项降级为单项不可用，连接中断与取消仍交给任务边界处理。 */
async function section<T>(context: StructureTaskContext, read: () => Promise<T>): Promise<ServerMonitorSection<T>> {
  context.checkCancelled();
  try { const value = await read(); context.checkCancelled(); return { status: 'available', value }; }
  catch (error) {
    context.checkCancelled();
    const code = (error as { code?: string }).code;
    if (!['ER_ACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_UNKNOWN_TABLE', 'ER_NO_SUCH_TABLE', 'ER_NOT_SUPPORTED_YET'].includes(code ?? '')) throw error;
    return { status: 'unavailable', reason: String((error as Error).message || '服务器不允许读取此项').slice(0, 1024) };
  }
}
/** 调用方必须提供专属短连接及真实命令取消边界；不复用用户 SQL 会话。 */
export async function readServerMonitor(context: StructureTaskContext, input: ServerMonitorInput): Promise<ServerMonitorSnapshot> {
  validateServerMonitorInput(input);
  const startedAt = new Date().toISOString(), limit = input.sessionLimit ?? serverMonitorLimits.defaultSessions;
  const summary = await section(context, async (): Promise<ServerMonitorSummary> => {
    const rows = (await structureTaskQuery<Row[]>(context, summarySql)).rows;
    if (rows.length !== 1) throw new Error('服务器概要返回条数无效');
    const row = rows[0];
    return { version: text(row, 'version', 128)!, versionComment: text(row, 'versionComment', 255)!, hostname: text(row, 'hostname', 255)!, port: counter(row, 'port')!, currentUser: text(row, 'currentUser', 512)!, connectionId: counter(row, 'connectionId')! };
  });
  const globalStatus = await section(context, async () => {
    const rows = (await structureTaskQuery<Row[]>(context, statusSql)).rows;
    if (rows.length > serverMonitorStatusNames.length) throw new Error('服务器状态变量返回条数超限');
    const seen = new Set<string>();
    return rows.map(row => {
      const name = text(row, 'Variable_name', 64)!;
      const canonical = serverMonitorStatusNames.find(item => item.toLowerCase() === name.toLowerCase());
      if (!canonical || seen.has(canonical)) throw new Error('服务器状态变量重复或超出固定范围');
      seen.add(canonical);
      return { name: canonical, value: counter(row, 'Value')! };
    });
  });
  const sessions = await section(context, async () => {
    const rows = (await structureTaskQuery<Row[]>(context, serverMonitorSessionsSql(limit))).rows;
    if (rows.length > limit + 1) throw new Error('服务器会话返回条数超限');
    const mapped = rows.slice(0, limit).map((row): ServerMonitorSession => {
      const sqlLength = counter(row, 'sqlLength', true);
      return { id: counter(row, 'id')!, user: text(row, 'user', 128, true), host: text(row, 'host', 255, true), database: text(row, 'databaseName', 128, true), command: text(row, 'command', 64, true), seconds: counter(row, 'seconds', true), state: text(row, 'state', 255, true), sql: text(row, 'sqlText', serverMonitorLimits.sqlCharacters, true), sqlLength, sqlTruncated: sqlLength !== null && BigInt(sqlLength) > BigInt(serverMonitorLimits.sqlCharacters) };
    });
    return { rows: mapped, limit, truncated: rows.length > limit, visibility: 'account-visible-unconfirmed' as const };
  });
  const result: ServerMonitorSnapshot = { startedAt, completedAt: new Date().toISOString(), summary, globalStatus, sessions, bytes: 0 };
  // 有界字符串投影后仍核对序列化总字节，避免跨 IPC 传递无界快照。
  // bytes 自身也属于 JSON；收敛到包含计数字段自身的精确字节数。
  for (let previous = -1; previous !== result.bytes;) { previous = result.bytes; result.bytes = Buffer.byteLength(JSON.stringify(result), 'utf8'); }
  if (result.bytes > serverMonitorLimits.snapshotBytes) throw new Error('服务器监控快照超过字节预算');
  context.checkCancelled();
  return result;
}
