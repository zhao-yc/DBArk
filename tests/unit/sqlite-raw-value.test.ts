import { describe, expect, it } from 'vitest';
import { decodeSqliteRawValue, SqliteRawValueError } from '../../src/engine/sqlite/rawValue';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';

/** 显式组装小端数值，包含非零byteOffset，不能读取邻格或损失64位。 */
function numeric(type: number, value: bigint | number) {
  const bytes = new Uint8Array(12).subarray(2, 10), view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  if (typeof value === 'bigint') view.setBigInt64(0, value, true); else view.setFloat64(0, value, true);
  return { type, encoding: 0, bytes };
}
describe('SQLite原字节值解码，尚未替换工作区驱动', () => {
  it.each([-9223372036854775808n, 0n, 9223372036854775807n])('INTEGER原字节保留%s', value => {
    expect(decodeSqliteRawValue(numeric(1, value))).toEqual({ type: 'integer', value: value.toString() });
  });
  it.each([-0, 1.25, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity])('REAL原字节保留%s', value => {
    expect(decodeSqliteRawValue(numeric(2, value))).toEqual({ type: 'real', value: Object.is(value, -0) ? '-0' : String(value) });
  });
  it.each([1, 2, 3])('编码%s保留BOM、NUL、Unicode和真实替代字符', encoding => {
    const text = '\uFEFF前\0🚢\uFFFD后', bytes = Buffer.from(text, encoding === 1 ? 'utf8' : 'utf16le');
    if (encoding === 3) bytes.swap16();
    expect(decodeSqliteRawValue({ type: 3, encoding, bytes })).toBe(text);
    expect(decodeSqliteRawValue({ type: 3, encoding, bytes: new Uint8Array() })).toBe('');
  });
  it.each([[1, '80'], [1, 'c080'], [1, 'eda080'], [1, 'f4908080'], [1, 'e282'], [2, '00d8'], [2, '00dc'], [2, '01'], [3, 'd800'], [3, 'dc00'], [3, '01']])('编码%s的坏原字节%s明确拒绝', (encoding, hex) => {
    expect(() => decodeSqliteRawValue({ type: 3, encoding: Number(encoding), bytes: Buffer.from(String(hex), 'hex') })).toThrowError(expect.objectContaining({ code: 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' }));
  });
  it('NULL、空BLOB和无效Unicode的BLOB不混淆', () => {
    expect(decodeSqliteRawValue({ type: 5, encoding: 0, bytes: new Uint8Array() })).toBeNull();
    expect(decodeSqliteRawValue({ type: 4, encoding: 0, bytes: new Uint8Array() })).toEqual({ type: 'binary', base64: '' });
    expect(decodeSqliteRawValue({ type: 4, encoding: 0, bytes: new Uint8Array([128, 255]) })).toEqual({ type: 'binary', base64: 'gP8=' });
  });
  it('非法类型、编码、宽度、NaN及原字节预算先拒绝', () => {
    for (const input of [{ type: 0, encoding: 0, bytes: new Uint8Array() }, { type: 3, encoding: 4, bytes: new Uint8Array() }, { type: 4, encoding: 1, bytes: new Uint8Array() }, { type: 5, encoding: 0, bytes: new Uint8Array([0]) }, { type: 1, encoding: 0, bytes: new Uint8Array(7) }, numeric(2, NaN), { type: 4, encoding: 0, bytes: new Uint8Array(sqliteDriverLimits.valueBytes + 1) }]) {
      expect(() => decodeSqliteRawValue(input)).toThrowError(SqliteRawValueError);
    }
  });
  it('源UTF16未超预算但转成UTF8后超量仍拒绝，保持原单值门槛', () => {
    expect(() => decodeSqliteRawValue({ type: 3, encoding: 2, bytes: Buffer.from('中'.repeat(sqliteDriverLimits.valueBytes / 2), 'utf16le') })).toThrowError(expect.objectContaining({ code: 'SQLITE_RAW_VALUE_INVALID' }));
  });
});
