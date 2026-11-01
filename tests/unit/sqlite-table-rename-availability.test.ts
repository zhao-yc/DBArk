import { expect, it } from 'vitest';
import { assertSqliteTableRenameTargetAvailable, sqliteTableRenameTabMatches } from '../../src/renderer/sqliteTableRenameAvailability';
import type { SqliteTableRenameTarget } from '../../src/shared/sqliteTableRename';

/** 仅构造入口读取的真实工作区表重命名，不加载window或模拟数据库目录。 */
function fixture() {
  const profile = { id: 'sqlite', name: '原连接', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/original.sqlite', readOnly: false, busyTimeoutMs: 1000 } }, target: SqliteTableRenameTarget = { connectionId: profile.id, database: 'main', table: '原表' };
  const workspace = { connections: [profile], settings: { tabs: [{ id: 'a', kind: 'table', ...target }, { id: 'b', kind: 'table', ...target }, { id: 'other', kind: 'table', ...target, table: '另表' }, { id: 'query', kind: 'query', connectionId: profile.id }] }, dirtyTabs: {} as Record<string, boolean>, activeJobs: {} as Record<string, boolean>, tableLayoutDrafts: {} as Record<string, boolean> };
  return { profile, target, workspace, check: () => assertSqliteTableRenameTargetAvailable(target, workspace as any) };
}
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同表的非活动标签有%s时也拒入口，不能覆盖其数据草稿', field => {
  const f = fixture(); f.workspace[field].b = true; expect(f.check).toThrow('原表存在');
});
it('其它表或原查询草稿不变更表重命名目标，也不阻只读连接检查', () => {
  const f = fixture(); f.workspace.dirtyTabs.other = true; f.workspace.dirtyTabs.query = true; f.profile.sqlite.readOnly = true; expect(f.check()).toBe(f.profile); expect(f.target).toEqual({ connectionId: 'sqlite', database: 'main', table: '原表' });
});
it.each(['missing', 'pending', 'system', 'database', 'network'] as const)('来源%s不能通过main/保存文件/普通表边界', kind => {
  const f = fixture(); if (kind === 'missing') f.profile.sqlite.filePath = ''; else if (kind === 'pending') Object.assign(f.profile, { pendingFiles: ['sqlite'] }); else if (kind === 'system') f.target.table = 'sqlite_schema'; else if (kind === 'database') (f.target as any).database = 'temp'; else (f.profile as any).dialect = 'mysql'; expect(f.check).toThrow();
});

it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('新目标隐藏标签有%s时拒绝重命名提交，SQLite ASCII大小写规则一致', field => {
  const f = fixture(); f.workspace.settings.tabs.push({ id: 'destination', kind: 'table', ...f.target, table: 'DESTINATION' }); f.workspace[field].destination = true;
  expect(() => assertSqliteTableRenameTargetAvailable(f.target, f.workspace as any, 'destination')).toThrow('原表存在');
});
it('表页身份只折叠SQLite ASCII，不扩大到查询/异库/异连接或Unicode名称', () => {
  const target: SqliteTableRenameTarget = { connectionId: 'owned', database: 'main', table: 'SubJect' }, tab = { id: 'tab', kind: 'table' as const, title: '原表', connectionId: 'owned', database: 'main', table: 'sUBjECT' };
  expect(sqliteTableRenameTabMatches(tab, target)).toBe(true);
  for (const patch of [{ kind: 'query' }, { connectionId: 'other' }, { database: 'temp' }, { table: 'different' }]) expect(sqliteTableRenameTabMatches({ ...tab, ...patch } as any, target)).toBe(false);
  expect(sqliteTableRenameTabMatches({ ...tab, table: 'Ä' }, { ...target, table: 'ä' })).toBe(false);
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('原表ASCII别名隐藏页%s也不能绕过关闭前保护', field => {
  const f = fixture(); f.target.table = 'Subject'; const hidden = f.workspace.settings.tabs[1]; if (!('table' in hidden)) throw Error('缺少合成隐藏表页'); hidden.table = 'sUBJECT'; f.workspace[field].b = true; expect(f.check).toThrow('原表存在');
});
