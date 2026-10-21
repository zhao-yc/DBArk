import type { CellValue, DataRow, ResultColumn } from '../shared/contracts';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultSortKind, queryResultSortLimits } from './queryResultSort';
import { queryResultStatisticsZh as text } from './locales/queryResultStatistics.zh-CN';

export interface QueryResultStatisticsCapture {
  readonly column: Readonly<ResultColumn>;
  readonly rowCount: number;
  readonly selected: boolean;
}
export interface QueryResultStatisticsResult {
  readonly count: number; readonly nonNull: number; readonly nulls: number;
  readonly distinct?: number; readonly min?: string; readonly max?: string; readonly sum?: string; readonly average?: string;
  readonly approximate: boolean; readonly floatInput: boolean; readonly averageRounded: boolean; readonly reason?: string;
}
type Key = ReturnType<typeof queryResultFilterKey>;
interface ValueStamp { value: unknown; units: number; prototype?: object | null; fields?: readonly (readonly [PropertyKey, unknown])[]; }
interface Binding {
  columns: readonly ResultColumn[]; rows: readonly DataRow[]; columnRefs: readonly ResultColumn[]; metadata: readonly ResultColumn[];
  rowRefs: readonly DataRow[]; indices: readonly number[]; selection?: ReadonlySet<number>; values: readonly ValueStamp[]; invalid: boolean;
}
const bindings = new WeakMap<QueryResultStatisticsCapture, Binding>();
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/** 自有数据描述符是唯一读取入口，原数组、行、元数据及字节对象上的访问器均不执行。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}
/** 有界检查每个数组索引，不能用迭代器跳过稀疏项或执行自定义读取。 */
function array<T>(value: readonly T[], limit: number, minimum = 0): T[] {
  if (!Array.isArray(value)) throw Error(text.invalid);
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || (length as number) < minimum) throw Error(text.invalid);
  if ((length as number) > limit) throw Error(text.budget);
  const result: T[] = [];
  for (let index = 0; index < (length as number); index++) result.push(own(value, String(index)) as T);
  return result;
}
/** 内置Set端口保留选择对象身份，显示索引排序，不调用外部size或迭代器。 */
function positions(selection: ReadonlySet<number>, length: number): number[] {
  let size: number;
  try { size = setSize.call(selection); } catch { throw Error(text.invalid); }
  if (!Number.isSafeInteger(size) || size < 1) throw Error(text.invalid);
  if (size > length || size > queryResultSortLimits.rows) throw Error(text.budget);
  const result: number[] = [];
  for (const index of Set.prototype.values.call(selection) as IterableIterator<number>) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw Error(text.invalid);
    result.push(index);
  }
  return result.sort((left, right) => left - right);
}
/** 重复显示名合法，内部key必须唯一，所有列的完整元数据都参与来源身份。 */
function metadata(column: ResultColumn): ResultColumn {
  const key = own(column, 'key'), name = own(column, 'name'), type = own(column, 'type');
  if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string') throw Error(text.invalid);
  if (key.length > 4096 || name.length > 4096 || type.length > 4096) throw Error(text.budget);
  return Object.freeze({ key, name, type });
}
/** 不序列化未知对象；字节及坏协议对象只留有界浅身份，不能触发getter或递归。 */
function stamp(value: unknown, charge: (units: number) => void): ValueStamp {
  let units = 0;
  const count = (length: number) => { charge(length); units += length; };
  if (typeof value === 'string') count(value.length);
  else count(1);
  if (!value || typeof value !== 'object') return { value, units };
  const keys = Reflect.ownKeys(value);
  if (keys.length > 16) throw Error(text.budget);
  const fields = keys.map(key => {
    const field = own(value, key);
    if (typeof field === 'string') count(field.length);
    return Object.freeze([key, field] as const);
  });
  if (units > 32768) throw Error(text.budget);
  return { value, units, prototype: Object.getPrototypeOf(value), fields };
}
/** 原值对象的字段变化也撤销统计，不把同一字节引用视为内容恒定。 */
function sameValue(value: unknown, before: ValueStamp): boolean {
  if (!Object.is(value, before.value)) return false;
  if (!before.fields) return true;
  const keys = Reflect.ownKeys(value as object);
  return Object.getPrototypeOf(value) === before.prototype && keys.length === before.fields.length && before.fields.every(([key, field], index) => keys[index] === key && Object.is(own(value, key), field));
}

/** 捕获原行列与当前范围；只冻结自有快照，不克隆或冻结来源。 */
export function captureQueryResultStatistics(columns: readonly ResultColumn[], rows: readonly DataRow[], column: ResultColumn, indices?: ReadonlySet<number>): QueryResultStatisticsCapture {
  const columnRefs = array(columns, queryResultSortLimits.columns, 1), rowRefs = array(rows, queryResultSortLimits.rows);
  const descriptions = columnRefs.map(metadata), columnIndex = columnRefs.indexOf(column);
  if (columnIndex < 0 || new Set(descriptions.map(item => item.key)).size !== columnRefs.length || new Set(rowRefs).size !== rowRefs.length || rowRefs.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error(text.invalid);
  const positionsInScope = indices === undefined ? rowRefs.map((_, index) => index) : positions(indices, rowRefs.length), admitted = descriptions[columnIndex];
  let units = 0;
  const charge = (length: number) => { if (length > queryResultSortLimits.valueUnits) throw Error(text.budget); units += length; if (units > queryResultSortLimits.units) throw Error(text.budget); };
  const values = positionsInScope.map(index => stamp(own(rowRefs[index], admitted.key), charge));
  const capture = Object.freeze({ column: admitted, rowCount: positionsInScope.length, selected: indices !== undefined });
  bindings.set(capture, { columns, rows, columnRefs, metadata: descriptions, rowRefs, indices: positionsInScope, selection: indices, values, invalid: false });
  if (!currentQueryResultStatistics(capture, columns, rows)) throw Error(text.stale);
  return capture;
}

/** 分批阶段仅检查固定大小结构及本批原格；避免每512行重复全表检查造成平方扫描。 */
function currentStructure(binding: Binding): boolean {
  if (binding.invalid || own(binding.columns, 'length') !== binding.columnRefs.length || own(binding.rows, 'length') !== binding.rowRefs.length) return false;
  if (binding.selection && setSize.call(binding.selection) !== binding.indices.length) return false;
  for (let index = 0; index < binding.columnRefs.length; index++) {
    const column = own(binding.columns, String(index)) as ResultColumn, before = binding.metadata[index];
    if (column !== binding.columnRefs[index]) return false;
    const now = metadata(column);
    if (now.key !== before.key || now.name !== before.name || now.type !== before.type) return false;
  }
  return true;
}
/** 完整核源时，任何已经观测到的数组、元数据、选择和原值漂移均永久失效。 */
export function currentQueryResultStatistics(capture: QueryResultStatisticsCapture, columns: readonly ResultColumn[], rows: readonly DataRow[]): boolean {
  const binding = bindings.get(capture);
  if (!binding || binding.invalid) return false;
  try {
    if (columns !== binding.columns || rows !== binding.rows || !currentStructure(binding)) throw Error(text.stale);
    for (let index = 0; index < binding.rowRefs.length; index++) if (own(rows, String(index)) !== binding.rowRefs[index]) throw Error(text.stale);
    if (binding.selection) {
      const selected = positions(binding.selection, binding.rowRefs.length);
      if (selected.some((index, position) => index !== binding.indices[position])) throw Error(text.stale);
    }
    for (let position = 0; position < binding.indices.length; position++) if (!sameValue(own(binding.rowRefs[binding.indices[position]], capture.column.key), binding.values[position])) throw Error(text.stale);
    return true;
  } catch { binding.invalid = true; return false; }
}

interface Decimal { coefficient: bigint; scale: number; }
/** 已由原比较器准入的数值转为系数/尺度；float只展开已有number，不能找回驱动丢失精度。 */
function decimal(value: string | number): Decimal {
  const raw = String(value), match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) throw Error(text.value);
  const fraction = match[3] ?? '', exponent = match[4] ? Number(match[4]) : 0;
  let coefficient = BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction), scale = fraction.length - exponent;
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return { coefficient, scale };
}
/** 十进制展示不经Number，负零归零，并保留调用方指定的原尺度或精确扩展尺度。 */
function display(coefficient: bigint, scale: number): string {
  const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const fraction = scale ? digits.slice(-scale) : '';
  return (negative ? '-' : '') + (scale ? digits.slice(0, -scale) : digits) + (fraction ? '.' + fraction : '');
}
/** 仅约分系数与计数，原始十进制尺度不丢失；约分后分母仅含2/5时AVG可以精确表示。 */
function exactAverage(sum: Decimal, count: number): Decimal | undefined {
  let left = sum.coefficient < 0n ? -sum.coefficient : sum.coefficient, right = BigInt(count);
  while (right) { const remainder = left % right; left = right; right = remainder; }
  const divisor = BigInt(count) / left;
  let remaining = divisor, twos = 0, fives = 0;
  while (remaining % 2n === 0n) { remaining /= 2n; twos++; }
  while (remaining % 5n === 0n) { remaining /= 5n; fives++; }
  if (remaining !== 1n) return;
  const extra = Math.max(twos, fives);
  let coefficient = sum.coefficient / left * (10n ** BigInt(extra) / divisor), scale = sum.scale + extra;
  while (scale > sum.scale && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
/** 不同值沿用原比较键：精确数值归一、文本区分大小写、时间保留返回字段语义。 */
function identity(key: Key): string {
  if (key === null) return 'null';
  if (typeof key === 'object') return `e:${key.negative ? '-' : ''}${key.whole}.${key.fraction}`;
  return `${typeof key}:${String(key)}`;
}

export class QueryResultStatisticsScan {
  private binding?: Binding;
  private capture?: QueryResultStatisticsCapture;
  private readonly total: number;
  private processed = 0;
  private nulls = 0;
  private cancelled = false;
  private completed = false;
  private published?: QueryResultStatisticsResult;
  private distinct = new Set<string>();
  private minimum?: { key: Key; literal: string };
  private maximum?: { key: Key; literal: string };
  private sum: Decimal = { coefficient: 0n, scale: 0 };
  private reason?: string;
  private readonly kind: ReturnType<typeof queryResultSortKind>;
  /** 私有WeakMap拒绝伪造capture；声明为字节的列即使返回字符串也不参加值聚合。 */
  constructor(capture: QueryResultStatisticsCapture) {
    const binding = bindings.get(capture);
    if (!binding || !currentQueryResultStatistics(capture, binding.columns, binding.rows)) throw Error(text.stale);
    this.binding = binding; this.capture = capture; this.total = capture.rowCount; this.kind = queryResultSortKind(capture.column.type);
    if (!this.kind || /^(?:TINY_|MEDIUM_|LONG_)?BLOB(?:\b|$)/i.test(capture.column.type.trim())) this.reason = text.unsupported;
  }
  /** 取消释放不同值集合及部分聚合，不能通过后续step/result复活旧结果。 */
  cancel(): void { this.cancelled = true; this.distinct.clear(); this.minimum = undefined; this.maximum = undefined; this.published = undefined; this.sum = { coefficient: 0n, scale: 0 }; this.binding = undefined; this.capture = undefined; }
  /** 坏值只撤销所有值指标，完整计数仍继续；不发布部分不同值或极值。 */
  private rejectValues(reason: string): void { this.reason = reason; this.distinct.clear(); this.minimum = undefined; this.maximum = undefined; this.sum = { coefficient: 0n, scale: 0 }; }
  /** 每批至多512个原格或32Ki原文；结构检查不遍历整张行数组，最后一次才全量复核。 */
  step(): { processed: number; total: number; done: boolean } {
    const total = this.total, binding = this.binding, capture = this.capture;
    if (this.cancelled) return { processed: this.processed, total, done: true };
    try {
      if (!binding || !capture || !currentStructure(binding)) throw Error(text.stale);
      const end = Math.min(total, this.processed + 512);
      let units = 0;
      for (; this.processed < end; this.processed++) {
        const before = binding.values[this.processed];
        if (units && units + before.units > 32768) break;
        units += before.units;
        const index = binding.indices[this.processed], row = own(binding.rows, String(index));
        if (row !== binding.rowRefs[index] || binding.selection && !Set.prototype.has.call(binding.selection, index)) throw Error(text.stale);
        const value = own(row, capture.column.key);
        if (!sameValue(value, before)) throw Error(text.stale);
        if (value === null) { this.nulls++; continue; }
        if (this.reason) continue;
        try {
          const key = queryResultFilterKey(capture.column, value as CellValue), literal = String(value);
          this.distinct.add(identity(key));
          if (!this.minimum || compareQueryResultFilterKeys(key, this.minimum.key) < 0) this.minimum = { key, literal };
          if (!this.maximum || compareQueryResultFilterKeys(key, this.maximum.key) > 0) this.maximum = { key, literal };
          if (this.kind === 'integer' || this.kind === 'decimal' || this.kind === 'float') {
            const next = decimal(value as string | number), scale = Math.max(next.scale, this.sum.scale);
            this.sum = { coefficient: this.sum.coefficient * 10n ** BigInt(scale - this.sum.scale) + next.coefficient * 10n ** BigInt(scale - next.scale), scale };
          }
        } catch { this.rejectValues(text.value); }
      }
      if (this.processed === total && !this.completed) {
        if (!currentQueryResultStatistics(capture, binding.columns, binding.rows)) throw Error(text.stale);
        this.finish(); this.completed = true;
      }
      return { processed: this.processed, total, done: this.completed };
    } catch { if (binding) binding.invalid = true; this.cancel(); throw Error(text.stale); }
  }
  /** 有限AVG先约分精确扩展；仅循环小数按最大原尺度或18位，用BigInt商余数实现half-away。 */
  private finish(): void {
    const count = this.total, nonNull = count - this.nulls, floatInput = this.kind === 'float' && nonNull > 0;
    if (!nonNull) { this.published = Object.freeze({ count, nonNull, nulls: this.nulls, distinct: 0, approximate: false, floatInput: false, averageRounded: false }); return; }
    if (this.reason) { this.published = Object.freeze({ count, nonNull, nulls: this.nulls, approximate: false, floatInput: false, averageRounded: false, reason: this.reason }); return; }
    let sum: string | undefined, average: string | undefined, averageRounded = false;
    if (this.kind === 'integer' || this.kind === 'decimal' || this.kind === 'float') {
      sum = display(this.sum.coefficient, this.sum.scale);
      const finite = exactAverage(this.sum, nonNull);
      if (finite) average = display(finite.coefficient, finite.scale);
      else {
        const scale = Math.max(this.sum.scale, 18), numerator = this.sum.coefficient * 10n ** BigInt(scale - this.sum.scale), divisor = BigInt(nonNull);
        let quotient = numerator / divisor;
        const remainder = numerator % divisor, magnitude = remainder < 0n ? -remainder : remainder;
        averageRounded = remainder !== 0n;
        if (magnitude * 2n >= divisor) quotient += numerator < 0n ? -1n : 1n;
        average = display(quotient, scale);
      }
    }
    this.published = Object.freeze({ count, nonNull, nulls: this.nulls, distinct: this.distinct.size, min: this.minimum?.literal, max: this.maximum?.literal, sum, average, approximate: floatInput || averageRounded, floatInput, averageRounded });
    this.distinct.clear(); this.minimum = undefined; this.maximum = undefined;
  }
  /** 最后发布仍核源，调用方无需信任较早某一帧的current判断。 */
  result(): QueryResultStatisticsResult | undefined {
    const capture = this.capture, binding = this.binding;
    if (this.cancelled || !this.completed || !capture || !binding) return;
    if (!currentQueryResultStatistics(capture, binding.columns, binding.rows)) { this.cancel(); return; }
    return this.published;
  }
}
