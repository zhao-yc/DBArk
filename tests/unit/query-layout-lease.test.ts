import { expect, it, vi } from 'vitest';
import { beginQueryLayoutLease } from '../../src/renderer/queryLayoutLease';

/** 泛型UI租约端口不模拟后台字段合同；实际QueryTab接线另走正式共享模块。 */
function fixture() {
  let state = { key: 'query-A/connection-A', value: 300, available: true, sql: '原SQL', title: '原标题', source: '原来源' };
  const listeners = new Set<() => void>(), written: typeof state[] = [], cancel = vi.fn();
  const lease = () => beginQueryLayoutLease({ read: () => ({ ...state, state }), subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, write: (latest, value) => { state = { ...latest, value }; written.push(state); return true; } }, { min: 130, max: 8192 }, cancel);
  function change(update: Partial<typeof state>) { state = { ...state, ...update }; for (const callback of [...listeners]) callback(); }
  return { lease, change, written, cancel, listeners, state: () => state };
}
it.each(['key', 'closed', 'height'])('%s变化并恢复后旧租约永久拒绝，监听立即回收', kind => {
  const f = fixture(), original = f.state(), lease = f.lease()!;
  f.change(kind === 'key' ? { key: 'query-B' } : kind === 'closed' ? { available: false } : { value: 500 }); f.change(original);
  expect(lease.current()).toBe(false); expect(lease.commit(400)).toBe(false); expect(f.written).toEqual([]); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0);
});
it('提交只合并结束时的最新SQL/标题/来源，旧保存完成不发布工作台状态', () => {
  const f = fixture(), lease = f.lease()!; f.change({ sql: '后来SQL', title: '后来标题', source: '后来来源' });
  expect(lease.commit(420)).toBe(true); expect(f.state()).toMatchObject({ sql: '后来SQL', title: '后来标题', source: '后来来源', value: 420 }); expect(f.listeners.size).toBe(0);
  expect(lease.commit(500)).toBe(false); expect(f.written).toHaveLength(1);
});
it('dispose不回滚新偏好，非法值和无变化不写入', () => {
  const f = fixture(), lease = f.lease()!; expect(lease.commit(129)).toBe(false); expect(lease.commit(1.5)).toBe(false); lease.dispose(); f.change({ value: 600 }); expect(f.state().value).toBe(600); expect(f.written).toEqual([]);
  const next = f.lease()!; expect(next.commit(600)).toBe(true); expect(f.written).toEqual([]); expect(f.listeners.size).toBe(0);
});
