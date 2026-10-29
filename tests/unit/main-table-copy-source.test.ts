import { extractMainProductionFunction } from './main-production-function';
import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

/** 执行生产dispatch，只替换Electron/SQLite和进程边界，不运行客户端或建连。 */
function fixture() {
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), dispatch = extractMainProductionFunction(text, 'dispatch');
  const saves = vi.fn(), history = vi.fn(), request = vi.fn(async (_command: string, _input: unknown) => ({ complete: true })), assertAvailable = vi.fn();
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(), Error, Date, Map, Set, structureTokens: new Map(), structureProgress: new Map(), exportProgress: new Map(), tasks: new Map(), completionTasks: new Set(), tablePresetReads: new Map(), shuttingDown: false, savedQueryPages: undefined, historyPages: undefined, savedQuerySearches: { has: () => false }, preparingTasks: new Map(), sessions: new Map(), connectionConfig: { assertAvailable }, store: { resolveConnection: (id: string) => ({ id, password: '受控凭据' }), saveTask: saves, addHistory: history }, broker: { request } });
  runInContext(ts.transpileModule(dispatch + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, saves, history, request, assertAvailable, dispatch: context.dispatch as (command: string, input: Record<string, unknown>) => Promise<unknown> };
}
describe('主进程表复制源瞬时请求', () => {
  it('释放直接交给引擎，配置锁/退出也不创建SQLite记录或数据库请求', async () => { const f = fixture(); f.context.shuttingDown = true; const input = { connectionId: 'conn', pageRef: 'page' }; await f.dispatch('table.copySourceRelease', input); expect(f.request).toHaveBeenCalledWith('table.copySourceRelease', input); expect(f.assertAvailable).not.toHaveBeenCalled(); expect(f.saves).not.toHaveBeenCalled(); expect(f.history).not.toHaveBeenCalled(); });
  it.each(['table.page', 'table.copySourceRead'])('%s只在内存占号，注入可信配置，不写任务/历史', async command => {
    const f = fixture(), input = { connectionId: 'conn', taskId: 'copy', ...(command === 'table.page' ? { copySource: true } : { pageRef: 'page', rowRef: 'row' }) };
    expect(await f.dispatch(command, input)).toEqual({ complete: true }); expect(f.request).toHaveBeenCalledWith(command, { ...input, profile: { id: 'conn', password: '受控凭据' } }); expect(f.saves).not.toHaveBeenCalled(); expect(f.history).not.toHaveBeenCalled(); expect(f.context.tasks.size).toBe(0); expect(f.context.completionTasks.size).toBe(0); expect(f.assertAvailable).toHaveBeenCalledWith('conn');
  });
  it('未结束读取收到query.cancel后仍占号，失败后才释放，不保存完整行值', async () => {
    const f = fixture(); let reject!: (error: Error) => void; f.request.mockImplementationOnce(() => new Promise((_, rejectTask) => { reject = rejectTask; }));
    const pending = f.dispatch('table.copySourceRead', { connectionId: 'conn', taskId: 'copy', pageRef: 'page', rowRef: 'row' }).catch(error => error); expect(f.context.completionTasks.has('copy')).toBe(true);
    await f.dispatch('query.cancel', { taskId: 'copy' }); expect(f.request.mock.calls[1]).toEqual(['query.cancel', { taskId: 'copy' }]); expect(f.context.completionTasks.has('copy')).toBe(true);
    await expect(f.dispatch('table.page', { connectionId: 'conn', copySource: true, taskId: 'copy' })).rejects.toThrow('编号'); reject(new Error('受控失败')); await pending; expect(f.context.completionTasks.size).toBe(0); expect(f.saves).not.toHaveBeenCalled(); expect(f.history).not.toHaveBeenCalled();
  });
  it.each(['shutdown', 'busy', 'duplicate'])('%s在发送引擎前拒绝', async condition => { const f = fixture(); if (condition === 'shutdown') f.context.shuttingDown = true; else if (condition === 'busy') for (let i = 0; i < 8; i++) f.context.completionTasks.add('t' + i); else f.context.tasks.set('copy', {}); await expect(f.dispatch('table.copySourceRead', { connectionId: 'conn', taskId: 'copy' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled(); });
});
