import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 执行生产dispatch及进程退出代码，仅替换Electron和broker边界，不复制令牌规则。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const exit = source.slice(source.indexOf('function engineExited('), source.indexOf('if (!app.requestSingleInstanceLock())'));
  const tokens = new Map(), progress = new Map(), tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], request = vi.fn(async (_command: string, _input: unknown): Promise<any> => undefined);
  const context = createContext({ filteredUpdates: emptyTableFilteredUpdateOwners(),
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false }, resultInsertProgress: new Map(),
     tableApplyReceipts: undefined, SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined, tasks, pendingQueryHistory: new Map(), completionTasks: new Set(), structureTokens: tokens, structureProgress: progress, shuttingDown: false, preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable() {} }, store: { saveTask() {}, connectionRevision: () => 7 }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); if (event.databaseCreate) progress.set(event.taskId, event.databaseCreate); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + exit + '\nglobalThis.handlers={dispatch,engineExited};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { tokens, progress, tasks, events, request, handlers: context.handlers as { dispatch(command: string, input: unknown): Promise<any>; engineExited(): void } };
}
describe('新建库main令牌、修订与工具进程中断', () => {
  it('只从可信结果绑定目标，隔离表用途；进程中断消费预览且不重放', async () => {
    const value = harness(), expiresAt = new Date(Date.now() + 120000).toISOString();
    value.request.mockResolvedValueOnce({ snapshotId: 's', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.databaseCreate.get', { connectionId: 'trusted', taskId: 'get' });
    expect(value.tokens.get('s')).toMatchObject({ purpose: 'databaseCreate', connectionId: 'trusted', kind: 'snapshot' });
    await expect(value.handlers.dispatch('schema.tableDefaultEncoding.preview', { snapshotId: 's', taskId: 'wrong' })).rejects.toThrow('用途');
    await expect(value.handlers.dispatch('schema.indexes.release', { snapshotId: 's' })).rejects.toThrow('用途');
    value.request.mockResolvedValueOnce({ previewToken: 'p', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.databaseCreate.preview', { snapshotId: 's', name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin', taskId: 'preview' });
    expect(value.request.mock.calls.at(-1)?.[1]).toMatchObject({ connectionRevision: 7 });
    value.request.mockRejectedValueOnce(Error('服务中断'));
    await expect(value.handlers.dispatch('schema.databaseCreate.apply', { previewToken: 'p', taskId: 'apply' })).rejects.toThrow('中断');
    expect(value.events.at(-1)?.databaseCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    await expect(value.handlers.dispatch('schema.databaseCreate.apply', { previewToken: 'p', taskId: 'again' })).rejects.toThrow('失效');
  });
  it('进程退出保留创建完成事实，目录读取任务不能伪装已发送DDL', () => {
    const value = harness();
    for (const id of ['apply', 'get']) value.tasks.set(id, { id, kind: `schema.databaseCreate.${id}`, status: 'running', progress: 0, startedAt: '', message: '' });
    value.progress.set('apply', { phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); value.handlers.engineExited();
    expect(value.events.find(event => event.taskId === 'apply')?.databaseCreate).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' });
    expect(value.events.find(event => event.taskId === 'get')?.databaseCreate).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });
  it('任务概要不持久化私有数据库名称和驱动SQL错误', () => {
    const message = persistedTaskMessage('schema.databaseCreate.apply', { taskId: 't', status: 'failed', progress: 0, message: 'CREATE DATABASE 私有库', databaseCreate: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } });
    expect(message).not.toContain('私有库'); expect(message).toContain('未自动重放');
  });
});
