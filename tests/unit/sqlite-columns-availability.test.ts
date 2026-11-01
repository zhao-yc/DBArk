import { expect, it } from 'vitest';
import { assertSqliteColumnsTargetAvailable } from '../../src/renderer/sqliteColumnsAvailability';
import type { SqliteColumnsTarget } from '../../src/shared/sqliteColumns';

/** 仅构造入口读取的真实工作区字段，不加载window或模拟数据库目录。 */
function fixture() {
  const profile = { id: 'sqlite', name: '原连接', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/original.sqlite', readOnly: false, busyTimeoutMs: 1000 } }, target: SqliteColumnsTarget = { connectionId: profile.id, database: 'main', table: '原表' };
  const workspace = { connections: [profile], settings: { tabs: [{ id: 'a', kind: 'table', ...target }, { id: 'b', kind: 'table', ...target }, { id: 'other', kind: 'table', ...target, table: '另表' }, { id: 'query', kind: 'query', connectionId: profile.id }] }, dirtyTabs: {} as Record<string, boolean>, activeJobs: {} as Record<string, boolean> };
  return { profile, target, workspace, check: () => assertSqliteColumnsTargetAvailable(target, workspace as any) };
}
it.each(['dirtyTabs', 'activeJobs'] as const)('同表的非活动标签有%s时也拒入口，不能覆盖其数据草稿', field => {
  const f = fixture(); f.workspace[field].b = true; expect(f.check).toThrow('原表存在');
});
it('其它表或原查询草稿不变更字段目标，也不阻只读连接检查', () => {
  const f = fixture(); f.workspace.dirtyTabs.other = true; f.workspace.dirtyTabs.query = true; f.profile.sqlite.readOnly = true; expect(f.check()).toBe(f.profile); expect(f.target).toEqual({ connectionId: 'sqlite', database: 'main', table: '原表' });
});
it.each(['missing', 'pending', 'system', 'database', 'network'] as const)('来源%s不能通过main/保存文件/普通表边界', kind => {
  const f = fixture(); if (kind === 'missing') f.profile.sqlite.filePath = ''; else if (kind === 'pending') Object.assign(f.profile, { pendingFiles: ['sqlite'] }); else if (kind === 'system') f.target.table = 'sqlite_schema'; else if (kind === 'database') (f.target as any).database = 'temp'; else (f.profile as any).dialect = 'mysql'; expect(f.check).toThrow();
});
