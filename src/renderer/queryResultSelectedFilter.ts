import type { CellValue, DataRow, ResultColumn } from '../shared/contracts';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { captureQueryResultCellFilter } from './queryResultCellFilter';
import { queryResultFilterLimits, type QueryResultFilterGroup, type QueryResultFilterRule } from './queryResultFilter';
import { queryResultSelectedFilterZh as text } from './locales/queryResultSelectedFilter.zh-CN';

export interface QueryResultSelectedFilterCapture {
  readonly cell: Readonly<QueryResultCopyCell>;
  readonly indices: readonly number[];
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly values: readonly string[];
  readonly hasNull: boolean;
}
interface Binding {
  readonly columns: readonly ResultColumn[]; readonly rows: readonly DataRow[]; readonly columnRefs: readonly ResultColumn[];
  readonly metadata: readonly ResultColumn[]; readonly rowRefs: readonly DataRow[]; readonly indices: ReadonlySet<number>;
  readonly cell: QueryResultCopyCell; readonly selectedValues: readonly CellValue[]; invalid: boolean;
}
const bindings = new WeakMap<QueryResultSelectedFilterCapture, Binding>();
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/** 自有数据属性是唯一来源；不执行数组、元数据、当前格或原值上的getter。 */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') throw Error(text.unavailable);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.unavailable);
  return descriptor.value;
}
/** 有界数组逐个核自有索引，不调用输入数组迭代器或跳过稀疏项。 */
function array<T>(source: readonly T[], maximum: number, minimum = 0): T[] {
  if (!Array.isArray(source)) throw Error(text.unavailable);
  const length = own(source, 'length');
  if (!Number.isSafeInteger(length) || (length as number) < minimum) throw Error(text.unavailable);
  if ((length as number) > maximum) throw Error(text.budget);
  const result: T[] = [];
  for (let index = 0; index < (length as number); index++) result.push(own(source, String(index)) as T);
  return result;
}
/** Set内置端口只读真实成员，跳过自定义size/迭代器；捕获时固化显示顺序。 */
function positions(indices: ReadonlySet<number>, maximum: number): number[] {
  let size: number;
  try { size = setSize.call(indices); } catch { throw Error(text.unavailable); }
  if (!Number.isSafeInteger(size) || size < 1) throw Error(text.unavailable);
  if (size > queryResultFilterLimits.rows || size > maximum) throw Error(text.budget);
  const result: number[] = [];
  for (const index of Set.prototype.values.call(indices) as IterableIterator<number>) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= maximum) throw Error(text.unavailable);
    result.push(index);
  }
  return result.sort((left, right) => left - right);
}
/** 所有列均留身份与完整元数据，重复别名只作显示；定位只依赖唯一key。 */
function metadata(column: ResultColumn): ResultColumn {
  const key = own(column, 'key'), name = own(column, 'name'), type = own(column, 'type');
  if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string') throw Error(text.unavailable);
  if (key.length > 4096 || name.length > 4096 || type.length > 4096) throw Error(text.budget);
  return { key, name, type };
}

/** 勾选决定候选集合，当前格只指定列；逐原格复用现有类型往返，不读剪贴板或截断部分值。 */
export function captureQueryResultSelectedFilter(columns: readonly ResultColumn[], rows: readonly DataRow[], cell: QueryResultCopyCell | undefined, indices: ReadonlySet<number>): QueryResultSelectedFilterCapture {
  const columnRefs = array(columns, queryResultFilterLimits.columns, 1), rowRefs = array(rows, queryResultFilterLimits.rows, 1);
  const stamp = columnRefs.map(metadata);
  if (new Set(stamp.map(column => column.key)).size !== stamp.length || new Set(rowRefs).size !== rowRefs.length || rowRefs.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error(text.unavailable);
  const index = own(cell, 'index'), row = own(cell, 'row'), column = own(cell, 'column') as ResultColumn;
  if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= rowRefs.length || rowRefs[index as number] !== row) throw Error(text.unavailable);
  const columnIndex = columnRefs.indexOf(column);
  if (columnIndex < 0) throw Error(text.unavailable);
  const selected = positions(indices, rowRefs.length), admitted = stamp[columnIndex], values: string[] = [], literals = new Set<string>(), selectedValues: CellValue[] = [];
  let hasNull = false, units = 0;
  for (const selectedIndex of selected) {
    const selectedRow = rowRefs[selectedIndex];
    // 先核原格自有数据描述符；现有捕获器仅面对可信元数据副本及真实原行，不会读活动格值。
    const value = own(selectedRow, admitted.key) as CellValue;
    const captured = captureQueryResultCellFilter([admitted], rowRefs, { index: selectedIndex, row: selectedRow, column: admitted });
    if (!Object.is(value, captured.value)) throw Error(text.stale);
    selectedValues.push(value); units += captured.literal.length;
    if (units > queryResultFilterLimits.units) throw Error(text.budget);
    if (value === null) hasNull = true;
    else if (!literals.has(captured.literal)) { literals.add(captured.literal); values.push(captured.literal); }
    if (values.length + (hasNull ? 1 : 0) > queryResultFilterLimits.members) throw Error(text.budget);
  }
  const capture: QueryResultSelectedFilterCapture = Object.freeze({
    cell: Object.freeze({ index: index as number, row: row as DataRow, column }), indices: Object.freeze(selected),
    key: admitted.key, name: admitted.name, type: admitted.type, values: Object.freeze(values), hasNull
  });
  bindings.set(capture, { columns, rows, columnRefs, metadata: stamp, rowRefs, indices, cell: cell!, selectedValues, invalid: false });
  if (!currentQueryResultSelectedFilter(capture, columns, rows)) throw Error(text.stale);
  return capture;
}

/** 任一观测漂移永久撤销，原对象恢复也不能复活旧捕获；不冻结任何源行列或选择Set。 */
export function currentQueryResultSelectedFilter(capture: QueryResultSelectedFilterCapture, columns: readonly ResultColumn[], rows: readonly DataRow[]): boolean {
  const binding = bindings.get(capture);
  if (!binding || binding.invalid) return false;
  try {
    if (columns !== binding.columns || rows !== binding.rows) throw Error(text.stale);
    if (own(binding.cell, 'index') !== capture.cell.index || own(binding.cell, 'row') !== capture.cell.row || own(binding.cell, 'column') !== capture.cell.column) throw Error(text.stale);
    const columnRefs = array(columns, queryResultFilterLimits.columns, 1), rowRefs = array(rows, queryResultFilterLimits.rows, 1);
    if (columnRefs.length !== binding.columnRefs.length || rowRefs.length !== binding.rowRefs.length || columnRefs.some((column, index) => {
      if (column !== binding.columnRefs[index]) return true;
      const now = metadata(column), before = binding.metadata[index]; return now.key !== before.key || now.name !== before.name || now.type !== before.type;
    }) || rowRefs.some((row, index) => row !== binding.rowRefs[index])) throw Error(text.stale);
    const selected = positions(binding.indices, rowRefs.length);
    if (selected.length !== capture.indices.length || selected.some((index, position) => index !== capture.indices[position]) || selected.some((index, position) => !Object.is(own(rowRefs[index], capture.key), binding.selectedValues[position]))) throw Error(text.stale);
    return true;
  } catch { binding.invalid = true; return false; }
}

/** NULL与非NULL列表保持独立语义；混合时生成OR子组，由父级整体AND追加并审阅草稿。 */
export function queryResultSelectedFilterNode(capture: QueryResultSelectedFilterCapture): QueryResultFilterRule | QueryResultFilterGroup {
  const binding = bindings.get(capture);
  if (!binding || !currentQueryResultSelectedFilter(capture, binding.columns, binding.rows)) throw Error(text.stale);
  const nullable: QueryResultFilterRule = Object.freeze({ column: capture.key, operator: 'null', value: '' });
  if (!capture.values.length) return nullable;
  const member: QueryResultFilterRule = Object.freeze({ column: capture.key, operator: 'in', value: '', values: Object.freeze([...capture.values]) });
  return capture.hasNull ? Object.freeze({ mode: 'OR', children: Object.freeze([member, nullable]) }) : member;
}
