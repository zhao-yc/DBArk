import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedQueryError, persistedTaskMessage } from '../../src/main/taskPrivacy';
import { queryDatabasePatch } from '../../src/shared/queryContext';
import { assertQueryDatabaseSwitchOutput, queryDatabaseSwitchMessages, type QueryDatabaseSwitchInput, type QueryDatabaseSwitchOutput } from '../../src/shared/queryDatabaseSwitch';
import type { HistoryEntry, TaskEvent, TaskRecord } from '../../src/shared/contracts';

const input: QueryDatabaseSwitchInput = { sessionId: '原会话', taskId: '原切库任务', database: '新库', expectedContext: { state: 'known', database: '旧库' } };
const output: QueryDatabaseSwitchOutput = { sessionId: input.sessionId, taskId: input.taskId, database: input.database, completion: { database: input.database, databaseKnown: true, broken: false, busy: false }, transactionKnown: true, transactionOpen: true, unchanged: false };

/** 提取真实Main分派和任务事件，仅替换持久化及Engine IO，不重写产品路由。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const event = source.slice(source.indexOf('function taskEvent('), source.indexOf('/** 文件只能'));
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const entries: HistoryEntry[] = [], persisted: TaskRecord[] = [], sent: TaskEvent[] = [];
  const request = vi.fn<(...args: any[]) => Promise<any>>(async () => output);
  const available = vi.fn<(...args: any[]) => void>(() => {});
  const resolveConnection = vi.fn((): never => { throw Error('切库不得读取或注入连接凭据'); });
  const context = createContext({
    tableApplyReceipts: undefined, SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined,
    Date, Map, Set, Error, randomUUID, queryDatabasePatch, persistedQueryError, persistedTaskMessage, assertQueryDatabaseSwitchOutput, queryDatabaseSwitchMessages,
    shuttingDown: false,
    window: { isDestroyed: () => false, webContents: { send(_channel: string, value: TaskEvent) { sent.push(structuredClone(value)); } } },
    tasks: new Map(), pendingQueryHistory: new Map(), completionTasks: new Set(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), lastPersist: new Map(), files: new Map(),
    sessions: new Map([[input.sessionId, { connectionId: '真实连接' }]]), connectionConfig: { assertAvailable: available },
    store: { resolveConnection, saveTask(value: TaskRecord) { persisted.push(structuredClone(value)); }, addHistory(value: HistoryEntry) { entries.push(structuredClone(value)); } },
    persistAuxiliary: (action: () => void) => action(), broker: { request },
  });
  runInContext(ts.transpileModule(event + dispatch + '\nglobalThis.handlers={dispatch,taskEvent}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const handlers = context.handlers as { dispatch(command: string, input: unknown): Promise<any>; taskEvent(event: TaskEvent): void };
  return { context, handlers, request, available, resolveConnection, entries, persisted, sent };
}

describe('Main切库绑定原session并保留任务与历史边界', () => {
  it('一次转发专用命令，锁使用Main真实连接，任务完成且不产生SQL历史或凭据', async () => {
    const f = fixture();
    expect(await f.handlers.dispatch('query.databaseSwitch', input)).toBe(output);
    expect(f.request).toHaveBeenCalledExactlyOnceWith('query.databaseSwitch', input);
    expect(f.available.mock.calls.every(([connectionId]) => connectionId === '真实连接')).toBe(true);
    expect(f.available).toHaveBeenCalledTimes(2); expect(f.resolveConnection).not.toHaveBeenCalled();
    expect(f.context.tasks.get(input.taskId)).toMatchObject({ id: input.taskId, kind: 'query.databaseSwitch', status: 'completed' });
    expect(f.entries).toEqual([]); expect(f.context.pendingQueryHistory.size).toBe(0); expect(f.context.preparingTasks.size).toBe(0);
    expect(JSON.stringify(f.persisted)).not.toContain('USE');
  });
  it('不存在的原session、退出和真实连接保存锁均零转发', async () => {
    const missing = fixture(); missing.context.sessions.clear();
    await expect(missing.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('已关闭');
    expect(missing.request).not.toHaveBeenCalled(); expect(missing.context.tasks.size).toBe(0);
    const closing = fixture(); closing.context.shuttingDown = true;
    await expect(closing.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('退出'); expect(closing.request).not.toHaveBeenCalled();
    const blocked = fixture(); blocked.available.mockImplementation(() => { throw Error('真实连接正在保存'); });
    await expect(blocked.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('正在保存'); expect(blocked.request).not.toHaveBeenCalled();
  });
  it('准备阶段原session被同名替换，仍拒绝投递并清理原任务准备表', async () => {
    const f = fixture(), saveTask = f.context.store.saveTask;
    f.context.store.saveTask = (task: TaskRecord) => { saveTask(task); if (task.status === 'running') f.context.sessions.set(input.sessionId, { connectionId: '真实连接' }); };
    await expect(f.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('已关闭');
    expect(f.request).not.toHaveBeenCalled(); expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.context.preparingTasks.size).toBe(0);
  });
  it('重用已有任务编号零投递，不改写原任务', async () => {
    const f = fixture(), original = { id: input.taskId, kind: 'query.execute', status: 'completed' };
    f.context.tasks.set(input.taskId, original);
    await expect(f.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('已使用');
    expect(f.request).not.toHaveBeenCalled(); expect(f.context.tasks.get(input.taskId)).toBe(original);
  });
  it('Engine拒绝或丢失ACK只失败一次，不探测、重发、重连或制造查询历史', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(Error(queryDatabaseSwitchMessages.unconfirmed));
    await expect(f.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('待确认');
    expect(f.request).toHaveBeenCalledOnce(); expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.entries).toEqual([]);
    expect(f.context.pendingQueryHistory.size).toBe(0); expect(f.context.preparingTasks.size).toBe(0); expect(f.resolveConnection).not.toHaveBeenCalled();
  });
  it.each(['running', 'completed'] as const)('原任务事件为%s时，错误session ACK不得被记成成功或应用到新任务', async status => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => {
      f.handlers.taskEvent({ taskId: input.taskId, status, progress: 100, message: '原任务事件' });
      return { ...output, sessionId: '其它会话' };
    });
    await expect(f.handlers.dispatch('query.databaseSwitch', input)).rejects.toThrow('待确认');
    expect(f.context.tasks.get(input.taskId).status).toBe('failed'); expect(f.context.tasks.has('其它会话')).toBe(false);
    expect(f.sent.filter(event => event.status === 'failed')).toHaveLength(1); expect(f.request).toHaveBeenCalledOnce(); expect(f.entries).toEqual([]);
  });
  it('已确认的原ACK在退出开始后仍归原任务，Main不吞掉服务器事实或重发', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { f.context.shuttingDown = true; return output; });
    expect(await f.handlers.dispatch('query.databaseSwitch', input)).toBe(output);
    expect(f.context.tasks.get(input.taskId).status).toBe('completed'); expect(f.request).toHaveBeenCalledOnce();
  });
});
