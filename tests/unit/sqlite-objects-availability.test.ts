import { expect, it } from 'vitest';
import { assertSqliteObjectsScopeAvailable, assertSqliteObjectsTargetAvailable, sqliteObjectsTabMatches } from '../../src/renderer/sqliteObjectsAvailability';
import type { SqliteObjectsTarget } from '../../src/shared/sqliteObjects';

/** 原对象与任意受定义变化影响的表页分开构造，不加载window或连接数据库。 */
function fixture() {
  const profile = { id: 'owned', name: '原文件', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/objects.sqlite', readOnly: false, busyTimeoutMs: 0 } }, target: SqliteObjectsTarget = { connectionId: 'owned', database: 'main', kind: 'view', name: 'Subject' };
  const tab = (id: string, table: string, connectionId = 'owned') => ({ id, kind: 'table', title: table, connectionId, database: 'main', table });
  const workspace = { connections: [profile], settings: { tabs: [tab('original', 'Subject'), tab('alias', 'sUBJECT'), tab('affected', 'different'), tab('other-file', 'Subject', 'other'), { id: 'query', kind: 'query', title: 'SQL草稿', connectionId: 'owned', database: 'main' }] }, dirtyTabs: {} as Record<string, boolean>, activeJobs: {} as Record<string, boolean>, tableLayoutDrafts: {} as Record<string, boolean> };
  return { profile, target, workspace, check: () => assertSqliteObjectsTargetAvailable(target, workspace as any) };
}
it('create没有名称仍可预检同main上下文，真正inspect目标必须有准确名称', () => {
  const f = fixture(), { name: _name, ...scope } = f.target; expect(assertSqliteObjectsScopeAvailable(scope, f.workspace as any)).toBe(f.profile); expect(() => assertSqliteObjectsTargetAvailable(scope as any, f.workspace as any)).toThrow(); expect(f.target.name).toBe('Subject');
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同文件main任意表页%s在创建/改定义/删除前均受保护', field => {
  for (const id of ['original', 'alias', 'affected']) { const f = fixture(); f.workspace[field][id] = true; expect(f.check).toThrow('同一SQLite文件'); const { name: _name, ...scope } = f.target; expect(() => assertSqliteObjectsScopeAvailable(scope, f.workspace as any)).toThrow('同一SQLite文件'); }
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('异文件表页和查询草稿%s不替代对象目标', field => { const f = fixture(); f.workspace[field]['other-file'] = true; f.workspace[field].query = true; expect(f.check()).toBe(f.profile); });
it('只读连接可以打开检查，但不能由入口改写为可写profile', () => { const f = fixture(); f.profile.sqlite.readOnly = true; expect(f.check()).toBe(f.profile); expect(f.profile.sqlite.readOnly).toBe(true); });
it.each(['file', 'pending', 'network', 'database', 'kind', 'system'] as const)('错误%s来源不能越过文件/主库/对象种类边界', reason => { const f = fixture(); if (reason === 'file') f.profile.sqlite.filePath = ''; else if (reason === 'pending') Object.assign(f.profile, { pendingFiles: ['sqlite'] }); else if (reason === 'network') (f.profile as any).dialect = 'mysql'; else if (reason === 'database') (f.target as any).database = 'temp'; else if (reason === 'kind') (f.target as any).kind = 'table'; else f.target.name = 'sqlite_internal'; expect(f.check).toThrow(); });
it('只有准确view表页及ASCII别名可关闭，trigger同名或其它文件/名称不会混入', () => {
  const f = fixture(); expect(sqliteObjectsTabMatches(f.workspace.settings.tabs[1] as any, f.target)).toBe(true); for (const id of ['affected', 'other-file', 'query']) expect(sqliteObjectsTabMatches(f.workspace.settings.tabs.find(tab => tab.id === id) as any, f.target)).toBe(false); expect(sqliteObjectsTabMatches(f.workspace.settings.tabs[0] as any, { ...f.target, kind: 'trigger' })).toBe(false); expect(sqliteObjectsTabMatches({ ...f.workspace.settings.tabs[0], table: 'Ä' } as any, { ...f.target, name: 'ä' })).toBe(false);
});
