import type { SortRule } from '../shared/contracts';
import { sortRulesSchema } from '../shared/filtering';
import { tableSortZh as text } from './locales/tableSort.zh-CN';

/** 与正式分页契约共用形状；精确列名去重，不转换名称或拼接SQL。 */
export function validateTableSort(rules: readonly SortRule[], columns: readonly string[]): SortRule[] {
  const parsed = sortRulesSchema.safeParse(rules), names = new Set(columns);
  if (!parsed.success || names.size !== columns.length || parsed.data.some(rule => !names.has(rule.column)) || new Set(parsed.data.map(rule => rule.column)).size !== parsed.data.length) throw Error(text.invalid);
  return parsed.data;
}

/** 列头只提供方向；同一字段保留已明确的NULL位置，新增字段使用数据库默认，移除字段不留隐式规则。 */
export function tableSortFromGrid(next: readonly { columnKey: string; direction: SortRule['direction'] }[], previous: readonly SortRule[], columns: readonly string[]): SortRule[] {
  const original = new Map(validateTableSort(previous, columns).map(rule => [rule.column, rule]));
  return validateTableSort(next.map(rule => {
    const nulls = original.get(rule.columnKey)?.nulls;
    return { column: rule.columnKey, direction: rule.direction, ...(nulls === undefined ? {} : { nulls }) };
  }), columns);
}

/** 所有范围预览共用同一中文位置摘要；缺省规则保持旧显示文本，不暗示非NULL的比较规则。 */
export function tableSortRuleSummary(rule: SortRule): string {
  return `${rule.column} ${rule.direction}` + (rule.nulls === 'FIRST' ? ` · ${text.nullsFirst}` : rule.nulls === 'LAST' ? ` · ${text.nullsLast}` : '');
}
