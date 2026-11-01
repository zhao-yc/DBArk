import { expect, it } from 'vitest';
import { assertSqliteTableMaintenanceTargetAvailable, sqliteTableMaintenanceTabMatches } from '../../src/renderer/sqliteTableMaintenanceAvailability';
import type { SqliteTableMaintenanceTarget } from '../../src/shared/sqliteTableMaintenance';

/** 仅构造入口实际读取的工作区字段，不加载window或模拟数据库。 */
function fixture() {
  const profile = { id: 'owned', name: '原连接', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/original.sqlite', readOnly: false, busyTimeoutMs: 0 } }, target: SqliteTableMaintenanceTarget = { connectionId: 'owned', database: 'main', table: 'Subject' };
  const workspace = { connections: [profile], settings: { tabs: [{ id: 'original', kind: 'table', title: '原表', ...target }, { id: 'alias', kind: 'table', title: '大小写别名', ...target, table: 'sUBJECT' }, { id: 'affected', kind: 'table', title: '可能受触发器影响', ...target, table: 'different' }, { id: 'other-file', kind: 'table', title: '异文件', ...target, connectionId: 'other' }, { id: 'query', kind: 'query', title: '原SQL', connectionId: target.connectionId, database: 'main' }] }, dirtyTabs: {} as Record<string, boolean>, activeJobs: {} as Record<string, boolean>, tableLayoutDrafts: {} as Record<string, boolean> };
  return { profile, target, workspace, check: () => assertSqliteTableMaintenanceTargetAvailable(target, workspace as any) };
}
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同文件main任意表页%s必须先处理，避免触发器/FK影响其未提交草稿', field => {
  for (const id of ['original', 'alias', 'affected']) { const f = fixture(); f.workspace[field][id] = true; expect(f.check).toThrow('同一SQLite文件'); }
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('异文件表页或原查询%s不替代目标、不阻目录检查', field => {
  const f = fixture(); f.workspace[field]['other-file'] = true; f.workspace[field].query = true; expect(f.check()).toBe(f.profile); expect(f.target).toEqual({ connectionId: 'owned', database: 'main', table: 'Subject' });
});
it('只读profile仍可查看目录，但不会由入口改成可写连接', () => { const f = fixture(); f.profile.sqlite.readOnly = true; expect(f.check()).toBe(f.profile); expect(f.profile.sqlite.readOnly).toBe(true); });
it.each(['missing', 'pending', 'system', 'database', 'network'] as const)('来源%s不能越过保存文件/main/非系统表边界', kind => {
  const f = fixture(); if (kind === 'missing') f.profile.sqlite.filePath = ''; else if (kind === 'pending') Object.assign(f.profile, { pendingFiles: ['sqlite'] }); else if (kind === 'system') f.target.table = 'sqlite_sequence'; else if (kind === 'database') (f.target as any).database = 'temp'; else (f.profile as any).dialect = 'mysql'; expect(f.check).toThrow();
});
it('drop关闭表页只按SQLite ASCII身份匹配，查询/异文件/异库或Unicode差异不混入', () => {
  const f = fixture(); expect(sqliteTableMaintenanceTabMatches(f.workspace.settings.tabs[1] as any, f.target)).toBe(true);
  for (const id of ['affected', 'other-file', 'query']) expect(sqliteTableMaintenanceTabMatches(f.workspace.settings.tabs.find(tab => tab.id === id) as any, f.target)).toBe(false);
  expect(sqliteTableMaintenanceTabMatches({ ...f.workspace.settings.tabs[0], table: 'Ä' } as any, { ...f.target, table: 'ä' })).toBe(false); expect(sqliteTableMaintenanceTabMatches({ ...f.workspace.settings.tabs[0], database: 'temp' } as any, f.target)).toBe(false);
});
