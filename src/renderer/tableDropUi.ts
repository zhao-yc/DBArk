import type { TableDropTarget } from '../shared/tableDrop';
import { tableDropZh as text } from './locales/tableDrop.zh-CN';
export { IndexRequestFence as TableDropRequestFence } from './indexPatches';
export { tableCommentFailure as tableDropFailure } from './tableCommentUi';
/** 精确元组匹配，不把同名异库或大小写不同的表当作同一目标。 */
export function sameTableDropTarget(a: TableDropTarget, b: TableDropTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 完成时仅关闭精确原目标的表标签；查询标签和同名异库目标不能被顺带关闭。 */
export function tableDropTabMatches(tab: { kind: string; connectionId?: string; database?: string; table?: string }, target: TableDropTarget): boolean {
  return tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table;
}
/** 仅识别固定三项风险，原型属性和未知字符串均不能授权。 */
export function tableDropAckLabel(id: string): string | undefined { return id === 'drop-structure-data' ? text.ackData : id === 'drop-implicit-commit' ? text.ackCommit : id === 'external-ddl-window' ? text.ackWindow : undefined; }
