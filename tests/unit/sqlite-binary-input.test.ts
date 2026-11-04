import { expect, it } from 'vitest';
import { sqliteBinaryInputHex, sqliteBinaryOriginalCell } from '../../src/renderer/sqliteBinaryInput';
import { sqliteEditValueSchema } from '../../src/shared/sqliteTableEdit';
import { sqliteTableEditZh as text } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

it('只规范BLOB前缀与空白，保留大小写、零字节及未完成输入，最终由原合同判断合法性', () => {
  expect(sqliteBinaryInputHex('0x00 Ff\n80')).toBe('00Ff80'); expect(sqliteBinaryInputHex('0x')).toBe('');
  for (const raw of ['0x0', 'GG']) expect(sqliteEditValueSchema.safeParse({ kind: 'blob', value: sqliteBinaryInputHex(raw) }).success).toBe(false);
  const maximum = 'aF'.repeat(32768); expect(sqliteBinaryInputHex('0x' + maximum)).toBe(maximum);
  expect(() => sqliteBinaryInputHex('aa'.repeat(32769))).toThrow(text.blobEditLimit);
  expect(() => sqliteBinaryInputHex(' '.repeat(262145))).toThrow();
  expect(sqliteEditValueSchema.safeParse({ kind: 'blob', value: maximum + 'aa' }).success).toBe(false);
});
it.each([0, 1, 4097, 32769, 2 * 1024 * 1024])('完整原值%s字节可只读编码，绝不把Hex显示片段当原值', size => {
  const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = i % 256;
  expect(sqliteBinaryOriginalCell(bytes.toString('hex'))).toEqual({ type: 'binary', base64: bytes.toString('base64') });
});
it('原值超限、奇数字符或非法字节明确拒绝，不使用Buffer宽松截断', () => {
  for (const raw of ['00xz', 'a', '0x00', 'ff ff']) expect(() => sqliteBinaryOriginalCell(raw)).toThrow();
  expect(() => sqliteBinaryOriginalCell('00'.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MiB');
});
