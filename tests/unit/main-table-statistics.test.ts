import { extractMainProductionFunction } from './main-production-function';
import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 直接执行真实Main分派，仅以RAM代替Electron、存储和broker传输。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], saves = vi.fn(), history = vi.fn(); let revision = 11;
  const profile = { id: 'connection', password: '仅内存合成凭据' }, request = vi.fn(async (_command: string, _input: any): Promise<any> => ({ rowCount: '18446744073709551615' })), assertAvailable = vi.fn();
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(), Date, Map, Set, Error, SavedQuerySearchCancelled, tableApplyReceipts: undefined, savedQueryPages: undefined, historyPages: undefined, savedQuerySearches: { has: () => false }, tasks,
    completionTasks: new Set(), pendingQueryHistory: new Map(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), sessions: new Map(), tablePresetReads: new Map(), shuttingDown: false,
    connectionConfig: { assertAvailable }, store: { saveTask: saves, addHistory: history, connectionRevision: () => revision, resolveConnection: (id: string) => { if (id !== profile.id) throw Error('未知连接'); return profile; } }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(extractMainProductionFunction(source, 'dispatch') + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, request, tasks, events, saves, history, profile, assertAvailable, revise: () => { revision++; }, dispatch: context.dispatch as (command: string, input: any) => Promise<any> };
}
const input = { connectionId: 'connection', database: '库', table: '表', taskId: 'statistics', columns: ['金额'], filters: [] };
describe('表数据统计Main实际分派与公开参数（仅RAM）', () => {
  it('注入Main可信配置且精确数值原样返回；独立任务落概要，不写SQL执行历史', async () => {
    const f = fixture(); await expect(f.dispatch('table.statistics', input)).resolves.toEqual({ rowCount: '18446744073709551615' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('table.statistics', { ...input, profile: f.profile }); expect(f.assertAvailable).toHaveBeenCalledWith('connection');
    expect(f.saves).toHaveBeenCalledOnce(); expect(f.tasks.get(input.taskId)).toMatchObject({ status: 'completed', kind: 'table.statistics' }); expect(f.history).not.toHaveBeenCalled(); expect(f.context.preparingTasks.size).toBe(0);
  });
  it('取消ACK不释放原读取编号，原Promise失败后才结算且不自动重发', async () => {
    const f = fixture(); let reject!: (reason: Error) => void; f.request.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    const pending = f.dispatch('table.statistics', input), failure = expect(pending).rejects.toThrow('原统计已取消');
    await f.dispatch('query.cancel', { taskId: input.taskId }); expect(f.tasks.get(input.taskId)?.status).toBe('running');
    await expect(f.dispatch('table.statistics', input)).rejects.toThrow('编号'); expect(f.request.mock.calls.map(call => call[0])).toEqual(['table.statistics', 'query.cancel']);
    reject(Error('原统计已取消')); await failure; expect(f.tasks.get(input.taskId)?.status).toBe('failed'); expect(f.context.preparingTasks.size).toBe(0);
  });
  it.each(['revision', 'shutdown'])('%s变化拒绝迟到聚合，不把旧结果发布到新连接', async cause => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { if (cause === 'revision') f.revise(); else f.context.shuttingDown = true; return { rowCount: '2' }; });
    await expect(f.dispatch('table.statistics', input)).rejects.toThrow('已变化'); expect(f.request).toHaveBeenCalledOnce(); expect(f.tasks.get(input.taskId)?.status).toBe('failed'); expect(f.history).not.toHaveBeenCalled();
  });
  it.each(['shutdown', 'locked'])('%s准入零投递，不能占用用户事务或发聚合', async cause => {
    const f = fixture(); if (cause === 'shutdown') f.context.shuttingDown = true; else f.assertAvailable.mockImplementation(() => { throw Error('连接配置保存锁'); });
    await expect(f.dispatch('table.statistics', input)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
  });
  it('公开输入支持零字段COUNT、精确多条件筛选，拒绝分页、SQL和传输注入', () => {
    expect(Object.hasOwn(publicCommands, 'table.statistics')).toBe(true); expect(validateCommand('table.statistics', { ...input, columns: [] })).toEqual({ ...input, columns: [] });
    const filtered = { ...input, filters: [{ column: '金额', operator: '=', value: '9007199254740993.123456789012', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [0] } };
    expect(validateCommand('table.statistics', filtered)).toEqual(filtered);
    for (const patch of [{ sql: 'SELECT 1' }, { profile: {} }, { sessionId: '用户事务' }, { page: 1 }, { pageSize: 50 }, { sort: [] }, { columns: Array.from({ length: 13 }, (_, index) => '列' + index) }, { columns: ['金额', '金额'] }, { filters: [{ column: '金额', operator: 'IN', values: [] }] }, { filterMode: 'any', filterGroup: { mode: 'all', children: [] } }]) expect(() => validateCommand('table.statistics', { ...input, ...patch })).toThrow();
  });
  it('不同值开关只接受显式布尔，Main原样透传且不创建查询历史', async () => {
    const distinctInput = { ...input, distinct: true }; expect(validateCommand('table.statistics', distinctInput)).toEqual(distinctInput);
    expect(validateCommand('table.statistics', { ...input, distinct: false })).toEqual({ ...input, distinct: false });
    for (const distinct of ['true', 1, null, {}, []]) expect(() => validateCommand('table.statistics', { ...input, distinct })).toThrow();
    const f = fixture(); await f.dispatch('table.statistics', distinctInput); expect(f.request).toHaveBeenCalledExactlyOnceWith('table.statistics', { ...distinctInput, profile: f.profile }); expect(f.history).not.toHaveBeenCalled();
  });
  it('任务概要全部状态都不保存筛选、聚合数值或驱动错误原文', () => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const message = persistedTaskMessage('table.statistics', { taskId: 't', status, progress: 0, message: '私密金额=18446744073709551615 SUM=999 驱动凭据' });
      expect(message).toContain('统计'); for (const secret of ['私密金额', '18446744073709551615', 'SUM=999', '驱动凭据']) expect(message).not.toContain(secret);
    }
  });
});
