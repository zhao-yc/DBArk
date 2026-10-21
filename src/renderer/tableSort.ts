import type { SortRule } from '../shared/contracts';
import { sortRulesSchema } from '../shared/filtering';
import { tableSortZh as text } from './locales/tableSort.zh-CN';

/** 与正式分页契约共用形状；精确列名去重，不转换名称或拼接SQL。 */
export function validateTableSort(rules: readonly SortRule[], columns: readonly string[]): SortRule[] {
  const parsed = sortRulesSchema.safeParse(rules), names = new Set(columns);
  if (!parsed.success || names.size !== columns.length || parsed.data.some(rule => !names.has(rule.column)) || new Set(parsed.data.map(rule => rule.column)).size !== parsed.data.length) throw Error(text.invalid);
  return parsed.data;
}
