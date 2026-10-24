import { act, useEffect, useMemo, useRef, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import { QueryPartialOutcomeNotice } from '../../src/renderer/components/QueryPartialOutcomeNotice';
import { queryPartialOutcomeZh as text } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { ErrorBox } from '../../src/renderer/components/ui';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { ResultExportSelection, exportableQueryResult } from '../../src/renderer/resultExport';
import { snapshotQueryResult } from '../../src/renderer/queryPins';
import { QueryResultFilter, queryResultFilteredSortView } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { captureQueryFailureSource } from '../../src/renderer/queryFailureSource';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>(), declarations = new Map<string, string>(), buttons = new Map<string, string>(); let subscription = '', notice = '', parameterExecute = '', resultTabs = '';
/** 从实际QueryTab读取函数、按钮、订阅和结果租约表达式，不在测试重写执行或取结果逻辑。 */
function inspect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(file));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.getText(file));
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === 'useEffect' && node.getText(file).includes('window.dbark?.onTask(event =>')) subscription = node.getText(file);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button') {
    const value = node.getText(file); if (value.includes('onClick={() => void execute()}')) buttons.set('execute', value); if (value.includes('onClick={pinResult}')) buttons.set('pin', value); if (value.includes('onClick={exportVisibleResult}')) buttons.set('export', value);
  }
  if (ts.isBinaryExpression(node) && node.left.getText(file) === 'outcome?.failure' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(file) === 'QueryPartialOutcomeNotice') notice = node.getText(file);
  if (ts.isJsxExpression(node) && node.expression && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === 'results.map') resultTabs = node.getText(file);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'QueryParametersDialog') { const prop = node.attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.getText(file) === 'onExecute') as ts.JsxAttribute; if (prop.initializer && ts.isJsxExpression(prop.initializer)) parameterExecute = prop.initializer.expression!.getText(file); }
  ts.forEachChild(node, inspect);
}
inspect(file);
const names = ['runQuery', 'handleQueryError', 'querySource', 'failureSourceScope', 'captureFailureSource', 'clearFailureSource', 'execute', 'cancelCurrentQuery', 'invalidateResultSelection', 'pinResult', 'exportVisibleResult', 'resultSelectionAllowed', 'resultViewCurrent'];
const selected = ['results', 'pin', 'sourceResult', 'sourceExportable', 'viewSource', 'resultContext', 'filterBinding', 'filterView', 'sortBinding', 'sortView', 'displayedView', 'result', 'exportable', 'selectionBinding'];
for (const name of names) if (!functions.has(name)) throw Error('缺少真实QueryTab函数：' + name);
for (const name of selected) if (!declarations.has(name)) throw Error('缺少真实QueryTab结果声明：' + name);
if (!subscription || !notice || !parameterExecute || !resultTabs || buttons.size !== 3) throw Error('真实QueryTab窄适配入口不完整');
const harnessCode = `function Harness({port}) {
 const tab=port.tab, settings=port.workspace.settings, connection={}, connectionVersion=0;
 const busyRef=useRef(false), task=useRef(''), cancelledQuery=useRef(''), explainSource=useRef(''), sessionRef=useRef('session'), parameterSession=useRef('session'), editor={current:port.editor}, alive=useRef(true);
 const failureSource=useRef(undefined),parameterFailureSource=useRef(undefined),closeRequestRef=useRef(undefined);const [,refreshFailureSource]=useState(0);
 const [busy,setBusy]=useState(false),[queryRunning,setQueryRunning]=useState(false),[error,setError]=useState(''),[outcome,setOutcome]=useState(null),[stream,setStream]=useState([]),[resultIndex,setResultIndex]=useState(0),[transaction,setTransaction]=useState(false),[transactionKnown,setTransactionKnown]=useState(true),[sessionId,setSessionId]=useState('session'),[pins,setPins]=useState([]),[selectedPin,setSelectedPin]=useState(''),[showPinSql,setShowPinSql]=useState(false),[exportResult,setExportResult]=useState(null),[exportSelected,setExportSelected]=useState(false),[parameterSource,setParameterSource]=useState(port.sql);
 const resultInsertRef=useRef(null),resultInsertActivity=useRef(0);
 const pinSequence=useRef(0),resultSelection=port.selection,resultFilter=port.filter,resultSorter=port.sorter,rowDetails=port.details;
 const comparisonLeaseRef=useRef(null),statisticsLeaseRef=useRef(null),sortLeaseRef=useRef(null),filterLeaseRef=useRef(null);
 const noop=()=>{},setComparisonLease=noop,setStatisticsLease=noop,setSortLease=noop,setFilterLease=noop,setRowDetail=noop,setActiveDetailRow=noop;
 const activeColumnLease=null,activeFilterLease=null,activeSortLease=null;
 const useWorkspace={getState:()=>port.workspace,subscribe:port.subscribe??(()=>()=>{})},invoke=port.invoke,ensureSession=port.ensureSession,prepareExecutionContext=port.prepare,rememberDatabase=port.remember,uid=port.uid,errorMessage=reason=>reason.message;
 const [,force]=useState(0);port.force=()=>force(n=>n+1);
 ${names.map(name => functions.get(name)).join('\n')}
 ${subscription}
 const executeParameters=${parameterExecute};
 const ${declarations.get('results')};const ${declarations.get('pin')};const ${declarations.get('sourceResult')};const ${declarations.get('sourceExportable')};const ${declarations.get('viewSource')};const ${declarations.get('resultContext')};
 const visibleColumns=sourceResult?.columns??[],resultModal=false,failureLocator=failureSource.current;
 const ${declarations.get('filterBinding')};const ${declarations.get('filterView')};const ${declarations.get('sortBinding')};const ${declarations.get('sortView')};const ${declarations.get('displayedView')};const ${declarations.get('result')};const ${declarations.get('exportable')};const ${declarations.get('selectionBinding')};
 port.read=()=>({busy,queryRunning,error,outcome,stream,results,sourceResult,sourceExportable,selectionBinding,filterBinding,filterView,sortBinding,sortView,exportResult,pins,transaction,transactionKnown});
 port.current=()=>runQuery(port.sql,'execute',undefined,port.intent);port.cancel=cancelCurrentQuery;
 return <>${buttons.get('execute')}${buttons.get('pin')}${buttons.get('export')}${resultTabs}<button onClick={()=>executeParameters(port.parameters)}>正式参数回调</button>{${notice}}<ErrorBox message={error}/><div aria-label="本次结果">{results.map((item,index)=><p key={index}>{JSON.stringify(item.rows)}</p>)}</div></>;
}`;

let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Harness: React.ComponentType<{ port: any }>;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); const create = doc.createElement.bind(doc); doc.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; }; ({ createRoot } = await import('react-dom/client'));
  const context: any = createContext({ exports: {}, useEffect, useMemo, useRef, useState, captureQueryFailureSource, QueryPartialOutcomeNotice, ErrorBox, zh, formatText, exportableQueryResult, snapshotQueryResult, queryResultFilteredSortView, document: doc, window, Error, Play: () => null, Pin: () => null, Download: () => null, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止载入其他QueryTab依赖'); } });
  runInContext(ts.transpileModule(harnessCode + '\nglobalThis.Harness=Harness;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context); Harness = context.Harness;
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 仅控制原IPC的Promise和协议缓存，不伪造产品成功或更换结果来源算法。 */
function portFixture() {
  let serial = 0, listener: ((event: any) => void) | undefined;
  const sql = 'SELECT :sensitive; BAD SQL; SELECT :never;', tab = { id: 'tab', kind: 'query', connectionId: 'c', sql };
  const workspace = { settings: { resultLimit: 10, activeTabId: 'tab', tabs: [tab] }, connections: [{ id: 'c' }], connectionVersions: { c: 0 }, activeJobs: {} as Record<string, boolean>, setBusy: vi.fn((id, value) => { workspace.activeJobs[id] = value; }), setDirty: vi.fn() };
  const model = { getValue: () => sql, getValueInRange: () => '' };
  const invoke = vi.fn(async (command: string): Promise<any> => command === 'query.sessionState' ? { broken: false, transactionOpen: false, transactionKnown: false } : { results: [], elapsedMs: 1 });
  const port: any = { sql, tab, workspace, invoke, selection: new ResultExportSelection(), filter: new QueryResultFilter(), sorter: new QueryResultSort(), details: new QueryRowDetails(), ensureSession: vi.fn(async () => 'session'), prepare: vi.fn(async () => {}), remember: vi.fn(), uid: () => 'task-' + ++serial, editor: { getSelection: () => null, getModel: () => model }, parameters: [{ name: 'sensitive', type: 'text', value: '参数秘密' }], intent: { offset: 4, bindSession: vi.fn(), assertCurrent: vi.fn() } };
  (window as any).dbark = { onTask: (value: typeof listener) => { listener = value; return () => { listener = undefined; }; } };
  return Object.assign(port, { emit: (event: any) => listener?.(event) });
}
const complete = (values = ['3', '1', '2'], statement = 'SELECT 完整成功语句'): QueryResult => ({ columns: [{ key: 'k', name: '完整列', type: 'BIGINT' }], rows: values.map(k => ({ k })), statement, elapsedMs: 7, truncated: false });
const partial = (results: QueryResult[] = [complete()]): QueryOutcome => ({ results, elapsedMs: 9, failure: { statementOrdinal: 2, statementsCompleted: 1, message: '已脱敏的失败消息' } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(port: any) { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<Harness port={port}/>)); }
function button(label: string) { const node = doc.querySelectorAll('button').find(value => value.textContent.startsWith(label)); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
function executions(port: any) { return port.invoke.mock.calls.filter(([command]: [string]) => command === 'query.execute' || command === 'query.executeParameterized'); }

describe('真实QueryTab部分失败回执、流结果与导出来源', () => {
  it('失败前完整结果替换失败语句流，缓存核验pending时也不展示污染流且不提前解锁', async () => {
    const f = portFixture(), execute = deferred<QueryOutcome>(), cached = deferred<any>(); f.invoke.mockImplementation((command: string) => command === 'query.execute' ? execute.promise : cached.promise); await mount(f); await click(zh.query.text010); const taskId = executions(f)[0][1].taskId;
    await act(async () => f.emit({ taskId, resultIndex: 1, columns: complete().columns, batch: [{ k: 'FAILED_PARTIAL' }] })); expect(doc.body.textContent).toContain('FAILED_PARTIAL');
    const outcome = partial(); await act(async () => execute.resolve(outcome)); expect(f.read().busy).toBe(true); expect(f.read().stream).toEqual([]); expect(f.read().results).toBe(outcome.results); expect(doc.body.textContent).not.toContain('FAILED_PARTIAL'); expect(f.read().selectionBinding).toBeUndefined();
    await act(async () => f.emit({ taskId, resultIndex: 1, batch: [{ k: 'LATE_FAILED_PARTIAL' }] })); expect(f.read().results).toBe(outcome.results); expect(doc.body.textContent).not.toContain('LATE_FAILED_PARTIAL');
    await act(async () => cached.resolve({ broken: false, transactionOpen: false, transactionKnown: false })); expect(f.read().busy).toBe(false); expect(f.read().outcome).toBe(outcome); expect(f.read().transactionKnown).toBe(false); expect(f.workspace.setDirty).toHaveBeenLastCalledWith('tab', true); expect(doc.body.textContent).toContain(text.position(2, 1)); expect(doc.body.textContent).toContain('已脱敏的失败消息'); expect(doc.body.textContent).toContain(text.warning); expect(executions(f)).toHaveLength(1); expect(f.invoke.mock.calls.map(([command]: [string]) => command)).toEqual(['query.execute', 'query.sessionState']);
  });
  it('完整成功前缀可按原行过滤排序后导出，旧结果租约不能跨执行复活', async () => {
    const f = portFixture(); f.invoke.mockResolvedValueOnce({ results: [complete(['9'])], elapsedMs: 1 }); await mount(f); await click(zh.query.text010); const old = f.read().selectionBinding; expect(old).toBeDefined(); const outcome = partial(); f.invoke.mockResolvedValueOnce(outcome); await click(zh.query.text010); expect(f.selection.current(old)).toBe(false); expect(() => f.selection.allSnapshot(old)).toThrow();
    const state = f.read(); await act(async () => { f.filter.apply(state.filterBinding, state.filterView, [{ column: 'k', operator: 'gte', value: '2' }], 'AND'); f.force(); }); await act(async () => { const now = f.read(); f.sorter.apply(now.sortBinding, now.sortView, { column: 'k', direction: 'DESC' }); f.force(); }); await click(zh.resultExport.title); expect(f.read().exportResult.rows).toEqual([{ k: '3' }, { k: '2' }]); expect(outcome.results[0].rows).toEqual([{ k: '3' }, { k: '1' }, { k: '2' }]); expect(executions(f)).toHaveLength(2);
  });
  it('可固定完整成功结果，固定不执行SQL且失败范围提示不会被清错误动作抹掉', async () => {
    const f = portFixture(), outcome = partial(); f.invoke.mockResolvedValueOnce(outcome); await mount(f); await click(zh.query.text010); await click(zh.query.pinResult); expect(f.read().pins).toHaveLength(1); expect(f.read().pins[0].result).toEqual(outcome.results[0]); expect(f.read().pins[0].result).not.toBe(outcome.results[0]); expect(doc.body.textContent).toContain(text.title); expect(executions(f)).toHaveLength(1); await click(zh.resultExport.title); expect(f.read().exportResult.rows).toEqual(outcome.results[0].rows);
  });
  it('多个完整成功结果保留原次序且真实结果标签可切换并按原源导出', async () => {
    const f = portFixture(), first = complete(['1'], '第一条成功'), second = complete(['9007199254740993'], '第二条成功'), outcome = { ...partial([first, second]), failure: { statementOrdinal: 3, statementsCompleted: 2, message: '第三条失败' } }; f.invoke.mockResolvedValueOnce(outcome); await mount(f); await click(zh.query.text010); expect(f.read().sourceResult).toBe(first); await click(zh.query.text017 + '2'); expect(f.read().sourceResult).toBe(second); await click(zh.resultExport.title); expect(f.read().exportResult.rows).toEqual(second.rows); expect(doc.body.textContent).toContain(text.position(3, 2)); expect(doc.body.textContent).toContain(text.retained(2)); expect(executions(f)).toHaveLength(1);
  });
  it('只有用户新执行才替换旧失败结果，前一task迟到流不能进入新执行', async () => {
    const f = portFixture(); f.invoke.mockResolvedValueOnce(partial()); await mount(f); await click(zh.query.text010); const oldId = executions(f)[0][1].taskId, next = deferred<QueryOutcome>(); f.invoke.mockImplementation((command: string) => command === 'query.execute' ? next.promise : Promise.resolve(null)); await click(zh.query.text010); expect(f.read().outcome).toBeNull(); expect(f.read().results).toEqual([]); await act(async () => f.emit({ taskId: oldId, resultIndex: 0, columns: complete().columns, batch: [{ k: 'OLD_FAILED_STREAM' }] })); expect(f.read().stream).toEqual([]); expect(doc.body.textContent).not.toContain(text.title); await act(async () => next.resolve({ results: [complete(['8'])], elapsedMs: 1, transactionOpen: false })); expect(f.read().sourceResult.rows).toEqual([{ k: '8' }]); expect(executions(f)).toHaveLength(2);
  });
  it('零成功结果没有当前可固定或导出来源，迟到流不能冒充完整结果', async () => {
    const f = portFixture(); f.invoke.mockResolvedValueOnce({ ...partial([]), failure: { statementOrdinal: 1, statementsCompleted: 0, message: '第一条失败' } }); await mount(f); await click(zh.query.text010); const taskId = executions(f)[0][1].taskId; await act(async () => f.emit({ taskId, resultIndex: 0, columns: complete().columns, batch: [{ k: 'BAD' }] })); expect(f.read().results).toEqual([]); expect(f.read().sourceExportable).toBeUndefined(); expect(button(zh.query.pinResult).disabled).toBe(true); expect(button(zh.resultExport.title).disabled).toBe(true); expect(doc.body.textContent).toContain(text.empty); expect(doc.body.textContent).not.toContain('BAD');
  });
  it('成功回包保持原事务样式及结果，不出现首错提示也不读取错误缓存', async () => {
    const f = portFixture(), outcome = { results: [complete()], elapsedMs: 4, transactionOpen: true }; f.invoke.mockResolvedValueOnce(outcome); await mount(f); await click(zh.query.text010); expect(f.read().outcome).toBe(outcome); expect(f.read().transaction).toBe(true); expect(f.read().transactionKnown).toBe(true); expect(f.workspace.setDirty).toHaveBeenLastCalledWith('tab', true); expect(doc.body.textContent).not.toContain(text.title); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('原参数回调只投递一次参数命令，摘要不回显模板SQL或绑定参数', async () => {
    const f = portFixture(); f.invoke.mockResolvedValueOnce(partial()); await mount(f); await click('正式参数回调'); expect(executions(f)).toHaveLength(1); expect(executions(f)[0]).toMatchObject(['query.executeParameterized', { sql: f.sql, parameters: f.parameters }]); expect(doc.body.textContent).not.toContain(f.sql); expect(doc.body.textContent).not.toContain('参数秘密'); expect(doc.body.textContent).toContain(text.title);
  });
  it('当前语句意图在发送前仍核对并保留offset，首错不自动继续或重新执行', async () => {
    const f = portFixture(); f.invoke.mockResolvedValueOnce(partial()); await mount(f); await act(async () => f.current()); expect(f.intent.bindSession).toHaveBeenCalledExactlyOnceWith('session'); expect(f.intent.assertCurrent).toHaveBeenCalledTimes(1); expect(executions(f)[0][1]).toMatchObject({ sql: f.sql, currentStatement: { offset: 4 } }); expect(executions(f)).toHaveLength(1);
  });
  it('取消仍沿原reject处理且无成功结果，不自动rollback/重连/诊断SQL', async () => {
    const f = portFixture(), executing = deferred<QueryOutcome>(); f.invoke.mockImplementation((command: string) => command === 'query.execute' ? executing.promise : Promise.resolve(command === 'query.sessionState' ? null : undefined)); await mount(f); await click(zh.query.text010); await act(async () => f.cancel()); expect(f.read().busy).toBe(true); await act(async () => executing.reject(Error('任务已取消'))); expect(f.read().outcome).toBeNull(); expect(f.read().sourceExportable).toBeUndefined(); expect(f.read().transactionKnown).toBe(false); expect(f.workspace.setDirty).toHaveBeenLastCalledWith('tab', true); expect(doc.body.textContent).not.toContain(text.title); expect(f.invoke.mock.calls.map(([command]: [string]) => command)).toEqual(['query.execute', 'query.cancel', 'query.sessionState']);
  });
  it('原缓存确认断线仍关闭原会话而不重连，完整成功前缀保留可导出', async () => {
    const f = portFixture(); f.invoke.mockImplementation(async (command: string) => command === 'query.execute' ? partial() : command === 'query.sessionState' ? { broken: true } : undefined); await mount(f); await click(zh.query.text010); expect(f.read().sourceExportable).toBeDefined(); expect(f.workspace.setDirty).toHaveBeenLastCalledWith('tab', false); expect(f.remember).toHaveBeenCalledExactlyOnceWith({ state: 'unknown' }); expect(f.invoke.mock.calls.map(([command]: [string]) => command)).toEqual(['query.execute', 'query.sessionState', 'sessions.close']);
  });
});
