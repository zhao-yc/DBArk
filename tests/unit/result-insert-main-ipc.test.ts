import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import { ResultInsertOwners } from '../../src/main/resultInsertOwners';
import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';
import { mergeTableFilteredUpdateProgress } from '../../src/main/tableFilteredUpdateProgress';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
import type { ConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { ResultInsertApplyInput, ResultInsertPreviewInput, ResultInsertPreviewOutput, ResultInsertProgress } from '../../src/shared/resultInsert';

/** 只控制RAM broker的原Promise，不用定时器假装任务完成。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); }

/** AST提取真实Main函数、能力管理器初始化和原IPC回调，不维护手写分派副本。 */
function productionParts() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['runResultInsert', 'runTableFilteredUpdate', 'dispatch', 'taskEvent', 'engineExited', 'validateMainCommand', 'persistAuxiliary'], functions = new Map<string, string>(), bindings = new Map<string, string>();
  let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) functions.set(node.name!.text, node.getText(tree));
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name) && ['columnsMain', 'tableChecksMain', 'resultInserts', 'filteredUpdates'].includes(declaration.name.text)) bindings.set(declaration.name.text, node.getText(tree));
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'dbark:request' && ts.isArrowFunction(node.arguments[1])) callback = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (functions.size !== names.length || bindings.size !== 4 || !callback) throw Error('未提取到结果插入真实Main入口');
  return [...functions.values(), bindings.get('columnsMain'), bindings.get('tableChecksMain'), bindings.get('resultInserts'), bindings.get('filteredUpdates'), 'globalThis.handleRequest = ' + callback.getText(tree) + ';', 'globalThis.actual = {runResultInsert,dispatch,taskEvent,engineExited,columnsMain,resultInserts};'].join('\n');
}

/** 真实归属器与文档能力读取RAM原生句柄；只有broker与存储被替代，不加载Electron或数据库。 */
function fixture() {
  let revision = 11;
  const secret = '私密字段9007199254740993😀', frame = { url: 'dbark-test:renderer', processId: 1, frameToken: 'original-frame', detached: false };
  const send = vi.fn(), contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send }), window = { webContents: contents, isDestroyed: () => false };
  const profile: ConnectionProfile = { id: 'target', name: 'RAM目标', group: '', color: '', dialect: 'mysql', host: 'ram.invalid', port: 3306, user: 'synthetic', password: '只由Main注入的RAM密码' };
  const input: ResultInsertPreviewInput = { connectionId: 'target', database: '库', table: '目标', taskId: randomUUID(), data: { columns: [{ key: 'k', name: '内容' }], rows: [{ k: secret }], truncated: false }, mapping: [{ source: 'k', target: '内容' }], timeZone: '+00:00' };
  const output = (request: ResultInsertPreviewInput = input): ResultInsertPreviewOutput => ({ previewToken: randomUUID(), target: { connectionId: request.connectionId, database: request.database, table: request.table }, rows: request.data.rows.length, mapping: request.mapping, shownRows: request.data.rows.length, sql: 'INSERT INTO `库`.`目标` (`内容`) VALUES (\'' + secret + '\');', expiresAt: new Date(Date.now() + 120000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: request.data.truncated, timeZone: request.timeZone, warnings: [] });
  const tasks = new Map<string, TaskRecord>(), progress = new Map<string, ResultInsertProgress>(), saved: TaskRecord[] = [], history = vi.fn();
  const saveTask = vi.fn((task: TaskRecord) => saved.push(structuredClone(task))), available = vi.fn((id: string) => { if (id !== profile.id) throw Error('未登记的RAM连接'); });
  let lastPreview: ResultInsertPreviewOutput | undefined;
  const request = vi.fn(async (command: string, value: any): Promise<unknown> => {
    if (command === 'result.insertPreview') return lastPreview = output(value);
    if (command === 'result.insertApply') return { target: { connectionId: 'target', database: '库', table: '目标' }, rows: 1, outcome: 'committed', commitAcknowledged: true };
    if (command === 'result.insertRelease' || command === 'query.cancel') return undefined;
    throw Error('RAM broker拒绝非本用途调用：' + command);
  });
  const context: any = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), Date, Map, Set, Error, Buffer, Promise, ColumnsMainCapabilities, TableChecksMainCapabilities, tableChecksFailureProgress, ResultInsertOwners, TableFilteredUpdateOwners, mergeTableFilteredUpdateProgress, filteredUpdateProgress: new Map(), persistedTaskMessage, validateCommand,
    window, rendererURL: frame.url, structureTokens: new Map(), tasks, resultInsertProgress: progress, completionTasks: new Set(), pendingQueryHistory: new Map(), preparingTasks: new Map(), sessions: new Map(), exportProgress: new Map(), structureProgress: new Map(), lastPersist: new Map(), lastStorageWarning: 0,
    tableApplyReceipts: undefined, savedQueryPages: undefined, historyPages: undefined, historyDelete: undefined, tableFilteredExports: { has: () => false }, queryInsertExports: { has: () => false },
    localSearchOperations: new Set(), queryFileOperations: new Set(), shuttingDown: false, rendererSettingsCurrent: true,
    connectionConfig: { assertAvailable: available }, store: { saveTask, addHistory: history, connectionRevision: () => revision, resolveConnection: (id: string) => { available(id); return profile; } }, broker: { request },
  });
  runInContext(ts.transpileModule(productionParts(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.actual.columnsMain.trackWindow(window);
  const event = () => ({ sender: contents, senderFrame: frame });
  const ipc = (command: string, value: unknown, sender = event()): Promise<any> => context.handleRequest(sender, { command, input: value });
  const applyInput = (preview: ResultInsertPreviewOutput): ResultInsertApplyInput => ({ connectionId: 'target', taskId: randomUUID(), previewToken: preview.previewToken, confirmation: '库.目标', acknowledged: true });
  return { context, actual: context.actual, profile, input, output, applyInput, request, tasks, progress, saved, saveTask, history, send, contents, event, ipc, secret, available,
    lastPreview: () => lastPreview!, revise() { revision++; }, navigate() { contents.emit('did-navigate'); },
  };
}

/** 精确进度只用于喂给真实Main事件函数，不替代Engine事务测试。 */
function progress(patch: Partial<ResultInsertProgress> = {}): ResultInsertProgress {
  return { phase: 'inserting', rows: 0, totalRows: 1, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent', ...patch };
}
function running(id: string, kind = 'result.insertApply'): TaskRecord { return { id, kind, status: 'running', progress: 0, message: 'RAM原任务', startedAt: new Date().toISOString() }; }

describe('结果直接插入真实Main分派、IPC及事件（仅RAM）', () => {
  it('首次任务落盘失败在发送前结束，不留下永久running或调用broker', async () => {
    const f = fixture(); f.saveTask.mockImplementationOnce(() => { throw Error('合成磁盘失败'); });
    const reply = await f.ipc('result.insertPreview', f.input);
    expect(reply.ok).toBe(false); expect(reply.error).toContain('合成磁盘失败'); expect(f.request).not.toHaveBeenCalled();
    expect(f.tasks.has(f.input.taskId)).toBe(false); expect(f.progress.get(f.input.taskId)).toMatchObject({ outcome: 'not-sent', dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false });
    expect(f.send.mock.calls.at(-1)?.[1]).toMatchObject({ taskId: f.input.taskId, status: 'failed', resultInsert: { outcome: 'not-sent' } });
  });
  it('三命令经过真实IPC捕获；只有Main注入profile和revision，正文不写SQL历史', async () => {
    const f = fixture(), capture = vi.spyOn(f.actual.columnsMain, 'capture');
    const first = await f.ipc('result.insertPreview', f.input); expect(first.ok).toBe(true);
    const forwarded = f.request.mock.calls[0]; expect(forwarded[0]).toBe('result.insertPreview'); expect(forwarded[1]).toMatchObject({ ...f.input, connectionRevision: 11 }); expect(forwarded[1].profile).toBe(f.profile);
    expect((await f.ipc('result.insertRelease', { connectionId: 'target', previewToken: first.result.previewToken })).ok).toBe(true);
    expect(f.request).toHaveBeenCalledWith('result.insertRelease', { connectionId: 'target', previewToken: first.result.previewToken });
    const second = await f.ipc('result.insertPreview', { ...f.input, taskId: randomUUID() }), applied = await f.ipc('result.insertApply', f.applyInput(second.result));
    expect(applied).toMatchObject({ ok: true, result: { rows: 1, outcome: 'committed', commitAcknowledged: true } }); expect(capture).toHaveBeenCalledTimes(4);
    const apply = f.request.mock.calls.find(([command]) => command === 'result.insertApply')!; expect(apply[1].profile).toBe(f.profile); expect(apply[1].connectionRevision).toBe(11); expect(apply[1]).not.toHaveProperty('data'); expect(apply[1]).not.toHaveProperty('sql');
    expect(f.history).not.toHaveBeenCalled(); expect(JSON.stringify(f.saved)).not.toContain(f.secret); expect(JSON.stringify(f.saved)).not.toContain(f.profile.password); expect(JSON.stringify(f.saved)).not.toContain('INSERT INTO');
  });
  it('真实IPC严格校验三命令，客户端注入SQL、配置、修订或apply数据均在broker前拒绝', async () => {
    const f = fixture(), preview = f.output(), apply = f.applyInput(preview);
    for (const [command, value] of [
      ['result.insertPreview', { ...f.input, sql: 'SELECT 私密来源' }], ['result.insertPreview', { ...f.input, profile: f.profile }], ['result.insertPreview', { ...f.input, connectionRevision: 11 }],
      ['result.insertApply', { ...apply, data: f.input.data }], ['result.insertApply', { ...apply, profile: f.profile }], ['result.insertRelease', { connectionId: 'target', previewToken: preview.previewToken, connectionRevision: 11 }],
    ]) expect((await f.ipc(command as string, value)).ok).toBe(false);
    const getter = vi.fn(() => f.secret), row = Object.defineProperty({}, 'k', { enumerable: true, get: getter });
    expect((await f.ipc('result.insertPreview', { ...f.input, data: { ...f.input.data, rows: [row] } })).ok).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('owner已返回到IPC最后发布之间导航，原回调精确释放此次token并拒绝旧回包', async () => {
    const f = fixture(), native = f.actual.resultInserts.preview.bind(f.actual.resultInserts);
    vi.spyOn(f.actual.resultInserts, 'preview').mockImplementation(async (...args: unknown[]) => { const result = await native(...args); f.navigate(); return result; });
    expect((await f.ipc('result.insertPreview', f.input)).ok).toBe(false); await f.actual.resultInserts.drain();
    expect(f.request.mock.calls.filter(([command]) => command === 'result.insertRelease')).toEqual([['result.insertRelease', { connectionId: 'target', previewToken: f.lastPreview().previewToken }]]);
    expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toEqual([]);
  });
  it('真实dispatch在首个await前消费apply令牌，双击只投递一次且不写历史', async () => {
    const f = fixture(), preview = (await f.ipc('result.insertPreview', f.input)).result, gate = deferred<unknown>(); f.request.mockImplementationOnce(() => gate.promise);
    const first = f.ipc('result.insertApply', f.applyInput(preview)), duplicate = await f.ipc('result.insertApply', f.applyInput(preview)); expect(duplicate.ok).toBe(false);
    expect(f.request.mock.calls.filter(([command]) => command === 'result.insertApply')).toHaveLength(1);
    gate.resolve({ target: preview.target, rows: 1, outcome: 'committed', commitAcknowledged: true }); expect((await first).ok).toBe(true); expect(f.history).not.toHaveBeenCalled();
  });
  it('query.cancel只认真实同文档能力，取消ACK后仍等待原任务及精确release', async () => {
    const f = fixture(), gate = deferred<unknown>(); f.request.mockImplementationOnce(() => gate.promise);
    const original = f.ipc('result.insertPreview', f.input), fakeSender = Object.assign(new EventEmitter(), { mainFrame: f.event().senderFrame });
    expect((await f.ipc('query.cancel', { taskId: f.input.taskId }, { sender: fakeSender as typeof f.contents, senderFrame: f.event().senderFrame })).ok).toBe(false);
    const forged = { ...f.actual.columnsMain.capture(f.event()) };
    await expect(f.actual.dispatch('query.cancel', { taskId: f.input.taskId }, forged)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toEqual([]);
    let done = false; const cancel = f.ipc('query.cancel', { taskId: f.input.taskId }).then(value => { done = true; return value; }); await flush(); expect(done).toBe(false);
    expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toEqual([['query.cancel', { taskId: f.input.taskId }]]);
    const response = f.output(); gate.resolve(response); expect((await original).ok).toBe(false); expect((await cancel).ok).toBe(true);
    expect(f.request).toHaveBeenCalledWith('result.insertRelease', { connectionId: 'target', previewToken: response.previewToken }); expect(f.actual.resultInserts.has(f.input.taskId)).toBe(false);
  });
  it('真实taskEvent隐藏持久化原值并优先保留commitACK，晚错误不能改写已提交', () => {
    const f = fixture(), id = randomUUID(); f.tasks.set(id, running(id));
    const event: TaskEvent = { taskId: id, status: 'failed', progress: 100, message: '服务器回显' + f.secret, resultInsert: progress({ rows: 1, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' }) };
    f.actual.taskEvent(event); expect(f.tasks.get(id)?.status).toBe('completed'); expect(f.progress.get(id)?.commitAcknowledged).toBe(true);
    // ACK事实单调保留：迟到旧事件没有ACK不能覆盖先前已确认提交的记录。
    f.actual.taskEvent({ ...event, resultInsert: progress({ dmlMayHaveBeenSent: true, outcome: 'unknown' }) });
    expect(f.tasks.get(id)?.status).toBe('completed'); expect(f.progress.get(id)).toMatchObject({ commitAcknowledged: true, outcome: 'committed' });
    expect(JSON.stringify(f.saved)).not.toContain(f.secret); expect(f.tasks.get(id)?.message).toContain('提交成功'); expect(f.send).toHaveBeenLastCalledWith('dbark:task', expect.objectContaining({ status: 'completed', resultInsert: expect.objectContaining({ commitAcknowledged: true }) })); expect(f.history).not.toHaveBeenCalled();
  });
  it('真实engineExited分别保留未投递、未知、commitACK及已保护rollbackACK事实', () => {
    const f = fixture(), unsent = randomUUID(), sent = randomUUID(), committed = randomUUID(), rolledBack = randomUUID();
    for (const id of [unsent, sent, committed, rolledBack]) f.tasks.set(id, running(id)); f.context.preparingTasks.set(unsent, { cancelled: false });
    f.progress.set(committed, progress({ rows: 1, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' }));
    f.progress.set(rolledBack, progress({ dmlMayHaveBeenSent: true, rollbackAcknowledged: true, transactionProtected: true, outcome: 'rolled-back' }));
    f.actual.engineExited();
    expect(f.progress.get(unsent)).toMatchObject({ outcome: 'not-sent', dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false }); expect(f.progress.get(sent)).toMatchObject({ outcome: 'unknown', dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: false });
    expect(f.tasks.get(committed)?.status).toBe('completed'); expect(f.progress.get(committed)?.outcome).toBe('committed'); expect(f.progress.get(rolledBack)).toMatchObject({ outcome: 'rolled-back', rollbackAcknowledged: true, transactionProtected: true });
    expect(f.tasks.get(rolledBack)?.status).toBe('failed'); expect(f.request).not.toHaveBeenCalled(); expect(f.history).not.toHaveBeenCalled();
  });
});
