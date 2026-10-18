import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import * as gate from '../e2e/query-file-native-gate';
import * as protocol from '../e2e/query-file-native-key-protocol';

const source = readFileSync(new URL('../e2e/query-file-native-key-bridge.ts', import.meta.url), 'utf8');
type Entry = { kind: 'file' | 'dir' | 'link'; ino: bigint; tick: bigint; bytes: Buffer; links: bigint };
/** 逐字编译实际桥模块；目录、句柄、回执和窗口全部为RAM，无磁盘临时目录或真实进程。 */
async function fixture(mode = '正常') {
  const root = path.resolve('RAM-native-key', 'dbark-indent-key'), directory = path.join(root, protocol.queryFileNativeKeyProtocol.directory);
  const files = new Map<string, Entry>(), log: string[] = [], requests: any[] = []; let ino = 2n, tick = 2n, clock = 100, nonce = 0, reads = 0;
  const entry = (kind: Entry['kind'], bytes = Buffer.alloc(0)): Entry => ({ kind, ino: ino++, tick: tick++, bytes, links: 1n }); files.set(root, entry('dir'));
  const info: any = { _startWallTime: 0, timeout: 120000, status: 'passed', testId: '原RAM-case' }; let currentInfo = info;
  const env = { DBARK_QUERY_FILE_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_MANIFEST: 'C:/RAM/approved.json', DBARK_QUERY_FILE_MANIFEST_SHA256: 'a'.repeat(64), DBARK_QUERY_FILE_FIXTURE_SHA256: gate.queryFileNativeRecipeHash(), DBARK_QUERY_FILE_NATIVE_KEYS: 'root-v1', DBARK_QUERY_FILE_NATIVE_KEYS_SHA256: protocol.queryFileNativeKeyProtocolHash() };
  const binding = gate.bindQueryFileNativeEnvironment(() => ({ env, args: [], platform: 'win32' }));
  const scope = bindEditorIndentNativeCase(info, binding, () => info, () => clock);
  const forbidden = async () => { throw Error('RAM桥禁止真实启动、退出、PID、目录或清理端口'); };
  const run = new EditorIndentNativeRun({ assertCurrent: () => scope.assertCurrent(), preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden } as any); run.acquiredDirectory(root);
  const context: any = { exports: {}, Buffer, Error, Map, Promise, Number, Object, JSON, process: { env, platform: 'win32', pid: 888 } };
  function stat(value: Entry) { return { dev: 1n, ino: value.ino, nlink: value.links, size: BigInt(value.bytes.length), mtimeNs: value.tick, ctimeNs: value.tick, isFile: () => value.kind === 'file', isDirectory: () => value.kind === 'dir', isSymbolicLink: () => value.kind === 'link' }; }
  function obtain(name: string) { const value = files.get(name); if (!value) throw Object.assign(Error('RAM不存在'), { code: 'ENOENT' }); return value; }
  const io = {
    lstat: async (name: string) => { log.push('lstat:' + name); if (mode === '原子回执并发发布' && name.endsWith('.pending') && files.has(name)) { const target = requests.at(-1).receiptPath; files.set(target, obtain(name)); files.delete(name); } return stat(obtain(name)); }, realpath: async (name: string) => { log.push('realpath:' + name); obtain(name); return name; },
    mkdir: async (name: string) => { expect(name).toBe(directory); if (files.has(name)) throw Error('独占目录已存在'); files.set(name, entry('dir')); },
    readdir: async (name: string) => { expect(name).toBe(directory); obtain(name); return [...files.keys()].filter(key => path.dirname(key) === name).map(key => path.basename(key)); },
    unlink: async (name: string) => { log.push('unlink:' + name); obtain(name); files.delete(name); }, rmdir: async (name: string) => { expect(name).toBe(directory); expect([...files.keys()].filter(key => path.dirname(key) === name)).toEqual([]); files.delete(name); },
    open: async (name: string, flags: string) => {
      expect(path.dirname(name)).toBe(directory); log.push('open:' + flags + ':' + path.basename(name));
      if (flags === 'wx') { expect(files.has(name)).toBe(false); files.set(name, entry('file')); }
      else { expect(flags).toBe('r'); if (mode === 'open迟到') clock = 120000; }
      const held = obtain(name);
      return {
        stat: async () => stat(held), writeFile: async (value: string) => { held.bytes = Buffer.from(value); held.tick = tick++; }, sync: async () => {},
        read: async (buffer: Buffer, offset: number, length: number, position: number) => { reads++; log.push('read:' + path.basename(name)); const count = Math.min(length, Math.max(0, held.bytes.length - position)); held.bytes.copy(buffer, offset, position, position + count); if (mode === 'read迟到') clock = 120000; return { bytesRead: count }; },
        close: async () => { log.push('close:' + path.basename(name)); if (mode === 'close迟到' && flags === 'r') clock = 120000; },
      };
    },
  };
  /** 窗口仅执行原观察函数，onMenu为被动订阅；本测试的sent是合成回执，不证明实际按键。 */
  function owner(id: number) {
    const listeners: Function[] = [], window: any = { dbark: { onMenu: (listener: Function) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); } } };
    const native: any = { id, webContents: { id: id + 100, getOSProcessId: () => id + 1000, isFocused: () => true }, getNativeWindowHandle: () => Buffer.from([id, 1]), isFocused: () => true, isDestroyed: () => false };
    const value: any = { application: { browserWindow: async () => ({ evaluate: async (fn: Function) => fn(native) }), evaluate: async (fn: Function) => fn({ app: { getPath: () => root }, BrowserWindow: { getFocusedWindow: () => native, getAllWindows: () => [native] } }) },
      page: { evaluate: async (fn: Function, input: unknown) => { context.window = window; context.document = { hasFocus: () => true, activeElement: { tagName: 'TEXTAREA', className: 'inputarea' }, querySelectorAll: () => [] }; return fn(input); } },
      ids: new Set([888, id + 1000]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve(), listeners, native };
    return value;
  }
  const first = owner(7), second = owner(8); run.acquiredOwner(first);
  context.require = (name: string) => { if (name === 'node:fs/promises') return io; if (name === 'node:path') return path; if (name === 'node:crypto') return { randomUUID: () => 'RAM-nonce-' + ++nonce }; if (name === './query-file-native-key-protocol') return protocol; throw Error('RAM桥拒绝模块：' + name); };
  context.setTimeout = (done: Function) => { clock = 120000; queueMicrotask(() => done()); };
  context.console = { log: (line: string) => {
    const request = JSON.parse(line.slice('DBARK_QUERY_FILE_NATIVE_KEY_REQUEST '.length)); requests.push(request);
    if (mode === '原owner变化') { run.acquiredOwner(second); return; }
    if (mode === '过期' || mode === '等待迟到') { if (mode === '过期') clock = 120000; return; }
    if (mode === '目录替换') { files.get(directory)!.ino++; return; }
    const receipt = { ...request.request, status: mode === '未知' ? 'unknown' : 'sent' };
    if (mode === '错序') receipt.sequence++;
    if (mode === '旧nonce') receipt.nonce = 'RAM-旧nonce';
    if (mode === '额外字段') (receipt as any).accepted = true;
    if (mode === '期限冒认') receipt.deadline++;
    files.set(mode === '原子回执并发发布' ? request.pendingPath : request.receiptPath, entry(mode === '链接回执' ? 'link' : 'file', Buffer.from(JSON.stringify(receipt))));
    if (mode === '硬链接回执') files.get(request.receiptPath)!.links = 2n;
    if (mode === 'pending残留') files.set(request.pendingPath, entry('file'));
    (run.owners.at(-1) as any).listeners.forEach((fn: Function) => fn('save-query'));
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const bridge = await context.exports.createQueryFileNativeKeyBridge(run, scope, info, () => currentInfo);
  return { bridge, run, first, second, requests, files, log, reads: () => reads, expire: () => { clock = 120000; }, scope, root, directory, info, env, replaceInfo: () => { currentInfo = { ...info }; } };
}

it('正常每阶段仅一请求；回执只继续原流程，清理必须等四阶段及两owner闭合', async () => {
  const value = await fixture(); await value.bridge.request(value.first, 'saved', 'tab', 1);
  expect(value.requests).toHaveLength(1); expect(value.requests[0].request).toMatchObject({ stage: 'saved', sequence: 1, deadline: 120000, owner: { ordinal: 1, windowId: 7 }, key: 'Control_L+s' }); expect(value.log.some(line => line.startsWith('unlink:'))).toBe(false);
  await value.bridge.request(value.first, 'external', 'tab', 2); await value.bridge.request(value.first, 'draft', 'tab', 3); await value.bridge.release(value.first);
  // 这里只提供RAM状态给桥的清理反例；没有正常退出、will-quit或PID不存在的实际证明。
  Object.assign(value.first, { closed: true, ready: true, confirmed: true }); value.run.acquiredOwner(value.second);
  await value.bridge.request(value.second, 'restarted', 'tab', 4); await value.bridge.release(value.second); Object.assign(value.second, { closed: true, ready: true, confirmed: true });
  await value.bridge.cleanup(value.root); expect(value.requests.map(value => value.request.stage)).toEqual(['saved', 'external', 'draft', 'restarted']); expect(new Set(value.requests.map(value => value.request.nonce)).size).toBe(4); expect(value.log.filter(line => line.startsWith('unlink:'))).toHaveLength(8); expect(value.files.has(value.directory)).toBe(false);
});
it.each(['过期', '等待迟到', 'open迟到', 'read迟到', 'close迟到', '原owner变化'])('%s后停链，不重发或删除桥文件', async mode => {
  const value = await fixture(mode); await expect(value.bridge.request(value.first, 'saved', 'tab', 1)).rejects.toThrow(); expect(value.run.retained).toBe(true); expect(value.requests).toHaveLength(1); expect(value.log.some(line => line.startsWith('unlink:'))).toBe(false); if (mode === 'open迟到') expect(value.reads()).toBe(0);
});
it.each(['错序', '旧nonce', '额外字段', '期限冒认', '未知', 'pending残留'])('%s回执不授予继续权限', async mode => {
  const value = await fixture(mode); await expect(value.bridge.request(value.first, 'saved', 'tab', 1)).rejects.toThrow(); expect(value.run.retained).toBe(true); expect(value.requests).toHaveLength(1);
});
it.each(['链接回执', '硬链接回执', '目录替换'])('%s在读取正文前拒绝', async mode => {
  const value = await fixture(mode); await expect(value.bridge.request(value.first, 'saved', 'tab', 1)).rejects.toThrow(); expect(value.reads()).toBe(0); expect(value.run.retained).toBe(true);
});
it('已消费回执被重写视为重复，不签发第二次按键请求', async () => {
  const value = await fixture(); await value.bridge.request(value.first, 'saved', 'tab', 1); value.files.get(value.requests[0].receiptPath)!.tick++;
  await expect(value.bridge.request(value.first, 'external', 'tab', 2)).rejects.toThrow(/重复|替换|改写/); expect(value.requests).toHaveLength(1);
});
it('重复阶段或错阶段在发布请求前停链，不能借nonce重新发送', async () => {
  for (const stage of ['saved', 'draft']) { const value = await fixture(); await value.bridge.request(value.first, 'saved', 'tab', 1); await expect(value.bridge.request(value.first, stage, 'tab', 2)).rejects.toThrow(/错序/); expect(value.requests).toHaveLength(1); }
});
it('缺少两owner闭合时不删除任何已知桥文件', async () => {
  const value = await fixture(); await value.bridge.request(value.first, 'saved', 'tab', 1); await expect(value.bridge.cleanup(value.root)).rejects.toThrow(/正常退出/); expect(value.log.some(line => line.startsWith('unlink:'))).toBe(false);
});
it('并发重复请求令两条链都停下，不发布任何按键或清理文件', async () => {
  const value = await fixture(); const results = await Promise.allSettled([value.bridge.request(value.first, 'saved', 'tab', 1), value.bridge.request(value.first, 'saved', 'tab', 1)]);
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']); expect(value.requests).toEqual([]); expect(value.run.retained).toBe(true); expect(value.log.some(line => line.startsWith('unlink:'))).toBe(false);
});
it('目录采样与Root原子发布并发时仍须读取完整新回执，不重发请求', async () => {
  const value = await fixture('原子回执并发发布'); await value.bridge.request(value.first, 'saved', 'tab', 1); expect(value.requests).toHaveLength(1); expect(value.run.retained).toBe(false); expect(value.reads()).toBeGreaterThan(0); expect(value.files.has(value.requests[0].pendingPath)).toBe(false);
});
it('新增开关必须Root双审批且拒绝任何桥外部路径变量', () => {
  const good = { DBARK_QUERY_FILE_NATIVE_KEYS: 'root-v1', DBARK_QUERY_FILE_NATIVE_KEYS_SHA256: protocol.queryFileNativeKeyProtocolHash() };
  expect(() => protocol.assertQueryFileNativeKeyApproval(good, 'win32')).not.toThrow();
  for (const env of [{}, { ...good, DBARK_QUERY_FILE_NATIVE_KEYS: 'auto' }, { ...good, DBARK_QUERY_FILE_NATIVE_KEYS_SHA256: '0'.repeat(64) }, { ...good, DBARK_QUERY_FILE_NATIVE_KEYS_PATH: 'C:/RAM/禁止' }]) expect(() => protocol.assertQueryFileNativeKeyApproval(env, 'win32')).toThrow();
  expect(() => protocol.assertQueryFileNativeKeyApproval(good, 'darwin')).toThrow();
});
it.each(['原TestInfo', '原case标识', '原窗口', '原tab', '桥审批漂移'])('%s变化不能沿下一阶段重新领取按键权限', async mode => {
  const value = await fixture(); await value.bridge.request(value.first, 'saved', 'tab', 1);
  if (mode === '原TestInfo') value.replaceInfo();
  if (mode === '原case标识') value.info.testId = '冒认case';
  if (mode === '原窗口') value.first.native.id++;
  if (mode === '桥审批漂移') value.env.DBARK_QUERY_FILE_NATIVE_KEYS = 'auto';
  await expect(value.bridge.request(value.first, 'external', mode === '原tab' ? '其他tab' : 'tab', 2)).rejects.toThrow(); expect(value.requests).toHaveLength(1); expect(value.run.retained).toBe(true);
  if (mode === '桥审批漂移') { value.env.DBARK_QUERY_FILE_NATIVE_KEYS = 'root-v1'; await expect(value.bridge.request(value.first, 'external', 'tab', 2)).rejects.toThrow(); }
});
it('默认关闭及RAM模拟--list均不加载按键桥；未审批正式case在取得runtime前拒绝', async () => {
  const spec = readFileSync(new URL('../e2e/query-file-native.spec.ts', import.meta.url), 'utf8');
  for (const mode of ['关闭', 'list', '无审批']) {
    const callbacks: Function[] = [], loads: string[] = [], info = { _startWallTime: 0, timeout: 120000, status: 'passed' };
    let runtimes = 0;
    const test = Object.assign((_name: string, fn: Function) => callbacks.push(fn), { skip: () => {}, use: () => {}, afterEach: () => {}, info: () => info, describe: { configure: () => {} } });
    const env = mode === '关闭' ? {} : { DBARK_QUERY_FILE_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_MANIFEST: 'C:/RAM/approved.json', DBARK_QUERY_FILE_MANIFEST_SHA256: 'a'.repeat(64), DBARK_QUERY_FILE_FIXTURE_SHA256: gate.queryFileNativeRecipeHash() };
    const require = (name: string) => { loads.push(name); if (name === '@playwright/test') return { test, expect }; if (name === './query-file-native-gate') return gate; if (name === './editor-indentation-native-gate') return { bindEditorIndentNativeCase: (a: any, b: any, c: any) => bindEditorIndentNativeCase(a, b, c, () => 100) }; if (name.includes('/locales/')) return {}; if (name === './editor-indentation-native-runtime') return { createEditorIndentNativeRun: () => { runtimes++; throw Error('不应取得runtime'); } }; if (name === './query-file-native-fixture' || name === './query-file-native-key-bridge') return {}; throw Error('拒绝模块：' + name); };
    runInNewContext(ts.transpileModule(spec, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: {}, require, process: { env, argv: mode === 'list' ? ['--list'] : [], platform: 'win32' }, WeakMap, Buffer, Error });
    expect(callbacks).toHaveLength(1);
    if (mode !== '无审批') expect(loads.some(name => /runtime|fixture|key-bridge|node:fs/.test(name))).toBe(false);
    else { await expect(callbacks[0]({ trace: 'off', screenshot: 'off', video: 'off' }, info)).rejects.toThrow(/Root批准/); expect(runtimes).toBe(0); }
  }
});
