import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
const url = new URL('../e2e/editor-indentation-native-runtime.ts', import.meta.url), source = readFileSync(url, 'utf8'), tree = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
function method(name: string) { const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!; expect(node).toBeDefined(); return ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }

/** 真正运行原生适配器函数，Electron/目录/PID均为RAM；不导入原生模块或调用操作系统。 */
function fixture(mode: '正常' | '无握手关闭' | 'PID权限错误' | '链接目录' = '正常') {
  const parent = resolve('RAM-native-parent'), directory = join(parent, 'dbark-indent-RAM'), applications: any[] = []; let exists = false;
  const preflight = vi.fn(async () => {}), assertCurrent = vi.fn(), removed = vi.fn(async () => { exists = false; });
  const launch = vi.fn(async () => {
    const application = new EventEmitter() as any, runtime = new EventEmitter() as any, page = new EventEmitter() as any;
    application.runtime = runtime; application.page = page; page.locator = () => ({}); runtime.getAppMetrics = () => [{ pid: 202 }];
    runtime.quit = () => { if (mode === '无握手关闭') application.emit('close'); else runtime.emit('will-quit'); };
    application.evaluate = async (fn: Function, arg: unknown) => fn({ app: runtime }, arg); application.firstWindow = async () => page; application.process = () => ({ pid: 101 });
    application.waitForEvent = () => new Promise(done => application.once('close', done)); application.close = vi.fn(async () => { expect(runtime.listenerCount('will-quit')).toBe(0); application.emit('close'); }); applications.push(application); return application;
  });
  const probe = vi.fn(() => { throw Object.assign(Error('合成探测'), { code: mode === 'PID权限错误' ? 'EPERM' : 'ESRCH' }); });
  const poll = (read: () => unknown) => ({ toEqual: async (value: unknown) => expect(read()).toEqual(value) });
  const nativeExpect = Object.assign(() => ({ toBeVisible: async () => {} }), { poll });
  const context: any = { exports: {}, EditorIndentNativeRun, expect: nativeExpect, electron: { launch }, requireIndentOfflinePort: preflight, randomUUID: () => 'RAM-marker', WeakMap, Set, dirname, basename, resolve, join, tmpdir: () => parent,
    realpath: async (path: string) => path, mkdtemp: async () => { exists = true; return directory; }, lstat: async () => { if (!exists) throw Object.assign(Error('不存在'), { code: 'ENOENT' }); return { isDirectory: () => true, isSymbolicLink: () => mode === '链接目录' }; }, rm: removed,
    process: { env: { DBARK_INTEGRATION_ENABLED: '0' }, kill: probe }, setTimeout: (callback: () => void) => callback(), console: { log: (message: string) => applications.at(-1).emit('console', { text: () => message }) },
  };
  const run = runInNewContext(method('createEditorIndentNativeRun') + '\ncreateEditorIndentNativeRun(binding)', { ...context, binding: { assertCurrent } }) as EditorIndentNativeRun;
  return { run, launch, preflight, assertCurrent, removed, applications, probe, directory };
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
