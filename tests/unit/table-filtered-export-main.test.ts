import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import { extractMainProductionBinding } from './main-production-function';
import { TableFilteredExportOwners } from '../../src/main/tableFilteredExportOwners';
import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { resolveFileToken } from '../../src/main/fileTokens';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { tableFilteredExportLimits, tableFilteredExportText } from '../../src/shared/tableFilteredExport';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';

const input = { connectionId: 'connection', database: '库', table: '表', taskId: 'filtered-export', fileToken: 'chosen', metadataKey: '原完整目录键', filters: [], sort: [], format: 'csv', encoding: 'utf8' };
/** 同一原Promise由测试明确结算，取消ACK与原导出完成分别控制。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

/** 执行生产Main分派和原AST IPC回调；真实文档能力及owner协调器，RAM替换存储、原生句柄与broker。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), start = source.indexOf('async function dispatch('), end = source.indexOf('/** 按平台生成中文原生菜单');
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true); let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ipcMain' && node.expression.name.text === 'handle' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'dbark:request' && ts.isArrowFunction(node.arguments[1])) callback = node.arguments[1]; ts.forEachChild(node, visit); }
  visit(tree); if (start < 0 || end <= start || !callback) throw Error('生产Main入口已变化');
  let revision = 11, locked = false;
  const frame = { url: 'dbark-test:renderer', detached: false, processId: 1, frameToken: 'original' }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false };
  const tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], saves = vi.fn(), history = vi.fn(), releaseTarget = vi.fn();
  const files = new Map([['chosen', { purpose: 'export', format: 'csv', path: 'RAM-owned.csv' }]]), profile = { id: 'connection', password: '合成凭据仅内存' };
  const request = vi.fn(async (_command: string, _value: any): Promise<any> => ({ rows: 1000001, fileCommitted: true })), acquire = vi.fn(async (_path: string): Promise<() => void> => releaseTarget);
  const assertAvailable = vi.fn(() => { if (locked) throw Error('连接配置保存锁'); });
  const columnsMain = new ColumnsMainCapabilities(new Map(), { currentWindow: () => window as any, rendererURL: frame.url, connectionRevision: () => revision, assertAvailable, shuttingDown: () => false, release: async () => {} }); columnsMain.trackWindow(window as any);
  const owner = columnsMain.capture({ sender: contents, senderFrame: frame } as any);
  let context: any;
  const owners = new TableFilteredExportOwners({ assert: value => columnsMain.assertCapturedOwner(value), same: (left, right) => columnsMain.sharesDocumentOwner(left, right), stop: async taskId => { const preparing = context.preparingTasks.get(taskId); if (preparing) { preparing.cancelled = true; return; } await request('query.cancel', { taskId }); } });
  context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), Error, AggregateError, Date, Map, Set, TableChecksMainCapabilities, tableChecksFailureProgress, tableFilteredExportText, tableFilteredExports: owners, columnsMain, files, resolveFileToken,
    tableApplyReceipts: undefined, savedQueryPages: undefined, historyPages: undefined, savedQuerySearches: { has: () => false }, tasks,
    completionTasks: new Set(), pendingQueryHistory: new Map(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), sessions: new Map(), tablePresetReads: new Map(), tableValueOptionsConnectionOwners: new Map(), tableValueOptionsClosing: new Map(), shuttingDown: false,
    localSearchOperations: new Set(), queryFileOperations: new Set(), window, rendererURL: frame.url,
    connectionConfig: { assertAvailable }, exportReservations: { acquire }, store: { saveTask: saves, addHistory: history, connectionRevision: () => revision, resolveConnection: (id: string) => { if (id !== profile.id) throw Error('未知连接'); return profile; } }, broker: { request }, validateMainCommand: validateCommand, SavedQuerySearchCancelled,
    taskEvent(event: TaskEvent) { events.push(event); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  // 未登记跨页写入能力；仍使用真实owner协调器，意外越界即由原broker哨兵拒绝。
  context.filteredUpdates = new TableFilteredUpdateOwners({ assert: value => columnsMain.assertCapturedOwner(value), same: (left, right) => columnsMain.sharesDocumentOwner(left, right), revision: () => revision, closing: () => false, available: assertAvailable, run: async () => { throw Error('导出夹具不登记填充任务'); }, release: async () => { throw Error('导出夹具不登记填充快照'); }, stop: async () => { throw Error('导出夹具不登记填充取消'); } });
  runInContext(ts.transpileModule(extractMainProductionBinding(source, 'tableChecksMain') + '\n' + source.slice(start, end) + '\nglobalThis.dispatch=dispatch;\nglobalThis.handleRequest=' + callback.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, tasks, events, saves, history, files, profile, request, acquire, releaseTarget, owners, owner, contents, assertAvailable,
    revise() { revision++; owners.observe(); }, lock(value: boolean) { locked = value; }, navigate() { contents.emit('did-navigate'); },
    dispatch: (value: any = input) => context.dispatch('table.exportFiltered', value, owner) as Promise<any>,
    ipc: (value: unknown = input) => context.handleRequest({ sender: contents, senderFrame: frame }, { command: 'table.exportFiltered', input: value }) as Promise<any>,
  };
}

describe('全部服务器筛选行导出的严格IPC', () => {
  it.each(['csv', 'json', 'sql', 'xlsx'])('%s仅接受元数据键与完整原筛选排序，不引入任意SQL或路径', format => {
    expect(publicCommands['table.exportFiltered']).toBe(true);
    const value = { ...input, format, filters: [{ column: '金额', operator: 'IN', values: ['9007199254740993.000000000001', ''], enabled: false }], filterMode: 'any', filterGroup: { mode: 'any', children: [0] }, sort: [{ column: '金额', direction: 'DESC' }] };
    expect(validateCommand('table.exportFiltered', value)).toEqual(value);
    for (const patch of [{ sql: 'SELECT 1' }, { filePath: '禁止' }, { profile: {} }, { connectionRevision: 1 }, { page: 2 }, { pageSize: 50 }, { includeStructure: true }, { scope: 'sample' }, { csvSelection: {} }, { metadataKey: '' }, { sort: [{ column: '金额', direction: 'bad' }] }, { sort: [{ column: '金额', direction: 'ASC' }, { column: '金额', direction: 'DESC' }] }]) expect(() => validateCommand('table.exportFiltered', { ...value, ...patch })).toThrow();
  });
  it('2MiB按UTF8字节计量，筛选全集预算和严格分组沿用原门', () => {
    expect(validateCommand('table.exportFiltered', { ...input, metadataKey: 'x'.repeat(tableFilteredExportLimits.metadataBytes) })).toBeDefined();
    expect(() => validateCommand('table.exportFiltered', { ...input, metadataKey: '中'.repeat(800000) })).toThrow();
    const filters = Array.from({ length: 6 }, () => ({ column: '金额', operator: 'IN', values: Array.from({ length: 200 }, (_, index) => String(index)), enabled: false }));
    expect(() => validateCommand('table.exportFiltered', { ...input, filters })).toThrow();
    expect(() => validateCommand('table.exportFiltered', { ...input, filters: [{ column: '金额', operator: 'IS NULL' }], filterGroup: { mode: 'all', children: [0, 0] } })).toThrow();
    expect(() => validateCommand('table.exportFiltered', { ...input, sort: Array.from({ length: 21 }, (_, index) => ({ column: '列' + index, direction: 'ASC' })) })).toThrow();
    const getter = vi.fn(() => []), value = { ...input }; Object.defineProperty(value, 'filters', { get: getter, enumerable: true }); expect(() => validateCommand('table.exportFiltered', value)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('CSV接受三种分隔符，其他格式及显式undefined不接受分隔符', () => {
    for (const csvDelimiter of [',', ';', '\t']) expect(validateCommand('table.exportFiltered', { ...input, csvDelimiter })).toMatchObject({ csvDelimiter });
    for (const value of [{ ...input, csvDelimiter: undefined }, { ...input, csvDelimiter: '|' }, ...['json', 'sql', 'xlsx'].map(format => ({ ...input, format, csvDelimiter: ',' }))]) expect(() => validateCommand('table.exportFiltered', value)).toThrow();
  });
});

describe('真实Main文件用途、可信注入和副作用生命周期', () => {
  it('正确文件用途与格式才投递，Main注入可信profile/路径/修订且不写SQL历史', async () => {
    const f = fixture(); expect(await f.ipc()).toEqual({ ok: true, result: { rows: 1000001, fileCommitted: true } });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('table.exportFiltered', { ...input, profile: f.profile, filePath: 'RAM-owned.csv', connectionRevision: 11 }); expect(f.acquire).toHaveBeenCalledExactlyOnceWith('RAM-owned.csv'); expect(f.releaseTarget).toHaveBeenCalledOnce(); expect(f.history).not.toHaveBeenCalled(); expect(f.tasks.get(input.taskId)?.status).toBe('completed'); expect(f.owners.has(input.taskId)).toBe(false);
  });
  it.each(['format', 'purpose', 'missing', 'profile', 'sql'])('%s非法在引擎和预留前拒绝', async cause => {
    const f = fixture(); let value: any = { ...input };
    if (cause === 'format') value.format = 'json'; else if (cause === 'purpose') f.files.get('chosen')!.purpose = 'import'; else if (cause === 'missing') value.fileToken = 'other'; else value[cause] = cause === 'profile' ? {} : 'DROP DATABASE x';
    expect((await f.ipc(value)).ok).toBe(false); expect(f.request).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
  });
  it.each(['document', 'revision', 'close', 'locked', 'shutdown', 'cancel'])('等待目标预留期间%s使原请求零投递，锁不提前释放', async cause => {
    const f = fixture(), gate = deferred<() => void>(); f.acquire.mockImplementationOnce(() => gate.promise); const pending = f.dispatch(), rejected = expect(pending).rejects.toThrow(); await flush();
    if (cause === 'document') f.navigate(); else if (cause === 'revision') f.revise(); else if (cause === 'close') { f.context.tableValueOptionsConnectionOwners.set(input.connectionId, {}); f.owners.observe(); } else if (cause === 'locked') f.lock(true); else if (cause === 'shutdown') f.context.shuttingDown = true; else await f.context.dispatch('query.cancel', { taskId: input.taskId }, f.owner);
    expect(f.releaseTarget).not.toHaveBeenCalled(); gate.resolve(f.releaseTarget); await rejected; expect(f.request).not.toHaveBeenCalled(); expect(f.releaseTarget).toHaveBeenCalledOnce(); expect(f.owners.has(input.taskId)).toBe(false);
  });
  it('原导出成功后文档变化不会把真实提交伪装为无文件，取消与目标锁仍正确收尾', async () => {
    const f = fixture(), read = deferred<any>(), stop = deferred<any>(); f.request.mockImplementation((command: string) => command === 'table.exportFiltered' ? read.promise : stop.promise);
    let finished = false; const pending = f.dispatch().finally(() => { finished = true; }); await flush(); f.navigate(); await flush(); expect(f.request.mock.calls.map(call => call[0])).toEqual(['table.exportFiltered', 'query.cancel']);
    read.resolve({ rows: 7, fileCommitted: true }); await flush(); expect(finished).toBe(false); expect(f.releaseTarget).not.toHaveBeenCalled(); stop.resolve(undefined); expect(await pending).toEqual({ rows: 7, fileCommitted: true }); expect(f.tasks.get(input.taskId)?.status).toBe('completed'); expect(f.releaseTarget).toHaveBeenCalledOnce();
  });
  it('原失败与取消失败完整结算且保留cause，不提前解除文件目标锁', async () => {
    const f = fixture(), read = deferred<any>(), stop = deferred<any>(), original = Error('原导出失败'), cancellation = Error('原取消清理失败');
    f.request.mockImplementation((command: string) => command === 'table.exportFiltered' ? read.promise : stop.promise); let finished = false;
    const pending = f.dispatch().catch(reason => reason).finally(() => { finished = true; }); await flush(); f.revise(); await flush(); read.reject(original); await flush(); expect(finished).toBe(false); expect(f.releaseTarget).not.toHaveBeenCalled(); stop.reject(cancellation);
    const failure = await pending; expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(original); expect(failure.errors).toEqual([original, cancellation]); expect(f.releaseTarget).toHaveBeenCalledOnce(); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('暂时保存锁不会取消已经投递但配置没有实际变化的导出', async () => {
    const f = fixture(), read = deferred<any>(); f.request.mockImplementationOnce(() => read.promise); const pending = f.dispatch(); await flush(); f.lock(true); f.owners.observe(); await flush(); expect(f.request).toHaveBeenCalledOnce(); f.lock(false); read.resolve({ rows: 1, fileCommitted: true }); expect(await pending).toEqual({ rows: 1, fileCommitted: true });
  });
  it('文件已提交而原取消回执失败时仍返回真实完成，不诱导重复覆盖', async () => {
    const f = fixture(), read = deferred<any>(); f.request.mockImplementation((command: string) => command === 'table.exportFiltered' ? read.promise : Promise.reject(Error('合成取消回执失败')));
    const pending = f.dispatch(); await flush(); f.navigate(); await flush(); read.resolve({ rows: 2, fileCommitted: true }); expect(await pending).toEqual({ rows: 2, fileCommitted: true }); expect(f.tasks.get(input.taskId)?.status).toBe('completed'); expect(f.releaseTarget).toHaveBeenCalledOnce();
  });
  it('新文档不能冒用旧导出编号，系统来源撤销只取消一次', async () => {
    const f = fixture(), read = deferred<any>(), stop = deferred<any>(); f.request.mockImplementation((command: string) => command === 'table.exportFiltered' ? read.promise : stop.promise);
    const pending = f.dispatch().catch(reason => reason); await flush(); f.navigate(); await flush();
    const foreign = { owner: f.owner.owner } as any; await expect(f.owners.cancel(input.taskId, foreign)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
    stop.resolve(undefined); read.reject(Error('原导出终结')); await pending; expect(f.releaseTarget).toHaveBeenCalledOnce();
  });
  it.each(['task', 'completion', 'saved', 'history'])('与%s原任务编号冲突时零预留、零引擎投递', async kind => {
    const f = fixture(); if (kind === 'task') f.tasks.set(input.taskId, {} as TaskRecord); else if (kind === 'completion') f.context.completionTasks.add(input.taskId); else f.context[kind === 'saved' ? 'savedQueryPages' : 'historyPages'] = { owns: () => true };
    await expect(f.dispatch()).rejects.toThrow('编号'); expect(f.request).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  });
  it('主动取消只针对同一真实文档，ACK不释放尚未终结的原导出及目标锁', async () => {
    const f = fixture(), read = deferred<any>(), stop = deferred<any>(); f.request.mockImplementation((command: string) => command === 'table.exportFiltered' ? read.promise : stop.promise);
    const pending = f.dispatch().catch(reason => reason); await flush(); const cancel = f.context.dispatch('query.cancel', { taskId: input.taskId }, f.owner); await flush(); stop.resolve(undefined); await cancel; expect(f.releaseTarget).not.toHaveBeenCalled(); expect(f.owners.has(input.taskId)).toBe(true); await expect(f.dispatch()).rejects.toThrow('编号'); read.reject(Error('原导出已终结')); await pending; expect(f.releaseTarget).toHaveBeenCalledOnce();
  });
  it('任务概要所有状态都隐藏筛选、排序、路径和驱动展开值', () => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const message = persistedTaskMessage('table.exportFiltered', { taskId: 't', status, progress: 0, message: '秘密筛选=9007199254740993 路径C:\\秘密.csv 错误原文' });
      expect(message).toContain('筛选行'); for (const secret of ['9007199254740993', '秘密.csv', '秘密筛选']) expect(message).not.toContain(secret);
    }
  });
});
