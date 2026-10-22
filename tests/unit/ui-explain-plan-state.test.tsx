import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { parseExplainPlan } from '../../src/shared/explain';
import { savedQueryOriginContext } from '../../src/shared/queryBinding';
import { resolveQueryDatabase, queryDatabaseFromSession } from '../../src/shared/queryContext';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { ExplainPlanView } from '../../src/renderer/components/ExplainPlanView';
import { ResultsGrid } from '../../src/renderer/components/ResultsGrid';
import { queryResultSelectionFixture } from '../fixtures/query-result-selection';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { QueryResultSort } from '../../src/renderer/queryResultSort';

// 仅隔离结果网格的DOM依赖，计划查看器、JSX元素和实际保存/执行函数均使用真实代码。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
const require = createRequire(import.meta.url);
const plan = parseExplainPlan('{"query_block":{"table":{"table_name":"subject","access_type":"ALL","rows_examined_per_scan":2}}}', 'mysql', '8.4.0');

/** 从实际QueryTab提取结果表达式和操作函数，避免另写一份挂载条件后只验证副本。 */
function fixture() {
  const selection = queryResultSelectionFixture();
  const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions: string[] = []; let body = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && ['saveQuery', 'runQuery', 'clearFailureSource', 'invalidateResultSelection', 'selectActiveDetailRow', 'rowDetailAllowed', 'resultViewCurrent', 'travelResultHistory'].includes(node.name.text)) functions.push(node.getText(file));
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className' && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'result-body')) body = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file); expect(body).not.toBe('');
  const sourceBinding = { id: 'source', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: 'db' } };
  const tab = { id: 'draft', connectionId: 'c', sourceBinding, sql: 'SELECT 1', databaseContext: { state: 'known', database: 'db' } };
  const outcome = { explain: plan, results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'JSON' }], rows: [{ c0: plan.raw }] }], elapsedMs: 1 };
  const invoke = vi.fn(async (command: string, _input?: unknown): Promise<any> => command === 'query.completionState' ? { databaseKnown: true, database: 'db' } : { name: '查询', source: sourceBinding });
  const workspace = { settings: { tabs: [tab] }, setBusy: vi.fn(), setDirty: vi.fn(), updateTab: vi.fn(), notify: vi.fn() };
  const frames: ReactElement[] = [], clearOutcome = vi.fn();
  // 本端口只核计划身份，结果选择回调保持关闭；执行路径仍清除真实选择实例。
  const context = createContext({ filterBinding: undefined, filterView: undefined, historyBinding: undefined, comparisonLeaseRef: { current: null }, setComparisonLease: vi.fn(), statisticsLeaseRef: { current: null }, setStatisticsLease: vi.fn(), sortLeaseRef: { current: null }, setSortLease: vi.fn(), filterLeaseRef: { current: null }, setFilterLease: vi.fn(), resultSelection: selection.resultSelection, selectionBinding: undefined, selectResultRows: vi.fn(() => false), require, exports: {}, tab, settings: { resultLimit: 10 }, busy: false, pin: null, outcome, result: outcome.results[0], resultIndex: 0,
    // 真实初始控制器及未打开的派生视图；活动行回调也从组件AST提取，不另写处理器。
    resultSorter: new QueryResultSort(), sortBinding: undefined, sortView: undefined, rowDetails: new QueryRowDetails(), setRowDetail: vi.fn(), setActiveDetailRow: vi.fn(), currentRowDetail: null, detailBinding: undefined, alive: { current: true }, connectionVersion: 0, document: { querySelector: () => null },
    // 此端口不打开列管理，普通结果的可见列随当前结果更新，不能捕获执行前的计划列。
    get visibleColumns(): unknown[] { return context.result?.columns ?? []; },
    get viewSource(): unknown { return context.result; },
    task: { current: 'original-plan-task' }, sessionId: 'original-session', sessionRef: { current: 'original-session' }, busyRef: { current: false }, cancelledQuery: { current: '' }, parameterSession: { current: '' }, explainSource: { current: 'SELECT 1' }, failureSource: { current: undefined },
    editor: { current: { getModel: () => ({ getValue: () => 'SELECT 1' }) } }, connection: { database: 'db' }, useWorkspace: { getState: () => workspace }, invoke,
    setBusy: (value: boolean) => { context.busy = value; frames.push(context.render()); }, setOutcome: (value: any) => { clearOutcome(value); context.outcome = value; context.result = value?.results[0]; },
    setSave: vi.fn(), flushSettings: vi.fn(async () => {}), rememberDatabase: vi.fn(), errorMessage: String, queryBindingZh, queryContextZh, savedQueryOriginContext, queryDatabaseFromSession, resolveQueryDatabase,
    ensureSession: vi.fn(async () => 'original-session'), prepareExecutionContext: vi.fn(async () => {}), handleQueryError: vi.fn(), uid: () => 'new-query-task',
    setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(),
    ExplainPlanView, ResultsGrid, Empty: () => null, formatText: () => '', zh: { query: {} },
  });
  const code = functions.join('\n') + '\nglobalThis.render=()=>(' + body + ');globalThis.handlers={saveQuery,runQuery};';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  // 新增的真实详情容器只增加布局层；继续核对原ResultsGrid身份及原行列引用，不替换渲染表达式。
  const child = () => {
    const content = (context.render() as ReactElement<{ children: ReactElement<any> }>).props.children;
    if (content.type !== 'div') return content;
    expect(content.props.className).toBe('query-result-with-details');
    const [grid, details] = content.props.children as [ReactElement<any>, unknown];
    expect(grid.props.className).toBe('query-result-grid'); expect(details).toBeNull();
    return grid.props.children as ReactElement;
  };
  return { selection, context, invoke, frames, clearOutcome, outcome, child, save: context.handlers.saveQuery as (action: 'create' | 'update', name: string) => Promise<void>, execute: context.handlers.runQuery as (source: string) => Promise<void> };
}

describe('非SQL忙碌期间的计划查看器身份', () => {
  it.each(['update', 'create', 'cas-rejected'] as const)('%s 保留相同组件、key和计划对象，不重建会话或投递SQL', async action => {
    const f = fixture(), original = f.child();
    expect(original.type).toBe(ExplainPlanView);
    f.invoke.mockImplementation(async command => {
      if (command === 'query.completionState') return { databaseKnown: true, database: 'db' };
      if (action === 'cas-rejected') throw Error('原查询已修改');
      return { name: '查询', source: { id: 'saved-source' } };
    });
    const running = f.save(action === 'create' ? 'create' : 'update', '查询');
    if (action === 'cas-rejected') await expect(running).rejects.toThrow('已修改'); else await running;
    expect(f.frames).toHaveLength(2);
    for (const frame of f.frames) {
      const child = (frame as ReactElement<{ children: ReactElement<{ outcome: unknown; busy: boolean }> }>).props.children;
      expect(child.type).toBe(original.type); expect(child.key).toBe(original.key); expect(child.props.outcome).toBe(f.outcome);
    }
    expect((f.frames[0] as ReactElement<{ children: ReactElement<{ busy: boolean }> }>).props.children.props.busy).toBe(true);
    expect((f.frames[1] as ReactElement<{ children: ReactElement<{ busy: boolean }> }>).props.children.props.busy).toBe(false);
    expect(f.child().type).toBe(original.type); expect(f.child().key).toBe(original.key); expect(f.context.outcome).toBe(f.outcome); expect(f.clearOutcome).not.toHaveBeenCalled();
    expect(f.context.ensureSession).not.toHaveBeenCalled(); expect(f.context.sessionRef.current).toBe('original-session'); expect(f.context.task.current).toBe('original-plan-task');
    expect(f.context.setQueryRunning).not.toHaveBeenCalled();
    expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['query.completionState', action === 'create' ? 'queries.create' : 'queries.updateSource']);
  });

  it('真实新执行先清空旧计划，结果到达后仍显示新的普通结果', async () => {
    const f = fixture(); let release!: (result: unknown) => void;
    f.invoke.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const running = f.execute('SELECT 2'); await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    expect(f.context.outcome).toBeNull(); expect(f.child().type).not.toBe(ExplainPlanView); expect(f.context.task.current).toBe('new-query-task');
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(0);
    const next = { results: [{ columns: [{ key: 'c0', name: 'value', type: 'LONG' }], rows: [{ c0: '2' }] }], elapsedMs: 2 };
    release(next); await running; expect(f.context.outcome).toBe(next); expect(f.child().type).toBe(ResultsGrid);
    expect((f.child() as ReactElement<{ rows: unknown }>).props.rows).toBe(next.results[0].rows);
    expect((f.child() as ReactElement<{ columns: unknown }>).props.columns).toBe(next.results[0].columns);
    // 抽取真实历史函数；本计划端口没有整理绑定，快捷键回调必须按原门返回，不能另发SQL或改结果。
    const callbacks = f.child() as ReactElement<{ onHistoryTravel(direction: -1 | 1): void }>, calls = f.invoke.mock.calls.length, clears = f.clearOutcome.mock.calls.length;
    callbacks.props.onHistoryTravel(-1); callbacks.props.onHistoryTravel(1);
    expect(f.context.outcome).toBe(next); expect(f.invoke).toHaveBeenCalledTimes(calls); expect(f.clearOutcome).toHaveBeenCalledTimes(clears);
    expect(f.invoke).toHaveBeenCalledWith('query.execute', expect.objectContaining({ sessionId: 'original-session', sql: 'SELECT 2', taskId: 'new-query-task' }));
  });

  it('真实计划组件繁忙时仅禁用重新读取入口，已有树和指标保持呈现', () => {
    const outcome = { explain: plan, results: [], elapsedMs: 1 }, onText = vi.fn();
    const idle = renderToStaticMarkup(<ExplainPlanView outcome={outcome} busy={false} onText={onText}/>), busy = renderToStaticMarkup(<ExplainPlanView outcome={outcome} busy={true} onText={onText}/>);
    expect(busy.replace(' disabled=""', '')).toBe(idle); expect(busy).toContain('subject'); expect(busy).toContain('role="tree"'); expect(onText).not.toHaveBeenCalled();
  });
});
