import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import { exportableQueryResult } from '../../src/renderer/resultExport';

const file = ts.createSourceFile('QueryTab.tsx', readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), declarations = new Map<string, string>(); let resultBody = '', snapshot = '', more = '';
/** 只抽取实际结果准入和渲染表达式，不能在测试里另写一份计划优先级。 */
function inspect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ['sourceResult', 'sourceExportable', 'viewSource'].includes(node.name.getText(file))) declarations.set(node.name.getText(file), node.initializer!.getText(file));
  if (ts.isBinaryExpression(node) && node.left.getText(file) === 'snapshotView.current') snapshot = node.right.getText(file);
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'className' && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'result-body')) resultBody = node.getText(file);
  if (ts.isJsxAttribute(node) && node.name.getText(file) === 'more' && node.initializer && ts.isJsxExpression(node.initializer)) more = node.initializer.expression!.getText(file);
  ts.forEachChild(node, inspect);
} inspect(file);
const result: QueryResult = { columns: [{ key: 'id', name: 'id', type: 'SQLITE' }], rows: [{ id: '1' }], truncated: false, elapsedMs: 0, statement: 'EXPLAIN QUERY PLAN SELECT 1' };
const outcome = (): QueryOutcome => ({ results: [result], elapsedMs: 1, sqliteExplain: { dialect: 'sqlite', version: '3.合成', initialView: 'tree', nodes: [], raw: '原文', rawTruncated: false, warnings: [] } });
describe('QueryTab 的 SQLite 计划来源和专属渲染', () => {
  it('原sourceResult/导出/选择派生源/结果快照均不接纳SQLite计划，明确固定的数据结果仍保留', () => {
    expect(declarations.size).toBe(3); expect(snapshot).not.toBe('');
    for (const pinned of [false, true]) {
      const vm: any = createContext({ outcome: outcome(), pin: pinned ? { result } : undefined, results: [result], resultIndex: 0, busy: false, queryRunning: false, pins: [], exportableQueryResult });
      runInContext([...declarations].map(([name, value]) => 'globalThis.' + name + '=' + value).join(';') + ';globalThis.snapshot=' + snapshot, vm);
      expect(vm.sourceResult).toBe(pinned ? result : undefined); expect(vm.sourceExportable).toBe(pinned ? result : undefined); expect(vm.viewSource).toBe(pinned ? result : undefined); expect(vm.snapshot.result).toBe(pinned ? result : undefined);
    }
  });
  it('普通结果及MySQL既有导出来源不因SQLite接线改变', () => {
    const ordinary = { results: [result], elapsedMs: 1 }, vm: any = createContext({ outcome: ordinary, pin: undefined, results: ordinary.results, resultIndex: 0, busy: false, queryRunning: false, exportableQueryResult }); runInContext([...declarations].map(([name, value]) => 'globalThis.' + name + '=' + value).join(';'), vm); expect(vm.sourceResult).toBe(result); expect(vm.sourceExportable).toBe(result); expect(vm.viewSource).toBe(result);
  });
  it('sqliteExplain优先专属视图，不传MySQL快照/文本fallback动作，沿原busy与菜单来源门', () => {
    expect(resultBody).not.toBe(''); const current = () => true, value = outcome(), vm: any = createContext({ require: () => jsx, exports: {}, pin: undefined, outcome: value, task: { current: 'plan-task' }, busy: false, queryMenuCurrent: current, SqliteExplainPlanView: 'sqlite-plan', ExplainPlanView: 'mysql-plan', QueryAnalyzeView: 'analysis' });
    runInContext(ts.transpileModule('globalThis.render=()=>(' + resultBody + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, vm);
    const element = vm.render().props.children; expect(element.type).toBe('sqlite-plan'); expect(element.props.outcome).toBe(value); expect(element.props.isCurrent).toBe(current); expect(Object.hasOwn(element.props, 'fileActions')).toBe(false); expect(Object.hasOwn(element.props, 'onText')).toBe(false);
  });
  it('查询更多实际执行计划button在SQLite分支外，参数/事务设置/分析仍各自保方言门', () => {
    expect(more).not.toBe(''); let plan = 0; function check(node: ts.Node) { if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button' && node.getText(file).includes("execute('explain')")) { plan++; const props = node.openingElement.attributes.properties.filter(ts.isJsxAttribute); expect(props.find(attr => attr.name.getText(file) === 'disabled')?.initializer?.getText(file)).toBe('{busy || !connection || !!closeRequest || fileSource.busy}'); let parent: ts.Node | undefined = node.parent; while (parent && parent.getText(file) !== more) { if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) expect(parent.left.getText(file)).not.toBe('!sqlite'); parent = parent.parent; } } ts.forEachChild(node, check); } check(file); expect(plan).toBe(1);
  });
});
