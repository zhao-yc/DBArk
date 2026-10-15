import type { TableCommentProgress, TableCommentTarget } from '../shared/tableComment';
import { tableCommentAcknowledgements } from '../shared/tableComment';
import { tableCommentZh as text } from './locales/tableComment.zh-CN';
export { IndexRequestFence as TableCommentRequestFence } from './indexPatches';
/** 精确元组不折叠大小写，也不使用可能碰撞的分隔符。 */
export function sameTableCommentTarget(a: TableCommentTarget, b: TableCommentTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 只认识明确的确认项，原型属性名不能变成已授权风险。 */
export function tableCommentAckLabel(id: string): string | undefined { return id === 'ddl-implicit-commit' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : undefined; }
/** 不允许重复、额外或未知确认；两项风险必须全部匹配服务端计划。 */
export function tableCommentAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === tableCommentAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && tableCommentAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** Promise失败不是未执行证据；只依据独立结构进度区分结果。 */
export function tableCommentFailure(progress: TableCommentProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.ddlCompleted) return progress.definitionVerified ? 'succeeded' : 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
