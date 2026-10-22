import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { queryDatabasePatch } from '../../src/shared/queryContext';
import { persistedQueryError, persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { HistoryEntry, TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 执行Main原分派和原事件函数，只替换IO边界，不在夹具中重写成功/失败规则。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const event = source.slice(source.indexOf('function taskEvent('), source.indexOf('/** 文件只能'));
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const entries: HistoryEntry[] = [], persisted: TaskRecord[] = [], sent: TaskEvent[] = [];
  const request = vi.fn<(...args: any[]) => Promise<any>>(async () => ({}));
  const context = createContext({
    tableApplyReceipts: undefined, SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined,
    Date, Map, Set, Error, randomUUID, queryDatabasePatch, persistedQueryError, persistedTaskMessage,
    window: { isDestroyed: () => false, webContents: { send(_channel: string, value: TaskEvent) { sent.push(structuredClone(value)); } } },
    tasks: new Map(), pendingQueryHistory: new Map(), completionTasks: new Set(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), lastPersist: new Map(), files: new Map(),
    sessions: new Map([['original', { connectionId: 'source', database: '旧默认库' }]]), connectionConfig: { assertAvailable() {} },
    store: { saveTask(value: TaskRecord) { persisted.push(structuredClone(value)); }, addHistory(value: HistoryEntry) { entries.push(structuredClone(value)); } },
    persistAuxiliary: (action: () => void) => action(), broker: { request },
    resolveFileToken: () => '/selected/export.json', exportReservations: { acquire: async () => () => {} }
  });
  runInContext(ts.transpileModule(event + dispatch + '\nglobalThis.handlers={dispatch,taskEvent}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const handlers = context.handlers as { dispatch(command: string, input: unknown): Promise<any>; taskEvent(event: TaskEvent): void };
  return { context, handlers, request, entries, persisted, sent };
}

const input = { sessionId: 'original', taskId: 'original-task', sql: 'SELECT 1;SELECT 缺失对象;UPDATE 不应执行 SET n=1', maxRows: 10 };
const failure = { statementOrdinal: 2, statementsCompleted: 1, message: '第2条未完成；参数秘密原文不得落盘' };
const prefix = { columns: [{ key: 'c0', name: '原列', type: 'LONGLONG' }], rows: [{ c0: '18446744073709551615' }], statement: 'SELECT 1', truncated: false };

describe('带前缀结果的查询失败仍真实落失败历史和任务', () => {
  it.each(['query.execute', 'query.executeParameterized'])('%s的原结果透传、真实上下文及失败历史只写一次，不追加broker请求', async command => {
    const f = fixture(), result = { results: [prefix], elapsedMs: 4, failure };
    f.request.mockImplementationOnce(async () => {
      f.handlers.taskEvent({ taskId: input.taskId, status: 'running', progress: 0, message: '原执行', executionDatabase: { state: 'known', database: '实际原库' } });
      f.handlers.taskEvent({ taskId: input.taskId, status: 'failed', progress: 100, message: failure.message }); return result;
    });
    expect(await f.handlers.dispatch(command, input)).toBe(result);
    expect(f.request).toHaveBeenCalledOnce(); expect(f.entries).toHaveLength(1); expect(f.entries[0]).toMatchObject({ success: false, sql: input.sql, database: '实际原库' });
    expect(f.entries[0].error).toBe(command === 'query.executeParameterized' ? persistedQueryError(command, failure.message) : failure.message);
    expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.sent.filter(value => value.status === 'failed')).toHaveLength(1);
    expect(f.context.pendingQueryHistory.size).toBe(0); expect(f.context.preparingTasks.size).toBe(0);
    if (command === 'query.executeParameterized') expect(JSON.stringify([f.entries, f.persisted])).not.toContain('参数秘密原文');
  });
  it.each(['running', 'completed'])('没有failed事件而原终态为%s时，返回失败不能被误写为已完成', async status => {
    const f = fixture(); f.request.mockImplementationOnce(async () => {
      f.handlers.taskEvent({ taskId: input.taskId, status: status as TaskEvent['status'], progress: 100, message: '旧事件' });
      return { results: [prefix], elapsedMs: 1, failure };
    });
    await f.handlers.dispatch('query.execute', input); expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.entries[0].success).toBe(false);
  });
  it('当前语句已投递只保存原片段；发送前拒绝不保存全文或空SQL', async () => {
    const f = fixture(), current = { ...input, currentStatement: { offset: 10 } };
    f.request.mockImplementationOnce(async () => ({ results: [], elapsedMs: 0, failure: { ...failure, statementOrdinal: 1, statementsCompleted: 0 } }));
    await f.handlers.dispatch('query.execute', current); expect(f.entries).toEqual([]);
    f.request.mockImplementationOnce(async () => {
      f.handlers.taskEvent({ taskId: 'sent', status: 'running', progress: 0, message: '原片段', executionSql: 'SELECT 原片段' });
      return { results: [], elapsedMs: 0, failure: { ...failure, statementOrdinal: 1, statementsCompleted: 0 } };
    });
    await f.handlers.dispatch('query.execute', { ...current, taskId: 'sent' }); expect(f.entries).toHaveLength(1); expect(f.entries[0]).toMatchObject({ sql: 'SELECT 原片段', success: false });
  });
  it('取消/断线拒绝仍走原catch，不被改为完成或制造返回结果', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(Error('原取消未完成'));
    await expect(f.handlers.dispatch('query.execute', input)).rejects.toThrow('原取消未完成'); expect(f.entries[0].success).toBe(false); expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.request).toHaveBeenCalledOnce();
  });
  it('完整成功响应保持success且没有伪造failure字段', async () => {
    const f = fixture(), result = { results: [prefix], elapsedMs: 1, transactionOpen: false }; f.request.mockResolvedValueOnce(result);
    expect(await f.handlers.dispatch('query.execute', input)).toBe(result); expect(result).not.toHaveProperty('failure'); expect(f.entries[0]).toMatchObject({ success: true }); expect(f.context.tasks.get(input.taskId).status).toBe('completed');
  });
});
