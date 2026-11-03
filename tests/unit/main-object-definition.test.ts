import { expect, it } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { assertObjectDefinitionOutput, objectDefinitionInputSchema, type ObjectDefinitionInput } from '../../src/shared/objectDefinition';
import { persistedTaskMessage, persistedQueryError } from '../../src/main/taskPrivacy';
import type { TaskEvent } from '../../src/shared/contracts';

const profile = { id: 'definition-file', name: '结构本例', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '仅作已存概要', readOnly: true, busyTimeoutMs: 1000 } };
const input: ObjectDefinitionInput = { connectionId: profile.id, table: 'subject', taskId: 'object-definition:Main本例' };
const output = { request: input, database: 'main', name: 'subject', kind: 'table', temporary: false, ddl: 'CREATE TABLE subject(id INTEGER)' };
/** 运行正式Main校验/dispatch/IPC最终发布代码，只有数据库端口使用本例RAM回包。 */
function fixture() {
  const f = mainColumnsHarness(); Object.assign(f.context, { objectDefinitionInputSchema, assertObjectDefinitionOutput });
  Object.assign(f.context.store, { connections: () => [profile], resolveConnection: () => profile, addHistory: () => { throw Error('结构读取不得进入SQL历史'); } });
  return f;
}
it.each(['current','revision','destroyed','blocked','forged'] as const)('真实Main的%s回复严格绑定原窗口和连接', async mode => {
  const f = fixture(), pending = deferred(); f.request.mockImplementation(async (command, request) => { expect(command).toBe('query.objectDefinition'); expect(request).toEqual(input); return pending.promise; });
  const reading = f.invoke('query.objectDefinition', input); expect(f.request).toHaveBeenCalledOnce();
  if (mode === 'revision') f.setRevision(99); if (mode === 'destroyed') f.context.window.destroyContents(); if (mode === 'blocked') f.context.connectionConfig.assertAvailable = () => { throw Error('连接正在修订'); };
  pending.resolve(mode === 'forged' ? { ...output, name: 'other' } : output); const reply = await reading;
  if (mode === 'current') expect(reply).toEqual({ ok: true, result: output }); else { expect(reply.ok).toBe(false); expect(reply).not.toHaveProperty('result'); }
  expect(f.context.preparingTasks.size).toBe(0); expect(f.request).toHaveBeenCalledOnce();
});
it.each(['shutdown','missing','session','sql','path'] as const)('%s在实际引擎投递前拒绝', async mode => {
  const f = fixture(); f.context.shuttingDown = mode === 'shutdown';
  if (mode === 'missing') f.context.store.resolveConnection = () => { throw Error('已存连接不存在'); };
  const value = mode === 'session' ? { ...input, sessionId: '未登记会话' } : mode === 'sql' ? { ...input, sql: '不可执行' } : mode === 'path' ? { ...input, filePath: '不可打开' } : input;
  expect((await f.invoke('query.objectDefinition', value)).ok).toBe(false); expect(f.request).not.toHaveBeenCalled();
});
it('会话、连接必须准确配对，迟到退出的原会话不能发布结构', async () => {
  const f = fixture(), pending = deferred(), session = { connectionId: profile.id }, request = { ...input, sessionId: 'original' };
  f.context.sessions.set(request.sessionId, session); f.request.mockImplementation(() => pending.promise);
  const reading = f.invoke('query.objectDefinition', request); expect(f.request).toHaveBeenCalledOnce();
  f.context.sessions.set(request.sessionId, { connectionId: profile.id }); pending.resolve({ ...output, request, revision: 0 });
  expect((await reading).ok).toBe(false);
});
it.each(['running','completed','failed','cancelled'] as const)('%s只持久固定中文任务概要，无DDL和原错误', status => {
  const secret = '本例定义及服务器错误不应入任务';
  const message = persistedTaskMessage('query.objectDefinition', { status, message: secret } as TaskEvent);
  expect(message).not.toContain(secret); expect(message).not.toContain('CREATE');
  expect(persistedQueryError('query.objectDefinition', secret)).not.toContain(secret);
});
