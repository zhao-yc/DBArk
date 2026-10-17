import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupSecretFile, DatabaseBackupSecretFileOwners } from '../../src/engine/databaseBackupSecretFile';
import { DatabaseBackupWindowsFiles, DatabaseBackupWindowsFilesOwners, databaseBackupWindowsFilesLaunch, databaseBackupWindowsFilesBootstrap, databaseBackupWindowsFilesSource, type DatabaseBackupWindowsFilesPort, type DatabaseBackupWindowsFilesConfig } from '../../src/engine/databaseBackupWindowsFiles';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const sid = 'S-1-5-21-111-222-333-1001';
/** 只模拟私有二进制协议与RAM句柄账本；不调用PowerShell、Win32或真实秘密文件。 */
class Helper extends EventEmitter {
  stdout = new PassThrough({ autoDestroy: false }); stderr = new PassThrough({ autoDestroy: false });
  kill = vi.fn(() => true); stdin: Writable;
  requests: { seq: number; op: number; meta: any; payload: Buffer }[] = []; wires: Buffer[] = [];
  nonce = ''; guards = 0; writers = 0; contents: Buffer[] = []; position = 0; grant = false;
  aclFault = false; identityFault = false; removalFault = false; delayOp = 0; delayed?: () => void; short = 7;
  writerClosed = new Set<number>(); removed = new Set<number>();
  constructor() {
    super(); this.stdin = new Writable({ autoDestroy: false, highWaterMark: 8, write: (bytes: Buffer, _encoding, done) => { this.wires.push(bytes); const wire = Buffer.from(bytes), metaLength = wire.readUInt32LE(9), request = { seq: wire.readUInt32LE(4), op: wire[8], meta: JSON.parse(wire.subarray(13, 13 + metaLength).toString('utf8')), payload: Buffer.from(wire.subarray(13 + metaLength)) }; this.requests.push(request); if (!this.nonce) this.nonce = request.meta.owner; const respond = () => { this.respond(request); done(); }; if (request.op === this.delayOp) this.delayed = respond; else respond(); } });
  }
  stamp(id: number) { return { identity: String(id).repeat(48), entryIdentity: String(this.identityFault && id === 3 ? 9 : id).repeat(48), kind: id === 3 ? 'file' : 'directory', unsafeLink: false }; }
  acl(id: number) { return { identity: String(id).repeat(48), ownerSid: this.aclFault ? 'S-1-1-0' : sid, inheritanceDisabled: true, aces: [sid, 'S-1-5-18'].map(sid => ({ sid, allow: true, inherited: false, fullControl: true, containerInherit: id !== 3, objectInherit: id !== 3 })) }; }
  respond(request: { seq: number; op: number; meta: any; payload: Buffer }) {
    let result: any = {}, ok = true; const { op, meta, payload } = request;
    switch (op) {
      case 1: this.guards = 3; this.writers = 1; result = { id: 1, stamp: this.stamp(1) }; break;
      case 2: result = this.stamp(meta.id); break;
      case 3: this.guards++; this.writers++; result = { id: 2, stamp: this.stamp(2) }; break;
      case 4: this.guards++; this.writers++; result = { id: 3, stamp: this.stamp(3) }; break;
      case 5: case 6: result = this.acl(meta.id); break;
      case 7: { const count = Math.min(this.short, payload.length); if (meta.position !== this.position) { ok = false; break; } this.contents.push(Buffer.from(payload.subarray(0, count))); this.position += count; result = { written: count }; break; }
      case 8: result = { synced: true }; break;
      case 9: if (this.writerClosed.has(meta.id)) { ok = false; break; } this.writerClosed.add(meta.id); this.writers--; if (meta.id === 1) this.guards -= 3; result = { workClosed: true, guardHeld: meta.id !== 1 }; break;
      case 10: this.grant = meta.originalOperationLeft === true && meta.nativeClosed === true && meta.streamsClosed === true; result = { granted: this.grant }; break;
      case 11: case 12: if (!this.grant || this.removalFault) { ok = false; break; } this.removed.add(meta.id); this.guards--; result = { identity: String(meta.id).repeat(48), removed: true }; break;
      case 13: result = { guards: this.guards, writers: this.writers, failed: false }; break;
      case 14: ok = this.guards === 0 && this.writers === 0; result = { shutdown: ok }; break;
      default: ok = false;
    }
    this.reply({ seq: request.seq, owner: this.nonce, ok, result: ok ? result : { code: 1 }, counts: { guards: this.guards, writers: this.writers, failed: !ok } });
  }
  reply(value: unknown) { const json = Buffer.from(JSON.stringify(value)), frame = Buffer.alloc(4 + json.length); frame.writeUInt32LE(json.length); json.copy(frame, 4); for (let at = 0; at < frame.length; at += 11) this.stdout.write(frame.subarray(at, at + 11)); }
  async closeAll() { this.stdin.destroy(); this.stdout.destroy(); this.stderr.destroy(); await turn(); this.emit('exit', 0, null); this.emit('close', 0, null); }
}
function fixture(overrides: Partial<DatabaseBackupWindowsFilesConfig> = {}) {
  const owner = { taskId: 'fixture-task', planToken: 'fixture-plan' }, helper = new Helper();
  const config: DatabaseBackupWindowsFilesConfig = { parentDirectory: 'D:\\Private Root', directoryName: 'fixture-child', currentUserSid: sid, systemRoot: 'C:\\Windows', sourcePath: 'D:\\Fixed Resources\\databaseBackupWindowsFiles.helper.cs', timeoutMs: 500, startupTimeoutMs: 500, ...overrides };
  const port: DatabaseBackupWindowsFilesPort = { spawn: vi.fn((_request, capture) => { capture(helper); return helper; }), cleanupPermit: vi.fn(async () => ({ owner, originalOperationLeft: true as const, nativeClosed: true as const, streamsClosed: true as const })), checkCancelled() {} };
  const owners = new DatabaseBackupWindowsFilesOwners(), bridge = new DatabaseBackupWindowsFiles(owner, config, port, owners);
  const secret = new DatabaseBackupSecretFile(owner, { platform: 'win32', parentDirectory: config.parentDirectory, directoryName: config.directoryName, currentUserSid: sid }, bridge.ports(), new DatabaseBackupSecretFileOwners());
  const text = '[client]\nuser="fixture"\npassword="SYNTHETIC-PRIVATE-ONLY"\n', source = { takeText: vi.fn(() => text) };
  return { owner, helper, config, port, owners, bridge, secret, source, text };
}

describe('B01 Windows实际端口源码及私有pipe（RAM验证，不是OS验收）', () => {
  it('固定C#资源哈希准确；完整源码不塞EncodedCommand，小bootstrap按完整32767字符预算', () => {
    // 只读仓库固定源码做制品哈希，不创建或读取任何认证文件，也不编译/执行C#。
    const bytes = readFileSync(new URL('../../src/engine/databaseBackupWindowsFiles.helper.cs', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(databaseBackupWindowsFilesSource.sha256); expect(bytes.length).toBeLessThanOrEqual(65536);
    expect(Buffer.from(bytes.toString('utf8'), 'utf16le').toString('base64').length).toBeGreaterThan(32767);
    const f = fixture(), launch = databaseBackupWindowsFilesLaunch(f.config), decoded = Buffer.from(launch.argv.at(-1)!, 'base64').toString('utf16le');
    expect(decoded).toBe(databaseBackupWindowsFilesBootstrap); expect(decoded).toContain(databaseBackupWindowsFilesSource.sha256); expect(decoded).not.toContain(f.config.parentDirectory);
    expect(launch.commandLineCharacters).toBeLessThan(32767); expect(launch.options).toMatchObject({ shell: false, windowsVerbatimArguments: false, env: { DBARK_WF_SOURCE: f.config.sourcePath, TEMP: f.config.parentDirectory, TMP: f.config.parentDirectory } });
    expect(JSON.stringify(launch)).not.toContain('SYNTHETIC-PRIVATE-ONLY');
  });
  it('构造不spawn；真实端口协议完整短写/同步/关闭，guard仍单独计数，Root许可后才删除', async () => {
    const f = fixture(); expect(f.port.spawn).not.toHaveBeenCalled(); f.bridge.start(); f.helper.emit('spawn'); await f.secret.open(f.source);
    expect(Buffer.concat(f.helper.contents).toString('utf8')).toBe(f.text); expect(f.source.takeText).toHaveBeenCalledTimes(1); expect(f.bridge.snapshot()).toMatchObject({ guards: 5, writers: 2, cleanupGranted: false, helperLocalClosed: false, wireFrames: 0 });
    expect(f.secret.snapshot().fileClosed).toBe(true); expect(f.helper.removed.size).toBe(0); expect(f.helper.wires.every(frame => frame.every(byte => byte === 0))).toBe(true);
    const commands = f.helper.requests.map(item => item.op); expect(commands.indexOf(6)).toBeLessThan(commands.indexOf(7)); expect(commands).toContain(8);
    expect((await f.secret.cleanup()).state).toBe('confirmed'); expect(f.helper.removed).toEqual(new Set([3, 2])); expect(f.bridge.snapshot()).toMatchObject({ guards: 0, writers: 0, helperLocalClosed: false });
    expect((await f.bridge.shutdown(0)).state).toBe('unknown'); await f.helper.closeAll(); expect((await f.bridge.shutdown(0)).state).toBe('confirmed');
  });
  it('秘密仅位于二进制payload，元数据/argv/env/快照/inspect不含正文和原路径', async () => {
    const f = fixture(); f.bridge.start(); await f.secret.open(f.source);
    const writes = f.helper.requests.filter(item => item.op === 7); expect(writes.length).toBeGreaterThan(1); expect(writes.every(item => item.payload.length <= 65536)).toBe(true);
    for (const request of writes) expect(JSON.stringify(request.meta)).not.toContain('SYNTHETIC-PRIVATE-ONLY');
    for (const output of [JSON.stringify(f.bridge), inspect(f.bridge), inspect(f.bridge, { customInspect: false, showHidden: true })]) for (const hidden of ['SYNTHETIC-PRIVATE-ONLY', f.config.parentDirectory, f.config.sourcePath, f.owner.taskId, f.owner.planToken]) expect(output).not.toContain(hidden);
    for (const value of Object.values(f.bridge.snapshot())) expect(['number', 'boolean']).toContain(typeof value);
    await f.secret.cleanup(); await f.bridge.shutdown(0); await f.helper.closeAll();
  });
  it('实际ACL回执不符在取秘密前阻断，不用期望SID或常量proof替换回执', async () => {
    const f = fixture(); f.helper.aclFault = true; f.bridge.start(); await expect(f.secret.open(f.source)).rejects.toThrow('已保留');
    expect(f.source.takeText).not.toHaveBeenCalled(); expect(f.helper.requests.some(item => item.op === 7)).toBe(false); await f.helper.closeAll();
  });
  it('Root未确认dump真实关闭时没有grant/delete；cancel ACK不能替代许可', async () => {
    const f = fixture(); f.bridge.start(); await f.secret.open(f.source); vi.mocked(f.port.cleanupPermit).mockResolvedValue({ owner: f.owner, originalOperationLeft: true, nativeClosed: false, streamsClosed: true } as never);
    f.bridge.requestCancel(); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.helper.requests.some(item => [10, 11, 12].includes(item.op))).toBe(false); expect(f.helper.kill).not.toHaveBeenCalled(); await f.helper.closeAll();
  });
  it('文件入口身份换绑阻断，不close后按路径unlink，不删除另一对象', async () => {
    const f = fixture(); f.bridge.start(); await f.secret.open(f.source); f.helper.identityFault = true;
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.helper.requests.some(item => item.op === 11)).toBe(false); expect(f.helper.removed.size).toBe(0); await f.helper.closeAll();
  });
  it('非空/只读等原句柄删除失败回执保持unknown，不重试删除或改成递归', async () => {
    const f = fixture(); f.bridge.start(); await f.secret.open(f.source); f.helper.removalFault = true;
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.helper.requests.filter(item => item.op === 11)).toHaveLength(1); expect(f.helper.requests.some(item => item.op === 12)).toBe(false); await f.helper.closeAll();
  });
  it('RPC超时仍保留原pending/write缓冲；晚回执归原owner，不能新分配或提前删', async () => {
    const f = fixture({ timeoutMs: 10, startupTimeoutMs: 10 }); f.helper.delayOp = 1; f.bridge.start(); const opening = f.secret.open(f.source); await expect(opening).rejects.toThrow('已保留');
    expect(f.bridge.snapshot()).toMatchObject({ pending: true, unknown: true, wireFrames: 1 }); expect(f.helper.wires[0].some(byte => byte !== 0)).toBe(true);
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.port.cleanupPermit).not.toHaveBeenCalled(); f.helper.delayed!(); await turn();
    expect(f.bridge.snapshot()).toMatchObject({ guards: 3, unknown: true, wireFrames: 0 }); expect(f.helper.wires[0].every(byte => byte === 0)).toBe(true); expect(f.source.takeText).not.toHaveBeenCalled(); expect(f.port.spawn).toHaveBeenCalledTimes(1); await f.helper.closeAll();
  });
  it('stderr排空仅饱和计数；错误或exit不能伪造3流及child关闭', async () => {
    const f = fixture(); f.bridge.start(); f.helper.stderr.write(Buffer.alloc(70000, 0x61)); f.helper.emit('exit', 70, null); await turn();
    expect(f.bridge.snapshot()).toMatchObject({ stderrBytes: 65536, stderrOverflow: true, exitSeen: true, childClosed: false, helperLocalClosed: false }); f.helper.emit('error', Error('SYNTHETIC-PRIVATE-ONLY')); expect(f.bridge.snapshot().unknown).toBe(true); await f.helper.closeAll();
  });
  it('shutdown等待全部原流close，exit先到不提前结束等待', async () => {
    const f = fixture(); f.bridge.start(); await f.secret.open(f.source); await f.secret.cleanup(); const ending = f.bridge.shutdown(200);
    await turn(); f.helper.emit('exit', 0, null); await turn(); let settled = false; void ending.then(() => { settled = true; }); await turn(); expect(settled).toBe(false);
    await f.helper.closeAll(); expect((await ending).state).toBe('confirmed');
  });
  it('错误序号/owner或超预算响应阻断而不执行新动作', async () => {
    const f = fixture({ startupTimeoutMs: 20 }); f.helper.delayOp = 1; f.bridge.start(); const opening = f.secret.open(f.source);
    await turn(); f.helper.reply({ seq: 999, owner: 'wrong', ok: true, result: {}, counts: { guards: 0, writers: 0, failed: false } }); await expect(opening).rejects.toThrow('已保留'); expect(f.bridge.snapshot().unknown).toBe(true); await f.helper.closeAll();
    const next = fixture({ startupTimeoutMs: 20 }); next.helper.delayOp = 1; next.bridge.start(); const pending = next.secret.open(next.source); await turn(); const header = Buffer.alloc(4); header.writeUInt32LE(16385); next.helper.stdout.write(header); await expect(pending).rejects.toThrow('已保留'); await next.helper.closeAll();
  });
  it('opaque facade不可换owner，根/叶名/文件名不能改成任意路径', async () => {
    const f = fixture(); f.bridge.start(); const ports = f.bridge.ports(), parent = await ports.openParent(f.owner, f.config.parentDirectory);
    await expect(parent.createDirectory('../foreign', 0o700)).rejects.toThrow('helper'); const child = await parent.createDirectory(f.config.directoryName, 0o700);
    await expect(child.openFile('other.cnf' as 'client.cnf', { flags: 'wx', mode: 0o600 })).rejects.toThrow('helper');
    await expect(ports.windows!.protectDirectory({ ...f.owner }, child)).rejects.toThrow('helper'); await expect(ports.windows!.protectDirectory(f.owner, {} as never)).rejects.toThrow('helper'); await f.helper.closeAll();
  });
  it('owner ABA/重复启动永久停链，原helper迟到close仍记在原实例', async () => {
    const f = fixture(); f.bridge.start(); expect(() => f.bridge.start()).toThrow('helper'); expect(f.port.spawn).toHaveBeenCalledTimes(1); f.owner.taskId = 'changed'; expect(f.bridge.snapshot().poisoned).toBe(true); f.owner.taskId = 'fixture-task';
    await f.helper.closeAll(); expect(f.bridge.snapshot()).toMatchObject({ childClosed: true, stdinClosed: true, stdoutClosed: true, stderrClosed: true, poisoned: true, helperLocalClosed: false });
  });
});
