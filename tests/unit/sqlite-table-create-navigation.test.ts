import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as React from 'react';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqliteTableCreateZh } from '../../src/renderer/locales/sqliteTableCreate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';

/** 抽取生产函数和JSX事件，不另写路由或完成回调掩盖实际接线。 */
function source(path: string) { return ts.createSourceFile(path, readFileSync(new URL('../../src/renderer/' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function nodes<T extends ts.Node>(file: ts.Node, predicate: (node: ts.Node) => node is T): T[] { const found: T[] = []; const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(file); return found; }
function evaluate(code: string, values: Record<string, unknown>) { const vm = createContext({ React, ...values }); runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, vm); return vm; }

it('SchemaDialog真实saved profile把SQLite新建路由独立设计器，已有表只查看定义；网络仍原组件', () => {
  const file = source('components/SchemaDialog.tsx'), route = nodes(file, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'SchemaDialog'); expect(route).toHaveLength(1);
  let profile = { id: 'c', dialect: 'sqlite' }, held: { current: boolean } | undefined;
  const state = { connections: [profile] };
  const vm = evaluate(route[0].getText(file).replace(/^export\s+/, '') + '\nglobalThis.route=SchemaDialog;', { useWorkspace: (selector: (state: unknown) => unknown) => selector(state), useRef: (value: boolean) => held ??= { current: value }, DefinitionViewer: 'definition', SqliteTableCreateDialog: 'sqlite-create', SchemaDialogContent: 'network-create' });
  const created = vi.fn(), close = vi.fn(), dirty = vi.fn(); const props = { connectionId: 'c', database: 'main', onClose: close, onApplied: vi.fn(), onSqliteCreated: created, onDirtyChange: dirty };
  const fresh = vm.route(props); expect(fresh.type).toBe('sqlite-create'); expect(fresh.props.onCreated).toBe(created); expect(fresh.props.onDirtyChange).toBe(dirty); expect(fresh.props.connectionId).toBe('c'); expect(fresh.props.database).toBe('main');
  expect(vm.route({ ...props, table: 'existing' }).type).toBe('definition'); expect(vm.route({ ...props, initialDesign: {} }).props.unsupportedSeed).toBe(true);
  state.connections = []; expect(vm.route(props).type).toBe('sqlite-create');
  held = undefined; profile = { id: 'c', dialect: 'mysql' }; state.connections = [profile]; expect(vm.route(props).type).toBe('network-create');
});

it('App真实SQLite完成回调只认可完整COMMIT事实并刷新一次/打开SQLite表页，不改查询会话', () => {
  const file = source('App.tsx'), handlers = nodes(file, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'finishSqliteTableCreate'); expect(handlers).toHaveLength(1);
  const openTab = vi.fn(), notify = vi.fn(), refreshRenameDatabase = vi.fn(), invoke = vi.fn();
  const state = { connections: [{ id: 'c', dialect: 'sqlite' }], connectionVersions: { c: 3 }, openTab, notify };
  const vm = evaluate(handlers[0].getText(file) + '\nglobalThis.finish=finishSqliteTableCreate;', { useWorkspace: { getState: () => state }, refreshRenameDatabase, sqliteTableCreateZh, invoke });
  const target = { connectionId: 'c', database: 'main', table: '新表' }, result = { operationId: 'op', target, outcome: 'committed', fact: { operationId: 'op', target, commitAcknowledged: true }, definitionVerified: true };
  vm.finish(result, 3); expect(refreshRenameDatabase).toHaveBeenCalledExactlyOnceWith(target); expect(openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'table', title: '新表', connectionId: 'c', database: 'main', table: '新表' }); expect(invoke).not.toHaveBeenCalled();
  for (const bad of [{ ...result, outcome: 'unknown' }, { ...result, fact: { ...result.fact, commitAcknowledged: false } }, { ...result, fact: { ...result.fact, operationId: 'other' } }, { ...result, fact: { ...result.fact, target: { ...target, table: 'wrong' } } }]) vm.finish(bad, 3);
  vm.finish(result, 4); expect(refreshRenameDatabase).toHaveBeenCalledOnce(); expect(openTab).toHaveBeenCalledOnce(); expect(notify).toHaveBeenCalledWith(sqliteTableCreateZh.invalid, true);
  const schema = nodes(file, (node): node is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'SchemaDialog'); expect(schema).toHaveLength(1); expect(schema[0].attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(file) === 'onSqliteCreated' && property.initializer?.getText(file) === '{finishSqliteTableCreate}')).toBe(true);
});

it('原数据库右键新建表真实按钮开放SQLite main，错误库明确拒绝，网络原动作保持；打开菜单零IPC', () => {
  const file = source('components/Sidebar.tsx'); const buttons = nodes(file, (node): node is ts.JsxElement => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button' && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(file) === 'aria-label' && property.initializer?.getText(file) === '{zh.sidebar.text017}')); expect(buttons).toHaveLength(1);
  const onDesign = vi.fn(), invoke = vi.fn();
  for (const [sqlite, database, expected] of [[true, 'main', true], [true, 'foo', false], [false, 'foo', true]] as const) {
    const vm = evaluate('globalThis.button=' + buttons[0].getText(file), { sqlite, database, onDesign, invoke, zh, Plus: 'plus' });
    expect(vm.button.props.disabled).toBe(!expected); expect(invoke).not.toHaveBeenCalled(); const before = onDesign.mock.calls.length; vm.button.props.onClick(); expect(onDesign.mock.calls.length - before).toBe(expected ? 1 : 0);
  }
});

it('对象浏览table分类真实新建按钮沿原context门，SQLite只允许main，view分类不冒充新建已有表', () => {
  const file = source('components/ObjectBrowser.tsx'); const expressions = nodes(file, (node): node is ts.JsxExpression => ts.isJsxExpression(node) && !!node.expression && node.expression.getText(file).startsWith("category === 'table' &&")); expect(expressions).toHaveLength(1);
  const onNewTable = vi.fn(), contextCurrent = vi.fn(() => true);
  const render = (database: string, category = 'table') => evaluate('globalThis.button=' + expressions[0].expression!.getText(file), { category, profile: { dialect: 'sqlite' }, tab: { database }, busy: false, contextCurrent, onNewTable, text: navigationZh }).button;
  const main = render('main'); expect(main.props.disabled).toBe(false); main.props.onClick(); expect(onNewTable).toHaveBeenCalledOnce();
  const wrong = render('foo'); expect(wrong.props.disabled).toBe(true); wrong.props.onClick(); expect(onNewTable).toHaveBeenCalledOnce();
  contextCurrent.mockReturnValue(false); main.props.onClick(); expect(onNewTable).toHaveBeenCalledOnce(); expect(render('main', 'view')).toBe(false);
});
