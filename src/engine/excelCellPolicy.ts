import type { CellValue } from '../shared/contracts';
import { EXCEL_LIMITS, type ExcelColumn, type ExcelTextProtocol, type ExcelWritableCell } from '../shared/excelTransfer';

/** XML 1.0 无法无损存储孤立代理项或控制字符，明确拒绝而不是静默删除。 */
export function validateExcelText(text: string): string {
  if (text.length > EXCEL_LIMITS.maxCellCharacters) throw new Error('单元格超过 Excel 的 32767 字符上限，请改用 JSON 导出');
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if ((point < 32 && ![9, 10, 13].includes(point)) || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) throw new Error('单元格包含 XLSX 无法无损表示的字符，请改用 JSON 导出');
  }
  return text;
}

/** OOXML 转义必须保护字面 _xHHHH_，且回车不可依赖 XML 换行归一化保存。 */
export function encodeExcelXmlText(text: string): string {
  validateExcelText(text);
  return text.replace(/_x[0-9a-fA-F]{4}_/g, match => '_x005F_' + match.slice(1)).replaceAll('\r', '_x000D_').replaceAll('\u007f', '_x007F_');
}

/** 一次性解码，避免把 _x005F_x0041_ 再递归误解为字母 A。 */
export function decodeExcelXmlText(text: string): string {
  return validateExcelText(text.replace(/_x([0-9a-fA-F]{4})_/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16))));
}

/** 数字一律写成文本，保留 BIGINT/DECIMAL、浮点往返值与微秒时间，不交给 Excel 的 15 位精度。 */
export function encodeExcelCell(value: CellValue, column: ExcelColumn): ExcelWritableCell {
  if (value === null) return '\\N';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`字段 ${column.name} 包含非有限数字，无法导出`);
    if (/^(?:bigint|decimal|numeric)\b/i.test(column.type)) throw new Error(`字段 ${column.name} 的精确数字必须由驱动提供原始文本`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value) && !/^(?:float|double|real)\b/i.test(column.type)) throw new Error(`字段 ${column.name} 包含无法确认精度的整数，请使用原始文本`);
  }
  if (typeof value === 'object') {
    if (value.base64.length > EXCEL_LIMITS.maxCellCharacters - 3) throw new Error('二进制 Base64 超过 Excel 单元格上限，请改用 JSON 导出');
    if (value.type !== 'binary' || !isCanonicalBase64(value.base64)) throw new Error(`字段 ${column.name} 包含无效二进制值`);
    return validateExcelText('\\B:' + value.base64);
  }
  const text = typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value);
  return validateExcelText(text.startsWith('\\') ? '\\' + text : text);
}

/** 严格的规范 Base64 避免 Node 宽松解码把输入悄悄改写。 */
export function isCanonicalBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
}

/** 普通工作簿不解释反斜线；用户显式选择 DBArk 协议后才还原 NULL 和二进制标记。 */
export function decodeExcelText(text: string, protocol: ExcelTextProtocol): CellValue {
  validateExcelText(text);
  if (protocol === 'plain') return text;
  if (protocol !== 'dbark-v1') throw new Error('不支持的 Excel 文本协议');
  if (text === '\\N') return null;
  if (text.startsWith('\\\\')) return text.slice(1);
  if (text.startsWith('\\B:')) {
    const base64 = text.slice(3);
    if (!isCanonicalBase64(base64)) throw new Error('工作簿含无效的 DBArk 二进制标记');
    return { type: 'binary', base64 };
  }
  if (text.startsWith('\\')) throw new Error('工作簿含未转义的 DBArk 文本，请选择普通 Excel 文本或修正来源');
  return text;
}

/** 标题保持原样，禁止空标题和重复标题，避免按名字映射时发生数据覆盖。 */
export function validateExcelHeaders(headers: string[]): string[] {
  if (!headers.length || headers.length > EXCEL_LIMITS.maxColumns) throw new Error('工作表字段数量超出范围');
  if (headers.some(name => !name.length) || new Set(headers).size !== headers.length) throw new Error('Excel 标题不能包含重复或空字段名');
  return headers.map(validateExcelText);
}
