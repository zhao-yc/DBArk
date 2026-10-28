import { act, useState, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { QueryWarningsDialog } from '../../src/renderer/components/QueryWarningsDialog';
import { QueryWarningsViewIntent, sameQueryWarningsExecution, type QueryWarningsViewScope } from '../../src/renderer/queryWarningsView';
import { queryWarningsZh as t } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>(); let option = '', parameterExecute = '', notice = '';
/** 读取正式控件和执行函数；端口仅隔离IPC、状态和Monaco，不重写投递逻辑。 */
function inspect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(file));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'label' && node.getText(file).includes('aria-label={queryWarningsZh.option}')) option = node.getText(file);
  if (ts.isBinaryExpression(node) && node.left.getText(file) === 'collectWarnings' && ts.isJsxElement(node.right) && node.right.openingElement.tagName.getText(file) === 'aside') notice = node.getText(file);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'QueryParametersDialog') {
    const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'onExecute') as ts.JsxAttribute;
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) parameterExecute = attribute.initializer.expression!.getText(file);
  }
  ts.forEachChild(node, inspect);
}
inspect(file);
if (!option || !notice || !parameterExecute || !functions.has('runQuery')) throw Error('正式警告采集入口不完整');

function execution(outcome: QueryOutcome = { results: [], elapsedMs: 1 }) {
  const invoke = vi.fn(async () => outcome), ensureSession = vi.fn(async () => '原会话'), setOutcome = vi.fn(), clearFailureSource = vi.fn();
  const context: any = createContext({ Error, Set, invoke, ensureSession, setOutcome, clearFailureSource, collectWarnings: false, continueOnError: false, warningsResultSource: { current: null },
    parameterReuse: { current: null }, parameterReusePort: { current: null }, parameterReuseOwner: () => ({ begin: () => null }),
    busyRef: { current: false }, task: { current: '' }, cancelledQuery: { current: '' }, explainSource: { current: '' }, parameterSession: { current: '原会话' }, parameterFailureSource: { current: undefined }, parameterContinueOnError: { current: false }, parameterCollectWarnings: { current: false }, parameterSource: null,
    settings: { resultLimit: 20 }, tab: { id: '原标签' }, useWorkspace: { getState: () => ({ setBusy: vi.fn(), setDirty: vi.fn() }) },
    handleQueryError: vi.fn(async () => {}), invalidateResultSelection: vi.fn(), prepareExecutionContext: vi.fn(async () => {}), uid: () => '原任务',
    setBusy: vi.fn(), setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(),
    querySource: () => 'SELECT CAST(\'非数字\' AS UNSIGNED)', captureFailureSource: () => undefined, document: { querySelector: () => null }, zh: { query: { text001: '空SQL' } }, queryContextZh: { cancelledBeforeSend: '已取消' }, queryAnalyzeZh: { changed: '来源变化' },
  });
  context.warningsViewScope = () => ({ tabId: '原标签', connectionId: 'c', connectionVersion: 1, connection: context, sessionId: '原会话', taskId: context.task.current, outcome: null, present: true, active: true, closing: false, busy: context.busyRef.current, pinned: false });
  context.setParameterSource = (value: string | null) => { context.parameterSource = value; };
  const selected = ['runQuery', 'execute', 'openParameters', 'submitParameterQuery'].map(name => functions.get(name)!).join('\n');
  runInContext(ts.transpileModule(selected + `\nglobalThis.run=runQuery;globalThis.execute=execute;globalThis.openParameters=openParameters;globalThis.parameterExecute=${parameterExecute};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, invoke, ensureSession, setOutcome, run: context.run as (...args: any[]) => Promise<void> };
}

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const owners: QueryWarningsViewIntent[] = [];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    if (name === 'select') Object.defineProperty(node, 'options', { configurable: true, get: () => node.querySelectorAll('option') });
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; owners.splice(0).forEach(owner => owner.dispose()); document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mount(element: ReactNode) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(element)); }
const report: NonNullable<QueryOutcome['warnings']> = { collection: 'explicit', statements: [
  { statementOrdinal: 1, status: 'completed', warningCount: 4, conditions: [{ level: 'Warning', code: 1292, message: '<img src=x>转换失败\n保留原文' }], truncated: true },
  { statementOrdinal: 3, status: 'failed', conditions: [{ level: 'Error', code: 1062, messageHidden: true }], truncated: false, unavailable: '部分诊断无法确认' },
], omittedStatements: 2, truncated: true };
function ownerFixture() {
  const outcome: QueryOutcome = { results: [], elapsedMs: 1, warnings: report };
  let scope: QueryWarningsViewScope = { tabId: 't', connectionId: 'c', connectionVersion: 1, connection: {}, sessionId: 's', taskId: 'q', outcome, present: true, active: true, closing: false, busy: false, pinned: false }, changed = () => {};
  const invalidated = vi.fn(), owner = new QueryWarningsViewIntent(() => scope, callback => { changed = callback; return () => { changed = () => {}; }; }, invalidated); owners.push(owner);
  return { owner, invalidated, get scope() { return scope; }, change(patch: Partial<QueryWarningsViewScope>) { scope = { ...scope, ...patch }; changed(); } };
}

it('正式采集控件默认关闭，运行和参数表单期间锁定，提示ROW_COUNT而不泛称FOUND_ROWS会改变', async () => {
  const port = { busy: false, parameters: false }, commonJs = { exports: {} }, context: any = createContext({ exports: commonJs.exports, module: commonJs, useState, port, queryWarningsZh: t, require: () => jsxRuntime });
  runInContext(ts.transpileModule(`function Controls(){const [collectWarnings,setCollectWarnings]=useState(false),busy=port.busy,busyRef={current:busy},parameterSource=port.parameters?'模板':null;return <>${option}{${notice}}</>;}globalThis.Controls=Controls;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const Controls = context.Controls; await mount(<Controls/>); const input = document.querySelector('input')!;
  expect(input.checked).toBe(false); expect(input.parentNode!.getAttribute('title')).toContain('改变后续 ROW_COUNT()'); expect(input.parentNode!.getAttribute('title')).not.toContain('FOUND_ROWS');
  expect(document.querySelector('[role="note"]')).toBeNull(); expect(document.body.textContent).not.toContain('ROW_COUNT()');
  await act(async () => { input.checked = true; input.dispatchEvent(new MemoryEvent('click')); }); expect(input.checked).toBe(true);
  expect(document.querySelector(`[role="note"][aria-label="${t.notice}"]`)!.textContent).toBe(t.hint); expect(document.body.textContent).toContain('ROW_COUNT()');
  port.busy = true; await act(async () => root!.render(<Controls/>)); expect(input.disabled).toBe(true); port.busy = false; port.parameters = true; await act(async () => root!.render(<Controls/>)); expect(input.disabled).toBe(true);
});
it('两个执行选项位于既有上下文行的独立组，不能再挤占执行工具栏高度', () => {
  const placements: Array<{ label: string; classes: string[] }> = [];
  /** RAM不伪造像素；这里只核真实组件层级，真实高度仍由原生分栏门验证。 */
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'input') {
      const label = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'aria-label') as ts.JsxAttribute | undefined;
      const text = label?.initializer?.getText(file);
      if (text === '{queryWarningsZh.option}' || text === '{queryContinueOnErrorZh.option}') {
        const classes: string[] = [];
        for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) if (ts.isJsxElement(parent)) {
          const attribute = parent.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'className') as ts.JsxAttribute | undefined;
          if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) classes.push(...attribute.initializer.text.split(' '));
        }
        placements.push({ label: text!, classes });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file); expect(placements.map(item => item.label)).toEqual(['{queryWarningsZh.option}', '{queryContinueOnErrorZh.option}']);
  for (const item of placements) { expect(item.classes).toContain('context-bar'); expect(item.classes).toContain('query-execution-options'); expect(item.classes).not.toContain('toolbar'); }
});
it('普通和类型参数仅显式true携带采集flag，默认省略且每次只投递原查询一次', async () => {
  for (const parameters of [undefined, [{ name: 'n', type: 'integer', value: '1' }]]) for (const enabled of [false, true]) {
    const f = execution(); await f.run('SELECT 1', 'execute', parameters, undefined, undefined, undefined, false, enabled);
    expect(f.invoke).toHaveBeenCalledTimes(1); const [command, input] = f.invoke.mock.calls[0] as unknown as [string, Record<string, unknown>]; expect(command).toBe(parameters ? 'query.executeParameterized' : 'query.execute');
    if (enabled) expect(input.collectWarnings).toBe(true); else expect(input).not.toHaveProperty('collectWarnings');
  }
});
it('正式执行在建会话await前冻结选项，参数表单打开时冻结采集选项', async () => {
  const f = execution(); let resolve!: (id: string) => void; f.ensureSession.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  f.context.collectWarnings = true; const pending = f.context.execute(); f.context.collectWarnings = false; resolve('原会话'); await pending; expect((f.invoke.mock.calls[0] as unknown as [string, any])[1].collectWarnings).toBe(true);
  const g = execution(); g.context.collectWarnings = true; g.context.openParameters(); g.context.parameterSession.current = '原会话'; g.context.collectWarnings = false; g.context.parameterExecute([{ name: 'n', type: 'integer', value: '1' }]);
  await vi.waitFor(() => expect(g.invoke).toHaveBeenCalledTimes(1)); expect((g.invoke.mock.calls[0] as unknown as [string, any])[1].collectWarnings).toBe(true);
});
it('计划和实际分析不携带采集flag，已返回报告按原对象存入outcome', async () => {
  for (const mode of ['explain', 'explain-text', 'analyze']) { const f = execution(); await f.run('SELECT 1', mode, undefined, undefined, undefined, { database: null, assertCurrent() {}, allowContextPreparation() {} }, false, true); expect((f.invoke.mock.calls[0] as unknown as [string, any])[1]).not.toHaveProperty('collectWarnings'); }
  const value: QueryOutcome = { elapsedMs: 1, results: [], warnings: report }, f = execution(value); await f.run('SELECT 1', 'execute', undefined, undefined, undefined, undefined, false, true); expect(f.setOutcome).toHaveBeenCalledWith(value); expect(f.invoke).toHaveBeenCalledTimes(1);
});
it('报告离线展示真实总数/已取数量及原始Level/Code/Message，HTML仅作文本', async () => {
  const invoke = vi.fn(() => { throw Error('离线报告不允许IPC'); }); (window as any).dbark = { invoke };
  const close = vi.fn(); await mount(<QueryWarningsDialog report={report} onClose={close}/>);
  expect(document.querySelector(`[aria-label="${t.total}"]`)!.textContent).toBe('4'); expect(document.querySelector(`[aria-label="${t.collected}"]`)!.textContent).toBe('1');
  expect(document.body.textContent).toContain('Warning'); expect(document.body.textContent).toContain('1292'); expect(document.body.textContent).toContain('<img src=x>转换失败\n保留原文'); expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.body.textContent).toContain(t.truncated); expect(document.body.textContent).not.toContain('已达到采集预算'); expect(document.body.textContent).toContain(t.omitted(2)); expect(invoke).not.toHaveBeenCalled();
  const button = document.querySelectorAll('button').find(node => node.textContent === t.close)!; await act(async () => button.dispatchEvent(new MemoryEvent('click'))); expect(close).toHaveBeenCalledTimes(1); expect(invoke).not.toHaveBeenCalled();
});
it('切换原语句保留真实序号和失败状态，未知总数不补零，参数消息明确隐藏', async () => {
  await mount(<QueryWarningsDialog report={report} onClose={() => {}}/>); const select = document.querySelector('select')!;
  await act(async () => { select.value = '1'; select.dispatchEvent(new MemoryEvent('change')); });
  expect(document.querySelector(`[aria-label="${t.total}"]`)!.textContent).toBe(t.unknown); expect(document.body.textContent).toContain(t.ordinal(3)); expect(document.body.textContent).toContain(t.failed); expect(document.body.textContent).toContain(t.hidden); expect(document.body.textContent).toContain('部分诊断无法确认');
});
it('快照不绑定正文或行组织，执行/连接/会话/活动标签ABA永久撤销且不复活', () => {
  const unchanged = ownerFixture(); unchanged.change({}); expect(unchanged.owner.current()).toBe(true); expect(unchanged.owner.report).toBe(report);
  for (const patch of [{ taskId: '另一次执行' }, { sessionId: '另一个会话' }, { connection: {} }, { connectionVersion: 2 }, { active: false }, { closing: true }, { pinned: true }, { busy: true }, { outcome: { results: [], elapsedMs: 1, warnings: report } }]) {
    const f = ownerFixture(), original = f.scope; f.change(patch); f.change(original); expect(f.owner.current()).toBe(false); expect(f.invalidated).toHaveBeenCalledTimes(1);
  }
});
it('关闭释放旧owner，新快照须重新绑定，未采集报告无法创建查看owner', () => {
  const old = ownerFixture(); old.owner.dispose(); expect(old.owner.current()).toBe(false); const fresh = ownerFixture(); expect(fresh.owner.current()).toBe(true);
  expect(() => new QueryWarningsViewIntent(() => ({ ...fresh.scope, outcome: { results: [], elapsedMs: 1 } }), () => () => {}, () => {})).toThrow('没有警告报告');
});
it('执行时收据与尚未打开的旧报告不能重新绑定新来源；切换结果或编辑正文不替换执行身份', () => {
  const f = ownerFixture(), captured = f.scope;
  expect(sameQueryWarningsExecution(captured, { ...captured, active: false, pinned: true })).toBe(true);
  expect(sameQueryWarningsExecution(captured, { ...captured, sessionId: '新会话' })).toBe(false);
  expect(sameQueryWarningsExecution(captured, { ...captured, taskId: '新执行' })).toBe(false);
  const changed = { ...captured, connection: {} };
  expect(() => new QueryWarningsViewIntent(() => changed, () => () => {}, () => {}, captured)).toThrow('来源已失效');
});
