import { networkBrokerRamPort } from './network-broker-ram-port';
import { extractMainProductionFunction } from './main-production-function';
import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { tableCreateMessages } from '../../src/shared/tableCreate';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
/** 直接运行生产dispatch/engineExited；所有broker与存储均为RAM，不加载Electron。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = extractMainProductionFunction(source, 'dispatch');
  const exit = extractMainProductionFunction(source, 'engineExited');
  const tokens = new Map(), progress = new Map(), tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], request = vi.fn(async (_command: string, _input: unknown): Promise<any> => undefined); let revision = 7;
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(),
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false }, resultInsertProgress: new Map(),
     tableCreateMessages, tableApplyReceipts: undefined, SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined, tasks, pendingQueryHistory: new Map(), completionTasks: new Set(), structureTokens: tokens, structureProgress: progress, shuttingDown: false, preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable() {} }, store: { saveTask() {}, connectionRevision: () => revision }, broker: networkBrokerRamPort(request),
    taskEvent(event: TaskEvent) { events.push(event); if (event.tableCreate) progress.set(event.taskId, event.tableCreate); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + exit + '\nglobalThis.handlers={dispatch,engineExited};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { tokens, progress, tasks, events, request, revise: () => { revision++; }, handlers: context.handlers as { dispatch(command: string, input: unknown): Promise<any>; engineExited(): void } };
}
describe('新建表生产main可信能力与退出事实（仅RAM）', () => {
  it('目标只从可信结果绑定，修订由main写入，不能跨用途释放或执行', async () => {
    const f = harness(), expiresAt = new Date(Date.now() + 120000).toISOString(); f.request.mockResolvedValueOnce({ snapshotId: 's', target: { connectionId: 'trusted', database: 'db' }, expiresAt });
    await f.handlers.dispatch('schema.tableCreate.get', { connectionId: 'trusted', database: 'db', taskId: 'get' }); expect(f.tokens.get('s')).toMatchObject({ purpose: 'tableCreate', connectionId: 'trusted', kind: 'snapshot' }); expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ connectionRevision: 7 });
    await expect(f.handlers.dispatch('schema.tableCopyStructure.preview', { snapshotId: 's', taskId: 'wrong' })).rejects.toThrow('用途'); await expect(f.handlers.dispatch('schema.databaseCreate.release', { snapshotId: 's' })).rejects.toThrow('用途');
  });
  it('apply第一次等待前消费；并发与工具中断不能重放同一能力', async () => {
    const f = harness(); f.tokens.set('p', { purpose: 'tableCreate', connectionId: 'trusted', kind: 'preview', expires: Date.now() + 120000 }); let reject!: (reason: Error) => void;
    f.request.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; })); const pending = f.handlers.dispatch('schema.tableCreate.apply', { previewToken: 'p', taskId: 'apply' }).catch(reason => reason);
    expect(f.tokens.has('p')).toBe(false); await expect(f.handlers.dispatch('schema.tableCreate.apply', { previewToken: 'p', taskId: 'again' })).rejects.toThrow('失效'); reject(Error('工具进程中断')); await pending;
    expect(f.events.at(-1)?.tableCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('连接修订等待期间变化，迟到快照先释放而非发布到新来源', async () => {
    const f = harness(); f.request.mockImplementationOnce(async () => { f.revise(); return { snapshotId: 'late', target: { connectionId: 'trusted', database: 'db' }, expiresAt: new Date(Date.now() + 120000).toISOString() }; });
    await expect(f.handlers.dispatch('schema.tableCreate.get', { connectionId: 'trusted', database: 'db', taskId: 'get' })).rejects.toThrow('修订'); expect(f.tokens.has('late')).toBe(false); expect(f.request.mock.calls.at(-1)?.[0]).toBe('schema.tableCreate.release');
  });
  it('进程退出保留ACK/后核事实，get不能伪装已经发送DDL', () => {
    const f = harness(); for (const id of ['apply', 'get']) f.tasks.set(id, { id, kind: `schema.tableCreate.${id}`, status: 'running', progress: 0, startedAt: '', message: '' });
    f.progress.set('apply', { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); f.handlers.engineExited();
    expect(f.events.find(x => x.taskId === 'apply')?.tableCreate).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' }); expect(f.events.find(x => x.taskId === 'get')?.tableCreate).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });
  it('任务持久化概要不含新表设计、默认值和驱动错误原文', () => {
    const message = persistedTaskMessage('schema.tableCreate.apply', { taskId: 't', status: 'failed', progress: 0, message: 'CREATE TABLE 私密表 DEFAULT 私密值', tableCreate: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } }); expect(message).not.toContain('私密'); expect(message).toContain('未自动重放');
  });
});
