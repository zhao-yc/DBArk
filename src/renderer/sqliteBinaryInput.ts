import type { CellValue } from '../shared/contracts';
import { sqliteTableEditLimits } from '../shared/sqliteTableEdit';
import { assertBinaryHexInputBudget, binaryCellLimits } from './binaryCell';
import { binaryCellZh as binaryText } from './locales/binaryCell.zh-CN';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';

/** 缓冲允许未完成Hex；先核原始输入预算，再去除前缀／空白，最终合法性仍由SQLite修改合同裁决。 */
export function sqliteBinaryInputHex(input: string): string {
  assertBinaryHexInputBudget(input);
  const hex = input.replace(/^0x/i, '').replace(/\s/g, '');
  if (hex.length > sqliteTableEditLimits.valueUnits) throw Error(text.blobEditLimit);
  return hex;
}

/** 只读大BLOB从完整原Hex转换，不用可编辑片段；分配前核完整查看预算。 */
export function sqliteBinaryOriginalCell(hex: string): CellValue {
  if (hex.length > binaryCellLimits.bytes * 2) throw Error(binaryText.byteLimit);
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw Error(binaryText.hexInvalid);
  let raw = '';
  for (let start = 0; start < hex.length; start += 8192) {
    const part = hex.slice(start, start + 8192); let chunk = '';
    for (let i = 0; i < part.length; i += 2) chunk += String.fromCharCode(Number.parseInt(part.slice(i, i + 2), 16));
    raw += chunk;
  }
  return { type: 'binary', base64: btoa(raw) };
}
