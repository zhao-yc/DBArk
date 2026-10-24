import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ResultInsertHost } from '../../src/engine/resultInsert';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import type { ResultInsertProgress, ResultInsertTarget } from '../../src/shared/resultInsert';

const ports = vi.hoisted(() => ({ connect: vi.fn(), action: vi.fn(), release: vi.fn(), close: vi.fn() }));
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: ports.connect }));
/** 只替换用途动作；本文件验真实Engine的目标锁、取消、严格物理收尾与可信输入门。 */
vi.mock('../../src/engine/resultInsert', () => ({ ResultInsertTasks: class {
  constructor(private readonly host: ResultInsertHost) {}
  preview(input: any) { return this.execute(input, false); }
  apply(input: any) { return this.execute(input, true); }
  private execute(input: any, execution: boolean) {
    const target = { connectionId: input.connectionId, database: 'db', table: 'target' };
    const progress: ResultInsertProgress = { phase: 'preparing', rows: 0, totalRows: 1, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent' };
    return this.host.run(target, input.taskId, context => ports.action(context, progress, target), progress, execution);
  }
  release(input: unknown) { return ports.release(input); }
  releaseConnection(id: string) { ports.release(id); }
  close() { ports.close(); }
} }));
import { Engine } from '../../src/engine/index';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
const profile: ConnectionProfile = { id: 'target', name: 'RAM', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'synthetic', color: '#123456', group: '' };
let engine: Engine, trace: string[], events: TaskEvent[], closeGate: ReturnType<typeof deferred> | undefined, onKill: (() => void) | undefined;
const request = (taskId = randomUUID()) => engine.handle('result.insertApply', { connectionId: 'target', taskId, previewToken: randomUUID(), confirmation: 'db.target', acknowledged: true, profile, connectionRevision: 4 });
beforeEach(() => {
  trace = []; events = []; closeGate = undefined; onKill = undefined; ports.release.mockReset(); ports.close.mockReset();
  ports.connect.mockReset().mockImplementation(async (_profile, _database, signal) => ({ profile, signal, broken: false, status: { dialect: 'mysql', version: '8.4.11' }, connection: { threadId: 42, query(sql: string, callback: (error: null, value: any) => void) { trace.push(sql); if (sql.startsWith('KILL')) onKill?.(); callback(null, { affectedRows: 0, warningStatus: 0, serverStatus: 2 }); } }, async close(options?: { strict?: boolean }) { trace.push(options?.strict ? 'strict-close-start' : 'close-start'); await closeGate?.promise; trace.push('close-end'); } } as unknown as ManagedConnection));
  ports.action.mockReset().mockImplementation(async (_context: StructureTaskContext, progress: ResultInsertProgress, target: ResultInsertTarget) => { progress.commitMayHaveBeenSent = progress.commitAcknowledged = true; progress.outcome = 'committed'; return { target, rows: 1, outcome: 'committed', commitAcknowledged: true }; });
  engine = new Engine(event => events.push(event));
});
describe('结果写入真实Engine宿主的生命周期', () => {
  it('可信配置与修订缺失在网络前拒绝；release不解析凭据或新连接', async () => {
    await expect(engine.handle('result.insertApply', { connectionId: 'target', taskId: randomUUID() })).rejects.toThrow('可信');
    await expect(engine.handle('result.insertApply', { connectionId: 'target', profile, connectionRevision: -1 })).rejects.toThrow('修订'); expect(ports.connect).not.toHaveBeenCalled();
    const input = { connectionId: 'target', previewToken: randomUUID() }; await engine.handle('result.insertRelease', input); expect(ports.release).toHaveBeenCalledWith(input); expect(ports.connect).not.toHaveBeenCalled();
    await engine.closeAll(); await engine.handle('result.insertRelease', input); expect(ports.connect).not.toHaveBeenCalled();
  });
  it('已发COMMIT的取消等待原动作及strictclose，不新建KILL连接', async () => {
    const wait = deferred(), entered = deferred(); closeGate = deferred(); let cancellationDone = false;
    ports.action.mockImplementationOnce(async (_context, progress, target) => { progress.commitMayHaveBeenSent = true; entered.resolve(); await wait.promise; progress.commitAcknowledged = true; progress.outcome = 'committed'; return { target, rows: 1, outcome: 'committed', commitAcknowledged: true }; });
    const taskId = randomUUID(), pending = request(taskId); await entered.promise;
    const cancellation = engine.handle('query.cancel', { taskId }).then(() => { cancellationDone = true; }); await Promise.resolve(); expect(cancellationDone).toBe(false); expect(ports.connect).toHaveBeenCalledTimes(1);
    wait.resolve(); await vi.waitFor(() => expect(trace).toContain('strict-close-start')); expect(cancellationDone).toBe(false); closeGate.resolve();
    await expect(pending).resolves.toMatchObject({ commitAcknowledged: true }); await cancellation; expect(trace.some(value => value.startsWith('KILL'))).toBe(false); expect(events.at(-1)?.resultInsert?.commitAcknowledged).toBe(true); await engine.closeAll();
  });
  it('目标表及库锁保持到真实close返回；不同任务不能绕过，结束后释放', async () => {
    closeGate = deferred(); const pending = request(); await vi.waitFor(() => expect(trace).toContain('strict-close-start'));
    await expect(request()).rejects.toThrow('结构变更'); expect(ports.connect).toHaveBeenCalledTimes(1);
    const locks = (engine as any).structureExecutions; expect(() => locks.acquireDatabase('target', 'db')).toThrow();
    await expect(engine.handle('__connections.prepareSave', { id: 'target', profile: { ...profile, host: 'other.invalid' }, transportChanged: true })).rejects.toThrow('正在执行');
    closeGate.resolve(); await pending; const unlock = locks.acquireDatabase('target', 'db'); unlock(); await engine.closeAll();
  });
  it('提交前取消只KILL原连接，并等待命令终态及原close', async () => {
    const entered = deferred(), taskId = randomUUID();
    ports.action.mockImplementationOnce(async (context: StructureTaskContext) => { const finish = context.commandStarted(); entered.resolve(); try { await new Promise<void>((_yes, no) => { onKill = () => no(Error('原动作取消')); }); } finally { finish(); } });
    const pending = request(taskId), rejected = expect(pending).rejects.toThrow('取消'); await entered.promise;
    await engine.handle('query.cancel', { taskId }); await rejected;
    expect(trace.filter(value => value.startsWith('KILL'))).toEqual(['KILL CONNECTION 42']); expect(ports.connect).toHaveBeenCalledTimes(2); expect(events.at(-1)?.status).toBe('cancelled'); await engine.closeAll();
  });
  it('退出在COMMIT期间等待真实结果，原动作不可重放', async () => {
    const wait = deferred(), entered = deferred(); let exited = false;
    ports.action.mockImplementationOnce(async (_context, progress, target) => { progress.commitMayHaveBeenSent = true; entered.resolve(); await wait.promise; progress.commitAcknowledged = true; progress.outcome = 'committed'; return { target, rows: 1, outcome: 'committed', commitAcknowledged: true }; });
    const pending = request(); await entered.promise; const closing = engine.closeAll().then(() => { exited = true; }); await Promise.resolve(); expect(exited).toBe(false);
    wait.resolve(); await pending; await closing; expect(ports.action).toHaveBeenCalledTimes(1); expect(ports.close).toHaveBeenCalledTimes(1); expect(events.at(-1)?.resultInsert?.outcome).toBe('committed');
  });
});
