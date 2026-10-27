import type { DataRow, TableInfo } from '../shared/contracts';
import { parseTableDraftDocument, parseTableDraftPayload, type TableDraftDocument, type TableDraftPayload, type TableDraftTarget } from '../shared/tableDraft';
import { tableDraftZh as text } from '../shared/tableDraft.zh-CN';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { collectChanges, type DraftRow } from './dataChanges';

/** 独立草稿视图沿用原集中提交的事务表与可靠键约束。 */
function checkedInfo(target: TableDraftTarget, info: TableInfo): void {
  if (target.database !== info.database || target.table !== info.name) throw Error(text.changed);
  if (info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' || !info.editableKey.length) throw Error(text.readonly);
  const names = new Set(info.columns.map(column => column.name));
  if (names.size !== info.columns.length || info.editableKey.some(key => !names.has(key)) || new Set(info.editableKey).size !== info.editableKey.length) throw Error(text.readonly);
}

/** 文件不是服务器原行证明；这里只校验完整旧值和可赋值列，最终仍须独立复核与原提交链。 */
function checkedChanges(draft: TableDraftPayload, info: TableInfo): void {
  checkedInfo(draft.target, info);
  if (draft.metadataKey !== tableCopyMetadataKey(info)) throw Error(text.changed);
  const columns = new Map(info.columns.map(column => [column.name, column]));
  const assignment = (values: DataRow) => { if (Object.keys(values).some(key => !columns.has(key) || columns.get(key)!.generated)) throw Error(text.fields); };
  for (const change of draft.changes) {
    if (change.kind !== 'delete') assignment(change.values);
    if (change.kind === 'insert') continue;
    const keys = Object.keys(change.before);
    if (keys.length !== columns.size || keys.some(key => !columns.has(key)) || [...columns.keys()].some(key => !Object.hasOwn(change.before, key))) throw Error(text.incomplete);
    if (info.editableKey.some(key => change.before[key] === null || change.before[key] === undefined)) throw Error(text.incomplete);
  }
}

/** 仅保存已暂存的变化；不收集编辑器输入、不持久化整页或原会话令牌。 */
export function captureTableDraft(rows: DraftRow[], target: TableDraftTarget, info: TableInfo): TableDraftPayload {
  checkedInfo(target, info);
  const changes = collectChanges(rows);
  if (!changes.length) throw Error(text.noChanges);
  const result = parseTableDraftPayload({ target, metadataKey: tableCopyMetadataKey(info), changes });
  checkedChanges(result, info); return result;
}

/** 独立恢复视图不拼接当前分页；每条草稿领取新编号，完整旧值绝不被当前值取代。 */
export function restoreTableDraftRows(document: TableDraftDocument, info: TableInfo, newId: () => string): DraftRow[] {
  const draft = parseTableDraftDocument(document);
  checkedChanges(draft, info);
  const ids = new Set<string>();
  return draft.changes.map(change => {
    const id = newId();
    if (typeof id !== 'string' || !id || id.length > 200 || ids.has(id)) throw Error(text.ids);
    ids.add(id);
    if (change.kind === 'insert') return { id, data: change.values, inserted: true, deleted: false };
    const original = change.before;
    return { id, original, data: change.kind === 'update' ? { ...structuredClone(original), ...change.values } : structuredClone(original), inserted: false, deleted: change.kind === 'delete' };
  });
}
