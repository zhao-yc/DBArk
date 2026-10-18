import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { bindQueryFilesNativeEnvironment, queryFilesNativeActive, queryFilesNativeCases } from '../helpers/queryFilesNativeGate';
import { sourceSql, savedSql, externalSql, utf16NativeBytes, installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer } from '../helpers/queryFilesNative';
import { resolve } from 'node:path';
import { lstat, realpath, open } from 'node:fs/promises';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';

// 文件护栏仅使用RAM端口：不创建真实目录、句柄或磁盘字节。
vi.mock('node:fs/promises', () => ({ lstat: vi.fn(), realpath: vi.fn(), open: vi.fn(), rename: vi.fn() }));

/** 所有环境与清单均为RAM合成；没有读取这些清单，更不将语法通过当作原生准入。 */
function environment() { return { DBARK_SQL_FILES_NATIVE_TEST: '1', DBARK_SQL_FILES_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_SQL_FILES_MANIFEST: 'C:\\root-approved\\future-manifest.json', DBARK_SQL_FILES_MANIFEST_SHA256: 'a'.repeat(64) }; }
const declaration = readFileSync(new URL('../e2e/query-files-native.spec.ts', import.meta.url), 'utf8');
/** 仅解释声明门，live是立即记录的RAM哨兵，不加载Electron/原生runtime或执行用例主体。 */
function declare(env: NodeJS.ProcessEnv, argv: string[] = []) {
  const loaded: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv, platform: 'win32' }, require(name: string) {
      loaded.push(name); if (name === '@playwright/test') return { test: { skip: (title: string) => skipped.push(title) } };
      if (name === '../helpers/queryFilesNativeGate') return { queryFilesNativeActive, bindQueryFilesNativeEnvironment, queryFilesNativeCases };
      if (name === './query-files-native-live') return { registerQueryFilesNative: register }; throw Error('未许可模块：' + name);
    }
  }); return { loaded, skipped, register };
}
it.each(['default', 'single', 'list', 'list-value'])('默认或列表%s只声明两例，零live/清单读取/端口', mode => {
  const env: NodeJS.ProcessEnv = mode === 'default' ? {} : environment(); if (mode === 'single') delete env.DBARK_SQL_FILES_NATIVE_APPROVED;
  const result = declare(env, mode === 'list' ? ['--list'] : mode === 'list-value' ? ['--list=true'] : []);
  expect(result.skipped).toEqual([...queryFilesNativeCases]); expect(result.register).not.toHaveBeenCalled(); expect(result.loaded).toEqual(['@playwright/test', '../helpers/queryFilesNativeGate']);
});
it('list在读取环境前短路，门访问器不会被执行', () => {
  const getter = vi.fn(() => { throw Error('不应读取'); }), env = Object.defineProperty({}, 'DBARK_SQL_FILES_NATIVE_TEST', { get: getter });
  expect(queryFilesNativeActive(env, ['--list'])).toBe(false); expect(queryFilesNativeActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
});
it('双门和明确清单只把批准参数交给原live，不能自己生成批准', () => {
  const result = declare(environment()); expect(result.skipped).toEqual([]); expect(result.register).toHaveBeenCalledOnce(); const binding = result.register.mock.calls[0][0]; binding.assertCurrent(); expect(binding.approval).toEqual({ manifestPath: environment().DBARK_SQL_FILES_MANIFEST, approvedHash: 'a'.repeat(64) });
});
it.each(['integration', 'manifest', 'hash', 'password', 'external', 'alias', 'other-gate', 'preload', 'accessor', 'config', 'trace', 'platform'])('危险/缺失配置%s先拒绝，不能加载live', mode => {
  const env: NodeJS.ProcessEnv = environment(); let args: string[] = [], platform = 'win32';
  if (mode === 'integration') env.DBARK_INTEGRATION_ENABLED = '1'; if (mode === 'manifest') delete env.DBARK_SQL_FILES_MANIFEST; if (mode === 'hash') env.DBARK_SQL_FILES_MANIFEST_SHA256 = '未知'; if (mode === 'password') env.DBARK_TEST_PASSWORD = ''; if (mode === 'external') env.DBARK_DEV_URL = ''; if (mode === 'alias') env.dbark_sql_files_native_test = '1'; if (mode === 'other-gate') env.DBARK_EDITOR_INDENT_NATIVE_TEST = '0'; if (mode === 'preload') env.NODE_OPTIONS = ''; if (mode === 'accessor') Object.defineProperty(env, 'DBARK_SQL_FILES_MANIFEST', { get: () => { throw Error('访问器'); } }); if (mode === 'config') args = ['--config=other.ts']; if (mode === 'trace') args = ['--trace=on']; if (mode === 'platform') platform = 'linux';
  expect(() => bindQueryFilesNativeEnvironment(() => ({ env, args, platform }))).toThrow();
});
it('环境漂移恢复后仍sticky，不为新清单重签批准', () => {
  const env: NodeJS.ProcessEnv = environment(), binding = bindQueryFilesNativeEnvironment(() => ({ env, args: [], platform: 'win32' })); binding.assertCurrent(); env.DBARK_SQL_FILES_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); env.DBARK_SQL_FILES_MANIFEST_SHA256 = 'a'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); expect(binding.approval.approvedHash).toBe('a'.repeat(64));
});

const root = globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: unknown };
afterEach(() => { delete root.__sqlFilesOpenAnswer; });
/** 只执行原evaluate闭包的RAM回调；假窗口/对话框不涉及任何原生应用。 */
function application() {
  const original = vi.fn(async () => { throw Error('未许可原生调用'); }), window = { isDestroyed: () => false }, windows = [window], dialog = { showOpenDialog: original as (...args: unknown[]) => Promise<unknown> };
  const app = { evaluate: async (callback: Function, input: unknown) => callback({ dialog, BrowserWindow: { getAllWindows: () => windows } }, input) } as unknown as ElectronApplication;
  const options = { title: '打开SQL文件', properties: ['openFile'], filters: [{ name: 'SQL文件', extensions: ['sql'] }] };
  return { app, original, window, windows, dialog, options };
}
it.each([true, false])('原Open回答选择/取消%s只消费一次并立即恢复原函数', async selected => {
  const f = application(), nonce = '本例nonce'; await installSqlFilesOpenAnswer(f.app, { nonce, ...(selected ? { path: 'C:\\本例私有目录\\source.sql' } : {}) });
  expect(await f.dialog.showOpenDialog(f.window, f.options)).toEqual({ canceled: !selected, filePaths: selected ? ['C:\\本例私有目录\\source.sql'] : [] }); expect(f.dialog.showOpenDialog).toBe(f.original); expect(f.original).not.toHaveBeenCalled(); expect(await finishSqlFilesOpenAnswer(f.app, nonce)).toEqual({ calls: 1, restored: true }); expect(root.__sqlFilesOpenAnswer).toBeUndefined();
});
it.each(['window', 'title', 'filter'])('未知%s拒绝原生回答且不误恢复未知函数', async mode => {
  const f = application(); await installSqlFilesOpenAnswer(f.app, { nonce: '本例' }); if (mode === 'title') f.options.title = '另一标题'; if (mode === 'filter') f.options.filters[0].extensions = ['csv'];
  await expect(f.dialog.showOpenDialog(mode === 'window' ? {} : f.window, f.options)).rejects.toThrow(); await expect(finishSqlFilesOpenAnswer(f.app, '本例')).rejects.toThrow(); expect(f.dialog.showOpenDialog).not.toBe(f.original); expect(f.original).not.toHaveBeenCalled();
});
it('UTF16LE预期独立BOM/CRLF字节，三份正文互异且不经过产品编码器', () => {
  for (const sql of [sourceSql, savedSql, externalSql]) { expect(sql.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/); const bytes = utf16NativeBytes(sql); expect([...bytes.subarray(0, 2)]).toEqual([255, 254]); expect(bytes.subarray(2).toString('utf16le')).toBe(sql); expect(bytes.includes(Buffer.from([13, 0, 10, 0]))).toBe(true); }
  expect(new Set([sourceSql, savedSql, externalSql]).size).toBe(3);
});
/** 原写句柄的inode不能在close之后被同字节替换重新签名。 */
function ramFiles(swapped: boolean) {
  const path = resolve('RAM-only-profile'); let directoryInode = 1n, fileInode = 2n, bytes = Buffer.alloc(0); const events: string[] = [];
  const stat = (directory: boolean, ino = fileInode) => ({ dev: 1n, ino: directory ? directoryInode : ino, nlink: 1n, size: directory ? 0n : BigInt(bytes.length), mtimeNs: 1n, ctimeNs: 1n, isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false });
  vi.mocked(lstat).mockImplementation(async value => stat(String(value) === path) as any); vi.mocked(realpath).mockImplementation(async value => resolve(String(value)) as any);
  vi.mocked(open).mockClear(); vi.mocked(open).mockImplementation(async (_path, flags) => {
    const ownInode = fileInode, writer = flags === 'wx+';
    return { writeFile: async (value: Buffer) => { events.push('write'); bytes = Buffer.from(value); }, sync: async () => {}, stat: async () => stat(false, ownInode), close: async () => { if (writer && swapped) fileInode = 3n; }, read: async (target: Buffer, offset: number, length: number, position: number) => { const count = bytes.copy(target, offset, position, position + length); return { bytesRead: count }; } } as any;
  });
  const files = new QueryFilesNativeFiles(path, () => {}); return { files, events, replaceDirectory() { directoryInode = 9n; } };
}
it.each([false, true])('原wx句柄捕获后同字节替换%s不能从新路径重签，全部为RAM文件', async swapped => {
  const f = ramFiles(swapped); await f.files.start(); const work = f.files.create(f.files.paths.source, Buffer.from('自有'));
  if (swapped) { await expect(work).rejects.toThrow('原对象身份变化'); expect(open).toHaveBeenCalledTimes(1); } else expect((await work).ino).toBe('2');
  expect(f.events).toEqual(['write']); expect(f.files.records.map(value => (value as { stage: string }).stage).slice(0, 4)).toEqual(['paths-planned', 'directory-captured', 'write-planned', 'original-handle-captured']); await f.files.closeHandles();
});
it('写前目录被替换即拒绝，零文件分配；不重新签目录身份', async () => {
  const f = ramFiles(false); await f.files.start(); f.replaceDirectory(); await expect(f.files.create(f.files.paths.source, Buffer.from('不可写'))).rejects.toThrow('目录身份变化'); expect(open).not.toHaveBeenCalled(); await expect(f.files.start()).rejects.toThrow('不得重签');
});
it('live复用原生命周期、无模型setter/写IPC/剪贴板；原两次退出后才限定清理', () => {
  const live = readFileSync(new URL('../e2e/query-files-native-live.ts', import.meta.url), 'utf8');
  for (const key of ['bindEditorIndentNativeCase(info, binding, () => test.info())', 'timeout: 120000', 'createEditorIndentNativeRun(scope, binding.approval)', 'readIndentNativeSettings', 'await run.close(first)', 'await run.close(second)', 'await run.finish()', "app.getVersion()", "toBe('0.28.0')", 'text.reread', 'text.openRecent']) expect(live).toContain(key);
  expect(live).not.toMatch(/\.setValue\(|\.setModel\(|useWorkspace|clipboard|writeQuery|files\.choose|queryFileSources\.(?:save|open|forgetRecent)'|\.kill\(|\.close\(\{.*force/);
});
