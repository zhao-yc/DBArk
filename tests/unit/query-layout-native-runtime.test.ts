import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import { bindQueryLayoutNativeEnvironment } from '../e2e/query-layout-native-gate';
import { sealEditorIndentLaunchIdentity } from '../e2e/editor-indentation-native-identity';
const url = new URL('../e2e/editor-indentation-native-runtime.ts', import.meta.url), source = readFileSync(url, 'utf8'), tree = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
function method(name: string) { const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!; expect(node).toBeDefined(); return ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }

/** 真正运行原生适配器函数，Electron/目录/PID均为RAM；不导入原生模块或调用操作系统。 */
function fixture(mode: '正常' | '无握手关闭' | 'PID权限错误' | '链接目录' = '正常', installed = false, platform = 'win32', layout = false, wrongHash = false) {
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
  const approval = layout ? { manifestPath: platform === 'darwin' ? '/RAM-layout-approved.json' : manifestPath, approvedHash: wrongHash ? 'b'.repeat(64) : environment.DBARK_EDITOR_INDENT_MANIFEST_SHA256! } : undefined;
  if (layout) {
    // 跨平台模拟使用目标平台的合法清单输入；VFS仍由宿主path解析，只读RAM别名字节。
    if (platform === 'darwin') bytes.set(resolve(approval!.manifestPath), bytes.get(manifestPath)!);
    delete environment.DBARK_EDITOR_INDENT_NATIVE_TEST; delete environment.DBARK_EDITOR_INDENT_MANIFEST; delete environment.DBARK_EDITOR_INDENT_MANIFEST_SHA256;
    environment.DBARK_QUERY_LAYOUT_NATIVE_TEST='1'; environment.DBARK_QUERY_LAYOUT_MANIFEST=approval!.manifestPath; environment.DBARK_QUERY_LAYOUT_MANIFEST_SHA256=approval!.approvedHash;
    const binding=bindQueryLayoutNativeEnvironment(()=>({env:environment,args:[],platform})); assertCurrent.mockImplementation(()=>binding.assertCurrent());
  }
  const run = runInNewContext(method('createEditorIndentNativeRun') + '\ncreateEditorIndentNativeRun(binding, approval)', { ...context, approval, binding: { assertCurrent } }) as EditorIndentNativeRun;
  return { run, approval, launch, preflight, assertCurrent, removed, applications, probe, directory, bytes, exe, manifestPath, manifest, environment, context, root, project, appPath, resources, onLaunch: (hook: typeof applicationHook) => { applicationHook = hook; }, countOwned: () => ownedStats, pauseOwned: (at: number) => { blocked = at; waiting = new Promise(done => { released = done; }); return { entered: new Promise<void>(done => { entered = done; }), release: () => released() }; } };
}

it.each(['win32','darwin'])('旧未传可选参数在%s仍按原清单/launcher/PID证明闭合',async platform=>{const f=fixture('正常',false,platform),a=await f.run.launch();await f.run.close(a);const b=await f.run.launch();await f.run.close(b);await f.run.finish();expect(f.preflight).toHaveBeenCalledTimes(2);expect(f.run.removed).toBe(true);expect(f.approval).toBeUndefined();});
it.each(['win32','darwin'])('新独立清单在%s不伪造旧门，原controller两次正常退出后才清理',async platform=>{const f=fixture('正常',false,platform,true);expect(f.environment.DBARK_EDITOR_INDENT_NATIVE_TEST).toBeUndefined();expect(f.environment.DBARK_EDITOR_INDENT_MANIFEST).toBeUndefined();const a=await f.run.launch();await f.run.close(a);const b=await f.run.launch();expect(b).not.toBe(a);await f.run.close(b);await f.run.finish();expect(f.preflight).toHaveBeenCalledTimes(2);expect(f.run.removed).toBe(true);expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({executablePath:f.exe,cwd:f.root,args:[f.root]}));});
it('独立批准摘要错配不能执行原端口或launch，不能回退到旧环境清单',async()=>{const f=fixture('正常',false,'win32',true,true);await expect(f.run.launch()).rejects.toThrow('批准');expect(f.preflight).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled();expect(f.removed).not.toHaveBeenCalled();});
it.each(['win32', 'darwin'])('两owner确认退出后%s只发一次非强制rm，Windows内部退避有限', async platform => {
  const f = fixture('正常', false, platform, true), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second); await f.run.finish();
  expect(f.removed).toHaveBeenCalledExactlyOnceWith(f.directory, { recursive: true, force: false, maxRetries: platform === 'win32' ? 5 : 0, retryDelay: 100 }); expect(f.run.removed).toBe(true);
});
it('rm耗尽后EBUSY仍原样失败，不能补第二次清理或成功标记', async () => {
  const f = fixture('正常', false, 'win32', true), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second);
  const busy = Object.assign(Error('合成rm内部退避后仍占用'), { code: 'EBUSY' }); f.removed.mockRejectedValueOnce(busy);
  await expect(f.run.finish()).rejects.toBe(busy); expect(f.run.removed).toBe(false); expect(f.run.retained).toBe(true);
  await expect(f.run.finish()).rejects.toThrow('owner已失效'); expect(f.removed).toHaveBeenCalledOnce();
});
it('rm成功返回但目录仍存在时不能完成清理', async () => {
  const f = fixture('正常', false, 'win32', true), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second);
  f.removed.mockImplementationOnce(async () => {}); await expect(f.run.finish()).rejects.toThrow('目录仍存在'); expect(f.run.removed).toBe(false); expect(f.run.retained).toBe(true);
});
it('清理等待期间scope失效，迟到的rm成功不能生成正常终态', async () => {
  const f = fixture('正常', false, 'win32', true), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second);
  let release!: () => void, entered!: () => void; const started = new Promise<void>(yes => { entered = yes; });
  f.removed.mockImplementationOnce(() => new Promise<void>(yes => { release = yes; entered(); }));
  const finishing = f.run.finish(); await started; f.run.retained = true; release(); await expect(finishing).rejects.toThrow('owner已失效'); expect(f.run.removed).toBe(false); expect(f.removed).toHaveBeenCalledOnce();
});
it('第二参数调用方事后改对象不能改写已捕获的Root清单',async()=>{const f=fixture('正常',false,'win32',true);f.approval!.manifestPath=resolve('RAM-foreign-manifest.json');f.approval!.approvedHash='b'.repeat(64);const owner=await f.run.launch();expect(f.launch).toHaveBeenCalledOnce();await f.run.close(owner);expect(f.run.retained).toBe(false);});
