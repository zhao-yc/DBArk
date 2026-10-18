import { describe, expect, it, vi } from 'vitest';
import { QuerySourceLease, querySourceTab } from '../../src/renderer/querySourceLease';
import type { WorkspaceTab } from '../../src/renderer/store';

/** RAM来源租约只验证回包权限，完全不接触文件或Main实现。 */
function fixture() {
  let tab: WorkspaceTab | undefined = { id: 't', kind: 'query', connectionId: 'c', title: '旧标题', sql: '旧SQL', fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }, alive = true;
  const listeners = new Set<() => void>();
  const lease = new QuerySourceLease({ ...tab }, () => tab, listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => alive);
  return { lease, read: () => tab, count: () => listeners.size, change(patch: Partial<WorkspaceTab>) { if (tab) tab = { ...tab, ...patch }; for (const fn of listeners) fn(); }, remove() { tab = undefined; for (const fn of listeners) fn(); }, unmount() { alive = false; } };
}
describe('文件/查询库保存回包的一次性来源租约', () => {
  it('保存期间新正文可继续编辑，应用者只获得当前对象而非旧正文', () => { const f = fixture(), update = vi.fn(); f.change({ sql: '新草稿' }); expect(f.lease.apply(update)).toBe(true); expect(update).toHaveBeenCalledWith(expect.objectContaining({ sql: '新草稿' }), true); expect(f.lease.apply(update)).toBe(false); expect(f.count()).toBe(0); });
  it('标题改名后即使改回旧值，也不可用旧回包覆盖标题', () => { const f = fixture(), update = vi.fn(); f.change({ title: '新标题' }); f.change({ title: '旧标题' }); expect(f.lease.apply(update)).toBe(true); expect(update).toHaveBeenCalledWith(expect.anything(), false); });
  it.each(['文件来源', '查询库来源', '连接'] as const)('%s离开后恢复原值，旧回包仍永久失效', key => {
    const f = fixture(), before = f.read()!;
    if (key === '文件来源') { f.change({ fileSourceBinding: { ...before.fileSourceBinding!, revision: 2 } }); f.change({ fileSourceBinding: before.fileSourceBinding }); }
    if (key === '查询库来源') { f.change({ sourceBinding: { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' } } }); f.change({ sourceBinding: undefined }); }
    if (key === '连接') { f.change({ connectionId: 'other' }); f.change({ connectionId: before.connectionId }); }
    expect(f.lease.apply(vi.fn())).toBe(false); f.lease.dispose(); expect(f.count()).toBe(0);
  });
  it.each(['移除', '卸载'] as const)('%s后不能把旧回包绑定新文档', kind => { const f = fixture(); if (kind === '移除') f.remove(); else f.unmount(); expect(f.lease.apply(vi.fn())).toBe(false); f.lease.dispose(); expect(f.count()).toBe(0); });
  it('切换主来源真正移除另一键并保留当前正文与布局', () => {
    const tab: WorkspaceTab = { id: 't', kind: 'query', connectionId: 'c', title: '新标题', sql: '新正文', queryEditorHeight: 400, sourceBinding: { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' } } };
    const file = querySourceTab(tab, { fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }, 'file');
    expect(Object.hasOwn(file, 'sourceBinding')).toBe(false); expect(file).toMatchObject({ sql: '新正文', title: '新标题', queryEditorHeight: 400 });
    const library = querySourceTab(file, { sourceBinding: tab.sourceBinding }, 'library'); expect(Object.hasOwn(library, 'fileSourceBinding')).toBe(false); expect(library.sourceBinding).toEqual(tab.sourceBinding);
  });
});
