import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext, StructureTaskOptions } from '../../src/engine/structureDefinition';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => mocks);
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'late-cancel', name: '关闭竞态单元', group: '', color: '#123456', dialect: 'mysql', host: 'unit.invalid', port: 3306, user: 'test' };
interface TaskHost {
  withIndependentTask<T>(connectionId: string, taskId: string, action: (managed: ManagedConnection, control: Omit<StructureTaskContext, 'managed'>) => Promise<T>, options: StructureTaskOptions): Promise<T>;
}

/** 明确放行哪个生命周期阶段，不以固定睡眠推测数据库或事件循环的速度。 */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
/** 仅等待当前事件循环内已就绪的 Promise 续体排空，不引入毫秒级竞态窗口。 */
async function turn(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
/** 同时记录完成时机与错误，提前挂接拒绝处理器，失败断言也不会产生未处理拒绝。 */
function observe<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  const done = promise.then(value => { state.settled = true; state.value = value; }, error => { state.settled = true; state.error = error; });
  return { state, done };
}
/** 使用已有单表 executionTarget 接口，使关闭竞态反例也适用于 0.9 的生命周期。 */
function options(): StructureTaskOptions {
  return { label: '结构关闭回归', purpose: 'indexes', executionTarget: { database: 'db', table: 't' }, progress: { phase: 'reading', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } };
}

/** 只替换驱动连接及系统关闭边界，运行实际 Engine 的登记、互斥、取消和退出路径。 */
async function fixture(controlStage: 'connect' | 'close') {
  const actionGate = gate(), originalCloseGate = gate(), controlConnectGate = gate(), controlCloseGate = gate();
  const originalCloseEntered = gate(), actionEntered = gate();
  const connections: ManagedConnection[] = [], controls: ManagedConnection[] = [];
  const sent: { sql: string; originalAlreadyClosed: boolean }[] = [];
  let originalClosed = false, originalChosen = false, actionCount = 0;
  /** 一个模拟连接对应一个真实生命周期；关闭计数独立，禁止靠重复 close 掩盖漏等待。 */
  function managed(threadId: number, close: () => Promise<void>, signal?: AbortSignal): ManagedConnection {
    const connection = Object.assign(new EventEmitter(), { threadId, destroy: vi.fn() });
    const value = { profile, connection, signal, broken: false, status: { version: '8.4.11', dialect: 'mysql', connectionId: threadId }, close: vi.fn(close) } as unknown as ManagedConnection;
    connections.push(value); return value;
  }
  mocks.connect.mockReset().mockImplementation(async (_profile: ConnectionProfile, _database?: string, signal?: AbortSignal) => {
    if (!connections.length) return managed(1, async () => undefined);
    if (signal && !originalChosen) {
      originalChosen = true;
      return managed(42, async () => { originalCloseEntered.release(); await originalCloseGate.promise; originalClosed = true; }, signal);
    }
    if (signal) return managed(43 + connections.length, async () => undefined, signal);
    const control = managed(90 + controls.length, async () => { if (controlStage === 'close') await controlCloseGate.promise; }); controls.push(control);
    if (controlStage === 'connect') await controlConnectGate.promise;
    return control;
  });
  mocks.execute.mockReset().mockImplementation(async (_managed: ManagedConnection, sql: string) => { sent.push({ sql, originalAlreadyClosed: originalClosed }); return { rows: [] }; });
  const engine = new Engine(), host = engine as unknown as TaskHost;
  await engine.handle('connections.open', { id: profile.id, profile });
  const operation = observe(host.withIndependentTask(profile.id, 'original', async () => { actionCount++; actionEntered.release(); await actionGate.promise; throw new Error('模拟目录读取失败'); }, options()));
  await actionEntered.promise;
  /** 请求敏感重配只能被活动任务保护拒绝，不改变本用例的真实连接配置。 */
  const reconfigure = () => engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'changed.invalid' }, transportChanged: true });
  /** 与当前执行目标相同，失败必须来自资源互斥而非假造的驱动错误。 */
  const sameResource = (id: string) => host.withIndependentTask(profile.id, id, async () => 123, options());
  /** 测试断言失败也主动放开各可控边界，保证不把失败变成退出挂起。 */
  const cleanup = async () => {
    actionGate.release(); originalCloseGate.release(); controlConnectGate.release(); controlCloseGate.release();
    await operation.done; await engine.closeAll();
  };
  return { engine, operation, actionGate, originalCloseGate, originalCloseEntered, controlConnectGate, controlCloseGate, controls, connections, sent, reconfigure, sameResource, cleanup, actionCount: () => actionCount };
}

describe('结构操作失败后的迟到取消与释放顺序', () => {
  it.each(['connect', 'close'] as const)('原操作已经失败且正在关闭时，迟到取消不另建 %s 阻塞的控制连接', async stage => {
    const test = await fixture(stage); let cancellation: ReturnType<typeof observe<unknown>> | undefined;
    let shutdown: ReturnType<typeof observe<void>> | undefined;
    try {
      test.actionGate.release(); await test.originalCloseEntered.promise;
      cancellation = observe(test.engine.handle('query.cancel', { taskId: 'original' })); await turn();
      expect(cancellation.state.settled).toBe(false);
      await expect(test.reconfigure()).rejects.toThrow('仍有打开的会话或正在执行');
      await expect(test.sameResource('during-close')).rejects.toThrow('已有结构变更');
      test.originalCloseGate.release(); await turn();
      // 旧实现会在此仍留控制连接，但已经释放资源、配置保护及退出登记；完整记录同一个反例。
      const premature = { operation: false, sameResource: false, reconfiguration: false, shutdown: false };
      if (test.controls.length) {
        premature.operation = test.operation.state.settled;
        const same = observe(test.sameResource('after-close')); await same.done; premature.sameResource = same.state.value === 123;
        const configure = observe(test.reconfigure()); await configure.done; premature.reconfiguration = configure.state.error === undefined;
        shutdown = observe(test.engine.closeAll()); await turn(); premature.shutdown = shutdown.state.settled;
      }
      expect({ unexpectedControlConnections: test.controls.length, prematurelyReleased: premature }).toEqual({ unexpectedControlConnections: 0, prematurelyReleased: { operation: false, sameResource: false, reconfiguration: false, shutdown: false } });
      await test.operation.done; await cancellation.done;
      expect(test.operation.state.error).toEqual(new Error('模拟目录读取失败')); expect(cancellation.state.error).toBeUndefined();
      expect(test.sent).toEqual([]); expect(test.actionCount()).toBe(1);
      expect(test.connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
    } finally { await test.cleanup(); await cancellation?.done; await shutdown?.done; }
  });

  it.each(['connect', 'close'] as const)('操作期间已登记的取消控制连接在 %s 阶段阻塞时，锁与退出等待不得先释放', async stage => {
    const test = await fixture(stage); let cancellation: ReturnType<typeof observe<unknown>> | undefined;
    let shutdown: ReturnType<typeof observe<void>> | undefined;
    try {
      cancellation = observe(test.engine.handle('query.cancel', { taskId: 'original' })); await turn();
      expect(test.controls).toHaveLength(1);
      test.actionGate.release(); test.originalCloseGate.release(); await turn();
      expect(test.operation.state.settled).toBe(false); expect(cancellation.state.settled).toBe(false);
      await expect(test.reconfigure()).rejects.toThrow('仍有打开的会话或正在执行');
      await expect(test.sameResource('control-pending')).rejects.toThrow('已有结构变更');
      shutdown = observe(test.engine.closeAll()); await turn(); expect(shutdown.state.settled).toBe(false);
      test.controlConnectGate.release(); test.controlCloseGate.release();
      await test.operation.done; await cancellation.done; await shutdown.done;
      expect(test.operation.state.error).toEqual(new Error('模拟目录读取失败')); expect(cancellation.state.error).toBeUndefined(); expect(shutdown.state.error).toBeUndefined();
      expect(test.sent).toEqual([{ sql: 'KILL CONNECTION 42', originalAlreadyClosed: false }]);
      expect(test.controls.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
      expect(test.connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true); expect(test.actionCount()).toBe(1);
    } finally { await test.cleanup(); await cancellation?.done; await shutdown?.done; }
  });
});
