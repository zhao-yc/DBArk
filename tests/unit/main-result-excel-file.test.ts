import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { resolveFileToken, type SelectedFile } from '../../src/main/fileTokens';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';

/** 执行真实Main分派和令牌验证，只有持久化及引擎端口使用RAM替身。 */
function harness(file?: SelectedFile) {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const tasks = new Map(), files = new Map(file ? [['selected', file]] : []), request = vi.fn(async () => ({ rows: 2 })), reserve = vi.fn(async () => () => {});
  const context = createContext({ SavedQuerySearchCancelled, tableApplyReceipts: undefined, tasks, structureTokens: new Map(), structureProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable() {} }, savedQueryPages: undefined, historyPages: undefined, completionTasks: new Set(), shuttingDown: false, store: { saveTask() {} }, preparingTasks: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), broker: { request }, files, resolveFileToken, exportReservations: { acquire: reserve }, taskEvent: (event: any) => tasks.set(event.taskId, { ...tasks.get(event.taskId), status: event.status }) });
  runInContext(ts.transpileModule(body + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { request, reserve, dispatch: () => (context.dispatch as any)('files.exportResult', { fileToken: 'selected', taskId: 'excel-task', format: 'xlsx', encoding: 'utf8', filePath: '渲染器不能提供的路径', result: { columns: [{ key: 'c0', name: '值' }], rows: [{ c0: '1' }], truncated: false } }) };
}

it.each([undefined, { path: '旧.csv', purpose: 'export', format: 'csv' }, { path: '旧.xlsx', purpose: 'import', format: 'xlsx' }, { path: '旧.xlsx', purpose: 'export' }])('XLSX拒绝非本窗口Excel导出选择%j，原引擎与预留均未调用', async file => {
  const f = harness(file); await expect(f.dispatch()).rejects.toThrow('未授权'); expect(f.request).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
});
it('只沿原Excel令牌注入Main路径并取得原写入预留，不建立数据库会话', async () => {
  const f = harness({ path: '本轮准确.xlsx', purpose: 'export', format: 'xlsx' }); await expect(f.dispatch()).resolves.toEqual({ rows: 2 });
  expect(f.reserve).toHaveBeenCalledWith('本轮准确.xlsx'); expect(f.request).toHaveBeenCalledOnce();
  expect(f.request.mock.calls[0]).toEqual(['files.exportResult', expect.objectContaining({ format: 'xlsx', filePath: '本轮准确.xlsx' })]);
});
