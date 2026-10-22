import type { ColumnInfo, FilterGroup, FilterMode, FilterRule } from '../shared/contracts';
import { copyFilterRules, FILTER_LIMITS, validateFilterGroup } from '../shared/filtering';
import type { DraftRow } from './dataChanges';
import { tableSelectedFilterZh as text } from './locales/tableSelectedFilter.zh-CN';

export interface TableSelectedFilterInput {
  columns: readonly ColumnInfo[]; rows: readonly DraftRow[]; visible: readonly string[];
  selection: { rowId: string; key: string } | undefined; selected: ReadonlySet<string>;
  conditions: { filters: readonly FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup }; exclude: boolean;
}
export interface TableSelectedFilterProposal {
  column: string; rowCount: number; values: readonly string[]; includesNull: boolean; exclude: boolean;
  filters: FilterRule[]; filterMode: FilterMode; filterGroup: FilterGroup;
}
const pageRows = 1000, metadataColumns = 4096;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/** 只读取自有数据属性，不执行当前格、原行或筛选上下文的访问器。 */
function own(value: unknown, key: string, optional = false): unknown {
  if (!value || typeof value !== 'object') throw Error(text.unavailable);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (optional && !(key in value)) return undefined; throw Error(text.unavailable); }
  if (!('value' in descriptor)) throw Error(text.unavailable);
  return descriptor.value;
}
/** 数组先核长度再逐索引复制；稀疏、getter及额外字段不能在校验中换值。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw Error(text.unavailable);
  const length = own(value, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) throw Error(text.unavailable);
  if (length > maximum) throw Error(text.budget);
  if (Reflect.ownKeys(value).length !== length + 1) throw Error(text.unavailable);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) result.push(own(value, String(index)));
  return result;
}
/** 使用Set原生端口，忽略调用方自定义size和迭代器，完整复制所有勾选身份。 */
function selectedIds(value: unknown): Set<string> {
  let size: number;
  try { size = setSize.call(value); } catch { throw Error(text.unavailable); }
  if (!Number.isSafeInteger(size) || size < 1) throw Error(text.unavailable);
  if (size > pageRows) throw Error(text.budget);
  const result = new Set<string>();
  for (const id of Set.prototype.values.call(value) as IterableIterator<unknown>) {
    if (typeof id !== 'string' || !id.length) throw Error(text.unavailable);
    result.add(id);
  }
  if (result.size !== size) throw Error(text.unavailable);
  return result;
}
/** 与单格手工筛选一致：保留精确字符串，布尔显式1/0，不推断日期或转换大整数。 */
function literal(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value);
  throw Error(text.unavailable);
}
/** 复用原全部条件与树准入；预算错误统一提示，不放宽停用叶或深层子组。 */
function checked(filters: readonly FilterRule[], mode: FilterMode, group?: FilterGroup): FilterGroup | undefined {
  try { return validateFilterGroup(filters, mode, group); }
  catch (reason) {
    const message = reason instanceof Error ? reason.message : '';
    throw Error(/不能超过|超过预算|最多16组、8层|集合必须包含 1～/.test(message) ? text.budget : text.unavailable);
  }
}
/** 返回独立且深冻结的提案；真正修改条件与重载页面仍由父表工作区负责。 */
export function buildTableSelectedFilter(input: TableSelectedFilterInput): TableSelectedFilterProposal {
  const columns = array(own(input, 'columns'), metadataColumns), rows = array(own(input, 'rows'), pageRows), visible = array(own(input, 'visible'), metadataColumns);
  const names = new Set<string>();
  for (const column of columns) {
    const name = own(column, 'name');
    if (typeof name !== 'string' || !name.length || name.length > 256 || names.has(name)) throw Error(text.unavailable);
    names.add(name);
  }
  const shown = new Set<string>();
  for (const key of visible) { if (typeof key !== 'string' || !names.has(key) || shown.has(key)) throw Error(text.unavailable); shown.add(key); }
  const selection = own(input, 'selection'), key = own(selection, 'key'), activeId = own(selection, 'rowId'), exclude = own(input, 'exclude');
  if (typeof key !== 'string' || !shown.has(key) || typeof activeId !== 'string' || !activeId.length || typeof exclude !== 'boolean') throw Error(text.unavailable);
  const selected = selectedIds(own(input, 'selected')), ids = new Set<string>(), values: string[] = [], distinct = new Set<string>();
  let includesNull = false, matched = 0;
  for (const row of rows) {
    const id = own(row, 'id');
    if (typeof id !== 'string' || !id.length || ids.has(id)) throw Error(text.unavailable);
    ids.add(id);
    if (!selected.has(id)) continue;
    if (own(row, 'inserted') !== false || own(row, 'deleted') !== false) throw Error(text.unavailable);
    const current = own(own(row, 'data'), key), original = own(own(row, 'original'), key);
    if (!Object.is(current, original)) throw Error(text.unavailable);
    const value = literal(original); matched++;
    if (value === null) includesNull = true;
    else if (!distinct.has(value)) {
      if (value.length > FILTER_LIMITS.valueLength || values.length >= FILTER_LIMITS.setValues) throw Error(text.budget);
      distinct.add(value); values.push(value);
    }
  }
  if (!ids.has(activeId) || matched !== selected.size) throw Error(text.unavailable);
  const conditions = own(input, 'conditions'), originalFilters = array(own(conditions, 'filters'), FILTER_LIMITS.conditions), mode = own(conditions, 'filterMode') as FilterMode;
  if (mode !== 'all' && mode !== 'any') throw Error(text.unavailable);
  let filters: FilterRule[];
  try { filters = copyFilterRules(originalFilters as FilterRule[]); }
  catch (reason) { const message = reason instanceof Error ? reason.message : ''; throw Error(/不能超过|集合必须包含 1～/.test(message) ? text.budget : text.unavailable); }
  const originalGroup = checked(filters, mode, own(conditions, 'filterGroup', true) as FilterGroup | undefined);
  if (filters.some(rule => !names.has(rule.column))) throw Error(text.unavailable);
  const children: number[] = [];
  if (values.length) { children.push(filters.length); filters.push({ column: key, operator: exclude ? 'NOT IN' : 'IN', values: [...values] }); }
  if (includesNull || exclude) { children.push(filters.length); filters.push({ column: key, operator: exclude ? includesNull ? 'IS NOT NULL' : 'IS NULL' : 'IS NULL' }); }
  const member: FilterGroup = { mode: values.length && (exclude ? !includesNull : includesNull) ? 'any' : 'all', children };
  let group: FilterGroup = member;
  if (originalFilters.length) {
    const before = originalGroup ?? { mode, children: filters.slice(0, originalFilters.length).map((_, index) => index) };
    // 旧AND根直接追加；旧OR整体包入AND，绝不让新值只约束其中一个旧分支。
    group = { mode: 'all', children: [...(before.mode === 'all' ? before.children : [before]), ...(member.mode === 'all' ? member.children : [member])] };
  }
  const validated = checked(filters, group.mode, group)!;
  for (const rule of filters) { if (rule.values) Object.freeze(rule.values); Object.freeze(rule); }
  Object.freeze(filters);
  return Object.freeze({ column: key, rowCount: matched, values: Object.freeze(values), includesNull, exclude, filters, filterMode: validated.mode, filterGroup: validated });
}
