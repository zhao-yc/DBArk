import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMysqlSyntax } from '../../src/shared/mysqlSyntaxCheck';
import { sqlSyntaxBoundary, sqlSyntaxCheckLimits, validSqlSyntaxCheckResult } from '../../src/shared/sqlSyntaxCheck';

const mode = { ansiQuotes: false, noBackslashEscapes: false };
afterEach(() => vi.restoreAllMocks());
/** 所有语法事实来自产品真实MySQL解析器，不用预设回包或数据库代替。 */
function ready(source: string, settings = mode) {
  const result = checkMysqlSyntax(source, settings); expect(validSqlSyntaxCheckResult(result, source)).toBe(true);
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('本例未完成本地解析'); return result;
}

describe('本地MySQL整份脚本语法检查', () => {
  it.each([
    ['', 0], [' \r\n -- 注释\r\n# 注释\n/* 普通块注释😀 */', 0],
    ['SELECT 1', 1], ['SELECT 1;SELECT 2;', 2],
    ["SELECT 'a;\\\'b', CONCAT('x','y') AS v; -- 分号;\nSELECT `a;b` FROM `t`;", 2],
    ['WITH q AS (SELECT 1 AS n) SELECT n FROM q;', 1],
    ['CREATE TABLE t(id BIGINT PRIMARY KEY,note VARCHAR(255)); INSERT INTO t VALUES(1,\'中文😀\'); SELECT * FROM t;', 3],
    ['DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;', 2],
    ['DELIMITER //\r\nCREATE FUNCTION f() RETURNS INT RETURN 1//\r\nDELIMITER ;\r\nSELECT f();', 2],
  ] as const)('完整检查且不拆字符串、注释或例程：%s', (source, statementCount) => {
    expect(ready(source)).toEqual({ status: 'ready', statementCount, issues: [] });
  });

  it('真实完整AST不能将补全专用emptyColumn当作合法表达式', () => {
    for (const source of ['SELECT FROM t;', 'SELECT id FROM t WHERE;', 'SELECT id FROM t ORDER BY;']) expect(ready(source).issues.length).toBeGreaterThan(0);
  });

  it('定位经过CRLF、Unicode注释、长字面量和ANSI引用规范化后仍指向parser原subject', () => {
    const source = 'SELECT 1;\r\n/* 中文😀 */\r\nSELECT "引用😀名称", \'a\r\n😀b\' + FROM subject;';
    const result = ready(source, { ansiQuotes: true, noBackslashEscapes: true }), start = source.indexOf('subject');
    // 真实依赖在dmlStatement恢复时报告subject，不能为测试期待把它改画到前面的FROM。
    expect(result.statementCount).toBe(2); expect(result.issues).toContainEqual({ start, end: start + 'subject'.length, code: 'syntax' });
  });

  it('裸补充平面输入及后续错误的代码点位置不能切开原代理对', () => {
    const source = 'SELECT 𐐀 + FROM t;', result = ready(source);
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) { expect(sqlSyntaxBoundary(source, issue.start)).toBe(true); expect(sqlSyntaxBoundary(source, issue.end)).toBe(true); expect(issue.start).not.toBe(source.indexOf('𐐀') + 1); expect(issue.end).not.toBe(source.indexOf('𐐀') + 1); }
    const start = source.lastIndexOf('t;'); expect(result.issues).toContainEqual({ start, end: start + 1, code: 'syntax' });
  });

  it('EOF保留真实原语句末尾位置，不把<EOF>文字长度加到范围', () => {
    const source = 'SELECT 1;\r\nSELECT (\r\n '; const result = ready(source);
    expect(result.issues.some(issue => issue.code === 'incomplete' && issue.start === source.length && issue.end === source.length)).toBe(true);
  });

  it.each([
    ["SELECT 'unterminated", 'unclosed-string'], ['SELECT `unterminated', 'unclosed-identifier'], ['SELECT 1 /* unterminated', 'unclosed-comment'],
  ] as const)('未闭合原token给固定类别和完整原范围：%s', (source, code) => {
    const result = ready(source), start = code === 'unclosed-comment' ? source.indexOf('/*') : source.indexOf(code === 'unclosed-string' ? "'" : '`');
    expect(result.issues).toContainEqual({ start, end: source.length, code });
  });

  it('整份多语句分别检查，不在首个错误后冒充其它语句已通过', () => {
    const source = 'SELECT 1 + ;\nSELECT 2;\nSELECT 3 + ;', result = ready(source);
    expect(result.statementCount).toBe(3); expect(result.issues.some(issue => issue.start < source.indexOf('SELECT 2'))).toBe(true); expect(result.issues.some(issue => issue.start >= source.indexOf('SELECT 3'))).toBe(true);
  });

  it('X/B特殊文字保留原始内容并拒绝坏数字和奇数hex，不误伤普通字符集引导文字', () => {
    for (const literal of ["X'GG'", "B'2'", "x'f'"]) {
      const source = 'SELECT ' + literal + ';'; expect(ready(source).issues).toContainEqual({ start: 7, end: 7 + literal.length, code: 'syntax' });
    }
    for (const literal of ["X'0f'", "B'01'", "_utf8mb4'中文😀'", "N'文字'", "'B\'\'2\'\''", "@X'GG'"]) expect(ready('SELECT ' + literal + ';').issues).toEqual([]);
    expect(ready("SELECT t.X'GG' FROM t;").issues).toEqual([]);
  });

  it('引用的SQL_MODE赋值同样撤销后继语句的旧模式资格', () => {
    for (const sql of ["SET SESSION `sql_mode`='ANSI_QUOTES'; SELECT \"x\";", "SET @@SESSION.`SQL_MODE`='NO_BACKSLASH_ESCAPES'; SELECT 1;", "SET SESSION \"sql_mode\"='ANSI_QUOTES'; SELECT 1;"]) expect(checkMysqlSyntax(sql, { ansiQuotes: true, noBackslashEscapes: true })).toEqual({ status: 'blocked', reason: 'dynamic-mode' });
    expect(ready('SELECT `sql_mode` FROM settings;').issues).toEqual([]);
  });

  it('限定字段后的保留词按MySQL真实规则允许，裸名称及数字小数点不冒充限定名', () => {
    for (const source of ['SELECT t.FROM FROM t;', 'SELECT t.ORDER,t.SELECT FROM t;', 'SELECT `FROM` FROM t;', 'SELECT db.t.FROM FROM db.t;', 'SELECT 1.2,1e2;']) expect(ready(source).issues).toEqual([]);
    expect(ready('SELECT t.;').issues.length).toBeGreaterThan(0);
  });

  it('未知模式只允许相同解释；显式ANSI与反斜线模式按真实边界解析', () => {
    expect(checkMysqlSyntax('SELECT 1;')).toEqual({ status: 'ready', statementCount: 1, issues: [] });
    expect(checkMysqlSyntax('SELECT "value";')).toEqual({ status: 'blocked', reason: 'mode' });
    expect(ready('SELECT "字段" FROM "表";', { ansiQuotes: true, noBackslashEscapes: true }).issues).toEqual([]);
    expect(ready("SELECT 'a\\'; SELECT 2;", { ansiQuotes: false, noBackslashEscapes: true }).statementCount).toBe(2);
    const escaped = "SELECT 'a\\'; SELECT 2;"; expect(ready(escaped, mode).issues).toContainEqual({ start: 7, end: escaped.length, code: 'unclosed-string' });
  });

  it.each([
    ['/*!80000 SELECT 1 */;', 'executable-comment'], ['/*M! SELECT 1 */;', 'executable-comment'], ['SELECT /*+ MAX_EXECUTION_TIME(1) */ 1;', 'executable-comment'],
    ["SET SESSION SQL_MODE='ANSI_QUOTES'; SELECT \"x\";", 'dynamic-mode'], ['RESET CONNECTION; SELECT 1;', 'dynamic-mode'],
    ['SOURCE example.sql', 'client-command'], ['\\. example.sql', 'client-command'], ['\\! echo value', 'client-command'],
    ['DELIMITER\nSELECT 1;', 'delimiter'], ["DELIMITER '\nSELECT 1'", 'delimiter'],
  ] as const)('不把需要客户端/执行环境的形态误报通过：%s', (source, reason) => {
    expect(checkMysqlSyntax(source, mode)).toEqual({ status: 'blocked', reason });
  });

  it('无日志、无原文回包；字符串内模式或客户端字样不能伪造环境操作', () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const source = "SELECT 'SET sql_mode = SECRET; SOURCE secret.sql; /*! */'; SELECT 1 + ;";
    const result = ready(source); expect(result.issues.length).toBeGreaterThan(0); expect(JSON.stringify(result)).not.toContain('SECRET'); expect(JSON.stringify(result)).not.toContain('secret.sql');
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });

  it('源长度、tokens、深度、语句和问题预算超限整份拒绝而不截断', () => {
    expect(checkMysqlSyntax(' '.repeat(sqlSyntaxCheckLimits.sourceUnits + 1), mode)).toEqual({ status: 'blocked', reason: 'budget' });
    expect(checkMysqlSyntax('SELECT ' + '('.repeat(sqlSyntaxCheckLimits.depth + 1), mode)).toEqual({ status: 'blocked', reason: 'budget' });
    expect(checkMysqlSyntax('SELECT ' + Array(sqlSyntaxCheckLimits.tokens + 1).fill('1').join(','), mode)).toEqual({ status: 'blocked', reason: 'budget' });
    expect(checkMysqlSyntax('SELECT 1;'.repeat(sqlSyntaxCheckLimits.statements + 1), mode)).toEqual({ status: 'blocked', reason: 'budget' });
    expect(checkMysqlSyntax('SELECT 1 + ;'.repeat(sqlSyntaxCheckLimits.issues + 1), mode)).toEqual({ status: 'blocked', reason: 'budget' });
  });
});

describe('语法结果回包原文范围与字段白名单', () => {
  it('合法空结果、EOF、固定blocked均可校验', () => {
    expect(validSqlSyntaxCheckResult({ status: 'ready', statementCount: 0, issues: [] }, '')).toBe(true);
    expect(validSqlSyntaxCheckResult({ status: 'ready', statementCount: 1, issues: [{ start: 8, end: 8, code: 'incomplete' }] }, 'SELECT (')).toBe(true);
    expect(validSqlSyntaxCheckResult({ status: 'blocked', reason: 'timeout' }, 'SELECT 1')).toBe(true);
  });
  it('拒绝任意错误文本、额外内容、访问器、原型、空洞数组及不可靠范围', () => {
    const valid = { status: 'ready', statementCount: 1, issues: [{ start: 0, end: 6, code: 'syntax' }] } as const;
    const bad: unknown[] = [{ ...valid, sql: 'secret' }, { status: 'blocked', reason: '任意原错' }, { ...valid, issues: [{ start: 0, end: 6, code: 'syntax', message: 'secret' }] }, { ...valid, issues: [{ start: -1, end: 1, code: 'syntax' }] }, { ...valid, issues: [{ start: 0, end: 20, code: 'syntax' }] }, { ...valid, issues: [{ start: 6, end: 0, code: 'syntax' }] }, Object.assign(Object.create({}), valid), { ...valid, issues: Array(1) }];
    let calls = 0; bad.push(Object.defineProperty({ statementCount: 1, issues: [] }, 'status', { enumerable: true, get() { calls++; return 'ready'; } }));
    for (const value of bad) expect(validSqlSyntaxCheckResult(value, 'SELECT 1')).toBe(false); expect(calls).toBe(0);
    expect(validSqlSyntaxCheckResult({ ...valid, issues: [{ start: 8, end: 9, code: 'syntax' }] }, 'SELECT 😀')).toBe(false);
    expect(validSqlSyntaxCheckResult({ ...valid, issues: [{ start: 7, end: 7, code: 'syntax' }] }, 'SELECT\r\n1')).toBe(false);
  });
  it('拒绝重复、无序或超量问题，不借回包恢复旧信息', () => {
    const issue = { start: 0, end: 6, code: 'syntax' }, result = { status: 'ready', statementCount: 1, issues: [issue, { start: 7, end: 8, code: 'syntax' }] };
    expect(validSqlSyntaxCheckResult(result, 'SELECT 1')).toBe(true);
    for (const issues of [[issue, issue], [...result.issues].reverse(), Array(sqlSyntaxCheckLimits.issues + 1).fill(issue)]) expect(validSqlSyntaxCheckResult({ ...result, issues }, 'SELECT 1')).toBe(false);
  });
  it('模式字段同样不调用访问器，也不接受其它能力或非布尔值', () => {
    let calls = 0; const getter = Object.defineProperty({}, 'ansiQuotes', { enumerable: true, get() { calls++; return false; } });
    expect(checkMysqlSyntax('SELECT 1', getter)).toEqual({ status: 'blocked', reason: 'mode' }); expect(calls).toBe(0);
    expect(checkMysqlSyntax('SELECT 1', { ansiQuotes: 'yes' } as never)).toEqual({ status: 'blocked', reason: 'mode' });
    expect(checkMysqlSyntax('SELECT 1', { dialect: 'mysql' } as never)).toEqual({ status: 'blocked', reason: 'mode' });
  });
});
