import type { CellValue, DataRow, ResultExportData, TablePage } from '../shared/contracts';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';
import type { DraftRow } from './dataChanges';
import { tablePageExportZh as text } from './locales/tablePageExport.zh-CN';

/** 原格只接受自有数据属性，不能让导出或漂移检查执行getter。 */
function own(row: DataRow, key: string): CellValue { const field = Object.getOwnPropertyDescriptor(row, key); if (!field || !('value' in field)) throw Error(text.stale); return field.value; }
/** 原始二进制包装可经过structuredClone；逐项比较自有属性，不将其转为文本或解码。 */
function binary(value: CellValue): string | undefined {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2) return;
  const type = Object.getOwnPropertyDescriptor(value, 'type'), base64 = Object.getOwnPropertyDescriptor(value, 'base64');
  return type && base64 && 'value' in type && 'value' in base64 && type.value === 'binary' && typeof base64.value === 'string' ? base64.value : undefined;
}
/** 任何未提交或漂移值均拒绝，精确字符串不做数值转换。 */
function same(a: CellValue, b: CellValue): boolean { if (a && typeof a === 'object' || b && typeof b === 'object') { const left = binary(a), right = binary(b); return left !== undefined && right !== undefined && left === right; } return Object.is(a, b); }

/** 从准确原页及当前草稿身份生成独立快照；空勾选从不回退全页，隐藏列不克隆或传文件。 */
export function snapshotTablePageExport(page: TablePage, rows: readonly DraftRow[], visible: readonly string[], selected?: ReadonlySet<string>): ResultExportData {
  const fail = () => { throw Error(text.stale); }, columns = page.columns;
  if (!columns.length || columns.length > resultExportLimits.columns || page.rows.length !== rows.length || rows.length > resultExportLimits.rows || rows.length * columns.length > resultExportLimits.cells || !visible.length || new Set(visible).size !== visible.length || new Set(columns.map(column => column.key)).size !== columns.length || rows.some(row => !row.id || typeof row.id !== 'string') || new Set(rows.map(row => row.id)).size !== rows.length) fail();
  const outputColumns = visible.map(key => { const column = columns.find(column => column.key === key); if (!column) return fail(); return { key: column.key, name: column.name }; });
  if (selected && (!selected.size || selected.size > rows.length || [...selected].some(id => !rows.some(row => row.id === id)))) fail();
  const output: DataRow[] = [];
  for (const [index, row] of rows.entries()) {
    const source = page.rows[index];
    if (row.inserted || row.deleted || !row.original || [source, row.data, row.original].some(value => !value || Object.keys(value).length !== columns.length)) fail();
    for (const column of columns) if (!same(own(source, column.key), own(row.original!, column.key)) || !same(own(source, column.key), own(row.data, column.key))) fail();
    if (selected && !selected.has(row.id)) continue;
    const record: DataRow = Object.create(null);
    for (const key of visible) { const value = own(source, key); record[key] = value && typeof value === 'object' ? { type: 'binary', base64: binary(value)! } : value; }
    output.push(record);
  }
  const data: ResultExportData = { columns: outputColumns, rows: output, truncated: false };
  validateResultExportData(data); return structuredClone(data);
}
