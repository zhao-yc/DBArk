import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';

/** 独立读取真实导出字节，只核固定SQL的两行期望；不导入产品列映射、读取器或序列化器。 */
export function verifySelectedResultsCsv(bytes: Buffer): void {
  const records = parse(bytes, { encoding: 'utf8', bom: true, columns: false, cast: false });
  // 标题按原列位置去重；csv-parse只拆字段，NULL/空串/BLOB仍按原始文本分别核对。
  assert.deepEqual(records, [
    ['id', 'repeated', 'repeated [3]', 'bytes'],
    ['1', '18446744073709551615', '\\N', 'base64:AP8='],
    ['3', '0.12345678901234567890', '', '\\N'],
  ], 'CSV必须仅含显示顺序的第1、3行，保留精确字符串、NULL、空串及二进制编码');
}
