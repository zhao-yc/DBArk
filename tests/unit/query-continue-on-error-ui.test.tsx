import { act, useState, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import type { QueryFailure } from '../../src/shared/queryFailure';
import { QueryContinueOnErrorNotice, confirmedQueryContinueRange } from '../../src/renderer/components/QueryContinueOnErrorNotice';
import { queryContinueOnErrorZh as t } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>(); let option = '';
/** 窄端口直接提取正式执行方法和选项控件，不在测试重写投递逻辑。 */
function inspect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(file));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'label' && node.getText(file).includes('aria-label={queryContinueOnErrorZh.option}')) option = node.getText(file);
  ts.forEachChild(node, inspect);
}
inspect(file);
if (!option || !functions.has('runQuery') || !functions.has('execute')) throw Error('正式遇错继续入口未找到');

/** 仅隔离IPC/状态端口；执行方法仍是当前QueryTab源码。 */
function execution(outcome: QueryOutcome = { results: [], elapsedMs: 1 }) {
  const invoke = vi.fn(async () => outcome), ensureSession = vi.fn(async () => '原会话'), errors = vi.fn(async () => {});
  const workspace = { setBusy: vi.fn(), setDirty: vi.fn() }, scriptFailureRanges = { current: new Set<QueryFailure>() }, failureSource = { current: undefined as any };
  const context: any = createContext({ Error, Set, confirmedQueryContinueRange, invoke, ensureSession, continueOnError: false, scriptFailureRanges, failureSource,
    busyRef: { current: false }, task: { current: '' }, cancelledQuery: { current: '' }, explainSource: { current: '' }, parameterSession: { current: '原会话' }, settings: { resultLimit: 25 }, tab: { id: '原标签' },
    useWorkspace: { getState: () => workspace }, handleQueryError: errors, clearFailureSource: vi.fn(), invalidateResultSelection: vi.fn(), prepareExecutionContext: vi.fn(async () => {}), uid: () => '本次任务',
    setBusy: vi.fn(), setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setOutcome: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(),
    querySource: () => 'SELECT 1;BAD;SELECT 3', captureFailureSource: () => undefined, document: { querySelector: () => null }, zh: { query: { text001: '空SQL' } }, queryContextZh: { cancelledBeforeSend: '已取消' }, queryAnalyzeZh: { changed: '分析来源已变化' },
  });
  runInContext(ts.transpileModule(functions.get('runQuery')! + '\n' + functions.get('execute')! + '\nglobalThis.run=runQuery;globalThis.execute=execute;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, invoke, ensureSession, errors, scriptFailureRanges, failureSource, run: context.run as (...args: any[]) => Promise<void> };
}

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mount(element: ReactNode) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(element)); }
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
const failure = (ordinal: number, message = '数据库错误'): QueryFailure & { kind: 'server' } => ({ statementOrdinal: ordinal, statementsCompleted: ordinal - 1, message, kind: 'server', sourceRange: { start: ordinal - 1, end: ordinal } });
function report(errors = [failure(2), failure(4)]): NonNullable<QueryOutcome['scriptReport']> { return { mode: 'continue-on-error', statementsAttempted: 5, statementsCompleted: 3, reachedEnd: true, errors }; }

it('正式选项默认未勾选，运行与参数表单期间锁定，并显示诊断与写入提示', async () => {
  const port = { busy: false, parameters: false }, context: any = createContext({ exports: {}, useState, port, queryContinueOnErrorZh: t, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('控件端口禁止额外依赖'); } });
  runInContext(ts.transpileModule(`function Controls(){const [continueOnError,setContinueOnError]=useState(false),busy=port.busy,busyRef={current:busy},parameterSource=port.parameters?'模板':null;return ${option};}globalThis.Controls=Controls;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const Controls = context.Controls; await mount(<Controls/>); const input = document.querySelector('input')!;
  expect(input.checked).toBe(false); expect(input.disabled).toBe(false); expect(input.parentNode!.getAttribute('title')).toContain('包括写操作'); expect(input.parentNode!.getAttribute('title')).toContain('ROW_COUNT()');
  await act(async () => { input.checked = true; input.dispatchEvent(new MemoryEvent('click')); }); expect(input.checked).toBe(true);
  port.busy = true; await act(async () => root!.render(<Controls/>)); expect(input.disabled).toBe(true);
  port.busy = false; port.parameters = true; await act(async () => root!.render(<Controls/>)); expect(input.disabled).toBe(true);
});
it('默认普通查询与类型参数查询完全省略字段，显式true才投递一次', async () => {
  for (const parameters of [undefined, [{ name: 'x', type: 'integer', value: '1' }]]) for (const enabled of [false, true]) {
    const f = execution(); await f.run('SELECT 1', 'execute', parameters, undefined, undefined, undefined, enabled);
    expect(f.invoke).toHaveBeenCalledTimes(1); const [command, input] = f.invoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(command).toBe(parameters ? 'query.executeParameterized' : 'query.execute');
    if (enabled) expect(input.continueOnError).toBe(true); else expect(input).not.toHaveProperty('continueOnError');
  }
});
it('正式执行按钮在等待建会话前冻结选项，后续状态变化不能改变本次请求', async () => {
  const f = execution(); let resolve!: (value: string) => void; f.ensureSession.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  f.context.continueOnError = true; const pending = f.context.execute(); f.context.continueOnError = false; resolve('原会话'); await pending;
  expect(f.invoke).toHaveBeenCalledTimes(1); expect((f.invoke.mock.calls[0] as unknown as [string, any])[1].continueOnError).toBe(true);
});
it('执行计划、文本计划和实际分析即使传true也不携带遇错继续', async () => {
  for (const mode of ['explain', 'explain-text', 'analyze']) {
    const f = execution(), intent = { database: null, assertCurrent() {}, allowContextPreparation() {} };
    await f.run('SELECT 1', mode, undefined, undefined, undefined, intent, true); expect(f.invoke).toHaveBeenCalledTimes(1); expect((f.invoke.mock.calls[0] as unknown as [string, any])[1]).not.toHaveProperty('continueOnError');
  }
});
it('多错报告保留真实成功结果和首错误展示，仅共享一份定位捕获且不重试', async () => {
  const first = failure(2), second = failure(4), value: QueryOutcome = { elapsedMs: 3, results: [], failure: first, scriptReport: report([first, second]) };
  const f = execution(value), locator = { bindRange: vi.fn(() => true), dispose: vi.fn() };
  await f.run('abcdefgh', 'execute', undefined, undefined, locator, undefined, true);
  expect(f.invoke).toHaveBeenCalledTimes(1); expect(f.context.setOutcome).toHaveBeenCalledWith(value); expect(f.context.setStream).toHaveBeenCalledWith([]); expect(f.errors).toHaveBeenCalledTimes(1);
  expect(f.scriptFailureRanges.current).toEqual(new Set([first, second])); expect(f.failureSource.current).toBe(locator); expect(locator.bindRange).toHaveBeenCalledTimes(1); expect(locator.dispose).not.toHaveBeenCalled();
});
it('摘要展示末尾完成/真实计数/逐条顺序，定位只回交所选错误不执行', async () => {
  const value = report(), locate = vi.fn(); await mount(<QueryContinueOnErrorNotice report={value} completedResults={3} locateAvailable={item => item === value.errors[1]} onLocate={locate}/>);
  expect(document.body.textContent).toContain(t.counts(5, 3, 2)); expect(document.body.textContent).toContain(t.reachedEnd); expect(document.body.textContent).not.toContain('首个错误处停止'); expect(button(t.locate(2)).disabled).toBe(true);
  await act(async () => button(t.locate(4)).dispatchEvent(new MemoryEvent('click'))); expect(locate).toHaveBeenCalledExactlyOnceWith(value.errors[1]);
});
it('全成功也显示显式模式摘要，停止原因仅作有界文字显示', async () => {
  await mount(<QueryContinueOnErrorNotice report={{ ...report([]), statementsCompleted: 5 }} completedResults={5}/>); expect(document.body.textContent).toContain(t.title); expect(document.body.textContent).toContain(t.counts(5, 5, 0)); expect(document.querySelectorAll('button')).toHaveLength(0);
  await act(async () => root!.render(<QueryContinueOnErrorNotice report={{ ...report([]), reachedEnd: false, stopReason: '<img src=x>' + '错'.repeat(6000) }} completedResults={1}/>));
  expect(document.body.textContent).toContain(t.stopped); expect(document.body.textContent).toContain(t.truncated); expect(document.querySelectorAll('img')).toHaveLength(0); expect(document.body.textContent.length).toBeLessThan(5000);
});
it('原模板范围必须为有界自有数据且不能切开代理对，缺失范围禁用', async () => {
  const text = 'A😀B'; expect(confirmedQueryContinueRange(text, { ...failure(1), sourceRange: { start: 1, end: 3 } })).toBe(true);
  for (const sourceRange of [undefined, { start: 2, end: 3 }, { start: 0, end: 99 }, { start: 3, end: 1 }, { start: -1, end: 1 }]) expect(confirmedQueryContinueRange(text, { ...failure(1), sourceRange })).toBe(false);
  const getter = vi.fn(() => ({ start: 0, end: 1 })), unsafe = Object.defineProperty({ ...failure(1) }, 'sourceRange', { get: getter }); expect(confirmedQueryContinueRange(text, unsafe)).toBe(false); expect(getter).not.toHaveBeenCalled();
  await mount(<QueryContinueOnErrorNotice report={report()} completedResults={0}/>); expect(document.querySelectorAll('button').every(node => node.disabled)).toBe(true);
});
