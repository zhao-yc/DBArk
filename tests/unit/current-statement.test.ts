import { describe, expect, it } from 'vitest';
import { currentSqlStatement, sqlStatementRanges } from '../../src/engine/currentStatement';
import { SqlScriptScanner, splitSql, type SqlStatementRange } from '../../src/engine/sql';
import type { SqlLexicalMode } from '../../src/shared/queryParameters';

const ordinary: SqlLexicalMode = { noBackslashEscapes: false, ansiQuotes: false };
const noEscapes: SqlLexicalMode = { noBackslashEscapes: true, ansiQuotes: false };
const unknown: SqlLexicalMode = { noBackslashEscapes: false, ansiQuotes: false, noBackslashEscapesKnown: false, ansiQuotesKnown: false };

/** 标记只表示真实原文的UTF-16光标，不作为解析器输入，也不转换换行。 */
function at(marked: string, mode = ordinary) {
  const offset = marked.indexOf('┃'); if (offset < 0 || marked.lastIndexOf('┃') !== offset) throw new Error('测试光标标记须唯一');
  return currentSqlStatement(marked.replace('┃', ''), offset, mode);
}

/** 每一个范围都必须严格回读同一原文；分隔符和结束位置另行验证。 */
function assertSlices(source: string, ranges: SqlStatementRange[]) {
  let previousEnd = 0;
  for (const range of ranges) {
    expect(range.start).toBeGreaterThanOrEqual(previousEnd); expect(range.end).toBeGreaterThan(range.start);
    expect(source.slice(range.start, range.end)).toBe(range.sql); expect(range.end).toBeLessThanOrEqual(range.delimiterStart);
    expect(source.slice(range.delimiterStart, range.delimiterEnd)).toBe(range.delimiter ?? ''); previousEnd = range.delimiterEnd;
  }
}

describe('当前语句的精确范围与边界', () => {
  it('重复SQL仍有独立位置，之前被DELIMITER清除的注释副本不能被误定位', () => {
    const source = '/* SELECT 1 */\r\nDELIMITER $$\r\nSELECT 1$$\r\nSELECT 1$$\r\nDELIMITER ;\r\nSELECT 1;';
    const ranges = sqlStatementRanges(source, ordinary); expect(ranges).toHaveLength(3); assertSlices(source, ranges);
    expect(ranges.map(range => range.start)).toEqual([30, 42, 67]); expect(ranges.map(range => range.sql)).toEqual(['SELECT 1', 'SELECT 1', 'SELECT 1']);
  });
  it('首尾trim只影响SQL范围，CRLF和分隔符保留原文偏移', () => {
    const source = ' \r\n  SELECT 1  ;\r\n\tSELECT 2 \r\n'; const ranges = sqlStatementRanges(source, ordinary); assertSlices(source, ranges);
    expect(ranges).toEqual([
      { sql: 'SELECT 1', start: 5, end: 13, delimiterStart: 15, delimiterEnd: 16, delimiter: ';' },
      { sql: 'SELECT 2', start: 19, end: 27, delimiterStart: source.length, delimiterEnd: source.length, delimiter: null },
    ]);
  });
  it.each([
    ['┃SELECT 1; SELECT 2;', 'SELECT 1'], ['SELECT 1┃; SELECT 2;', 'SELECT 1'],
    ['SELECT 1;┃SELECT 2;', 'SELECT 2'], ['SELECT 1;┃\r\nSELECT 2;', 'SELECT 1'],
    ['SELECT 1;┃', 'SELECT 1'], ['SELECT 1┃', 'SELECT 1'], ['SELECT 1  ┃', 'SELECT 1'],
    ['SELECT 1; SELECT ┃2;', 'SELECT 2'], ['SELECT 1 ┃ ; SELECT 2;', 'SELECT 1'],
    ['DELIMITER $$\nSELECT 1$┃$\nDELIMITER ;\nSELECT 2;', 'SELECT 1'],
    ['DELIMITER $$\nSELECT 1$$┃\nDELIMITER ;\nSELECT 2;', 'SELECT 1'],
  ])('光标边界%s只归属明确的当前语句', (source, expected) => { expect(at(source)?.sql).toBe(expected); });
  it.each([
    '┃', ' ┃ \r\n', '┃  SELECT 1;', 'SELECT 1; ┃ SELECT 2;', 'SELECT 1;\n┃\nSELECT 2;',
    '-- 只有┃注释\n', '/* 只有┃注释 */;', 'SELECT 1;\n-- 末尾┃注释',
    'DELI┃MITER $$\nSELECT 1$$', 'DELIMITER $$\nSELECT 1$$\nDELIM┃ITER ;\nSELECT 2;',
    'SELECT 1; ;┃ ;', 'SELECT 1; ┃',
  ])('空白或无SQL区段%s不回退全文或寻找相邻语句', source => { expect(at(source)).toBeUndefined(); });
  it('UTF16非BMP字符不会把后续中文语句偏移当码点数', () => {
    const source = "SELECT '🧭';\r\nSELECT '第二句'"; const ranges = sqlStatementRanges(source, ordinary); assertSlices(source, ranges);
    expect(ranges[1].start).toBe(14); expect(currentSqlStatement(source, 22, ordinary)).toEqual(ranges[1]);
    expect(() => currentSqlStatement(source, 9, ordinary)).toThrow('代理对');
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('拒绝无效光标%s', offset => { expect(() => currentSqlStatement('SELECT 1', offset, ordinary)).toThrow('光标位置无效'); });
  it('拒绝不能由真实Monaco位置产生的CRLF内部偏移', () => { expect(() => currentSqlStatement('SELECT 1;\r\nSELECT 2;', 10, ordinary)).toThrow('CRLF'); });
});

describe('共用SQL扫描规则和客户端分隔符', () => {
  const samples = [
    "-- 开头注释;\nSELECT 'a; b', `含;号`, \"c;d\"; # 尾注释;\nSELECT 2 /* ; */;",
    "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT ';'; SELECT 2; END$$\nDELIMITER ;\nCALL p();",
    "/* 说明 */\nDELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 'a\\\'b;'; END//\nDELIMITER ;\nSELECT 2;",
    'SELECT `a``;b`, \'c\'\'d;\', "e""f;";SELECT 2;',
    '-- 普通注释;\n/* 普通块注释 */;# 结束',
    '/*!40101 SET NAMES utf8mb4 */;/*M!100100 SET @a=1 */;',
    'SELECT 1--不是注释; SELECT 2;SELECT 3 --\t是注释;\n;',
    'SELECT 1;\r\n\r\nSELECT 2;',
  ];
  it.each(samples)('范围与原有push/splitSql文字结果完全相同：%s', source => {
    const ranges = sqlStatementRanges(source, ordinary); expect(ranges.map(range => range.sql)).toEqual(splitSql(source)); assertSlices(source, ranges);
  });
  it('过程体中任何位置均返回完整CREATE而不含DELIMITER控制行', () => {
    const source = "DELIMITER //\r\nCREATE PROCEDURE p() BEGIN\r\n SELECT 'a;';\r\n SELECT 2;\r\nEND//\r\nDELIMITER ;\r\nCALL p();";
    const ranges = sqlStatementRanges(source, ordinary); expect(ranges).toHaveLength(2);
    for (const offset of [source.indexOf('CREATE'), source.indexOf("'a;'"), source.indexOf('SELECT 2'), source.indexOf('END')]) expect(currentSqlStatement(source, offset, ordinary)).toBeDefined();
    expect(currentSqlStatement(source, source.indexOf('SELECT 2'), ordinary)?.sql).toBe(ranges[0].sql);
    expect(ranges[0].sql).toContain("SELECT 'a;';\r\n SELECT 2;"); expect(ranges[0].sql).not.toContain('DELIMITER'); expect(ranges[0].delimiter).toBe('//');
  });
  it('逐个UTF16单位输入、包含被拆开的CRLF/代理对/多字符分隔符，范围保持一致', () => {
    const source = "/*说明*/\r\nDELIMITER $$\r\nCREATE PROCEDURE p() BEGIN SELECT '🧭;'; END$$\r\nDELIMITER ;\r\nSELECT 2;";
    const scanner = new SqlScriptScanner(), actual: SqlStatementRange[] = [];
    for (let i = 0; i < source.length; i++) actual.push(...scanner.pushRanges(source[i])); actual.push(...scanner.pushRanges('', true));
    expect(actual).toEqual(sqlStatementRanges(source, ordinary)); assertSlices(source, actual);
  });
  it('单条消费后更新真实模式，不重置原文全局偏移', () => {
    const source = "SET sql_mode='NO_BACKSLASH_ESCAPES';\nSELECT 'C:\\';\nSELECT 2;", scanner = new SqlScriptScanner();
    const first = scanner.pushRanges(source, true, 1); scanner.setMode(true); const second = scanner.pushRanges('', true, 1); const third = scanner.pushRanges('', true, 1);
    expect(first[0].sql).toMatch(/^SET/); expect(second[0].sql).toBe("SELECT 'C:\\'"); expect(third[0].sql).toBe('SELECT 2'); assertSlices(source, [...first, ...second, ...third]);
  });
  it('原push和新范围接口交替消费时也使用同一绝对位置', () => {
    const scanner = new SqlScriptScanner(); expect(scanner.push('SELECT 1; SELECT 2; SELECT 3;', true, 1)).toEqual(['SELECT 1']);
    expect(scanner.pushRanges('', true, 1)[0]).toMatchObject({ sql: 'SELECT 2', start: 10, end: 18 }); expect(scanner.push('', true, 1)).toEqual(['SELECT 3']);
  });
  it.each(["SELECT '未闭合", 'SELECT "未闭合', 'SELECT `未闭合', 'SELECT 1 /* 未闭合', 'DELIMITER abcdefghijklmnopq\nSELECT 1', "DELIMITER '\nSELECT 1"])('不完整或非法输入%s拒绝而非执行半句', source => { expect(() => sqlStatementRanges(source, ordinary)).toThrow(); });
  it('全源后部仍有未闭合输入时保守拒绝本次，不擅自执行前句', () => { expect(() => at("SELECT ┃1; SELECT '未完成")).toThrow('未闭合'); });
});

describe('实际会话模式和未知候选的一致性', () => {
  it('当前会话NBE真时能定位，NBE假时不执行前面的SET来改写解析模式', () => {
    const source = "SET sql_mode='NO_BACKSLASH_ESCAPES';\nSELECT 'C:\\';\nSELECT ┃2;";
    expect(at(source, noEscapes)?.sql).toBe('SELECT 2'); expect(() => at(source, ordinary)).toThrow('未闭合');
  });
  it.each([ordinary, noEscapes, { noBackslashEscapes: false, ansiQuotes: true }, { noBackslashEscapes: true, ansiQuotes: true }])('已知模式%j保持其自身引号边界', mode => {
    const source = 'SELECT `双``引号;`, "双""引号;", \'单\'\'引号;\'; SELECT 2;';
    expect(sqlStatementRanges(source, mode).map(range => range.sql)).toEqual(splitSql(source, mode.noBackslashEscapes, mode.ansiQuotes)); assertSlices(source, sqlStatementRanges(source, mode));
  });
  it('未知完整模式只接受所有候选中相同的SQL和偏移，不读取或猜测模式', () => {
    const source = 'SELECT 1;\r\nSELECT "一致";'; expect(sqlStatementRanges(source, unknown)).toEqual(sqlStatementRanges(source, ordinary)); expect(at('SELECT 1; SELECT ┃2;', unknown)?.sql).toBe('SELECT 2');
  });
  it.each([
    ["SELECT 'a\\'; SELECT 2;", { ...ordinary, noBackslashEscapesKnown: false }],
    ['SELECT "a\\"; SELECT 2;"', { ...ordinary, ansiQuotesKnown: false }],
    ["SELECT 'a\\'; SELECT 2;", unknown],
  ] as const)('未知模式存在引号歧义时拒绝%s', (source, mode) => { expect(() => sqlStatementRanges(source, mode)).toThrow('无法确定会话 SQL 引号模式'); });
  it('只知道NBE真实状态位时不假装知道ANSI_QUOTES', () => {
    const mode = { noBackslashEscapes: true, ansiQuotes: false, ansiQuotesKnown: false }; const source = 'SELECT "a\\"; SELECT 2;';
    expect(sqlStatementRanges(source, mode)).toEqual(sqlStatementRanges(source, { ...mode, ansiQuotesKnown: true }));
  });
});
