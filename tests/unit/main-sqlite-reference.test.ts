import { expect, it } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import type { SqliteReferenceInput } from '../../src/shared/sqliteReference';

const profile = { id: 'sqlite-file', name: '本例文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '仅作已存概要，不打开文件', readOnly: true, busyTimeoutMs: 1000 } };
const input: SqliteReferenceInput = { connectionId: profile.id, database: 'main', taskId: '05b09cd0-9309-4d7a-b869-60c2df0bbd46', table: 'subject', schemaKey: 'a'.repeat(64), reference: 'catalog' };
/** 正式Main校验/分派与晚发布门，数据库端口仅返回已声明合成目录。 */
it.each(['current', 'revision', 'destroyed', 'blocked'] as const)('外键浏览%s使用准确只读任务，原窗口或配置变化拒绝迟到回包', async mode => {
  const f = mainColumnsHarness(), pending = deferred(); Object.assign(f.context.store, { connections: () => [profile], addHistory: () => { throw Error('外键浏览不得添加SQL历史'); } });
  f.request.mockImplementation(async (command, request) => { expect(command).toBe('sqlite.referencePage'); expect(request).toEqual(input); return pending.promise; });
  const reading = f.invoke('sqlite.referencePage', input); expect(f.request).toHaveBeenCalledTimes(1);
  if (mode === 'revision') f.setRevision(99); if (mode === 'destroyed') f.context.window.destroyContents(); if (mode === 'blocked') f.context.connectionConfig.assertAvailable = () => { throw Error('原连接正在保存'); };
  const value = { request: input, source: { name: 'subject', columns: [], foreignKeys: [] } }; pending.resolve(value); const reply = await reading;
  if (mode === 'current') expect(reply).toEqual({ ok: true, result: value }); else { expect(reply.ok).toBe(false); expect(reply).not.toHaveProperty('result'); }
  expect(f.request).toHaveBeenCalledTimes(1); expect(f.context.preparingTasks.size).toBe(0);
});
it.each(['missing', 'mysql', 'shutdown', 'extra-path'] as const)('外键浏览%s在投递前拒绝', async mode => {
  const f = mainColumnsHarness(); Object.assign(f.context.store, { connections: () => mode === 'missing' ? [] : [{ ...profile, dialect: mode === 'mysql' ? 'mysql' : 'sqlite' }] }); f.context.shuttingDown = mode === 'shutdown';
  expect((await f.invoke('sqlite.referencePage', mode === 'extra-path' ? { ...input, filePath: '不可打开' } : input)).ok).toBe(false); expect(f.request).not.toHaveBeenCalled();
});
