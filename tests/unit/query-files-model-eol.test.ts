import { expect, it } from 'vitest';
import { assertSqlFilesModelText, recentSql } from '../helpers/queryFilesNative';

it.each([
  { stored: '甲\n乙\n', model: { sql: '甲\r\n乙\r\n', eol: '\r\n' } },
  { stored: '甲\r\n乙\r\n', model: { sql: '甲\n乙\n', eol: '\n' } },
])('只用实际getter的已知EOL比较原模型，Main原文和实际模型均不改写：$model.eol', ({ stored, model }) => {
  const before = { ...model }, bytes = Buffer.from(stored); expect(() => assertSqlFilesModelText(stored, model)).not.toThrow(); expect(model).toEqual(before); expect(Buffer.from(stored)).toEqual(bytes);
});
it.each(['', '\r', 'AUTO'])('未知EOL %j即拒绝，即使正文恰好相等', eol => {
  expect(() => assertSqlFilesModelText('原文字', { sql: '原文字', eol })).toThrow('EOL');
});
it('已知CRLF不能掩盖正文差异、末尾缺行或实际模型未按声明EOL换行', () => {
  for (const sql of ['甲\r\n丙\r\n', '甲\r\n乙', '甲\n乙\n']) expect(() => assertSqlFilesModelText('甲\n乙\n', { sql, eol: '\r\n' })).toThrow('正文');
});
it.each(['甲\r\n乙\n', '甲\r乙'])('原存储样本混合或裸CR不通过模型归一化消除：%j', stored => {
  expect(() => assertSqlFilesModelText(stored, { sql: '甲\n乙\n', eol: '\n' })).toThrow('混合换行');
});
it('LF最近样本仍为独立原文和逐字节LF；模型CRLF不改变文件预期', () => {
  const expected = Buffer.from("-- 最近文件合成样本\nSELECT '原用户明确选择';\n", 'utf8'); expect(Buffer.from(recentSql)).toEqual(expected); expect(recentSql).not.toContain('\r');
  expect(() => assertSqlFilesModelText(recentSql, { sql: "-- 最近文件合成样本\r\nSELECT '原用户明确选择';\r\n", eol: '\r\n' })).not.toThrow(); expect(Buffer.from(recentSql)).toEqual(expected);
});
