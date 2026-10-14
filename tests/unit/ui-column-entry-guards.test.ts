import { describe, expect, it } from 'vitest';
import { assertColumnTargetAvailable, columnPageRefreshAction, columnTargetKey, type ColumnTargetWorkspace } from '../../src/renderer/columnPatchServices';
import { columnExecutionEffect } from '../../src/renderer/columnPatches';
import type { WorkspaceTab } from '../../src/renderer/store';

const target = { connectionId: 'conn', database: 'CaseDB', table: 'CaseTable' };
/** 测试覆盖隐藏同目标页，不依赖当前活动标签或显示列投影。 */
function tab(id: string, patch: Partial<WorkspaceTab> = {}): WorkspaceTab { return { id, kind: 'table', title: id, ...target, ...patch }; }
function workspace(tabs: WorkspaceTab[], dirtyTabs: Record<string, boolean> = {}, activeJobs: Record<string, boolean> = {}): ColumnTargetWorkspace { return { settings: { tabs }, dirtyTabs, activeJobs }; }

describe('字段差异真实入口保护', () => {
  it('任何同目标表页草稿或活动操作阻止入口，不能只检查活动页', () => {
    const tabs = [tab('visible'), tab('hidden')];
    expect(() => assertColumnTargetAvailable(target, workspace(tabs, { hidden: true }))).toThrow('草稿');
    expect(() => assertColumnTargetAvailable(target, workspace(tabs, {}, { hidden: true }))).toThrow('活动');
    expect(() => assertColumnTargetAvailable(target, workspace(tabs))).not.toThrow();
  });
  it('查询事务、别的连接和大小写不同目标不被无关字段操作干扰', () => {
    const tabs = [tab('query', { kind: 'query' }), tab('other', { connectionId: 'other' }), tab('case', { table: 'casetable' }), tab('same')];
    expect(() => assertColumnTargetAvailable(target, workspace(tabs, { query: true, other: true, case: true }, { query: true }))).not.toThrow();
  });
  it('同ID换目标字段按当前标签重新核对，身份编码不会由分隔符或原型名称碰撞', () => {
    const before = workspace([tab('same')]); assertColumnTargetAvailable(target, before);
    const after = workspace([tab('same')], { same: true }); expect(() => assertColumnTargetAvailable(target, after)).toThrow();
    expect(columnTargetKey({ connectionId: 'a/b', database: 'c', table: '__proto__' })).not.toBe(columnTargetKey({ connectionId: 'a', database: 'b/c', table: '__proto__' }));
    expect(columnTargetKey(target)).not.toBe(columnTargetKey({ ...target, database: 'casedb' }));
  });
  it('未设置的原型同名任务键不算busy，超过检查预算不能静默漏掉后面的目标页', () => {
    expect(() => assertColumnTargetAvailable(target, workspace([tab('__proto__'), tab('constructor')]))).not.toThrow();
    expect(() => assertColumnTargetAvailable(target, workspace(Array.from({ length: 1001 }, (_, index) => tab(String(index)))))).toThrow('预算');
  });
  it('活动请求未settle不消费刷新版本，已知完成也不能刷新掉新出现的数据草稿', () => {
    expect(columnPageRefreshAction(1, 2, true, true, false)).toBe('wait');
    expect(columnPageRefreshAction(1, 2, true, false, true)).toBe('stale');
    expect(columnPageRefreshAction(1, 2, true, false, false)).toBe('reload');
    expect(columnPageRefreshAction(2, 2, true, false, false)).toBe('ignore');
    expect(columnPageRefreshAction(1, 2, false, false, false)).toBe('stale');
  });
  it('真实完成才清字段差异，未知/失败仍保留草稿且只能标过期，不自动重试', () => {
    const complete = { ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] };
    expect(columnExecutionEffect({ kind: 'resolved', result: complete })).toEqual({ clearDrafts: true, page: 'refresh' });
    expect(columnExecutionEffect({ kind: 'resolved', result: { ...complete, definitionVerified: false } })).toEqual({ clearDrafts: true, page: 'stale' });
    expect(columnExecutionEffect({ kind: 'rejected', progress: null, attempted: true })).toEqual({ clearDrafts: false, page: 'stale' });
    expect(columnExecutionEffect({ kind: 'rejected', progress: null, attempted: false })).toEqual({ clearDrafts: false, page: 'none' });
    expect(columnExecutionEffect({ kind: 'rejected', attempted: true, progress: { phase: 'rechecking', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } })).toEqual({ clearDrafts: false, page: 'none' });
  });
});
