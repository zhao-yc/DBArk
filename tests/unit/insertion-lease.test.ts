import { describe, expect, it, vi } from 'vitest';
import type { HistoryInsertionTarget } from '../../src/renderer/historyInsertion';
import { borrowInsertion } from '../../src/renderer/insertionLease';

/** 原编辑端口记录权限消耗，不替代真实 Monaco 的 Undo 验收。 */
function fixture() {
  let valid = true;
  const listeners = new Set<() => void>();
  const invalidate = () => { valid = false; for (const listener of [...listeners]) listener(); };
  const insert = vi.fn(() => { invalidate(); });
  const dispose = vi.fn(invalidate);
  const source: HistoryInsertionTarget = { title: '原查询', connectionId: '原连接', current: () => valid, insert, dispose, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { source, insert, dispose, invalidate, listeners };
}

describe('历史和查询库子面板共用原编辑权限', () => {
  it('切页只销旧子租约，仍能插入原目标，旧 finally 不会销新子页', () => {
    const f = fixture(), old = borrowInsertion(f.source)!;
    const notify = vi.fn(); old.subscribe(notify); expect(f.listeners.size).toBe(1);
    old.dispose(); expect(notify).toHaveBeenCalledTimes(1); expect(f.listeners.size).toBe(0);
    const next = borrowInsertion(f.source)!; old.dispose();
    expect(next.current()).toBe(true); expect(old.current()).toBe(false);
    expect(() => old.insert('旧SQL')).toThrow(); expect(f.dispose).not.toHaveBeenCalled();
    next.insert('完整SQL'); expect(f.insert).toHaveBeenCalledExactlyOnceWith('完整SQL');
    expect(next.current()).toBe(false); expect(() => next.insert('重放')).toThrow();
  });
  it('原模型失效后任意切页都不能重新捕获或恢复权限', () => {
    const f = fixture(), old = borrowInsertion(f.source)!, notify = vi.fn(); old.subscribe(notify);
    f.invalidate(); expect(notify).toHaveBeenCalledTimes(1); old.dispose();
    const next = borrowInsertion(f.source)!; expect(next.current()).toBe(false);
    expect(() => next.insert('SQL')).toThrow(); expect(f.insert).not.toHaveBeenCalled();
  });
  it('父关闭会撤销所有子租约；同一监听函数的不同订阅分别释放', () => {
    const f = fixture(), a = borrowInsertion(f.source)!, b = borrowInsertion(f.source)!, listener = vi.fn();
    const stopA = a.subscribe(listener), stopB = a.subscribe(listener); b.subscribe(listener);
    expect(f.listeners.size).toBe(3); stopA(); expect(f.listeners.size).toBe(2);
    stopA(); stopB(); expect(f.listeners.size).toBe(1);
    f.source.dispose(); expect(a.current()).toBe(false); expect(b.current()).toBe(false);
    b.dispose(); expect(f.listeners.size).toBe(0);
  });
  it('无原目标时不给子页默认编辑器或其它标签', () => {
    expect(borrowInsertion(null)).toBeNull(); expect(borrowInsertion(undefined)).toBeNull();
  });
});
