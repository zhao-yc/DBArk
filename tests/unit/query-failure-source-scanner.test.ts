import { describe, expect, it } from 'vitest';
import { SqlScriptScanner, type SqlLocatedStatement, type SqlStatementRange } from '../../src/engine/sql';

/** 每个已证明范围独立回读原文；无范围不拿重复文字搜索来补猜。 */
function slices(source: string, statements: SqlLocatedStatement[]) { for (const statement of statements) if (statement.sourceRange) expect(source.slice(statement.sourceRange.start, statement.sourceRange.end)).toBe(statement.sql); }

describe('脚本位置元数据不强化原执行门', () => {
  it.each([
    'SELECT 1;\r\n SELECT 1;\r\n SELECT 1;',
    "SELECT '😀';\r\n\tSELECT '中文🧭'; \nSELECT 3",
    '/* 旧位置的SELECT 1 */\r\nDELIMITER $$\r\nSELECT 1$$\r\nSELECT 1$$\r\nDELIMITER ;\r\nSELECT 1;',
    "DELIMITER //\r\nCREATE PROCEDURE p() BEGIN SELECT 'a;';SELECT '😀';END//\r\nDELIMITER ;\r\nCALL p();",
    '# 普通注释\r\nSELECT `__proto__`, "a;b", \'c;d\'; /*M!100000 SELECT 2 */;',
  ])('已知模式按真实消费提供UTF16范围，SQL与原push相同：%s', source => {
    const located = new SqlScriptScanner().pushLocated(source, true); expect(located.map(statement => statement.sql)).toEqual(new SqlScriptScanner().push(source, true)); expect(located.every(statement => !!statement.sourceRange)).toBe(true); slices(source, located);
  });
  it('逐个UTF16单元跨块输入，CRLF/代理对/DELIMITER拆分仍回读同一原文', () => {
    const source = "/*说明*/\r\nDELIMITER $$\r\nCREATE PROCEDURE p() BEGIN SELECT '😀';END$$\r\nDELIMITER ;\r\nCALL p();", scanner = new SqlScriptScanner(), output: SqlLocatedStatement[] = [];
    for (let index = 0; index < source.length; index++) output.push(...scanner.pushLocated(source[index])); output.push(...scanner.pushLocated('', true)); expect(output).toEqual(new SqlScriptScanner().pushLocated(source, true)); slices(source, output);
  });
  it('maxStatements=1不预读未闭合尾部，失败时不会先发布未完成范围', () => {
    const source = "SELECT 1; SELECT '未闭合", scanner = new SqlScriptScanner(); expect(scanner.pushLocated(source, true, 1)).toEqual([{ sql: 'SELECT 1', sourceRange: { start: 0, end: 8 } }]); expect(() => scanner.pushLocated('', true, 1)).toThrow('未闭合');
  });
  it('重复SQL绝不映射到前一个位置；指令清除的旧注释不参与定位', () => {
    const source = '/* SELECT 1 */\r\nDELIMITER $$\r\nSELECT 1$$\r\nSELECT 1$$\r\nDELIMITER ;\r\nSELECT 1;';
    const scanner = new SqlScriptScanner(), statements = [scanner.pushLocated(source, true, 1)[0], scanner.pushLocated('', true, 1)[0], scanner.pushLocated('', true, 1)[0]];
    expect(statements.map(statement => statement.sourceRange?.start)).toEqual([30, 42, 67]); slices(source, statements);
  });
  it('逐句更新真实sql_mode时只解释未消费尾部，范围仍为最初原文绝对位置', () => {
    const source = "SET sql_mode=@future;\r\nSELECT 'C:\\';\r\nSELECT 2;", scanner = new SqlScriptScanner();
    const first = scanner.pushLocated(source, true, 1)[0]; scanner.setMode(true); const second = scanner.pushLocated('', true, 1)[0], third = scanner.pushLocated('', true, 1)[0];
    expect([first.sql, second.sql, third.sql]).toEqual(['SET sql_mode=@future', "SELECT 'C:\\'", 'SELECT 2']); slices(source, [first, second, third]);
  });
  it('未知模式SQL一致时保持原push接受；真实文字歧义仍按旧规则拒绝', () => {
    const source = 'SELECT 1;\r\nSELECT "一致";', scanner = new SqlScriptScanner(false, false, false, false), actual = scanner.pushLocated(source, true);
    expect(actual.map(statement => statement.sql)).toEqual(new SqlScriptScanner(false, false, false, false).push(source, true)); slices(source, actual);
    for (const method of ['push', 'pushLocated'] as const) expect(() => new SqlScriptScanner(false, false, false, false)[method]("SELECT 'a\\'; SELECT 2;", true)).toThrow('无法确定会话');
  });
  it('仅注入候选位置分歧时省略range但不改变原push执行；原pushRanges仍严格拒绝', () => {
    const source = 'SELECT 1;';
    /** 故障注入只偏移候选元数据，模拟未来候选位置分歧；SQL解析和实际文字完全保持。 */
    const drift = () => { const scanner = new SqlScriptScanner(false, false, false, true); const alternate = (scanner as unknown as { alternates: { pendingOffset: number; statementOffset: number }[] }).alternates[0]; alternate.pendingOffset += 40; alternate.statementOffset += 40; return scanner; };
    expect(drift().push(source, true)).toEqual(['SELECT 1']); expect(drift().pushLocated(source, true)).toEqual([{ sql: 'SELECT 1' }]); expect(() => drift().pushRanges(source, true)).toThrow('无法确定会话');
  });
  it('原push、严格范围和可选定位交替消费共用同一原偏移', () => {
    const source = 'SELECT 1; SELECT 2; SELECT 3;', scanner = new SqlScriptScanner(); expect(scanner.push(source, true, 1)).toEqual(['SELECT 1']);
    expect(scanner.pushLocated('', true, 1)).toEqual([{ sql: 'SELECT 2', sourceRange: { start: 10, end: 18 } }]); const last: SqlStatementRange = scanner.pushRanges('', true, 1)[0]; expect(last).toMatchObject({ sql: 'SELECT 3', start: 20, end: 28 });
  });
});
