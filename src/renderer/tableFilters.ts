import type { FilterMode, FilterRule } from '../shared/contracts';
import { FILTER_LIMITS, validateFilterRules } from '../shared/filtering';
import { zh, formatText } from './locales/zh-CN';
import { tableFilterEnabledZh as enabledText } from './locales/tableFilterEnabled.zh-CN';

export type { FilterMode };
/** 与 table.page 的 IPC 页码上限保持一致；不据此虚构表的实际总页数。 */
export const maxTablePage = 10_000_000;
export interface FilterDraft {
  column: string; operator: FilterRule['operator']; value: string; upperValue: string; valuesText: string; includeEmptyString: boolean;
}
export const filterOperatorLabels: Record<FilterRule['operator'], string> = {
  '=': zh.table.filterEquals, '!=': zh.table.filterNotEquals, '>': zh.table.filterGreater, '>=': zh.table.filterGreaterOrEqual,
  '<': zh.table.filterLess, '<=': zh.table.filterLessOrEqual, LIKE: zh.table.filterLike, 'NOT LIKE': zh.table.filterNotLike,
  IN: zh.table.filterIn, 'NOT IN': zh.table.filterNotIn, BETWEEN: zh.table.filterBetween,
  'IS NULL': zh.table.filterIsNull, 'IS NOT NULL': zh.table.filterIsNotNull
};

/** 新条件从空文本开始；空集合不会被自动解释为一个空字符串。 */
export function emptyFilterDraft(column = ''): FilterDraft {
  return { column, operator: '=', value: '', upperValue: '', valuesText: '', includeEmptyString: false };
}

/** 集合按行分隔，保留逗号、前后空格、重复值和空行；额外空字符串由用户显式选择。 */
export function parseFilterSet(text: string, includeEmptyString = false): string[] {
  if (text.length > FILTER_LIMITS.totalCharacters) throw new Error(formatText(zh.table.filterTotalCharactersLimit, FILTER_LIMITS.totalCharacters));
  const values = text === '' ? [] : text.split(/\r\n|\r|\n/);
  if (includeEmptyString && !values.includes('')) values.push('');
  if (values.length === 0) throw new Error(zh.table.filterEmptySet);
  if (values.length > FILTER_LIMITS.setValues) throw new Error(formatText(zh.table.filterValuesLimit, FILTER_LIMITS.setValues));
  checkValueLengths(values);
  return values;
}

/** 只携带运算符需要的参数，防止从区间或集合切到空值条件后残留旧值。 */
export function filterRuleFromDraft(draft: FilterDraft, columns: readonly string[]): FilterRule {
  if (!columns.includes(draft.column)) throw new Error(zh.table.filterSelectColumn);
  const base = { column: draft.column, operator: draft.operator };
  if (draft.operator === 'IS NULL' || draft.operator === 'IS NOT NULL') return base;
  if (draft.operator === 'IN' || draft.operator === 'NOT IN') return { ...base, values: parseFilterSet(draft.valuesText, draft.includeEmptyString) };
  if (draft.operator === 'BETWEEN') { checkValueLengths([draft.value, draft.upperValue]); return { ...base, values: [draft.value, draft.upperValue] }; }
  checkValueLengths([draft.value]); return { ...base, value: draft.value };
}

/** 编辑时还原原始字符串；单独一个空字符串以显式勾选恢复，保证再次保存语义相同。 */
export function filterDraftFromRule(rule: FilterRule): FilterDraft {
  const draft = { ...emptyFilterDraft(rule.column), operator: rule.operator };
  if (rule.operator === 'IN' || rule.operator === 'NOT IN') return { ...draft, valuesText: (rule.values ?? []).join('\n'), includeEmptyString: rule.values?.length === 1 && rule.values[0] === '' };
  if (rule.operator === 'BETWEEN') return { ...draft, value: rule.values?.[0] ?? '', upperValue: rule.values?.[1] ?? '' };
  return { ...draft, value: rule.value ?? '' };
}

/** 新增与编辑共同校验总预算；保留其它条件对象，超限时不修改已应用规则。 */
export function replaceFilterRule(filters: readonly FilterRule[], rule: FilterRule, editing: number | null): FilterRule[] {
  if (editing !== null && (!Number.isInteger(editing) || editing < 0 || editing >= filters.length)) throw new Error(zh.table.filterConditionMissing);
  const next = editing === null ? [...filters, rule] : filters.map((current, index) => index === editing ? current.enabled === false && rule.enabled === undefined ? { ...rule, enabled: false } : rule : current);
  if (next.length > FILTER_LIMITS.conditions) throw new Error(formatText(zh.table.filterRulesLimit, FILTER_LIMITS.conditions));
  const values = next.flatMap(current => current.operator === 'IS NULL' || current.operator === 'IS NOT NULL' ? [] : current.values ?? [current.value ?? '']);
  if (values.length > FILTER_LIMITS.totalValues) throw new Error(formatText(zh.table.filterTotalValuesLimit, FILTER_LIMITS.totalValues));
  if (values.reduce((count, value) => count + value.length, 0) > FILTER_LIMITS.totalCharacters) throw new Error(formatText(zh.table.filterTotalCharactersLimit, FILTER_LIMITS.totalCharacters));
  return next;
}

/** 只改变启用位；恢复启用采用原省略形式，不转换空串、NULL判断或精确数字。 */
function withFilterEnabled(rule: FilterRule, enabled: boolean): FilterRule {
  const { enabled: previous, ...rest } = rule;
  return enabled ? rest : { ...rest, enabled: false };
}
/** 单条切换保留条件位置和其它对象；所有停用条件仍必须满足原共享预算。 */
export function setFilterRuleEnabled(filters: readonly FilterRule[], index: number, enabled: boolean): FilterRule[] {
  validateFilterRules(filters);
  if (typeof enabled !== 'boolean' || !Number.isInteger(index) || index < 0 || index >= filters.length) throw Error(enabledText.invalid);
  return filters.map((rule, position) => position === index ? withFilterEnabled(rule, enabled) : rule);
}
/** 批量切换一次交回父页，避免逐条读取；仅复制规则外壳，不重建原始值。 */
export function setAllFilterRulesEnabled(filters: readonly FilterRule[], enabled: boolean): FilterRule[] {
  validateFilterRules(filters);
  if (typeof enabled !== 'boolean') throw Error(enabledText.invalid);
  return filters.map(rule => withFilterEnabled(rule, enabled));
}

/** 标签只显示有界摘要，空字符串单独标识，防止大集合挤占整个工作区。 */
export function filterRuleSummary(rule: FilterRule): string {
  const label = `${rule.column} ${filterOperatorLabels[rule.operator]}`;
  if (rule.operator === 'IS NULL' || rule.operator === 'IS NOT NULL') return label;
  if (rule.operator === 'IN' || rule.operator === 'NOT IN') return `${label} · ${formatText(zh.table.filterSetSummary, rule.values?.length ?? 0)} · ${(rule.values ?? []).slice(0, 3).map(filterValueSummary).join(' / ')}`;
  if (rule.operator === 'BETWEEN') return `${label} ${filterValueSummary(rule.values?.[0] ?? '')} — ${filterValueSummary(rule.values?.[1] ?? '')}`;
  return `${label} ${filterValueSummary(rule.value ?? '')}`;
}

/** 直接跳页只接受十进制正整数，不接受指数、小数或超范围页码。 */
export function parsePageJump(text: string): number {
  const trimmed = text.trim(); const page = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(page) || page < 1 || page > maxTablePage) throw new Error(formatText(zh.table.pageJumpInvalid, maxTablePage));
  return page;
}

/** 所有输入作为字符串校验，不把大整数、小数或日期转换为 JavaScript 数值。 */
function checkValueLengths(values: readonly string[]): void {
  if (values.some(value => value.length > FILTER_LIMITS.valueLength)) throw new Error(formatText(zh.table.filterValueLengthLimit, FILTER_LIMITS.valueLength));
}

/** 引号用于区分真实逗号与分隔符，并显式显示空白文本的边界。 */
function filterValueSummary(value: string): string { return value === '' ? zh.table.filterEmptyString : JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value); }
