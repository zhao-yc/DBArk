import { z } from 'zod';
import type { CellValue, DataRow } from './contracts';
import { copyInsertSqlZh as text } from './copyInsertSql.zh-CN';

/** 小于网格复制的字符上限，独立限制主进程请求及最终 UTF-8 SQL 字节，绝不截断。 */
export const copyInsertSqlLimits = { rows: 1000, columns: 1024, cells: 50_000, cellBytes: 256 * 1024, inputBytes: 1024 * 1024, sqlBytes: 1024 * 1024 } as const;
export interface CopyInsertColumn { name: string; type: string; nullable: boolean; generated: boolean; extra: string }
export interface CopyInsertSqlInput { database: string; table: string; columns: CopyInsertColumn[]; rows: DataRow[] }
type Kind = 'integer' | 'decimal' | 'float' | 'text' | 'binary';
const encoder = new TextEncoder();
const fail = (reason: string): never => { throw new Error(reason); };
/** 只读取普通对象的自有数据属性；拒绝继承字段、访问器和附带的隐藏参数。 */
function fields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(text.invalid);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property, 'value')) return fail(text.invalid);
  }
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const object = fields(value);
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) return fail(text.invalid);
  return object;
}
/** 数组也只接受连续自有数据项，不能携带隐藏属性或在遍历时执行访问器。 */
function plainArray(value: unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return fail(text.invalid);
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) return fail(text.invalid);
  }
}
/** 未配对代理项无法无损写入 UTF-8，不能让编码器悄悄替换成 U+FFFD。 */
function byteLength(value: string): number {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return fail(text.type);
  return encoder.encode(value).byteLength;
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > 64 || value.includes('\0')) return fail(text.invalid);
  byteLength(value);
}
/** 类型只用于决定字面量，不拼接到 SQL；未明确支持的目录类型一律拒绝。 */
export function copyInsertColumnKind(column: CopyInsertColumn): Kind {
  if (column.generated || /\b(?:invisible|virtual|stored)\b/i.test(column.extra) || !/^(?:\s*(?:auto_increment|default_generated|on update current_timestamp(?:\(\d*\))?))*\s*$/i.test(column.extra)) return fail(text.type);
  const type = column.type.toLowerCase().trim();
  if (/^(?:tinyint|smallint|mediumint|int|integer|bigint|year)(?:\(\d+\))?(?: unsigned)?(?: zerofill)?$/.test(type)) return 'integer';
  if (/^(?:decimal|numeric)(?:\(\d+(?:,\s*\d+)?\))?(?: unsigned)?(?: zerofill)?$/.test(type)) return 'decimal';
  if (/^(?:float|double|real)(?:\(\d+(?:,\s*\d+)?\))?(?: unsigned)?(?: zerofill)?$/.test(type)) return 'float';
  if (/^(?:(?:var)?binary\(\d+\)|(?:tiny|medium|long)?blob|bit(?:\(\d+\))?)$/.test(type)) return 'binary';
  if (/^(?:(?:var)?char\(\d+\)|(?:tiny|medium|long)?text|json|date|(?:datetime|timestamp|time)(?:\([0-6]\))?|(?:enum|set)\(.+\))$/.test(type)) return 'text';
  return fail(text.type);
}
/** 精确数值字符串不经过 Number；仅由受限数字语法生成裸字面量。 */
export function copyInsertNumericLiteral(column: CopyInsertColumn, value: CellValue): string | undefined {
  const kind = copyInsertColumnKind(column);
  if (value === null || kind === 'text' || kind === 'binary') return undefined;
  if (kind === 'integer') {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return fail(text.type);
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value, -0))) return fail(text.type);
    const raw = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    if (!/^-?\d+$/.test(raw) || (/\bunsigned\b/i.test(column.type) && raw.startsWith('-'))) return fail(text.type);
    // 未知 NO_AUTO_VALUE_ON_ZERO 时，显式零也可能触发新自增值，不能承诺保真。
    if (/\bauto_increment\b/i.test(column.extra) && /^-?0+$/.test(raw)) return fail(text.type);
    return raw;
  }
  if (kind === 'decimal') {
    // mysql2 的 DECIMAL 必须保留原字符串；已转换的 Number 无法证明小数精度。
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || (/\bunsigned\b/i.test(column.type) && value.startsWith('-'))) return fail(text.type);
    return value;
  }
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value)) || !Number.isFinite(Number(value)) || Object.is(value, -0) || (/\bunsigned\b/i.test(column.type) && String(value).startsWith('-'))) return fail(text.type);
  return String(value);
}

/** 主进程和渲染进程共用预算与完整性校验；任何失败都发生在剪贴板写入之前。 */
export function assertCopyInsertSqlInput(input: unknown): asserts input is CopyInsertSqlInput {
  const value = exact(input, ['database', 'table', 'columns', 'rows']); identifier(value.database); identifier(value.table);
  if (!Array.isArray(value.columns) || !value.columns.length || !Array.isArray(value.rows) || !value.rows.length) return fail(text.invalid);
  if (value.rows.length > copyInsertSqlLimits.rows || value.columns.length > copyInsertSqlLimits.columns || value.rows.length * value.columns.length > copyInsertSqlLimits.cells) return fail(text.limit);
  plainArray(value.columns); plainArray(value.rows);
  const names = new Set<string>();
  for (const raw of value.columns) {
    const column = exact(raw, ['name', 'type', 'nullable', 'generated', 'extra']); identifier(column.name);
    if (names.has(column.name) || typeof column.type !== 'string' || column.type.length > 1024 || typeof column.extra !== 'string' || column.extra.length > 1024 || typeof column.generated !== 'boolean' || typeof column.nullable !== 'boolean') return fail(text.invalid);
    names.add(column.name); copyInsertColumnKind(raw as CopyInsertColumn);
  }
  let bytes = 0;
  for (const raw of value.rows) {
    const row = fields(raw);
    if (Object.keys(row).length !== names.size || [...names].some(name => !Object.hasOwn(row, name))) return fail(text.incomplete);
    for (const column of value.columns as CopyInsertColumn[]) {
      const cell = row[column.name]; let size = 8;
      if (cell === null) { if (!column.nullable) return fail(text.type); }
      else if (copyInsertColumnKind(column) === 'binary') {
        const binary = exact(cell, ['type', 'base64']);
        if (binary.type !== 'binary' || typeof binary.base64 !== 'string' || binary.base64.length > copyInsertSqlLimits.cellBytes * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(binary.base64)) return fail(text.type);
        // 末尾填充位必须为零，否则 Buffer 的宽松解码会吞掉不同来源。
        if (binary.base64.endsWith('==') && !/[AQgw]==$/.test(binary.base64) || binary.base64.endsWith('=') && !binary.base64.endsWith('==') && !/[AEIMQUYcgkosw048]=$/.test(binary.base64)) return fail(text.type);
        size = binary.base64.length / 4 * 3 - (binary.base64.endsWith('==') ? 2 : binary.base64.endsWith('=') ? 1 : 0);
      } else if (copyInsertColumnKind(column) === 'text') {
        if (typeof cell !== 'string') return fail(text.type);
        if (cell.length > copyInsertSqlLimits.cellBytes) return fail(text.limit);
        size = byteLength(cell);
      } else {
        if (typeof cell === 'string') { if (cell.length > copyInsertSqlLimits.cellBytes) return fail(text.limit); size = byteLength(cell); }
        copyInsertNumericLiteral(column, cell as CellValue);
      }
      bytes += size;
      if (size > copyInsertSqlLimits.cellBytes || bytes > copyInsertSqlLimits.inputBytes) return fail(text.limit);
    }
  }
  if (byteLength(JSON.stringify(input)) > copyInsertSqlLimits.inputBytes) return fail(text.limit);
}
export const copyInsertSqlInputSchema = z.unknown().transform((value, context): CopyInsertSqlInput => {
  try { assertCopyInsertSqlInput(value); return value; }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : text.invalid }); return z.NEVER; }
});
