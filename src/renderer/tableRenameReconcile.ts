import type { WorkbenchDocument, WorkbenchTarget } from '../shared/workbench';
import type { TableRenameTarget } from '../shared/tableRename';
import type { WorkspaceTab } from './store';

/** 只匹配表页，绝不替换查询SQL中看起来像表名的文字。 */
export function tableRenameTabMatches(tab: WorkspaceTab, target: TableRenameTarget): boolean {
  return tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table;
}

/** 收藏只迁移已完整核验的精确表身份；自定义标签保留，新名称冲突交给人工处理。 */
export function reconcileTableRenameFavorites(document: WorkbenchDocument, before: TableRenameTarget, after: TableRenameTarget): { document: WorkbenchDocument; changed: boolean; conflict: boolean } {
  const matches = (target: WorkbenchTarget, expected: TableRenameTarget) => target.kind === 'table' && target.connectionId === expected.connectionId && target.database === expected.database && target.name === expected.table;
  const found = document.favorites.some(item => matches(item.target, before));
  if (!found) return { document, changed: false, conflict: false };
  if (document.favorites.some(item => matches(item.target, after))) return { document, changed: false, conflict: true };
  return { document: { ...document, favorites: document.favorites.map(item => matches(item.target, before) ? { ...item, label: item.label === before.table ? after.table : item.label, target: { ...item.target, name: after.table } as WorkbenchTarget } : item) }, changed: true, conflict: false };
}
