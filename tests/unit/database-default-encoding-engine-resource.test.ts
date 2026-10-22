import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext, StructureTaskOptions } from '../../src/engine/structureDefinition';
import { ConnectionResourceOwner } from '../../src/engine/connectionResourceState';
import { IndependentTaskResources } from '../../src/engine/independentTaskResources';
const ports = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: ports.connect, execute: ports.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'database-default-resources', name: '仅RAM资源证明', group: '', color: '', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'RAM用户' };
/** 手动原Promise用于观察真实host等待，不以经过时间充当物理结束。 */
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
/** 真实物理资源证明器观察独立close事实，close返回本身不能伪造终态。 */
function physical(knownClose = true, closeFailure = false) {
  const stream = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const closed = () => { stream.closed = true; stream.emit('close'); };
  const connection = Object.assign(new EventEmitter(), { threadId: 42, destroy: vi.fn(closed) });
  const owner = new ConnectionResourceOwner(() => stream, connection.destroy, 20); owner.captureTransport(true); owner.seal(); stream.destroy.mockImplementation(closed);
  const managed = { connection, profile, broken: false, resources: owner.recovery, close: vi.fn(async () => { if (knownClose) closed(); if (closeFailure) throw Error('RAM严格关闭失败'); }), status: { dialect: 'mysql', version: '8.4.11' } } as unknown as ManagedConnection;
  return { stream, connection, owner, managed, closed };
}
function fixture() {
  const events: TaskEvent[] = [], engine = new Engine(event => events.push(event)); Reflect.get(engine, 'profiles').set(profile.id, profile);
  const callback = vi.fn(), options: StructureTaskOptions = { purpose: 'databaseDefaultEncoding', label: 'RAM数据库属性', executionTarget: { database: 'isolated', table: '__database_encoding__' }, progress: { phase: 'executing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }, onResourcesReleased: callback };
  const run = (id: string, action: (managed: ManagedConnection, context: Omit<StructureTaskContext, 'managed'>) => Promise<unknown> = async () => 'RAM结果', useOptions = options, connectionId = profile.id): Promise<unknown> => Reflect.get(engine, 'withIndependentTask').call(engine, connectionId, id, action, useOptions);
  return { engine, events, callback, options, run };
}
beforeEach(() => { ports.connect.mockReset(); ports.execute.mockReset(); });

describe('数据库默认编码真实Engine独立任务资源回执', () => {
  it('真实Engine四命令注册保持修订透传，closing仅允许纯内存释放', async () => {
    const f = fixture(), service = Reflect.get(f.engine, 'databaseDefaultEncodings'), calls: unknown[] = [];
    for (const command of ['get', 'preview', 'apply'] as const) {
      const method = vi.spyOn(service, command).mockImplementation(async (...args: unknown[]) => { calls.push(args); return { routed: command }; });
      const input = { connectionId: profile.id, connectionRevision: 7, taskId: 'route-' + command };
      await expect(f.engine.handle('schema.databaseDefaultEncoding.' + command as any, input)).resolves.toEqual({ routed: command }); expect(calls.at(-1)).toEqual([input, 7]); method.mockRestore();
    }
    Reflect.set(f.engine, 'closing', true); const release = vi.spyOn(service, 'releaseTokens');
    await expect(f.engine.handle('schema.databaseDefaultEncoding.release', { snapshotId: 'absent', previewToken: 'also-absent' })).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledExactlyOnceWith({ snapshotId: 'absent', previewToken: 'also-absent' });
    await expect(f.engine.handle('schema.databaseDefaultEncoding.get', { connectionId: profile.id, taskId: 'closing', connectionRevision: 7 })).rejects.toThrow(); expect(ports.connect).not.toHaveBeenCalled();
  });

  it('正常严格close观察真实流关闭才回调，并按新用途发送独立进度', async () => {
    const f = fixture(), item = physical(); ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(item.owner.recovery); return item.managed; });
    await expect(f.run('known')).resolves.toBe('RAM结果');
    expect(f.callback).toHaveBeenCalledOnce(); expect(item.managed.close).toHaveBeenCalledExactlyOnceWith({ strict: true });
    expect(f.events.at(-1)).toMatchObject({ taskId: 'known', status: 'completed', databaseDefaultEncoding: { phase: 'releasing' } });
    expect(f.events.at(-1)?.columnPatch).toBeUndefined(); expect(Reflect.get(f.engine, 'independentResources').owns('known')).toBe(false);
  });

  it('close正常返回但原流未关绝不回调，任务号与目标隔离仍保留', async () => {
    const f = fixture(), item = physical(false); ports.connect.mockResolvedValueOnce(item.managed);
    await expect(f.run('unknown')).rejects.toThrow('物理资源尚未确认');
    expect(f.callback).not.toHaveBeenCalled(); expect(Reflect.get(f.engine, 'independentResources').owns('unknown')).toBe(true);
    expect(() => Reflect.get(f.engine, 'structureExecutions').acquire(profile.id, [f.options.executionTarget])).toThrow();
    item.closed(); await f.engine.handle('connections.close', { id: profile.id }); expect(Reflect.get(f.engine, 'independentResources').owns('unknown')).toBe(false);
    expect(f.callback).not.toHaveBeenCalled(); expect(ports.connect).toHaveBeenCalledOnce();
  });

  it('动作失败不妨碍已证明空资源回调，原动作错误保持', async () => {
    const f = fixture(), item = physical(), failure = Error('RAM动作失败'); ports.connect.mockResolvedValueOnce(item.managed);
    await expect(f.run('action-error', async () => { throw failure; })).rejects.toBe(failure);
    expect(f.callback).toHaveBeenCalledOnce(); expect(f.events.at(-1)).toMatchObject({ status: 'failed', databaseDefaultEncoding: { ddlSubmitted: false } });
  });

  it('建连抛错但真实封账facade确认无分配，仍回调并释放编号', async () => {
    const f = fixture(), owner = new ConnectionResourceOwner(() => undefined, () => {}, 20), failure = Error('网络分配前失败'); owner.seal();
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(owner.recovery); throw failure; });
    await expect(f.run('empty-connect')).rejects.toBe(failure);
    expect(owner.recovery.snapshot().confirmedClosed).toBe(true); expect(f.callback).toHaveBeenCalledOnce(); expect(Reflect.get(f.engine, 'independentResources').owns('empty-connect')).toBe(false);
  });

  it('建连失败仍有未回调分配即未知，不能回调或提前释放原任务', async () => {
    const f = fixture(), owner = new ConnectionResourceOwner(() => undefined, () => {}, 20), allocated = owner.beginAllocation(), failure = Error('原分配回调未结束'); owner.seal();
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(owner.recovery); throw failure; });
    await expect(f.run('pending-allocation')).rejects.toBe(failure);
    expect(f.callback).not.toHaveBeenCalled(); expect(Reflect.get(f.engine, 'independentResources').owns('pending-allocation')).toBe(true);
    allocated(); await f.engine.handle('connections.close', { id: profile.id }); expect(Reflect.get(f.engine, 'independentResources').owns('pending-allocation')).toBe(false); expect(f.callback).not.toHaveBeenCalled();
  });

  it.each(['closing', 'profile', 'duplicate', 'target-lock'] as const)('预留前%s拒绝证明未分配，只回调新用途，不触发connect', async mode => {
    const f = fixture(); let release: (() => void) | undefined;
    if (mode === 'closing') Reflect.set(f.engine, 'closing', true);
    if (mode === 'profile') Reflect.get(f.engine, 'profiles').delete(profile.id);
    if (mode === 'duplicate') Reflect.get(f.engine, 'tasks').set('early', {});
    if (mode === 'target-lock') release = Reflect.get(f.engine, 'structureExecutions').acquire(profile.id, [f.options.executionTarget]);
    await expect(f.run('early')).rejects.toThrow(); expect(f.callback).toHaveBeenCalledOnce(); expect(ports.connect).not.toHaveBeenCalled(); release?.();
    const old = fixture(); Reflect.set(old.engine, 'closing', true);
    await expect(old.run('old-purpose', undefined, { ...old.options, purpose: 'tableDefaultEncoding' })).rejects.toThrow(); expect(old.callback).not.toHaveBeenCalled();
  });

  it('资源容量预留失败归还本次新目标，回调不释放既有未知资源', async () => {
    const f = fixture(), item = physical(false); Reflect.set(f.engine, 'independentResources', new IndependentTaskResources(1)); ports.connect.mockResolvedValueOnce(item.managed);
    await expect(f.run('first')).rejects.toThrow('物理资源尚未确认'); expect(f.callback).not.toHaveBeenCalled();
    const secondCallback = vi.fn(), options = { ...f.options, executionTarget: { database: 'isolated', table: '__other__' }, onResourcesReleased: secondCallback };
    await expect(f.run('second', undefined, options)).rejects.toThrow('上限'); expect(secondCallback).toHaveBeenCalledOnce(); expect(f.callback).not.toHaveBeenCalled(); expect(ports.connect).toHaveBeenCalledOnce();
    const release = Reflect.get(f.engine, 'structureExecutions').acquire(profile.id, [options.executionTarget]); release(); item.closed(); await f.engine.handle('connections.close', { id: profile.id });
  });

  it('真实query.cancel原KILL已ACK仍等待原命令及控制close，不提前回调或释放', async () => {
    const f = fixture(), main = physical(), control = physical(), killAck = deferred(), command = deferred(), close = deferred(), entered = deferred();
    control.managed.close = vi.fn(async () => { await close.promise; control.closed(); });
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(main.owner.recovery); return main.managed; }).mockImplementationOnce((_p, _d, _s, capture) => { capture(control.owner.recovery); return control.managed; });
    ports.execute.mockImplementationOnce(async () => { await killAck.promise; return { rows: [] }; });
    const operation = f.run('cancel-pending', async (_managed, context) => { const ended = context.commandStarted(); entered.resolve(); await command.promise; ended(); throw Error('RAM原命令被停止'); });
    const operationResult = operation.catch(error => error); await entered.promise;
    const cancel = f.engine.handle('query.cancel', { taskId: 'cancel-pending' }); await flush(); killAck.resolve(); await flush();
    expect(f.callback).not.toHaveBeenCalled(); expect(main.managed.close).not.toHaveBeenCalled(); expect(control.managed.close).not.toHaveBeenCalled();
    expect(Reflect.get(f.engine, 'independentResources').owns('cancel-pending')).toBe(true);
    command.resolve(); await flush(); expect(control.managed.close).toHaveBeenCalledOnce(); expect(f.callback).not.toHaveBeenCalled(); expect(main.managed.close).not.toHaveBeenCalled();
    close.resolve(); await cancel; expect(await operationResult).toBeInstanceOf(Error);
    expect(f.callback).toHaveBeenCalledOnce(); expect(main.managed.close).toHaveBeenCalledOnce(); expect(Reflect.get(f.engine, 'independentResources').owns('cancel-pending')).toBe(false);
    expect(ports.execute).toHaveBeenCalledExactlyOnceWith(control.managed, 'KILL CONNECTION 42'); expect(ports.connect).toHaveBeenCalledTimes(2);
  });

  it('cancel控制连接资源未知即不回调，原主流关闭也不能覆盖未知控制句柄', async () => {
    const f = fixture(), main = physical(), control = physical(false), entered = deferred(), action = deferred();
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(main.owner.recovery); return main.managed; }).mockImplementationOnce((_p, _d, _s, capture) => { capture(control.owner.recovery); return control.managed; });
    ports.execute.mockResolvedValueOnce({ rows: [] });
    const operation = f.run('control-unknown', async (_managed, context) => { const ended = context.commandStarted(); entered.resolve(); await action.promise; ended(); throw Error('原命令结束'); }).catch(error => error);
    await entered.promise; const cancel = f.engine.handle('query.cancel', { taskId: 'control-unknown' }); await flush(); action.resolve(); await cancel; expect(await operation).toBeInstanceOf(Error);
    expect(main.owner.recovery.snapshot().confirmedClosed).toBe(true); expect(control.owner.recovery.snapshot().confirmedClosed).toBe(false); expect(f.callback).not.toHaveBeenCalled(); expect(Reflect.get(f.engine, 'independentResources').owns('control-unknown')).toBe(true);
    control.closed(); await f.engine.handle('connections.close', { id: profile.id });
  });

  it('原未知任务已结算后显式断开以真实facade恢复成功才重置该连接隔离，其它连接断开不影响它', async () => {
    const f = fixture(), item = physical(false), service = Reflect.get(f.engine, 'databaseDefaultEncodings');
    const reset = vi.spyOn(service, 'releaseConnection'), leases: Map<string, { connectionId: string }> = Reflect.get(service, 'executing');
    leases.set('original-database', { connectionId: profile.id }); leases.set('other-database', { connectionId: 'other-connection' });
    ports.connect.mockResolvedValueOnce(item.managed);
    await expect(f.run('reset-original')).rejects.toThrow('物理资源尚未确认');
    expect(Reflect.get(f.engine, 'independentTasks').has('reset-original')).toBe(false); expect(reset).not.toHaveBeenCalled(); expect(item.owner.recovery.snapshot().confirmedClosed).toBe(false);
    await f.engine.handle('connections.close', { id: 'other-connection' });
    expect(leases.has('original-database')).toBe(true); expect(leases.has('other-database')).toBe(false); expect(Reflect.get(f.engine, 'independentResources').owns('reset-original')).toBe(true);
    reset.mockClear(); await f.engine.handle('connections.close', { id: profile.id });
    expect(item.owner.recovery.snapshot().confirmedClosed).toBe(true); expect(reset).toHaveBeenCalledExactlyOnceWith(profile.id); expect(leases.has('original-database')).toBe(false);
    expect(Reflect.get(f.engine, 'independentResources').owns('reset-original')).toBe(false); expect(f.callback).not.toHaveBeenCalled(); expect(ports.connect).toHaveBeenCalledOnce();
  });

  it('原操作已结算但真实恢复仍有剩余资源，绝不重置；后续原流可证关闭才允许重试断开', async () => {
    const f = fixture(), item = physical(false), service = Reflect.get(f.engine, 'databaseDefaultEncodings'), reset = vi.spyOn(service, 'releaseConnection');
    item.connection.destroy.mockImplementation(() => {}); item.stream.destroy.mockImplementation(() => {}); ports.connect.mockResolvedValueOnce(item.managed);
    await expect(f.run('reset-unknown')).rejects.toThrow('物理资源尚未确认');
    expect(Reflect.get(f.engine, 'independentTasks').has('reset-unknown')).toBe(false);
    await expect(f.engine.handle('connections.close', { id: profile.id })).rejects.toThrow('资源尚未确认');
    expect(reset).not.toHaveBeenCalled(); expect(item.owner.recovery.snapshot().confirmedClosed).toBe(false); expect(Reflect.get(f.engine, 'independentResources').owns('reset-unknown')).toBe(true);
    item.stream.destroy.mockImplementation(item.closed); await f.engine.handle('connections.close', { id: profile.id });
    expect(reset).toHaveBeenCalledExactlyOnceWith(profile.id); expect(item.owner.recovery.snapshot().confirmedClosed).toBe(true); expect(ports.connect).toHaveBeenCalledOnce();
  });

  it('资源恢复成功但同次取消清理明确失败仍不重置，不将物理终态替代完整关闭成功', async () => {
    const f = fixture(), item = physical(false), service = Reflect.get(f.engine, 'databaseDefaultEncodings'), reset = vi.spyOn(service, 'releaseConnection');
    ports.connect.mockResolvedValueOnce(item.managed); await expect(f.run('reset-cancel-error')).rejects.toThrow('物理资源尚未确认');
    expect(Reflect.get(f.engine, 'independentTasks').has('reset-cancel-error')).toBe(false);
    // 只注入关闭的取消边界错误；原任务与真实资源恢复仍执行生产实现。
    const cancellationError = Error('RAM比较取消清理失败'), comparison = vi.spyOn(Reflect.get(f.engine, 'schemaComparisons'), 'close').mockRejectedValueOnce(cancellationError);
    await expect(f.engine.handle('connections.close', { id: profile.id })).rejects.toBe(cancellationError);
    expect(item.owner.recovery.snapshot().confirmedClosed).toBe(true); expect(Reflect.get(f.engine, 'independentResources').owns('reset-cancel-error')).toBe(false); expect(reset).not.toHaveBeenCalled();
    comparison.mockRestore(); await f.engine.handle('connections.close', { id: profile.id }); expect(reset).toHaveBeenCalledExactlyOnceWith(profile.id); expect(ports.connect).toHaveBeenCalledOnce();
  });
});
