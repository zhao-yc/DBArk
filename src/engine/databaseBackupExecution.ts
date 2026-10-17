import { createHash } from 'node:crypto';
import { databaseBackupKinds, type DatabaseBackupManifest, type DatabaseBackupRunResult } from '../shared/databaseBackup';
import type { DatabaseBackupRunBindings, DatabaseBackupSourceEvidence, DatabaseBackupRegisteredTool } from './databaseBackupPlan';

export interface DatabaseBackupExecutionOwner { readonly taskId: string; readonly planToken: string; }
export interface DatabaseBackupEndProof { owner: DatabaseBackupExecutionOwner; state: 'confirmed' | 'unknown'; }
export interface DatabaseBackupLeaseProof {
  owner: DatabaseBackupExecutionOwner; sourceLease: string; connectionRevision: string; toolLease: string;
  registryRevision: string; suiteSha256: string; outputLease: string; outputRevision: string;
}
export interface DatabaseBackupLockProof {
  owner: DatabaseBackupExecutionOwner; lockId: string; profileId: string; sourceLease: string;
  acquiredAt: string; actualHeld: true; allObjectsFrozen: true;
}
export interface DatabaseBackupDump {
  owner: DatabaseBackupExecutionOwner; stdout: AsyncIterable<Uint8Array>;
  exit: Promise<{ owner: DatabaseBackupExecutionOwner; code: number | null; signal: string | null }>;
}
/** 同步创建并预登记所有后续可能分配的句柄；异步失败或晚到分配仍属于这个稳定 scope。 */
export interface DatabaseBackupExecutionScope {
  owner: DatabaseBackupExecutionOwner;
  confirmLeases(signal: AbortSignal): Promise<DatabaseBackupLeaseProof>;
  acquireLock(signal: AbortSignal): Promise<DatabaseBackupLockProof>;
  inspectLocked(lock: DatabaseBackupLockProof, signal: AbortSignal): Promise<{ owner: DatabaseBackupExecutionOwner; source: DatabaseBackupSourceEvidence; tool: DatabaseBackupRegisteredTool }>;
  startDump(lock: DatabaseBackupLockProof, signal: AbortSignal): Promise<DatabaseBackupDump>;
  confirmContinuity(lock: DatabaseBackupLockProof, dump: DatabaseBackupDump): Promise<{ owner: DatabaseBackupExecutionOwner; lockId: string; uninterrupted: true }>;
  requestCancel(): Promise<void>;
  closeDump(): Promise<DatabaseBackupEndProof>;
  unlock(): Promise<DatabaseBackupEndProof>;
  closeTools(): Promise<DatabaseBackupEndProof>;
  snapshot(): { owner: DatabaseBackupExecutionOwner; dumpClosed: boolean; lockReleased: boolean; toolsClosed: boolean };
}
/** 员工4归档模块的私有适配端口，不在本模块重复 ZIP 实现或读取路径。 */
export interface DatabaseBackupExecutionArchive {
  owner: DatabaseBackupExecutionOwner;
  open(): Promise<void>;
  writeDump(bytes: Uint8Array): Promise<void>;
  finish(manifest: DatabaseBackupManifest): Promise<{ dump: DatabaseBackupManifest['dump']; archive: { bytes: string; sha256: string }; manifest: DatabaseBackupManifest }>;
  commit(): Promise<void>;
  abort(): Promise<DatabaseBackupEndProof>;
  snapshot(): { owner: DatabaseBackupExecutionOwner; fileCommitted: boolean; closed: boolean; artifactToken?: string; bytes?: string; sha256?: string };
}
export interface DatabaseBackupTargetReservation {
  owner: DatabaseBackupExecutionOwner;
  release(): Promise<DatabaseBackupEndProof>;
}
export interface DatabaseBackupExecutionPorts {
  now(): number;
  bindings(planToken: string): Promise<DatabaseBackupRunBindings>;
  /** 同步登记目标归属，实际授权/互斥确认在 scope.confirmLeases 内完成。 */
  reserve(owner: DatabaseBackupExecutionOwner, binding: DatabaseBackupRunBindings): DatabaseBackupTargetReservation;
  createScope(owner: DatabaseBackupExecutionOwner, binding: DatabaseBackupRunBindings): DatabaseBackupExecutionScope;
  allocateArchive(owner: DatabaseBackupExecutionOwner, binding: DatabaseBackupRunBindings, target: DatabaseBackupTargetReservation, hooks: { checkCancelled(): void; onCommitStart(): void }): DatabaseBackupExecutionArchive;
}
interface Failure { phase: string; error: unknown; primary: boolean; }
interface RunRecord {
  owner: DatabaseBackupExecutionOwner; controller: AbortController; failures: Failure[]; pending: Set<object>;
  expiresAt: number; finished: boolean; commitStarted: boolean; cancelled: boolean; validArchive: boolean;
  ownerMismatch: boolean; scopeCleanupAttempted: boolean; snapshotErrors: Set<string>; fileCommittedSeen: boolean;
  archiveSummary?: { bytes: string; sha256: string };
  stopWork?: Promise<void>;
  commitRequested?: boolean; commitSettled?: boolean; recovering?: Promise<DatabaseBackupRunResult>;
  archiveAbortConfirmed?: boolean;
  binding?: DatabaseBackupRunBindings; target?: DatabaseBackupTargetReservation; scope?: DatabaseBackupExecutionScope; archive?: DatabaseBackupExecutionArchive;
  result?: DatabaseBackupRunResult;
}
export const databaseBackupExecutionLimits = { active: 2, records: 8, stageMs: 30_000, cleanupMs: 1_000, maxChunkBytes: 1024 * 1024, maxChunks: 1_000_000 } as const;
const permissions = ['data', 'definitions', 'routines', 'events', 'globalReadLock', 'tablespaces'] as const;

/** 真实执行次序由依赖注入端口驱动；本模块不 spawn、不接触凭据、不联网、不实现归档格式。 */
export class DatabaseBackupExecutor {
  private readonly records = new Map<string, RunRecord>();
  private readonly tasks = new Map<string, RunRecord>();
  constructor(private readonly ports: DatabaseBackupExecutionPorts, private readonly budgets = { stageMs: 30_000, cleanupMs: 1_000 }) {
    if (!(budgets.stageMs > 0 && budgets.stageMs <= databaseBackupExecutionLimits.stageMs && budgets.cleanupMs > 0 && budgets.cleanupMs <= databaseBackupExecutionLimits.cleanupMs)) throw Error('备份执行预算无效');
  }
  /** 只清除已知终态且原计划已过期的防重放记录；未知资源不按时间驱逐。 */
  private prune(): void { for (const [token, record] of this.records) if (record.finished && record.result?.resources === 'confirmed' && record.expiresAt <= this.ports.now()) { this.records.delete(token); this.tasks.delete(record.owner.taskId); } }
  /** owner 必须是同一对象，不能借一个相同字符串认领其它操作资源。 */
  private owned(record: RunRecord, value: { owner: DatabaseBackupExecutionOwner }): void { if (value.owner !== record.owner) { record.ownerMismatch = true; throw Error('备份资源所属 owner 不匹配'); } }
  private check(record: RunRecord): void { if (record.controller.signal.aborted) throw Error('备份已请求取消'); }
  /** 每个未决异步工作保持登记；超时不等于工作已结束，清理证明不能越过未决分配。 */
  private async wait<T>(record: RunRecord, phase: string, value: Promise<T>, ms: number, cancellable = true): Promise<T> {
    const marker = {}, signal = record.controller.signal; record.pending.add(marker);
    const work = Promise.resolve(value).then(result => { record.pending.delete(marker); return result; }, error => { record.pending.delete(marker); throw error; });
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${phase}超出等待预算`)), Math.max(1, ms)); });
    const cancellation = new Promise<never>((_, reject) => { abort = () => reject(Error('备份已请求取消')); if (cancellable) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); } });
    try { return await Promise.race([work, timeout, cancellation]); }
    finally { if (timer) clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
  }
  /** 私有故障保留原 Error 对象；对外结果不输出原始 SQL、argv、stderr 或凭据。 */
  private fail(record: RunRecord, phase: string, error: unknown, primary = false): void { record.failures.push({ phase, error, primary }); }
  /** 请求取消只记录意图，不把取消 ACK、stdout EOF 或 exit 当作 close/unlock 证明。 */
  cancel(taskId: string): 'requested' | 'absent' | 'finished' {
    const record = this.tasks.get(taskId); if (!record) return 'absent'; if (record.finished) return 'finished';
    record.cancelled = true; record.controller.abort();
    if (record.scope) void this.requestStop(record).catch(error => this.fail(record, '取消请求', error)); return 'requested';
  }
  /** 相同操作的停止请求合并；ACK 仍不替代后续资源确认。 */
  private requestStop(record: RunRecord): Promise<void> { return record.stopWork ??= record.scope ? this.wait(record, '取消请求', Promise.resolve().then(() => record.scope!.requestCancel()), this.budgets.cleanupMs, false) : Promise.resolve(); }
  /** 首个 await 前占用容量并消费计划令牌；同一 token/task 不能自动重放。 */
  async run(input: { planToken: string; taskId: string }): Promise<DatabaseBackupRunResult> {
    if (Object.keys(input).sort().join(',') !== 'planToken,taskId' || !input.planToken || input.planToken.length > 200 || !input.taskId || input.taskId.length > 200 || input.planToken.includes('\0') || input.taskId.includes('\0')) throw Error('备份执行只接受计划令牌和任务号');
    this.prune();
    if (this.records.has(input.planToken) || this.tasks.has(input.taskId)) throw Error('备份计划或任务号已经领取，不能重放');
    if (this.records.size >= databaseBackupExecutionLimits.records || [...this.records.values()].filter(item => !item.finished).length >= databaseBackupExecutionLimits.active) throw Error('备份执行容量已满，未知任务须先核对释放');
    const owner = Object.freeze({ ...input }), record: RunRecord = { owner, controller: new AbortController(), failures: [], pending: new Set(), expiresAt: this.ports.now() + 120_000, finished: false, commitStarted: false, cancelled: false, validArchive: false, ownerMismatch: false, scopeCleanupAttempted: false, snapshotErrors: new Set(), fileCommittedSeen: false };
    this.records.set(input.planToken, record); this.tasks.set(input.taskId, record);
    let phase = '领取计划';
    try {
      const binding = await this.wait(record, phase, this.ports.bindings(input.planToken), this.budgets.stageMs); record.binding = binding; record.expiresAt = binding.plan.expiresAt;
      if (binding.plan.planToken !== input.planToken || binding.plan.expiresAt <= this.ports.now() || binding.plan.backupExecuted !== false || !binding.plan.mustRevalidateUnderLock || binding.plan.format !== 'dbark-backup-zip-store-v1' || !(binding.plan.maxBytes > 0 && binding.plan.maxBytes <= 10 * 1024 ** 3)) throw Error('备份计划过期、绑定或预算无效');
      if (!(binding.plan.lock.maxWaitMs > 0 && binding.plan.lock.maxWaitMs <= 30_000 && binding.plan.lock.maxHoldMs > 0 && binding.plan.lock.maxHoldMs <= 120_000)) throw Error('实际锁等待或持锁预算无效');
      this.check(record); phase = '登记目标与资源';
      const target = this.ports.reserve(owner, binding); this.owned(record, target); record.target = target;
      const scope = this.ports.createScope(owner, binding); this.owned(record, scope); record.scope = scope;
      const archive = this.ports.allocateArchive(owner, binding, target, { checkCancelled: () => { if (!record.commitStarted) this.check(record); }, onCommitStart: () => { record.commitStarted = true; } }); this.owned(record, archive); record.archive = archive;
      phase = '复核租约'; const leases = await this.wait(record, phase, record.scope.confirmLeases(record.controller.signal), this.budgets.stageMs); this.owned(record, leases);
      if (leases.sourceLease !== binding.source.sourceLease || leases.connectionRevision !== binding.source.connectionRevision || leases.toolLease !== binding.tool.toolLease || leases.registryRevision !== binding.tool.registryRevision || leases.suiteSha256.toLowerCase() !== binding.tool.expectedSuiteSha256.toLowerCase() || leases.outputLease !== binding.output.outputLease || leases.outputRevision !== binding.output.revision) throw Error('源、工具或输出租约已改变');
      this.check(record); if (binding.plan.expiresAt <= this.ports.now()) throw Error('获取锁前备份计划已过期');
      phase = '获取实际锁'; const lock = await this.wait(record, phase, record.scope.acquireLock(record.controller.signal), Math.min(this.budgets.stageMs, binding.plan.lock.maxWaitMs)); this.owned(record, lock);
      if (!lock.lockId || lock.profileId !== binding.plan.lock.profileId || lock.sourceLease !== binding.source.sourceLease || lock.actualHeld !== true || lock.allObjectsFrozen !== true || !Number.isFinite(Date.parse(lock.acquiredAt))) throw Error('实际持锁证明不完整');
      const acquired = Date.parse(lock.acquiredAt); if (acquired > this.ports.now()) throw Error('实际锁时间不能晚于当前 owner 时钟');
      const remaining = () => Math.min(this.budgets.stageMs, binding.plan.lock.maxHoldMs - (this.ports.now() - acquired));
      const held = () => { this.check(record); if (remaining() <= 0) throw Error('实际持锁超出预算'); };
      held(); phase = '锁内重检'; const checked = await this.wait(record, phase, record.scope.inspectLocked(lock, record.controller.signal), remaining()); this.owned(record, checked); this.verifyLocked(binding, checked.source, checked.tool);
      // 固定本轮证据并只投影范围字段，后续端口不能借可变别名修改已经核准的 manifest。
      const source = structuredClone(checked.source), tool = structuredClone(checked.tool);
      source.objects = source.objects.map(({ kind, name, definitionSha256, engine }) => ({ kind, name, definitionSha256, ...(engine === undefined ? {} : { engine }) }));
      held(); phase = '打开归档'; await this.wait(record, phase, record.archive.open(), remaining());
      held(); phase = '启动原生 dump'; const dump = await this.wait(record, phase, record.scope.startDump(lock, record.controller.signal), remaining()); this.owned(record, dump);
      const hash = createHash('sha256'), iterator = dump.stdout[Symbol.asyncIterator](); let bytes = 0, chunks = 0;
      for (;;) {
        held(); phase = '读取原始 dump'; const next = await this.wait(record, phase, iterator.next(), remaining()); if (next.done) break;
        if (!(next.value instanceof Uint8Array) || next.value.byteLength > databaseBackupExecutionLimits.maxChunkBytes || ++chunks > databaseBackupExecutionLimits.maxChunks || bytes + next.value.byteLength > binding.plan.maxBytes) throw Error('dump 字节、片段或容量超出预算');
        for (let offset = 0; offset < next.value.byteLength; offset += 64 * 1024) {
          const piece = next.value.subarray(offset, offset + 64 * 1024);
          held(); phase = '背压写入 dump'; await this.wait(record, phase, record.archive.writeDump(piece), remaining()); hash.update(piece); bytes += piece.byteLength;
        }
      }
      held(); phase = '等待原生 exit'; const exit = await this.wait(record, phase, dump.exit, remaining()); this.owned(record, exit); if (exit.code !== 0 || exit.signal !== null) throw Error('原生 dump 未正常退出');
      if (!bytes) throw Error('原生 dump 为空，不能证明完整数据库备份');
      phase = '证明锁连续性'; const continuity = await this.wait(record, phase, record.scope.confirmContinuity(lock, dump), remaining()); this.owned(record, continuity); if (continuity.lockId !== lock.lockId || continuity.uninterrupted !== true) throw Error('实际 dump 窗口的锁连续性未知');
      held(); const stats = { bytes: String(bytes), sha256: hash.digest('hex') };
      phase = '资源关闭与释放确认'; await this.cleanupScope(record);
      if (!this.resourcesConfirmed(record) || record.failures.length || record.pending.size) throw Error('资源 close/unlock 终态尚未全部确认');
      this.check(record); phase = '生成 manifest';
      const manifest: DatabaseBackupManifest = { format: binding.plan.format, schemaVersion: 1, family: source.family, serverVersion: source.version, toolVersion: tool.version, toolSuiteSha256: tool.observedSuiteSha256, toolRegistryRevision: tool.registryRevision, database: source.database, objects: source.objects,
        dump: { entry: 'dump.sql', bytes: stats.bytes, sha256: stats.sha256 }, consistency: { profileId: lock.profileId, acquiredAt: lock.acquiredAt, completedAt: new Date(this.ports.now()).toISOString(), allObjectsFrozen: true }, externalDependencies: [], resourcesConfirmed: true, restoreVerified: false };
      const finalized = await this.wait(record, phase, record.archive.finish(structuredClone(manifest)), this.budgets.stageMs);
      if (finalized.dump.entry !== 'dump.sql' || finalized.dump.bytes !== stats.bytes || finalized.dump.sha256.toLowerCase() !== stats.sha256 || !/^[1-9]\d*$/.test(finalized.archive.bytes) || BigInt(finalized.archive.bytes) > BigInt(binding.plan.maxBytes) || !/^[a-f0-9]{64}$/i.test(finalized.archive.sha256) || finalized.manifest.resourcesConfirmed !== true || finalized.manifest.restoreVerified !== false) throw Error('归档端与原始 dump 或 manifest 摘要不一致');
      const returned = finalized.manifest;
      if (returned.format !== manifest.format || returned.schemaVersion !== 1 || returned.dump.entry !== 'dump.sql' || returned.dump.bytes !== stats.bytes || returned.dump.sha256 !== stats.sha256 || returned.database !== manifest.database || returned.family !== manifest.family || returned.serverVersion !== manifest.serverVersion || returned.toolVersion !== manifest.toolVersion || returned.toolSuiteSha256 !== manifest.toolSuiteSha256 || returned.toolRegistryRevision !== manifest.toolRegistryRevision || returned.consistency.profileId !== manifest.consistency.profileId || returned.consistency.acquiredAt !== manifest.consistency.acquiredAt || returned.consistency.completedAt !== manifest.consistency.completedAt || returned.consistency.allObjectsFrozen !== true || returned.externalDependencies.length || returned.objects.length !== manifest.objects.length || returned.objects.some((object, index) => { const expected = manifest.objects[index]; return object.kind !== expected.kind || object.name !== expected.name || object.definitionSha256 !== expected.definitionSha256 || object.engine !== expected.engine; })) throw Error('归档端改变了源范围、工具或一致性 manifest');
      record.archiveSummary = finalized.archive; record.validArchive = true;
      this.check(record); phase = '原子提交'; record.commitRequested = true;
      const committing = Promise.resolve().then(() => record.archive!.commit()).then(value => { record.commitSettled = true; return value; }, error => { record.commitSettled = true; throw error; });
      await this.wait(record, phase, committing, this.budgets.stageMs, false);
      const written = this.archiveState(record); if (!written?.fileCommitted || !record.commitStarted) { record.validArchive = false; throw Error('原子提交未提供边界或发布事实'); }
    } catch (error) { this.fail(record, phase, error, true); }
    if (record.failures.length && !this.archiveState(record)?.fileCommitted) {
      if (record.scope) { try { await this.requestStop(record); } catch (error) { this.fail(record, '停止失败 dump', error); } }
      await this.cleanupScope(record);
      if (record.archive && !record.commitStarted && (!record.commitRequested || record.commitSettled)) { try { const proof = await this.wait(record, '中止归档', record.archive.abort(), this.budgets.cleanupMs, false); this.owned(record, proof); if (proof.state !== 'confirmed') throw Error('归档中止终态未知'); record.archiveAbortConfirmed = true; } catch (error) { this.fail(record, '中止归档', error); } }
    }
    const resources = this.resourcesConfirmed(record) && record.pending.size === 0 && (!record.archive || this.archiveState(record)?.closed === true);
    if (resources) await this.releaseTarget(record);
    record.finished = true; record.result = this.result(record); return record.result;
  }
  /** 所有清理独立尝试；主错误不能遮掉 close、unlock 或工具清理错误。 */
  private async cleanupScope(record: RunRecord): Promise<void> {
    if (!record.scope || record.scopeCleanupAttempted) return;
    record.scopeCleanupAttempted = true;
    for (const [phase, operation] of [['关闭 dump', () => record.scope!.closeDump()], ['释放全局锁', () => record.scope!.unlock()], ['关闭工具资源', () => record.scope!.closeTools()]] as const) {
      try { const proof = await this.wait(record, phase, operation(), this.budgets.cleanupMs, false); this.owned(record, proof); if (proof.state !== 'confirmed') throw Error(`${phase}终态未知`); } catch (error) { this.fail(record, phase, error); }
    }
  }
  /** 锁内证据必须覆盖所有对象与权限，且不能悄悄更换实例、工具、定义或范围。 */
  private verifyLocked(binding: DatabaseBackupRunBindings, source: DatabaseBackupSourceEvidence, tool: DatabaseBackupRegisteredTool): void {
    const expected = binding.source;
    if (source.sourceLease !== expected.sourceLease || source.connectionRevision !== expected.connectionRevision || source.connectionId !== expected.connectionId || source.database !== expected.database || source.family !== expected.family || source.version !== expected.version || source.endpoint !== 'direct-pinned') throw Error('锁内源实例或版本已改变');
    if (databaseBackupKinds.some(kind => source.visibility[kind] !== 'proven' || source.lockCapability.ddlCoverage[kind] !== 'proven') || permissions.some(permission => source.permissions[permission] !== 'proven') || source.externalDependencies.length) throw Error('锁内完整范围、权限或依赖检查未通过');
    if (source.lockCapability.profileId !== binding.plan.lock.profileId || source.lockCapability.versionValidated !== source.version) throw Error('锁内能力证明与准确版本不符');
    const canonical = (value: DatabaseBackupSourceEvidence) => JSON.stringify(value.objects.map(item => { if (!item.definitionSha256) throw Error('锁内对象缺少定义'); return [item.kind, item.name, item.definitionSha256.toLowerCase(), item.engine ?? null]; }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if (canonical(source) !== canonical(expected)) throw Error('锁内对象范围或定义已改变');
    if (tool.registration !== 'root-controlled' || tool.id !== binding.tool.id || tool.family !== source.family || tool.version !== source.version || tool.toolLease !== binding.tool.toolLease || tool.registryRevision !== binding.tool.registryRevision || tool.expectedSuiteSha256.toLowerCase() !== binding.tool.expectedSuiteSha256.toLowerCase() || tool.observedSuiteSha256.toLowerCase() !== tool.expectedSuiteSha256.toLowerCase()) throw Error('锁内工具完整套件身份已改变');
  }
  /** 确认来自同一稳定 scope 的真实终态，而非请求发出或外观上的 closed 属性。 */
  private resourcesConfirmed(record: RunRecord): boolean {
    if (record.ownerMismatch) return false;
    if (!record.scope) return !record.archive;
    try { const state = record.scope.snapshot(); this.owned(record, state); return state.dumpClosed === true && state.lockReleased === true && state.toolsClosed === true; }
    catch (error) { if (!record.snapshotErrors.has('资源终态读取')) { record.snapshotErrors.add('资源终态读取'); this.fail(record, '资源终态读取', error); } return false; }
  }
  /** snapshot 失败同样是未知；保留已经观察到的提交事实，不触碰别的 owner 的归档。 */
  private archiveState(record: RunRecord): ReturnType<DatabaseBackupExecutionArchive['snapshot']> | undefined {
    if (!record.archive) return undefined;
    try { const state = record.archive.snapshot(); this.owned(record, state); record.fileCommittedSeen ||= state.fileCommitted; return { ...state, fileCommitted: record.fileCommittedSeen }; }
    catch (error) { if (!record.snapshotErrors.has('归档终态读取')) { record.snapshotErrors.add('归档终态读取'); this.fail(record, '归档终态读取', error); } return { owner: record.owner, fileCommitted: record.fileCommittedSeen, closed: false }; }
  }
  /** 已提交但摘要或边界未知时仍保留目标，不让后续任务覆盖现场。 */
  private async releaseTarget(record: RunRecord): Promise<void> {
    const file = this.archiveState(record);
    if (record.archive && !file?.fileCommitted && !record.archiveAbortConfirmed) return;
    if (file?.fileCommitted && (!record.validArchive || !record.commitStarted || !record.commitSettled || file.bytes !== record.archiveSummary?.bytes || file.sha256 !== record.archiveSummary?.sha256)) return;
    if (!record.target) return;
    try { const proof = await this.wait(record, '释放目标占用', record.target.release(), this.budgets.cleanupMs, false); this.owned(record, proof); if (proof.state !== 'confirmed') throw Error('目标释放未知'); record.target = undefined; } catch (error) { this.fail(record, '释放目标占用', error); }
  }
  /** 每次读取都活读文件提交事实；commit 超时后晚到的 rename 不能被缓存为未提交。 */
  private result(record: RunRecord): DatabaseBackupRunResult {
    const file = this.archiveState(record), committed = file?.fileCommitted === true;
    const resources = this.resourcesConfirmed(record) && !record.pending.size && !record.target && (!record.archive || (file?.closed === true && (committed || record.archiveAbortConfirmed === true)));
    if (!resources || (committed && (!record.validArchive || !file?.artifactToken || file.bytes !== record.archiveSummary?.bytes || file.sha256 !== record.archiveSummary?.sha256))) return { state: 'retained-unknown', fileCommitted: committed, resources: 'unknown', restoreVerified: false, ...(committed ? { artifactToken: file?.artifactToken, bytes: file?.bytes, sha256: file?.sha256 } : {}) };
    if (committed) return { state: 'completed', artifactToken: file!.artifactToken!, bytes: file!.bytes!, sha256: file!.sha256!, fileCommitted: true, resources: 'confirmed', restoreVerified: false };
    return { state: record.cancelled ? 'cancelled' : 'failed', fileCommitted: false, resources: 'confirmed', restoreVerified: false };
  }
  /** 私有诊断保留准确句柄及主副原错误；Root 必须脱敏后再做 IPC 或日志输出。 */
  retained(taskId: string) { const record = this.tasks.get(taskId); return record ? { owner: record.owner, scope: record.scope, archive: record.archive, target: record.target, pending: record.pending.size, failures: [...record.failures], result: this.result(record) } : null; }
  /** 只有显式恢复动作才重新观察/清理原句柄；不重新领取计划，不启动 dump 或执行 SQL。 */
  recover(taskId: string): Promise<DatabaseBackupRunResult> {
    const record = this.tasks.get(taskId); if (!record || !record.finished) return Promise.reject(Error('任务未到可恢复终态'));
    if (record.recovering) return record.recovering;
    const operation = (async () => {
      if (record.pending.size || record.ownerMismatch) return this.result(record);
      record.scopeCleanupAttempted = false; await this.cleanupScope(record);
      if (!this.archiveState(record)?.fileCommitted && (!record.commitRequested || record.commitSettled) && record.archive) {
        try { const proof = await this.wait(record, '显式中止原归档', record.archive.abort(), this.budgets.cleanupMs, false); this.owned(record, proof); if (proof.state !== 'confirmed') throw Error('原归档仍未知'); record.archiveAbortConfirmed = true; } catch (error) { this.fail(record, '显式中止原归档', error); }
      }
      if (this.resourcesConfirmed(record) && !record.pending.size && (!record.archive || this.archiveState(record)?.closed === true)) await this.releaseTarget(record);
      return record.result = this.result(record);
    })();
    record.recovering = operation; void operation.finally(() => { if (record.recovering === operation) record.recovering = undefined; }); return operation;
  }
}
