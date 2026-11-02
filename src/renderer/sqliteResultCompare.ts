import type { CellValue } from '../shared/contracts';
import { sqliteResultCellMatches } from '../shared/sqliteResultStorage';
import { sqliteResultStorageZh as text } from '../shared/sqliteResultStorage.zh-CN';

export type SqliteResultComparisonKey =
  | { readonly sqlite: true; readonly storage: 'number'; readonly value: bigint | number }
  | { readonly sqlite: true; readonly storage: 'text' | 'blob'; readonly bytes: Uint8Array };

/** 类型来自原driver标记；INTEGER不经Number，REAL按原binary64，文本使用固定UTF-8字节序。 */
export function sqliteResultComparisonKey(value: CellValue, code: string, ignoreCase = false): SqliteResultComparisonKey | null {
  if (!sqliteResultCellMatches(code, value)) throw Error(text.invalid);
  if (code === 'n') return null;
  if (code === 'i') return { sqlite: true, storage: 'number', value: BigInt(value as string) };
  if (code === 'r') return { sqlite: true, storage: 'number', value: Number(value) };
  if (code === 't') return { sqlite: true, storage: 'text', bytes: new TextEncoder().encode(ignoreCase ? (value as string).toLowerCase() : value as string) };
  const raw = atob((value as { type: 'binary'; base64: string }).base64);
  return { sqlite: true, storage: 'blob', bytes: Uint8Array.from(raw, character => character.charCodeAt(0)) };
}

/** 仅比较自有已解析键：数值、文本、字节依序；整数与实数按数学值比较，不舍入整数。 */
export function compareSqliteResultKeys(left: SqliteResultComparisonKey, right: SqliteResultComparisonKey): number {
  const rank = { number: 0, text: 1, blob: 2 };
  if (left.storage !== right.storage) return rank[left.storage] - rank[right.storage];
  if (left.storage === 'number' && right.storage === 'number') return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  if (left.storage === 'number' || right.storage === 'number') throw Error(text.invalid);
  for (let index = 0; index < Math.min(left.bytes.length, right.bytes.length); index++) if (left.bytes[index] !== right.bytes[index]) return left.bytes[index] < right.bytes[index] ? -1 : 1;
  return left.bytes.length === right.bytes.length ? 0 : left.bytes.length < right.bytes.length ? -1 : 1;
}
