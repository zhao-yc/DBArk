import { describe, expect, it } from 'vitest';
import { assertDatabaseDropTargetAvailable } from '../../src/renderer/databaseDropServices';
import type { WorkspaceTab } from '../../src/renderer/store';

const target = { connectionId: 'c', database: '库`名' };
const table: WorkspaceTab = { id: 'hidden', kind: 'table', title: '表', ...target, table: '表' };
/** 使用真实工作区合同验证隐藏页、事务与未知上下文保护，不模拟删除结果。 */
function workspace(tabs: WorkspaceTab[] = [table]) { return { settings: { tabs }, connections: [{ id: 'c', database: target.database }], activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} }; }
describe('删除数据库的工作区守卫', () => {
  it('隐藏同库任务、数据和布局草稿阻断；保留原输入且不误伤异库异连接', () => {
    for (const key of ['activeJobs', 'dirtyTabs', 'tableLayoutDrafts'] as const) {
      const state = { ...workspace(), [key]: { hidden: true } }, before = structuredClone(state);
      expect(() => assertDatabaseDropTargetAvailable(target, state, false)).toThrow(); expect(state).toEqual(before);
      expect(() => assertDatabaseDropTargetAvailable({ ...target, database: '另一库' }, state, false)).not.toThrow();
      expect(() => assertDatabaseDropTargetAvailable({ ...target, connectionId: 'other' }, state, false)).not.toThrow();
    }
  });
  it('同连接异库查询也可能跨库执行；活动事务及未知上下文不以默认库排除', () => {
    const query: WorkspaceTab = { id: 'q', kind: 'query', title: '查询', connectionId: 'c', database: 'other', sql: 'SELECT 1' };
    for (const key of ['activeJobs', 'dirtyTabs'] as const) expect(() => assertDatabaseDropTargetAvailable(target, { ...workspace([query]), [key]: { q: true } }, false)).toThrow();
    expect(() => assertDatabaseDropTargetAvailable(target, workspace([{ ...query, databaseContext: { state: 'unknown' } }]), false)).toThrow('未知');
    expect(() => assertDatabaseDropTargetAvailable(target, workspace([query]), false)).not.toThrow();
    expect(() => assertDatabaseDropTargetAvailable(target, workspace([{ ...query, connectionId: 'other', databaseContext: { state: 'unknown' } }]), false)).not.toThrow();
  });
  it('原型污染不冒充草稿，输入编辑与检查预算明确拒绝', () => {
    expect(() => assertDatabaseDropTargetAvailable(target, { ...workspace(), dirtyTabs: Object.create({ hidden: true }) }, false)).not.toThrow();
    expect(() => assertDatabaseDropTargetAvailable(target, workspace(), true)).toThrow('编辑');
    expect(() => assertDatabaseDropTargetAvailable(target, workspace(Array(1001).fill(table)), false)).toThrow('预算');
  });
});
