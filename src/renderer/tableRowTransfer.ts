import type { TablePage } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { resultInsertZh as text } from './locales/resultInsert.zh-CN';
import { ResultInsertSourceIntent } from './resultInsertUi';
import { snapshotTablePageExport } from './tablePageExport';

/** 只冻结准确原页的勾选与可见列；来源授权始终由调用方的实时守卫决定。 */
export function createTableRowTransfer(page: TablePage, rows: readonly DraftRow[], visible: readonly string[], selected: ReadonlySet<string>, owner: string, guard: () => boolean): ResultInsertSourceIntent {
  try {
    // 开门前先核来源，空选和混入旧页身份都不能退回整页复制。
    if (guard() !== true || !selected.size || [...selected].some(id => !rows.some(row => row.id === id))) throw Error(text.stale);
    const data = snapshotTablePageExport(page, rows, visible, selected);
    const intent = new ResultInsertSourceIntent(data, true, owner, guard);
    // 克隆和校验期间来源也可能变化；快照本身不能延长原页授权。
    if (!intent.current()) throw Error(text.stale);
    return intent;
  } catch {
    // 不泄露原字段、底层校验或守卫异常，所有失败保持同一安全提示。
    throw Error(text.stale);
  }
}
