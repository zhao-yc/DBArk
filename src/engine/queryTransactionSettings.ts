import type { NetworkConnectionStatus } from '../shared/contracts';
import {
  parseQueryTransactionBoolean, parseQueryTransactionIsolation, queryTransactionSettingsSnapshotSchema,
  queryTransactionSettingsSql, queryTransactionSettingsVariables,
  type QueryTransactionIsolation, type QueryTransactionSettingsSnapshot,
} from '../shared/queryTransactionSettings';

export interface QueryTransactionSettingsContext {
  status: Pick<NetworkConnectionStatus, 'dialect' | 'version'>;
  physicalId(): number | undefined;
  query(sql: string, onSend?: () => void, onAcknowledged?: (result: { rows: unknown; fields: readonly { name: string }[] }) => void): Promise<{ rows: unknown; fields: readonly { name: string }[] }>;
  protocolState(): { known: boolean; broken: boolean; serverStatus?: number };
  check(): void;
  onSetSent?(): void;
}

/** SET发出后不能把取消、断线或回读失败描述成“未修改”；保留原错误供诊断。 */
export function queryTransactionSettingsMayHaveChanged(error: unknown): Error {
  const message = '设置可能已改变，请重新读取核对；不会自动重试';
  if (error instanceof Error && error.message.startsWith(message)) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(message + '；' + detail.slice(0, 1024), { cause: error });
}

/** 只使用原驱动线程号的精确整数表示；快照中的大整数文本不经过Number转换。 */
function physicalId(context: QueryTransactionSettingsContext): string {
  const id = context.physicalId();
  if (!Number.isSafeInteger(id) || (id ?? 0) < 1) throw Error('无法确认原物理会话编号，请重新打开查询标签');
  return String(id);
}

/** 读取固定四列诊断；事务与自动提交只采信本次命令的新鲜EOF/OK状态。 */
export async function readQueryTransactionSettings(context: QueryTransactionSettingsContext): Promise<QueryTransactionSettingsSnapshot> {
  context.check();
  const status = { dialect: context.status.dialect, version: context.status.version };
  const variables = queryTransactionSettingsVariables(status), connectionId = physicalId(context);
  const names = ['__dbark_tx_isolation', '__dbark_tx_read_only', '__dbark_tx_connection', '__dbark_tx_database'];
  const sql = `SELECT @@SESSION.${variables.isolation} AS ${names[0]},@@SESSION.${variables.readOnly} AS ${names[1]},CAST(CONNECTION_ID() AS CHAR) AS ${names[2]},DATABASE() AS ${names[3]}`;
  context.check();
  const result = await context.query(sql);
  context.check();
  if (!Array.isArray(result.rows) || result.rows.length !== 1 || result.fields.length !== 4 || result.fields.some((field, index) => field.name !== names[index])) throw Error('无法完整读取原会话的事务默认设置');
  const row: unknown = result.rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 4 || names.some(name => !Object.hasOwn(row, name))) throw Error('事务默认设置诊断结果形状无效');
  const cells = row as Record<string, unknown>, protocol = context.protocolState();
  if (protocol.broken || !protocol.known || !Number.isInteger(protocol.serverStatus) || (protocol.serverStatus ?? -1) < 0 || (protocol.serverStatus ?? 65536) > 65535) throw Error('原会话事务状态未知，请重新读取核对');
  if (physicalId(context) !== connectionId || cells[names[2]] !== connectionId || context.status.version !== status.version || context.status.dialect !== status.dialect) throw Error('原物理会话身份已变化，请重新读取核对');
  return queryTransactionSettingsSnapshotSchema.parse({
    dialect: status.dialect, serverVersion: status.version, serverConnectionId: connectionId,
    database: cells[names[3]], isolation: parseQueryTransactionIsolation(cells[names[0]]), readOnly: parseQueryTransactionBoolean(cells[names[1]]),
    transactionOpen: Boolean(protocol.serverStatus! & 1), autocommit: Boolean(protocol.serverStatus! & 2),
  });
}

/** 原会话互斥内先全量核对确认快照；只发一个固定SET，绝不提交、重连或自动重放。 */
export async function applyQueryTransactionSettings(expected: QueryTransactionSettingsSnapshot, isolation: QueryTransactionIsolation, readOnly: boolean, context: QueryTransactionSettingsContext): Promise<QueryTransactionSettingsSnapshot> {
  const frozen = queryTransactionSettingsSnapshotSchema.parse(expected);
  const sql = queryTransactionSettingsSql(isolation, readOnly);
  let sent = false;
  try {
    const current = await readQueryTransactionSettings(context);
    if (current.transactionOpen) throw Error('当前标签有活动事务，请先明确提交或回滚，再修改本会话默认设置');
    for (const key of Object.keys(frozen) as (keyof QueryTransactionSettingsSnapshot)[]) if (current[key] !== frozen[key]) throw Error('原会话事务默认设置或确认上下文已变化，请重新读取核对');
    context.check();
    if (current.isolation === isolation && current.readOnly === readOnly) return current;
    const acknowledgement = await context.query(sql, () => { sent = true; context.onSetSent?.(); });
    const header = acknowledgement.rows;
    if (!header || typeof header !== 'object' || Array.isArray(header) || !('affectedRows' in header) || header.affectedRows !== 0 || !('warningStatus' in header) || header.warningStatus !== 0 || !('serverStatus' in header) || typeof header.serverStatus !== 'number' || !Number.isInteger(header.serverStatus) || header.serverStatus < 0 || header.serverStatus > 65535) throw Error('事务默认设置未获得无警告的单个服务器确认包');
    const acknowledged = context.protocolState();
    if (acknowledged.broken || !acknowledged.known || acknowledged.serverStatus !== header.serverStatus || Boolean(header.serverStatus & 1) || Boolean(header.serverStatus & 2) !== current.autocommit) throw Error('事务默认设置确认包中的会话事务状态不明确或已变化');
    context.check();
    const actual = await readQueryTransactionSettings(context);
    if (actual.isolation !== isolation || actual.readOnly !== readOnly || actual.transactionOpen || actual.autocommit !== current.autocommit || actual.database !== current.database || actual.serverConnectionId !== current.serverConnectionId || actual.serverVersion !== current.serverVersion || actual.dialect !== current.dialect) throw Error('设置后的原会话读回值与确认内容不一致');
    return actual;
  } catch (error) {
    if (sent) throw queryTransactionSettingsMayHaveChanged(error);
    throw error;
  }
}
