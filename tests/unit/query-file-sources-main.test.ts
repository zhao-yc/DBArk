import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { QueryFileSources } from '../../src/main/queryFileSources';
import { validateCommand } from '../../src/shared/validation';

/** 提取实际Main函数及IPC回调，不复制业务分发或默认放行窗口门。 */
function mainPort() {
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
  const names = ['dispatch', 'validateMainCommand', 'queryFileOperation', 'registerQueryFileSourceTask', 'taskEvent'];
  const declarations = names.map(name => { const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); if (!node) throw Error('缺少实际Main函数'); return node.getText(source); });
  let callback = '';
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' && node.arguments[0]?.getText(source) === "'dbark:request'") callback = node.arguments[1].getText(source); ts.forEachChild(node, visit); }
  visit(source); if (!callback) throw Error('缺少实际IPC回调');
  const frame = { detached: false, url: 'app://文档', processId: 42, frameToken: '真实帧' };
  const events: TaskEvent[] = [], records: TaskRecord[] = []; let publish = (event: TaskEvent) => { events.push(event); };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send: (channel: string, event: TaskEvent) => { if (channel === 'dbark:task') events.push(event); } });
  const window = { webContents: contents, isDestroyed: () => false };
  const owner = new ColumnsMainCapabilities(new Map(), { currentWindow: () => window as never, rendererURL: frame.url, connectionRevision: () => 0, assertAvailable: () => { throw Error('文件来源不能调用连接门'); }, shuttingDown: () => false, release: async () => { throw Error('文件来源不能释放结构令牌'); } });
  owner.trackWindow(window as never);
  const document = {}, tab = { id: 'one', kind: 'query' as const, title: '查询', connectionId: 'ram', sql: '' };
  let choose: () => Promise<string | undefined> = async () => undefined, choices = 0;
  const ramStore = { saveTask: (task: TaskRecord) => { records.push(task); }, queryFileSource: () => undefined, queryFileDocument: (id: string) => { if (id !== 'one') throw Error('未知文档'); return { token: document, tab }; }, queryFileSourceRecords: () => [], commitQueryFileSource: () => { throw Error('本例不得持久化'); }, releaseQueryFileSource: () => false };
  const service = new QueryFileSources({ store: ramStore, report: event => publish(event), choose: async () => { choices++; return choose(); }, reserve: async () => { throw Error('本例不得写文件'); } });
  const context = createContext({ structureTokens: new Map(), sessions: new Map(), connectionConfig: { assertAvailable: (id: unknown) => { if (id !== undefined) throw Error('本地任务状态不得建立数据库目标'); } }, taskCancelSnapshot, tasks: new Map(), store: ramStore, completionTasks: new Set(), tableApplyReceipts: undefined, pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(), lastPersist: new Map(), persistAuxiliary: (action: () => void) => action(), persistedTaskMessage, columnsMain: owner, queryFileSources: service, window, rendererURL: frame.url, validateCommand, shuttingDown: false, rendererSettingsCurrent: true, rendererHasSettings: true, queryFileOperations: new Set(), Error, Promise });
  const code = declarations.join('\n') + '\nglobalThis.handler = ' + callback + ';';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  publish = event => context.taskEvent(event);
  const request = (command: string, input: unknown, senderFrame: unknown = frame) => context.handler({ sender: contents, senderFrame }, { command, input }) as Promise<{ ok: boolean; result?: unknown; error?: string }>;
  return { context, events, records, contents, frame, service, request, choose: (next: typeof choose) => { choose = next; }, choices: () => choices };
}
it('正式Main状态分发复用真实窗口捕获且不访问broker；子frame和路径参数被拒绝', async () => {
  const main = mainPort(); expect(await main.request('queryFileSources.status', { tabId: 'one' })).toEqual({ ok: true, result: { state: 'unbound' } });
  expect(await main.request('queryFileSources.status', { tabId: 'one' }, { ...main.frame })).toMatchObject({ ok: false });
  expect(await main.request('queryFileSources.open', { taskId: randomUUID(), tabId: 'one', encoding: 'utf8', path: '任意路径' })).toMatchObject({ ok: false });
  expect(main.choices()).toBe(0);
});
it('正式Main打开在原生选择晚返时遭同URL导航，原文档不能交付或建立权限', async () => {
  const main = mainPort(); let resume!: () => void, entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
  main.choose(async () => { entered(); await new Promise<void>(resolve => { resume = resolve; }); return undefined; });
  const pending = main.request('queryFileSources.open', { taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }); await entry;
  main.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); resume();
  expect(await pending).toMatchObject({ ok: false }); expect(main.context.queryFileOperations.size).toBe(0);
});
it('正式Main设置未同步时拒绝文件IO，退出开始后只允许精确release收尾', async () => {
  const main = mainPort(); main.context.rendererSettingsCurrent = false;
  expect(await main.request('queryFileSources.open', { taskId: randomUUID(), tabId: 'one', encoding: 'utf8' })).toMatchObject({ ok: false }); expect(main.choices()).toBe(0);
  main.context.shuttingDown = true;
  expect(await main.request('queryFileSources.release', { tabId: 'one', source: { id: '367cce95-2a1c-4e6f-9900-ae03d5ac0d07', revision: 1 } })).toEqual({ ok: true, result: { released: false } });
});
it('正式Main先记录本地文件任务，进度终态走真实taskEvent且任务编号不可复用', async () => {
  const main = mainPort(), taskId = randomUUID();
  expect(await main.request('queryFileSources.open', { taskId, tabId: 'one', encoding: 'utf8' })).toEqual({ ok: true, result: { state: 'cancelled' } });
  expect(main.records[0]).toMatchObject({ id: taskId, kind: 'queryFileSources.open', status: 'running' });
  expect(main.events.at(-1)).toMatchObject({ taskId, status: 'cancelled', queryFileSource: { tabId: 'one', phase: 'terminal', wrote: 'no' } });
  expect(main.records.at(-1)?.status).toBe('cancelled');
  expect(await main.request('queryFileSources.open', { taskId, tabId: 'one', encoding: 'utf8' })).toMatchObject({ ok: false }); expect(main.choices()).toBe(1);
  expect(main.records.every(record => !Object.hasOwn(record, 'connectionId'))).toBe(true);
});
it('正式Main显式cancel等待原生框返回后结算，关闭门下也不开始后续IO', async () => {
  const main = mainPort(), taskId = randomUUID(); let resume!: () => void, entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
  main.choose(async () => { entered(); await new Promise<void>(resolve => { resume = resolve; }); return undefined; });
  const original = main.request('queryFileSources.open', { taskId, tabId: 'one', encoding: 'utf8' }); await entry;
  main.context.shuttingDown = true;
  const cancel = main.request('queryFileSources.cancel', { taskId, tabId: 'one' }); resume();
  expect(await original).toMatchObject({ ok: true, result: { state: 'blocked', wrote: 'no' } }); expect(await cancel).toEqual({ ok: true, result: { cancelled: true } });
  expect(main.context.queryFileOperations.size).toBe(0); expect(main.events.at(-1)).toMatchObject({ status: 'cancelled' });
});
it('正式Main任务落盘失败先拒绝，固定消息不泄露原始错误，不弹原生框', async () => {
  const main = mainPort(); main.context.store.saveTask = () => { throw Error('含私有路径和正文的原始错误'); };
  const result = await main.request('queryFileSources.open', { taskId: randomUUID(), tabId: 'one', encoding: 'utf8' });
  expect(result).toMatchObject({ ok: false, error: '本地文件任务记录未保存，尚未开始文件IO' }); expect(main.choices()).toBe(0); expect(main.context.queryFileOperations.size).toBe(0);
});
it('既有任务中心取消状态及query.cancel适配精确本地文件任务，不触达broker', async () => {
  const main = mainPort(), taskId = randomUUID(); let entered!: () => void, resume!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
  main.choose(async () => { entered(); await new Promise<void>(resolve => { resume = resolve; }); return undefined; });
  const original = main.request('queryFileSources.open', { taskId, tabId: 'one', encoding: 'utf8' }); await entry;
  expect(await main.request('tasks.cancelState', { taskIds: [taskId] })).toEqual({ ok: true, result: [{ taskId, state: 'allowed' }] });
  const cancel = main.request('query.cancel', { taskId }); resume();
  expect(await original).toMatchObject({ ok: true, result: { state: 'blocked', wrote: 'no' } }); expect(await cancel).toEqual({ ok: true, result: { cancelled: true } });
  expect(await main.request('tasks.cancelState', { taskIds: [taskId] })).toEqual({ ok: true, result: [{ taskId, state: 'finished' }] }); expect(main.context.queryFileOperations.size).toBe(0);
});
it('任务概要不透传文件路径和SQL，已写/不确定与未写终态分开', () => {
  const base: TaskEvent = { taskId: randomUUID(), status: 'failed', progress: 90, message: '私有路径与SQL不得透传', queryFileSource: { tabId: 'one', operation: 'save', phase: 'terminal', bytesProcessed: 0, wrote: 'unknown', cancellable: false } };
  expect(persistedTaskMessage('queryFileSources.save', base)).toContain('结果不确定');
  expect(persistedTaskMessage('queryFileSources.save', { ...base, queryFileSource: { ...base.queryFileSource!, wrote: 'yes' } })).toContain('已写入');
  expect(persistedTaskMessage('queryFileSources.save', { ...base, queryFileSource: { ...base.queryFileSource!, wrote: 'no' } })).toContain('未写入');
  expect(persistedTaskMessage('queryFileSources.save', base)).not.toContain(base.message);
});
