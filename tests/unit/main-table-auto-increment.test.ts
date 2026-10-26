import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { ConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 执行生产dispatch和进程退出代码，替换Electron/broker边界而非复制令牌规则。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const exit = source.slice(source.indexOf('function engineExited('), source.indexOf('if (!app.requestSingleInstanceLock())'));
  const tokens = new Map(), progress = new Map(), tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], request = vi.fn(async (_command: string, _input: unknown): Promise<any> => undefined);
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(),
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false }, resultInsertProgress: new Map(),
     tableApplyReceipts: undefined, SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined, tasks, pendingQueryHistory: new Map(), completionTasks: new Set(), structureTokens: tokens, structureProgress: progress, shuttingDown: false, preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable() {} }, store: { saveTask() {}, connectionRevision: () => 7 }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); if (event.tableAutoIncrement) progress.set(event.taskId, event.tableAutoIncrement); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + exit + '\nglobalThis.handlers={dispatch,engineExited};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { tokens, progress, tasks, events, request, handlers: context.handlers as { dispatch(command: string, input: unknown): Promise<any>; engineExited(): void } };
}
describe('主进程下一自增值令牌、修订与退出事实', () => {
  it('从可信get/preview结果建立专属令牌并注入修订，其他用途不能套用或释放', async () => {
    const value = harness(), expiresAt = new Date(Date.now() + 120000).toISOString();
    value.request.mockResolvedValueOnce({ snapshotId: 's', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.tableAutoIncrement.get', { connectionId: 'trusted', database: 'db', table: 't', taskId: 'get' });
    expect(value.tokens.get('s')).toMatchObject({ purpose: 'tableAutoIncrement', connectionId: 'trusted', kind: 'snapshot' });
    await expect(value.handlers.dispatch('schema.indexes.preview', { snapshotId: 's', taskId: 'wrong' })).rejects.toThrow('用途');
    await expect(value.handlers.dispatch('schema.columns.release', { snapshotId: 's' })).rejects.toThrow('用途');
    value.request.mockResolvedValueOnce({ previewToken: 'p', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.tableAutoIncrement.preview', { snapshotId: 's', value: '9007199254740995', taskId: 'preview' });
    expect(value.request.mock.calls.at(-1)?.[1]).toMatchObject({ connectionRevision: 7 });
    value.request.mockRejectedValueOnce(new Error('进程中途退出'));
    await expect(value.handlers.dispatch('schema.tableAutoIncrement.apply', { previewToken: 'p', acknowledgements: [], taskId: 'apply' })).rejects.toThrow('退出');
    expect(value.events.at(-1)?.tableAutoIncrement).toMatchObject({ ddlSubmitted: true, outcome: 'unknown' });
    expect(value.events.at(-1)?.columnPatch).toBeUndefined();
    await expect(value.handlers.dispatch('schema.tableAutoIncrement.apply', { previewToken: 'p', taskId: 'again' })).rejects.toThrow('失效');
  });
  it('工具进程退出保留已完成事实，读取失败不标记已发送DDL', () => {
    const value = harness();
    for (const id of ['apply', 'get']) value.tasks.set(id, { id, kind: `schema.tableAutoIncrement.${id}`, status: 'running', progress: 0, startedAt: '', message: '' });
    value.progress.set('apply', { phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); value.handlers.engineExited();
    expect(value.events.find(event => event.taskId === 'apply')?.tableAutoIncrement).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' });
    expect(value.events.find(event => event.taskId === 'get')?.tableAutoIncrement).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });
  it('任务持久化不保存注释和驱动展开的敏感错误原文', () => {
    for (const status of ['running', 'completed', 'cancelled', 'failed'] as const) expect(persistedTaskMessage('schema.tableAutoIncrement.apply', { taskId: 't', status, progress: 0, message: 'COMMENT=私有业务说明', tableAutoIncrement: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } })).not.toContain('私有业务说明');
  });
});
