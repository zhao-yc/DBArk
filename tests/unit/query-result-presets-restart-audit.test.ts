import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { LocalStore } from '../../src/main/storage';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { QueryResultPresetSources } from '../../src/main/queryResultPresetSources';
import { queryResultPresetValueSchema, type QueryResultPresetStoredSnapshot } from '../../src/shared/queryResultPresets';
import { installQueryResultPresetsRestartAudit, readQueryResultPresetsRestartAudit } from '../helpers/queryResultPresetsRestartAudit';
import { queryResultColumnsSql } from '../helpers/queryResultColumnsUi';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [], cleanup: (() => void)[] = [];
const protector = { available: () => false, encrypt: (): string => { throw Error('不允许写测试秘密'); }, decrypt: (): string => { throw Error('不读取秘密'); } };
const profile = { id: 'restart-profile', name: '离线边界', group: 'RAM', host: 'offline.invalid', port: 3306, user: 'RAM', dialect: 'mysql' as const, color: '#ffffff', rememberPassword: false };
const columns = [
  { key: 'id', name: 'id', type: 'VAR_STRING' }, { key: 'repeated', name: 'repeated', type: 'LONGLONG' },
  { key: 'repeated [4]', name: 'repeated', type: 'NEWDECIMAL' }, { key: 'null_value', name: 'null_value', type: 'NULL' },
  { key: 'empty_value', name: 'empty_value', type: 'VAR_STRING' }, { key: 'bytes', name: 'bytes', type: 'BLOB' }, { key: 'hidden_value', name: 'hidden_value', type: 'VAR_STRING' }
];
/** 查询端口仅提供明确标注的RAM结果；方案成功则来自真实LocalStore、真实来源令牌与落盘重开。 */
function value() {
  return queryResultPresetValueSchema.parse({ columns, visible: columns.slice(0, 6), configuration: {
    expression: { mode: 'AND', children: [{ mode: 'OR', children: [
      { column: 'id', operator: 'in', value: '', values: ['1', '3'], ignoreCase: true },
      { column: 'repeated', operator: 'between', value: '9007199254740993', upper: '18446744073709551615', enabled: false }
    ] }] }, sort: [{ column: 'repeated', direction: 'DESC', nulls: 'LAST' }, { column: 'id', direction: 'ASC', nulls: 'FIRST', ignoreCase: true }]
  } });
}
afterEach(() => { for (const close of cleanup.splice(0)) close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** 审计通过toString运行在独立上下文，不可依赖测试外层imports；原handler真实执行存储命令。 */
async function fixture(options: { phase?: 1 | 2; expected?: QueryResultPresetStoredSnapshot; file?: string; resaves?: number } = {}) {
  const phase = options.phase ?? 1;
  const directory = options.file ? undefined : mkdtempSync(join(tmpdir(), 'dbark-restart-audit-'));
  if (directory) directories.push(directory);
  const file = options.file ?? join(directory!, 'local.sqlite'), store = await LocalStore.open(file, wasm, protector);
  let closed = false; const close = () => { if (!closed) { closed = true; store.close(); } }; cleanup.push(close);
  if (!store.connections().length) store.saveConnection(profile);
  for (let index = 0; index < (options.resaves ?? 0); index++) store.saveConnection(profile);
  const senderId = phase === 1 ? 71 : 72, tabId = phase === 1 ? 'owner-tab-1' : 'owner-tab-2';
  const settings = { ...store.settings(), activeTabId: tabId, tabs: [{ id: tabId, kind: 'query' as const, title: '固定查询', connectionId: profile.id, sql: queryResultColumnsSql }] };
  store.saveSettings(settings);
  let now = 1000;
  const frame = { url: 'file:///DBArk/index.html', processId: senderId + 10, frameToken: 'frame-' + senderId, detached: false };
  const sender = Object.assign(new EventEmitter(), { id: senderId, mainFrame: frame, isDestroyed: () => false });
  const window = { webContents: sender, isDestroyed: () => false };
  const capabilities = new ColumnsMainCapabilities(new Map(), {
    currentWindow: () => window as unknown as BrowserWindow, rendererURL: frame.url, connectionRevision: () => store.connectionRevision(),
    assertAvailable: id => { if (id !== profile.id) throw Error('非本例连接'); }, shuttingDown: () => false, release: async () => undefined
  });
  capabilities.trackWindow(window as unknown as BrowserWindow);
  const sources = new QueryResultPresetSources({ assert: invocation => capabilities.assertCapturedOwner(invocation), same: (left, right) => capabilities.sharesDocumentOwner(left, right) }, () => now);
  let activeSession = '', sessionCloses = 0;
  const queryPort = vi.fn(async () => ({ results: [{ columns: structuredClone(columns), rows: Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1) })), truncated: false, elapsedMs: 1, statement: queryResultColumnsSql }], elapsedMs: 1 }));
  const delegate = async (event: any, payload: any): Promise<any> => {
    const { command, input } = payload; let result: any;
    if (command.startsWith('result.presets.')) {
      const invocation = capabilities.capture(event as IpcMainInvokeEvent);
      if (command !== 'result.presets.list') sources.assert(invocation, input);
      if (command === 'result.presets.read') result = store.selectedQueryResultPreset(input);
      else result = sources.issue(invocation, input, command === 'result.presets.save' ? store.saveQueryResultPreset(input) : store.queryResultPresets(input));
    } else if (command === 'sessions.open') { if (activeSession) throw Error('RAM会话重复'); activeSession = 'ram-session-' + senderId; result = { sessionId: activeSession }; }
    else if (command === 'query.execute') { if (input.sessionId !== activeSession) throw Error('RAM会话来源'); result = await queryPort(); }
    else if (command === 'sessions.close') { if (input.sessionId !== activeSession) throw Error('RAM会话来源'); sessionCloses++; activeSession = ''; }
    else if (command === 'settings.save') store.saveSettings(input);
    else if (command === 'settings.get') result = store.settings();
    else if (command === 'connections.list') result = store.connections();
    else if (command === 'connections.open') result = { version: '8.4.11', dialect: 'mysql' };
    else if (command === 'history.list' || command === 'tasks.list') result = [];
    else if (command === 'metadata.completion') result = { entries: [], incomplete: false };
    else if (command === 'query.completionState') result = { databaseKnown: true, database: null, broken: false, busy: false };
    else if (command === 'query.sessionState') result = { transactionOpen: false, transactionKnown: true, broken: false };
    else throw Error('测试原handler未实现命令');
    return { ok: true, result };
  };
  const original = vi.fn(delegate), handlers = new Map([['dbark:request', original]]);
  const target = { senderId, profileId: profile.id, tabId, sql: queryResultColumnsSql, deadline: 121000, phase, ...(options.expected ? { expected: options.expected } : {}) };
  const context: any = { Date: { now: () => now }, ipcMain: { _invokeHandlers: handlers }, target };
  runInNewContext(`(${installQueryResultPresetsRestartAudit.toString()})({ipcMain},target)`, context);
  const wrapped = handlers.get('dbark:request')!, event = { sender, senderFrame: frame };
  const call = (command: string, input: any = {}) => wrapped(event, { command, input });
  const read = () => runInNewContext(`(${readQueryResultPresetsRestartAudit.toString()})()`, context);
  const scope = () => { const snapshot = context.__dbarkQueryResultPresetsRestartAudit.snapshot; return { connectionId: profile.id, source: { ...snapshot.source }, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken }; };
  const prepare = async () => { await call('sessions.open', { connectionId: profile.id }); await call('query.execute', { sessionId: activeSession, sql: queryResultColumnsSql, taskId: randomUUID(), maxRows: 1000 }); };
  const list = () => call('result.presets.list', { connectionId: profile.id });
  const save = () => call('result.presets.save', { ...scope(), name: '重启保留整理', value: value() });
  const complete = async () => { await prepare(); await list(); if (phase === 1) await save(); else await call('result.presets.read', { ...scope(), id: read().snapshot.entries[0].id }); };
  return { file, close, store, original, delegate, handlers, context, target, sender, frame, event, wrapped, call, read, scope, prepare, list, save, complete, queryPort, settings, sessionCloses: () => sessionCloses, time: (value: number) => { now = value; }, state: context.__dbarkQueryResultPresetsRestartAudit };
}

describe('两代重启审计委托真实SQLite方案处理器', () => {
  it('每代仅一次常量查询，第一代保存落盘，第二代新source/token读取相同编号和值', async () => {
    const first = await fixture(); await first.complete();
    const observed = first.read(), persisted = first.store.queryResultPresets({ connectionId: profile.id });
    expect(observed).toMatchObject({ queries: 1, pending: 0, revision: 0, schemeCommands: ['list', 'save'], workspaceClosed: false });
    expect(observed.snapshot).toEqual(persisted); expect(observed.snapshot.entries[0].value).toEqual(value());
    expect(Object.hasOwn(observed.snapshot, 'bindingToken')).toBe(false); expect(first.queryPort).toHaveBeenCalledOnce();
    await first.call('sessions.close', { sessionId: 'ram-session-71' });
    await first.call('settings.save', { ...first.settings, tabs: [], activeTabId: undefined });
    expect(first.read().workspaceClosed).toBe(true); expect(first.sessionCloses()).toBe(1); first.close();
    const second = await fixture({ phase: 2, file: first.file, expected: persisted, resaves: 3 }); await second.complete();
    const after = second.read();
    expect(after.schemeCommands).toEqual(['list', 'read']); expect(after.lastRead).toEqual(value());
    expect(after.snapshot.entries).toEqual(persisted.entries); expect(after.snapshot.revision).toBe(persisted.revision);
    expect(after.snapshot.source.connectionRevision).not.toBe(persisted.source.connectionRevision);
    expect(after.snapshot.source.connectionDigest).toBe(persisted.source.connectionDigest); expect(second.queryPort).toHaveBeenCalledOnce();
    expect(first.state.snapshot.bindingToken).not.toBe(second.state.snapshot.bindingToken);
  });

  it('允许准确唯一tab的正常设置保存、只读上下文和补全，完成前禁止关闭工作区', async () => {
    const f = await fixture(); await f.call('settings.save', f.settings); await f.prepare();
    await f.call('query.completionState', { sessionId: 'ram-session-71' }); await f.call('query.sessionState', { sessionId: 'ram-session-71' });
    await f.call('metadata.completion', { connectionId: profile.id, kind: 'databases', prefix: '', taskId: randomUUID() });
    for (const command of ['settings.get', 'connections.list', 'history.list', 'tasks.list']) await f.call(command);
    expect(f.read().schemeCommands).toEqual([]); const count = f.original.mock.calls.length;
    await expect(f.call('settings.save', { ...f.settings, tabs: [], activeTabId: undefined })).rejects.toThrow('永久'); expect(f.original).toHaveBeenCalledTimes(count);
  });

  it.each(['connections.save', 'connections.delete', 'files.choose', 'files.exportResult', 'query.transaction', 'query.executeParameterized', 'metadata.tables', 'result.presets.rename', 'result.presets.delete'])('%s未授权写入或额外流程在原handler前拒绝且永久停链', async command => {
    const f = await fixture(), before = f.store.queryResultPresets({ connectionId: profile.id });
    await expect(f.call(command, { connectionId: profile.id })).rejects.toThrow('永久'); expect(f.original).not.toHaveBeenCalled();
    expect(f.store.queryResultPresets({ connectionId: profile.id })).toEqual(before);
    await expect(f.call('settings.get')).rejects.toThrow('永久'); expect(f.original).not.toHaveBeenCalled();
  });

  it.each(['sql', 'session', 'repeat'] as const)('准确查询的%s约束在委托前受限', async kind => {
    const f = await fixture(); await f.call('sessions.open', { connectionId: profile.id });
    const input = { sessionId: 'ram-session-71', sql: queryResultColumnsSql, taskId: randomUUID(), maxRows: 1000 };
    if (kind === 'repeat') await f.call('query.execute', input);
    const count = f.original.mock.calls.length;
    await expect(f.call('query.execute', { ...input, ...(kind === 'sql' ? { sql: queryResultColumnsSql + '; SELECT 2' } : kind === 'session' ? { sessionId: 'other-session' } : {}) })).rejects.toThrow('永久');
    expect(f.original).toHaveBeenCalledTimes(count); expect(f.queryPort).toHaveBeenCalledTimes(kind === 'repeat' ? 1 : 0);
  });

  it.each(['source', 'token', 'revision', 'extra', 'rows', 'sql', 'field', 'visible', 'operator', 'range', 'members', 'sort', 'depth', 'budget', 'accessor', 'hole', 'cycle'] as const)('方案请求%s边界拒绝真实存储委托，不通过schema降格为成功', async kind => {
    const f = await fixture(); await f.prepare(); await f.list();
    const input: any = { ...f.scope(), name: '重启保留整理', value: value() }, getter = vi.fn(() => { throw Error('不应读取'); });
    if (kind === 'source') input.source.connectionRevision++;
    if (kind === 'token') input.bindingToken = randomUUID(); if (kind === 'revision') input.expectedRevision++;
    if (kind === 'extra') input.replaceId = randomUUID(); if (kind === 'rows') input.value.rows = []; if (kind === 'sql') input.value.sql = '禁止保存';
    if (kind === 'field') input.value.columns[0].type = 'TEXT'; if (kind === 'visible') input.value.visible[0].name = '漂移';
    if (kind === 'operator') input.value.configuration.expression.children[0].children[0].operator = 'UNKNOWN';
    if (kind === 'range') delete input.value.configuration.expression.children[0].children[1].upper;
    if (kind === 'members') input.value.configuration.expression.children[0].children[0].values = [];
    if (kind === 'sort') input.value.configuration.sort.push(input.value.configuration.sort[0]);
    if (kind === 'depth') for (let index = 0; index < 9; index++) input.value.configuration.expression = { mode: 'AND', children: [input.value.configuration.expression] };
    if (kind === 'budget') input.value.configuration.expression.children[0].children[0].values = Array(128).fill('x'.repeat(4096));
    if (kind === 'accessor') Object.defineProperty(input.value, 'configuration', { enumerable: true, get: getter });
    if (kind === 'hole') delete input.value.visible[0]; if (kind === 'cycle') input.value.configuration.expression.children.push(input.value.configuration.expression);
    const count = f.original.mock.calls.length; await expect(f.call('result.presets.save', input)).rejects.toThrow('永久');
    expect(f.original).toHaveBeenCalledTimes(count); expect(getter).not.toHaveBeenCalled(); expect(f.store.queryResultPresets({ connectionId: profile.id }).entries).toEqual([]);
  });

  it('第二代不同文档编号或值不能冒充跨重启保留', async () => {
    const first = await fixture(); await first.complete(); const expected = first.read().snapshot; first.close();
    expected.entries[0].id = randomUUID();
    const second = await fixture({ phase: 2, file: first.file, expected }); await second.prepare();
    await expect(second.list()).rejects.toThrow('永久'); expect(second.state.snapshot).toBeUndefined();
  });

  it('并发list只委托一次，真实迟到回包不绑定快照；session同样只领取一次', async () => {
    const f = await fixture(); await f.prepare(); let finish!: () => void;
    f.original.mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return f.delegate(...args); });
    const pending = f.list(), settled = Promise.allSettled([pending]); const count = f.original.mock.calls.length;
    await expect(f.list()).rejects.toThrow('永久'); expect(f.original).toHaveBeenCalledTimes(count); finish();
    expect((await settled)[0].status).toBe('rejected'); expect(f.state.snapshot).toBeUndefined(); expect(f.state.pending).toBe(0);
    const session = await fixture(); let finishSession!: () => void;
    session.original.mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { finishSession = resolve; }); return session.delegate(...args); });
    const open = session.call('sessions.open', { connectionId: profile.id }), openSettled = Promise.allSettled([open]);
    await expect(session.call('sessions.open', { connectionId: profile.id })).rejects.toThrow('永久'); finishSession(); await openSettled;
    expect(session.state.session).toBe(''); expect(session.state.sessionClaim.response.ok).toBe(true); expect(session.original).toHaveBeenCalledOnce();
  });

  it.each(['clock', 'deadline', 'handler', 'sender', 'frame', 'navigation'] as const)('%s变化使真实迟到保存停链，不能用已落盘事实补造审计成功', async kind => {
    const f = await fixture(); await f.prepare(); await f.list(); let finish!: () => void;
    f.original.mockImplementationOnce(async (...args) => { const reply = await f.delegate(...args); await new Promise<void>(resolve => { finish = resolve; }); return reply; });
    const saved = f.save(), settled = Promise.allSettled([saved]); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (kind === 'clock') f.time(999); if (kind === 'deadline') f.time(121000);
    if (kind === 'handler') f.handlers.set('dbark:request', f.original);
    if (kind === 'sender') f.sender.id++; if (kind === 'frame') f.frame.frameToken += '-changed'; if (kind === 'navigation') f.sender.emit('did-navigate');
    finish(); expect((await settled)[0].status).toBe('rejected'); expect(f.state.snapshot.entries).toEqual([]);
    expect(f.store.queryResultPresets({ connectionId: profile.id }).entries).toHaveLength(1); expect(() => f.read()).toThrow('永久');
    f.time(1001); f.handlers.set('dbark:request', f.wrapped); await expect(f.call('settings.get')).rejects.toThrow('永久');
  });

  it('真实保存回包被改值时保持停链，不能从请求或数据库另补成功快照', async () => {
    const f = await fixture(); await f.prepare(); await f.list();
    f.original.mockImplementationOnce(async (...args) => { const response = await f.delegate(...args); response.result.entries[0].value.configuration.sort[0].direction = 'ASC'; return response; });
    await expect(f.save()).rejects.toThrow('永久'); expect(f.state.snapshot.entries).toEqual([]);
    expect(f.store.queryResultPresets({ connectionId: profile.id }).entries[0].value.configuration.sort[0].direction).toBe('DESC');
  });

  it.each(['source', 'revision', 'token', 'extra', 'failure'] as const)('真实保存的%s回包不符时拒绝发布且不回显原错误正文', async kind => {
    const f = await fixture(); await f.prepare(); await f.list(); const previousToken = f.scope().bindingToken;
    f.original.mockImplementationOnce(async (...args) => {
      const response = await f.delegate(...args);
      if (kind === 'source') response.result.source.connectionRevision++;
      if (kind === 'revision') response.result.revision--;
      if (kind === 'token') response.result.bindingToken = previousToken;
      if (kind === 'extra') response.result.sql = '不允许回包';
      if (kind === 'failure') return { ok: false, error: '不得进入诊断的RAM秘密' };
      return response;
    });
    await expect(f.save()).rejects.toThrow('永久'); expect(f.state.failure).not.toContain('RAM秘密');
    expect(f.state.snapshot.entries).toEqual([]); expect(f.store.queryResultPresets({ connectionId: profile.id }).entries).toHaveLength(1);
  });

  it('改变捕获target期限/SQL或handler容器均不能扩展原授权，恢复后也不复活', async () => {
    for (const change of ['deadline', 'sql', 'handlers'] as const) {
      const f = await fixture();
      if (change === 'deadline') f.target.deadline++;
      if (change === 'sql') f.target.sql += ';SELECT 2';
      if (change === 'handlers') f.context.ipcMain._invokeHandlers = new Map([['dbark:request', f.wrapped]]);
      await expect(f.call('settings.get')).rejects.toThrow('永久'); expect(f.original).not.toHaveBeenCalled();
      f.target.deadline = 121000; f.target.sql = queryResultColumnsSql; f.context.ipcMain._invokeHandlers = f.handlers;
      await expect(f.call('settings.get')).rejects.toThrow('永久');
    }
  });

  it('关闭后的工作区不能恢复旧tab；多tab/错误profile/SQL修改均不获得写授权', async () => {
    const f = await fixture(); await f.complete(); await f.call('settings.save', { ...f.settings, tabs: [], activeTabId: undefined });
    const count = f.original.mock.calls.length; await expect(f.call('settings.save', f.settings)).rejects.toThrow('永久'); expect(f.original).toHaveBeenCalledTimes(count);
    for (const patch of [{ tabs: [...f.settings.tabs, { ...f.settings.tabs[0], id: 'other' }] }, { tabs: [{ ...f.settings.tabs[0], connectionId: 'other' }] }, { tabs: [{ ...f.settings.tabs[0], sql: 'SELECT 2' }] }]) {
      const other = await fixture(), before = other.original.mock.calls.length; await expect(other.call('settings.save', { ...other.settings, ...patch })).rejects.toThrow('永久'); expect(other.original).toHaveBeenCalledTimes(before);
    }
  });

  it('完成后关闭工作区可与同代session收尾并行；退出flush空设置保持幂等', async () => {
    const f = await fixture(); await f.complete(); let finish!: () => void;
    f.original.mockImplementationOnce(async (...args) => { const response = await f.delegate(...args); await new Promise<void>(resolve => { finish = resolve; }); return response; });
    const closing = f.call('sessions.close', { sessionId: 'ram-session-71' }); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const empty = { ...f.settings, tabs: [], activeTabId: undefined };
    await f.call('settings.save', empty); expect(f.read()).toMatchObject({ workspaceClosed: true, pending: 1 });
    await f.call('settings.save', empty); finish(); await closing;
    expect(f.read()).toMatchObject({ workspaceClosed: true, pending: 0, queries: 1, schemeCommands: ['list', 'save'] });
  });
});
