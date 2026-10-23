import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { bindHistoryDeleteUi, historyDeleteFixtures, historyDeleteUiActive, installHistoryDeleteAudit, readHistoryDeleteAudit } from '../helpers/historyDeleteUi';

const compiled = ts.transpileModule(readFileSync(new URL('../e2e/history-delete.spec.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const configuration = (): NodeJS.ProcessEnv => ({ DBARK_HISTORY_DELETE_UI: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_HISTORY_DELETE_OUTPUT: 'D:\\owned\\dbark-history-delete-' + 'a'.repeat(32), DBARK_HISTORY_DELETE_MANIFEST: 'D:\\owned\\manifest.json', DBARK_HISTORY_DELETE_MANIFEST_SHA256: 'a'.repeat(64) });
/** 实际spec转译只接RAM注册器；默认路径若尝试加载任何桌面/SQLite即失败。 */
function collect(args: string[], enabled = '0') {
  const reads: string[] = [], imports: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy({ DBARK_HISTORY_DELETE_UI: enabled }, { get(value, key: string) { reads.push(key); if (key !== 'DBARK_HISTORY_DELETE_UI') throw Error('收集阶段读取额外配置'); return value.DBARK_HISTORY_DELETE_UI; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: args, env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; imports.push(name); if (name !== '../helpers/historyDeleteUi') throw Error('禁止加载桌面或SQLite'); return { registerHistoryDeleteUi: register }; } }));
  return { reads, imports, skip, register };
}
/** 原处理器边界使用RAM固定响应；验证审计没有伪造、重发或提前完成真实Promise。 */
function audit() {
  const frame = { processId: 10, frameToken: '原frame', url: 'file:///D:/dbark/dist/renderer/index.html', detached: false };
  const target = { senderId: 2, pid: 100, userData: 'D:\\本例\\profile', url: frame.url, marker: '本例退出' };
  const listeners = new Map<string, Function[]>(), appEvents = new Map<string, Function[]>(), logs: string[] = [];
  const contents = { id: 2, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, getOSProcessId: () => 101, on(name: string, action: Function) { listeners.set(name, [...listeners.get(name) ?? [], action]); } };
  const window = { webContents: contents, isDestroyed: () => false };
  const original = vi.fn(async (_event: unknown, payload: any): Promise<any> => ({ ok: true, result: payload.command === 'history.deletePreview' ? { previewToken: '原token', count: 3, scanned: 3, kind: 'selected', samples: [{ entry: { id: 'h081' } }] } : payload.command === 'history.deleteApply' ? { deleted: 3, applied: true } : undefined }));
  const handlers = new Map([['dbark:request', original]]);
  const main = { ipcMain: { _invokeHandlers: handlers }, BrowserWindow: { getAllWindows: () => [window] }, app: { getPath: () => target.userData, getAppMetrics: () => [{ pid: 100 }, { pid: 101 }], on(name: string, action: Function) { appEvents.set(name, [...appEvents.get(name) ?? [], action]); }, once(name: string, action: Function) { appEvents.set(name, [...appEvents.get(name) ?? [], action]); } } };
  const context = createContext({ process: { pid: 100 }, console: { log: (line: string) => logs.push(line) }, main, target });
  runInContext(`(${installHistoryDeleteAudit.toString()})(main,target);globalThis.read=(${readHistoryDeleteAudit.toString()});`, context);
  return { context, frame, target, original, handlers, listeners, appEvents, logs, read: () => context.read(), invoke: (command: string, input: unknown = {}) => handlers.get('dbark:request')!({ sender: contents, senderFrame: frame }, { command, input }) };
}

describe('历史清理正式离线专项gate', () => {
  it.each(['--list', '--list=json'])('%s先短路，显式gate也不读取环境或加载helper', flag => {
    const f = collect([flag], '1'); expect(f.reads).toEqual([]); expect(f.imports).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled();
    const environment = new Proxy({}, { get() { throw Error('禁止读取环境'); } }); expect(historyDeleteUiActive([flag], environment)).toBe(false);
  });
  it('默认只登记未执行定义，唯有显式gate才加载注册器', () => {
    const closed = collect([]); expect(closed.reads).toEqual(['DBARK_HISTORY_DELETE_UI']); expect(closed.imports).toEqual([]); expect(closed.skip).toHaveBeenCalledOnce();
    const active = collect([], '1'); expect(active.imports).toEqual(['../helpers/historyDeleteUi']); expect(active.register).toHaveBeenCalledOnce(); expect(active.skip).not.toHaveBeenCalled();
  });
  it('只接受Windows五项封闭配置，普通TEMP/TMP允许，漂移改回永久失效', () => {
    let env: NodeJS.ProcessEnv = { ...configuration(), TEMP: 'D:\\temp', TMP: 'D:\\temp' }; const binding = bindHistoryDeleteUi(() => ({ args: [], env, platform: 'win32' })); binding.assertCurrent();
    env = { ...env, DBARK_HISTORY_DELETE_OUTPUT: 'D:\\owned\\dbark-history-delete-' + 'b'.repeat(32) }; expect(() => binding.assertCurrent()).toThrow('变化');
    env = { ...configuration(), TEMP: 'D:\\temp', TMP: 'D:\\temp' }; expect(() => binding.assertCurrent()).toThrow('永久停链');
    expect(() => bindHistoryDeleteUi(() => ({ args: [], env: configuration(), platform: 'darwin' }))).toThrow();
  });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_TEST_PASSWORD', 'dbark_ssh_key', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('额外配置%s连空值也拒绝，不承袭用户认证', key => {
    expect(() => bindHistoryDeleteUi(() => ({ args: [], env: { ...configuration(), [key]: '' }, platform: 'win32' }))).toThrow();
  });
  it.each(['--config=x', '-cx', '--debug', '--ui', '--workers=2', '--repeat-each=2', '--retries=1', '--trace=on'])('拒绝运行器覆盖%s', argument => {
    expect(() => bindHistoryDeleteUi(() => ({ args: [argument], env: configuration(), platform: 'win32' }))).toThrow();
  });
  it.each([{ DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_HISTORY_DELETE_OUTPUT: 'relative' }, { DBARK_HISTORY_DELETE_OUTPUT: 'D:\\owned\\dbark-history-delete-nope' }, { DBARK_HISTORY_DELETE_MANIFEST: 'relative' }, { DBARK_HISTORY_DELETE_MANIFEST_SHA256: 'A'.repeat(64) }])('拒绝实库、未规范路径、非独占输出和无效摘要%j', patch => {
    expect(() => bindHistoryDeleteUi(() => ({ args: [], env: { ...configuration(), ...patch }, platform: 'win32' }))).toThrow();
  });
  it('83条原ID及尾部37条命中固定，删1+3+37后恰好42条，不依赖产品匹配器', () => {
    const rows = historyDeleteFixtures(); expect(rows.map(row => row.id)).toEqual(Array.from({ length: 83 }, (_, index) => 'h' + String(index).padStart(3, '0')));
    expect(new Set(rows.map(row => row.startedAt)).size).toBe(1); expect(rows.filter(row => row.sql.includes('grp删除中文_')).map(row => row.id)).toEqual(rows.slice(0, 37).map(row => row.id));
    expect(rows.slice(0, 37).every(row => row.sql.indexOf('grp删除中文_') > 2048)).toBe(true);
    const remaining = rows.filter(row => !['h082', 'h081', 'h080', 'h056'].includes(row.id) && !row.sql.includes('grp删除中文_'));
    expect(remaining).toHaveLength(42); expect(remaining[0].id).toBe('h037'); expect(remaining.at(-1)?.id).toBe('h079');
  });
});

describe('历史清理Main原处理器观察器', () => {
  it('原预览、原删除响应逐字透传，只记录命令和安全概要，不伪造结果', async () => {
    const f = audit(), preview = await f.invoke('history.deletePreview', { scope: { kind: 'selected' } });
    expect(preview).toEqual({ ok: true, result: { previewToken: '原token', count: 3, scanned: 3, kind: 'selected', samples: [{ entry: { id: 'h081' } }] } });
    expect(f.read()).toMatchObject({ pending: 0, databaseCommands: 0, tokens: ['原token'] });
    expect(await f.invoke('history.deleteApply', { previewToken: '原token' })).toEqual({ ok: true, result: { deleted: 3, applied: true } });
    expect(f.original).toHaveBeenCalledTimes(2); expect(f.read()).toMatchObject({ pending: 0, tokens: [], commands: ['history.deletePreview', 'history.deleteApply'] });
  });
  it('取消返回只透传原release，未请求删除；正常退出需真实quit事件退出码', async () => {
    const f = audit(); await f.invoke('history.deletePreview', { scope: { kind: 'selected' } }); await f.invoke('history.deleteRelease', { previewToken: '原token' });
    expect(f.read()).toMatchObject({ tokens: [] }); expect(f.read().events.some((item: any) => item.command === 'history.deleteApply')).toBe(false);
    f.appEvents.get('before-quit')![0](); await f.invoke('settings.save', { tabs: [] }); f.appEvents.get('will-quit')![0](); f.appEvents.get('quit')![0]({}, 0);
    expect(f.logs).toEqual(['本例退出:{"failed":false,"pending":0,"tokens":0,"settingsSaved":1,"databaseCommands":0}', '本例退出:EXIT:{"exitCode":0}']);
  });
  it.each(['connections.open', 'connections.test', 'connections.save', 'sessions.open', 'query.execute', 'metadata.databases', 'schema.create', 'table.page', 'files.import', 'excel.import'])('意外%s在物理原handler之前停链，无网络访问替身', async command => {
    const f = audit(); await expect(f.invoke(command)).rejects.toThrow('不允许数据库命令'); expect(f.original).not.toHaveBeenCalled(); expect(() => f.read()).toThrow('永久停链');
  });
  it('原文档导航或handler替换永久停链，迟到原Promise仍等待实际完成', async () => {
    const f = audit(); let resolve!: (value: unknown) => void; f.original.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.invoke('history.deletePreview', { scope: { kind: 'selected' } }); expect(f.read().pending).toBe(1);
    f.listeners.get('did-start-navigation')![0]({ isMainFrame: true, isSameDocument: false });
    resolve({ ok: true, result: { previewToken: '迟到token', count: 0, scanned: 0, kind: 'selected', samples: [] } }); await expect(pending).rejects.toThrow('永久停链'); expect(f.original).toHaveBeenCalledOnce();
    const replaced = audit(); replaced.handlers.set('dbark:request', vi.fn()); expect(() => replaced.read()).toThrow('永久停链');
  });
});
