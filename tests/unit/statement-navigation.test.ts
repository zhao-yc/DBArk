import { expect, it } from 'vitest';
import { analyzeStatementNavigation, currentNavigableStatement, statementNavigationPreview, validStatementNavigationResult } from '../../src/shared/statementNavigation';
import { sqlStatementRanges } from '../../src/engine/currentStatement';
import { sqliteStatementRanges } from '../../src/engine/sqlite/currentStatement';
import { SqlScriptScanner as EngineScanner } from '../../src/engine/sql';
import { SqlScriptScanner as SharedScanner } from '../../src/shared/sqlScriptScanner';
import type { CompletionLexicalMode } from '../../src/shared/completionLexical';

const mode = { ansiQuotes: false, noBackslashEscapes: false };
const fields = ({ start, end, delimiterStart, delimiterEnd }: { start: number; end: number; delimiterStart: number; delimiterEnd: number }) => ({ start, end, delimiterStart, delimiterEnd });
it('选中当前语句区分紧邻语句、空白、行末和代理对边界', () => {
  const source = "SELECT '😀';SELECT 2;\r\n  \r\nSELECT 3;";
  const result = analyzeStatementNavigation(source, 'mysql', mode);
  if (result.status !== 'ready') throw Error('本例分段未完成');
  const index = (offset: number) => currentNavigableStatement(source, result.statements, offset);
  const [first, second, third] = result.statements;
  expect(index(first.delimiterStart)).toBe(0);
  expect(index(first.delimiterEnd)).toBe(1);
  expect(index(second.delimiterEnd)).toBe(1);
  expect(index(second.delimiterEnd + 1)).toBe(-1);
  expect(index(third.start - 3)).toBe(-1);
  expect(index(source.indexOf('😀') + 1)).toBe(-1);
  expect(index(source.length)).toBe(2);
});
/** 逐项与原真正执行入口核对，不用新导航器自身的预设分段充当正确性依据。 */
it.each(['mysql', 'mariadb', 'sqlite'] as const)('%s原执行范围与导航完全一致，重复正文/UTF16/注释不猜位置', dialect => {
  const source = dialect === 'sqlite' ? "--无空白注释;😀\r\nSELECT ';中文😀'; SELECT ';中文😀';\r\nCREATE TEMP TRIGGER \"t;\" AFTER INSERT ON sample BEGIN SELECT CASE WHEN 1 THEN ';' END; SELECT 2; END;\nSELECT 3" : "# 注释;😀\r\nSELECT ';中文😀'; SELECT ';中文😀';\nDELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT ';'; SELECT 2; END$$\nDELIMITER ;\nSELECT 3";
  const result = analyzeStatementNavigation(source, dialect, mode); expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('本例分段未完成');
  const original = dialect === 'sqlite' ? sqliteStatementRanges(source) : sqlStatementRanges(source, { ...mode, ansiQuotesKnown: true, noBackslashEscapesKnown: true });
  expect(result.statements).toEqual(original.map(fields)); expect(validStatementNavigationResult(result, source)).toBe(true);
  expect(result.statements.map(range => source.slice(range.start, range.end))).toEqual(original.map(range => range.sql)); expect(result.statements).toHaveLength(4);
});
it('engine与shared导出同一真实类，流式push/setMode/原位置合同不变', () => {
  expect(EngineScanner).toBe(SharedScanner);
  const scanner = new SharedScanner(); expect(scanner.push("SELECT 'a", false)).toEqual([]); expect(scanner.push(";b'; SELECT 2;", true)).toEqual(["SELECT 'a;b'", 'SELECT 2']);
  scanner.setMode(true, true); expect(scanner.pushRanges('SELECT "quoted";', true)[0].sql).toBe('SELECT "quoted"');
});
it.each(['mysql', 'mariadb', 'sqlite'] as const)('%s空白和普通注释没有虚构语句，末尾无分隔符保持EOF', dialect => {
  const empty = dialect === 'sqlite' ? ' --注释\n/* 注释 */' : ' -- 注释\n# 注释\n/* 注释 */'; expect(analyzeStatementNavigation(empty, dialect, mode)).toEqual({ status: 'ready', statements: [] });
  const source = 'SELECT 1 \r\n'; const result = analyzeStatementNavigation(source, dialect, mode); expect(result).toEqual({ status: 'ready', statements: [{ start: 0, end: 8, delimiterStart: source.length, delimiterEnd: source.length }] });
});
it('MySQL未知模式须与所有原执行解释相同，不能在歧义后画部分目录', () => {
  expect(analyzeStatementNavigation('SELECT 1;SELECT 2', 'mysql').status).toBe('ready');
  expect(analyzeStatementNavigation("SELECT 'a\\';SELECT 2;", 'mysql').status).toBe('blocked');
  const source = 'SELECT "a\\";SELECT 2;';
  for (const noBackslashEscapes of [true, false]) for (const ansiQuotes of [true, false]) {
    const settings = { ansiQuotes, noBackslashEscapes }; const value = analyzeStatementNavigation(source, 'mysql', settings);
    let original: ReturnType<typeof sqlStatementRanges>;
    try { original = sqlStatementRanges(source, { ...settings, ansiQuotesKnown: true, noBackslashEscapesKnown: true }); } catch { expect(value.status).toBe('blocked'); continue; }
    expect(value).toEqual({ status: 'ready', statements: original.map(fields) });
  }
});
it.each(['mysql', 'mariadb', 'sqlite'] as const)('%s任何未闭合尾部整份拒绝，不发布前面的成功目录', dialect => {
  for (const source of ["SELECT 1;SELECT 'unterminated", 'SELECT 1; /* unterminated']) expect(analyzeStatementNavigation(source, dialect, mode).status).toBe('blocked');
});
it('SQLite独立规则：拒绝DELIMITER，完整触发器和方括号/BOM遵守原入口', () => {
  expect(analyzeStatementNavigation('DELIMITER $$\nSELECT 1$$', 'sqlite').status).toBe('blocked');
  expect(analyzeStatementNavigation('CREATE TRIGGER t AFTER INSERT ON sample BEGIN SELECT 1;', 'sqlite').status).toBe('blocked');
  const source = '\uFEFFSELECT [a;b] FROM [t]; --comment\nSELECT 2;'; expect(analyzeStatementNavigation(source, 'sqlite')).toEqual({ status: 'ready', statements: sqliteStatementRanges(source).map(fields) });
});
it.each(['mysql', 'mariadb', 'sqlite'] as const)('%s源和1000语句预算拒绝完整超限，不返回1000条截断结果', dialect => {
  expect(analyzeStatementNavigation('SELECT 1;'.repeat(1000), dialect, mode).status).toBe('ready');
  expect(analyzeStatementNavigation('SELECT 1;'.repeat(1001), dialect, mode)).toEqual({ status: 'blocked', reason: 'budget' });
  expect(analyzeStatementNavigation(' '.repeat(262145), dialect, mode)).toEqual({ status: 'blocked', reason: 'budget' });
});
it.each([null, 1, [], { ansiQuotes: 'yes' }, { sql: 'SELECT 1' }])('非法模式拒绝且不抛出原始异常：%j', mode => { expect(analyzeStatementNavigation('SELECT 1', 'mysql', mode as CompletionLexicalMode)).toEqual({ status: 'blocked', reason: 'mode' }); });
it('回包只准本源数字范围，拒越界/无序/重叠/访问器/隐藏字段/坏Unicode', () => {
  const source = 'SELECT 1;SELECT 2;', valid = analyzeStatementNavigation(source, 'mysql', mode); expect(validStatementNavigationResult(valid, source)).toBe(true);
  if (valid.status !== 'ready') throw Error('本例未分段');
  for (const raw of [{ ...valid, sql: source }, { ...valid, statements: [...valid.statements].reverse() }, { ...valid, statements: [valid.statements[0], valid.statements[0]] }, { ...valid, statements: [{ ...valid.statements[0], end: 999 }] }, { ...valid, statements: [{ ...valid.statements[0], sql: source }] }]) expect(validStatementNavigationResult(raw, source)).toBe(false);
  const getter = Object.defineProperty({}, 'status', { get() { throw Error('禁止getter'); }, enumerable: true }); expect(validStatementNavigationResult(getter, source)).toBe(false);
  for (const invalid of ['\0', '\ud800']) expect(validStatementNavigationResult({ status: 'ready', statements: [] }, invalid)).toBe(false);
  expect(validStatementNavigationResult({ status: 'ready', statements: [{ start: 1, end: 2, delimiterStart: 2, delimiterEnd: 2 }] }, '😀')).toBe(false);
  expect(validStatementNavigationResult({ status: 'ready', statements: [{ start: 0, end: 1, delimiterStart: 1, delimiterEnd: 1 }] }, '\r\n')).toBe(false);
});
it('预览按各自注释规则跳过前导说明，执行注释不伪装普通SELECT', () => {
  const mysql = '#前导\n-- 后续\n/* 普通 */ SELECT 1;'; const range = { start: 0, end: mysql.length - 1, delimiterStart: mysql.length - 1, delimiterEnd: mysql.length };
  expect(statementNavigationPreview(mysql, range, 'mysql')).toBe('SELECT 1');
  expect(statementNavigationPreview('--无空白\nSELECT 2', { start: 0, end: 15, delimiterStart: 15, delimiterEnd: 15 }, 'sqlite')).toBe('SELECT 2');
  const special = '/*!80000 SELECT 1 */'; expect(statementNavigationPreview(special, { start: 0, end: special.length, delimiterStart: special.length, delimiterEnd: special.length }, 'mysql')).toBe(special);
  const long = '😀'.repeat(170); const preview = statementNavigationPreview(long, { start: 0, end: long.length, delimiterStart: long.length, delimiterEnd: long.length }, 'sqlite'); expect(preview).toBe('😀'.repeat(160) + '…');
});
