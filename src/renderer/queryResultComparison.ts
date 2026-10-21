import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultFilterKey, queryResultSortKind } from './queryResultSort';
import { queryResultComparisonZh as text } from './locales/queryResultComparison.zh-CN';

export const queryResultComparisonLimits = { rows: 100000, columns: 1024, cells: 2000000, units: 16 * 1024 * 1024, valueUnits: 4096, keys: 8, batchRows: 512, batchUnits: 32768 } as const;
export interface QueryResultComparisonCapture {
  readonly columns: readonly Readonly<ResultColumn>[]; readonly keys: readonly string[];
  readonly leftCount: number; readonly rightCount: number; readonly leftTruncated: boolean; readonly rightTruncated: boolean;
}
export interface QueryResultComparisonRow {
  readonly kind: 'added' | 'removed' | 'changed' | 'equal'; readonly leftIndex?: number; readonly rightIndex?: number; readonly changedColumns: readonly string[];
}
export type ComparisonRow = QueryResultComparisonRow;
export interface QueryResultComparisonResult {
  readonly added: number; readonly removed: number; readonly changed: number; readonly equal: number; readonly rows: readonly QueryResultComparisonRow[];
}
export interface QueryResultComparisonValue { readonly column: string; readonly name: string; readonly left?: CellValue; readonly right?: CellValue; readonly changed: boolean; }
interface Source {
  result: QueryResult; columns: readonly ResultColumn[]; columnRefs: readonly ResultColumn[]; rows: readonly DataRow[]; rowRefs: readonly DataRow[];
  raw: readonly (readonly CellValue[])[]; values: readonly (readonly CellValue[])[]; units: readonly number[]; truncated: boolean;
}
interface Binding { left: Source; right: Source; metadata: readonly ResultColumn[]; keyIndices: readonly number[]; binaryPrototypes: WeakMap<object, object | null>; invalid: boolean; }
interface Owner { capture?: QueryResultComparisonCapture; active: boolean; }
const bindings = new WeakMap<QueryResultComparisonCapture, Binding>();
const rowOwners = new WeakMap<QueryResultComparisonRow, Owner>();

/** 不执行源对象访问器；原值、数组索引和完整元数据都只读自有数据描述符。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.identity);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.identity);
  return descriptor.value;
}
/** 逐个检查有界数组，拒绝稀疏项或自定义迭代器造成的漏检。 */
function array<T>(value: readonly T[], maximum: number, minimum = 0): T[] {
  if (!Array.isArray(value)) throw Error(text.identity);
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || (length as number) < minimum) throw Error(text.identity);
  if ((length as number) > maximum) throw Error(text.budget);
  const items: T[] = [];
  for (let index = 0; index < (length as number); index++) items.push(own(value, String(index)) as T);
  return items;
}
/** 只复制协议的三项元数据；显示名称可重复，唯一内部key才是列身份。 */
function metadata(column: ResultColumn): Readonly<ResultColumn> {
  const key = own(column, 'key'), name = own(column, 'name'), type = own(column, 'type');
  if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string') throw Error(text.identity);
  if (key.length > 4096 || name.length > 4096 || type.length > 4096) throw Error(text.budget);
  return Object.freeze({ key, name, type });
}
/** 浮点和全部字节别名不能作键；分类沿原比较器，不从值外观猜测。 */
export function queryResultComparisonKeyReason(column: ResultColumn): string | undefined {
  try {
    const admitted = metadata(column), kind = queryResultSortKind(admitted.type);
    return !kind || kind === 'float' || /^(?:TINY_|MEDIUM_|LONG_)?BLOB(?:\b|$)/i.test(admitted.type.trim()) ? text.keyUnsupported : undefined;
  } catch (reason) { return reason instanceof Error && reason.message === text.budget ? text.budget : text.identity; }
}
/** 二进制只按明确包装和base64原文比较，不解码，也不序列化未知对象。 */
function binary(value: unknown): value is { type: 'binary'; base64: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 2 && keys.includes('type') && keys.includes('base64') && own(value, 'type') === 'binary' && typeof own(value, 'base64') === 'string';
}
/** 自有不可变快照仅含CellValue；原行与原字节对象始终保持可变，不被冻结。 */
function snapshot(value: unknown, charge: (length: number) => void, prototypes: WeakMap<object, object | null>): CellValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error(text.value); return value; }
  if (typeof value === 'string') { charge(value.length); return value; }
  if (!binary(value)) throw Error(text.value);
  const base64 = own(value, 'base64') as string; charge(base64.length); prototypes.set(value, Object.getPrototypeOf(value));
  return Object.freeze({ type: 'binary' as const, base64 });
}
/** 非键列比较严格返回表示；0与-0相同，字节只比较明确base64字段。 */
function equal(left: CellValue, right: CellValue): boolean {
  if (left === right) return true;
  return !!left && !!right && typeof left === 'object' && typeof right === 'object' && left.base64 === right.base64;
}
/** 捕获时先校结构与合计格数，再复制全部值，避免预算外的大表先分配单元格快照。 */
export function captureQueryResultComparison(left: QueryResult, right: QueryResult, keys: readonly string[]): QueryResultComparisonCapture {
  const leftColumns = own(left, 'columns') as ResultColumn[], rightColumns = own(right, 'columns') as ResultColumn[];
  const leftRefs = array(leftColumns, queryResultComparisonLimits.columns, 1), rightRefs = array(rightColumns, queryResultComparisonLimits.columns, 1);
  const columns = leftRefs.map(metadata), rightMetadata = rightRefs.map(metadata);
  if (columns.length !== rightMetadata.length || new Set(columns.map(column => column.key)).size !== columns.length || rightMetadata.some((column, index) => column.key !== columns[index].key || column.name !== columns[index].name || column.type !== columns[index].type)) throw Error(text.identity);
  const keyRefs = array(keys, queryResultComparisonLimits.keys, 1);
  if (keyRefs.some(key => typeof key !== 'string') || new Set(keyRefs).size !== keyRefs.length) throw Error(text.selectKeys);
  const keyIndices = keyRefs.map(key => columns.findIndex(column => column.key === key));
  if (keyIndices.some(index => index < 0)) throw Error(text.selectKeys);
  for (const index of keyIndices) { const reason = queryResultComparisonKeyReason(columns[index]); if (reason) throw Error(reason); }
  const leftRows = own(left, 'rows') as DataRow[], rightRows = own(right, 'rows') as DataRow[];
  const leftRowRefs = array(leftRows, queryResultComparisonLimits.rows), rightRowRefs = array(rightRows, queryResultComparisonLimits.rows);
  if ((leftRowRefs.length + rightRowRefs.length) * columns.length > queryResultComparisonLimits.cells) throw Error(text.budget);
  const prototypes = new WeakMap<object, object | null>(); let units = 0;
  /** 一侧构造只读取原格，不读SQL、耗时或其它可能的外部属性。 */
  function source(result: QueryResult, columnArray: ResultColumn[], refs: ResultColumn[], rows: DataRow[], rowRefs: DataRow[], side: 'left' | 'right'): Source {
    const truncated = own(result, 'truncated');
    if (typeof truncated !== 'boolean' || new Set(rowRefs).size !== rowRefs.length || rowRefs.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error(text.identity);
    const raw: (readonly CellValue[])[] = [], values: (readonly CellValue[])[] = [], rowUnits: number[] = [];
    for (const row of rowRefs) {
      const original: CellValue[] = [], copied: CellValue[] = []; let currentUnits = 0;
      const charge = (length: number) => { if (length > queryResultComparisonLimits.valueUnits) throw Error(text.budget); units += length; currentUnits += length; if (units > queryResultComparisonLimits.units) throw Error(text.budget); };
      for (let index = 0; index < columns.length; index++) {
        try {
          const value = own(row, columns[index].key); copied.push(snapshot(value, charge, prototypes)); original.push(value as CellValue);
        } catch (reason) {
          if (keyIndices.includes(index) && !(reason instanceof Error && reason.message === text.budget)) throw Error(text.keyInvalid(side));
          throw reason;
        }
      }
      raw.push(Object.freeze(original)); values.push(Object.freeze(copied)); rowUnits.push(currentUnits);
    }
    return { result, columns: columnArray, columnRefs: refs, rows, rowRefs, raw: Object.freeze(raw), values: Object.freeze(values), units: Object.freeze(rowUnits), truncated };
  }
  const capture = Object.freeze({ columns: Object.freeze(columns), keys: Object.freeze(keyRefs), leftCount: leftRowRefs.length, rightCount: rightRowRefs.length, leftTruncated: own(left, 'truncated') as boolean, rightTruncated: own(right, 'truncated') as boolean });
  const binding: Binding = { left: source(left, leftColumns, leftRefs, leftRows, leftRowRefs, 'left'), right: source(right, rightColumns, rightRefs, rightRows, rightRowRefs, 'right'), metadata: columns, keyIndices: Object.freeze(keyIndices), binaryPrototypes: prototypes, invalid: false };
  bindings.set(capture, binding);
  if (!currentQueryResultComparison(capture, left, right)) throw Error(text.stale);
  return capture;
}
/** 每批只核固定列结构和数组长度，不反复扫描全部行而退化为平方复杂度。 */
function structure(source: Source, binding: Binding): boolean {
  if (own(source.result, 'columns') !== source.columns || own(source.result, 'rows') !== source.rows || own(source.result, 'truncated') !== source.truncated || own(source.rows, 'length') !== source.rowRefs.length || own(source.columns, 'length') !== source.columnRefs.length) return false;
  for (let index = 0; index < source.columnRefs.length; index++) {
    const column = own(source.columns, String(index)) as ResultColumn, before = binding.metadata[index];
    if (column !== source.columnRefs[index]) return false;
    const now = metadata(column);
    if (now.key !== before.key || now.name !== before.name || now.type !== before.type) return false;
  }
  return true;
}
/** 单行同时复核原引用与每个原格，字节对象字段或原型变化也使来源失效。 */
function currentRow(source: Source, index: number, binding: Binding): boolean {
  const row = own(source.rows, String(index));
  if (row !== source.rowRefs[index]) return false;
  for (let column = 0; column < binding.metadata.length; column++) {
    const value = own(row, binding.metadata[column].key), raw = source.raw[index][column], copy = source.values[index][column];
    if (!Object.is(value, raw)) return false;
    if (copy && typeof copy === 'object' && (!binary(value) || Object.getPrototypeOf(value) !== binding.binaryPrototypes.get(value) || own(value, 'base64') !== copy.base64)) return false;
  }
  return true;
}
/** 完整核源是最终发布门，任何已观测漂移永久撤销，ABA不能恢复旧捕获。 */
export function currentQueryResultComparison(capture: QueryResultComparisonCapture, left: QueryResult, right: QueryResult): boolean {
  const binding = bindings.get(capture);
  if (!binding || binding.invalid) return false;
  try {
    if (left !== binding.left.result || right !== binding.right.result || !structure(binding.left, binding) || !structure(binding.right, binding)) throw Error(text.stale);
    for (const source of [binding.left, binding.right]) for (let index = 0; index < source.rowRefs.length; index++) if (!currentRow(source, index, binding)) throw Error(text.stale);
    return true;
  } catch { binding.invalid = true; return false; }
}
/** 仅对可信键副本做JSON元组编码，避免复合文本分隔符冲突，不序列化未知原对象。 */
function key(source: Source, index: number, binding: Binding, side: 'left' | 'right'): string {
  return JSON.stringify(binding.keyIndices.map(columnIndex => {
    const value = source.values[index][columnIndex];
    if (value === null) throw Error(text.keyNull(side));
    try {
      const parsed = queryResultFilterKey(binding.metadata[columnIndex], value);
      return parsed && typeof parsed === 'object' ? ['exact', parsed.negative, parsed.whole, parsed.fraction] : [typeof parsed, parsed];
    } catch { throw Error(text.keyInvalid(side)); }
  }));
}
/** 明细只接受正式发布的行身份，返回自有冻结原值，不读变化后的源对象拼接展示。 */
export function queryResultComparisonValues(capture: QueryResultComparisonCapture, row: QueryResultComparisonRow): readonly QueryResultComparisonValue[] {
  const binding = bindings.get(capture), owner = rowOwners.get(row);
  if (!binding || !owner?.active || owner.capture !== capture || !currentQueryResultComparison(capture, binding.left.result, binding.right.result)) throw Error(text.stale);
  const changed = new Set(row.changedColumns);
  return Object.freeze(binding.metadata.map((column, index) => Object.freeze({ column: column.key, name: column.name,
    ...(row.leftIndex === undefined ? {} : { left: binding.left.values[row.leftIndex][index] }),
    ...(row.rightIndex === undefined ? {} : { right: binding.right.values[row.rightIndex][index] }), changed: changed.has(column.key) })));
}

export class QueryResultComparisonScan {
  private capture?: QueryResultComparisonCapture;
  private binding?: Binding;
  private readonly total: number;
  private processed = 0;
  private cancelled = false;
  private completed = false;
  private leftMap = new Map<string, number>();
  private rightKeys = new Set<string>();
  private leftRows: QueryResultComparisonRow[] = [];
  private addedRows: QueryResultComparisonRow[] = [];
  private published?: QueryResultComparisonResult;
  private readonly owner: Owner;
  /** WeakMap核实捕获来源，公开字段或原型伪造都不能创建扫描器。 */
  constructor(capture: QueryResultComparisonCapture) {
    const binding = bindings.get(capture);
    if (!binding || !currentQueryResultComparison(capture, binding.left.result, binding.right.result)) throw Error(text.stale);
    this.capture = capture; this.binding = binding; this.total = capture.leftCount + capture.rightCount; this.owner = { capture, active: true };
  }
  /** 取消释放所有映射、部分结果和扫描器对来源的强引用，已发明细行也随owner撤销。 */
  cancel(): void {
    this.cancelled = true; this.leftMap.clear(); this.rightKeys.clear(); this.leftRows = []; this.addedRows = []; this.published = undefined;
    this.capture = undefined; this.binding = undefined; this.owner.active = false; this.owner.capture = undefined;
  }
  /** 每步最多512行或32Ki原文；超32Ki的单行原子处理后立即让出。 */
  step(): { processed: number; total: number; done: boolean } {
    if (this.cancelled) return { processed: this.processed, total: this.total, done: true };
    const binding = this.binding, capture = this.capture;
    try {
      if (!binding || !capture) throw Error(text.stale);
      let valid = false;
      try { valid = !binding.invalid && structure(binding.left, binding) && structure(binding.right, binding); } catch { /* 访问器替换同样撤销原来源。 */ }
      if (!valid) { binding.invalid = true; throw Error(text.stale); }
      let rows = 0, units = 0;
      while (this.processed < this.total && rows < queryResultComparisonLimits.batchRows) {
        const left = this.processed < capture.leftCount, source = left ? binding.left : binding.right, index = left ? this.processed : this.processed - capture.leftCount;
        if (rows && units + source.units[index] > queryResultComparisonLimits.batchUnits) break;
        units += source.units[index]; rows++;
        try { valid = currentRow(source, index, binding); } catch { valid = false; }
        if (!valid) { binding.invalid = true; throw Error(text.stale); }
        const identity = key(source, index, binding, left ? 'left' : 'right');
        if (left) {
          if (this.leftMap.has(identity)) throw Error(text.keyDuplicate('left'));
          this.leftMap.set(identity, index); this.leftRows.push(Object.freeze({ kind: 'removed', leftIndex: index, changedColumns: Object.freeze([]) }));
        } else {
          if (this.rightKeys.has(identity)) throw Error(text.keyDuplicate('right'));
          this.rightKeys.add(identity);
          const leftIndex = this.leftMap.get(identity);
          if (leftIndex === undefined) this.addedRows.push(Object.freeze({ kind: 'added', rightIndex: index, changedColumns: Object.freeze([]) }));
          else {
            const changedColumns = binding.metadata.filter((_, column) => !binding.keyIndices.includes(column) && !equal(binding.left.values[leftIndex][column], binding.right.values[index][column])).map(column => column.key);
            this.leftRows[leftIndex] = Object.freeze({ kind: changedColumns.length ? 'changed' : 'equal', leftIndex, rightIndex: index, changedColumns: Object.freeze(changedColumns) });
          }
        }
        this.processed++;
      }
      if (this.processed === this.total && !this.completed) {
        if (!currentQueryResultComparison(capture, binding.left.result, binding.right.result)) throw Error(text.stale);
        const rows = Object.freeze([...this.leftRows, ...this.addedRows]);
        const counts = { added: 0, removed: 0, changed: 0, equal: 0 };
        for (const row of rows) { counts[row.kind]++; rowOwners.set(row, this.owner); }
        this.published = Object.freeze({ ...counts, rows }); this.completed = true;
        this.leftMap.clear(); this.rightKeys.clear(); this.leftRows = []; this.addedRows = [];
      }
      return { processed: this.processed, total: this.total, done: this.completed };
    } catch (reason) { this.cancel(); throw reason; }
  }
  /** 最终回包前再次完整核源，不能发布已在扫描结束后发生漂移的旧差异。 */
  result(): QueryResultComparisonResult | undefined {
    const capture = this.capture, binding = this.binding;
    if (this.cancelled || !this.completed || !capture || !binding) return;
    if (!currentQueryResultComparison(capture, binding.left.result, binding.right.result)) { this.cancel(); return; }
    return this.published;
  }
}
