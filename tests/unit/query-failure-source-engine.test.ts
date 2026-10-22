import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { QueryParameter } from '../../src/shared/queryParameters';

const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'source-range-ram', name: '失败原文定位RAM', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 1, user: 'ram' };
let engine: Engine, sessionId: string, active: ManagedConnection, sent: string[], events: TaskEvent[], next: number;
let scenario: (managed: ManagedConnection, sql: string, query: EventEmitter) => void;
/** 原始事件只替代驱动网络；实际Engine、原调度/绑定/动态模式及首错回执均执行产品代码。 */
function managed(): ManagedConnection {
  const native = new EventEmitter(), value = { connection: native, profile, status: { version: '8.4.11', dialect: 'mysql' }, sqlMode: '', serverStatus: 2, transactionStateKnown: true, broken: false, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
  Object.assign(native, { threadId: ++next, destroy: vi.fn(), query({ sql }: { sql: string }) { sent.push(sql); const query = new EventEmitter(); queueMicrotask(() => scenario(value, sql, query)); return query; } }); return value;
}
function ok(query: EventEmitter, value = '前序完成') { query.emit('fields', [{ name: 'value', columnType: 253 }], 0); query.emit('result', [value], 0); query.emit('end'); }
function fail(query: EventEmitter) { query.emit('error', Object.assign(Error('预期失败'), { code: 'ER_UNIT' })); }
function execute(sql: string, options: { parameters?: QueryParameter[]; currentStatement?: { offset: number }; taskId?: string } = {}): Promise<QueryOutcome> {
  return engine.handle(options.parameters ? 'query.executeParameterized' : 'query.execute', { sessionId, sql, maxRows: 100, taskId: options.taskId ?? 'range', ...options });
}
beforeEach(async () => {
  next = 0; sent = []; events = []; scenario = (_managed, _sql, query) => fail(query);
  driver.connect.mockReset().mockImplementation(async () => managed()); driver.execute.mockReset().mockResolvedValue({ rows: { affectedRows: 0, serverStatus: 2 }, fields: [] });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile }); sessionId = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId; active = await driver.connect.mock.results.at(-1)!.value;
});
afterEach(async () => { await engine.closeAll(); });

describe('失败原始模板UTF16位置由当前调度确认', () => {
  it('重复SQL失败定位第二份原文，不用indexOf命中第一份，tail不执行', async () => {
    const source = ' SELECT same;\r\n  SELECT same;\r\nSELECT tail;'; let count = 0; scenario = (_managed, _sql, query) => ++count === 1 ? ok(query) : fail(query);
    const output = await execute(source); const start = source.lastIndexOf('SELECT same'); expect(output.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, sourceRange: { start, end: start + 'SELECT same'.length } }); expect(source.slice(output.failure!.sourceRange!.start, output.failure!.sourceRange!.end)).toBe('SELECT same'); expect(sent).toEqual(['SELECT same', 'SELECT same']);
  });
  it('选区payload只使用自身相对位置，CRLF/emoji按UTF16单元计数不按字节或码点', async () => {
    const selectedPayload = "SELECT '😀';\r\n\tSELECT '失败🧭';\r\nSELECT tail;"; let count = 0; scenario = (_managed, _sql, query) => ++count === 1 ? ok(query) : fail(query);
    const output = await execute(selectedPayload), template = "SELECT '失败🧭'", start = selectedPayload.indexOf(template); expect(output.failure?.sourceRange).toEqual({ start, end: start + template.length }); expect(start).toBe(15); expect(sent).toEqual(["SELECT '😀'", template]);
  });
  it('currentStatement使用完整source的精确绝对范围，仅发送当前重复SQL', async () => {
    const source = "SELECT '😀';\r\nSELECT same;\r\n  SELECT same;\r\nSELECT tail;", start = source.lastIndexOf('SELECT same');
    const output = await execute(source, { currentStatement: { offset: start + 8 } }); expect(output.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start, end: start + 'SELECT same'.length } }); expect(sent).toEqual(['SELECT same']);
  });
  it('DELIMITER过程体整体投递，失败CALL定位不含控制指令、注释副本或内部SELECT', async () => {
    const source = "/* CALL p() */\r\nDELIMITER $$\r\nCREATE PROCEDURE p() BEGIN SELECT '😀;';SELECT 2;END$$\r\nDELIMITER ;\r\nCALL p();\r\nSELECT tail;";
    scenario = (_managed, sql, query) => sql.startsWith('CREATE') ? ok(query) : fail(query);
    const output = await execute(source), start = source.lastIndexOf('CALL p()'); expect(output.failure?.sourceRange).toEqual({ start, end: start + 8 }); expect(sent).toEqual(["CREATE PROCEDURE p() BEGIN SELECT '😀;';SELECT 2;END", 'CALL p()']); expect(output.results).toHaveLength(1);
  });
  it('参数展开不改变模板偏移，服务器参数错误只保留安全代码和数值范围', async () => {
    const source = ' SELECT :v;\r\n SELECT :v;\r\nDELETE FROM tail;'; let count = 0;
    scenario = (_managed, _sql, query) => { if (++count === 1) ok(query); else query.emit('error', Object.assign(Error('秘密值 expanded detail'), { code: 'ER_DUP_ENTRY' })); };
    const output = await execute(source, { parameters: [{ name: 'v', type: 'text', value: '秘密值😀' }] }), start = source.lastIndexOf('SELECT :v');
    expect(output.failure?.sourceRange).toEqual({ start, end: start + 9 }); expect(output.failure?.message).toContain('ER_DUP_ENTRY'); expect(JSON.stringify(output.failure)).not.toContain('秘密值'); expect(JSON.stringify(events)).not.toContain('秘密值'); expect(output.results[0].statement).toBe('SELECT :v'); expect(sent).toHaveLength(2); expect(sent[1].length).toBeGreaterThan(9);
  });
  it('动态模式后绑定失败在完整template产生后定位，不发送缺参句或tail', async () => {
    const source = 'SET sql_mode=@future;\r\n SELECT :missing;\r\n DELETE FROM tail;'; scenario = (value, _sql, query) => { value.sqlMode = 'NO_BACKSLASH_ESCAPES'; ok(query); };
    const output = await execute(source, { parameters: [] }), start = source.indexOf('SELECT :missing'); expect(output.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, sourceRange: { start, end: start + 'SELECT :missing'.length } }); expect(sent).toEqual(['SET sql_mode=@future']);
  });
  it('实际SET改变尾部引号模式后仍定位原始模板，不用初始模式重扫整份脚本', async () => {
    const source = "SET sql_mode=@future;\r\nSELECT 'C:\\';\r\nSELECT tail;";
    scenario = (value, sql, query) => { if (sql.startsWith('SET')) { value.sqlMode = 'NO_BACKSLASH_ESCAPES'; ok(query); } else fail(query); };
    const output = await execute(source), start = source.indexOf("SELECT 'C:"); expect(output.failure?.sourceRange).toEqual({ start, end: start + "SELECT 'C:\\'".length }); expect(sent).toEqual(['SET sql_mode=@future', "SELECT 'C:\\'"]);
  });
  it('未知模式但SQL一致的执行不被新元数据加强拒绝，已确认位置照常提供', async () => {
    active.sqlMode = undefined; active.noBackslashEscapesKnown = false;
    const source = ' SELECT one;\r\nSELECT two;\r\nSELECT tail;'; let count = 0; scenario = (_value, _sql, query) => ++count === 1 ? ok(query) : fail(query);
    const output = await execute(source), start = source.indexOf('SELECT two'); expect(output.failure?.sourceRange).toEqual({ start, end: start + 10 }); expect(sent).toEqual(['SELECT one', 'SELECT two']);
  });
  it.each(['参数静态预检', '未闭合首句', '未知模式歧义', '无当前完整语句'] as const)('%s无法确认目标时省略range且零SQL', async kind => {
    let source = "SELECT '未闭合", options: Parameters<typeof execute>[1] = {};
    if (kind === '参数静态预检') { source = 'SELECT :missing'; options = { parameters: [] }; }
    if (kind === '未知模式歧义') { active.sqlMode = undefined; active.noBackslashEscapesKnown = false; source = "SELECT 'a\\';SELECT 2;"; }
    if (kind === '无当前完整语句') { source = '  SELECT 1;'; options = { currentStatement: { offset: 0 } }; }
    const output = await execute(source, options); expect(output.failure?.statementsCompleted).toBe(0); expect(output.failure).not.toHaveProperty('sourceRange'); expect(sent).toEqual([]);
  });
  it('首句完整成功后，下一模式读取或尾部扫描失败不沿用前句范围', async () => {
    scenario = (value, _sql, query) => { value.sqlMode = undefined; value.serverStatus = undefined; ok(query); };
    const mode = await execute('SELECT one;SELECT two;'); expect(mode.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(mode.failure).not.toHaveProperty('sourceRange'); expect(sent).toEqual(['SELECT one']);
    active.sqlMode = ''; active.serverStatus = 2; scenario = (_value, _sql, query) => ok(query); sent = [];
    const scan = await execute("SELECT one; SELECT '未闭合", { taskId: 'tail-scan' }); expect(scan.failure?.statementsCompleted).toBe(1); expect(scan.failure).not.toHaveProperty('sourceRange'); expect(sent).toEqual(['SELECT one']);
  });
  it('取消仍reject且不发布failure定位回包，控制命令和后续SQL保持原边界', async () => {
    let pending: EventEmitter | undefined; scenario = (_value, _sql, query) => { pending = query; }; const running = execute('SELECT wait;DELETE FROM tail;'), rejected = expect(running).rejects.toThrow('取消');
    await vi.waitFor(() => expect(pending).toBeDefined()); driver.execute.mockImplementation(async (_value, sql) => { expect(sql).toBe('KILL QUERY 2'); pending!.emit('error', Error('任务已取消')); return { rows: {}, fields: [] }; });
    await engine.handle('query.cancel', { taskId: 'range' }); await rejected; expect(sent).toEqual(['SELECT wait']); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('完整成功输出不新增位置字段，schema.apply仍按旧原语义抛错', async () => {
    scenario = (_value, _sql, query) => ok(query); const output = await execute('SELECT one;SELECT two;'); expect(Object.keys(output).sort()).toEqual(['elapsedMs', 'results', 'transactionOpen']); expect(output).not.toHaveProperty('failure');
    scenario = (_value, _sql, query) => fail(query); await expect(engine.handle('schema.apply', { connectionId: profile.id, database: 'db', taskId: 'schema', sql: 'ALTER TABLE subject ADD bad UNKNOWN_TYPE' })).rejects.toThrow('预期失败');
  });
});
