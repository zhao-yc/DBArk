import type { TableAutoIncrementProgress, TableAutoIncrementTarget } from '../shared/tableAutoIncrement';
import type { TableAutoIncrementApplyOutput } from '../shared/tableAutoIncrement';
import { tableAutoIncrementAcknowledgements } from '../shared/tableAutoIncrement';
import { tableAutoIncrementZh as text } from './locales/tableAutoIncrement.zh-CN';
export { IndexRequestFence as TableAutoIncrementRequestFence } from './indexPatches';
/** 精确元组不折叠大小写，也不使用可能碰撞的分隔符。 */
export function sameTableAutoIncrementTarget(a: TableAutoIncrementTarget, b: TableAutoIncrementTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 只认识明确的确认项，原型属性名不能变成已授权风险。 */
export function tableAutoIncrementAckLabel(id: string): string | undefined { return id === 'ddl-implicit-commit' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : id === 'dml-counter-window' ? text.ackDml : undefined; }
/** 不允许重复、额外或未知确认；三项风险必须全部匹配服务端计划。 */
export function tableAutoIncrementAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === tableAutoIncrementAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && tableAutoIncrementAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** Promise失败不是未执行证据；只依据独立结构进度区分结果。 */
export function tableAutoIncrementFailure(progress: TableAutoIncrementProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'completedUnsettled' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.ddlCompleted) return progress.definitionVerified ? 'completedUnsettled' : 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
/** 完整核验回执必须同时吻合请求值、原生ID和结构状态；不接受自相矛盾的“成功”字段。 */
export function tableAutoIncrementResultMatches(result: TableAutoIncrementApplyOutput | null | undefined, value: string, tableId: string | undefined): boolean {
  if (!result || result.requestedValue !== value || result.ddlSubmitted !== true || result.ddlCompleted !== true || typeof result.definitionVerified !== 'boolean' || typeof result.structureVerified !== 'boolean' || !['matched', 'different', 'unverified'].includes(result.counterState)) return false;
  if (result.counterState === 'matched' && result.after?.value !== value || result.counterState === 'different' && (typeof result.after?.value !== 'string' || result.after.value === value)) return false;
  return !result.definitionVerified || !!tableId && result.structureVerified && result.counterState === 'matched' && result.after?.value === value && result.after.tableId === tableId;
}
