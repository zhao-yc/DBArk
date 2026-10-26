import { TableFilteredDeleteOwners } from '../../src/main/tableFilteredDeleteOwners';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { vi } from 'vitest';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TablePresetSources } from '../../src/main/tablePresets';
import { QueryResultPresetSources } from '../../src/main/queryResultPresetSources';
import { validateCommand } from '../../src/shared/validation';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { QueryFileSources } from '../../src/main/queryFileSources';
import { QueryInsertExports } from '../../src/main/queryInsertExports';
import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';

/** 可控等待只替换broker物理边界，真实Main dispatch/helper/IPC保持原文。 */
export function deferred<T = any>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

/** AST提取实际生产入口；不存在原函数或IPC回调时立即失败，不维护手写分发器副本。 */
function productionParts() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['dispatch', 'engineExited', 'createWindow', 'validateMainCommand', 'cancelTablePresetRead', 'invalidateTablePresetSources', 'runTableFilteredUpdate', 'runTableFilteredDelete'], parts: string[] = [];
  let wrapper = '', deletionBinding = '';
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'filteredDeletes')) deletionBinding = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) parts.push(node.getText(tree));
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'dbark:request') wrapper = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (parts.length !== names.length || !wrapper || !deletionBinding) throw Error('未提取到真实Main函数、删除能力初始化或IPC wrapper');
  return parts.join('\n') + '\n' + deletionBinding + '\nglobalThis.filteredDeletes=filteredDeletes;\n' + wrapper + ';\nglobalThis.actual = {dispatch,engineExited,createWindow};';
}

/** 只模拟Electron对象与事件，不模拟owner授权；helper逐项读取这些真实边界对象。 */
function fakeWindow() {
  const listeners = new Map<string, Function[]>(), frame = { processId: 3, frameToken: 'main-frame', url: 'app://renderer', detached: false };
  let destroyed = false, contentsDestroyed = false;
  const contents: any = {
    mainFrame: frame, isDestroyed: () => contentsDestroyed,
    on(name: string, callback: Function) { listeners.set(name, [...listeners.get(name) ?? [], callback]); return contents; },
    removeListener(name: string, callback: Function) { listeners.set(name, (listeners.get(name) ?? []).filter(value => value !== callback)); return contents; },
    emit(name: string, ...args: any[]) { for (const callback of listeners.get(name) ?? []) callback(...args); },
    send() {}, setWindowOpenHandler() {},
    session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }
  };
  const window: any = { webContents: contents, isDestroyed: () => destroyed, once() {}, on() {}, show() {}, async loadURL() {},
    destroyWindow() { destroyed = true; }, destroyContents() { contentsDestroyed = true; contents.emit('destroyed'); } };
  return window;
}

/** 独立RAM端口：新验收经真实IPC，旧dispatch回归可捕获真实owner但不绕过其检查。 */
export function mainColumnsHarness() {
  const tokens = new Map<string, any>(), tasks = new Map<string, any>(), progress = new Map(), events: any[] = [];
  const windows: any[] = [];
  let revision = 7, blocked = false, requestId = 0, responseId = 0, afterTask: (() => void) | undefined;
  const request = vi.fn(async (command: string, input: any): Promise<any> => reply(command, input));
  function reply(command: string, input: any): any {
    const target = { connectionId: input.connectionId ?? tokens.get(input.snapshotId)?.connectionId ?? 'trusted', database: 'db', table: 't' };
    if (command === 'schema.columns.get') return { snapshotId: 'snapshot-' + ++responseId, target, expiresAt: new Date(Date.now() + 120000).toISOString() };
    if (command === 'schema.columns.preview') return { previewToken: 'preview-' + ++responseId, target, expiresAt: new Date(Date.now() + 120000).toISOString(), sql: 'ALTER TABLE 仅RAM边界返回', requiredAcknowledgements: [] };
    if (command === 'schema.columns.apply') return { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] };
    return undefined;
  }
  let handler!: (event: any, payload: any) => Promise<any>;
  const context = createContext({
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false }, resultInsertProgress: new Map(),
    filteredUpdateProgress: new Map(), filteredDeleteProgress: new Map(),

    Date, Map, Error, Boolean, TableFilteredDeleteOwners, SavedQuerySearchCancelled, columnsMain: undefined, tablePresetSources: undefined, tablePresetReads: new Map(), window: undefined, structureTokens: tokens, tasks, structureProgress: progress, events,
    tableApplyReceipts: undefined, pendingQueryHistory: new Map(), completionTasks: new Set(), preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(),
    savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined, historyDelete: undefined, localSearchOperations: new Set(), shuttingDown: false, shutdownComplete: false,
    rendererSettingsCurrent: true, rendererURL: 'app://renderer', process: { resourcesPath: 'ram' }, __dirname: 'ram', join: (...parts: string[]) => parts.join('/'),
    app: { isPackaged: false, quit() {} }, files: new Map(),
    BrowserWindow: function () { const window = fakeWindow(); windows.push(window); return window; },
    ipcMain: { handle(channel: string, callback: typeof handler) { if (channel !== 'dbark:request') throw Error('非预期IPC通道'); handler = callback; } },
    validateCommand,
    connectionConfig: { assertAvailable(id?: string) { if (blocked && id === 'trusted') throw Error('连接配置正在保存'); } },
    store: { saveTask() {}, connectionRevision: () => revision },
    broker: { request },
    taskEvent(event: any) { events.push(event); const value = event.columnPatch ?? event.indexPatch; if (value) progress.set(event.taskId, value); tasks.set(event.taskId, { ...tasks.get(event.taskId), status: event.status }); afterTask?.(); },
  });
  /** 字段夹具不登记文件授权；非本用途端口立即拒绝，导航失效仍执行真实文件来源实现。 */
  const unavailableFilePort = (): never => { throw Error('字段所有权夹具未登记文件来源或文件IO权限'); };
  context.queryFileSources = new QueryFileSources({
    store: { queryFileSource: unavailableFilePort, queryFileDocument: unavailableFilePort, queryFileSourceRecords: unavailableFilePort, commitQueryFileSource: unavailableFilePort, releaseQueryFileSource: unavailableFilePort, queryRecentFiles: unavailableFilePort, queryRecentFile: unavailableFilePort, forgetRecentFile: unavailableFilePort },
    choose: unavailableFilePort, reserve: unavailableFilePort, report: unavailableFilePort
  });
  const capabilities = new ColumnsMainCapabilities(tokens, { currentWindow: () => context.window, rendererURL: context.rendererURL,
    connectionRevision: () => revision, assertAvailable: id => context.connectionConfig.assertAvailable(id), shuttingDown: () => context.shuttingDown,
    release: input => request('schema.columns.release', input) });
  context.columnsMain = capabilities;
  // 原字段测试不登记本用途；若显式调用新命令，仍须走同一真实Main函数和owner检查。
  context.filteredUpdates = new TableFilteredUpdateOwners({
    assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right), revision: () => context.store.connectionRevision(), closing: () => context.shuttingDown,
    available: id => context.connectionConfig.assertAvailable(id), run: (command, input, value) => context.runTableFilteredUpdate(command, input, value), release: input => request('table.filteredUpdate.release', input), stop: taskId => request('query.cancel', { taskId }),
  });

  // 新Main wrapper/窗口监听读取真实INSERT归属表；初始无文件能力，不能以noop跳过撤销。
  context.queryInsertExports = new QueryInsertExports(context.files, {
    assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right),
    revision: () => context.store.connectionRevision(), session: id => context.sessions.get(id), closing: () => context.shuttingDown,
    stop: async taskId => { const preparing = context.preparingTasks.get(taskId); if (preparing) { preparing.cancelled = true; return; } return request('query.cancel', { taskId }); }
  });
  // 导航和销毁执行原失效/取消函数；来源授权沿用同一真实owner，不能用空函数跳过。
  context.tablePresetSources = new TablePresetSources({ assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right) });
  context.resultPresetSources = new QueryResultPresetSources({ assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right) });
  runInContext(ts.transpileModule(productionParts(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  // createWindow在首个await前同步建立窗口及真实owner监听，RAM loadURL不操作GUI。
  void context.actual.createWindow();
  const event = () => ({ sender: context.window.webContents, senderFrame: context.window.webContents.mainFrame, frameId: 1, processId: 3, type: 'frame' as const, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const invoke = (command: string, input: any, sender = event()) => handler(sender, { command, input });
  async function run(command: string, input: any) { const value = await invoke(command, input); if (!value.ok) throw Error(value.error); return value.result; }
  const get = () => run('schema.columns.get', { connectionId: 'trusted', database: 'db', table: 't', taskId: 'get-' + ++requestId });
  const preview = (snapshotId: string) => run('schema.columns.preview', { snapshotId, patches: [{ kind: 'alter', columnRef: 'note-ref', changes: { collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } } }], taskId: 'preview-' + ++requestId });
  return { tokens, tasks, progress, events, windows, context, capabilities, request, reply, invoke, run, get, preview, event,
    setRevision(value: number) { revision = value; }, setBlocked(value: boolean) { blocked = value; }, afterTask(callback?: () => void) { afterTask = callback; },
    /** 仅旧原文dispatch回归用真实capture补第三参数；不是新owner验收入口，也无noop。 */
    dispatch(command: string, input: any) { return context.actual.dispatch(command, input, command.startsWith('schema.columns.') ? capabilities.capture(event()) : undefined); }
  };
}
