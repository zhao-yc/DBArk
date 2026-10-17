import type { TableCopyDataProgress, TableCopyDataTarget } from '../shared/tableCopyData';
import { tableCopyDataAcknowledgements } from '../shared/tableCopyData';
import { tableCopyDataZh as text } from './locales/tableCopyData.zh-CN';
export { IndexRequestFence as TableCopyDataRequestFence } from './indexPatches';
/** 精确元组不折叠大小写，也不使用可能碰撞的分隔符。 */
export function sameTableCopyDataTarget(a: TableCopyDataTarget, b: TableCopyDataTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 只认识明确的确认项，原型属性名不能变成已授权风险。 */
export function tableCopyDataAckLabel(id: string): string | undefined { return id === 'ddl-and-data-separate' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : id === 'copy-data-scope' ? text.ackScope : id === 'execution-snapshot' ? text.ackSnapshot : id === 'retain-unknown' ? text.ackRetain : undefined; }
/** 五项用途专属风险须精确匹配，不接受空表确认、额外或重复项。 */
export function tableCopyDataAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === tableCopyDataAcknowledgements.length && selected.size === required.length && new Set(required).size === required.length && tableCopyDataAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** 建表已完成不能推断数据已提交；丢失进度或提交ACK一律保留未知。 */
export function tableCopyDataFailure(progress: TableCopyDataProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.dataCompleted) return progress.definitionVerified ? 'succeeded' : 'verificationFailed';
  if (progress?.ddlCompleted) return 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
/** 仅依据可信阶段事实展示；INSERT成功或建表成功都不能代替提交ACK。 */
export function tableCopyDataStage(progress: TableCopyDataProgress): string {
  return progress.dataCompleted ? text.dataCommitted : progress.commitSubmitted ? text.commitUnknown : progress.insertCompleted ? text.insertFinished : progress.dataSubmitted ? text.dataInFlight : progress.ddlCompleted ? text.created : progress.ddlSubmitted ? text.createInFlight : text.notSent;
}
