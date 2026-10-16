import { zh } from './locales/zh-CN';
import type { CellValue } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { cellText } from './lib';

export const cellClipboardType = 'application/x-dbark-cells';
/** undefined 仅表示新增行尚未填写的 DEFAULT，不能编码成实际 NULL。 */
export type ClipboardCell = CellValue | undefined;
export const maxClipboardCharacters = 10_000_000;
export const maxClipboardCells = 50_000;

/** 兼容电子表格的制表符格式，保留被引号包裹的换行、制表符和双引号。 */
export function parseTabularText(text: string): string[][] {
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.text001);
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, cells = 0;
  /** 每个分隔符完成一个单元格，并在构建矩阵时限制总规模。 */
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
export function encodeClipboard(values: ClipboardCell[][]) {
  if (values.reduce((count, row) => count + row.length, 0) > maxClipboardCells) throw new Error(zh.clipboard.copyLimit);
  /** 仅对含分隔符或引号的值加引号，确保电子表格可完整还原单元格边界。 */
  const quote = (value: ClipboardCell) => { const text = cellText(value); return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
  const typed = JSON.stringify({ version: 1, rows: values.map(row => row.map(value => value === undefined ? { type: 'default' } : value)) });
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  const text = values.map(row => row.map(quote).join('\t')).join('\n');
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  return { text, typed };
}

/** 剪贴板属于外部输入，类型化数据必须逐格校验，不能直接信任 JSON 内容。 */
export function decodeClipboard(typed: string, text: string): ClipboardCell[][] {
  if (!typed) return parseTabularText(text);
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.text004);
  let payload: unknown;
  try { payload = JSON.parse(typed); } catch { throw new Error(zh.clipboard.text005); }
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'version') || !('version' in payload) || payload.version !== 1 || !Object.hasOwn(payload, 'rows') || !('rows' in payload) || !Array.isArray(payload.rows)) throw new Error(zh.clipboard.text006);
  let count = 0;
  return payload.rows.map((row: unknown) => {
    if (!Array.isArray(row)) throw new Error(zh.clipboard.text007);
    return row.map((value: unknown): ClipboardCell => {
      if (++count > maxClipboardCells) throw new Error(zh.clipboard.text008);
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
      if (value && typeof value === 'object' && Object.hasOwn(value, 'type') && 'type' in value && value.type === 'default' && Object.keys(value).length === 1) return undefined;
      if (value && typeof value === 'object' && Object.hasOwn(value, 'type') && 'type' in value && value.type === 'binary' && Object.hasOwn(value, 'base64') && 'base64' in value && typeof value.base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return { type: 'binary', base64: value.base64 };
      throw new Error(zh.clipboard.text009);
    });
  });
}

/** 先验证整个目标区域再整体暂存，越界、生成列和待删除行均不允许部分粘贴。 */
export function pasteCells(rows: DraftRow[], keys: string[], rowId: string, columnKey: string, values: ClipboardCell[][], generated: ReadonlySet<string>): DraftRow[] {
  const startRow = rows.findIndex(row => row.id === rowId), startColumn = keys.indexOf(columnKey);
  if (startRow < 0 || startColumn < 0) throw new Error(zh.clipboard.text010);
  if (!values.length) return rows;
  if (startRow + values.length > rows.length || values.some(row => startColumn + row.length > keys.length)) throw new Error(zh.clipboard.text011);
  values.forEach((row, rowIndex) => {
    if (rows[startRow + rowIndex].deleted) throw new Error(zh.clipboard.text012);
    if (!rows[startRow + rowIndex].inserted && row.some(value => value === undefined)) throw new Error(zh.clipboard.defaultExisting);
    row.forEach((_, columnIndex) => { if (generated.has(keys[startColumn + columnIndex])) throw new Error(zh.clipboard.text013); });
  });
  return rows.map((row, index) => {
    if (index < startRow || index >= startRow + values.length) return row;
    const pasted = values[index - startRow];
    const defaults = new Set(pasted.flatMap((value, columnIndex) => value === undefined ? [keys[startColumn + columnIndex]] : []));
    // 自有条目和安全计算属性构建新对象；DEFAULT 删除字段，不触发 __proto__ setter 或继承原型成员。
    const existing = defaults.size ? Object.fromEntries(Object.entries(row.data).filter(([key]) => !defaults.has(key))) : row.data;
    const patch = Object.fromEntries(pasted.flatMap((value, columnIndex) => value === undefined ? [] : [[keys[startColumn + columnIndex], structuredClone(value)]]));
    return { ...row, data: { ...existing, ...patch } };
  });
}
