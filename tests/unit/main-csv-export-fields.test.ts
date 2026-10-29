import { extractMainProductionFunction } from './main-production-function';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
/** 执行真实main分派，仅替换broker、授权文件令牌与配置锁RAM端口。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), body = extractMainProductionFunction(source, 'dispatch');
  const tasks = new Map(), broker = { request: vi.fn(async (_command: string, _input: unknown) => ({})) }, available = vi.fn(), reserve = vi.fn(async () => () => {});
  const context = createContext({ SavedQuerySearchCancelled, tableApplyReceipts: undefined, tasks, structureTokens: new Map(), structureProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable: available }, savedQueryPages: undefined, historyPages: undefined, completionTasks: new Set(), shuttingDown: false, store: { connectionRevision: () => 11, saveTask() {} }, preparingTasks: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), broker, files: new Map(), resolveFileToken: () => '授权路径', exportReservations: { acquire: reserve }, taskEvent: (event: { taskId: string; status: string }) => tasks.set(event.taskId, { ...tasks.get(event.taskId), status: event.status }) });
  runInContext(ts.transpileModule(body + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { dispatch: context.dispatch as (command: string, input: unknown) => Promise<unknown>, broker, available, reserve };
}
describe('CSV目录修订与原文件令牌接线', () => {
  it('只有目录读取和CSV选择注入可信修订，仍通过原文件授权与写入租约', async () => {
    const value = harness(); await value.dispatch('files.exportColumns', { connectionId: 'c', database: 'db', table: 't', taskId: 'read' }); expect(value.broker.request.mock.calls.at(-1)?.[1]).toMatchObject({ connectionRevision: 11 });
    await value.dispatch('files.export', { connectionId: 'c', database: 'db', table: 't', fileToken: 'f', taskId: 'export', format: 'csv', csvSelection: { catalogId: 'catalog', columns: ['id'] } });
    expect(value.broker.request.mock.calls.at(-1)?.[1]).toMatchObject({ filePath: '授权路径', connectionRevision: 11 }); expect(value.reserve).toHaveBeenCalledOnce();
    await value.dispatch('files.export', { connectionId: 'c', database: 'db', table: 't', fileToken: 'f', taskId: 'legacy', format: 'json' }); expect(value.broker.request.mock.calls.at(-1)?.[1]).not.toHaveProperty('connectionRevision');
  });
  it('目录释放不建立新任务或被保存锁挡住，不释放其他结构用途', async () => {
    const value = harness(); value.available.mockImplementation(() => { throw Error('配置保存中'); }); await value.dispatch('files.releaseExportColumns', { catalogId: 'catalog' }); expect(value.available).not.toHaveBeenCalled(); expect(value.broker.request).toHaveBeenCalledWith('files.releaseExportColumns', { catalogId: 'catalog' }); expect(value.reserve).not.toHaveBeenCalled();
  });
});
