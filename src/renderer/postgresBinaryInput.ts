import { postgresTableLimits } from '../shared/postgresTable';
import { assertBinaryHexInputBudget } from './binaryCell';
import { postgresByteaZh as text } from './locales/postgresBytea.zh-CN';

export const postgresBinaryEditBytes = postgresTableLimits.value / 2;

/** 共用查看器使用带前缀的 Hex，PostgreSQL 字段草稿只持有完整字节的裸 Hex。 */
export function postgresBinaryInputHex(input: string): string {
  assertBinaryHexInputBudget(input);
  const hex = input.replace(/^0x/i, '').replace(/\s/g, '');
  if (hex.length > postgresTableLimits.value) throw Error(text.editLimit);
  return hex;
}
