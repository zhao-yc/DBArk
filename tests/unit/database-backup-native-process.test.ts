import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { inspect } from 'node:util';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { databaseBackupNativeDumpOptions, type DatabaseBackupNativeOptions } from '../../src/engine/databaseBackupNativeOptions';
import { DatabaseBackupNativeProcess, DatabaseBackupNativeProcessOwners, databaseBackupNativeNodeProcessPort, type DatabaseBackupNativeChild, type DatabaseBackupNativeProcessBinding, type DatabaseBackupNativeProcessPort } from '../../src/engine/databaseBackupNativeProcess';

/** RAM管道和EventEmitter假child：没有任何真实spawn、文件、数据库或网络。 */
class Child extends EventEmitter implements DatabaseBackupNativeChild {
  stdin = new Writable({ autoDestroy: false, write(_bytes, _encoding, done) { done(); } });
  stdout = new PassThrough({ autoDestroy: false, highWaterMark: 65536 });
  stderr = new PassThrough({ autoDestroy: false, highWaterMark: 65536 });
  kill = vi.fn((_signal: 'SIGTERM') => true);
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(portFactory?: (child: Child) => DatabaseBackupNativeProcessPort) {
  const owner = { taskId: 'fixture-task-original', planToken: 'fixture-plan-original' }, child = new Child(), owners = new DatabaseBackupNativeProcessOwners();
  const native = databaseBackupNativeDumpOptions({ tool: { id: 'mysql-8.4.11-win32-x64', family: 'mysql', version: '8.4.11', directory: 'D:\\Verified Tools\\mysql-8.4.11' }, defaultsFile: { token: 'fixture-file', path: 'D:\\Private Temp\\client.cnf' }, target: { host: '127.0.0.1', port: 13384, user: 'fixture', password: 'SYNTHETIC-PASSWORD', database: '业务库', transport: 'tcp', tls: 'disabled', ssh: false, authPlugin: 'caching_sha2_password' }, lockStrategy: 'root-held-global-read-lock' });
  const binding: DatabaseBackupNativeProcessBinding = { owner, toolId: 'mysql-8.4.11-win32-x64', toolLease: 'fixture-suite-lease', defaultsFileLease: 'fixture-file-lease', toolDirectory: 'D:\\Verified Tools\\mysql-8.4.11', defaultsFilePath: 'D:\\Private Temp\\client.cnf', database: '业务库' };
  const port = portFactory?.(child) ?? { spawn: vi.fn((_request, capture) => { capture(child); return child; }) };
  const process = new DatabaseBackupNativeProcess(owner, native.launch, binding, port, owners);
  return { owner, child, owners, native, binding, port, process };
}
/** 关闭原RAM流并给出独立child close；不能用kill/exit事件替代它们。 */
async function closeAll(child: Child) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); await turn(); child.emit('close', 0, null); }

describe('B01原生dump进程私有适配（仅RAM）', () => {
  it('构造只同步登记，start首个await前捕获原child/流/Promise且不保留clientOptions', async () => {
    const f = fixture(); expect(f.port.spawn).not.toHaveBeenCalled(); expect(f.process.snapshot()).toMatchObject({ slot: 1, started: false, childAllocated: false, localClosed: false });
    const result = f.process.start(); expect(f.port.spawn).toHaveBeenCalledTimes(1); expect(f.process.snapshot()).toMatchObject({ started: true, childAllocated: true, spawnSeen: false, exitSeen: false });
    const request = vi.mocked(f.port.spawn).mock.calls[0][0]; expect(request.options).toEqual({ shell: false, windowsVerbatimArguments: false, windowsHide: true, detached: false, cwd: 'D:\\Verified Tools\\mysql-8.4.11\\bin', env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(request.argv).toEqual(f.native.launch.argv); expect(JSON.stringify(request)).not.toContain('SYNTHETIC-PASSWORD');
    f.child.emit('spawn'); f.child.emit('exit', 0, null); expect(await result.exit).toEqual({ owner: f.owner, code: 0, signal: null });
    expect((await f.process.waitLocalClosed(0)).state).toBe('unknown'); await closeAll(f.child);
  });
  it('大chunk按需分成最多64KiB，消费者暂停时无预读/全量队列，复制当前小片避免持有巨型底层buffer', async () => {
    const f = fixture(), result = f.process.start(), raw = Buffer.alloc(196613, 0x5a); f.child.emit('spawn');
    expect(f.child.stdout.write(raw)).toBe(false); await turn(); expect(f.process.snapshot().stdoutBytes).toBe(0); expect(f.child.stdout.listenerCount('data')).toBe(0);
    const iterator = result.stdout[Symbol.asyncIterator](), first = await iterator.next(); expect(first.value!.length).toBe(65536);
    expect(f.process.snapshot().stdoutBytes).toBe(65536); expect(f.child.stdout.readableLength).toBe(raw.length - 65536);
    raw.fill(0); expect(first.value!.every((byte: number) => byte === 0x5a)).toBe(true);
    f.child.stdout.end(); while (!(await iterator.next()).done) { /* 有界消费剩余RAM数据。 */ }
    await f.process.requestCancel(); await closeAll(f.child);
  });
  it('短片、大整数/BLOB/DELIMITER与CRLF保持原字节，完整local事实与服务器事实分开', async () => {
    const f = fixture(), result = f.process.start(), expected = Buffer.concat([Buffer.from('18446744073709551615\r\nDELIMITER $$\n'), Buffer.from([0, 255, 128]), Buffer.alloc(70003, 0x61)]), chunks: Buffer[] = [];
    f.child.emit('spawn'); const iterator = result.stdout[Symbol.asyncIterator](); f.child.stdout.write(expected.subarray(0, 7));
    const first = await iterator.next(); expect(first.value!.length).toBe(7); chunks.push(Buffer.from(first.value!));
    f.child.stdout.end(expected.subarray(7)); f.child.stderr.end(); while (true) { const chunk = await iterator.next(); if (chunk.done) break; expect(chunk.value.length).toBeLessThanOrEqual(65536); chunks.push(Buffer.from(chunk.value)); }
    await turn(); f.child.emit('exit', 0, null); expect((await result.exit).code).toBe(0);
    expect(Buffer.concat(chunks)).toEqual(expected); expect(() => f.process.assertLocalOutput()).toThrow('终态');
    await closeAll(f.child); expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(() => f.process.assertLocalOutput()).not.toThrow();
    expect(f.process.snapshot()).toMatchObject({ spawnSeen: true, exitSeen: true, childClosed: true, stdinFinished: true, stdinClosed: true, stdoutEnded: true, stdoutClosed: true, stderrEnded: true, stderrClosed: true });
    expect(Object.keys(f.process.snapshot()).some(key => /server|session|lock|backupCompleted/iu.test(key))).toBe(false);
  });
  it('stderr持续排空但只保留饱和计数与overflow，快照和错误不带正文/默认文件路径', async () => {
    const f = fixture(); f.process.start(); const secret = Buffer.from('SYNTHETIC-PASSWORD D:\\Private Temp\\client.cnf\n');
    for (let n = 0; n < 2000; n++) f.child.stderr.write(secret); await turn(); expect(f.child.stderr.readableLength).toBe(0);
    expect(f.process.snapshot()).toMatchObject({ stderrBytes: 65536, stderrOverflow: true });
    f.child.emit('error', new Error(secret.toString()));
    for (const text of [JSON.stringify(f.process), inspect(f.process), inspect(f.process, { customInspect: false, showHidden: true })]) for (const hidden of ['SYNTHETIC-PASSWORD', f.binding.defaultsFilePath, f.binding.toolDirectory, f.owner.taskId, f.owner.planToken]) expect(text).not.toContain(hidden);
    for (const value of Object.values(f.process.snapshot())) expect(['boolean', 'number']).toContain(typeof value); await closeAll(f.child);
  });
  it('exit/kill回执都不代表close；子进程close与每条原流close必须独立确认', async () => {
    const f = fixture(), result = f.process.start(); f.child.emit('spawn'); f.child.emit('exit', null, 'SIGTERM'); expect((await result.exit).signal).toBe('SIGTERM');
    await f.process.requestCancel(); await f.process.requestCancel(); expect(f.child.kill).toHaveBeenCalledTimes(1); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    f.child.emit('close', null, 'SIGTERM'); expect((await f.process.waitLocalClosed(0)).state).toBe('unknown');
    f.child.stdout.destroy(); f.child.stderr.destroy(); await turn(); expect((await f.process.waitLocalClosed(0)).state).toBe('unknown');
    f.child.stdin.destroy(); await turn(); expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(() => f.process.assertLocalOutput()).toThrow();
  });
  it('有界等待超时保持unknown和原Promise，晚close可确认本地资源但不会补造exit', async () => {
    const f = fixture(); f.process.start(); expect((await f.process.waitLocalClosed(1)).state).toBe('unknown'); expect(f.child.kill).not.toHaveBeenCalled();
    await closeAll(f.child); expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(f.process.snapshot()).toMatchObject({ exitSeen: false, failed: true });
  });
  it('exit=0后迟到的流错误仍使本地输出核验失败，不把已解析exit当作成功总证明', async () => {
    const f = fixture(), run = f.process.start(); f.child.emit('spawn'); f.child.stdout.end(Buffer.from('完整RAM输出')); f.child.stderr.end();
    for await (const _chunk of run.stdout) { /* 先取得完整EOF，确保本反例由迟到error区分。 */ }
    await turn(); f.child.emit('exit', 0, null); expect((await run.exit).code).toBe(0);
    f.child.stderr.emit('error', Error('SYNTHETIC-PASSWORD')); await closeAll(f.child);
    expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(f.process.snapshot()).toMatchObject({ stdoutEnded: true, stderrEnded: true, zeroExit: true, failed: true }); expect(() => f.process.assertLocalOutput()).toThrow('终态');
  });
  it('spawn抛错不能证明未分配；晚到原child仍捕获并仅取消它一次', async () => {
    let capture!: (child: DatabaseBackupNativeChild) => void;
    const f = fixture(() => ({ spawn: vi.fn((_request, callback) => { capture = callback; throw Error('SYNTHETIC-PASSWORD不可向外抛'); }) }));
    expect(() => f.process.start()).toThrow('终态'); expect(f.process.snapshot()).toMatchObject({ allocationUnknown: true, childAllocated: false });
    await f.process.requestCancel(); expect((await f.process.waitLocalClosed(0)).state).toBe('unknown'); capture(f.child); expect(f.child.kill).toHaveBeenCalledTimes(1);
    expect(f.process.snapshot().childAllocated).toBe(true); await closeAll(f.child); expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(f.port.spawn).toHaveBeenCalledTimes(1);
  });
  it('capture后端口抛错也保留原对象；error事件不能当作无分配或已关闭', async () => {
    const f = fixture(child => ({ spawn: vi.fn((_request, capture) => { capture(child); throw Error('分配后错误'); }) }));
    expect(() => f.process.start()).toThrow(); f.child.emit('error', Error('SYNTHETIC-PASSWORD'));
    expect(f.process.snapshot()).toMatchObject({ childAllocated: true, failed: true, childClosed: false }); expect((await f.process.waitLocalClosed(0)).state).toBe('unknown');
    await closeAll(f.child); expect((await f.process.waitLocalClosed(0)).state).toBe('confirmed');
  });
  it('重复start永久停链、不重连或新spawn，原终态仍可观察', async () => {
    const f = fixture(), result = f.process.start(); expect(() => f.process.start()).toThrow(); await expect(result.exit).rejects.toThrow('终态'); expect(f.port.spawn).toHaveBeenCalledTimes(1);
    await f.process.requestCancel(); f.child.emit('exit', 0, null); await closeAll(f.child); expect(f.process.snapshot()).toMatchObject({ exitSeen: true, zeroExit: true, failed: true, localClosed: true });
  });
  it('单消费者/并发next失败不继续输出，提前return只请求原child取消', async () => {
    const f = fixture(), result = f.process.start(), iterator = result.stdout[Symbol.asyncIterator](); const first = iterator.next(); const rejected = expect(first).rejects.toThrow('终态');
    await expect(iterator.next()).rejects.toThrow('终态'); await rejected; expect(() => result.stdout[Symbol.asyncIterator]()).toThrow('终态');
    await iterator.return!(); expect(f.child.kill).toHaveBeenCalledTimes(1); expect(f.process.snapshot().stdoutEnded).toBe(false); await closeAll(f.child);
  });
  it('kill失败不冒充已关闭，也不重试kill；未start取消则封闭原槽位', async () => {
    const f = fixture(); f.process.start(); f.child.kill.mockImplementation(() => { throw Error('SYNTHETIC-PASSWORD'); });
    await f.process.requestCancel(); await f.process.requestCancel(); expect(f.child.kill).toHaveBeenCalledTimes(1); expect(f.process.snapshot()).toMatchObject({ killError: true, localClosed: false }); await closeAll(f.child);
    const unused = fixture(); await unused.process.requestCancel(); expect((await unused.process.waitLocalClosed(0)).state).toBe('confirmed'); expect(() => unused.process.start()).toThrow(); expect(unused.port.spawn).not.toHaveBeenCalled();
  });
  it('owner ABA或任务号重用永久停链；原child晚事件不转交新owner', async () => {
    const f = fixture(), run = f.process.start(); const waiting = run.stdout[Symbol.asyncIterator]().next(), rejected = expect(waiting).rejects.toThrow();
    f.owner.taskId = 'changed'; expect(f.process.snapshot().poisoned).toBe(true); f.owner.taskId = 'fixture-task-original'; await rejected; await closeAll(f.child); expect((await f.process.waitLocalClosed(0)).state).toBe('unknown');
    const next = fixture(); next.process.start(); expect(() => new DatabaseBackupNativeProcess({ ...next.owner }, next.native.launch, { ...next.binding }, next.port, next.owners)).toThrow(); expect(next.process.snapshot().poisoned).toBe(true); await closeAll(next.child);
  });
  it('未知记录有界且无TTL驱逐；账本满时不释放原未知对象以新建任务', () => {
    const f = fixture(), owners = new DatabaseBackupNativeProcessOwners(1), firstOwner = { taskId: 'first', planToken: 'p1' };
    const first = new DatabaseBackupNativeProcess(firstOwner, f.native.launch, { ...f.binding, owner: firstOwner }, f.port, owners); first.start();
    const secondOwner = { taskId: 'second', planToken: 'p2' }; expect(() => new DatabaseBackupNativeProcess(secondOwner, f.native.launch, { ...f.binding, owner: secondOwner }, f.port, owners)).toThrow();
    expect(first.snapshot()).toMatchObject({ slot: 1, childAllocated: true }); expect(f.port.spawn).toHaveBeenCalledTimes(1);
  });
  it('禁止额外argv/env、shell、恢复入口、任意插件位置及整份clientOptions对象', () => {
    const f = fixture(), bad: unknown[] = [Object.freeze({ ...f.native.launch, shell: true }), Object.freeze({ ...f.native.launch, env: { MYSQL_PWD: 'SYNTHETIC-PASSWORD' } }), Object.freeze({ ...f.native.launch, argv: Object.freeze([...f.native.launch.argv, '--force']) }), Object.freeze({ ...f.native.launch, stdin: 'archive-dump-bytes', stdout: 'bounded-diagnostics' }), Object.freeze({ ...f.native.launch, clientOptions: f.native.clientOptions })];
    const changed = [...f.native.launch.argv]; changed[8] = '--plugin-dir=D:\\foreign'; bad.push(Object.freeze({ ...f.native.launch, argv: Object.freeze(changed) }));
    for (const launch of bad) { const owner = { taskId: 'invalid', planToken: 'invalid' }; expect(() => new DatabaseBackupNativeProcess(owner, launch as DatabaseBackupNativeOptions['launch'], { ...f.binding, owner }, f.port, new DatabaseBackupNativeProcessOwners())).toThrow('终态'); }
    expect(f.port.spawn).not.toHaveBeenCalled();
  });
  it('生产Node适配器只转发固定受控参数；测试注入函数而非启动真实进程', () => {
    const child = new Child(), mock = vi.fn(() => child), f = fixture(() => databaseBackupNativeNodeProcessPort(mock as unknown as typeof spawn));
    f.process.start(); expect(mock).toHaveBeenCalledWith(f.native.launch.executable, f.native.launch.argv, { shell: false, windowsVerbatimArguments: false, windowsHide: true, detached: false, cwd: 'D:\\Verified Tools\\mysql-8.4.11\\bin', env: {}, stdio: ['pipe', 'pipe', 'pipe'] }); expect(f.process.snapshot().childAllocated).toBe(true);
  });
});
