import { sqliteDriverLimits, type SqliteValue } from './protocol';

/** 原生读取桥的独立值副本；不作为IPC类型，也不从SQL亲和性猜测存储类型。 */
export interface SqliteRawValue { type: number; encoding: number; bytes: Uint8Array; }
export class SqliteRawValueError extends Error {
  /** 错误正文固定，不带原始值、SQL或文件路径。 */
  constructor(readonly code: 'SQLITE_RAW_VALUE_INVALID' | 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE') {
    super(code === 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' ? 'SQLite源TEXT包含无效编码或无法无损表示的文本，本次操作已停止' : 'SQLite原始值类型、编码或字节预算无效');
  }
}

/** TEXT必须在首次解码时校验；真实U+FFFD、BOM和NUL不能作为坏编码的替代判据。 */
export function decodeSqliteRawValue(value: SqliteRawValue): SqliteValue {
  const invalid = () => new SqliteRawValueError('SQLITE_RAW_VALUE_INVALID');
  if (!value || !Number.isInteger(value.type) || !Number.isInteger(value.encoding) || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength > sqliteDriverLimits.valueBytes) throw invalid();
  const bytes = value.bytes;
  if (value.type !== 3 && value.encoding !== 0) throw invalid();
  if (value.type === 5) { if (bytes.length) throw invalid(); return null; }
  if (value.type === 1 || value.type === 2) {
    if (bytes.length !== 8) throw invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (value.type === 1) return { type: 'integer', value: view.getBigInt64(0, true).toString() };
    const number = view.getFloat64(0, true); if (Number.isNaN(number)) throw invalid();
    return { type: 'real', value: Object.is(number, -0) ? '-0' : String(number) };
  }
  if (value.type === 4) return { type: 'binary', base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') };
  if (value.type !== 3 || ![1, 2, 3].includes(value.encoding)) throw invalid();
  let text: string;
  try { text = new TextDecoder(value.encoding === 1 ? 'utf-8' : value.encoding === 2 ? 'utf-16le' : 'utf-16be', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new SqliteRawValueError('SQLITE_TEXT_ENCODING_UNREPRESENTABLE'); }
  if (Buffer.byteLength(text) > sqliteDriverLimits.valueBytes) throw invalid();
  return text;
}
