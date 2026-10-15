import type { TableDefaultEncodingProgress, TableDefaultEncodingTarget, TableEncodingPair } from '../shared/tableDefaultEncoding';
import { tableDefaultEncodingAcknowledgements, sameTableEncodingPair } from '../shared/tableDefaultEncoding';
import { tableDefaultEncodingZh as text } from './locales/tableDefaultEncoding.zh-CN';
export { IndexRequestFence as TableDefaultEncodingRequestFence } from './indexPatches';
/** 精确元组不折叠大小写，不使用可碰撞分隔符。 */
export function sameTableDefaultEncodingTarget(a: TableDefaultEncodingTarget, b: TableDefaultEncodingTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 字符集改变后清空不匹配规则，必须明确选择真实候选，不能补服务器默认值。 */
export function changeDefaultCharset(current: TableEncodingPair, charset: string, candidates: readonly TableEncodingPair[]): TableEncodingPair {
  return { charset, collation: candidates.some(pair => pair.charset === charset && pair.collation === current.collation) ? current.collation : '' };
}
/** 选择能力只来自快照的完整真实配对，单边或伪造名称不能使预览按钮可用。 */
export function defaultEncodingSelectable(value: TableEncodingPair, candidates: readonly TableEncodingPair[]): boolean { return candidates.some(pair => sameTableEncodingPair(pair, value)); }
/** 未知ID和原型属性名不能成为已授权风险。 */
export function tableDefaultEncodingAckLabel(id: string): string | undefined { return id === 'ddl-implicit-commit' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : id === 'table-default-only' ? text.ackDefaults : undefined; }
/** 三项风险必须与实际计划精确一致，拒绝重复、额外或未知确认。 */
export function tableDefaultEncodingAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === tableDefaultEncodingAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && tableDefaultEncodingAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** Promise失败不代表未执行，只使用独立结构化进度作结论。 */
export function tableDefaultEncodingFailure(progress: TableDefaultEncodingProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' {
  if (!attempted) return 'notSent';
  if (progress?.ddlCompleted) return progress.definitionVerified ? 'succeeded' : 'verificationFailed';
  return progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown';
}
