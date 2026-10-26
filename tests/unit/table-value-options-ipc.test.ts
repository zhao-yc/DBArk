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

const input = { connectionId: 'connection', database: '库', table: '表', column: '金额', taskId: 'value-options', filters: [] };

/** 直接执行生产dispatch及AST定位的真实IPC回调，仅替换Electron、RAM存储与进程传输。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function dispatch('), end = source.indexOf('/** 按平台生成中文原生菜单');
  if (start < 0 || end <= start) throw Error('生产分派入口已变化');
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true); let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ipcMain' && node.expression.name.text === 'handle' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'dbark:request' && ts.isArrowFunction(node.arguments[1])) callback = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree); if (!callback) throw Error('生产IPC请求入口已变化');
  let revision = 11, documentCurrent = true;
  const owner = { owner: { document: {} } }, profile = { id: 'connection', password: '仅内存合成凭据' };
  const tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], saves = vi.fn(), history = vi.fn(), assertAvailable = vi.fn();
  const request = vi.fn(async (_command: string, _input: any): Promise<any> => ({ values: [{ value: '9007199254740993', count: '18446744073709551615' }] }));
  const frame = { url: 'dbark-test:renderer' }, webContents = { mainFrame: frame };
  const assertCapturedOwner = vi.fn((value: unknown) => { if (value !== owner || !documentCurrent) throw Error('原主文档已变化'); });
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(),
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false },
     Date, Map, Set, Error, SavedQuerySearchCancelled, tableApplyReceipts: undefined, savedQueryPages: undefined, historyPages: undefined, savedQuerySearches: { has: () => false }, tasks,
    completionTasks: new Set(), pendingQueryHistory: new Map(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), sessions: new Map(), tablePresetReads: new Map(), tableValueOptionsConnectionOwners: new Map(), tableValueOptionsClosing: new Map(), shuttingDown: false,
    localSearchOperations: new Set(), queryFileOperations: new Set(), window: { webContents }, rendererURL: frame.url,
    columnsMain: { capture: () => owner, assertCapturedOwner, hasUnpublished: () => false },
    connectionConfig: { assertAvailable }, store: { saveTask: saves, addHistory: history, connectionRevision: () => revision, resolveConnection: (id: string) => { if (id !== profile.id) throw Error('未知连接'); return profile; } }, broker: { request },
    validateMainCommand: validateCommand,
    taskEvent(event: TaskEvent) { events.push(event); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(source.slice(start, end) + '\nglobalThis.dispatch=dispatch;\nglobalThis.handleRequest=' + callback.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, owner, request, tasks, events, saves, history, profile, assertAvailable, assertCapturedOwner, revise: () => { revision++; }, navigate: () => { documentCurrent = false; },
    dispatch: (value = input) => (context.dispatch as any)('table.valueOptions', value, owner),
    ipc: (value: unknown = input) => (context.handleRequest as any)({ sender: webContents, senderFrame: frame }, { command: 'table.valueOptions', input: value }),
  };
}

describe('表服务器不同值的严格IPC及Main实际发布路径', () => {
  it('公开命令只接收目标列、原筛选及显式LIKE模式，不接受SQL或可信配置注入', () => {
    expect(publicCommands['table.valueOptions']).toBe(true);
    const valid = { ...input, searchPattern: '  %精确_模式  ', filters: [{ column: '金额', operator: 'IN', values: ['9007199254740993.000000000001', ''], enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [0] } };
    expect(validateCommand('table.valueOptions', valid)).toEqual(valid);
    for (const patch of [{ sql: 'SELECT 1' }, { profile: {} }, { sessionId: '用户事务' }, { page: 1 }, { sort: [] }, { limit: 500 }, { columns: ['金额'] }, { column: '' }, { searchPattern: 'a'.repeat(257) }, { searchPattern: '\ud800' }, { searchPattern: 1 }, { filterMode: 'unknown' }, { filters: [{ column: '金额', operator: 'RAW', value: '1' }] }, { filters: [{ column: '金额', operator: 'IN', values: [] }] }, { filters: [{ column: '金额', operator: 'IS NULL', value: '' }] }, { filterMode: 'any', filterGroup: { mode: 'all', children: [] } }]) expect(() => validateCommand('table.valueOptions', { ...input, ...patch })).toThrow();
    expect(validateCommand('table.valueOptions', { ...input, searchPattern: '😀'.repeat(256) })).toMatchObject({ searchPattern: '😀'.repeat(256) });
  });
  it('沿用全集筛选预算与原始分组门，不忽略停用条件、重复叶索引或getter', () => {
    const filters = Array.from({ length: 6 }, (_, index) => ({ column: '列' + index, operator: 'IN', values: Array.from({ length: 200 }, (_, i) => String(i)), enabled: false }));
    expect(() => validateCommand('table.valueOptions', { ...input, filters })).toThrow();
    expect(() => validateCommand('table.valueOptions', { ...input, filters: [{ column: '金额', operator: '=', value: '1' }], filterGroup: { mode: 'all', children: [0, 0] } })).toThrow();
    const getter = vi.fn(() => []), raw = { ...input }; Object.defineProperty(raw, 'filters', { enumerable: true, get: getter });
    expect(() => validateCommand('table.valueOptions', raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('Main注入可信profile，精度字符串原样返回，独立任务不写SQL历史', async () => {
    const f = fixture(); const result = await f.ipc();
    expect(result).toEqual({ ok: true, result: { values: [{ value: '9007199254740993', count: '18446744073709551615' }] } });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('table.valueOptions', { ...input, profile: f.profile }); expect(f.history).not.toHaveBeenCalled();
    expect(f.tasks.get(input.taskId)).toMatchObject({ kind: 'table.valueOptions', status: 'completed' }); expect(f.events[0].message).toBe('服务器不同值读取完成'); expect(f.assertCapturedOwner).toHaveBeenCalled(); expect(f.context.preparingTasks.size).toBe(0);
  });
  it.each(['revision', 'document', 'shutdown', 'closed'])('%s变化拒绝broker迟到响应，无自动重读', async cause => {
    const f = fixture(); f.request.mockImplementationOnce(async () => {
      if (cause === 'revision') f.revise(); else if (cause === 'document') f.navigate(); else if (cause === 'shutdown') f.context.shuttingDown = true; else f.assertAvailable.mockImplementation(() => { throw Error('原连接已关闭'); });
      return { values: [] };
    });
    const result = await f.ipc(); expect(result.ok).toBe(false); expect(result).not.toHaveProperty('result'); expect(f.request).toHaveBeenCalledOnce(); expect(f.history).not.toHaveBeenCalled(); expect(f.tasks.get(input.taskId)?.status).toBe('failed');
  });
  it.each(['revision', 'document', 'shutdown', 'closed'])('dispatch完成至IPC最后发布之间的%s变化仍拒绝候选', async cause => {
    const f = fixture(), dispatch = f.context.dispatch;
    f.context.dispatch = async (...args: unknown[]) => {
      const result = await (dispatch as any)(...args);
      if (cause === 'revision') f.revise(); else if (cause === 'document') f.navigate(); else if (cause === 'shutdown') f.context.shuttingDown = true; else f.assertAvailable.mockImplementation(() => { throw Error('原连接已关闭'); });
      return result;
    };
    expect((await f.ipc()).ok).toBe(false); expect(f.request).toHaveBeenCalledOnce(); expect(f.history).not.toHaveBeenCalled();
  });
  it('dispatch完成后真实close已结算仍使最后IPC门拒绝旧候选', async () => {
    const f = fixture(), dispatch = f.context.dispatch;
    f.context.dispatch = async (...args: unknown[]) => {
      const result = await (dispatch as any)(...args);
      if (args[0] === 'table.valueOptions') await (dispatch as any)('connections.close', { id: input.connectionId });
      return result;
    };
    expect((await f.ipc()).ok).toBe(false); expect(f.request.mock.calls.map(call => call[0])).toEqual(['table.valueOptions', 'connections.close']); expect(f.history).not.toHaveBeenCalled();
  });
  it('原任务已失败或取消时即使broker错误返回成功也不发布候选', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { f.tasks.set(input.taskId, { ...f.tasks.get(input.taskId)!, status: 'cancelled' }); return { values: [] }; });
    expect((await f.ipc()).ok).toBe(false); expect(f.request).toHaveBeenCalledOnce(); expect(f.tasks.get(input.taskId)?.status).toBe('cancelled');
  });
  it.each(['shutdown', 'locked', 'document'])('%s准入零投递，不创建任务或SQL历史', async cause => {
    const f = fixture(); if (cause === 'shutdown') f.context.shuttingDown = true; else if (cause === 'document') f.navigate(); else f.assertAvailable.mockImplementation(() => { throw Error('连接配置保存锁'); });
    expect((await f.ipc()).ok).toBe(false); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0); expect(f.saves).not.toHaveBeenCalled(); expect(f.history).not.toHaveBeenCalled();
  });
  it('严格参数校验先于引擎投递，未知profile与SQL注入不进入Main任务', async () => {
    const f = fixture(); expect((await f.ipc({ ...input, profile: { password: '禁止' }, sql: 'DROP DATABASE x' })).ok).toBe(false); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
  });
  it('原读取结束前取消ACK不释放编号，完成后同编号也不能自动重放', async () => {
    const f = fixture(); let reject!: (reason: Error) => void;
    f.request.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    const pending = f.dispatch(), failure = expect(pending).rejects.toThrow('原不同值读取已取消');
    await (f.context.dispatch as any)('query.cancel', { taskId: input.taskId });
    expect(f.tasks.get(input.taskId)?.status).toBe('running'); await expect(f.dispatch()).rejects.toThrow('编号');
    reject(Error('原不同值读取已取消')); await failure; expect(f.tasks.get(input.taskId)?.status).toBe('failed'); await expect(f.dispatch()).rejects.toThrow('编号');
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['table.valueOptions', 'query.cancel']); expect(f.history).not.toHaveBeenCalled(); expect(f.context.preparingTasks.size).toBe(0);
  });
  it('真实connections.close先同步撤销原代次，关闭期间拒绝新读取，原回包不能复活', async () => {
    const f = fixture(); let resolveRead!: (value: unknown) => void, resolveClose!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(yes => { resolveRead = yes; }));
    const read = f.dispatch(), failedRead = expect(read).rejects.toThrow('已变化');
    f.request.mockImplementationOnce(() => new Promise(yes => { resolveClose = yes; }));
    const close = (f.context.dispatch as any)('connections.close', { id: input.connectionId });
    await expect(f.dispatch({ ...input, taskId: 'during-close' })).rejects.toThrow('已变化');
    resolveClose(undefined); await close; resolveRead({ values: [] }); await failedRead;
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['table.valueOptions', 'connections.close']);
    await expect(f.dispatch({ ...input, taskId: 'fresh-after-close' })).resolves.toHaveProperty('values'); expect(f.history).not.toHaveBeenCalled();
  });
  it('真实关闭失败及同编号重开也不恢复旧来源；其他连接关闭不误伤候选', async () => {
    const f = fixture(); let resolveRead!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(yes => { resolveRead = yes; }));
    const read = f.dispatch(), failure = expect(read).rejects.toThrow('已变化');
    f.request.mockRejectedValueOnce(Error('关闭失败')); await expect((f.context.dispatch as any)('connections.close', { id: input.connectionId })).rejects.toThrow('关闭失败');
    await (f.context.dispatch as any)('connections.open', { id: input.connectionId }); resolveRead({ values: [] }); await failure;
    const other = fixture(); other.request.mockImplementationOnce(async () => { await (other.context.dispatch as any)('connections.close', { id: 'other' }); return { values: [] }; });
    await expect(other.dispatch()).resolves.toEqual({ values: [] });
  });
  it.each(['task', 'completion', 'saved', 'history'])('与%s编号冲突时零投递', async kind => {
    const f = fixture(); if (kind === 'task') f.tasks.set(input.taskId, {} as TaskRecord); else if (kind === 'completion') f.context.completionTasks.add(input.taskId); else f.context[kind === 'saved' ? 'savedQueryPages' : 'historyPages'] = { owns: () => true };
    await expect(f.dispatch()).rejects.toThrow('编号'); expect(f.request).not.toHaveBeenCalled();
  });
  it('所有状态的持久化概要都不保存搜索模式、候选、筛选或驱动错误', () => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const message = persistedTaskMessage('table.valueOptions', { taskId: 't', status, progress: 0, message: '私密筛选 LIKE %秘密_ 候选9007199254740993 驱动凭据' });
      expect(message).toContain('不同值'); expect(message).not.toContain('统计'); for (const secret of ['私密筛选', '%秘密_', '9007199254740993', '驱动凭据']) expect(message).not.toContain(secret);
    }
  });
});
