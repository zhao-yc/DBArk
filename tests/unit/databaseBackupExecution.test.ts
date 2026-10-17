import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupExecutor, type DatabaseBackupExecutionArchive, type DatabaseBackupExecutionOwner, type DatabaseBackupExecutionPorts, type DatabaseBackupExecutionScope } from '../../src/engine/databaseBackupExecution';
import { databaseBackupFixture } from './databaseBackupFixtures';
import type { DatabaseBackupManifest } from '../../src/shared/databaseBackup';

/** 只替换 OS/锁/文件端口；生产执行状态机和前片计划器真实运行，RAM 容器不是 ZIP 验收。 */
async function fixture() {
  const f = databaseBackupFixture(), inspected = await f.planner.inspect(f.input);
  const plan = await f.planner.prepare({ inspectionToken: inspected.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: 'prepare' });
  const binding = f.planner.bindings(plan.planToken), trace: string[] = [], chunks: Uint8Array[] = [];
  let owner!: DatabaseBackupExecutionOwner, hooks!: { checkCancelled(): void; onCommitStart(): void }, held = false, closed = true, committed = false;
  let dumpClosed = true, lockReleased = true, toolsClosed = true, manifest: DatabaseBackupManifest | undefined;
  let archiveBytes = '', archiveSha = '';
  const proof = () => ({ owner, state: 'confirmed' as const });
  const scope: DatabaseBackupExecutionScope = {
    owner: {} as DatabaseBackupExecutionOwner,
    confirmLeases: vi.fn(async () => { trace.push('leases'); toolsClosed = false; return { owner, sourceLease: binding.source.sourceLease, connectionRevision: binding.source.connectionRevision, toolLease: binding.tool.toolLease, registryRevision: binding.tool.registryRevision, suiteSha256: binding.tool.expectedSuiteSha256, outputLease: binding.output.outputLease, outputRevision: binding.output.revision }; }),
    acquireLock: vi.fn(async () => { trace.push('lock'); lockReleased = false; return { owner, lockId: 'actual-lock', profileId: plan.lock.profileId, sourceLease: binding.source.sourceLease, acquiredAt: new Date().toISOString(), actualHeld: true as const, allObjectsFrozen: true as const }; }),
    inspectLocked: vi.fn(async () => { trace.push('locked-inspect'); return { owner, source: structuredClone(binding.source), tool: structuredClone(binding.tool) }; }),
    startDump: vi.fn(async () => { trace.push('dump-start'); dumpClosed = false; return { owner, stdout: (async function* () { yield Buffer.from('原始 SQL\0DEFAULT NULL\n', 'utf8'); })(), exit: Promise.resolve({ owner, code: 0, signal: null }) }; }),
    confirmContinuity: vi.fn(async lock => ({ owner, lockId: lock.lockId, uninterrupted: true as const })),
    requestCancel: vi.fn(async () => { trace.push('cancel-request'); }),
    closeDump: vi.fn(async () => { trace.push('dump-close'); dumpClosed = true; return proof(); }),
    unlock: vi.fn(async () => { trace.push('unlock'); lockReleased = true; return proof(); }),
    closeTools: vi.fn(async () => { trace.push('tools-close'); toolsClosed = true; return proof(); }),
    snapshot: () => ({ owner, dumpClosed, lockReleased, toolsClosed }),
  };
  const archive: DatabaseBackupExecutionArchive = {
    owner: {} as DatabaseBackupExecutionOwner,
    open: vi.fn(async () => { trace.push('archive-open'); closed = false; }),
    writeDump: vi.fn(async bytes => { trace.push('write'); chunks.push(bytes.slice()); }),
    finish: vi.fn(async value => {
      trace.push('finish'); manifest = structuredClone(value); const raw = Buffer.concat(chunks);
      const dump = { entry: 'dump.sql' as const, bytes: String(raw.length), sha256: createHash('sha256').update(raw).digest('hex') };
      archiveBytes = String(raw.length + 512); archiveSha = createHash('sha256').update('仅RAM容器').update(raw).digest('hex');
      return { dump, archive: { bytes: archiveBytes, sha256: archiveSha }, manifest: structuredClone(value) };
    }),
    commit: vi.fn(async () => { hooks.checkCancelled(); hooks.onCommitStart(); trace.push('commit'); committed = true; closed = true; }),
    abort: vi.fn(async () => { trace.push('abort'); closed = true; return proof(); }),
    snapshot: () => ({ owner, fileCommitted: committed, closed, ...(committed ? { artifactToken: 'artifact', bytes: archiveBytes, sha256: archiveSha } : {}) }),
  };
  const release = vi.fn(async () => { trace.push('release-target'); held = false; return proof(); });
  const ports: DatabaseBackupExecutionPorts = {
    now: () => Date.now(), bindings: vi.fn(async token => f.planner.bindings(token)),
    reserve: vi.fn(value => { if (held) throw Error('目标正在占用'); owner = value; held = true; return { owner, release }; }),
    createScope: vi.fn(value => { scope.owner = value; return scope; }),
    allocateArchive: vi.fn((value, _binding, _target, callbacks) => { archive.owner = value; hooks = callbacks; return archive; }),
  };
  const executor = new DatabaseBackupExecutor(ports, { stageMs: 100, cleanupMs: 20 });
  return { ...f, binding, plan, ports, executor, scope, archive, trace, chunks, release, get owner() { return owner; }, get held() { return held; }, get manifest() { return manifest; }, get hooks() { return hooks; }, setCommitted: () => { committed = true; closed = true; } };
}

describe('B01 真实执行状态机（仅 RAM 端口）', () => {
  it('顺序复核租约/实际锁/完整清单，保持原字节；close/unlock/tools 确认后才 finish/commit', async () => {
    const f = await fixture(), result = await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' });
    expect(result.state).toBe('completed'); expect(result.fileCommitted).toBe(true); expect(result.restoreVerified).toBe(false);
    expect(f.trace).toEqual(['leases', 'lock', 'locked-inspect', 'archive-open', 'dump-start', 'write', 'dump-close', 'unlock', 'tools-close', 'finish', 'commit', 'release-target']);
    expect(Buffer.concat(f.chunks)).toEqual(Buffer.from('原始 SQL\0DEFAULT NULL\n')); expect(f.manifest?.resourcesConfirmed).toBe(true); expect(f.manifest?.restoreVerified).toBe(false); expect(f.held).toBe(false);
    await expect(f.executor.run({ planToken: f.plan.planToken, taskId: 'again' })).rejects.toThrow('领取');
  });
  it('首次等待前消费 token/task；有界容量拒绝第三个活动任务', async () => {
    const f = await fixture(); let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(f.ports.bindings).mockImplementation(async () => { await waiting; throw Error('仅RAM停止'); });
    const a = f.executor.run({ planToken: 'one', taskId: 'one' }), b = f.executor.run({ planToken: 'two', taskId: 'two' });
    await expect(f.executor.run({ planToken: 'one', taskId: 'other' })).rejects.toThrow('领取'); await expect(f.executor.run({ planToken: 'three', taskId: 'three' })).rejects.toThrow('容量'); finish(); await Promise.all([a, b]);
  });
  it('锁内对象/工具/权限改变时不启动 dump，不降级为部分备份', async () => {
    const f = await fixture(); vi.mocked(f.scope.inspectLocked).mockImplementation(async () => { const source = structuredClone(f.binding.source); source.visibility.event = 'unknown'; return { owner: f.owner, source, tool: f.binding.tool }; });
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('failed'); expect(f.scope.startDump).not.toHaveBeenCalled(); expect(f.archive.commit).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('主 dump 错误与 close/unlock 副错误都保留，未知时保留准确 scope/target，不重试 close', async () => {
    const f = await fixture(), primary = Error('仅RAM原错误'), close = Error('仅RAM close错误');
    vi.mocked(f.scope.startDump).mockRejectedValue(primary); vi.mocked(f.scope.closeDump).mockRejectedValue(close); vi.mocked(f.scope.unlock).mockImplementation(async () => ({ owner: f.owner, state: 'unknown' }));
    const result = await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' }); expect(result.state).toBe('retained-unknown'); expect(f.release).not.toHaveBeenCalled(); expect(f.held).toBe(true);
    const retained = f.executor.retained('run')!; expect(retained.scope).toBe(f.scope); expect(retained.failures.map(item => item.error)).toEqual(expect.arrayContaining([primary, close])); expect(f.scope.closeDump).toHaveBeenCalledTimes(1); expect(f.archive.commit).not.toHaveBeenCalled();
  });
  it('exit=0 和 stdout EOF 不等于真实 close；close 未确认不能发布', async () => {
    const f = await fixture(); vi.mocked(f.scope.closeDump).mockImplementation(async () => ({ owner: f.owner, state: 'unknown' }));
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('retained-unknown'); expect(f.archive.commit).not.toHaveBeenCalled(); expect(f.held).toBe(true);
  });
  it('dump 背压逐 await，输入大块拆成最多64KiB，不读取下一块越过未完成写入', async () => {
    const f = await fixture(); let advanced = false, finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(f.scope.startDump).mockImplementation(async () => ({ owner: f.owner, stdout: (async function* () { yield new Uint8Array(130_000).fill(7); advanced = true; yield Buffer.from('尾'); })(), exit: Promise.resolve({ owner: f.owner, code: 0, signal: null }) }));
    const normal = f.archive.writeDump; let first = true; vi.mocked(f.archive.writeDump).mockImplementation(async bytes => { f.trace.push('write'); f.chunks.push(bytes.slice()); if (first) { first = false; await wait; } });
    const running = f.executor.run({ planToken: f.plan.planToken, taskId: 'run' }); await vi.waitFor(() => expect(normal).toHaveBeenCalledTimes(1)); expect(advanced).toBe(false); finish(); expect((await running).state).toBe('completed'); expect(f.chunks.every(chunk => chunk.length <= 65536)).toBe(true);
  });
  it('取消 ACK 不先释放；停止后真实终态确认才返回 cancelled', async () => {
    const f = await fixture(); let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(f.scope.startDump).mockImplementation(async () => { await waiting; return { owner: f.owner, stdout: (async function* () { yield Buffer.from('late'); })(), exit: Promise.resolve({ owner: f.owner, code: 0, signal: null }) }; });
    const running = f.executor.run({ planToken: f.plan.planToken, taskId: 'run' }); await vi.waitFor(() => expect(f.scope.startDump).toHaveBeenCalled()); expect(f.executor.cancel('run')).toBe('requested');
    const result = await running; expect(result.state).toBe('retained-unknown'); expect(f.held).toBe(true); finish(); await vi.waitFor(() => expect(f.executor.retained('run')!.pending).toBe(0));
    expect((await f.executor.recover('run')).state).toBe('cancelled'); expect(f.scope.startDump).toHaveBeenCalledTimes(1); expect(f.archive.commit).not.toHaveBeenCalled();
  });
  it('commit边界后的取消如实保留 fileCommitted，不能变为假取消或删除归档', async () => {
    const f = await fixture(); vi.mocked(f.archive.commit).mockImplementation(async () => { f.hooks.checkCancelled(); f.hooks.onCommitStart(); f.executor.cancel('run'); f.setCommitted(); });
    const result = await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' }); expect(result.fileCommitted).toBe(true); expect(result.state).not.toBe('cancelled'); expect(f.archive.abort).not.toHaveBeenCalled();
  });
  it('commit超时后保留目标及句柄，晚到提交事实可观察，显式恢复不重跑 dump', async () => {
    const f = await fixture(); let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(f.archive.commit).mockImplementation(async () => { f.hooks.onCommitStart(); await waiting; f.setCommitted(); });
    const result = await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' }); expect(result.state).toBe('retained-unknown'); expect(result.fileCommitted).toBe(false); expect(f.archive.abort).not.toHaveBeenCalled(); expect(f.held).toBe(true);
    finish(); await vi.waitFor(() => { expect(f.executor.retained('run')!.result.fileCommitted).toBe(true); expect(f.executor.retained('run')!.pending).toBe(0); });
    expect((await f.executor.recover('run')).state).toBe('completed'); expect(f.scope.startDump).toHaveBeenCalledTimes(1); expect(f.archive.commit).toHaveBeenCalledTimes(1);
  });
  it('外来 owner 句柄不能被清理、解锁或提交，不能借相同task字符串冒领', async () => {
    const f = await fixture(), foreign = { ...f.scope, owner: { taskId: 'run', planToken: f.plan.planToken } }; vi.mocked(f.ports.createScope).mockReturnValue(foreign);
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('retained-unknown'); expect(f.scope.closeDump).not.toHaveBeenCalled(); expect(f.scope.unlock).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  });
  it('归档abort未知即使closed外观为真也保留目标，不把部分文件清理当成功', async () => {
    const f = await fixture(); vi.mocked(f.scope.startDump).mockRejectedValue(Error('RAM失败')); vi.mocked(f.archive.abort).mockImplementation(async () => ({ owner: f.owner, state: 'unknown' }));
    vi.spyOn(f.archive, 'snapshot').mockImplementation(() => ({ owner: f.owner, fileCommitted: false, closed: true }));
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('retained-unknown'); expect(f.release).not.toHaveBeenCalled();
  });
  it('空 stdout 即使 exit=0 也不当作整库备份', async () => {
    const f = await fixture(); vi.mocked(f.scope.startDump).mockImplementation(async () => ({ owner: f.owner, stdout: (async function* () {})(), exit: Promise.resolve({ owner: f.owner, code: 0, signal: null }) }));
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('failed'); expect(f.archive.commit).not.toHaveBeenCalled();
  });
  it('finish 返回另一库的 manifest 必须在 commit 前失败，不把容器哈希正确当源范围正确', async () => {
    const f = await fixture(), finish = vi.mocked(f.archive.finish).getMockImplementation()!;
    vi.mocked(f.archive.finish).mockImplementation(async manifest => { const result = await finish(manifest); result.manifest.database = 'another_database'; return result; });
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('failed'); expect(f.archive.commit).not.toHaveBeenCalled(); expect(f.archive.abort).toHaveBeenCalledTimes(1);
  });
  it('finish 不能通过原地修改传入 manifest 的别名绕过源范围复核', async () => {
    const f = await fixture(), finish = vi.mocked(f.archive.finish).getMockImplementation()!;
    vi.mocked(f.archive.finish).mockImplementation(async manifest => { manifest.database = 'aliased-database'; return finish(manifest); });
    expect((await f.executor.run({ planToken: f.plan.planToken, taskId: 'run' })).state).toBe('failed'); expect(f.archive.commit).not.toHaveBeenCalled();
  });
});
