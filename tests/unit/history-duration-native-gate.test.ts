import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { bindHistoryDurationUi, historyDurationFixtures, installHistoryDurationAudit, readHistoryDurationAudit } from '../helpers/historyDurationUi';

const source = readFileSync(new URL('../e2e/history-duration-filter.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const active = () => ({ DBARK_HISTORY_DURATION_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_HISTORY_DURATION_OUTPUT: 'D:\\owned\\dbark-history-duration-' + 'a'.repeat(32), DBARK_HISTORY_DURATION_MANIFEST: 'D:\\owned\\manifest.json', DBARK_HISTORY_DURATION_MANIFEST_SHA256: 'a'.repeat(64) });
/** 执行实际入口转译，require均为RAM拒绝端口；绝不启动桌面或读取实跑配置。 */
function collect(args: string[], gate = '0') {
  const reads: string[] = [], imports: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy({ DBARK_HISTORY_DURATION_NATIVE_TEST: gate }, { get(value, key: string) { reads.push(key); if (key !== 'DBARK_HISTORY_DURATION_NATIVE_TEST') throw Error('默认收集不能读取其它环境'); return value.DBARK_HISTORY_DURATION_NATIVE_TEST; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: args, env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; imports.push(name); if (name !== '../helpers/historyDurationUi') throw Error('禁止加载桌面或SQLite'); return { registerHistoryDurationNative: register }; } }));
  return { reads, imports, skip, register };
}
/** 原handler仅替换其物理边界返回；审计代码逐字序列化至独立Main RAM上下文。 */
function audit() {
  const frame = { processId: 10, frameToken: '原frame', url: 'file:///D:/dbark/dist/renderer/index.html', detached: false }, events = new Map<string, Function[]>(), appEvents = new Map<string, Function[]>();
  const target = { senderId: 2, pid: 100, userData: 'D:\\本例\\profile', url: frame.url, marker: '本例正常退出', settings: { tabs: [], theme: 'dark' } };
  const contents = { id: 2, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, getOSProcessId: () => 101, on(name: string, action: Function) { events.set(name, [...events.get(name) ?? [], action]); } };
  const window = { webContents: contents, isDestroyed: () => false }, logs: string[] = [], cursor = '00000000-0000-4000-8000-000000000001';
  const original = vi.fn(async (_event: unknown, payload: any): Promise<any> => ({ ok: true, result: payload.command === 'history.page' || payload.command === 'history.pageContinue' ? { items: [], failures: [], failed: 0, scanned: 25, matched: 0, cursor } : payload.command === 'tasks.list' ? [] : undefined }));
  const handlers = new Map([['dbark:request', original]]), main = { ipcMain: { _invokeHandlers: handlers }, BrowserWindow: { getAllWindows: () => [window] }, app: { getPath: () => target.userData, getAppMetrics: () => [{ pid: 100 }, { pid: 101 }], on(name: string, action: Function) { appEvents.set(name, [...appEvents.get(name) ?? [], action]); }, once(name: string, action: Function) { appEvents.set(name, [...appEvents.get(name) ?? [], action]); } } };
  const context = createContext({ process: { pid: 100 }, console: { log: (line: string) => logs.push(line) }, target, main });
  runInContext(`(${installHistoryDurationAudit.toString()})(main,target);globalThis.read=(${readHistoryDurationAudit.toString()});`, context);
  let task = 10;
  const input = () => ({ taskId: `00000000-0000-4000-8000-${String(++task).padStart(12, '0')}`, search: '', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', onError: 'continue', durationRange: { minMs: 100, maxMs: 200 } });
  const invoke = (command: string, value: unknown) => handlers.get('dbark:request')!({ sender: contents, senderFrame: frame }, { command, input: value });
  return { context, frame, target, original, handlers, events, appEvents, logs, input, invoke, cursor, read: () => context.read() };
}

describe('历史耗时原生专项封闭门及Main审计', () => {
  it.each(['--list', '--list=json'])('%s优先短路，即使gate=1也无额外导入或环境读取', flag => {
    const f = collect([flag], '1'); expect(f.reads).toEqual([]); expect(f.imports).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled();
  });
  it('默认仅一条未执行定义，显式门才调用RAM注册器', () => {
    const closed = collect([]); expect(closed.skip).toHaveBeenCalledOnce(); expect(closed.imports).toEqual([]);
    const open = collect([], '1'); expect(open.imports).toEqual(['../helpers/historyDurationUi']); expect(open.register).toHaveBeenCalledOnce(); expect(open.skip).not.toHaveBeenCalled();
  });
  it('只接受Windows及五项独占配置，漂移后改回仍永久失效', () => {
    let env: NodeJS.ProcessEnv = active(); const f = bindHistoryDurationUi(() => ({ args: [], env, platform: 'win32' })); f.assertCurrent();
    env = { ...env, DBARK_TEST_PASSWORD: '' }; expect(() => f.assertCurrent()).toThrow(); env = active(); expect(() => f.assertCurrent()).toThrow('永久停链');
    expect(() => bindHistoryDurationUi(() => ({ args: [], env: active(), platform: 'darwin' }))).toThrow();
  });
  it.each(['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_AUTH_TOKEN', 'dbark_ssh_key', 'DBARK_INTEGRATION_PASSWORD'])('拒绝%s及空值，不能承袭外部认证或旁路', key => {
    expect(() => bindHistoryDurationUi(() => ({ args: [], env: { ...active(), [key]: '' }, platform: 'win32' }))).toThrow();
  });
  it.each(['--config=x', '-cx', '--ui', '--debug', '--repeat-each=2', '--workers=2', '--retries=1', '--trace=on'])('拒绝CLI覆盖%s', argument => { expect(() => bindHistoryDurationUi(() => ({ args: [argument], env: active(), platform: 'win32' }))).toThrow(); });
  it('58条固定合成历史、25条边界及精确小数端点不依赖产品匹配器', () => {
    const rows = historyDurationFixtures(); expect(rows).toHaveLength(58); expect(new Set(rows.map(row => row.id)).size).toBe(58);
    expect(rows.slice(0, 50).every(row => row.elapsedMs === 201)).toBe(true); expect(rows.slice(50).map(row => row.elapsedMs)).toEqual([0, 99.5, 100, 100.5, 200, 201, 100, 200]);
    expect(rows[52]).toMatchObject({ id: 'history-duration-52', startedAt: '2026-10-22T00:00:06.000Z', success: true, connectionId: 'history-duration-source-a' }); expect(rows[52].sql.indexOf('纯合成尾部限定标记')).toBeGreaterThan(512);
  });
  it('原handler真回包签发cursor，continue/release只接受一次原cursor，未发数据库命令', async () => {
    const f = audit(); await f.invoke('history.page', f.input()); expect(f.read()).toMatchObject({ starts: 1, pending: 0, databaseCommands: 0, cursors: [f.cursor] });
    await f.invoke('history.pageContinue', { taskId: f.input().taskId, cursor: f.cursor }); expect(f.read()).toMatchObject({ continues: 1, cursors: [f.cursor] });
    await f.invoke('history.pageRelease', { cursor: f.cursor }); expect(f.read()).toMatchObject({ releases: 1, cursors: [] });
    await expect(f.invoke('history.pageRelease', { cursor: f.cursor })).rejects.toThrow('永久停链'); expect(f.original).toHaveBeenCalledTimes(3);
  });
  it.each(['connections.open', 'connections.save', 'sessions.open', 'query.execute', 'query.cancel', 'metadata.databases', 'history.read', 'history.list', 'settings.save'])('原handler之前拒绝%s，不伪造产品响应', async command => {
    const f = audit(); await expect(f.invoke(command, {})).rejects.toThrow('永久停链'); expect(f.original).not.toHaveBeenCalled(); expect(() => f.read()).toThrow('永久停链');
  });
  it.each(['processId', 'frameToken', 'url'])('原frame%s漂移即停链，改回不复活', field => {
    const f = audit(), before = f.frame[field as keyof typeof f.frame]; Reflect.set(f.frame, field, field === 'processId' ? 12 : '替换值'); expect(() => f.read()).toThrow(); Reflect.set(f.frame, field, before); expect(() => f.read()).toThrow(); expect(f.original).not.toHaveBeenCalled();
  });
  it('导航ABA、原handler替换及未知cursor均保留永久失败', async () => {
    const f = audit(); f.events.get('did-start-navigation')![0]({ isMainFrame: true, isSameDocument: false }); expect(() => f.read()).toThrow();
    const replaced = audit(); replaced.handlers.set('dbark:request', vi.fn()); expect(() => replaced.read()).toThrow();
    const unknown = audit(); await expect(unknown.invoke('history.pageRelease', { cursor: unknown.cursor })).rejects.toThrow(); expect(unknown.original).not.toHaveBeenCalled();
  });
  it('只有原正常退出阶段精确空标签settings可落一次，异值及第二次不放行', async () => {
    const f = audit(); f.appEvents.get('before-quit')![0](); await f.invoke('settings.save', { theme: 'dark', tabs: [] }); expect(f.original).toHaveBeenCalledOnce();
    f.appEvents.get('will-quit')![0](); expect(f.logs[0]).toContain('"settingsSaved":1');
    await expect(f.invoke('settings.save', { theme: 'dark', tabs: [] })).rejects.toThrow(); expect(f.original).toHaveBeenCalledOnce();
    const changed = audit(); changed.appEvents.get('before-quit')![0](); await expect(changed.invoke('settings.save', { tabs: [], theme: 'light' })).rejects.toThrow(); expect(changed.original).not.toHaveBeenCalled();
  });
  it('迟到原handler回包仍核原文档，pending计数等原Promise结束，不补发', async () => {
    const f = audit(); let resolve!: (value: unknown) => void; f.original.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const operation = f.invoke('history.page', f.input()); expect(f.read().pending).toBe(1); f.events.get('did-start-navigation')![0]({ isMainFrame: true, isSameDocument: false });
    resolve({ ok: true, result: { items: [], failures: [], failed: 0, scanned: 25, matched: 0 } }); await expect(operation).rejects.toThrow('永久停链'); expect(f.original).toHaveBeenCalledOnce();
  });
});
