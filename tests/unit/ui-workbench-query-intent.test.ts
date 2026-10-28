import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchTarget } from '../../src/shared/workbench';

const { request, saveSettings } = vi.hoisted(() => ({ request: vi.fn(), saveSettings: vi.fn() }));
// 新标签的本地保存不能消耗待交付的导航响应；其它命令仍由原导航spy核对。
vi.mock('../../src/renderer/lib', () => ({ invoke: (command: string, input: unknown) => command === 'settings.save' ? saveSettings(input) : request(command, input), uid: () => '本次新标签', errorMessage: (error: unknown) => String(error) }));
const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App')!;
type Entry = '工具栏' | '标签加号' | '欢迎页' | '快捷键' | '原生菜单';
const entries: Entry[] = ['工具栏', '标签加号', '欢迎页', '快捷键', '原生菜单'];
const target = { connectionId: '旧连接', database: '旧库', kind: 'table', name: '旧表' } as const;

/** 只控制真实resolve的完成次序，不在测试里复制导航代次或工作区写入逻辑。 */
function pending() {
  let resolve!: (value: WorkbenchTarget) => void, reject!: (error: Error) => void;
  const promise = new Promise<WorkbenchTarget>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** 从正式App提取所有查询入口的真实回调及其辅助函数，避免只测试另写的组件保护。 */
function appHandlers(navigation: unknown, workspace: typeof import('../../src/renderer/store')) {
  const found = new Map<string, string>(), helpers: string[] = [];
  function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
    const value = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === name);
    return value && ts.isJsxAttribute(value) && value.initializer && ts.isJsxExpression(value.initializer) ? value.initializer.expression?.getText(file) : undefined;
  }
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^(openWorkbenchManager|closeWorkbenchManager|openObjectLink|closeObjectLink|openNewQueryDialog|closeNewQueryDialog|openQueryTabEntry)$/.test(node.name.text)) helpers.push(node.getText(file));
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button') {
      if (node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(file) === 'zh.common.newQuery')) found.set('工具栏', attribute(node.openingElement, 'onClick')!);
      if (node.openingElement.attributes.properties.some(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'className' && item.initializer && ts.isStringLiteral(item.initializer) && item.initializer.text === 'add-tab')) found.set('标签加号', attribute(node.openingElement, 'onClick')!);
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'Welcome') found.set('欢迎页', attribute(node, 'onQuery')!);
    // 标签按钮已提取到真实条带组件；沿App传入的onNew读取同一生产回调，保留全部五入口断言。
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'WorkspaceTabStrip') found.set('标签加号', attribute(node, 'onNew')!);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'NewQueryDialog') found.set('关闭查询', attribute(node, 'onClose')!);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'listener' && node.initializer?.getText(file).includes("event.key.toLowerCase() === 't'")) found.set('快捷键', node.initializer.getText(file));
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'onMenu') found.set('原生菜单', node.arguments[0].getText(file));
    ts.forEachChild(node, visit);
  }
  visit(app); expect([...found.keys()].sort()).toEqual([...entries, '关闭查询'].sort());
  const shown = { query: false, modal: false }, connection = vi.fn();
  const context = createContext({ workbenchNavigation: navigation, useWorkspace: workspace.useWorkspace, connections: [{ id: '当前连接' }],
    setNewQuery: (value: boolean) => { shown.query = value; }, setConnectionDialog: connection,
    document: { querySelector: () => shown.modal ? {} : null }, setWorkbenchDialog: vi.fn(), setObjectLinkDialog: vi.fn() });
  const code = helpers.join('\n') + '\nglobalThis.handlers={' + [...found].map(([name, callback]) => JSON.stringify(name) + ':(' + callback + ')').join(',') + '};';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { shown, context, connection, close: context.handlers['关闭查询'] as () => void,
    open(entry: Entry) {
      const event = { ctrlKey: true, metaKey: false, shiftKey: false, key: 't', isComposing: false, keyCode: 84, preventDefault: vi.fn() };
      context.handlers[entry](entry === '原生菜单' ? 'new-query' : event);
    }
  };
}

describe('正式App新查询入口撤销W02迟到意图', () => {
  let workspace: typeof import('../../src/renderer/store');
  let navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation>;
  let handlers: ReturnType<typeof appHandlers>;
  const definition = vi.fn();
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); saveSettings.mockReset().mockResolvedValue(undefined); definition.mockReset();
    workspace = await import('../../src/renderer/store');
    workspace.useWorkspace.setState({ connectionVersions: { '当前连接': 7, '旧连接': 3 } });
    workspace.useWorkspace.getState().select({ connectionId: '当前连接', database: '当前库' });
    navigation = (await import('../../src/renderer/workbenchNavigation')).createWorkbenchNavigation(definition);
    handlers = appHandlers(navigation, workspace);
  });
  afterEach(() => { navigation.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(entries)('%s打开查询表单后，迟到表页不能改连接或标签', async entry => {
    const old = pending(); request.mockReturnValueOnce(old.promise); const opening = navigation.open(target);
    const before = workspace.useWorkspace.getState().settings, revisions = workspace.useWorkspace.getState().connectionVersions; handlers.open(entry); expect(handlers.shown.query).toBe(true);
    old.resolve(target); expect(await opening).toBe(false);
    expect(workspace.useWorkspace.getState().settings).toBe(before); expect(workspace.useWorkspace.getState().selection).toEqual({ connectionId: '当前连接', database: '当前库' });
    expect(handlers.shown.query).toBe(true); expect(definition).not.toHaveBeenCalled();
    expect(workspace.useWorkspace.getState().connectionVersions).toBe(revisions);
    expect(saveSettings).not.toHaveBeenCalled();
  });
  it.each(entries)('%s打开查询表单后，迟到定义不能再叠加定义模态', async entry => {
    const old = pending(); request.mockReturnValueOnce(old.promise); const definitionTarget = { ...target, kind: 'procedure' as const };
    const opening = navigation.open(definitionTarget); handlers.open(entry); old.resolve(definitionTarget);
    expect(await opening).toBe(false); expect(definition).not.toHaveBeenCalled(); expect(handlers.shown.query).toBe(true);
  });
  it.each(entries)('%s接管后，旧连接修订错误不覆盖新意图', async entry => {
    const old = pending(); request.mockReturnValueOnce(old.promise);
    const opening = navigation.open(target).catch(reason => { workspace.useWorkspace.getState().notify(String(reason), true); return false; });
    handlers.open(entry); old.reject(Error('连接配置已变化，请重新打开对象'));
    expect(await opening).toBe(false); expect(workspace.useWorkspace.getState().notice).toBeUndefined(); expect(handlers.shown.query).toBe(true);
  });
  it('取消查询同步废弃旧导航，之后显式最新导航仍可正常落地', async () => {
    handlers.open('工具栏'); const old = pending(), latest = pending(); request.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const opening = navigation.open(target); handlers.close(); expect(handlers.shown.query).toBe(false);
    old.resolve(target); expect(await opening).toBe(false);
    const current = { connectionId: '最新连接', database: '新库', kind: 'database' as const };
    const next = navigation.open(current); latest.resolve(current); expect(await next).toBe(true);
    expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ kind: 'query', connectionId: '最新连接', database: '新库', sql: '' }]);
    expect(saveSettings).toHaveBeenCalledOnce(); expect(saveSettings.mock.calls[0][0].tabs).toMatchObject([{ kind: 'query', connectionId: '最新连接' }]);
  });
  it('无连接的标签加号转入建连表单前也撤销旧导航', async () => {
    const old = pending(); request.mockReturnValueOnce(old.promise); const opening = navigation.open(target); handlers.context.connections = [];
    handlers.open('标签加号'); expect(handlers.connection).toHaveBeenCalledWith('new'); expect(handlers.shown.query).toBe(false);
    old.resolve(target); expect(await opening).toBe(false); expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
  });
  it.each(['快捷键', '原生菜单'] as Entry[])('%s被已有模态阻止时不冒领导航意图', async entry => {
    const old = pending(); request.mockReturnValueOnce(old.promise); const opening = navigation.open(target); handlers.shown.modal = true;
    handlers.open(entry); expect(handlers.shown.query).toBe(false); old.resolve(target); expect(await opening).toBe(true);
  });
  it('仍属最新导航的连接修订错误继续交回入口，不被查询表单修复吞掉', async () => {
    const latest = pending(); request.mockReturnValueOnce(latest.promise); const opening = navigation.open(target);
    latest.reject(Error('连接配置已变化，请重新打开对象'));
    await expect(opening).rejects.toThrow('连接配置已变化'); expect(definition).not.toHaveBeenCalled();
    expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
  });
});
