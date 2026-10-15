import type { TableRenameProgress, TableRenameTarget } from '../shared/tableRename';
import { tableRenameAcknowledgements } from '../shared/tableRename';
import { tableRenameZh as text } from './locales/tableRename.zh-CN';
export { IndexRequestFence as TableRenameRequestFence } from './indexPatches';
/** 精确元组不折叠大小写，也不使用可能碰撞的分隔符。 */
export function sameTableRenameTarget(a: TableRenameTarget, b: TableRenameTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 只认识明确的确认项，原型属性名不能变成已授权风险。 */
export function tableRenameAckLabel(id: string): string | undefined { return id === 'ddl-implicit-commit' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : id === 'references-and-grants' ? text.ackReferences : undefined; }
/** 不允许重复、额外或未知确认；三项风险必须全部匹配服务端计划。 */
export function tableRenameAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === tableRenameAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && tableRenameAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** Promise失败不是未执行证据；只依据独立结构进度区分结果。 */
export function tableRenameFailure(progress: TableRenameProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.ddlCompleted) return progress.definitionVerified ? 'succeeded' : 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
