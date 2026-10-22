import type { CellValue, QueryResult, ResultColumn } from '../shared/contracts';
import type { QueryResultFilterGroup, QueryResultFilterRule } from '../shared/queryResultPresets';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultFilterKind, queryResultFilterLiteral } from './queryResultSort';
import { queryResultValueOptionsZh as text } from './locales/queryResultValueOptions.zh-CN';

export const queryResultValueOptionsLimits = Object.freeze({ rows: 100000, columns: 1024, entries: 2000, members: 128, valueUnits: 4096, units: 8 * 1024 * 1024, textWork: 32 * 1024 * 1024 });
export interface QueryResultValueOption { readonly id: number; readonly literal: string | null; readonly count: number; }
export interface QueryResultValueOptions { readonly column: Readonly<ResultColumn>; readonly entries: readonly QueryResultValueOption[]; readonly rows: number; }
type Key = ReturnType<typeof queryResultFilterKey>;
type Rows = readonly QueryResult['rows'][number][];
type Binding = { live: boolean; columns: readonly ResultColumn[]; rows: Rows; columnRefs: ResultColumn[]; metadata: ResultColumn[]; rowRefs: QueryResult['rows'][number][]; cells: CellValue[]; selected: ResultColumn; };
const bindings = new WeakMap<QueryResultValueOptions, Binding>();

/** 只接受自有数据属性；拒绝稀疏数组和访问器，不触发源对象 getter。 */
function own(source: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}
/** 长度先准入再遍历，不能靠稀疏数组隐藏超过预算的后部内容。 */
function length(source: unknown, maximum: number): number {
  if (!Array.isArray(source)) throw Error(text.invalid);
  const count = own(source, 'length');
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw Error(text.invalid);
  if (count > maximum) throw Error(text.budget);
  return count;
}
/** 元数据逐项复制，不展开源对象，不读取额外业务属性。 */
function metadata(source: unknown): ResultColumn {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error(text.invalid);
  const key = own(source, 'key'), name = own(source, 'name'), type = own(source, 'type');
  if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string') throw Error(text.invalid);
  if ([key, name, type].some(value => value.length > queryResultValueOptionsLimits.valueUnits)) throw Error(text.budget);
  return { key, name, type };
}
/** 比较预算按原精确键长度收费，不把长十进制或时间转成浮点数。 */
function keyUnits(key: Key): number {
  return key === null || typeof key === 'number' ? 1 : typeof key === 'string' ? key.length : key.whole.length + key.fraction.length + 1;
}
/** NULL 和空串使用独立显示标签，文本 NULL 仍保留真实原文。 */
export function queryResultValueOptionLabel(entry: QueryResultValueOption): string {
  return text.value(entry.literal);
}
/** 从完整已返回行捕获不同值；整份超限或坏值即拒绝，不产生前 N 项候选。 */
export function captureQueryResultValueOptions(columns: readonly ResultColumn[], rows: Rows, column: ResultColumn): QueryResultValueOptions {
  const columnCount = length(columns, queryResultValueOptionsLimits.columns), rowCount = length(rows, queryResultValueOptionsLimits.rows);
  if (!columnCount) throw Error(text.invalid);
  const columnRefs: ResultColumn[] = [], copied: ResultColumn[] = [], keys = new Set<string>();
  let selected: ResultColumn | undefined, selectedMeta: ResultColumn | undefined, units = 0, work = 0;
  for (let index = 0; index < columnCount; index++) {
    const reference = own(columns, String(index)) as ResultColumn, item = metadata(reference);
    if (keys.has(item.key)) throw Error(text.invalid);
    keys.add(item.key); columnRefs.push(reference); copied.push(item);
    units += item.key.length + item.name.length + item.type.length;
    if (units > queryResultValueOptionsLimits.units) throw Error(text.budget);
    if (reference === column) { selected = reference; selectedMeta = item; }
  }
  if (!selected || !selectedMeta) throw Error(text.invalid);
  if (!queryResultFilterKind(selectedMeta)) throw Error(text.unsupported);
  const selectedColumn = selectedMeta, rowRefs: QueryResult['rows'][number][] = [], cells: CellValue[] = [], seenRows = new Set<object>();
  const entries: { id: number; literal: string | null; count: number }[] = [], sorted: { key: Key; id: number }[] = [];
  /** 键比较复用原比较器；二分索引避免行数乘候选总数的线性扫描。 */
  function compare(left: Key, right: Key): number {
    work += keyUnits(left) + keyUnits(right);
    if (work > queryResultValueOptionsLimits.textWork) throw Error(text.budget);
    return compareQueryResultFilterKeys(left, right);
  }
  for (let index = 0; index < rowCount; index++) {
    const row = own(rows, String(index)) as QueryResult['rows'][number];
    if (!row || typeof row !== 'object' || Array.isArray(row) || seenRows.has(row)) throw Error(text.invalid);
    seenRows.add(row); rowRefs.push(row);
    const value = own(row, selectedColumn.key) as CellValue;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw Error(text.unsupported);
    const literal = value === null ? null : String(value);
    if (literal !== null && literal.length > queryResultValueOptionsLimits.valueUnits) throw Error(text.budget);
    units += literal === null ? 1 : literal.length;
    if (units > queryResultValueOptionsLimits.units) throw Error(text.budget);
    let key: Key;
    try {
      key = queryResultFilterKey(selectedColumn, value);
      if (literal !== null && compare(key, queryResultFilterKey(selectedColumn, queryResultFilterLiteral(selectedColumn, literal))) !== 0) throw Error(text.unsupported);
    } catch (reason) {
      if (reason instanceof Error && reason.message === text.budget) throw reason;
      throw Error(text.unsupported);
    }
    cells.push(value);
    let left = 0, right = sorted.length;
    while (left < right) { const middle = (left + right) >>> 1; if (compare(sorted[middle].key, key) < 0) left = middle + 1; else right = middle; }
    if (left < sorted.length && compare(sorted[left].key, key) === 0) entries[sorted[left].id].count++;
    else {
      if (entries.length >= queryResultValueOptionsLimits.entries) throw Error(text.budget);
      const id = entries.length;
      entries.push({ id, literal, count: 1 }); sorted.splice(left, 0, { key, id });
    }
  }
  const capture: QueryResultValueOptions = Object.freeze({ column: Object.freeze({ ...selectedColumn }), entries: Object.freeze(entries.map(entry => Object.freeze(entry))), rows: rowCount });
  bindings.set(capture, { live: true, columns, rows, columnRefs, metadata: copied, rowRefs, cells, selected });
  if (!currentQueryResultValueOptions(capture, columns, rows)) throw Error(text.stale);
  return capture;
}
/** 原数组、全部列元数据、全部行位置及目标格任一漂移即永久失效；恢复原值也不复活。 */
export function currentQueryResultValueOptions(capture: QueryResultValueOptions, columns: readonly ResultColumn[], rows: Rows): boolean {
  const binding = bindings.get(capture);
  if (!binding?.live) return false;
  try {
    if (columns !== binding.columns || rows !== binding.rows || length(columns, queryResultValueOptionsLimits.columns) !== binding.columnRefs.length || length(rows, queryResultValueOptionsLimits.rows) !== binding.rowRefs.length) throw Error(text.stale);
    for (let index = 0; index < binding.columnRefs.length; index++) {
      const reference = own(columns, String(index)), actual = metadata(reference), saved = binding.metadata[index];
      if (reference !== binding.columnRefs[index] || actual.key !== saved.key || actual.name !== saved.name || actual.type !== saved.type) throw Error(text.stale);
    }
    for (let index = 0; index < binding.rowRefs.length; index++) {
      const reference = own(rows, String(index));
      if (reference !== binding.rowRefs[index] || !Object.is(own(reference as object, capture.column.key), binding.cells[index])) throw Error(text.stale);
    }
    return true;
  } catch { binding.live = false; return false; }
}
/** 后续操作必须再次核原对象；伪造或克隆捕获没有私有绑定。 */
function current(capture: QueryResultValueOptions): void {
  const binding = bindings.get(capture);
  if (!binding || !currentQueryResultValueOptions(capture, binding.columns, binding.rows)) throw Error(text.stale);
}
/** 将明确编号转换为原筛选树；排除模式保留完整 NULL 补集，不执行 SQL。 */
export function queryResultValueOptionsNode(capture: QueryResultValueOptions, ids: readonly number[], mode: 'include' | 'exclude'): QueryResultFilterRule | QueryResultFilterGroup {
  current(capture);
  if (mode !== 'include' && mode !== 'exclude') throw Error(text.invalid);
  const count = length(ids, queryResultValueOptionsLimits.members);
  if (!count) throw Error(text.selection);
  const seen = new Set<number>(), values: string[] = []; let nullable = false;
  for (let index = 0; index < count; index++) {
    const id = own(ids, String(index));
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || Object.is(id, -0) || id >= capture.entries.length || seen.has(id)) throw Error(text.selection);
    seen.add(id); const literal = capture.entries[id].literal;
    if (literal === null) nullable = true; else values.push(literal);
  }
  /** 输出仅包含原共享契约字段，冻结自有树与成员数组。 */
  const rule = (operator: QueryResultFilterRule['operator']): QueryResultFilterRule => Object.freeze({ column: capture.column.key, operator, value: '', ...(operator === 'in' || operator === 'notIn' ? { values: Object.freeze(values) } : {}) });
  if (!values.length) return rule(mode === 'include' ? 'null' : 'notNull');
  if (mode === 'include' && !nullable) return rule('in');
  return Object.freeze({ mode: mode === 'include' || !nullable ? 'OR' : 'AND', children: Object.freeze([rule(mode === 'include' ? 'in' : 'notIn'), rule(mode === 'include' || !nullable ? 'null' : 'notNull')]) });
}
/** 仅搜索标签和原字面值；完整返回编号供界面分页，搜索预算失败不返回部分结果。 */
export function searchQueryResultValueOptions(capture: QueryResultValueOptions, query: string): readonly number[] {
  current(capture);
  if (typeof query !== 'string') throw Error(text.invalid);
  if (query.length > queryResultValueOptionsLimits.valueUnits) throw Error(text.searchBudget);
  const needle = query.toLowerCase();
  if (needle.length > queryResultValueOptionsLimits.valueUnits) throw Error(text.searchBudget);
  let work = needle.length;
  const prepared = capture.entries.map(entry => {
    const label = queryResultValueOptionLabel(entry).toLowerCase(), literal = entry.literal?.toLowerCase() ?? '';
    work += (label.length + literal.length + 2) * Math.max(1, needle.length);
    if (work > queryResultValueOptionsLimits.textWork) throw Error(text.searchBudget);
    return { id: entry.id, label, literal };
  });
  return Object.freeze(prepared.filter(entry => entry.label.includes(needle) || entry.literal.includes(needle)).map(entry => entry.id));
}
