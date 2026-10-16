import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkbench, objectUri, parseObjectUri } from '../../src/shared/workbench';
import { reconcileTableRenameFavorites, tableRenameTabMatches } from '../../src/renderer/tableRenameReconcile';
import { tableRenameZh } from '../../src/renderer/locales/tableRename.zh-CN';
import { tableRenameFailureResults } from '../helpers/tableRenameResults';
import { assertTableRenameTargetAvailable } from '../../src/renderer/tableRenameServices';
const { request, saveSettings } = vi.hoisted(() => ({ request: vi.fn(), saveSettings: vi.fn() }));
// 标签身份即时保存使用独立异步端口，原导航请求的顺序和拒绝断言保持。
vi.mock('../../src/renderer/lib', () => ({ invoke: (command: string, input: unknown) => command === 'settings.save' ? saveSettings(input) : request(command, input), uid: () => '独立标签', errorMessage: String }));
const a = { connectionId: 'c', database: 'db', table: 'a' }, b = { ...a, table: 'b' }, target = { connectionId: 'c', database: 'db', kind: 'table' as const, name: 'a' };
let navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation>, workspace: typeof import('../../src/renderer/store');

/** 提取实际App完成方法，只替换组件state setter/通知边界，导航与工作区/收藏迁移均为真实模块。 */
function finishCallback() {
  const text = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let method: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'finishTableRename') method = node; ts.forEachChild(node, visit); }; visit(tree);
  if (!method) throw new Error('找不到实际App完成方法');
  const document = emptyWorkbench(); document.favorites = [{ id: 'f', groupId: null, label: 'a', target }];
  const book = { ready: true, busy: false, snapshot: { document }, save: vi.fn(async value => { book.snapshot.document = value; return true; }) };
  const context = createContext({ useWorkspace: workspace.useWorkspace, workbenchNavigation: navigation, refreshRenameDatabase: vi.fn(), markStructureTarget: vi.fn(), tableRenameZh, tableRenameTabMatches, assertTableRenameTargetAvailable, errorMessage: String, setRenameTarget: vi.fn(), setRenameEdits: vi.fn(), useWorkbench: { getState: () => book }, reconcileTableRenameFavorites });
  runInContext(ts.transpileModule(method.getText(tree) + '\nglobalThis.finish=finishTableRename;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { call: context.finish as (result: unknown, version: number) => Promise<void>, book, context };
}
/** 同样提取正式TableRenameDialog的结果未知回调，不能把手动retire代替真实App接线。 */
function uncertainCallback(renameTarget = a, renameVersion = 0) {
  const text = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'TableRenameDialog') {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === 'onExecutionUncertain');
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }; visit(tree); if (!expression) throw new Error('找不到实际未知回调');
  const context = createContext({ renameTarget, renameVersion, useWorkspace: workspace.useWorkspace, workbenchNavigation: navigation, refreshRenameDatabase: vi.fn(), markStructureTarget: vi.fn() });
  runInContext(ts.transpileModule('globalThis.uncertain=' + expression.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.uncertain as (message: string, newName: string) => void;
}
beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); saveSettings.mockReset().mockResolvedValue(undefined); workspace = await import('../../src/renderer/store'); navigation = (await import('../../src/renderer/workbenchNavigation')).createWorkbenchNavigation(vi.fn()); });
afterEach(() => { navigation.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const completed = (from = a, to = b, identity = 'a'.repeat(64)) => ({ target: from, newTarget: to, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { physicalIdentity: identity, tableId: '7', ddlHash: 'x' }, warnings: [] });

describe('员工2实际App完成回调的严格导航边界', () => {
  it('正对照：实际App完整回执a到b到a，同物理表的新收藏及URI可打开', async () => {
    const fixture = finishCallback(); await fixture.call(completed(), 0); await fixture.call(completed(b, a), 0);
    expect(fixture.book.snapshot.document.favorites[0].target).toMatchObject({ name: 'a' });
    const savedBeforeOpen = saveSettings.mock.calls.length, uri = parseObjectUri(objectUri(target)); request.mockResolvedValueOnce(uri); expect(await navigation.open(uri)).toBe(true);
    // 重命名完成已打开a；新URI复用现页，不重复投递标签身份，原即时保存仍为a。
    expect(saveSettings).toHaveBeenCalledTimes(savedBeforeOpen); expect(saveSettings.mock.calls.at(-1)![0].tabs).toMatchObject([{ connectionId: 'c', database: 'db', table: 'a' }]);
  });
  it.each(['read-failure', 'physical-change'])('严格反例：实际Engine的%s完成结果进入App后，旧URI不能指向新建同名另一表', async kind => {
    const fixture = finishCallback(), result = structuredClone(tableRenameFailureResults[kind as keyof typeof tableRenameFailureResults]), original = structuredClone(result);
    await fixture.call(result, 0); expect(result.ddlCompleted).toBe(true); expect(result.definitionVerified).toBe(false);
    expect(result).toEqual(original); expect(fixture.book.save).not.toHaveBeenCalled(); expect(fixture.context.setRenameTarget).not.toHaveBeenCalled(); expect(fixture.context.setRenameEdits).not.toHaveBeenCalled();
    const old = { connectionId: result.target.connectionId, database: result.target.database, kind: 'table' as const, name: result.target.table };
    // 外部已在来源名称建立另一物理表；真实主进程v1名称解析可以返回同名目标。
    request.mockResolvedValueOnce(old);
    await expect(navigation.open(parseObjectUri(objectUri(old)))).rejects.toThrow('旧对象链接');
    const destination = { ...old, name: result.newTarget.table };
    await expect(navigation.open(parseObjectUri(objectUri(destination)))).rejects.toThrow('旧对象链接');
    expect(request).not.toHaveBeenCalled();
  });
  it('正对照：实际App观察到不同物理表复用a后，旧URI仍拒绝', async () => {
    const fixture = finishCallback(); await fixture.call(completed(), 0); await fixture.call(completed({ ...a, table: 'c' }, a, 'b'.repeat(64)), 0);
    await expect(navigation.open(target)).rejects.toThrow('旧对象链接'); expect(request).not.toHaveBeenCalled();
  });
  it('严格反例：真实App结果未知回调也必须保守停用旧URI，而不只是刷新目录和撤销旧请求', async () => {
    uncertainCallback()('DDL已发送，结果未知', b.table); request.mockResolvedValueOnce(target);
    await expect(navigation.open(target)).rejects.toThrow('旧对象链接');
    await expect(navigation.open({ ...target, name: b.table })).rejects.toThrow('旧对象链接'); expect(request).not.toHaveBeenCalled();
    expect(workspace.useWorkspace.getState().notice).toEqual({ text: 'DDL已发送，结果未知', error: true });
  });
  it('正对照：完成前已发出的旧导航即使迟到也不写回工作区', async () => {
    let deliver!: (value: unknown) => void; request.mockReturnValueOnce(new Promise(resolve => { deliver = resolve; })); const old = navigation.open(target);
    await finishCallback().call(completed(), 0); const current = workspace.useWorkspace.getState().settings; deliver(target); expect(await old).toBe(false); expect(workspace.useWorkspace.getState().settings).toBe(current);
  });
  it('未知结果撤销在途请求，之后收到同身份或不同身份完整回执都不能抹除未知历史', async () => {
    let deliver!: (value: unknown) => void; request.mockReturnValueOnce(new Promise(resolve => { deliver = resolve; }));
    const pending = navigation.open(target), settings = workspace.useWorkspace.getState().settings;
    uncertainCallback()('可能已执行，未核验', b.table); deliver(target); expect(await pending).toBe(false); expect(workspace.useWorkspace.getState().settings).toBe(settings);
    const fixture = finishCallback(); await fixture.call(completed(b, a), 0);
    await expect(navigation.open(target)).rejects.toThrow('旧对象链接');
    await fixture.call(completed({ ...a, table: 'c' }, a, 'b'.repeat(64)), 0);
    await expect(navigation.open(target)).rejects.toThrow('旧对象链接');
  });
  it.each(['finish', 'uncertain'])('连接版本已变化时%s不能退役新配置的同名对象', async stage => {
    workspace.useWorkspace.setState({ connectionVersions: { c: 1 } });
    if (stage === 'finish') await finishCallback().call({ ...completed(), definitionVerified: false }, 0);
    else uncertainCallback(a, 0)('原服务器结果未知', b.table);
    request.mockResolvedValueOnce(target); expect(await navigation.open(target)).toBe(true);
  });
  it('未发送DDL的防御回执不退役名称，未知事件也不误伤其他连接或数据库', async () => {
    const fixture = finishCallback(); await fixture.call({ ...completed(), ddlSubmitted: false, ddlCompleted: false, definitionVerified: false }, 0);
    expect(workspace.useWorkspace.getState().notice?.text).toBe(tableRenameZh.notSent);
    request.mockResolvedValueOnce(target); expect(await navigation.open(target)).toBe(true);
    uncertainCallback()('DDL可能已执行', b.table);
    for (const other of [{ ...target, connectionId: 'other' }, { ...target, database: 'other' }]) { request.mockResolvedValueOnce(other); expect(await navigation.open(other)).toBe(true); }
  });
});
