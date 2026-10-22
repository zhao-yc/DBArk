import type { DatabaseDropProgress, DatabaseDropTarget } from '../shared/databaseDrop';
import { databaseDropAcknowledgements } from '../shared/databaseDrop';
import { databaseDropZh as text } from './locales/databaseDrop.zh-CN';
export { IndexRequestFence as DatabaseDropRequestFence } from './indexPatches';

/** 库级目标精确比较，不修剪或折叠大小写，也不拼接可能碰撞的分隔符。 */
export function sameDatabaseDropTarget(a: DatabaseDropTarget, b: DatabaseDropTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database; }
/** 仅识别协议中的四项固定确认，未知项或原型属性名不能变成授权。 */
export function databaseDropAckLabel(id: string): string | undefined { return id === 'irreversible-database-drop' ? text.ackIrreversible : id === 'external-ddl-window' ? text.ackWindow : id === 'external-references-and-grants' ? text.ackReferences : id === 'sessions-and-partial-failure' ? text.ackSessions : undefined; }
/** 服务清单和用户勾选必须恰好覆盖四项风险；重复、额外、缺项均拒绝。 */
export function databaseDropAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === databaseDropAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && databaseDropAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** Promise失败不是未执行证据；已发送但缺少完成证据时保留未知状态。 */
export function databaseDropFailure(progress: DatabaseDropProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.ddlCompleted) return progress.definitionVerified ? 'succeeded' : 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
