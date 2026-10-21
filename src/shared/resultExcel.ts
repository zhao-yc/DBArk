import type { CellValue, ResultExportData } from './contracts';
import { EXCEL_LIMITS } from './excelTransfer';
import { resultExportColumns, validateResultExportData } from './resultExport';
import { resultExcelZh as text } from './resultExcel.zh-CN';

export const resultExcelProtocol = 'dbark-v1' as const;
const encoder = new TextEncoder();

/** 校验原标量和协议额外字符；不把孤立代理项或控制字符静默删除、替换或截断。 */
function validateText(value: string, overhead = 0): void {
  if (value.length + overhead > EXCEL_LIMITS.maxCellCharacters) throw Error(text.length);
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point < 32 && point !== 9 && point !== 10 && point !== 13 || point >= 0xd800 && point <= 0xdfff || point === 0xfffe || point === 0xffff) throw Error(text.characters);
  }
}
/** 只量算dbark-v1输出长度，不复制既有engine编码器；实际编码仍由encodeExcelCell执行。 */
function cellBytes(value: CellValue): number {
  if (value === null) return 2;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'object') { validateText(value.base64, 3); return value.base64.length + 3; }
  const raw = typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value), escape = raw.startsWith('\\') ? 1 : 0;
  validateText(raw, escape); return encoder.encode(raw).byteLength + escape;
}
/** UI与IPC同用的完整预检；沿用原结果预算，并在创建文件前拒绝任何Excel额外限制。 */
export function assertResultExcelData(value: unknown): asserts value is ResultExportData {
  validateResultExportData(value);
  const columns = resultExportColumns(value.columns);
  let headerBytes = 0;
  for (const column of columns) { validateText(column.exportName); headerBytes += encoder.encode(column.exportName).byteLength; }
  if (headerBytes > EXCEL_LIMITS.maxRowBytes) throw Error(text.rowBytes);
  for (const row of value.rows) {
    let bytes = 0;
    for (const column of columns) { bytes += cellBytes(row[column.key]); if (bytes > EXCEL_LIMITS.maxRowBytes) throw Error(text.rowBytes); }
  }
}
