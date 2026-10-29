import { extractMainProductionFunction } from './main-production-function';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { resolveFileToken } from '../../src/main/fileTokens';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';

/** 运行主进程真实 dispatch 原文，只替换数据库进程投递及存储边界。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = extractMainProductionFunction(source, 'dispatch');
  const request = vi.fn(async () => ({ rows: 1 })), release = vi.fn(), acquire = vi.fn(async () => release), tasks = new Map();
  const context = createContext({ Date, Map, Set, Error, files: new Map([['输入', { path: '/授权/输入.xlsx', purpose: 'import', format: 'xlsx' }], ['输出', { path: '/授权/输出.xlsx', purpose: 'export', format: 'xlsx' }], ['旧格式', { path: '/授权/旧.csv', purpose: 'import', format: 'csv' }]]),
    tasks, completionTasks: new Set(), preparingTasks: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), sessions: new Map(), savedQueryPages: undefined, historyPages: undefined,
    connectionConfig: { assertAvailable() {} }, resolveFileToken, store: { saveTask() {} }, exportReservations: { acquire }, broker: { request }, taskEvent(event: { taskId: string; status: string }) { tasks.set(event.taskId, event); }
  });
  Object.assign(context, { SavedQuerySearchCancelled });
  runInContext(ts.transpileModule(dispatch + '\nglobalThis.dispatch = dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { request, release, acquire, dispatch: context.dispatch as (command: string, input: unknown) => Promise<unknown> };
}

describe('Excel 公开命令与主进程文件授权', () => {
  it('公开白名单齐全，拒绝路径、旧格式及非法表头行', () => {
    const input = { fileToken: '输入', taskId: '读取', sheetId: '1', protocol: 'plain' };
    expect(validateCommand('excel.preview', input)).toEqual(input);
    for (const command of ['excel.sheets', 'excel.preview', 'excel.import', 'excel.export'] as const) expect(publicCommands[command]).toBe(true);
    for (const extra of [{ filePath: '/绕过授权' }, { format: 'xls' }, { headerRow: 0 }, { headerRow: 1001 }, { protocol: '公式缓存' }, { cellBudget: 6 }]) expect(() => validateCommand('excel.preview', { ...input, ...extra })).toThrow('参数无效');
    expect(() => validateCommand('excel.export', { connectionId: 'c', database: 'd', table: 't', fileToken: '输出', taskId: 't', scope: '当前筛选' })).toThrow();
  });
  it('重复映射与非 SHA256 指纹不能进入引擎', () => {
    const input = { connectionId: 'c', database: 'd', table: 't', fileToken: '输入', taskId: 't', sheetId: '1', protocol: 'plain', fingerprint: 'a'.repeat(64), mapping: [{ source: 'a', target: 'b' }] };
    expect(() => validateCommand('excel.import', input)).not.toThrow();
    expect(() => validateCommand('excel.import', { ...input, mapping: [...input.mapping, ...input.mapping] })).toThrow();
    expect(() => validateCommand('excel.import', { ...input, fingerprint: '随意值' })).toThrow();
  });
  it.each(['excel.sheets', 'excel.preview', 'excel.import'])('%s 只能用 XLSX 导入令牌，路径由主进程注入', async command => {
    const f = fixture(); await f.dispatch(command, { fileToken: '输入', taskId: command });
    expect(f.request).toHaveBeenCalledWith(command, expect.objectContaining({ filePath: '/授权/输入.xlsx' }));
    await expect(f.dispatch(command, { fileToken: '输出' })).rejects.toThrow('文件访问未授权');
    await expect(f.dispatch(command, { fileToken: '旧格式' })).rejects.toThrow('文件类型未授权');
    expect(f.acquire).not.toHaveBeenCalled();
  });
  it('导出必须使用 XLSX 保存令牌并复用全局目标锁，失败也释放', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(Error('模拟失败') as never);
    await expect(f.dispatch('excel.export', { fileToken: '输出', taskId: '导出' })).rejects.toThrow('模拟失败');
    expect(f.acquire).toHaveBeenCalledWith('/授权/输出.xlsx'); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('导入错误只在当前窗口展示，不将字段值与数据库错误持久化到任务摘要', () => {
    expect(persistedTaskMessage('excel.import', { taskId: 't', status: 'failed', progress: 0, message: '重复键包含私密内容' })).not.toContain('私密内容');
  });
});
