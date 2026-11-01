import type { SQLInputValue } from 'node:sqlite';
import { sqliteDriverLimits as limits, type SqliteColumn, type SqliteValue } from './protocol';
import { decodeSqliteRawValue } from './rawValue';

/** 只由持有原连接的worker提供，不接受扩展路径或跨进程可执行内容。 */
export type SqliteRawInvoke = (operation: number, argument: SQLInputValue) => unknown;
export class SqliteRawStatementError extends Error {
  /** 位置值过量沿用原生RANGE码；其它协议异常不伪造SQLite执行错误。 */
  constructor(readonly errcode?: number) { super(errcode === 25 ? 'SQLite位置参数数量超过原生匿名参数槽' : 'SQLite原字节语句协议、材料或生命周期无效'); }
}
const invalid = () => new SqliteRawStatementError();
const chunkBytes = 65536;
const validUnicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

/** 参数和值之外的UTF8元数据也严格解码；字段名中的坏字节不能成为有效列定位。 */
function text(value: unknown): string {
  if (!(value instanceof Uint8Array) || value.length > limits.valueBytes) throw invalid();
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); } catch { throw invalid(); }
}
/** 每次控制回包均按原生安全整数边界核验，不能依赖类型断言放行。 */
function count(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw invalid(); return value;
}

/** 先核完整输入组再接触任一原生绑定，非法后项不能留下部分绑定。 */
function inputValue(value: unknown): asserts value is SQLInputValue {
  if (value !== null && typeof value !== 'bigint' && typeof value !== 'number' && typeof value !== 'string' && !ArrayBuffer.isView(value)) throw invalid();
  if (typeof value === 'bigint' && (value < -9223372036854775808n || value > 9223372036854775807n) || typeof value === 'number' && Number.isNaN(value) || typeof value === 'string' && (!validUnicode(value) || Buffer.byteLength(value) > limits.valueBytes) || ArrayBuffer.isView(value) && value.byteLength > limits.valueBytes) throw invalid();
}

/** 内部候选适配器，尚未替换SqliteWorkerCore；原SQL只prepare一次，逐行或有界帧首次解码。 */
export class SqliteRawStatement {
  private closed = false;
  private stepped = false;
  private ended = false;
  private failed = false;
  private failure: unknown;
  private readMode: 'row' | 'frame' | undefined;
  private constructor(private readonly invoke: SqliteRawInvoke, readonly sourceSQL: string, readonly hasStatement: boolean) {}

  /** 先取得独占材料阶段再传入分段；未取得能力时绝不收尾别人的statement。 */
  static prepare(invoke: SqliteRawInvoke, sql: string): SqliteRawStatement {
    if (typeof sql !== 'string' || !sql.length || sql.includes('\0') || !validUnicode(sql) || Buffer.byteLength(sql) > limits.sqlBytes) throw invalid();
    const source = Buffer.from(sql), acquired = invoke(12, null);
    try {
      if (acquired !== 0) throw invalid();
      for (let offset = 0; offset < source.length; offset += chunkBytes) {
        const bytes = source.subarray(offset, Math.min(offset + chunkBytes, source.length));
        if (invoke(13, bytes) !== offset + bytes.length) throw invalid();
      }
      const consumed = count(invoke(14, null), source.length); if (!consumed) throw invalid();
      const parts: Uint8Array[] = [];
      for (let offset = 0; offset < consumed; offset += chunkBytes) {
        const part = invoke(11, BigInt(offset));
        if (!(part instanceof Uint8Array) || part.length !== Math.min(chunkBytes, consumed - offset)) throw invalid(); parts.push(part);
      }
      const prefix = Buffer.concat(parts);
      if (!prefix.equals(source.subarray(0, consumed))) throw invalid();
      // 已与合法原材料逐字节相等，按完整前缀解码，不能分别解码可能截断Unicode的分段。
      let sourceSQL: string;
      try { sourceSQL = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(prefix); } catch { throw invalid(); }
      const hasStatement = count(invoke(15, null), 1);
      if (!sql.startsWith(sourceSQL)) throw invalid();
      return new SqliteRawStatement(invoke, sourceSQL, hasStatement === 1);
    } catch (error) {
      try { invoke(2, null); } catch (cleanup) { throw new AggregateError([error, cleanup], 'SQLite原字节准备及准确收尾均失败'); }
      throw error;
    }
  }

  /** 所有后续调用绑定本对象生命周期，旧对象不能读取或finalize后继语句。 */
  private call(operation: number, argument: SQLInputValue = null): unknown { if (this.closed) throw invalid(); return this.invoke(operation, argument); }

  /** 重复列名按位置保留，表达式的来源NULL由原生元数据返回，不从SQL推断。 */
  columns(): SqliteColumn[] {
    const length = count(this.call(10), limits.columns), columns: SqliteColumn[] = [];
    for (let column = 0; column < length; column++) {
      const values = [0, 1, 2, 3, 4].map(field => this.call(9, (BigInt(field) << 32n) | BigInt(column)));
      columns.push(Object.assign(Object.create(null), { name: text(values[0]), database: values[1] === null ? null : text(values[1]), table: values[2] === null ? null : text(values[2]), column: values[3] === null ? null : text(values[3]), type: values[4] === null ? null : text(values[4]) }));
    }
    return columns;
  }

  /** 参数槽和名称全部来自同一prepared statement；重复命名参数共享原生槽。 */
  parameterNames(): (string | null)[] {
    const length = count(this.call(5), limits.columns), output: (string | null)[] = [];
    for (let index = 1; index <= length; index++) { const name = this.call(8, BigInt(index)); output.push(name === null ? null : text(name)); }
    return output;
  }

  /** 保留Node规则：位置值只填匿名/?NNN槽，具名前缀不省略，缺值仍为NULL，未用具名值忽略。 */
  bind(parameters: SQLInputValue[] | Record<string, SQLInputValue>): void {
    if (this.stepped) throw invalid();
    const names = this.parameterNames(), entries: [number, SQLInputValue][] = [];
    if (Array.isArray(parameters)) {
      const slots = names.flatMap((name, index) => name === null || name.startsWith('?') ? [index + 1] : []);
      if (parameters.length > slots.length) throw new SqliteRawStatementError(25);
      if (Object.getPrototypeOf(parameters) !== Array.prototype || Reflect.ownKeys(parameters).length !== parameters.length + 1) throw invalid();
      for (let index = 0; index < parameters.length; index++) {
        const item = Object.getOwnPropertyDescriptor(parameters, String(index)); if (!item?.enumerable || !('value' in item)) throw invalid(); inputValue(item.value); entries.push([slots[index], item.value]);
      }
    } else {
      if (!parameters || ![Object.prototype, null].includes(Object.getPrototypeOf(parameters))) throw invalid();
      const keys = Reflect.ownKeys(parameters), values: Record<string, SQLInputValue> = Object.create(null);
      if (keys.length > limits.columns) throw invalid();
      for (const key of keys) {
        if (typeof key !== 'string') throw invalid(); const item = Object.getOwnPropertyDescriptor(parameters, key);
        if (!item?.enumerable || !('value' in item)) throw invalid(); inputValue(item.value); values[key] = item.value;
      }
      names.forEach((name, index) => { if (name !== null && Object.hasOwn(values, name)) entries.push([index + 1, values[name]]); });
    }
    for (const [index, value] of entries) {
      if (this.call(6, BigInt(index)) !== 0 || this.call(7, value) !== 0) throw invalid();
    }
  }

  /** 不提前累计结果，不重跑语句；坏TEXT只在原始副本上解码，不替换真实数据。 */
  next(): SqliteValue[] | null {
    if (this.closed) throw invalid(); if (this.failed) throw this.failure; if (this.ended) return null;
    if (this.readMode === 'frame') throw invalid(); this.readMode = 'row';
    this.stepped = true;
    try {
      const length = this.call(1);
      if (length === null) { this.ended = true; return null; }
      const columns = count(length, limits.columns), values: SqliteValue[] = [];
      for (let index = 0; index < columns; index++) {
        const descriptor = count(this.call(3, BigInt(index)), 0xffff), bytes = this.call(4, BigInt(index));
        if (!(bytes instanceof Uint8Array)) throw invalid();
        values.push(decodeSqliteRawValue({ type: descriptor & 255, encoding: descriptor >> 8, bytes }));
      }
      return values;
    } catch (error) { this.failed = true; this.failure = error; throw error; }
  }

  /** 消费者明确请求一帧后才推进；行数/字节均有界，禁止与逐行游标混读。 */
  readFrame(rows = 200, bytes = 65536): Uint8Array {
    if (this.closed) throw invalid(); if (this.failed) throw this.failure;
    if (this.readMode === 'row' || !Number.isSafeInteger(rows) || rows < 1 || rows > 200 || !Number.isSafeInteger(bytes) || bytes < 64 || bytes > limits.valueBytes) throw invalid();
    this.readMode = 'frame'; this.stepped = true;
    try {
      const frame = this.call(16, (BigInt(rows) << 32n) | BigInt(bytes));
      if (!(frame instanceof Uint8Array) || frame.length < 13 || frame.length > bytes) throw invalid(); return frame;
    } catch (error) { this.failed = true; this.failure = error; throw error; }
  }

  /** 显式finalize一次；原生失败照实抛出，不能对新的游标重试旧收尾。 */
  finish(): void { if (this.closed) return; this.closed = true; if (this.invoke(2, null) !== 0) throw invalid(); }
}
