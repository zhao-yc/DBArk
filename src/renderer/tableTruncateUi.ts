import type { TableTruncateTarget } from '../shared/tableTruncate';
import { tableTruncateZh as text } from './locales/tableTruncate.zh-CN';
export { IndexRequestFence as TableTruncateRequestFence } from './indexPatches';
export { tableCommentFailure as tableTruncateFailure } from './tableCommentUi';
/** 精确元组匹配，不把同名异库或大小写不同的表当作同一目标。 */
export function sameTableTruncateTarget(a: TableTruncateTarget, b: TableTruncateTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 仅识别固定三项风险，原型属性和未知字符串均不能授权。 */
export function tableTruncateAckLabel(id: string): string | undefined { return id === 'truncate-all-data' ? text.ackData : id === 'truncate-reset-auto-increment' ? text.ackCounter : id === 'external-ddl-window' ? text.ackWindow : undefined; }
