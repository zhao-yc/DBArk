import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { win32 } from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSystemShortcutEnvironment, systemShortcutActive, systemShortcutCase } from '../helpers/queryFileSystemShortcutGate';
import { SystemShortcutHandshake, type SystemShortcutRequest } from '../helpers/queryFileSystemShortcutHandshake';

const nonce = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cwd = 'D:\\approved-clone';
const directory = win32.join(cwd, '.cache', 'system-shortcut-handshake', nonce);
const readyPath = win32.join(directory, 'ready.json'), ackPath = win32.join(directory, 'ack.json');
/** 只造RAM批准对象，不访问真实清单、目录、端口或系统输入。 */
function environment(): NodeJS.ProcessEnv { return { DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_TEST: '1', DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST: 'D:\\approved.json', DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST_SHA256: 'b'.repeat(64), DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE: nonce, DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE: directory }; }
const declaration = readFileSync(new URL('../e2e/query-file-system-shortcut-native.spec.ts', import.meta.url), 'utf8');
/** 执行实际声明源；live加载使用哨兵，绝不运行Playwright CLI。 */
function declare(env: NodeJS.ProcessEnv, argv: string[]) {
  const modules: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv, platform: 'win32', cwd: () => cwd },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip: (title: string) => skipped.push(title) } }; if (name === '../helpers/queryFileSystemShortcutGate') return { systemShortcutActive, bindSystemShortcutEnvironment, systemShortcutCase }; if (name === './query-file-system-shortcut-native-live') return { registerSystemShortcutNative: register }; throw Error('禁止加载：' + name); },
  }); return { modules, skipped, register };
}

describe('系统输入独立声明门', () => {
  it.each(['default', 'single', '--list', '--list=true'])('%s零live与零资源', mode => {
    const env = mode === 'default' ? {} : environment(); if (mode === 'single') delete env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_APPROVED;
    const result = declare(env, mode.startsWith('--') ? [mode] : []);
    expect(result.skipped).toEqual([systemShortcutCase]); expect(result.register).not.toHaveBeenCalled(); expect(result.modules).toEqual(['@playwright/test', '../helpers/queryFileSystemShortcutGate']);
  });
  it('访问器不构成批准，完整批准只传原manifest及固定目录', () => {
    const getter = vi.fn(() => { throw Error('禁止getter'); }), env = Object.defineProperty({}, 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_TEST', { get: getter });
    expect(systemShortcutActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
    const result = declare(environment(), []); expect(result.register).toHaveBeenCalledOnce();
    expect(result.register.mock.calls[0][0].handshake).toEqual({ nonce, directory, cwd });
  });
  it.each(['other-gate', 'credential', 'alias', 'preload', 'outside', 'traversal', 'nonce', 'manifest', 'CI', 'platform', 'trace', 'config'])('%s在加载live前拒绝', mode => {
    const env = environment(); let args: string[] = [], platform = 'win32';
    if (mode === 'other-gate') env.DBARK_QUERY_FILE_SHORTCUT_NATIVE_TEST = '1'; if (mode === 'credential') env.DBARK_TEST_PASSWORD = ''; if (mode === 'alias') env.dbark_query_file_system_shortcut_nonce = nonce; if (mode === 'preload') env.NODE_OPTIONS = '';
    if (mode === 'outside') env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE = 'D:\\other'; if (mode === 'traversal') env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE = directory + '\\..\\' + nonce; if (mode === 'nonce') env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE = 'unknown'; if (mode === 'manifest') delete env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST_SHA256;
    if (mode === 'CI') env.CI = 'true'; if (mode === 'platform') platform = 'darwin'; if (mode === 'trace') args = ['--trace=on']; if (mode === 'config') args = ['-cother'];
    expect(() => bindSystemShortcutEnvironment(() => ({ env, args, platform, cwd }))).toThrow();
  });
  it('父环境一旦漂移，即使恢复也永久停链', () => {
    const env = environment(), binding = bindSystemShortcutEnvironment(() => ({ env, args: [], platform: 'win32', cwd }));
    env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE = nonce; expect(() => binding.assertCurrent()).toThrow();
  });
});

type RAMFile = { data: Buffer; ino: bigint; link?: boolean; links?: bigint; version?: bigint };
const ram = vi.hoisted(() => ({ files: new Map<string, RAMFile>(), calls: [] as string[], directory: '', now: 1000, directoryIno: 1n, directoryLink: false, canonical: undefined as string | undefined, mutate: undefined as ((operation: string, file: string) => void) | undefined, closeFails: false }));
/** fs端口全为RAM；真实握手代码仍执行每一条IO前后守卫和原句柄关闭逻辑。 */
vi.mock('node:fs/promises', () => {
  const stamp = (file: string) => {
    if (file === ram.directory) return { dev: 1n, ino: ram.directoryIno, isDirectory: () => true, isSymbolicLink: () => ram.directoryLink };
    const value = ram.files.get(file); if (!value) throw Object.assign(Error('不存在'), { code: 'ENOENT' });
    return { dev: 1n, ino: value.ino, size: BigInt(value.data.length), nlink: value.links ?? 1n, mtimeNs: value.version ?? 1n, ctimeNs: value.version ?? 1n, isFile: () => true, isSymbolicLink: () => !!value.link };
  };
  const call = (op: string, file: string) => { ram.calls.push(op + ':' + file); ram.mutate?.(op, file); };
  return {
    lstat: async (file: string) => { const value = stamp(file); call('lstat', file); return value; },
    realpath: async (file: string) => { call('realpath', file); return ram.canonical ?? file; },
    open: async (file: string, flags: string) => {
      if (flags === 'wx') { if (ram.files.has(file)) throw Object.assign(Error('已存在'), { code: 'EEXIST' }); ram.files.set(file, { data: Buffer.alloc(0), ino: 2n }); }
      else if (!ram.files.has(file)) throw Error('读取未知对象');
      const own = ram.files.get(file)!;
      const ownStamp = () => ({ dev: 1n, ino: own.ino, size: BigInt(own.data.length), nlink: own.links ?? 1n, mtimeNs: own.version ?? 1n, ctimeNs: own.version ?? 1n, isFile: () => true, isSymbolicLink: () => !!own.link });
      call('open-' + flags, file);
      return {
        writeFile: async (bytes: Buffer) => { own.data = Buffer.from(bytes); call('write', file); },
        sync: async () => { call('sync', file); },
        stat: async () => { const value = ownStamp(); call('stat', file); return value; },
        read: async (buffer: Buffer, offset: number, length: number, position: number) => { const bytesRead = own.data.copy(buffer, offset, position, position + length); call('read', file); return { bytesRead, buffer }; },
        close: async () => { call('close', file); if (ram.closeFails) throw Error('关闭失败'); },
      };
    },
  };
});
/** 合成的原来源只用于RAM边界测试，不冒充实际窗口、Main、文件或系统按键证据。 */
function request(): SystemShortcutRequest { return { deadline: 2000, window: 1, contents: 2, mainPid: 3, rendererPid: 4, launcherPid: 5, manifestSha256: 'b'.repeat(64), source: { tabId: nonce, ref: { id: nonce, revision: 1 }, path: 'D:\\private\\native-source.sql', identity: { dev: '1', ino: '20', size: 62, hash: 'c'.repeat(64) } } }; }
/** 模拟Root单次完成回执，严格字段次序按文档；这是RAM控制数据。 */
function ack(change: Record<string, unknown> = {}) {
  const bytes = ram.files.get(readyPath)!.data, ready = JSON.parse(bytes.toString('utf8'));
  return { schema: 1, kind: 'system-ctrl-s-ack', nonce, readySha256: createHash('sha256').update(bytes).digest('hex'), window: ready.window, contents: ready.contents, mainPid: ready.mainPid, sourceRefId: ready.source.ref.id, sourceRevision: ready.source.ref.revision, input: 'Control_L+s', externalInputRequests: 1, outcome: 'completed', completedAt: ram.now, ...change };
}
function putAck(change: Record<string, unknown> = {}, transform = (text: string) => text) { ram.files.set(ackPath, { data: Buffer.from(transform(JSON.stringify(ack(change)) + '\n')), ino: 3n }); }
function fixture(pause?: () => void) {
  let valid = true; const current = vi.fn(() => { if (!valid) throw Error('原父门失效'); });
  const wait = vi.fn(async () => { ram.now += 25; if (pause) pause(); else putAck(); });
  return { current, wait, revoke() { valid = false; }, restore() { valid = true; }, handshake: new SystemShortcutHandshake({ nonce, directory, cwd }, current, () => ram.now, wait) };
}
beforeEach(() => { ram.files.clear(); ram.calls.length = 0; ram.directory = directory; ram.now = 1000; ram.directoryIno = 1n; ram.directoryLink = false; ram.canonical = undefined; ram.mutate = undefined; ram.closeFails = false; });

describe('系统握手原父门与固定文件身份', () => {
  it('单次ready及同身份ack闭合，字段明确不是物理按键计数，文件保留', async () => {
    const f = fixture(), receipt = await f.handshake.wait(request());
    expect(receipt).toMatchObject({ nonce, externalInputRequests: 1, physicalKeyCountMeasured: false, acknowledgedOutcome: 'completed' });
    expect(f.handshake.records.map((x: any) => x.stage)).toEqual(['ready', 'ack']); expect(ram.files.size).toBe(2);
    expect(ram.calls.filter(x => x.startsWith('open-wx'))).toHaveLength(1); expect(ram.calls.filter(x => x.startsWith('open-r'))).toHaveLength(1);
    expect(JSON.parse(ram.files.get(readyPath)!.data.toString()).source.identity).toEqual(request().source.identity);
    const calls = ram.calls.length; await expect(f.handshake.wait(request())).rejects.toThrow('不得重用'); expect(ram.calls).toHaveLength(calls);
  });
  it.each(['nonce', 'readySha256', 'window', 'contents', 'mainPid', 'sourceRefId', 'sourceRevision', 'input', 'externalInputRequests', 'outcome', 'completedAt', 'extra'])('ack的%s漂移/未知即永久停链', async key => {
    const changes: Record<string, unknown> = { nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', readySha256: 'd'.repeat(64), window: 9, contents: 9, mainPid: 9, sourceRefId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sourceRevision: 2, input: 'Control+s', externalInputRequests: 2, outcome: 'unknown', completedAt: 999, extra: true };
    const f = fixture(() => putAck({ [key]: changes[key] })); await expect(f.handshake.wait(request())).rejects.toThrow();
    const calls = ram.calls.length; await expect(f.handshake.wait(request())).rejects.toThrow(); expect(ram.calls).toHaveLength(calls);
  });
  it.each(['duplicate', 'append', 'encoding'])('%s正文不能变成合法ack', async mode => {
    const f = fixture(() => { putAck({}, text => mode === 'duplicate' ? text.replace('"schema":1', '"schema":1,"schema":1') : mode === 'append' ? text + text : text); if (mode === 'encoding') ram.files.get(ackPath)!.data = Buffer.from([0xff]); });
    await expect(f.handshake.wait(request())).rejects.toThrow();
  });
  it.each(['symbolic', 'hard', 'oversize', 'replace', 'change'])('ack %s拒绝，且不补读或重试输入', async mode => {
    const f = fixture(() => {
      putAck(); const file = ram.files.get(ackPath)!;
      if (mode === 'symbolic') file.link = true; if (mode === 'hard') file.links = 2n; if (mode === 'oversize') file.data = Buffer.alloc(4097);
      if (mode === 'replace') ram.mutate = (op, name) => { if (op === 'lstat' && name === ackPath) ram.files.set(ackPath, { ...file, ino: 99n }); };
      if (mode === 'change') ram.mutate = (op, name) => { if (op === 'read' && name === ackPath) file.version = 2n; };
    });
    await expect(f.handshake.wait(request())).rejects.toThrow(); expect(f.wait).toHaveBeenCalledOnce();
  });
  it.each(['directory-link', 'directory-replace', 'canonical', 'ready-replace', 'ready-exists', 'ack-early'])('%s保留原件，不新建第二个ready', async mode => {
    if (mode === 'directory-link') ram.directoryLink = true;
    if (mode === 'canonical') ram.canonical = 'D:\\other';
    if (mode === 'ready-exists') ram.files.set(readyPath, { data: Buffer.from('保留原件'), ino: 77n });
    if (mode === 'ack-early') ram.files.set(ackPath, { data: Buffer.from('旧回执'), ino: 78n });
    const f = fixture(() => { if (mode === 'directory-replace') ram.directoryIno = 9n; else if (mode === 'ready-replace') ram.files.set(readyPath, { ...ram.files.get(readyPath)!, ino: 88n }); putAck(); });
    await expect(f.handshake.wait(request())).rejects.toThrow();
    expect(ram.calls.filter(x => x.startsWith('open-wx'))).toHaveLength(['directory-replace', 'ready-replace'].includes(mode) ? 1 : 0);
  });
  it.each(['timeout', 'rollback', 'parent'])('等待期%s后不再读ack，不续时，恢复也停链', async mode => {
    const f = fixture(() => { if (mode === 'parent') f.revoke(); else ram.now = mode === 'timeout' ? 2000 : 900; putAck(); });
    await expect(f.handshake.wait(request())).rejects.toThrow(); expect(ram.calls.some(x => x.startsWith('open-r'))).toBe(false);
    f.restore(); ram.now = 1100; const calls = ram.calls.length; await expect(f.handshake.wait(request())).rejects.toThrow(); expect(ram.calls).toHaveLength(calls);
  });
  it('ready句柄迟到后仅关闭已得句柄，不写文件、不进入轮询', async () => {
    const f = fixture(); ram.mutate = (op, name) => { if (op === 'open-wx' && name === readyPath) f.revoke(); };
    await expect(f.handshake.wait(request())).rejects.toThrow('原父门失效');
    expect(ram.calls.slice(-1)).toEqual(['close:' + readyPath]); expect(ram.calls.some(x => x.startsWith('write:'))).toBe(false); expect(f.wait).not.toHaveBeenCalled();
  });
  it('原写入/父门错误与句柄关闭错误都保留，不借清理替代原失败', async () => {
    const f = fixture(); ram.closeFails = true; ram.mutate = (op, name) => { if (op === 'open-wx' && name === readyPath) f.revoke(); };
    await expect(f.handshake.wait(request())).rejects.toThrow(AggregateError); expect(ram.calls.slice(-1)).toEqual(['close:' + readyPath]);
  });
  it('未知来源及非法目录在任何文件IO之前拒绝', async () => {
    expect(() => new SystemShortcutHandshake({ nonce, directory: 'D:\\outside', cwd }, () => {})).toThrow();
    const f = fixture(), value = request(); value.source.identity = { ...value.source.identity, hash: 'unknown' }; await expect(f.handshake.wait(value)).rejects.toThrow(); expect(ram.calls).toEqual([]);
  });
});

describe('共享live保留原保存验收及系统输入边界', () => {
  const live = readFileSync(new URL('../e2e/query-file-shortcut-native-live.ts', import.meta.url), 'utf8');
  const system = readFileSync(new URL('../e2e/query-file-system-shortcut-native-live.ts', import.meta.url), 'utf8');
  it('新入口没有输入派发或生命周期框架，仍共用原完整保存、SQLite和两次退出链', () => {
    expect(system).not.toMatch(/keyboard\.|sendInputEvent|dispatchKeyEvent|SendInput|press_key\(|new EditorIndentNativeRun|\.launch\(|\.close\(|\.finish\(/);
    for (const expected of ['registerShortcutNative(binding, driver)', 'SystemShortcutHandshake', 'physicalKeyCountMeasured: false']) expect(system).toContain(expected);
    for (const expected of ['files!.read(path, original)', 'utf16NativeBytes(savedSql)', 'baseline.binding.ref.revision + 1', 'savedSqlDigest:', 'expect(disk.schema).toBe(9)', 'files!.read(path, saved.identity)', 'await run.close(first)', 'await run.close(second)', 'await run.finish()']) expect(live).toContain(expected);
    expect(live.match(/keyboard\.press\(process\.platform === 'darwin' \? 'Meta\+s' : 'Control\+s'\)/g)).toHaveLength(1);
  });
});
