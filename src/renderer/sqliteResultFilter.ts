import type { CellValue } from '../shared/contracts';
import { sqliteResultCellMatches, type SqliteResultFilterType } from '../shared/sqliteResultStorage';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';

export const sqliteResultFilterCodes = { text: 't', integer: 'i', real: 'r', blob: 'b' } as const;

/** 仅解析用户明确选择的类型；原条件文字保持，整数不经Number，不生成SQL。 */
export function sqliteResultFilterLiteral(type: SqliteResultFilterType, input: string): CellValue {
  if (typeof input !== 'string' || input.length > 4096) throw Error(text.budget);
  const raw = type === 'text' ? input : input.trim();
  if (type === 'text') { if (!sqliteResultCellMatches('t', raw)) throw Error(text.sqliteValue); return raw; }
  if (type === 'integer') {
    if (!/^[+-]?\d{1,20}$/.test(raw)) throw Error(text.sqliteValue);
    const value = String(BigInt(raw)); if (!sqliteResultCellMatches('i', value)) throw Error(text.sqliteValue); return value;
  }
  if (type === 'real') {
    // 本地只读比较允许原结果中的正负Infinity；写入入口的有限REAL限制不在这里放宽。
    if (raw.length > 64 || !/^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Infinity)$/.test(raw)) throw Error(text.sqliteValue);
    const parsed = Number(raw), value = Object.is(parsed, -0) ? '-0' : String(parsed);
    if (!sqliteResultCellMatches('r', value) || !Number.isFinite(parsed) && !/^[+-]?Infinity$/.test(raw)) throw Error(text.sqliteValue); return value;
  }
  if (type !== 'blob' || !/^(?:[0-9a-fA-F]{2})*$/.test(raw)) throw Error(text.sqliteValue);
  let bytes = ''; for (let index = 0; index < raw.length; index += 2) bytes += String.fromCharCode(Number.parseInt(raw.slice(index, index + 2), 16));
  return { type: 'binary', base64: btoa(bytes) };
}
