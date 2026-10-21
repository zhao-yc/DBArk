import type { ColumnInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { emptyFilterDraft, filterRuleFromDraft, type FilterDraft } from './tableFilters';
import { tableCellFilterZh as text } from './locales/tableCellFilter.zh-CN';

/** 只复制已加载原格的标量；不读getter、不把二进制当文本、不把精确字符串转为数值。 */
export function tableCellFilterDraft(columns: readonly ColumnInfo[], rows: readonly DraftRow[], visible: readonly string[], selection: { rowId: string; key: string } | undefined, exclude = false): FilterDraft {
  if (!selection || !visible.includes(selection.key) || columns.filter(column => column.name === selection.key).length !== 1) throw Error(text.unavailable);
  const matches = rows.filter(row => row.id === selection.rowId), row = matches.length === 1 ? matches[0] : undefined;
  if (!row || row.inserted || row.deleted || !row.original) throw Error(text.unavailable);
  const value = Object.getOwnPropertyDescriptor(row.data, selection.key), original = Object.getOwnPropertyDescriptor(row.original, selection.key);
  if (!value || !original || !('value' in value) || !('value' in original) || !Object.is(value.value, original.value)) throw Error(text.unavailable);
  const cell: unknown = value.value;
  if (cell !== null && typeof cell !== 'string' && typeof cell !== 'boolean' && typeof cell !== 'number' || typeof cell === 'number' && (!Number.isFinite(cell) || Number.isInteger(cell) && !Number.isSafeInteger(cell))) throw Error(text.unavailable);
  const draft: FilterDraft = { ...emptyFilterDraft(selection.key), operator: cell === null ? exclude ? 'IS NOT NULL' : 'IS NULL' : exclude ? '!=' : '=', value: cell === null ? '' : typeof cell === 'boolean' ? cell ? '1' : '0' : String(cell) };
  // 复用正式手工条件的单值预算及字段准入；这里不修改既有条件、不创建SQL。
  filterRuleFromDraft(draft, columns.map(column => column.name));
  return draft;
}
