import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connectionSchema } from '../../src/shared/validation';
import { queryConnectionDatabase, resolveQueryDatabase } from '../../src/shared/queryContext';
import { connectionDatabase } from '../../src/renderer/sqliteWorkspace';
import { newQueryContext } from '../../src/renderer/connectionChanges';
import { UiCommandRegistry } from '../../src/renderer/uiCommandRegistry';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';

const profile: ConnectionProfile = { id: 'sqlite-unit', name: '现有文件', group: '', color: '#52c5a2', dialect: 'sqlite', sqlite: { filePath: 'C:\\合成文件.db', readOnly: true, busyTimeoutMs: 1000 } };
/** 只提取正式组件函数与控件；RAM 端口隔离 React 调度和 IPC，不复制产品处理器。 */
function source(name: string) { return ts.createSourceFile(name, readFileSync(new URL('../../src/renderer/' + name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
const query = source('components/QueryTab.tsx'), app = source('App.tsx');
function method(file: ts.SourceFile, name: string): string {
  let found = ''; const inspect = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file); ts.forEachChild(node, inspect); }; inspect(file); if (!found) throw Error('未找到正式入口：' + name); return found;
}
function publish(code: string, ports: Record<string, unknown>, names: string[]) {
  const context: any = createContext(ports);
  runInContext(ts.transpileModule(code + '\nglobalThis.handlers={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context;
}
function sessionFixture(database?: string, context?: { state: 'known'; database: string | null } | { state: 'unknown' }) {
  const tab = { id: 'query', kind: 'query', connectionId: profile.id, database, databaseContext: context, sql: "SELECT '保留原正文';" };
  const workspace = { settings: { tabs: [tab] }, connections: [profile], activeJobs: {}, dirtyTabs: {} as Record<string, boolean>, closeTab: vi.fn(), notify: vi.fn(), setDirty: vi.fn((id: string, value: boolean) => { workspace.dirtyTabs[id] = value; }) };
  const invoke = vi.fn(async (command: string, input: any) => {
    if (command === 'connections.open') return { dialect: 'sqlite', version: '合成版本' };
    if (command === 'sessions.open') { if (input.database !== null && input.database !== 'main') throw Error('SQLite原工作区目前只支持main数据库'); return { sessionId: 'original-session' }; }
    throw Error('意外 IPC：' + command);
  });
  const ports = { sqlite: true, connection: profile, tab, useWorkspace: { getState: () => workspace }, sessionRef: { current: '' }, pendingSession: { current: null }, busyRef: { current: false }, connectionDatabase, resolveQueryDatabase, queryConnectionDatabase, queryContextZh, queryBindingZh, sqliteZh, setRecoveryDatabase: vi.fn(), setRecovery: vi.fn(), setSessionId: vi.fn(), invoke, Error };
  const vm = publish(method(query, 'ensureSession') + '\n' + method(query, 'saveQuery'), ports, ['ensureSession', 'saveQuery']);
  return { tab, workspace, invoke, vm };
}

describe('SQLite 原查询入口的真实目标与未知事务保护', () => {
  it('锁等待表单上限与实际 IPC 合同同为 5000 毫秒', () => {
    const dialog = source('components/ConnectionDialog.tsx'); let maximum = '';
    const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(dialog) === 'input' && node.getText(dialog).includes('value={form.sqlite.busyTimeoutMs}')) maximum = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(dialog) === 'max')?.getText(dialog) ?? ''; ts.forEachChild(node, visit); }; visit(dialog);
    expect(maximum).toBe('max="5000"'); expect(connectionSchema.safeParse({ ...profile, sqlite: { ...profile.sqlite, busyTimeoutMs: 5000 } }).success).toBe(true); expect(connectionSchema.safeParse({ ...profile, sqlite: { ...profile.sqlite, busyTimeoutMs: 5001 } }).success).toBe(false);
  });
  it('历史或保存查询明确指定其他库时保留原库交给真实运行时拒绝，不改为 main 或发送 SQL', async () => {
    const f = sessionFixture('原库foo', { state: 'known', database: '原库foo' }), original = structuredClone(f.tab);
    await expect(f.vm.handlers.ensureSession()).rejects.toThrow('只支持main');
    expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['connections.open', 'sessions.open']); expect(f.invoke.mock.calls[1][1].database).toBe('原库foo'); expect(f.tab).toEqual(original);
    f.invoke.mockClear(); await expect(f.vm.handlers.saveQuery('create', '原查询')).rejects.toThrow(sqliteZh.mainOnly); expect(f.invoke).not.toHaveBeenCalled(); expect(f.tab).toEqual(original);
  });
  it('未知上下文必须先明确恢复，确认前不建立任何物理会话', async () => {
    const f = sessionFixture(undefined, { state: 'unknown' }); await expect(f.vm.handlers.ensureSession()).rejects.toThrow('默认库待确认'); expect(f.vm.setRecovery).toHaveBeenCalledWith(true); expect(f.invoke).not.toHaveBeenCalled(); expect(f.tab.databaseContext).toEqual({ state: 'unknown' });
    const main = sessionFixture('main', { state: 'known', database: 'main' }); await expect(main.vm.handlers.ensureSession()).resolves.toBe('original-session'); expect(main.invoke.mock.calls[1][1].database).toBe('main');
  });
  it('SQLite broken 保留原会话、未知事务和关闭确认，不能自动清除或重连', async () => {
    const f = sessionFixture('main', { state: 'known', database: 'main' }); f.vm.sessionRef.current = 'original-session';
    const state = { broken: true, transactionOpen: false, transactionKnown: false };
    f.invoke.mockImplementation(async (command: string) => { if (command !== 'query.sessionState') throw Error('禁止自动清理或重连'); return state as any; });
    const setTransaction = vi.fn(), setTransactionKnown = vi.fn(), setError = vi.fn(), confirm = vi.fn(() => false);
    Object.assign(f.vm, { errorMessage: (reason: Error) => reason.message, rememberDatabase: vi.fn(), setTransaction, setTransactionKnown, setError, formatText, zh, window: { confirm } });
    runInContext(ts.transpileModule(method(query, 'handleQueryError') + '\nglobalThis.fail=handleQueryError;\n' + method(app, 'closeTab') + '\nglobalThis.close=closeTab;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.vm);
    await f.vm.fail(Error('原SQLite进程退出'));
    expect(f.vm.sessionRef.current).toBe('original-session'); expect(f.vm.setSessionId).not.toHaveBeenCalled(); expect(setTransaction).not.toHaveBeenCalledWith(false); expect(setTransactionKnown).toHaveBeenCalledExactlyOnceWith(false); expect(f.workspace.setDirty).toHaveBeenCalledExactlyOnceWith('query', true); expect(setError).toHaveBeenCalledWith(sqliteZh.brokenTransaction + '原SQLite进程退出');
    await expect(f.vm.handlers.ensureSession()).resolves.toBe('original-session'); expect(f.invoke).toHaveBeenCalledTimes(1); expect(f.vm.close('query')).toBe(false); expect(confirm).toHaveBeenCalledExactlyOnceWith(zh.app.text002); expect(f.workspace.closeTab).not.toHaveBeenCalled();
  });
});

describe('SQLite 新查询和声明快捷键的正式组件接线', () => {
  it.each(['sqlite', 'mysql'] as const)('新查询 %s 只固定 SQLite main，网络库名和原 SQL 草稿保持原行为', dialect => {
    const connection = dialect === 'sqlite' ? profile : { id: profile.id, name: '网络', dialect, database: '网络默认库' };
    const state = { connections: [connection], selection: { connectionId: profile.id, database: '原库foo' }, settings: { tabs: [], activeTabId: '' }, openTab: vi.fn() };
    const hook = Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state });
    const vm = publish(method(app, 'NewQueryDialog'), { exports: {}, require: () => jsxRuntime, useWorkspace: hook, useState: (value: unknown) => [value, vi.fn()], useEffect: vi.fn(), newQueryContext, completionServerFacts: {}, invoke: vi.fn(), errorMessage: String, zh, Modal: 'modal', Field: 'field', ErrorBox: 'error', ArrowRight: 'arrow' }, ['NewQueryDialog']);
    const view = vm.handlers.NewQueryDialog({ onClose: vi.fn() }); const nodes: any[] = []; const visit = (value: any) => { if (Array.isArray(value)) return value.forEach(visit); if (!value?.props) return; nodes.push(value); visit(value.props.children); }; visit(view);
    const input = nodes.find(value => value.type === 'input' && value.props.list === 'query-databases'); expect(input.props.readOnly).toBe(dialect === 'sqlite'); expect(input.props.value).toBe(dialect === 'sqlite' ? 'main' : '原库foo');
    nodes.find(value => value.type === 'form').props.onSubmit({ preventDefault() {} });
    expect(state.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'query', title: zh.common.unnamedQuery, connectionId: profile.id, database: dialect === 'sqlite' ? 'main' : '原库foo', ...(dialect === 'sqlite' ? { databaseContext: { state: 'known', database: 'main' } } : {}), sql: '' });
  });
  it.each([[false, false, 0], [true, true, 0], [true, false, 1]] as const)('结构搜索快捷键复用声明命令，可用=%s，模态=%s', async (enabled, modal, calls) => {
    let statement = ''; const visit = (node: ts.Node) => { if (ts.isIfStatement(node) && node.expression.getText(app).includes("event.key.toLowerCase()==='f'")) statement = node.getText(app); ts.forEachChild(node, visit); }; visit(app); expect(statement).not.toBe('');
    const registry = new UiCommandRegistry(), run = vi.fn(); registry.update('app', {}, { active: true, contextKey: '网络或SQLite真实可用状态', handlers: { 'structure-search': { enabled, run } } }); registry.setBlocked(false);
    const vm = publish('function shortcut(event){' + statement + '}', { uiCommands: registry, document: { querySelector: () => modal ? {} : null }, useWorkspace: { getState: () => ({ notify: vi.fn() }) }, errorMessage: String }, ['shortcut']);
    vm.handlers.shortcut({ shiftKey: true, key: 'F', preventDefault: vi.fn() }); await Promise.resolve(); expect(run).toHaveBeenCalledTimes(calls);
  });
});
