import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DatabaseSearchPattern } from '../../shared/databaseSearchPattern';

export const sqliteSearchValueBytes = 2 * 1024 * 1024;
export const sqliteSearchKeyRawBytes = 4096;
export const sqliteSearchFunctions = {
  match: 'dbark_search_match', preview: 'dbark_search_preview', key: 'dbark_search_key',
  fieldStamp: 'dbark_search_field_stamp', rowStamp: 'dbark_search_row_stamp',
} as const;

const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const numberText = (value: bigint | number) => Object.is(value, -0) ? '-0' : String(value);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > sqliteSearchValueBytes) throw Error('SQLite 搜索字段超过 2 MiB 原值预算');
  return value;
}

function preview(value: string, width: number) {
  let characters = 0, end = 0;
  for (const character of value) { if (characters++ < width) end += character.length; }
  return { text: value.slice(0, end), characters: String(characters), truncated: characters > width };
}

/** 函数只装到 Main 指定的物理只读搜索会话。模式和原值不进入任务日志。 */
export function installSqliteSearchFunctions(db: DatabaseSync, decoder: TextDecoder, fail: (error: unknown) => never) {
  const options = { deterministic: true, directOnly: true, useBigIntArguments: true };
  let cached: string | undefined, pattern: DatabaseSearchPattern | undefined, regex: RegExp | undefined;
  const text = (kind: string, raw: unknown, hex: boolean) => {
    const source = bytes(raw);
    return kind === 'blob' || hex ? Buffer.from(source).toString('hex').toUpperCase() : decoder.decode(source);
  };
  const typed = (kind: string, raw: unknown, numeric: unknown) => {
    if (kind === 'null') return '';
    if (kind === 'integer' && typeof numeric === 'bigint' || kind === 'real' && typeof numeric === 'number') return numberText(numeric);
    if (kind === 'text' || kind === 'blob') return bytes(raw);
    throw Error('SQLite 搜索存储类型无效');
  };
  db.function(sqliteSearchFunctions.match, options, (kind, raw, hex, wire, width) => {
    try {
      if (kind === 'null') return null;
      if (typeof kind !== 'string' || typeof wire !== 'string' || typeof width !== 'bigint' || width < 1n || width > 4096n)
        throw Error('SQLite 搜索条件无效');
      if (wire !== cached) {
        // Main 已验证完整 IPC 请求。此处只接受内部匹配所需的形状，独立 worker 无须加载应用依赖。
        const next = JSON.parse(wire) as DatabaseSearchPattern;
        if (!next || !['contains', 'whole', 'prefix', 'regexp'].includes(next.mode) ||
            typeof next.text !== 'string' || typeof next.caseSensitive !== 'boolean') throw Error('SQLite 搜索条件无效');
        const compiled = next.mode === 'regexp' ? new RegExp(next.text, next.caseSensitive ? 'u' : 'iu') : undefined;
        pattern = next; regex = compiled; cached = wire;
      }
      const value = text(kind, raw, hex === 1n), rules = pattern!;
      const needle = rules.caseSensitive ? rules.text : fold(rules.text), comparable = rules.caseSensitive ? value : fold(value);
      const found = regex ? regex.test(value) : rules.mode === 'whole' ? comparable === needle
        : rules.mode === 'prefix' ? comparable.startsWith(needle) : comparable.includes(needle);
      return found ? JSON.stringify(preview(value, Number(width))) : null;
    } catch (reason) { return fail(reason); }
  });
  db.function(sqliteSearchFunctions.preview, options, (kind, raw, width) => {
    try {
      if (kind === 'null') return null;
      if (typeof kind !== 'string' || typeof width !== 'bigint' || width < 1n || width > 4096n) throw Error('SQLite 定位字段预算无效');
      if (kind !== 'blob') return JSON.stringify({ ...preview(text(kind, raw, false), Number(width)), binary: false });
      const source = bytes(raw);
      return JSON.stringify({ text: Buffer.from(source.subarray(0, Number(width))).toString('base64'),
        characters: String(source.byteLength), truncated: source.byteLength > Number(width), binary: true });
    } catch (reason) { return fail(reason); }
  });
  db.function(sqliteSearchFunctions.key, options, (kind, raw, numeric) => {
    try {
      if (kind === 'null') return null;
      if (typeof kind !== 'string') throw Error('SQLite 搜索键类型无效');
      const value = typed(kind, raw, numeric);
      if (value.length > sqliteSearchKeyRawBytes) return null;
      return JSON.stringify([kind, typeof value === 'string' ? value : Buffer.from(value).toString('base64')]);
    } catch (reason) { return fail(reason); }
  });
  db.function(sqliteSearchFunctions.fieldStamp, options, (kind, raw, numeric) => {
    try {
      if (typeof kind !== 'string') throw Error('SQLite 搜索字段类型无效');
      return createHash('sha256').update(kind + ':').update(typed(kind, raw, numeric)).digest('hex');
    } catch (reason) { return fail(reason); }
  });
  db.function(sqliteSearchFunctions.rowStamp, options, value => typeof value === 'string' ? hash(value) : null);
}
