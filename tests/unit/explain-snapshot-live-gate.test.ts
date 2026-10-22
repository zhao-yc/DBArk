import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { bindExplainPropertiesUi, explainPropertiesSql } from '../helpers/explainPropertiesUi';
import { installExplainSnapshotAudit, readExplainSnapshotAudit } from '../helpers/explainSnapshotUi';

/** RAM 审计只验证门，不构成文件 I/O、桌面或实库验收。 */
function audit(mode: 'live' | 'offline' = 'offline', callback?: (command: string, input: any, dialog: any, window: any) => Promise<any>) {
  const paths = { json: 'C:\\owned\\json.dbark-plan.json', text: 'C:\\owned\\text.dbark-plan.json', jsonResaved: 'C:\\owned\\json-resaved.dbark-plan.json', textResaved: 'C:\\owned\\text-resaved.dbark-plan.json' };
  const target = { senderId: 1, mode, profileId: mode === 'live' ? 'profile' : undefined, tabId: mode === 'live' ? 'tab' : undefined, sql: mode === 'live' ? explainPropertiesSql : undefined, paths };
  const frame = { processId: 1, frameToken: 'ram-frame', url: 'file:///ram/index.html', detached: false };
  const listeners = new Map<string, (...args: any[]) => void>(), sender = { id: 1, mainFrame: frame, isDestroyed: () => false, on: (name: string, handler: (...args: any[]) => void) => listeners.set(name, handler) }, window = { webContents: sender, isDestroyed: () => false };
  const dialog: any = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() };
  const original = vi.fn(async (_event: any, payload: any) => {
    const command = payload.command, input = payload.input;
    if (callback) return callback(command, input, dialog, window);
    let result: any = {};
    if (command === 'sessions.open') result = { sessionId: 'session' };
    if (command === 'connections.open') result = { dialect: 'mysql', version: '8.4.11' };
    if (command === 'query.explain') result = { results: [{ rows: [{ c0: '原值' }] }], explain: { format: input.format === 'auto' ? 'json' : 'text', dialect: 'mysql', version: '8.4.11', nodes: [{}], raw: '{}' } };
    if (['connections.list', 'tasks.list', 'history.list'].includes(command)) result = [];
    if (command === 'explainFiles.open') { const chosen = await dialog.showOpenDialog(window, { title: '选择计划快照文件' }); const path = chosen.filePaths[0]; result = { name: path.split('\\').at(-1), snapshot: { format: path === paths.json ? 'json' : 'text' } }; }
    if (command === 'explainFiles.save') { const chosen = await dialog.showSaveDialog(window, { title: '保存计划快照' }); result = { name: chosen.filePath.split('\\').at(-1) }; }
    return { ok: true, result };
  });
  const handlers = new Map<string, any>([['dbark:request', original]]), context: any = { ipcMain: { _invokeHandlers: handlers }, dialog, BrowserWindow: { getAllWindows: () => [window] }, target };
  runInNewContext(`(${installExplainSnapshotAudit.toString()})({ipcMain,dialog,BrowserWindow},target)`, context);
  return { target, original, handlers, dialog, window, listeners, send: (command: string, input: any = {}, other?: any) => handlers.get('dbark:request')({ sender: other ?? sender, senderFrame: frame }, { command, input }), read: () => runInNewContext(`(${readExplainSnapshotAudit.toString()})()`, context) };
}
const plan = (format: 'auto' | 'text') => ({ sessionId: 'session', sql: explainPropertiesSql, taskId: 'task-' + format, maxRows: 1000, format });
const snapshot = (format: 'json' | 'text') => ({ snapshot: { format } });

it('复用原9键配置，漂移后ABA也不能复活', () => {
  const env: NodeJS.ProcessEnv = { DBARK_INTEGRATION_ENABLED: '1', DBARK_EXPLAIN_PROPERTIES_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'ram', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '12345678-1234-1234-1234-123456789abc', DBARK_EXPLAIN_PROPERTIES_OUTPUT: resolve('.cache/dbark-explain-properties-' + 'a'.repeat(32)) };
  const binding = bindExplainPropertiesUi(() => ({ env, platform: 'win32' })); binding.assertCurrent(); env.DBARK_TEST_PORT = '13380'; expect(binding.assertCurrent).toThrow(); env.DBARK_TEST_PORT = '13384'; expect(binding.assertCurrent).toThrow();
});
it('默认和list分支在桌面及认证帮助器require之前关闭', () => {
  const source = readFileSync(new URL('../e2e/explain-snapshot.spec.ts', import.meta.url), 'utf8');
  expect(source.indexOf('!listing &&')).toBeLessThan(source.indexOf("require('../helpers/explainPropertiesUi')")); expect(source).toContain('baseTest.skip'); expect(source).toContain('test.setTimeout(120000)'); expect(source).toContain("retries: 0, mode: 'serial'"); expect(source).toContain('ownedDesktopLaunchGuard');
});
it('实库必须auto计划→保存JSON→text计划→保存文本，原端口返回不变', async () => {
  const f = audit('live'); await f.send('connections.open', { id: 'profile' }); await f.send('sessions.open', { connectionId: 'profile' });
  await f.send('query.explain', plan('auto')); const json = await f.send('explainFiles.save', snapshot('json')); expect(json).toEqual({ ok: true, result: { name: 'json.dbark-plan.json' } });
  await f.send('query.explain', plan('text')); await f.send('explainFiles.save', snapshot('text'));
  expect(f.read()).toEqual({ explains: 2, sessions: 1, saves: 2, opens: 0, dialogs: 2, pending: 0 });
});
it('离线严格打开JSON→另存JSON→打开文本→另存文本且无DB', async () => {
  const f = audit(); await f.send('connections.list'); await f.send('explainFiles.open'); await f.send('explainFiles.save', snapshot('json')); await f.send('explainFiles.open'); await f.send('explainFiles.save', snapshot('text')); await f.send('history.list'); await f.send('tasks.list');
  expect(f.read()).toEqual({ explains: 0, sessions: 0, saves: 2, opens: 2, dialogs: 4, pending: 0 });
});
it.each(['query.execute', 'query.explain', 'connections.open', 'connections.save', 'sessions.open', 'metadata.completion', 'files.choose', 'query.cancel'])('离线%s在原handler之前永久拒绝', async command => {
  const f = audit(); await expect(f.send(command)).rejects.toThrow(); expect(f.original).not.toHaveBeenCalled(); expect(f.read).toThrow();
});
it('禁止跳过原文件次序、错格式、额外输入、二次打开和三次计划', async () => {
  for (const [command, input] of [['explainFiles.save', snapshot('json')], ['explainFiles.open', { path: '其他路径' }]] as const) { const f = audit(); await expect(f.send(command, input)).rejects.toThrow(); expect(f.original).not.toHaveBeenCalled(); }
  const f = audit(); await f.send('explainFiles.open'); await expect(f.send('explainFiles.save', snapshot('text'))).rejects.toThrow(); expect(f.original).toHaveBeenCalledOnce();
  const live = audit('live'); await live.send('sessions.open', { connectionId: 'profile' }); await live.send('query.explain', plan('auto')); await expect(live.send('query.explain', plan('text'))).rejects.toThrow(); expect(live.original).toHaveBeenCalledTimes(2);
});
it('异步claim在await前消费，重入不能二次选择文件', async () => {
  let done!: (value: any) => void;
  const f = audit('offline', async () => new Promise(resolve => { done = resolve; })); const first = f.send('explainFiles.open'); expect(f.read().pending).toBe(1);
  await expect(f.send('explainFiles.open')).rejects.toThrow(); done({ ok: true, result: {} }); await expect(first).rejects.toThrow(); expect(f.original).toHaveBeenCalledOnce();
});
it('没有原请求、错误窗口或同一请求第二次选择均拒绝', async () => {
  const f = audit(); await expect(f.dialog.showOpenDialog(f.window, { title: '选择计划快照文件' })).rejects.toThrow(); expect(f.original).not.toHaveBeenCalled();
  const g = audit('offline', async (_command, _input, dialog) => { await dialog.showOpenDialog({}, { title: '选择计划快照文件' }); return { ok: true }; }); await expect(g.send('explainFiles.open')).rejects.toThrow();
  const h = audit('offline', async (_command, _input, dialog, window) => { await dialog.showOpenDialog(window, { title: '选择计划快照文件' }); await dialog.showOpenDialog(window, { title: '选择计划快照文件' }); return { ok: true }; }); await expect(h.send('explainFiles.open')).rejects.toThrow();
});
it('原handler、文件端口、目标和主文档变化均永久停链', () => {
  for (const mutate of [(f: ReturnType<typeof audit>) => f.handlers.set('dbark:request', vi.fn()), (f: ReturnType<typeof audit>) => { f.dialog.showOpenDialog = vi.fn(); }, (f: ReturnType<typeof audit>) => { f.target.paths.json = 'changed'; }, (f: ReturnType<typeof audit>) => { f.window.webContents.mainFrame = { ...f.window.webContents.mainFrame }; }, (f: ReturnType<typeof audit>) => { f.window.webContents.mainFrame.detached = true; }, (f: ReturnType<typeof audit>) => { f.window.webContents.mainFrame.processId++; }, (f: ReturnType<typeof audit>) => { f.window.webContents.mainFrame.frameToken = 'changed'; }, (f: ReturnType<typeof audit>) => { f.window.webContents.mainFrame.url = 'file:///changed'; }, (f: ReturnType<typeof audit>) => { f.listeners.get('did-start-navigation')?.({ isMainFrame: true, isSameDocument: false }); }]) { const f = audit(); mutate(f); expect(f.read).toThrow(); }
});
it('同id不同sender和其他窗口均不能借用原窗口', async () => {
  const f = audit(); await expect(f.send('tasks.list', {}, { id: 1 })).rejects.toThrow(); expect(f.original).not.toHaveBeenCalled();
  const g = audit(); await expect(g.send('tasks.list', {}, { id: 2 })).rejects.toThrow(); expect(g.original).not.toHaveBeenCalled(); expect(g.read).toThrow();
});
it('离线读取到活动连接、历史或任务也停链', async () => {
  for (const command of ['connections.list', 'history.list', 'tasks.list']) { const f = audit('offline', async () => ({ ok: true, result: [{}] })); await expect(f.send(command)).rejects.toThrow(); }
});
