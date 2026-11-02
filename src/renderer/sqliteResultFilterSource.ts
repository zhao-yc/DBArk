import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import { sqliteResultCellMatches, type SqliteResultFilterType } from '../shared/sqliteResultStorage';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';

export interface SqliteResultFilterLiteral { readonly value: CellValue; readonly literal: string; readonly sqliteType?: SqliteResultFilterType; }
export interface SqliteResultFilterSource { current(): boolean; literal(index: number, key: string): SqliteResultFilterLiteral; }
const fail = (): never => { throw Error(text.cellUnavailable); };
/** 只读自有数据描述符，索引验证不接触未选择单元格或调用其getter。 */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return fail();
  const field = Object.getOwnPropertyDescriptor(value, key); if (!field?.enumerable || !('value' in field)) return fail(); return field.value;
}
/** 数组先核预算和稠密索引；行数组的length是内置非枚举字段，只由专用端口读取。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const count = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(count) || count < 0) return fail(); if (count > maximum) throw Error(text.budget);
  if (Reflect.ownKeys(value).length !== count + 1) return fail();
  return Array.from({ length: count }, (_, index) => own(value, String(index)));
}
/** 存储类型对象只允许版本与代码行，不解析SQL或其它结果字段。 */
function storage(value: unknown): object {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const keys = Reflect.ownKeys(value); if (keys.length !== 2 || !keys.includes('version') || !keys.includes('rows') || own(value, 'version') !== 1) return fail(); return value;
}
/** 绑定完整坐标和代码；原值只在literal读取选中格时验证，不扫描未勾选格内容。 */
export function captureSqliteResultFilterSource(source: QueryResult | undefined, visible: readonly ResultColumn[], rows: readonly DataRow[]): SqliteResultFilterSource {
  if (!source || own(source, 'rows') !== rows) return fail();
  const columns = own(source, 'columns') as ResultColumn[], columnRefs = array(columns, 1024) as ResultColumn[], rowRefs = array(rows, 100000) as DataRow[];
  if (!columnRefs.length || columnRefs.length * rowRefs.length > 2000000) throw Error(text.budget);
  if (new Set(rowRefs).size !== rowRefs.length || rowRefs.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return fail();
  const metadata = columnRefs.map(column => ({ key: own(column, 'key'), name: own(column, 'name'), type: own(column, 'type') }));
  if (metadata.some(column => typeof column.key !== 'string' || !column.key || column.key.length > 4096 || typeof column.name !== 'string' || column.name.length > 4096 || column.type !== 'SQLITE') || new Set(metadata.map(column => column.key)).size !== metadata.length || visible.some(column => !columnRefs.includes(column))) return fail();
  const descriptor = Object.getOwnPropertyDescriptor(source, 'sqliteStorage');
  if (descriptor && (!descriptor.enumerable || !('value' in descriptor))) return fail();
  const original = descriptor ? storage(descriptor.value) : undefined, codeRows = original ? own(original, 'rows') : undefined;
  const codes = original ? array(codeRows, 100000) : undefined;
  if (codes && (codes.length !== rowRefs.length || codes.some(code => typeof code !== 'string' || code.length !== columnRefs.length || /[^irtbn]/.test(code)))) return fail();
  let live = true;
  /** 任一已观测身份／代码变化永久失效；恢复旧对象不能重用原捕获。 */
  function current(): boolean {
    if (!live) return false;
    try {
      if (own(source, 'rows') !== rows || own(source, 'columns') !== columns) return live = false;
      const nowColumns = array(columns, 1024), nowRows = array(rows, 100000);
      if (nowColumns.length !== columnRefs.length || nowRows.length !== rowRefs.length || nowRows.some((row, index) => row !== rowRefs[index]) || nowColumns.some((column, index) => column !== columnRefs[index] || ['key', 'name', 'type'].some(key => own(column, key) !== metadata[index][key as keyof typeof metadata[number]]))) return live = false;
      const property = Object.getOwnPropertyDescriptor(source, 'sqliteStorage');
      if (!original) return property ? live = false : true;
      if (!property?.enumerable || !('value' in property) || property.value !== original || storage(original) !== original || own(original, 'rows') !== codeRows) return live = false;
      const nowCodes = array(codeRows, 100000); if (nowCodes.length !== codes!.length || nowCodes.some((code, index) => code !== codes![index])) return live = false;
      return true;
    } catch { return live = false; }
  }
  /** 只从准确原行读取一个格；BLOB在解码前核完整十六进制的最终输入长度。 */
  function literal(index: number, key: string): SqliteResultFilterLiteral {
    const position = metadata.findIndex(column => column.key === key);
    if (!live || !Number.isSafeInteger(index) || index < 0 || index >= rowRefs.length || position < 0 || own(rows, String(index)) !== rowRefs[index]) return fail();
    const value = own(rowRefs[index], key) as CellValue, code = codes?.[index] as string | undefined;
    const kind = code?.[position];
    if (value === null) { if (kind !== undefined && kind !== 'n') return fail(); return { value, literal: '' }; }
    if (!kind) throw Error(text.sqliteUnknown);
    if (typeof value === 'string' && value.length > 4096) throw Error(text.budget);
    if (kind === 'b') {
      const bytes = own(value, 'base64'); if (typeof bytes !== 'string') return fail();
      const size = bytes.length / 4 * 3 - (bytes.endsWith('==') ? 2 : bytes.endsWith('=') ? 1 : 0); if (size * 2 > 4096) throw Error(text.budget);
    }
    if (!sqliteResultCellMatches(kind, value)) return fail();
    if (kind === 'b') { const raw = atob(own(value, 'base64') as string); let hex = ''; for (const byte of raw) hex += byte.charCodeAt(0).toString(16).padStart(2, '0'); return { value, literal: hex, sqliteType: 'blob' }; }
    const sqliteType = ({ i: 'integer', r: 'real', t: 'text' } as const)[kind as 'i' | 'r' | 't'];
    if (!sqliteType) return fail(); return { value, literal: value as string, sqliteType };
  }
  return { current, literal };
}
