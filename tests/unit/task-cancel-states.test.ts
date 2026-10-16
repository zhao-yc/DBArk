import { describe, expect, it, vi } from 'vitest';
import type { TaskEvent } from '../../src/shared/contracts';
import { emptyTableApplyEvidence } from '../../src/shared/tableApplyReceipt';
import type { TaskCancelState } from '../../src/shared/taskCancelState';
import { TaskCancelStates } from '../../src/renderer/taskCancelStates';

/** 手动结算真实Promise，精确覆盖先后关系，不使用计时器或伪延时。 */
function deferred() { let resolve!: (v: unknown) => void, reject!: (e: Error) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function fixture() {
  let listener!: (event: TaskEvent) => void;
  const pending: ReturnType<typeof deferred>[] = [], order: string[] = [], changed = vi.fn<(states: ReadonlyMap<string, TaskCancelState>) => void>(), unsubscribe = vi.fn();
  const read = vi.fn((_ids: string[]) => { order.push('read'); const p = deferred(); pending.push(p); return p.promise; });
  const controller = new TaskCancelStates({ subscribe: fn => { order.push('subscribe'); listener = fn; return unsubscribe; }, read, changed });
  const event = (commit = false, status: TaskEvent['status'] = 'running') => listener({ taskId: 't', status, progress: 0, message: '任何文案均不能授权取消', ...(commit ? { tableApply: { operationId: '9b114a51-7550-44a5-ae0c-cbd48a938b26', sequence: 2, phase: 'committing' as const, reason: 'none' as const, evidence: { ...emptyTableApplyEvidence(), commitMayHaveBeenSent: true } } } : {}) });
  return { controller, read, pending, changed, unsubscribe, event, order, states: () => changed.mock.calls.at(-1)![0] };
}

describe('任务中心取消状态的初值与事件竞态', () => {
  it('先订阅后读取；COMMIT已发生时重开仍关闭取消，核验前也不显示取消', async () => {
    const f = fixture(); f.controller.start(['t']); expect(f.controller.canCancel('t')).toBe(false);
    await settle(); expect(f.order).toEqual(['subscribe', 'read']);
    f.pending[0].resolve([{ taskId: 't', state: 'confirming' }]); await settle();
    expect(f.states().get('t')).toBe('confirming'); expect(f.controller.canCancel('t')).toBe(false); f.controller.stop();
  });
  it('读初值期间COMMIT事件先到，迟到allowed不能恢复取消，也不再读取已锁定任务', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.event(true);
    f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle();
    expect(f.states().get('t')).toBe('confirming'); expect(f.controller.canCancel('t')).toBe(false); expect(f.read).toHaveBeenCalledOnce(); f.controller.stop();
  });
  it('原来已允许取消时COMMIT立即锁定；旧点击闭包及迟到普通事件不能再调用取消', async () => {
    const f = fixture(), cancel = vi.fn(); f.controller.start(['t']); await settle();
    f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle(); expect(f.controller.canCancel('t')).toBe(true);
    const oldClick = () => { if (f.controller.canCancel('t')) cancel(); };
    f.event(true); f.event(false); oldClick(); await settle();
    expect(cancel).not.toHaveBeenCalled(); expect(f.states().get('t')).toBe('confirming'); f.controller.stop();
  });
  it('终态先到时迟到allowed及旧COMMIT事件都不能恢复取消', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.event(false, 'completed'); f.event(true);
    f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle();
    expect(f.states().get('t')).toBe('finished'); expect(f.controller.canCancel('t')).toBe(false); f.controller.stop();
  });
  it('非终态事件使旧响应失效并合并补读，按新阶段重新核验', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.event(); f.event();
    f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle();
    expect(f.controller.canCancel('t')).toBe(false); expect(f.read).toHaveBeenCalledTimes(2);
    f.pending[1].resolve([{ taskId: 't', state: 'allowed' }]); await settle(); expect(f.controller.canCancel('t')).toBe(true); f.controller.stop();
  });
  it('相同编号移除后重加不冒领旧响应；正常查询经新快照仍可取消', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.controller.setIds([]); f.controller.setIds(['t']);
    f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle();
    expect(f.controller.canCancel('t')).toBe(false); expect(f.read).toHaveBeenCalledTimes(2);
    f.pending[1].resolve([{ taskId: 't', state: 'allowed' }]); await settle(); expect(f.controller.canCancel('t')).toBe(true); f.controller.stop();
  });
  it.each([
    { raw: [] }, { raw: [{ taskId: 't', state: 'allowed', sql: '不允许附带SQL' }] },
    { raw: [{ taskId: 't', state: 'allowed' }, { taskId: 't', state: 'checking' }] },
    { raw: [{ taskId: 'other', state: 'allowed' }] }, { raw: [{ taskId: 't', state: '其他状态' }] }
  ])('缺项、重复、越权及畸形响应均保守待核验：%j', async ({ raw }) => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.pending[0].resolve(raw); await settle();
    expect(f.states().get('t')).toBe('checking'); expect(f.controller.canCancel('t')).toBe(false); f.controller.stop();
  });
  it('读失败后保持待核验；后续事件可重新读取，不能从文案推断取消权限', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.pending[0].reject(Error('读取失败')); await settle();
    expect(f.controller.canCancel('t')).toBe(false); f.event(); await settle();
    f.pending[1].resolve([{ taskId: 't', state: 'checking' }]); await settle(); expect(f.controller.canCancel('t')).toBe(false); f.controller.stop();
  });
  it('卸载注销订阅；进行中的补读与迟到响应不能写状态或继续发请求', async () => {
    const f = fixture(); f.controller.start(['t']); await settle(); f.event(); f.controller.stop();
    const count = f.changed.mock.calls.length; f.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle(); f.event(true);
    expect(f.unsubscribe).toHaveBeenCalledOnce(); expect(f.changed).toHaveBeenCalledTimes(count); expect(f.read).toHaveBeenCalledOnce(); expect(f.controller.canCancel('t')).toBe(false);
  });
  it('挂载后立即卸载不发请求，新挂载使用独立实例', async () => {
    const old = fixture(); old.controller.start(['t']); old.controller.stop(); await settle(); expect(old.read).not.toHaveBeenCalled();
    const next = fixture(); next.controller.start(['t']); await settle(); next.pending[0].resolve([{ taskId: 't', state: 'allowed' }]); await settle();
    expect(next.controller.canCancel('t')).toBe(true); expect(old.controller.canCancel('t')).toBe(false); next.controller.stop();
  });
  it('超过批次上限的任务仍不可取消，且请求去重有界', async () => {
    const f = fixture(); f.controller.start([...Array.from({ length: 205 }, (_, i) => `id${i}`), 'id0']); await settle();
    expect(f.read.mock.calls[0][0]).toHaveLength(200); expect(f.controller.canCancel('id204')).toBe(false); f.controller.stop(); f.pending[0].resolve([]); await settle();
  });
});
