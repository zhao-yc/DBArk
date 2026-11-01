import { expect, it } from 'vitest';
import { assertSqliteTableRebuildTargetAvailable } from '../../src/renderer/sqliteTableRebuildAvailability';
import type { SqliteTableRebuildTarget } from '../../src/shared/sqliteTableRebuild';

/** 只构造入口实际读取的字段；不加载原生窗口或数据库。 */
function fixture() {
  const profile = { id: 'owned', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/original.sqlite', readOnly: false, busyTimeoutMs: 0 } };
  const target: SqliteTableRebuildTarget = { connectionId: 'owned', database: 'main', table: 'Subject' };
  const workspace = { connections: [profile], settings: { tabs: [{ id: 'original', kind: 'table', title: '原表', ...target }, { id: 'related', kind: 'table', title: '同库其它表', ...target, table: 'Other' }, { id: 'other-file', kind: 'table', title: '异文件', ...target, connectionId: 'other' }, { id: 'temp', kind: 'table', title: '异库', ...target, database: 'temp' }, { id: 'query', kind: 'query', title: '原查询', connectionId: target.connectionId, database: 'main' }] }, dirtyTabs: {} as Record<string, boolean>, activeJobs: {} as Record<string, boolean>, tableLayoutDrafts: {} as Record<string, boolean> };
  return { profile, target, workspace, check: () => assertSqliteTableRebuildTargetAvailable(target, workspace as unknown as Parameters<typeof assertSqliteTableRebuildTargetAvailable>[1]) };
}
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同文件 main 任意表页 %s 均保护重建', field => {
  for (const id of ['original', 'related']) { const f = fixture(); f.workspace[field][id] = true; expect(f.check).toThrow('同一 SQLite 文件'); }
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('异文件、异库及查询 %s 不混入表页保护', field => {
  const f = fixture(); for (const id of ['other-file', 'temp', 'query']) f.workspace[field][id] = true; expect(f.check()).toBe(f.profile);
});
it('只读文件仍可读取和预览，入口不替换其原文件能力', () => { const f = fixture(); f.profile.sqlite.readOnly = true; expect(f.check()).toBe(f.profile); expect(f.profile.sqlite.readOnly).toBe(true); });
it.each(['missing', 'pending', 'system', 'temp', 'mysql'] as const)('来源 %s 不满足已保存普通 main 文件要求时拒绝', mode => {
  const f = fixture(); if (mode === 'missing') f.profile.sqlite.filePath = ''; else if (mode === 'pending') Object.assign(f.profile, { pendingFiles: ['sqlite'] }); else if (mode === 'system') f.target.table = 'sqlite_sequence'; else if (mode === 'temp') Object.assign(f.target, { database: 'temp' }); else f.profile.dialect = 'mysql'; expect(f.check).toThrow();
});
