import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindQueryParameters, namedParameterTokens, queryParameterLiteral, validateQueryParameters, type QueryParameter, type SqlLexicalMode } from '../../src/shared/queryParameters';
import { SqlScriptScanner, splitSql } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
import { Engine } from '../../src/engine';

const normal: SqlLexicalMode = { noBackslashEscapes: false, ansiQuotes: false };
/** 为各类型构造不带业务含义的参数，便于检查边界与安全转换。 */
const parameter = (type: QueryParameter['type'], value?: string): QueryParameter => ({ name: 'v', type, value });

describe('命名参数词法与精确类型', () => {
  it('跳过四类引用与普通注释，保留重复参数的偏移，并识别可执行版本注释', () => {
    const sql = "SELECT ':skip', \"a:skip\", `b:skip`, :v, :v /* :skip */ -- :skip\n# :skip\n /*!80000 + :mysql */ /*M!100000 + :maria */";
    expect(namedParameterTokens(sql, normal).map(token => token.name)).toEqual(['v', 'v', 'mysql', 'maria']);
    expect(namedParameterTokens(sql, normal).map(token => sql.slice(token.start, token.end))).toEqual([':v', ':v', ':mysql', ':maria']);
    expect(namedParameterTokens('SELECT 1--\u00a0 :v', normal).map(token => token.name)).toEqual(['v']);
    expect(namedParameterTokens('SELECT 1--\x01 :v', normal)).toEqual([]);
  });
  it('按实际反斜线与 ANSI_QUOTES 区分字符串和标识符的结束位置', () => {
    const sql = 'SELECT "path\\", :v';
    expect(() => namedParameterTokens(sql, normal)).toThrow('未闭合');
    expect(namedParameterTokens(sql, { ...normal, ansiQuotes: true }).map(token => token.name)).toEqual(['v']);
    expect(namedParameterTokens("SELECT 'path\\', :v", { ...normal, noBackslashEscapes: true }).map(token => token.name)).toEqual(['v']);
  });
  it('文本注入载荷只生成 UTF-8 十六进制，重复参数不会改变语句数量', () => {
    const value = "中文🙂'\0; DROP TABLE users; -- /* */ \\\"";
    const literal = queryParameterLiteral(parameter('text', value));
    expect(literal).toBe(`CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`);
    const output = bindQueryParameters('SELECT :v; SELECT :v', validateQueryParameters([parameter('text', value)]), normal);
    expect(splitSql(output)).toHaveLength(2); expect(output).not.toContain('DROP');
  });
  it('整数保持超大精度并可用于 LIMIT，DECIMAL 保留原始尺度', () => {
    expect(queryParameterLiteral(parameter('integer', '+00018446744073709551615'))).toBe('18446744073709551615');
    expect(queryParameterLiteral(parameter('integer', '-000'))).toBe('0');
    expect(queryParameterLiteral(parameter('decimal', '12345678901234567890.123456789012345678'))).toBe("CAST('12345678901234567890.123456789012345678' AS DECIMAL(65,18))");
    expect(() => queryParameterLiteral(parameter('decimal', '0.' + '1'.repeat(38)))).toThrow('30');
    expect(queryParameterLiteral(parameter('decimal', '0.' + '1'.repeat(38)), 38)).toContain('DECIMAL(65,38)');
    for (const value of ['1e10', 'NaN', '1;DROP TABLE t', '1.2.3', '9'.repeat(66)]) expect(() => queryParameterLiteral(parameter('decimal', value))).toThrow();
  });
  it('严格区分 NULL、空文本、空二进制与布尔值', () => {
    expect(queryParameterLiteral(parameter('null'))).toBe('NULL');
    expect(queryParameterLiteral(parameter('text', ''))).toBe("CONVERT(X'' USING utf8mb4)");
    expect(queryParameterLiteral(parameter('binary', ''))).toBe("X''");
    expect(queryParameterLiteral(parameter('binary', '00fF'))).toBe("X'00fF'");
    expect(queryParameterLiteral(parameter('boolean', 'false'))).toBe('FALSE');
    for (const item of [parameter('null', 'null'), parameter('text'), parameter('binary', '0xff'), parameter('binary', 'fff'), parameter('boolean', '0')]) expect(() => queryParameterLiteral(item)).toThrow();
  });
  it('验证闰年、零日期、时区、微秒及时长端点，值不经 Date 转换', () => {
    expect(queryParameterLiteral(parameter('date', '2000-02-29'))).toContain('2000-02-29');
    expect(queryParameterLiteral(parameter('datetime', '2026-10-14 23:59:59.123456'))).toContain('DATETIME(6)');
    expect(queryParameterLiteral(parameter('time', '-838:59:59.000000'))).toContain('TIME(6)');
    expect(() => queryParameterLiteral(parameter('time', '838:59:59.000001'))).toThrow('端点');
    expect(queryParameterLiteral(parameter('time', '838:59:59.999999'), 38, true)).toContain('999999');
    for (const value of ['1900-02-29', '2026-04-31', '0000-00-00', '0999-01-01']) expect(() => queryParameterLiteral(parameter('date', value))).toThrow();
    for (const value of ['2026-10-14T12:00:00Z', '2026-10-14 24:00:00', '2026-10-14 12:00:00.1234567']) expect(() => queryParameterLiteral(parameter('datetime', value))).toThrow();
    for (const value of ['839:00:00', '12:60:00', '12:00:60', '00:00:00.1234567']) expect(() => queryParameterLiteral(parameter('time', value))).toThrow();
  });
  it('拒绝畸形占位符和未闭合可执行注释内容，保留存储程序标签和变量赋值', () => {
    for (const sql of ['SELECT :1bad', 'SELECT ::v', 'SELECT :中文', 'SELECT :a中文', "SELECT /*!80000 ':v */", 'SELECT /*M! :v /* nested */ */']) expect(() => namedParameterTokens(sql, normal)).toThrow();
    expect(namedParameterTokens('myloop: LOOP SET @n := :v; LEAVE myloop; END LOOP', normal).map(token => token.name)).toEqual(['v']);
  });
  it('限制参数数量、单值字节、整组字节和重复展开预算', () => {
    expect(() => validateQueryParameters([parameter('text', 'a'), parameter('text', 'b')])).toThrow('重复');
    expect(() => validateQueryParameters([{ name: '__proto__', type: 'text', value: '好' }])).not.toThrow();
    expect(() => validateQueryParameters([parameter('text', '\uD800')])).toThrow('Unicode');
    expect(() => validateQueryParameters([parameter('text', '中'.repeat(22000))])).toThrow('64 KiB');
    expect(() => validateQueryParameters(Array.from({ length: 201 }, (_, n) => ({ name: `p${n}`, type: 'null' })))).toThrow('200');
    expect(() => validateQueryParameters(Array.from({ length: 17 }, (_, n) => ({ name: `p${n}`, type: 'text', value: 'a'.repeat(65536) })))).toThrow('1 MiB');
    const values = validateQueryParameters([parameter('text', 'a'.repeat(65536))]);
    expect(() => bindQueryParameters('SELECT ' + Array(161).fill(':v').join(','), values, normal)).toThrow('20 MiB');
  });
});

describe('逐条扫描与模式切换', () => {
  it('同一行的 SET 后保留未消费尾部，并仅按新模式识别第二条语句', () => {
    const scanner = new SqlScriptScanner();
    expect(scanner.push("SET sql_mode='NO_BACKSLASH_ESCAPES'; SELECT 'path\\', :v; SELECT 3", true, 1)).toEqual(["SET sql_mode='NO_BACKSLASH_ESCAPES'"]);
    scanner.setMode(true);
    expect(scanner.push('', true, 1)).toEqual(["SELECT 'path\\', :v"]);
    expect(scanner.push('', true, 1)).toEqual(['SELECT 3']);
    expect(scanner.push('', true, 1)).toEqual([]);
  });
  it('DELIMITER 与逐字符文件块共用规则，ANSI_QUOTES 下保留反斜线标识符', () => {
    const sql = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT :v; END$$\nDELIMITER ;\nSELECT "path\\", :v;';
    const scanner = new SqlScriptScanner(false, true), output: string[] = [];
    for (const char of sql) { let next = scanner.push(char, false, 1); while (next.length) { output.push(...next); next = scanner.push('', false, 1); } }
    output.push(...scanner.push('', true, 1));
    expect(output).toEqual(['CREATE PROCEDURE p() BEGIN SELECT :v; END', 'SELECT "path\\", :v']);
  });
  it('不能在半条语句中更改模式，也不把同一物理行尾部当作 DELIMITER 指令', () => {
    const scanner = new SqlScriptScanner(); scanner.push("SELECT '未结束\n");
    expect(() => scanner.setMode(true)).toThrow('中途');
    const sameLine = new SqlScriptScanner(); sameLine.push('SELECT 1;DELIMITER $$\nSELECT 2;', true, 1);
    expect(sameLine.push('', true, 1)).toEqual(['DELIMITER $$\nSELECT 2']);
  });
});

const profile: ConnectionProfile = { id: 'parameters', name: '参数测试', group: '', color: '', dialect: 'mysql', host: 'test.invalid', port: 3306, user: 'test' };
let engine: Engine, sessionId: string, events: TaskEvent[], sent: string[], serverMode: string | undefined;
let scenario: (sql: string, result: EventEmitter) => void;
/** 模拟只检查发送顺序、模式读取与事件隐私；真实精度往返另由远程集成测试负责。 */
function managed(): ManagedConnection {
  const connection = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; threadId: number };
  connection.threadId = 41; connection.destroy = vi.fn();
  connection.query = vi.fn(({ sql }: { sql: string }) => { const result = new EventEmitter(); sent.push(sql); queueMicrotask(() => scenario(sql, result)); return result; });
  return { connection, profile, get sqlMode() { return serverMode; }, serverStatus: 2, status: { version: '8.4.8', dialect: 'mysql' }, broken: false, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
}
/** 用状态包结束模拟语句，不伪造数据库对类型表达式的解析结果。 */
function done(result: EventEmitter): void { result.emit('result', { affectedRows: 1, serverStatus: 2 }); result.emit('end'); }

describe('参数任务预检、会话模式和失败边界', () => {
  beforeEach(async () => {
    events = []; sent = []; serverMode = '';
    mocks.connect.mockReset().mockImplementation(async () => managed());
    mocks.execute.mockReset().mockImplementation(async (_managed: ManagedConnection, sql: string) => ({ rows: sql.includes('sql_mode') ? [{ mode: serverMode }] : { serverStatus: 2 }, fields: [] }));
    scenario = (_sql, result) => done(result);
    engine = new Engine(event => events.push(event));
    await engine.handle('connections.open', { id: profile.id, profile });
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
  });
  afterEach(async () => { await engine.closeAll(); });
  it('协议缓存缺失时不能默认成空模式，也不偷偷发 SELECT 改变会话诊断', async () => {
    serverMode = undefined;
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    active.serverStatus = undefined;
    await expect(engine.handle('query.parameterNames', { sessionId, sql: 'SELECT :v' })).rejects.toThrow('无法确定会话');
    await expect(engine.handle('query.executeParameterized', { sessionId, sql: 'SELECT :v', parameters: [parameter('integer', '1')], taskId: 'missing-cache', maxRows: 10 })).resolves.toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, message: expect.stringContaining('无法确定会话') } });
    expect(sent).toEqual([]); expect(mocks.execute).not.toHaveBeenCalled();
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual({ transactionOpen: false, transactionKnown: false, broken: true });
  });
  it('ANSI 模式不确定时允许两种词法完全一致的语句，拒绝歧义并保留事务状态', async () => {
    serverMode = undefined;
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    active.serverStatus = 3;
    const preview = await engine.handle('query.parameterNames', { sessionId, sql: 'SELECT :v' });
    expect(preview.names).toEqual(['v']); expect(preview.ansiQuotesKnown).toBe(false); expect(preview.warnings).toHaveLength(1);
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    await engine.handle('query.executeParameterized', { sessionId, sql: 'SELECT :v', parameters: [parameter('integer', '1')], taskId: 'uncertain-safe', maxRows: 10 });
    await expect(engine.handle('query.executeParameterized', { sessionId, sql: 'SELECT "path\\", :v', parameters: [parameter('integer', '1')], taskId: 'uncertain-unsafe', maxRows: 10 })).resolves.toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, message: expect.stringContaining('歧义') } });
    expect(sent).toEqual(['SELECT 1']); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('会话状态接口不发送 SQL，并可在执行失败后读取未提交事务', async () => {
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    active.serverStatus = 3;
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    active.broken = true;
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual({ transactionOpen: true, transactionKnown: true, broken: true });
    expect(sent).toEqual([]); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('所有类型、缺失和多余参数在首条写入前拒绝', async () => {
    for (const parameters of [[parameter('integer', '不合法')], [], [parameter('text', '合法'), { name: 'extra', type: 'null' }]]) {
      await expect(engine.handle('query.executeParameterized', { sessionId, sql: 'INSERT INTO t VALUES (1); INSERT INTO t VALUES (:v)', parameters, taskId: 'invalid', maxRows: 10 })).resolves.toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0 } });
      expect(sent).toEqual([]);
    }
  });
  it('静态 SET 模式预检和实际执行一致，支持后续只在新模式合法的字符串', async () => {
    scenario = (sql, result) => { if (sql.startsWith('SET')) serverMode = 'NO_BACKSLASH_ESCAPES'; done(result); };
    const sql = "SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'; INSERT INTO t VALUES ('path\\', :v);";
    const preview = await engine.handle('query.parameterNames', { sessionId, sql });
    expect(preview.names).toEqual(['v']); expect(preview.warnings).toEqual([]);
    const output = await engine.handle('query.executeParameterized', { sessionId, sql, parameters: [parameter('text', '秘密')], taskId: 'mode', maxRows: 10 });
    expect(sent).toHaveLength(2); expect(sent[1]).toContain("'path\\'");
    expect(output.results[1].statement).toContain(':v'); expect(JSON.stringify(events)).not.toContain('秘密');
  });
  it('未知模式表达式可执行，预览说明不确定性，运行时重新解析剩余脚本', async () => {
    scenario = (sql, result) => { if (sql.startsWith('SET')) serverMode = 'NO_BACKSLASH_ESCAPES'; done(result); };
    const sql = "SET sql_mode = @future_mode; SELECT 'path\\', :v";
    const preview = await engine.handle('query.parameterNames', { sessionId, sql }); expect(preview.warnings).toHaveLength(1);
    await engine.handle('query.executeParameterized', { sessionId, sql, parameters: [parameter('integer', '42')], taskId: 'dynamic', maxRows: 10 });
    expect(sent).toEqual(['SET sql_mode = @future_mode', "SELECT 'path\\', 42"]);
  });
  it('动态模式后缺参准确报告部分执行，后续写入不发送', async () => {
    scenario = (sql, result) => { if (sql.startsWith('SET')) serverMode = 'NO_BACKSLASH_ESCAPES'; done(result); };
    await expect(engine.handle('query.executeParameterized', { sessionId, sql: "SET sql_mode=@future; INSERT INTO t VALUES ('path\\', :missing)", parameters: [], taskId: 'partial', maxRows: 10 })).resolves.toMatchObject({ failure: { statementOrdinal: 2, statementsCompleted: 1, message: expect.stringContaining('已完成 1 条') } });
    expect(sent).toEqual(['SET sql_mode=@future']);
  });
  it('普通脚本也按最新 ANSI_QUOTES 分割，后条解析失败说明此前写入已完成', async () => {
    scenario = (sql, result) => { if (sql.startsWith('SET')) serverMode = 'ANSI_QUOTES'; done(result); };
    await engine.handle('query.execute', { sessionId, sql: 'SET sql_mode=\'ANSI_QUOTES\'; SELECT "path\\"; SELECT 3', taskId: 'normal-mode', maxRows: 10 });
    expect(sent).toHaveLength(3);
    await expect(engine.handle('query.execute', { sessionId, sql: "INSERT INTO t VALUES (1); SELECT '", taskId: 'bad-tail', maxRows: 10 })).resolves.toMatchObject({ failure: { statementOrdinal: 2, statementsCompleted: 1, message: expect.stringContaining('已完成 1 条') } });
  });
  it('服务器错误包含参数秘密时只暴露安全代码，结果声明保持模板', async () => {
    scenario = (_sql, result) => result.emit('error', Object.assign(new Error('秘密值 duplicate value'), { code: 'ER_DUP_ENTRY' }));
    await expect(engine.handle('query.executeParameterized', { sessionId, sql: 'INSERT INTO t VALUES (:v)', parameters: [parameter('text', '秘密值')], taskId: 'privacy', maxRows: 10 })).resolves.toMatchObject({ results: [], failure: { message: expect.stringContaining('ER_DUP_ENTRY') } });
    expect(JSON.stringify(events)).not.toContain('秘密值');
  });
});
