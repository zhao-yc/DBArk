import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import { sealEditorIndentLaunchIdentity } from '../e2e/editor-indentation-native-identity';
const url = new URL('../e2e/editor-indentation-native-runtime.ts', import.meta.url), source = readFileSync(url, 'utf8'), tree = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
function method(name: string) { const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!; expect(node).toBeDefined(); return ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }

/** 真正运行原生适配器函数，Electron/目录/PID均为RAM；不导入原生模块或调用操作系统。 */
function fixture(mode: '正常' | '无握手关闭' | 'PID权限错误' | '链接目录' = '正常', installed = false, platform = 'win32') {
  const parent = resolve('RAM-native-parent'), directory = join(parent, 'dbark-indent-RAM'), applications: any[] = []; let exists = false, ownedStats = 0, blocked = 0;
  const project = resolve('RAM-source'), root = installed ? resolve('RAM-install') : project, resources = join(installed ? root : resolve('RAM-electron'), 'resources'), exe = join(installed ? root : resolve('RAM-electron'), 'DBArk.exe'), appPath = installed ? join(resources, 'app.asar') : root;
  const bytes = new Map<string, Uint8Array>(), put = (path: string, text: string) => bytes.set(path, Buffer.from(text));
  put(exe, '批准EXE-A'); put(join(project, 'scripts/check-offline-query-port.mjs'), '原固定端口脚本');
  if (installed) put(appPath, '批准asar-A'); else { put(join(root, 'package.json'), '{"main":"dist/main/index.cjs"}'); put(join(root, 'dist/main/index.cjs'), '批准main'); put(join(root, 'dist/renderer/index.html'), '批准renderer'); put(join(resources, 'default_app.asar'), '批准Electron-bootstrap'); }
  const manifest = { version: 1, kind: installed ? 'installed' : 'source', root, executable: exe, appPath, resources, files: [...bytes].map(([path, data]) => ({ path, sha256: createHash('sha256').update(data).digest('hex') })) };
  const manifestPath = resolve('RAM-approval.json'); put(manifestPath, JSON.stringify(manifest));
  const environment: NodeJS.ProcessEnv = { DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_MANIFEST: manifestPath, DBARK_EDITOR_INDENT_MANIFEST_SHA256: createHash('sha256').update(bytes.get(manifestPath)!).digest('hex'), ...(installed ? { DBARK_EXECUTABLE_PATH: exe } : {}) };
  let entered!: () => void, released!: () => void, waiting = Promise.resolve();
  let applicationHook = (_value: any) => {};
  const preflight = vi.fn(async () => {}), assertCurrent = vi.fn(), removed = vi.fn(async () => { exists = false; });
  const launch = vi.fn(async () => {
    const application = new EventEmitter() as any, runtime = new EventEmitter() as any, page = new EventEmitter() as any;
    application.runtime = runtime; application.page = page; page.locator = () => ({}); page.url = () => pathToFileURL(join(appPath, 'dist/renderer/index.html')).href; runtime.getAppMetrics = () => [{ pid: 202 }]; runtime.getAppPath = () => appPath; runtime.isPackaged = installed;
    const window = { id: 1, webContents: { id: 11, getOSProcessId: () => 202, getURL: () => page.url() }, isDestroyed: () => false }, child = { pid: 101 };
    runtime.quit = () => { if (mode === '无握手关闭') application.emit('close'); else runtime.emit('will-quit'); };
    application.evaluate = async (fn: Function, arg: unknown) => fn({ app: runtime, BrowserWindow: { getAllWindows: () => [window] } }, arg); application.firstWindow = async () => page; application.process = () => child; application.browserWindow = async (value: unknown) => { expect(value).toBe(page); return { evaluate: async (fn: Function) => fn(window) }; };
    application.waitForEvent = () => new Promise(done => application.once('close', done)); application.close = vi.fn(async () => { expect(runtime.listenerCount('will-quit')).toBe(0); application.emit('close'); }); applications.push(application); applicationHook(application); return application;
  });
  const probe = vi.fn((_pid: number, _signal: number) => { throw Object.assign(Error('合成探测'), { code: mode === 'PID权限错误' ? 'EPERM' : 'ESRCH' }); });
  // 有限RAM采样模拟指标稍后就绪，不启动计时器、进程、窗口或系统探测。
  const poll = (read: () => unknown) => ({ toEqual: async (value: unknown) => expect(await read()).toEqual(value), toBe: async (value: unknown) => { let actual: unknown; for (let attempt = 0; attempt < 3; attempt++) { actual = await read(); if (actual === value) return; } expect(actual).toBe(value); } });
  const nativeExpect = Object.assign(() => ({ toBeVisible: async () => {} }), { poll });
  const context: any = { exports: {}, EditorIndentNativeRun, sealEditorIndentLaunchIdentity, expect: nativeExpect, electron: { launch }, requireIndentOfflinePort: preflight, randomUUID: () => 'RAM-marker', WeakMap, Set, URL, fileURLToPath, dirname, basename, resolve, join, __dirname: join(project, 'tests/e2e'), tmpdir: () => parent,
    realpath: async (path: string) => path, mkdtemp: async () => { exists = true; return directory; }, lstat: async (path: string) => {
      if (path === directory) { ownedStats++; if (ownedStats === blocked) { entered(); await waiting; } if (!exists) throw Object.assign(Error('不存在'), { code: 'ENOENT' }); return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => mode === '链接目录' }; }
      const file = bytes.has(path), dir = [root, resources, ...[...bytes.keys()].flatMap(path => { const names: string[] = []; while (dirname(path) !== path) { path = dirname(path); names.push(path); } return names; })].includes(path);
      if (!file && !dir) throw Object.assign(Error('不存在'), { code: 'ENOENT' }); return { isFile: () => file, isDirectory: () => dir && !file, isSymbolicLink: () => false };
    }, readdir: async (path: string) => [...new Set([...bytes.keys()].filter(name => name.startsWith(path + (process.platform === 'win32' ? '\\' : '/'))).map(name => name.slice(path.length + 1).split(/[\\/]/)[0]))], readFile: async (path: string) => { if (!bytes.has(path)) throw Error('RAM未知文件'); return bytes.get(path)!; }, rm: removed,
    process: { env: environment, pid: platform === 'win32' ? 303 : 101, ppid: 101, platform, execPath: exe, resourcesPath: resources, kill: probe }, setTimeout: (callback: () => void) => callback(), console: { log: (message: string) => applications.at(-1).emit('console', { text: () => message }) },
  };
  const run = runInNewContext(method('createEditorIndentNativeRun') + '\ncreateEditorIndentNativeRun(binding)', { ...context, binding: { assertCurrent } }) as EditorIndentNativeRun;
  return { run, launch, preflight, assertCurrent, removed, applications, probe, directory, bytes, exe, manifestPath, manifest, environment, context, root, project, appPath, resources, onLaunch: (hook: typeof applicationHook) => { applicationHook = hook; }, countOwned: () => ownedStats, pauseOwned: (at: number) => { blocked = at; waiting = new Promise(done => { released = done; }); return { entered: new Promise<void>(done => { entered = done; }), release: () => released() }; } };
}
describe('缩进原生适配器的实际边界函数（RAM）', () => {
  it('固定脚本唯一参数、正常子进程完成前不通过；失败原样拒绝', async () => {
    let done!: () => void; const child = vi.fn(() => new Promise<void>(yes => { done = yes; })), executable = {};
    const fn = method('requireIndentOfflinePort');
    const invoke = runInNewContext(fn + '\nrequireIndentOfflinePort', { exports: {}, promisify: (value: unknown) => { expect(value).toBe(executable); return child; }, execFile: executable, resolve, __dirname: dirname(fileURLToPath(url)), process: { execPath: '固定Node' } }) as (env: object) => Promise<void>;
    const env = { DBARK_INTEGRATION_ENABLED: '0' }; let completed = false; const pending = invoke(env).then(() => { completed = true; }); await Promise.resolve(); expect(completed).toBe(false);
    expect(child).toHaveBeenCalledWith('固定Node', [fileURLToPath(new URL('../../scripts/check-offline-query-port.mjs', url))], { env, timeout: 10000, windowsHide: true }); done(); await pending; expect(completed).toBe(true);
    child.mockRejectedValueOnce(Error('原socket未关闭')); await expect(invoke(env)).rejects.toThrow('原socket未关闭');
  });
  it('原will-quit之后才调用公开close，两次owner全部PID不存在后才能删除原目录', async () => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second); await f.run.finish();
    expect(f.preflight).toHaveBeenCalledTimes(2); expect(f.launch).toHaveBeenCalledTimes(2); expect(f.applications.every(value => value.close.mock.calls.length === 1)).toBe(true); expect(f.probe).toHaveBeenCalledTimes(6); expect(f.removed).toHaveBeenCalledWith(f.directory, { recursive: true, force: false }); expect(f.run.removed).toBe(true);
  });
  it('意外close没有本owner握手即停链，不调用公开close补造退出或自动删除', async () => {
    const f = fixture('无握手关闭'), owner = await f.run.launch(); await expect(f.run.close(owner)).rejects.toThrow('未取得will-quit'); expect(owner.confirmed).toBe(false); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('PID权限错误不能按不存在放行；目录链接也在真正launch前拒绝', async () => {
    const f = fixture('PID权限错误'), owner = await f.run.launch(); await expect(f.run.close(owner)).rejects.toMatchObject({ code: 'EPERM' }); expect(owner.confirmed).toBe(false); expect(f.removed).not.toHaveBeenCalled();
    const g = fixture('链接目录'); await expect(g.run.launch()).rejects.toThrow('目录归属未知'); expect(g.launch).not.toHaveBeenCalled(); expect(g.removed).not.toHaveBeenCalled();
  });
  it('真实适配器不能用非空主PID掩盖空metrics，退出前即停链保留', async () => {
    const f = fixture(), owner = await f.run.launch(); f.applications[0].runtime.getAppMetrics = () => [];
    await expect(f.run.close(owner)).rejects.toThrow('metrics PID未知'); expect(owner.confirmed).toBe(false); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
});

describe('run1622资源线索窄修（RAM）', () => {
  it('主PID漂移仍拒绝并停链，但先留存本次已观察的正main与metrics', async () => {
    const f = fixture(), owner = await f.run.launch(); f.context.process.pid = 909; f.applications[0].runtime.getAppMetrics = () => [{ pid: 202 }, { pid: 707 }];
    await expect(f.run.close(owner)).rejects.toThrow('启动器关系未知'); expect(f.run.retained).toBe(true); expect(owner.confirmed).toBe(false);
    expect(owner.ids.has(909)).toBe(true); expect(owner.ids.has(707)).toBe(true); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('短暂正renderer不在当前metrics也先保留，后续完整认证不抹掉该线索', async () => {
    const f = fixture(); let samples = 0;
    f.onLaunch(app => { const original = app.browserWindow; app.browserWindow = async (page: unknown) => { const handle = await original(page); return { evaluate: async (fn: Function) => ({ ...await handle.evaluate(fn), renderer: samples++ === 0 ? 505 : 202 }) }; }; });
    const owner = await f.run.launch(); expect(owner.ids.has(505)).toBe(true); await f.run.close(owner);
    expect(f.probe.mock.calls).toContainEqual([505, 0]); expect(f.probe.mock.calls.every(call => call[1] === 0)).toBe(true);
  });
  it('实际evaluate返回的窗口正PID即使后续消失，也作为原owner线索保留', async () => {
    const f = fixture(); let samples = 0;
    f.onLaunch(app => { const original = app.evaluate; app.evaluate = async (fn: Function, arg: unknown) => { const value = await original(fn, arg); return String(fn).includes('BrowserWindow') && samples++ === 0 ? { ...value, windows: [{ id: 1, contents: 11, renderer: 505 }] } : value; }; });
    const owner = await f.run.launch(); expect(owner.ids.has(505)).toBe(true); await f.run.close(owner); expect(f.probe.mock.calls).toContainEqual([505, 0]);
  });
  it('候选renderer持续缺少完整认证时永久retain，线索不能授权退出或清理', async () => {
    const f = fixture();
    f.onLaunch(app => { const original = app.browserWindow; app.browserWindow = async (page: unknown) => { const handle = await original(page); return { evaluate: async (fn: Function) => ({ ...await handle.evaluate(fn), renderer: 505 }) }; }; });
    await expect(f.run.launch()).rejects.toThrow(); const owner = f.run.owners[0]; expect(owner.ids.has(505)).toBe(true); expect(f.run.retained).toBe(true);
    await expect(f.run.close(owner)).rejects.toThrow('owner已失效'); expect(owner.confirmed).toBe(false); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('实际evaluate返回时原门已失效，也先保留本次正main和metrics再拒绝', async () => {
    const f = fixture(), owner = await f.run.launch(), app = f.applications[0], original = app.evaluate;
    f.context.process.pid = 909; app.runtime.getAppMetrics = () => [{ pid: 707 }]; app.evaluate = async (fn: Function, arg: unknown) => { const value = await original(fn, arg); f.run.retained = true; return value; };
    await expect(f.run.close(owner)).rejects.toThrow('owner已失效'); expect(owner.ids.has(909)).toBe(true); expect(owner.ids.has(707)).toBe(true); expect(app.close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('窗口evaluate返回时原门已失效，也先保留正renderer再拒绝', async () => {
    const f = fixture();
    f.onLaunch(app => { const original = app.browserWindow; app.browserWindow = async (page: unknown) => { const handle = await original(page); return { evaluate: async (fn: Function) => { const value = await handle.evaluate(fn); f.run.retained = true; return { ...value, renderer: 505 }; } }; }; });
    await expect(f.run.launch()).rejects.toThrow('owner已失效'); const owner = f.run.owners[0]; expect(owner.ids.has(505)).toBe(true); expect(owner.confirmed).toBe(false); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('来源诊断滚出12条后仍保留早期候选PID，后续metrics不能冲掉线索集合', async () => {
    const f = fixture(); let samples = 0; const originalPoll = f.context.expect.poll;
    f.context.expect.poll = (read: () => unknown, options: unknown) => ({ ...originalPoll(read, options), toBe: async (expected: unknown) => { let value: unknown; for (let index = 0; index < 16; index++) { value = await read(); if (value === expected) return; } expect(value).toBe(expected); } });
    f.onLaunch(app => { const original = app.browserWindow; app.browserWindow = async (page: unknown) => { const handle = await original(page); return { evaluate: async (fn: Function) => ({ ...await handle.evaluate(fn), renderer: samples++ === 0 ? 505 : samples < 15 ? 0 : 202 }) }; }; });
    const owner = await f.run.launch(); expect(owner.sourceDiagnostics).toHaveLength(12); expect(owner.sourceDiagnostics?.some(value => value.observed.window?.renderer === 505)).toBe(false); expect(owner.ids.has(505)).toBe(true);
    await f.run.close(owner); expect(f.probe.mock.calls).toContainEqual([505, 0]); expect(f.probe.mock.calls.every(call => call[1] === 0)).toBe(true);
  });
  it('资源线索只纳入正安全整数，非法main和metrics仍按原来源门拒绝', async () => {
    const f = fixture(); f.context.process.pid = Number.MAX_SAFE_INTEGER + 1; f.onLaunch(app => { app.runtime.getAppMetrics = () => [0, -1, NaN, Number.MAX_SAFE_INTEGER + 1, 202].map(pid => ({ pid })); });
    await expect(f.run.launch()).rejects.toThrow(); const owner = f.run.owners[0]; expect([...owner.ids]).toEqual([101, 202]); expect(owner.confirmed).toBe(false); expect(f.run.retained).toBe(true); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
});

describe('修复复核：独审六红中的runtime四条及固定字节边界（RAM）', () => {
  it.each(['retained', 'controller', 'normal'] as const)('原launch内部第二个目录await：%s', async mode => {
    const f = fixture(), pause = f.pauseOwned(2), pending = f.run.launch().catch(error => error); await pause.entered;
    if (mode === 'retained') f.run.retained = true;
    if (mode === 'controller') { await expect(f.run.launch()).rejects.toThrow('前次owner未正常退出'); expect(f.run.retained).toBe(true); }
    pause.release(); const result = await pending;
    if (mode === 'normal') { expect(result).not.toBeInstanceOf(Error); expect(f.launch).toHaveBeenCalledTimes(1); }
    else { expect(result).toBeInstanceOf(Error); expect(f.launch).not.toHaveBeenCalled(); expect(f.run.owners).toHaveLength(0); }
  });
  it.each(['retained', 'controller', 'normal'] as const)('原remove内部目录await：%s', async mode => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second);
    const pause = f.pauseOwned(f.countOwned() + 2), pending = f.run.finish().catch(error => error); await pause.entered;
    if (mode === 'retained') f.run.retained = true;
    if (mode === 'controller') { await expect(f.run.launch()).rejects.toThrow('前次owner未正常退出'); expect(f.run.retained).toBe(true); }
    pause.release(); const result = await pending;
    if (mode === 'normal') { expect(result).toBeUndefined(); expect(f.removed).toHaveBeenCalledOnce(); expect(f.run.removed).toBe(true); }
    else { expect(result).toBeInstanceOf(Error); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.removed).toBe(false); }
  });
  it.each([false, true])('原同一安装路径EXE字节变化=%s，两次入口仍须同一批准映像', async changed => {
    const f = fixture('正常', true), first = await f.run.launch(); await f.run.close(first); if (changed) f.bytes.set(f.exe, Buffer.from('替换EXE-B'));
    const result = await f.run.launch().catch(error => error);
    if (changed) { expect(result).toBeInstanceOf(Error); expect(f.launch).toHaveBeenCalledTimes(1); expect(f.run.owners).toHaveLength(1); }
    else { expect(result).not.toBeInstanceOf(Error); expect(f.launch).toHaveBeenCalledTimes(2); }
  });
  it.each(['asar', 'compiled', 'manifest'] as const)('批准清单固定%s字节，不用当前文件重新签发身份', async target => {
    const f = fixture('正常', target === 'asar'), first = await f.run.launch(); await f.run.close(first);
    const path = target === 'asar' ? f.appPath : target === 'compiled' ? join(f.root, 'dist/renderer/index.html') : f.manifestPath;
    f.bytes.set(path, Buffer.from('相同路径的新字节')); await expect(f.run.launch()).rejects.toThrow('批准'); expect(f.launch).toHaveBeenCalledTimes(1); expect(f.run.retained).toBe(true);
  });
  it('源码使用固定绝对cwd/root参数；已到手但失效的launch仍登记主句柄和PID', async () => {
    const f = fixture(), owner = await f.run.launch(); expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({ cwd: f.root, args: [f.root], executablePath: f.exe })); await f.run.close(owner);
    const g = fixture(); g.onLaunch(app => { app.evaluate = vi.fn(app.evaluate); g.run.retained = true; }); await expect(g.run.launch()).rejects.toThrow();
    expect(g.run.owners).toHaveLength(1); expect([...g.run.owners[0].ids]).toEqual([101]); expect(g.applications[0].evaluate).not.toHaveBeenCalled(); expect(g.removed).not.toHaveBeenCalled();
  });
  it.each(['appPath', 'mainPid', 'page'] as const)('实际返回%s身份不符即保留已取得owner，不能进入成功或清理', async target => {
    const f = fixture();
    if (target === 'mainPid') f.context.process.pid = 0;
    f.onLaunch(app => {
      if (target === 'appPath') app.runtime.getAppPath = () => resolve('RAM-foreign-app');
      if (target === 'page') app.browserWindow = async () => ({ evaluate: async () => ({ id: 999, contents: 999, renderer: 202, url: app.page.url(), destroyed: false }) });
    });
    await expect(f.run.launch()).rejects.toThrow(); expect(f.run.owners).toHaveLength(1); expect(f.run.owners[0].confirmed).toBe(false); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });
});

describe('run1616窄修：Windows启动器与窗口准备分阶段（RAM）', () => {
  it('Windows封存原shell ChildProcess及实际子进程，两种PID都保留到正常退出核查', async () => {
    const f = fixture(), owner = await f.run.launch();
    expect([...owner.ids].sort()).toEqual([101, 202, 303]);
    expect(owner.sourceDiagnostics?.[0]).toMatchObject({ phase: '启动来源', complete: false, expected: { launcherPid: 101, relation: '启动器父进程' }, observed: { mainPid: 303, parentPid: 101, platform: 'win32' } });
    expect(owner.sourceDiagnostics?.at(-1)).toMatchObject({ phase: '窗口准备', complete: true, expected: { launcherPid: 101, mainPid: 303 }, observed: { window: { renderer: 202 } } });
    await f.run.close(owner); expect(f.probe.mock.calls).toEqual([[101, 0], [303, 0], [202, 0]]);
  });
  it.each(['linux', 'darwin'])('非Windows的%s仍要求实际主PID与启动器相同，不扩大拓扑', async platform => {
    const f = fixture('正常', false, platform), owner = await f.run.launch(); expect(owner.sourceDiagnostics?.[0].expected.relation).toBe('同一进程'); await f.run.close(owner);
    const g = fixture('正常', false, platform); g.context.process.pid = 303;
    await expect(g.run.launch()).rejects.toThrow('启动器关系未知'); expect(g.run.retained).toBe(true); expect(g.removed).not.toHaveBeenCalled();
  });
  it.each([{ metrics: [] }, { metrics: [{ pid: 0 }] }])('启动阶段指标$metrics只能标记未完成，窗口后必须重新取得有效renderer', async ({ metrics }) => {
    const f = fixture(); let preparing = false, samples = 0;
    f.onLaunch(app => { app.runtime.getAppMetrics = () => !preparing || samples++ === 0 ? metrics : [{ pid: 202 }]; app.firstWindow = async () => { preparing = true; return app.page; }; });
    const owner = await f.run.launch(); expect(owner.sourceDiagnostics?.slice(0, 2).every(value => !value.complete)).toBe(true);
    expect(owner.sourceDiagnostics?.at(-1)).toMatchObject({ phase: '窗口准备', complete: true, observed: { metrics: [202] } }); expect(owner.ids.has(0)).toBe(false);
  });
  it.each([{ metrics: [] }, { metrics: [{ pid: 0 }] }, { metrics: [{ pid: -1 }] }, { metrics: [{ pid: 404 }] }])('窗口后指标持续$metrics时有界拒绝，不以主PID代替renderer或自动清理', async ({ metrics }) => {
    const f = fixture(); f.onLaunch(app => { app.runtime.getAppMetrics = () => metrics; });
    await expect(f.run.launch()).rejects.toThrow(); const owner = f.run.owners[0];
    expect(owner.sourceDiagnostics?.at(-1)).toMatchObject({ phase: '窗口准备', complete: false, observed: { metrics: metrics.map(value => value.pid) } }); expect(owner.ids.has(0)).toBe(false); expect(owner.confirmed).toBe(false); expect(f.run.retained).toBe(true); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
  it('窗口renderer首次为零时不能与有效metrics拼成证明，须重新取得同一窗口的正PID', async () => {
    const f = fixture(); let samples = 0;
    f.onLaunch(app => { const original = app.browserWindow; app.browserWindow = async (page: unknown) => { const handle = await original(page); return { evaluate: async (fn: Function) => ({ ...await handle.evaluate(fn), renderer: samples++ === 0 ? 0 : 202 }) }; }; });
    const owner = await f.run.launch(); expect(owner.sourceDiagnostics?.filter(value => value.phase === '窗口准备').map(value => [value.complete, value.observed.window?.renderer])).toEqual([[false, 0], [true, 202]]); expect(owner.ids.has(0)).toBe(false);
  });
  it('Windows实际父PID不符立即拒绝，附件保留精确observed与expected而不猜测', async () => {
    const f = fixture(); f.context.process.ppid = 999;
    await expect(f.run.launch()).rejects.toThrow('启动器关系未知'); const owner = f.run.owners[0];
    expect(owner.sourceDiagnostics).toHaveLength(1); expect(owner.sourceDiagnostics?.[0]).toMatchObject({ complete: false, expected: { launcherPid: 101, relation: '启动器父进程' }, observed: { mainPid: 303, parentPid: 999, metrics: [202] } }); expect(owner.page).toBeUndefined(); expect([...owner.ids]).toEqual([101, 303, 202]);
  });
  it('已封存的实际主PID变化即拒绝，不因仍有相同父PID接受替代主进程', async () => {
    const f = fixture(), owner = await f.run.launch(); f.context.process.pid = 909;
    await expect(f.run.close(owner)).rejects.toThrow('启动器关系未知'); expect(owner.sourceDiagnostics?.at(-1)).toMatchObject({ complete: false, expected: { mainPid: 303 }, observed: { mainPid: 909, parentPid: 101 } }); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(owner.confirmed).toBe(false);
  });
  it('窗口指标等待中原门失效后不继续采样或把poll成功当授权', async () => {
    const f = fixture(); let calls = 0;
    f.onLaunch(app => { app.firstWindow = async () => { app.runtime.getAppMetrics = () => { calls++; f.run.retained = true; return []; }; return app.page; }; });
    await expect(f.run.launch()).rejects.toThrow('owner已失效'); expect(calls).toBe(1); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });
});
