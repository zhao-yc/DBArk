import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { CommandMap, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { FileImportPreflightInput, FileImportPreflightReport } from '../../src/shared/fileImportPreflight';
import { validateCommand } from '../../src/shared/validation';
import { resolveFileToken } from '../../src/main/fileTokens';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { extractMainProductionFunction } from './main-production-function';
import { applicationMenuRamPort } from './application-menu-ram-port';

/** 使用合成文件能力和记录，不读取私有配置或真实数据库。 */
function input(): FileImportPreflightInput {
  return { connectionId: '连接', database: '夹具库', table: '夹具表', fileToken: '导入文件', taskId: '预检任务', format: 'csv', encoding: 'utf8', mapping: { 编号: 'id' } };
}

describe('整文件导入预检严格协议', () => {
  it('命令输入输出与共享合同一致，允许两格式和三编码', () => {
    const typedInput: CommandMap['files.preflight']['input'] = input();
    const typedOutput = (value: FileImportPreflightReport): CommandMap['files.preflight']['output'] => value;
    expect(typedOutput).toBeTypeOf('function');
    for (const format of ['csv', 'json']) for (const encoding of ['utf8', 'utf16le', 'gb18030']) {
      const raw = { ...typedInput, format, encoding };
      expect(validateCommand('files.preflight', raw)).toEqual(raw);
    }
  });

  it.each([
    { filePath: 'C:/未经选择.csv' }, { sql: 'INSERT INTO secret VALUES (1)' }, { transactionMode: 'atomic' },
    { conflict: { mode: 'upsert' } }, { unknown: true }, { format: 'sql' }, { encoding: 'latin1' },
    { taskId: '' }, { fileToken: '' }, { connectionId: '' }, { database: '' }, { table: '' },
  ])('拒绝路径、写入授权、未知参数和无效必填字段 %#', patch => {
    expect(() => validateCommand('files.preflight', { ...input(), ...patch })).toThrow();
  });

  it('未知顶层原型同名参数也不能被对象解析静默丢弃', () => {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const raw = Object.fromEntries([...Object.entries(input()), [key, '未知顶层参数']]);
      expect(() => validateCommand('files.preflight', raw)).toThrow();
    }
  });

  it('任务和文件能力不可省略，CSV选项不得借给JSON或显式留空', () => {
    for (const field of ['taskId', 'fileToken'] as const) {
      const raw: Partial<FileImportPreflightInput> = input(); delete raw[field];
      expect(() => validateCommand('files.preflight', raw)).toThrow();
    }
    for (const csvDelimiter of [',', ';', '\t']) for (const csvHasHeader of [true, false]) {
      expect(validateCommand('files.preflight', { ...input(), csvDelimiter, csvHasHeader })).toMatchObject({ csvDelimiter, csvHasHeader });
    }
    for (const patch of [{ csvDelimiter: '|' }, { csvDelimiter: '' }, { csvHasHeader: 1 }, { csvHasHeader: undefined }, { csvDelimiter: undefined }]) {
      expect(() => validateCommand('files.preflight', { ...input(), ...patch })).toThrow();
    }
    for (const patch of [{ csvDelimiter: ',' }, { csvHasHeader: false }, { csvHasHeader: undefined }, { csvDelimiter: undefined }]) {
      expect(() => validateCommand('files.preflight', { ...input(), format: 'json', ...patch })).toThrow();
    }
  });

  it('映射允许自有原型同名源字段，保持字段身份且拒绝继承、访问器与隐藏字段', () => {
    const mapping = Object.fromEntries([['__proto__', 'constructor'], ['constructor', '__proto__']]);
    const parsed = validateCommand('files.preflight', { ...input(), mapping }) as FileImportPreflightInput;
    expect(Object.entries(parsed.mapping)).toEqual(Object.entries(mapping));
    expect(Object.hasOwn(parsed.mapping, '__proto__')).toBe(true);
    let reads = 0;
    const inheritedMapping = Object.assign(Object.create({ 隐含: 'secret' }), { 编号: 'id' });
    const getterMapping = { get 编号() { reads++; return 'id'; } };
    const hiddenMapping = Object.defineProperty({}, '编号', { value: 'id' });
    const symbolicMapping = { 编号: 'id', [Symbol('附加')]: 'secret' };
    for (const value of [inheritedMapping, getterMapping, hiddenMapping, symbolicMapping]) expect(() => validateCommand('files.preflight', { ...input(), mapping: value })).toThrow();
    const inheritedInput = Object.assign(Object.create({ fileToken: '继承令牌' }), input()); delete inheritedInput.fileToken;
    const getterInput = { ...input(), get fileToken() { reads++; return '导入文件'; } };
    const hiddenInput = Object.defineProperty({ ...input() }, 'taskId', { value: '预检任务', enumerable: false });
    for (const value of [inheritedInput, getterInput, hiddenInput]) expect(() => validateCommand('files.preflight', value)).toThrow();
    expect(reads).toBe(0);
  });

  it('映射最多1000项、源目标名为1至256字符，重复目标在转发前拒绝', () => {
    const bounded = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`源${index}`, `目标${index}`]));
    expect(validateCommand('files.preflight', { ...input(), mapping: bounded })).toMatchObject({ mapping: bounded });
    for (const mapping of [{ ...bounded, 超额: '额外目标' }, { '': 'id' }, { 编号: '' }, { ['源'.repeat(257)]: 'id' }, { 编号: '目'.repeat(257) }, { 编号: 'id', 别名: 'id' }]) {
      expect(() => validateCommand('files.preflight', { ...input(), mapping })).toThrow();
    }
    const longest = { ['源'.repeat(256)]: '目'.repeat(256) };
    expect(validateCommand('files.preflight', { ...input(), mapping: longest })).toMatchObject({ mapping: longest });
  });
});

const mainSource = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', mainSource, ts.ScriptTarget.Latest, true);

/** 从生产AST执行完整dispatch、IPC包装和退出回调，只替换系统、存储与Engine端口。 */
function harness() {
  let wrapper: ts.Expression | undefined, quit: ts.Expression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && node.arguments[0]?.getText(tree) === "'dbark:request'") wrapper = node.arguments[1];
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.on' && node.arguments[0]?.getText(tree) === "'before-quit'") quit = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(wrapper).toBeDefined(); expect(quit).toBeDefined();
  const tasks = new Map<string, TaskRecord>(), files = new Map<string, { path: string; purpose: string; format?: string }>();
  files.set('导入文件', { path: 'C:/合成夹具/输入.csv', purpose: 'import', format: 'csv' });
  const webContents = { mainFrame: { url: 'RAM:预检' }, send: vi.fn() };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const broker = { request: vi.fn(async (_command: string, _input: unknown): Promise<any> => ({ complete: true })), close: vi.fn(async () => undefined), forceClose: vi.fn() };
  const store = { saveTask: vi.fn(), addHistory: vi.fn(), close: vi.fn(), connectionRevision: () => 1, resolveConnection: vi.fn(), deleteConnection: vi.fn() };
  const columnsMain = { hasUnpublished: () => false, capture: vi.fn(), assertCapturedOwner: vi.fn() };
  const owners = () => ({ has: () => false, drain: vi.fn(async () => undefined), observe: vi.fn(), invalidateConnection: vi.fn() });
  const context = createContext({
    Error, Date, Map, Set, Promise, console, setTimeout, clearTimeout, resolveFileToken, persistedTaskMessage, validateMainCommand: validateCommand,
    tasks, files, broker, store, window: { webContents, isDestroyed: () => false }, rendererURL: 'RAM:预检', columnsMain,
    applicationMenu: applicationMenuRamPort().menu, shuttingDown: false, shutdownComplete: false, rendererHasSettings: false, hasPendingEdits: false,
    structureTokens: new Map(), sessions: new Map(), preparingTasks: new Map(), completionTasks: new Set(), pendingQueryHistory: new Map(),
    exportProgress: new Map(), structureProgress: new Map(), lastPersist: new Map(), resultInsertProgress: new Map(), filteredUpdateProgress: new Map(), filteredDeleteProgress: new Map(),
    queryFileOperations: new Set(), localSearchOperations: new Set(), tableValueOptionsConnectionOwners: new Map(), tableValueOptionsClosing: new Map(),
    queryInsertExports: { has: () => false }, tableApplyReceipts: { confirmed: () => undefined, interrupt: vi.fn() },
    resultInserts: owners(), filteredUpdates: owners(), filteredDeletes: owners(), tableFilteredExports: { has: () => false, observe: vi.fn() },
    tableChecksMain: { hasUnpublished: () => false }, connectionConfig: { assertAvailable: vi.fn() },
    savedQuerySearches: undefined, savedQueryPages: undefined, historyPages: undefined, historyDelete: undefined,
    persistAuxiliary: (action: () => void) => action(), SavedQuerySearchCancelled: class extends Error {},
    externalObjectUris: { close: vi.fn() }, app: { quit: vi.fn() }, dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })), showErrorBox: vi.fn() },
  });
  const names = ['taskEvent', 'dispatch', 'cancelFileImportPreflights'];
  const source = names.map(name => extractMainProductionFunction(mainSource, name)).join('\n') + `\nvar request=${wrapper!.getText(tree)};var beforeQuit=${quit!.getText(tree)};`;
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { context, broker, store, tasks, files, event, request: context.request as (event: unknown, payload: unknown) => Promise<any>, beforeQuit: context.beforeQuit as (event: unknown) => void };
}

describe('整文件预检Main实际接线', () => {
  it('仅导入且格式一致的已选令牌解析路径，原报告只通过当轮回包返回且不写历史', async () => {
    const h = harness(), report = { complete: true, checkedRecords: 2, issues: [{ source: '夹具源', target: '夹具目标', message: '合成错误' }] };
    h.broker.request.mockResolvedValue(report);
    expect(await h.request(h.event, { command: 'files.preflight', input: input() })).toEqual({ ok: true, result: report });
    expect(h.broker.request).toHaveBeenCalledWith('files.preflight', { ...input(), filePath: 'C:/合成夹具/输入.csv' });
    expect(h.store.addHistory).not.toHaveBeenCalled();
    expect(h.context.queryFileOperations.size).toBe(0);
    for (const selected of [{ path: 'C:/未授权.csv', purpose: 'export', format: 'csv' }, { path: 'C:/未授权.json', purpose: 'import', format: 'json' }]) {
      const other = harness(); other.files.set('导入文件', selected);
      expect(await other.request(other.event, { command: 'files.preflight', input: input() })).toMatchObject({ ok: false });
      expect(other.broker.request).not.toHaveBeenCalled(); expect(other.store.saveTask).not.toHaveBeenCalled();
    }
  });

  it('真实IPC拒绝未知字段和错误来源，退出后不再准入预检', async () => {
    const h = harness();
    for (const raw of [{ ...input(), filePath: 'C:/注入.csv' }, { ...input(), conflict: { mode: 'upsert' } }]) expect(await h.request(h.event, { command: 'files.preflight', input: raw })).toMatchObject({ ok: false });
    expect(await h.request({ ...h.event, sender: {} }, { command: 'files.preflight', input: input() })).toMatchObject({ ok: false });
    h.context.shuttingDown = true;
    expect(await h.request(h.event, { command: 'files.preflight', input: input() })).toMatchObject({ ok: false });
    expect(h.broker.request).not.toHaveBeenCalled();
  });

  it('实际before-quit先取消，取消应答与原扫描未结算时均不关闭存储或提前落定', async () => {
    const h = harness(); let finish!: (value: unknown) => void, cancelled!: () => void;
    h.broker.request.mockImplementation((command: string) => command === 'files.preflight' ? new Promise(resolve => { finish = resolve; }) : new Promise(resolve => { cancelled = () => resolve(undefined); }));
    const pending = h.request(h.event, { command: 'files.preflight', input: input() });
    expect(h.context.queryFileOperations.size).toBe(1);
    const quitting = { preventDefault: vi.fn() }; h.beforeQuit(quitting);
    await vi.waitFor(() => expect(h.broker.request).toHaveBeenCalledWith('query.cancel', { taskId: '预检任务' }));
    expect(quitting.preventDefault).toHaveBeenCalledOnce(); expect(h.tasks.get('预检任务')?.status).toBe('running');
    expect(h.store.close).not.toHaveBeenCalled(); expect(h.broker.close).not.toHaveBeenCalled();
    cancelled(); await Promise.resolve(); await Promise.resolve();
    expect(h.context.queryFileOperations.size).toBe(1); expect(h.tasks.get('预检任务')?.status).toBe('running'); expect(h.store.close).not.toHaveBeenCalled();
    finish({ complete: false }); await pending;
    await vi.waitFor(() => expect(h.store.close).toHaveBeenCalledOnce());
    expect(h.broker.close).toHaveBeenCalledOnce(); expect(h.context.queryFileOperations.size).toBe(0);
  });

  it('退出准备阶段只撤销预检意图，已完成预检及其它文件族不被额外取消', async () => {
    const h = harness();
    const base = { status: 'running' as const, progress: 0, message: '合成任务', startedAt: '2026-10-28T00:00:00.000Z' };
    h.tasks.set('准备预检', { ...base, id: '准备预检', kind: 'files.preflight' });
    h.tasks.set('已结束预检', { ...base, id: '已结束预检', kind: 'files.preflight', status: 'completed' });
    h.tasks.set('普通导入', { ...base, id: '普通导入', kind: 'files.import' });
    const preparing = { cancelled: false }; h.context.preparingTasks.set('准备预检', preparing);
    await h.context.cancelFileImportPreflights();
    expect(preparing.cancelled).toBe(true); expect(h.tasks.get('准备预检')?.status).toBe('running');
    expect(h.broker.request).not.toHaveBeenCalled();
  });

  it('任务失败后清理跟踪，事件细节仅当轮显示而持久化始终脱敏', async () => {
    const h = harness(), secret = 'C:/原始路径.csv; 原字段=私密值; INSERT INTO 原目标';
    h.broker.request.mockRejectedValue(Error(secret));
    expect(await h.request(h.event, { command: 'files.preflight', input: input() })).toEqual({ ok: false, error: secret });
    expect(h.context.queryFileOperations.size).toBe(0);
    for (const [record] of h.store.saveTask.mock.calls) {
      expect(JSON.stringify(record)).not.toContain(secret); expect(record).not.toHaveProperty('errors');
    }
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const event: TaskEvent = { taskId: '预检任务', status, progress: 12, message: secret };
      const message = persistedTaskMessage('files.preflight', event);
      expect(message).not.toContain(secret); expect(message).toContain('字段名'); expect(message).toContain('错误原文未保存');
      h.context.taskEvent({ ...event, errors: [secret] });
      expect(h.tasks.get('预检任务')).not.toHaveProperty('errors');
      expect(h.tasks.get('预检任务')?.message).toBe(message);
    }
    expect(h.store.addHistory).not.toHaveBeenCalled();
  });
});
