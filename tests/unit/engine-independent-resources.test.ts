import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskOptions, StructureTaskContext } from '../../src/engine/structureDefinition';
import { ConnectionResourceOwner } from '../../src/engine/connectionResourceState';
import { IndependentTaskResources } from '../../src/engine/independentTaskResources';
const ports = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: ports.connect, execute: ports.execute }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'resource-connection', name: 'RAM归属', group: '', color: '', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'RAM用户' };

/** close失败与流终态独立，只有真实资源证明器观察到close才允许释放。 */
function physical(failClose: boolean) {
  const stream = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const closed = () => { stream.closed = true; stream.emit('close'); };
  const connection = Object.assign(new EventEmitter(), { threadId: 42, destroy: vi.fn(closed) });
  const owner = new ConnectionResourceOwner(() => stream, connection.destroy, 20); owner.captureTransport(true); owner.seal(); stream.destroy.mockImplementation(closed);
  const managed = { connection, profile, broken: false, resources: owner.recovery, close: vi.fn(async () => { if (failClose) throw Error('RAM关闭错误'); closed(); }), status: { dialect: 'mysql' } } as unknown as ManagedConnection;
  return { managed, owner, stream, closed };
}
function engine() { const events: TaskEvent[] = [], value = new Engine(event => events.push(event)); Reflect.get(value, 'profiles').set(profile.id, profile); return { value, events }; }
/** 运行真实独立host；只用受控动作代替数据库DDL，全部执行/资源/关闭路径仍为产品实现。 */
function run(value: Engine, id: string, action: (managed: ManagedConnection, control: Omit<StructureTaskContext, 'managed'>) => Promise<unknown>, tables: string[] = ['child', 'parent']): Promise<unknown> {
  const options: StructureTaskOptions = { label: 'RAM独立变更', purpose: 'indexes', executionTargets: tables.map(table => ({ database: 'ram_db', table })), progress: { phase: 'executing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } };
  return Reflect.get(value, 'withIndependentTask').call(value, profile.id, id, action, options);
}
function assertTargetHeld(value: Engine, table: string) { expect(() => Reflect.get(value, 'structureExecutions').acquire(profile.id, [{ database: 'ram_db', table }])).toThrow('结构变更'); }
beforeEach(() => { ports.connect.mockReset(); ports.execute.mockReset(); });

describe('Engine独立动作与物理资源分开结算', () => {
  it('1062和close双失败仍返回原1062，释放动作等待者但保留任务号及全部目标，显式断开才回收', async () => {
    const { value } = engine(), item = physical(true), duplicate = Object.assign(Error('RAM重复键'), { errno: 1062 }), action = vi.fn(async () => { throw duplicate; });
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(item.owner.recovery); return item.managed; });
    await expect(run(value, 'original', action)).rejects.toBe(duplicate);
    expect(Reflect.get(value, 'independentTasks').size).toBe(0); expect(Reflect.get(value, 'pendingUses').size).toBe(0); expect(Reflect.get(value, 'independentResources').owns('original')).toBe(true);
    assertTargetHeld(value, 'child'); assertTargetHeld(value, 'parent');
    await expect(run(value, 'original', vi.fn(async () => {}), ['other'])).rejects.toThrow('任务编号');
    await expect(value.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'changed.invalid' }, transportChanged: true })).rejects.toThrow('待确认');
    await value.handle('connections.close', { id: profile.id });
    expect(Reflect.get(value, 'independentResources').owns('original')).toBe(false); expect(item.managed.close).toHaveBeenCalledOnce(); expect(item.managed.connection.destroy).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledOnce();
    const release = Reflect.get(value, 'structureExecutions').acquire(profile.id, [{ database: 'ram_db', table: 'child' }, { database: 'ram_db', table: 'parent' }]); release(); expect(ports.connect).toHaveBeenCalledOnce(); expect(ports.execute).not.toHaveBeenCalled();
  });
  it('close失败但全部物理资源独立已证关闭时正常释放目标，仍保留原动作失败', async () => {
    const { value } = engine(), item = physical(true), duplicate = Object.assign(Error('RAM重复键'), { errno: 1062 }); item.closed();
    ports.connect.mockResolvedValueOnce(item.managed); await expect(run(value, 'closed', async () => { throw duplicate; })).rejects.toBe(duplicate);
    expect(Reflect.get(value, 'independentResources').owns('closed')).toBe(false); const release = Reflect.get(value, 'structureExecutions').acquire(profile.id, [{ database: 'ram_db', table: 'parent' }]); release(); expect(item.managed.connection.destroy).not.toHaveBeenCalled();
  });
  it('建连分配后尚未返回ManagedConnection即失败，原facade仍能由closeAll显式回收', async () => {
    const { value } = engine(), item = physical(true), action = vi.fn(async () => {}), allocationError = Error('RAM分配后失败');
    ports.connect.mockImplementationOnce((_p, _d, _s, capture) => { capture(item.owner.recovery); throw allocationError; });
    await expect(run(value, 'allocation', action)).rejects.toBe(allocationError); assertTargetHeld(value, 'parent'); expect(action).not.toHaveBeenCalled();
    await value.closeAll(); expect(item.managed.connection.destroy).toHaveBeenCalledOnce(); expect(item.managed.close).not.toHaveBeenCalled(); expect(Reflect.get(value, 'independentResources').owns('allocation')).toBe(false); expect(ports.connect).toHaveBeenCalledOnce();
  });
  it('容量耗尽在下一次网络分配前拒绝，并归还本次新取得的目标锁', async () => {
    const { value } = engine(), item = physical(true); Reflect.set(value, 'independentResources', new IndependentTaskResources(1)); ports.connect.mockResolvedValueOnce(item.managed);
    await expect(run(value, 'first', async () => {})).rejects.toThrow('关闭失败');
    const action = vi.fn(async () => {}); await expect(run(value, 'second', action, ['other'])).rejects.toThrow('上限'); expect(action).not.toHaveBeenCalled(); expect(ports.connect).toHaveBeenCalledOnce();
    const release = Reflect.get(value, 'structureExecutions').acquire(profile.id, [{ database: 'ram_db', table: 'other' }]); release(); await value.handle('connections.close', { id: profile.id });
  });
  it('取消控制连接分配后失败也登记原facade，不因主流已关漏掉控制资源', async () => {
    const { value } = engine(), main = physical(false), control = physical(true);
    ports.connect.mockImplementationOnce((_p, _d, signal, capture) => { main.managed.signal = signal; capture(main.owner.recovery); return main.managed; })
      .mockImplementationOnce((_p, _d, _s, capture) => { capture(control.owner.recovery); throw Error('RAM控制连接分配后失败'); });
    const read = run(value, 'cancelled', (managed, context) => new Promise((_resolve, reject) => {
      const finished = context.commandStarted(); managed.signal!.addEventListener('abort', () => { finished(); reject(Error('RAM原命令中止')); }, { once: true });
    })).catch(error => error);
    await vi.waitFor(() => expect(Reflect.get(value, 'independentTasks').get('cancelled')?.commandInFlight).toBe(true));
    await expect(value.handle('query.cancel', { taskId: 'cancelled' })).rejects.toThrow('取消控制连接失败'); expect(await read).toBeInstanceOf(Error);
    expect(main.owner.recovery.snapshot().confirmedClosed).toBe(true); expect(control.owner.recovery.snapshot().confirmedClosed).toBe(false); expect(Reflect.get(value, 'independentResources').owns('cancelled')).toBe(true); assertTargetHeld(value, 'parent');
    await value.handle('connections.close', { id: profile.id }); expect(control.managed.connection.destroy).toHaveBeenCalledOnce(); expect(control.managed.close).not.toHaveBeenCalled(); expect(Reflect.get(value, 'independentResources').owns('cancelled')).toBe(false); expect(ports.connect).toHaveBeenCalledTimes(2); expect(ports.execute).not.toHaveBeenCalled();
  });
});
