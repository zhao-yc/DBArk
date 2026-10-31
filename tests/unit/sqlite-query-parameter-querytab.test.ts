import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { QueryParameterNames } from '../../src/shared/queryParameters';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';

const tree = ts.createSourceFile('QueryTab.tsx', readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['openParameters', 'assertSqliteParameterForm', 'loadParameterNames', 'prepareExecutionContext', 'runQuery', 'submitParameterQuery', 'closeParameters'], methods = new Map<string, string>();
const bindings = new Map<string, string>();
/** 所有准入和await处理器均取实际QueryTab，不复制产品控制流。 */
function inspect(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) methods.set(node.name.text, node.getText(tree)); if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'QueryParametersDialog') for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) bindings.set(attr.name.getText(tree), attr.initializer.expression.getText(tree)); ts.forEachChild(node, inspect); } inspect(tree);
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const metadata = (): QueryParameterNames => ({ dialect: 'sqlite', names: ['value'], warnings: [], noBackslashEscapes: true, ansiQuotes: true, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 38, allowTimeEndpointFraction: true });
function fixture() {
  let sql = 'SELECT :value', modal = false, fileBusy = false, sequence = 0, ctx: any;
  const profile = { id: 'sqlite', dialect: 'sqlite', sqlite: { filePath: 'C:\\合成参数.sqlite', readOnly: false, busyTimeoutMs: 1000 } }, tab = { id: 'tab', kind: 'query', connectionId: 'sqlite', sql, database: 'main', fileSourceBinding: undefined, sourceBinding: undefined };
  const workspace = { settings: { tabs: [tab], activeTabId: 'tab' }, connections: [profile], connectionVersions: { sqlite: 1 }, activeJobs: {} as Record<string, boolean>, setBusy: vi.fn(), setDirty: vi.fn() };
  const observe = () => { const form = ctx?.sqliteParameterForm.current; if (form) { try { ctx.handlers.assertSqliteParameterForm(form); } catch {} } };
  workspace.setBusy.mockImplementation((id: string, busy: boolean) => { workspace.activeJobs[id] = busy; observe(); });
  const invoke = vi.fn(async (command: string, _input: any): Promise<any> => command === 'query.parameterNames' ? metadata() : command === 'query.completionState' ? { databaseKnown: true, database: 'main', broken: false, busy: false } : command === 'query.executeParameterized' ? { results: [], elapsedMs: 1, transactionOpen: true } : (() => { throw Error('意外IPC'); })());
  const owner = { begin: vi.fn(() => ({})), recognized: vi.fn(), observe: vi.fn(), bind: vi.fn(), settled: vi.fn(() => false), close: vi.fn(), beforeLedger: vi.fn() }, ensureSession = vi.fn(async () => ctx.sessionRef.current), flushSettings = vi.fn(async () => {}), handleQueryError = vi.fn(async (_reason: unknown) => {});
  ctx = createContext({ sqlite: true, sqliteZh, parameterZh, queryContextZh, tab, settings: { resultLimit: 10 }, useWorkspace: { getState: () => workspace }, document: { querySelector: () => modal ? {} : null }, alive: { current: true }, closeRequestRef: { current: undefined }, busyRef: { current: false }, fileSource: { isBusy: () => fileBusy }, formatting: { current: null }, sessionRef: { current: 'sqlite:s' }, parameterSession: { current: '' }, sqliteParameterForm: { current: null }, parameterFailureSource: { current: undefined }, parameterContinueOnError: { current: false }, parameterCollectWarnings: { current: false }, parameterReusePort: { current: null }, parameterReuse: { current: owner }, continueOnError: true, collectWarnings: true, parameterReuseOwner: () => owner, parameterReuseInput: () => null,
    querySource: () => sql, clearFailureSource: vi.fn(), captureFailureSource: () => undefined, invalidateResultSelection: vi.fn(), setParameterSource: (source: string | null) => { ctx.parameterSource = source; }, uid: () => 'id-' + ++sequence, task: { current: '' }, cancelledQuery: { current: '' }, ensureSession, flushSettings, handleQueryError, invoke, rememberDatabase: vi.fn(), queryDatabaseFromSession: (state: any) => ({ state: 'known', database: state.database }), errorMessage: (reason: any) => reason.message, zh: { query: { text001: '请输入SQL' } },
    setBusy: vi.fn(), setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setOutcome: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(), explainSource: { current: '' }, confirmParameterReuse: vi.fn(),
  });
  expect(methods.size).toBe(names.length); runInContext(ts.transpileModule([...methods.values()].join('\n') + '\nglobalThis.handlers={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  runInContext('globalThis.bind=(sqliteParameterDialog,parameterSource)=>({onExecute:' + bindings.get('onExecute') + ',onClose:' + bindings.get('onClose') + ',loadNames:' + bindings.get('loadNames') + '});', ctx);
  async function ready() { ctx.handlers.openParameters(); const form = ctx.sqliteParameterForm.current; await ctx.handlers.loadParameterNames(form); return form; }
  const runs = () => invoke.mock.calls.filter(([command]) => command === 'query.executeParameterized');
  return { ctx, workspace, profile, tab, invoke, owner, ensureSession, flushSettings, handleQueryError, ready, runs, observe, file(value: boolean) { fileBusy = value; observe(); }, modal(value: boolean) { modal = value; }, model(value: string) { sql = value; tab.sql = value; }, async submit(form: any, value = '0001-01-01') { ctx.handlers.submitParameterQuery(form.source, [{ name: 'value', type: 'date', value }], form); await vi.waitFor(() => expect(ctx.busyRef.current).toBe(false)); } };
}

describe('SQLite 参数执行原表单与物理会话真实QueryTab处理器', () => {
  it('明确打开仅捕获选区/全文并冻结false开关，原参数Modal不会阻止识别和执行', async () => {
    const f = fixture(); f.ctx.handlers.openParameters(); const form = f.ctx.sqliteParameterForm.current; expect(form.source).toBe('SELECT :value'); expect(f.invoke).not.toHaveBeenCalled(); expect(f.ctx.parameterContinueOnError.current).toBe(false); expect(f.ctx.parameterCollectWarnings.current).toBe(false); f.modal(true); await f.ctx.handlers.loadParameterNames(form); expect(f.invoke.mock.calls[0]).toEqual(['query.parameterNames', { sessionId: 'sqlite:s', sql: form.source }]); await f.submit(form); expect(f.runs()).toHaveLength(1); expect(f.runs()[0][1]).toMatchObject({ sessionId: 'sqlite:s', sql: 'SELECT :value', parameters: [{ name: 'value', type: 'date', value: '0001-01-01' }] }); expect(Object.hasOwn(f.runs()[0][1], 'continueOnError')).toBe(false); expect(Object.hasOwn(f.runs()[0][1], 'collectWarnings')).toBe(false); expect(f.workspace.setDirty).toHaveBeenCalledWith('tab', true);
  });
  it('后台model改动不改捕获模板；普通明确确认仍执行原source，复用及定位由原独立租约撤销', async () => { const f = fixture(), form = await f.ready(); f.model('SELECT :other'); await f.submit(form); expect(f.runs()[0][1].sql).toBe('SELECT :value'); expect(f.tab.sql).toBe('SELECT :other'); });
  it.each(['hidden', 'busy', 'closing', 'file'] as const)('%s初始拒打开参数，无识别或执行副作用', kind => { const f = fixture(); if (kind === 'hidden') f.workspace.settings.activeTabId = 'other'; else if (kind === 'busy') f.ctx.busyRef.current = true; else if (kind === 'closing') f.ctx.closeRequestRef.current = {}; else f.file(true); f.ctx.handlers.openParameters(); expect(f.ctx.sqliteParameterForm.current).toBeNull(); expect(f.invoke).not.toHaveBeenCalled(); });
  it('旧dialog lease不能借同source新form或新session，旧close也不清后继参数窗口', async () => {
    const f = fixture(), old = await f.ready(), callbacks = f.ctx.bind(old, old.source); expect(bindings.get('key')).toBe('sqlite ? sqliteParameterDialog?.id : undefined'); callbacks.onClose(); f.ctx.handlers.openParameters(); const next = f.ctx.sqliteParameterForm.current; expect(next.id).not.toBe(old.id); expect(() => callbacks.onExecute([])).toThrow(parameterZh.sqliteSourceChanged); await expect(callbacks.loadNames()).rejects.toThrow(parameterZh.sqliteSourceChanged); callbacks.onClose(); expect(f.ctx.sqliteParameterForm.current).toBe(next); expect(f.runs()).toHaveLength(0);
  });
  it.each(['profile', 'version', 'session', 'active', 'close', 'file'] as const)('%s ABA在落盘等待中永久撤权，旧值不投递后继上下文', async kind => {
    const f = fixture(), form = await f.ready(), held = gate(); f.flushSettings.mockImplementationOnce(() => held.promise); f.ctx.handlers.submitParameterQuery(form.source, [{ name: 'value', type: 'text', value: '秘密' }], form); await vi.waitFor(() => expect(f.flushSettings).toHaveBeenCalledOnce());
    if (kind === 'profile') { f.workspace.connections = [{ ...f.profile }]; f.observe(); f.workspace.connections = [f.profile]; }
    else if (kind === 'version') { f.workspace.connectionVersions.sqlite++; f.observe(); f.workspace.connectionVersions.sqlite--; }
    else if (kind === 'session') { f.ctx.sessionRef.current = 'sqlite:new'; f.ctx.parameterSession.current = 'sqlite:new'; f.observe(); f.ctx.sessionRef.current = 'sqlite:s'; f.ctx.parameterSession.current = 'sqlite:s'; }
    else if (kind === 'active') { f.workspace.settings.activeTabId = 'other'; f.observe(); f.workspace.settings.activeTabId = 'tab'; }
    else if (kind === 'close') { f.ctx.closeRequestRef.current = {}; f.observe(); f.ctx.closeRequestRef.current = undefined; }
    else { f.file(true); f.file(false); } f.observe(); held.release(); await vi.waitFor(() => expect(f.ctx.busyRef.current).toBe(false)); expect(f.runs()).toHaveLength(0); expect(form.valid).toBe(false);
  });
  it('原物理session在ensureSession等待后被替换时拒绝，不能只比较后来parameterSession全局值', async () => {
    const f = fixture(), form = await f.ready(), held = gate(); f.ensureSession.mockImplementationOnce(async () => { await held.promise; return 'sqlite:new'; }); f.ctx.handlers.submitParameterQuery(form.source, [{ name: 'value', type: 'null' }], form); f.ctx.sessionRef.current = 'sqlite:new'; f.ctx.parameterSession.current = 'sqlite:new'; f.observe(); held.release(); await vi.waitFor(() => expect(f.ctx.busyRef.current).toBe(false)); expect(f.runs()).toHaveLength(0);
  });
  it('参数准备期取消准确原任务，迟到落盘不发送SQL，也不把值写入源正文', async () => {
    const f = fixture(), form = await f.ready(), held = gate(); f.flushSettings.mockImplementationOnce(() => held.promise); f.ctx.handlers.submitParameterQuery(form.source, [{ name: 'value', type: 'text', value: '不落盘秘密' }], form); await vi.waitFor(() => expect(f.flushSettings).toHaveBeenCalledOnce()); f.ctx.cancelledQuery.current = f.ctx.task.current; held.release(); await vi.waitFor(() => expect(f.ctx.busyRef.current).toBe(false)); expect(f.runs()).toHaveLength(0); expect(f.tab.sql).toBe('SELECT :value');
  });
});
