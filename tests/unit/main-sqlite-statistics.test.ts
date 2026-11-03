import { expect, it } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import type { SqliteStatisticsInput } from '../../src/shared/sqliteStatistics';

const profile = { id: 'sqlite-file', name: '概况本例', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '仅作已存概要', readOnly: true, busyTimeoutMs: 1000 } };
const input: SqliteStatisticsInput = { connectionId: profile.id, database: 'main', taskId: 'statistics', table: 'subject', column: 'v', schemaKey: 'a'.repeat(64), mode: 'and', filters: [] };
/** 正式Main校验、分派与晚发布门；只替换数据库边界，不打开文件或接入网络。 */
it.each(['current', 'revision', 'destroyed', 'blocked'] as const)('概况%s核原窗口、配置与晚发布代次，零SQL历史', async mode => {
  const f = mainColumnsHarness(), pending = deferred(); Object.assign(f.context.store, { connections: () => [profile], addHistory: () => { throw Error('概况不能进入SQL历史'); } });
  f.request.mockImplementation(async (command, request) => { expect(command).toBe('sqlite.statistics'); expect(request).toEqual(input); return pending.promise; });
  const reading = f.invoke('sqlite.statistics', input); expect(f.request).toHaveBeenCalledOnce();
  if (mode === 'revision') f.setRevision(99); if (mode === 'destroyed') f.context.window.destroyContents(); if (mode === 'blocked') f.context.connectionConfig.assertAvailable = () => { throw Error('连接正在修订'); };
  const value = { request: input, declaredType: '', rows: '0', nonNull: '0', nulls: '0', groups: [] }; pending.resolve(value); const reply = await reading;
  if (mode === 'current') expect(reply).toEqual({ ok: true, result: value }); else { expect(reply.ok).toBe(false); expect(reply).not.toHaveProperty('result'); }
  expect(f.request).toHaveBeenCalledOnce(); expect(f.context.preparingTasks.size).toBe(0);
});
it.each(['missing', 'mysql', 'shutdown', 'path', 'sql'] as const)('概况%s在数据库投递前拒绝', async mode => {
  const f = mainColumnsHarness(); Object.assign(f.context.store, { connections: () => mode === 'missing' ? [] : [{ ...profile, dialect: mode === 'mysql' ? 'mysql' : 'sqlite' }] }); f.context.shuttingDown = mode === 'shutdown';
  expect((await f.invoke('sqlite.statistics', mode === 'path' ? { ...input, filePath: '不可打开' } : mode === 'sql' ? { ...input, sql: '不可执行' } : input)).ok).toBe(false); expect(f.request).not.toHaveBeenCalled();
});
