import type { DataRow, QueryResult, ResultColumn } from './contracts';
import { sqliteResultStorageZh as text } from './sqliteResultStorage.zh-CN';

/** 每行每列一个ASCII标识：整数、实数、文本、字节、NULL；数值原文仍由原CellValue承载。 */
export interface SqliteResultStorage { version: 1; rows: string[]; }
export type SqliteResultStorageCode = 'i' | 'r' | 't' | 'b' | 'n';
export const sqliteResultFilterTypes = ['text', 'integer', 'real', 'blob'] as const;
export type SqliteResultFilterType = typeof sqliteResultFilterTypes[number];
export const sqliteResultStorageLimits = { rows: 100000, columns: 4096, cells: 2000000, units: 16 * 1024 * 1024 } as const;
const invalid = (): never => { throw Error(text.invalid); };
const large = (): never => { throw Error(text.budget); };

/** 只读自有可枚举数据描述符；存储类型不能通过getter、原型或额外字段伪造。 */
function own(value: object, key: string): unknown {
  const item = Object.getOwnPropertyDescriptor(value, key);
  if (!item?.enumerable || !('value' in item)) return invalid(); return item.value;
}
/** 对象必须只有指定自有字段；同一批行复用列集合，避免宽表重复构建集合。 */
function record(value: unknown, keys: readonly string[], allowed: ReadonlySet<string> = new Set(keys)): object {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const fields = Reflect.ownKeys(value); if (fields.length !== keys.length || fields.some(key => typeof key !== 'string' || !allowed.has(key))) return invalid();
  for (const key of keys) own(value, key); return value;
}
/** 先限制数组长度和整体单元格数，再逐格验证；不调用输入迭代器或先分配大副本。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) return invalid(); if (length > maximum) return large();
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  for (let index = 0; index < length; index++) own(value, String(index)); return value;
}

/** 精确检查数值的canonical原文，不把看起来像数字的TEXT改成数值类型。 */
export function sqliteResultCellMatches(code: string, value: unknown): boolean {
  if (code === 'n') return value === null;
  if (code === 'b') {
    const binary = record(value, ['type', 'base64']);
    const bytes = own(binary, 'base64');
    if (own(binary, 'type') !== 'binary' || typeof bytes !== 'string' || bytes.length % 4) return false;
    const padding = bytes.endsWith('==') ? 2 : bytes.endsWith('=') ? 1 : 0, end = bytes.length - padding, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let index = 0; index < end; index++) if (alphabet.indexOf(bytes[index]) < 0) return false;
    return !(padding === 2 && (alphabet.indexOf(bytes[end - 1]) & 15) !== 0 || padding === 1 && (alphabet.indexOf(bytes[end - 1]) & 3) !== 0);
  }
  if (typeof value !== 'string') return false;
  if (code === 't') return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  if (code === 'i') {
    if (value.length > 20 || !/^-?(?:0|[1-9]\d*)$/.test(value)) return false;
    const number = BigInt(value); return number >= -9223372036854775808n && number <= 9223372036854775807n && String(number) === value;
  }
  if (code === 'r') {
    if (value.length > 32) return false; const number = Number(value);
    return !Number.isNaN(number) && (Object.is(number, -0) ? '-0' : String(number)) === value;
  }
  return false;
}

/** 类型逐格对应准确原列和原行，返回独立副本；旧结果缺少此信息时不得猜测补造。 */
export function copySqliteResultStorage(value: unknown, columns: readonly ResultColumn[], rows: readonly DataRow[]): SqliteResultStorage {
  const source = record(value, ['version', 'rows']); if (own(source, 'version') !== 1) return invalid();
  const columnList = array(columns, sqliteResultStorageLimits.columns), rowList = array(rows, sqliteResultStorageLimits.rows), codes = array(own(source, 'rows'), sqliteResultStorageLimits.rows);
  if (columnList.length * rowList.length > sqliteResultStorageLimits.cells) return large();
  if (codes.length !== rowList.length || !columnList.length && rowList.length) return invalid();
  const keys: string[] = [];
  for (let index = 0; index < columnList.length; index++) {
    const column = record(own(columnList, String(index)), ['key', 'name', 'type']), key = own(column, 'key');
    if (typeof key !== 'string' || !key || key.length > 8192 || typeof own(column, 'name') !== 'string' || own(column, 'type') !== 'SQLITE') return invalid(); keys.push(key);
  }
  const allowed = new Set(keys); if (allowed.size !== keys.length) return invalid();
  let units = 0; const copied: string[] = [];
  for (let index = 0; index < rowList.length; index++) {
    const code = own(codes, String(index)), row = record(own(rowList, String(index)), keys, allowed);
    if (typeof code !== 'string' || code.length !== keys.length) return invalid();
    for (let column = 0; column < keys.length; column++) {
      const value = own(row, keys[column]);
      if (typeof value === 'string') units += value.length;
      else if (value && typeof value === 'object') { const binary = record(value, ['type', 'base64']); const bytes = own(binary, 'base64'); if (typeof bytes !== 'string') return invalid(); units += bytes.length; }
      if (units > sqliteResultStorageLimits.units) return large();
      if (!sqliteResultCellMatches(code[column], value)) return invalid();
    }
    copied.push(code);
  }
  return { version: 1, rows: copied };
}

/** 筛选／排序同步投影类型行，保留原单元格；普通MySQL结果不增加字段或解析开销。 */
export function projectSqliteResultStorage(source: QueryResult, indices: readonly number[]): Pick<QueryResult, 'sqliteStorage'> {
  const property = Object.getOwnPropertyDescriptor(source, 'sqliteStorage'); if (!property) return {};
  if (!property.enumerable || !('value' in property)) return invalid();
  const storage = copySqliteResultStorage(property.value, source.columns, source.rows), selected = array(indices, sqliteResultStorageLimits.rows), projected: string[] = [], used = new Set<number>();
  for (let index = 0; index < selected.length; index++) {
    const position = own(selected, String(index)); if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0 || position >= storage.rows.length || used.has(position)) return invalid();
    used.add(position); projected.push(storage.rows[position]);
  }
  return { sqliteStorage: { version: 1, rows: projected } };
}

/** 结果整理租约同时绑定原类型对象与逐行标记；同原文的INTEGER／TEXT变化也永久失效。 */
export function bindSqliteResultStorage(source: QueryResult): () => boolean {
  const descriptor = Object.getOwnPropertyDescriptor(source, 'sqliteStorage');
  if (!descriptor) return () => !Object.hasOwn(source, 'sqliteStorage');
  if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
  const original = descriptor.value, copied = copySqliteResultStorage(original, source.columns, source.rows), rows = own(original, 'rows');
  let valid = true;
  return () => {
    if (!valid) return false;
    try {
      const current = Object.getOwnPropertyDescriptor(source, 'sqliteStorage');
      if (!current?.enumerable || !('value' in current) || current.value !== original) return valid = false;
      record(original, ['version', 'rows']);
      if (own(original, 'version') !== 1 || own(original, 'rows') !== rows) return valid = false;
      const codes = array(rows, sqliteResultStorageLimits.rows);
      if (codes.length !== copied.rows.length || copied.rows.some((code, index) => own(codes, String(index)) !== code)) return valid = false;
      return true;
    } catch { return valid = false; }
  };
}
