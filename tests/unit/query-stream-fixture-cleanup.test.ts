import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); });

/** 离线提取真实beforeAll及收尾函数做故障注入；所有连接/SQL端口为模拟，不替代200线程实测。 */
function fixture() {
  const source = readFileSync(new URL('../integration/engine-query-stream.integration.test.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true), functions: string[] = []; let before = '';
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && ['recordConnection', 'cleanupQueryStreamFixture', 'observed'].includes(node.name?.text ?? '')) functions.push(node.getText(tree)); else { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'beforeAll') before = node.arguments[0].getText(tree); node.forEachChild(visit); } }; tree.forEachChild(visit);
  const order: string[] = [], threadIds = new Set([10, 11, 12]), observer = { connection: { threadId: 10 }, close: vi.fn(async () => { order.push('observer.close'); }) };
  const execute = vi.fn(async (_connection: unknown, sql: string, _params?: unknown[]) => { if (sql.startsWith('SELECT ID')) { order.push('threads'); return { rows: [] }; } if (sql.startsWith('SET SESSION')) order.push('ddl-timeout'); if (sql.startsWith('DROP DATABASE')) order.push('drop'); if (sql.startsWith('SELECT SCHEMA_NAME')) order.push('catalog'); if (sql.startsWith('SELECT CONNECTION_ID')) return { rows: [{ id: 20 }] }; if (sql.startsWith('SELECT VERSION')) return { rows: [{ version: '8.4.11' }] }; return { rows: [] }; });
  const closeAll = vi.fn(async () => { order.push('closeAll'); }), restore = vi.fn(() => { order.push('restore'); }), remove = vi.fn(async () => { order.push('files'); }), waitFor = vi.fn(async (action: () => Promise<unknown>, _options?: unknown) => action()); let serial = 19;
  const connect = vi.fn(async (...args: unknown[]) => { const id = ++serial; return { connection: { threadId: id }, status: { connectionId: id }, close: vi.fn(), args }; }), originalConnect = async (...args: unknown[]) => connect(...args), driver = { connect: originalConnect };
  const context = createContext({ Error, AggregateError, Set, Number, console: { log: vi.fn() }, threadIds, observer, directory: join(tmpdir(), 'dbark-q05-stream-Test123'), database: 'dbark_stream_1792100000000_1234abcd', databaseAttempted: true, restoreConnections: restore, engine: { closeAll, handle: vi.fn(async () => { await driver.connect({}, undefined); return {}; }) }, connectionDriver: driver, profile: {}, execute, identifier: (name: string) => '`' + name + '`', expect, vi: { waitFor, spyOn: vi.spyOn }, resolve, dirname, basename, join, tmpdir, rm: remove, mkdtemp: vi.fn(async () => join(tmpdir(), 'dbark-q05-stream-Test123')) });
  runInContext(ts.transpileModule(functions.join('\n') + '\nglobalThis.handlers={recordConnection,cleanupQueryStreamFixture,before:' + before + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, order, execute, closeAll, observer, restore, remove, waitFor, connect, originalConnect, driver, threadIds, handlers: context.handlers as { recordConnection(value: unknown): void; cleanupQueryStreamFixture(): Promise<void>; before(): Promise<void> } };
}

describe('Q05实库夹具的离线收尾故障注入', () => {
  it('成功顺序为closeAll、无DB过滤的逐ID核零、精确DROP/目录、严格关闭observer、恢复与文件清理', async () => {
    const f = fixture(); await f.handlers.cleanupQueryStreamFixture(); expect(f.order).toEqual(['closeAll', 'threads', 'ddl-timeout', 'drop', 'catalog', 'observer.close', 'restore', 'files']);
    const read = f.execute.mock.calls.find(call => call[1].startsWith('SELECT ID'))!; expect(read[1]).not.toContain('DB'); expect(read[2]).toEqual([11, 12]); expect(f.waitFor.mock.calls[0][1]).toEqual({ timeout: 5000, interval: 50 }); expect(f.observer.close).toHaveBeenCalledWith({ strict: true }); expect(f.execute.mock.calls.find(call => call[1].startsWith('DROP'))![1]).toBe('DROP DATABASE IF EXISTS `dbark_stream_1792100000000_1234abcd`');
  });
  it('真实beforeAll观察器透传全部参数、返回同一对象，基础无库连接也登记并恢复原入口', async () => {
    const f = fixture(); f.threadIds.clear(); f.context.databaseAttempted = false; await f.handlers.before();
    const custom = { marker: '相同参数' }, returned = await f.driver.connect(custom, null); expect(returned).toBe(await f.connect.mock.results.at(-1)!.value); expect(f.connect.mock.calls.at(-1)).toEqual([custom, null]); expect([...f.threadIds]).toEqual([20, 21, 22]);
    expect(f.context.databaseAttempted).toBe(true); await f.handlers.cleanupQueryStreamFixture(); expect(f.driver.connect).toBe(f.originalConnect);
  });
  it('closeAll和逐ID核对失败后仍尝试DROP、目录、严格关闭与恢复，保留首个原始错误', async () => {
    const f = fixture(), original = Error('closeAll原始失败'), remaining = Error('线程仍残留'); f.closeAll.mockRejectedValueOnce(original); f.waitFor.mockRejectedValueOnce(remaining); f.restore.mockImplementationOnce(() => { f.order.push('restore'); throw Error('恢复失败'); });
    const failure = await f.handlers.cleanupQueryStreamFixture().catch(error => error); expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(original); expect(failure.errors[0]).toBe(original); expect(failure.errors[1]).toBe(remaining); expect(f.order).toContain('drop'); expect(f.order).toContain('catalog'); expect(f.observer.close).toHaveBeenCalledWith({ strict: true }); expect(f.remove).toHaveBeenCalledOnce();
  });
  it('DROP失败不能跳过目录、observer关闭和恢复，单错误按原对象抛出', async () => {
    const f = fixture(), original = Error('原始DROP失败'), normal = f.execute.getMockImplementation()!; f.execute.mockImplementation(async (...args) => { if (args[1].startsWith('DROP')) throw original; return normal(...args); });
    await expect(f.handlers.cleanupQueryStreamFixture()).rejects.toBe(original); expect(f.order).toContain('catalog'); expect(f.restore).toHaveBeenCalledOnce(); expect(f.observer.close).toHaveBeenCalledOnce();
  });
  it('CREATE结果未知仍清理尝试过的唯一库；危险库名不执行DROP且其余收尾继续', async () => {
    const f = fixture(), normal = f.execute.getMockImplementation()!, original = Error('CREATE返回未知'); f.threadIds.clear(); f.context.databaseAttempted = false;
    f.execute.mockImplementation(async (...args) => { if (args[1].startsWith('CREATE DATABASE')) throw original; return normal(...args); }); await expect(f.handlers.before()).rejects.toBe(original); expect(f.context.databaseAttempted).toBe(true); await f.handlers.cleanupQueryStreamFixture(); expect(f.order).toContain('drop'); expect(f.order).toContain('catalog'); expect(f.driver.connect).toBe(f.originalConnect);
    const invalid = fixture(); invalid.context.database = '其它库'; await expect(invalid.handlers.cleanupQueryStreamFixture()).rejects.toThrow('拒绝清理'); expect(invalid.order).not.toContain('drop'); expect(invalid.order).toContain('catalog'); expect(invalid.observer.close).toHaveBeenCalledOnce(); expect(invalid.restore).toHaveBeenCalledOnce();
  });
  it('observer关闭失败也严格恢复观察器并清理目录，非法目录不能递归删除', async () => {
    const f = fixture(), original = Error('关闭失败'); f.observer.close.mockRejectedValueOnce(original); await expect(f.handlers.cleanupQueryStreamFixture()).rejects.toBe(original); expect(f.restore).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
    const invalid = fixture(); invalid.context.directory = tmpdir(); await expect(invalid.handlers.cleanupQueryStreamFixture()).rejects.toThrow('拒绝清理未知临时目录'); expect(invalid.remove).not.toHaveBeenCalled(); expect(invalid.restore).toHaveBeenCalledOnce();
  });
  it('线程ID无效时严格关闭尚未交给调用方的连接，观察器不制造新泄漏', async () => {
    const f = fixture(), close = vi.fn(async () => {}); f.connect.mockResolvedValueOnce({ connection: { threadId: 0 }, status: { connectionId: 0 }, close, args: [] });
    try { await expect(f.handlers.before()).rejects.toThrow('未取得真实连接线程ID'); expect(close).toHaveBeenCalledExactlyOnceWith({ strict: true }); }
    finally { (f.context.restoreConnections as () => void)(); }
  });
});
