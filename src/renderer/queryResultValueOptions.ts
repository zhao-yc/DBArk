import type { CellValue, QueryResult, ResultColumn } from '../shared/contracts';
import type { QueryResultFilterGroup, QueryResultFilterRule } from '../shared/queryResultPresets';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultFilterKind, queryResultFilterLiteral } from './queryResultSort';
import { queryResultValueOptionsZh as text } from './locales/queryResultValueOptions.zh-CN';
import { captureSqliteResultFilterSource, type SqliteResultFilterSource } from './sqliteResultFilterSource';
import type { SqliteResultFilterType } from '../shared/sqliteResultStorage';

export const queryResultValueOptionsLimits = Object.freeze({ rows: 100000, columns: 1024, entries: 2000, members: 128, valueUnits: 4096, units: 8 * 1024 * 1024, textWork: 32 * 1024 * 1024 });
export interface QueryResultValueOption { readonly id: number; readonly literal: string | null; readonly count: number; readonly sqliteType?: SqliteResultFilterType; }
export interface QueryResultValueOptions { readonly column: Readonly<ResultColumn>; readonly entries: readonly QueryResultValueOption[]; readonly rows: number; }
export type QueryResultValueOptionsOrder = 'source' | 'count-desc' | 'count-asc';
type Key = ReturnType<typeof queryResultFilterKey>;
type Rows = readonly QueryResult['rows'][number][];
type Binding = { live: boolean; columns: readonly ResultColumn[]; rows: Rows; columnRefs: ResultColumn[]; metadata: ResultColumn[]; rowRefs: QueryResult['rows'][number][]; cells: CellValue[]; selected: ResultColumn; sqlite?: { identity: QueryResult; source: SqliteResultFilterSource; literals: readonly (string | null)[] }; };
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
  return entry.sqliteType ? text.sqliteValue(entry.literal!, entry.sqliteType) : text.value(entry.literal);
}
/** 从完整已返回行捕获不同值；整份超限或坏值即拒绝，不产生前 N 项候选。 */
export function captureQueryResultValueOptions(columns: readonly ResultColumn[], rows: Rows, column: ResultColumn, sqliteSource?: QueryResult): QueryResultValueOptions {
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
  const sqlite = selectedMeta.type === 'SQLITE';
  if (!sqlite && !queryResultFilterKind(selectedMeta) || sqlite && !sqliteSource) throw Error(text.unsupported);
  const source = sqlite ? captureSqliteResultFilterSource(sqliteSource, columns, rows) : undefined;
  const selectedColumn = selectedMeta, rowRefs: QueryResult['rows'][number][] = [], cells: CellValue[] = [], seenRows = new Set<object>();
  const entries: { id: number; literal: string | null; count: number; sqliteType?: SqliteResultFilterType }[] = [], sorted: { key: Key; id: number }[] = [], typedSeen = new Map<string, number>(), typedLiterals: (string | null)[] = [];
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
    if (source) {
      const typed = source.literal(index, selectedColumn.key), literal = value === null ? null : typed.literal;
      if (!Object.is(value, typed.value)) throw Error(text.stale);
      units += literal === null ? 1 : literal.length;
      if (units > queryResultValueOptionsLimits.units) throw Error(text.budget);
      cells.push(value); typedLiterals.push(literal);
      // 类型进入不同值身份；REAL的正负零沿实际比较等值，其余canonical原文无需数值转换。
      const identity = value === null ? 'null' : `${typed.sqliteType}:${typed.sqliteType === 'real' ? String(Number(literal)) : literal}`;
      const previous = typedSeen.get(identity);
      if (previous !== undefined) entries[previous].count++;
      else {
        if (entries.length >= queryResultValueOptionsLimits.entries) throw Error(text.budget);
        const id = entries.length; typedSeen.set(identity, id); entries.push({ id, literal, count: 1, ...(typed.sqliteType ? { sqliteType: typed.sqliteType } : {}) });
      }
      continue;
    }
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
  bindings.set(capture, { live: true, columns, rows, columnRefs, metadata: copied, rowRefs, cells, selected, ...(source ? { sqlite: { identity: sqliteSource!, source, literals: typedLiterals } } : {}) });
  if (!currentQueryResultValueOptions(capture, columns, rows)) throw Error(text.stale);
  return capture;
}
/** 原数组、全部列元数据、全部行位置及目标格任一漂移即永久失效；恢复原值也不复活。 */
export function currentQueryResultValueOptions(capture: QueryResultValueOptions, columns: readonly ResultColumn[], rows: Rows, sqliteSource?: QueryResult): boolean {
  const binding = bindings.get(capture);
  if (!binding?.live) return false;
  try {
    if (columns !== binding.columns || rows !== binding.rows || length(columns, queryResultValueOptionsLimits.columns) !== binding.columnRefs.length || length(rows, queryResultValueOptionsLimits.rows) !== binding.rowRefs.length) throw Error(text.stale);
    if (binding.sqlite && (sqliteSource && binding.sqlite.identity !== sqliteSource || !binding.sqlite.source.current())) throw Error(text.stale);
    for (let index = 0; index < binding.columnRefs.length; index++) {
      const reference = own(columns, String(index)), actual = metadata(reference), saved = binding.metadata[index];
      if (reference !== binding.columnRefs[index] || actual.key !== saved.key || actual.name !== saved.name || actual.type !== saved.type) throw Error(text.stale);
    }
    for (let index = 0; index < binding.rowRefs.length; index++) {
      const reference = own(rows, String(index));
      if (reference !== binding.rowRefs[index] || !Object.is(own(reference as object, capture.column.key), binding.cells[index])) throw Error(text.stale);
      if (binding.sqlite && binding.cells[index] !== null && typeof binding.cells[index] === 'object' && binding.sqlite.source.literal(index, capture.column.key).literal !== binding.sqlite.literals[index]) throw Error(text.stale);
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
  const seen = new Set<number>(), values: string[] = [], groups = new Map<SqliteResultFilterType, string[]>(); let nullable = false;
  for (let index = 0; index < count; index++) {
    const id = own(ids, String(index));
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || Object.is(id, -0) || id >= capture.entries.length || seen.has(id)) throw Error(text.selection);
    seen.add(id); const entry = capture.entries[id], literal = entry.literal;
    if (literal === null) nullable = true; else values.push(literal);
    if (entry.sqliteType && literal !== null) { let group = groups.get(entry.sqliteType); if (!group) { group = []; groups.set(entry.sqliteType, group); } group.push(literal); }
  }
  /** 输出仅包含原共享契约字段，冻结自有树与成员数组。 */
  const rule = (operator: QueryResultFilterRule['operator']): QueryResultFilterRule => Object.freeze({ column: capture.column.key, operator, value: '', ...(operator === 'in' || operator === 'notIn' ? { values: Object.freeze(values) } : {}) });
  if (!values.length) return rule(mode === 'include' ? 'null' : 'notNull');
  if (capture.column.type === 'SQLITE') {
    /** 排除混合类型用各类型补集的AND；未勾NULL时单独保留NULL，不能遗漏其它存储类。 */
    const group = (mode: 'AND' | 'OR', children: readonly (QueryResultFilterRule | QueryResultFilterGroup)[]): QueryResultFilterRule | QueryResultFilterGroup => children.length === 1 ? children[0] : Object.freeze({ mode, children: Object.freeze(children) });
    const typed = [...groups].map(([sqliteType, values]) => Object.freeze({ column: capture.column.key, operator: mode === 'include' ? 'in' as const : 'notIn' as const, value: '', values: Object.freeze(values), sqliteType }));
    if (mode === 'include') return group('OR', [...typed, ...(nullable ? [rule('null')] : [])]);
    const complements = typed.map(leaf => group('OR', [leaf, Object.freeze({ column: capture.column.key, operator: 'notType' as const, value: '', sqliteType: leaf.sqliteType })]));
    const nonnull = group('AND', complements);
    return nullable ? nonnull : group('OR', [nonnull, rule('null')]);
  }
  if (mode === 'include' && !nullable) return rule('in');
  return Object.freeze({ mode: mode === 'include' || !nullable ? 'OR' : 'AND', children: Object.freeze([rule(mode === 'include' ? 'in' : 'notIn'), rule(mode === 'include' || !nullable ? 'null' : 'notNull')]) });
}
/** 仅搜索标签和原字面值；完整返回编号供界面分页，搜索预算失败不返回部分结果。 */
export function searchQueryResultValueOptions(capture: QueryResultValueOptions, query: string, order: QueryResultValueOptionsOrder = 'source'): readonly number[] {
  current(capture);
  if (order !== 'source' && order !== 'count-desc' && order !== 'count-asc') throw Error(text.invalid);
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
  const matches = prepared.filter(entry => entry.label.includes(needle) || entry.literal.includes(needle));
  // 对完整匹配集合排序后再交给界面分页；只移动编号，不改原候选、精确字面值或勾选身份。
  if (order !== 'source') matches.sort((left, right) => (order === 'count-desc' ? -1 : 1) * (capture.entries[left.id].count - capture.entries[right.id].count) || left.id - right.id);
  return Object.freeze(matches.map(entry => entry.id));
}
