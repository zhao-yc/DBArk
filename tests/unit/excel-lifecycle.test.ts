import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExcelTransferLifecycle, type ExcelTaskSnapshot } from '../../src/renderer/excelTransferLifecycle';

/** 可控 Promise 把提交、切换、取消 RPC 和任务收尾分别推进，无需浏览器或定时睡眠。 */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
const controllers: ExcelTransferLifecycle[] = [];
function controller(): ExcelTransferLifecycle { const lifecycle = new ExcelTransferLifecycle(); controllers.push(lifecycle); return lifecycle; }
afterEach(() => { for (const lifecycle of controllers.splice(0)) lifecycle.detach(); });
function setup() {
  const lifecycle = controller(), snapshots: ExcelTaskSnapshot[] = [];
  lifecycle.attach('导入:A', snapshot => snapshots.push(snapshot), '连接A/数据库/表');
  const work = deferred<number>(), cancellation = deferred<void>();
  const execute = vi.fn(() => work.promise), cancel = vi.fn(() => cancellation.promise), success = vi.fn(), failure = vi.fn();
  const input = { taskId: '自有任务-A', contextKey: '导入:A', execute, cancel, success, failure };
  return { lifecycle, snapshots, work, cancellation, execute, cancel, success, failure, input };
}

describe('Excel 任务生命周期', () => {
  it('同一上下文同步占位阻止双击，真实完成后才发布并释放', async () => {
    const state = setup(), running = state.lifecycle.run(state.input);
    expect(state.lifecycle.busy).toBe(true); expect(await state.lifecycle.run(state.input)).toBe(false);
    await flush(); expect(state.execute).toHaveBeenCalledTimes(1);
    state.work.resolve(12); await running;
    expect(state.success).toHaveBeenCalledWith(12); expect(state.failure).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
  });
  it('目标或模式切换后使用旧服务取消自有任务，旧成功不得污染新目标', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush();
    const nextSnapshots: ExcelTaskSnapshot[] = [];
    state.lifecycle.attach('导出:B', snapshot => nextSnapshots.push(snapshot)); await flush();
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith('自有任务-A');
    expect(state.lifecycle.snapshot.waitingForPrevious).toBe(true);
    expect(await state.lifecycle.run({ ...state.input, contextKey: '导出:B', taskId: '新任务-B' })).toBe(false);
    state.cancellation.resolve(); await flush();
    expect(state.lifecycle.busy).toBe(true);
    state.work.resolve(9); await running;
    expect(state.success).not.toHaveBeenCalled(); expect(state.failure).not.toHaveBeenCalled();
    expect(nextSnapshots.at(-1)).toEqual({ busy: false, waitingForPrevious: false, cancellationError: '' });
    expect(state.cancel).toHaveBeenCalledTimes(1);
  });
  it('从A切到B再回A也不能接纳最早A的迟到错误', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush();
    state.lifecycle.attach('导入:B', () => {}); state.lifecycle.attach('导入:A', () => {});
    state.work.reject(new Error('旧目标错误')); state.cancellation.resolve(); await running;
    expect(state.success).not.toHaveBeenCalled(); expect(state.failure).not.toHaveBeenCalled(); expect(state.cancel).toHaveBeenCalledTimes(1);
  });
  it('卸载会取消已提交的自有任务，取消拒绝被观察且不会发布到已卸载组件', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush();
    const count = state.snapshots.length; state.lifecycle.detach(); await flush();
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith('自有任务-A');
    state.cancellation.reject(new Error('取消RPC失败')); await flush();
    expect(state.lifecycle.lastCancellationError).toBe('取消RPC失败'); expect(state.lifecycle.busy).toBe(true);
    state.work.resolve(1); await running;
    expect(state.snapshots).toHaveLength(count); expect(state.success).not.toHaveBeenCalled(); expect(state.failure).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
  });
  it('提交前立即卸载、切换或显式取消均不会发出任务或无主取消RPC', async () => {
    for (const action of ['卸载', '切换', '取消']) {
      const state = setup(), running = state.lifecycle.run(state.input);
      if (action === '卸载') state.lifecycle.detach(); else if (action === '切换') state.lifecycle.attach('导入:B', () => {}); else await state.lifecycle.cancel();
      await running;
      expect(state.execute).not.toHaveBeenCalled(); expect(state.cancel).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled(); expect(state.failure).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
    }
  });
  it('准备回调切换上下文时仍在提交前停止', async () => {
    const state = setup();
    await state.lifecycle.run({ ...state.input, prepare: () => state.lifecycle.attach('导入:B', () => {}) });
    expect(state.execute).not.toHaveBeenCalled(); expect(state.cancel).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
  });
  it('准备或提交同步抛错只发布当前上下文错误并释放占位', async () => {
    for (const phase of ['准备', '提交']) {
      const state = setup(), reason = new Error('同步失败');
      await state.lifecycle.run({ ...state.input, prepare: phase === '准备' ? () => { throw reason; } : undefined, execute: phase === '提交' ? () => { throw reason; } : state.execute });
      expect(state.failure).toHaveBeenCalledExactlyOnceWith(reason); expect(state.success).not.toHaveBeenCalled(); expect(state.cancel).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
    }
  });
  it('服务调用内部触发卸载时，返回Promise后补发取消并等待任务收尾', async () => {
    const state = setup();
    const running = state.lifecycle.run({ ...state.input, execute: () => { state.lifecycle.detach(); return state.work.promise; } }); await flush();
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith('自有任务-A');
    state.cancellation.resolve(); state.work.resolve(2); await running;
    expect(state.success).not.toHaveBeenCalled(); expect(state.lifecycle.busy).toBe(false);
  });
  it('任务先结束但取消RPC未收尾时，仍不允许新任务并发', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush();
    state.lifecycle.attach('导入:B', () => {}); await flush(); state.work.resolve(3); await flush();
    expect(state.lifecycle.busy).toBe(true);
    expect(await state.lifecycle.run({ ...state.input, contextKey: '导入:B' })).toBe(false);
    state.cancellation.resolve(); await running; expect(state.lifecycle.busy).toBe(false);
  });
  it('取消服务同步抛错也被观察，不能误认为任务已结束', async () => {
    const state = setup(), running = state.lifecycle.run({ ...state.input, cancel: () => { throw new Error('取消同步失败'); } }); await flush();
    await state.lifecycle.cancel();
    expect(state.lifecycle.lastCancellationError).toBe('取消同步失败'); expect(state.lifecycle.snapshot.cancellationError).toBe('取消同步失败'); expect(state.lifecycle.busy).toBe(true);
    state.work.reject(new Error('任务结束')); await running;
    expect(state.failure).toHaveBeenCalledOnce(); expect(state.lifecycle.busy).toBe(false);
  });
  it('实际重新挂载的新控制器等待同目标旧任务，不能代替旧实例取消', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush(); state.lifecycle.detach(); await flush();
    const replacement = controller(), nextCancel = vi.fn(async () => {}), nextExecute = vi.fn(async () => 7);
    replacement.attach('导出:A', () => {}, '连接A/数据库/表');
    expect(replacement.snapshot).toEqual({ busy: true, waitingForPrevious: true, cancellationError: '' }); expect(replacement.ownsActiveTask).toBe(false);
    await replacement.cancel(); expect(state.cancel).toHaveBeenCalledTimes(1); expect(nextCancel).not.toHaveBeenCalled();
    expect(await replacement.run({ ...state.input, contextKey: '导出:A', taskId: '新任务', execute: nextExecute, cancel: nextCancel })).toBe(false);
    expect(nextExecute).not.toHaveBeenCalled();
    state.cancellation.resolve(); state.work.resolve(1); await running;
    expect(replacement.busy).toBe(false);
    expect(await replacement.run({ ...state.input, contextKey: '导出:A', taskId: '新任务', execute: nextExecute, cancel: nextCancel })).toBe(true);
    expect(nextExecute).toHaveBeenCalledTimes(1);
  });
  it('旧实例取消失败仍持有登记，任务真实失败后删除且新实例不接收旧错误', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush(); state.lifecycle.detach();
    const replacement = controller(), listener = vi.fn(); replacement.attach('导入:A', listener, '连接A/数据库/表');
    state.cancellation.reject(new Error('旧实例取消失败')); await flush();
    expect(state.lifecycle.lastCancellationError).toBe('旧实例取消失败'); expect(replacement.busy).toBe(true); expect(replacement.snapshot.cancellationError).toBe('');
    state.work.reject(new Error('旧任务已经停止')); await running;
    expect(replacement.busy).toBe(false); expect(state.failure).not.toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith({ busy: false, waitingForPrevious: false, cancellationError: '' });
  });
  it('等待者卸载立即移除监听且不取消其它实例任务，登记在所有收尾后释放', async () => {
    const state = setup(), running = state.lifecycle.run(state.input); await flush();
    const waiter = controller(), listener = vi.fn(); waiter.attach('导入:A', listener, '连接A/数据库/表'); waiter.detach();
    const count = listener.mock.calls.length; expect(state.cancel).not.toHaveBeenCalled();
    state.work.resolve(1); await running; expect(listener).toHaveBeenCalledTimes(count);
    const reopened = controller(); reopened.attach('导入:A', () => {}, '连接A/数据库/表'); expect(reopened.busy).toBe(false);
  });
});
