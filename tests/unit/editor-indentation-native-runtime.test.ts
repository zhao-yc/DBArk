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
function fixture(mode: '正常' | '无握手关闭' | 'PID权限错误' | '链接目录' = '正常', installed = false) {
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
  const probe = vi.fn(() => { throw Object.assign(Error('合成探测'), { code: mode === 'PID权限错误' ? 'EPERM' : 'ESRCH' }); });
  const poll = (read: () => unknown) => ({ toEqual: async (value: unknown) => expect(read()).toEqual(value) });
  const nativeExpect = Object.assign(() => ({ toBeVisible: async () => {} }), { poll });
  const context: any = { exports: {}, EditorIndentNativeRun, sealEditorIndentLaunchIdentity, expect: nativeExpect, electron: { launch }, requireIndentOfflinePort: preflight, randomUUID: () => 'RAM-marker', WeakMap, Set, URL, fileURLToPath, dirname, basename, resolve, join, __dirname: join(project, 'tests/e2e'), tmpdir: () => parent,
    realpath: async (path: string) => path, mkdtemp: async () => { exists = true; return directory; }, lstat: async (path: string) => {
      if (path === directory) { ownedStats++; if (ownedStats === blocked) { entered(); await waiting; } if (!exists) throw Object.assign(Error('不存在'), { code: 'ENOENT' }); return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => mode === '链接目录' }; }
      const file = bytes.has(path), dir = [root, resources, ...[...bytes.keys()].flatMap(path => { const names: string[] = []; while (dirname(path) !== path) { path = dirname(path); names.push(path); } return names; })].includes(path);
      if (!file && !dir) throw Object.assign(Error('不存在'), { code: 'ENOENT' }); return { isFile: () => file, isDirectory: () => dir && !file, isSymbolicLink: () => false };
    }, readdir: async (path: string) => [...new Set([...bytes.keys()].filter(name => name.startsWith(path + (process.platform === 'win32' ? '\\' : '/'))).map(name => name.slice(path.length + 1).split(/[\\/]/)[0]))], readFile: async (path: string) => { if (!bytes.has(path)) throw Error('RAM未知文件'); return bytes.get(path)!; }, rm: removed,
    process: { env: environment, pid: 101, execPath: exe, resourcesPath: resources, kill: probe }, setTimeout: (callback: () => void) => callback(), console: { log: (message: string) => applications.at(-1).emit('console', { text: () => message }) },
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
    expect(f.preflight).toHaveBeenCalledTimes(2); expect(f.launch).toHaveBeenCalledTimes(2); expect(f.applications.every(value => value.close.mock.calls.length === 1)).toBe(true); expect(f.probe).toHaveBeenCalledTimes(4); expect(f.removed).toHaveBeenCalledWith(f.directory, { recursive: true, force: false }); expect(f.run.removed).toBe(true);
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
    if (target === 'mainPid') f.context.process.pid = 999;
    f.onLaunch(app => {
      if (target === 'appPath') app.runtime.getAppPath = () => resolve('RAM-foreign-app');
      if (target === 'page') app.browserWindow = async () => ({ evaluate: async () => ({ id: 999, contents: 999, renderer: 202, url: app.page.url(), destroyed: false }) });
    });
    await expect(f.run.launch()).rejects.toThrow(); expect(f.run.owners).toHaveLength(1); expect(f.run.owners[0].confirmed).toBe(false); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });
});
