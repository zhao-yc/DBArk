import { zh } from './locales/zh-CN';
import type { CellValue } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { cellText } from './lib';

export const cellClipboardType = 'application/x-dbark-cells';
const maxClipboardCharacters = 10_000_000;
const maxClipboardCells = 50_000;

/** 兼容电子表格的制表符格式，保留被引号包裹的换行、制表符和双引号。 */
export function parseTabularText(text: string): string[][] {
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.text001);
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, cells = 0;
  const addCell = () => { row.push(value); value = ''; if (++cells > maxClipboardCells) throw new Error(zh.clipboard.text002); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === '') quoted = true;
    else if (char === '\t') addCell();
    else if (char === '\n' || char === '\r') { addCell(); rows.push(row); row = []; if (char === '\r' && text[index + 1] === '\n') index++; }
    else value += char;
  }
  if (quoted) throw new Error(zh.clipboard.text003);
  if (value !== '' || row.length || !rows.length) { addCell(); rows.push(row); }
  return rows;
}

/** 外部程序读取通用 TSV；DBArk 内部复制额外保存 NULL 和二进制类型。 */
export function encodeClipboard(values: CellValue[][]) {
  if (values.reduce((count, row) => count + row.length, 0) > maxClipboardCells) throw new Error(zh.clipboard.copyLimit);
  const quote = (value: CellValue) => { const text = cellText(value); return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
  const typed = JSON.stringify({ version: 1, rows: values });
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  const text = values.map(row => row.map(quote).join('\t')).join('\n');
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  return { text, typed };
}

/** 剪贴板属于外部输入，类型化数据必须逐格校验，不能直接信任 JSON 内容。 */
export function decodeClipboard(typed: string, text: string): CellValue[][] {
  if (!typed) return parseTabularText(text);
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.text004);
  let payload: unknown;
  try { payload = JSON.parse(typed); } catch { throw new Error(zh.clipboard.text005); }
  if (!payload || typeof payload !== 'object' || !('version' in payload) || payload.version !== 1 || !('rows' in payload) || !Array.isArray(payload.rows)) throw new Error(zh.clipboard.text006);
  let count = 0;
  return payload.rows.map((row: unknown) => {
    if (!Array.isArray(row)) throw new Error(zh.clipboard.text007);
    return row.map((value: unknown): CellValue => {
      if (++count > maxClipboardCells) throw new Error(zh.clipboard.text008);
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
      if (value && typeof value === 'object' && 'type' in value && value.type === 'binary' && 'base64' in value && typeof value.base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return { type: 'binary', base64: value.base64 };
      throw new Error(zh.clipboard.text009);
    });
  });
}

/** 先验证整个目标区域再整体暂存，越界、生成列和待删除行均不允许部分粘贴。 */
export function pasteCells(rows: DraftRow[], keys: string[], rowId: string, columnKey: string, values: CellValue[][], generated: ReadonlySet<string>): DraftRow[] {
  const startRow = rows.findIndex(row => row.id === rowId), startColumn = keys.indexOf(columnKey);
  if (startRow < 0 || startColumn < 0) throw new Error(zh.clipboard.text010);
  if (!values.length) return rows;
  if (startRow + values.length > rows.length || values.some(row => startColumn + row.length > keys.length)) throw new Error(zh.clipboard.text011);
  values.forEach((row, rowIndex) => {
    if (rows[startRow + rowIndex].deleted) throw new Error(zh.clipboard.text012);
    row.forEach((_, columnIndex) => { if (generated.has(keys[startColumn + columnIndex])) throw new Error(zh.clipboard.text013); });
  });
  return rows.map((row, index) => index < startRow || index >= startRow + values.length ? row : { ...row, data: { ...row.data, ...Object.fromEntries(values[index - startRow].map((value, columnIndex) => [keys[startColumn + columnIndex], value])) } });
}
