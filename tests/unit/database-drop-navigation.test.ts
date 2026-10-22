import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertDatabaseDropTargetAvailable } from '../../src/renderer/databaseDropServices';
import { databaseDropZh } from '../../src/renderer/locales/databaseDrop.zh-CN';
const { request, saveSettings } = vi.hoisted(() => ({ request: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: (command: string, input: unknown) => command === 'settings.save' ? saveSettings(input) : request(command, input), uid: () => '独立测试标签', errorMessage: String }));
const target = { connectionId: 'c', database: 'db', table: 't' }, uriTarget = { connectionId: 'c', database: 'db', kind: 'table' as const, name: 't' };
let workspace: typeof import('../../src/renderer/store'), navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation')['createWorkbenchNavigation']>;
/** 执行生产App完成函数；真实导航与工作区使用RAM端口，不运行App或Electron。 */
function finish() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let method: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'finishDatabaseDrop') method = node; ts.forEachChild(node, visit); }; visit(tree);
  if (!method) throw Error('缺少实际完成方法');
  const mark = vi.fn(), refresh = vi.fn(), context = createContext({ useWorkspace: workspace.useWorkspace, workbenchNavigation: navigation, setConnectionRefreshVersions: refresh, markStructureTarget: mark, databaseDropZh, assertDatabaseDropTargetAvailable, errorMessage: String });
  runInContext(ts.transpileModule(method.getText(tree) + '\nglobalThis.finish=finishDatabaseDrop;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { call: (value: typeof target, version: number, verified: boolean, original = workspace.useWorkspace.getState().settings.tabs) => context.finish(value, version, verified, original), mark, refresh };
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); saveSettings.mockReset().mockResolvedValue(undefined);
  workspace = await import('../../src/renderer/store'); navigation = (await import('../../src/renderer/workbenchNavigation')).createWorkbenchNavigation(vi.fn());
  const state = workspace.useWorkspace.getState(); state.openTab({ id: 'old', kind: 'table', title: 't', ...target }); state.openTab({ id: 'other', kind: 'table', title: 't', ...target, database: 'other' }); state.openTab({ id: 'query', kind: 'query', title: 'query', connectionId: 'c', database: 'db', sql: '' });
});
afterEach(() => { navigation.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('删除后实际App完成路径与旧导航', () => {
  it('完整核验关闭原表标签、保留异库和查询页，并停用旧URI，即使同名对象重新出现', async () => {
    const callback = finish(); callback.call(target, 0, true);
    expect(workspace.useWorkspace.getState().settings.tabs.map(tab => tab.id)).toEqual(['other','query']);
    request.mockResolvedValue(uriTarget); await expect(navigation.open(uriTarget)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
    expect(callback.mark).toHaveBeenCalledWith(target, false); expect(callback.refresh).toHaveBeenCalledOnce();
  });
  it('删除使已有导航代次失效，迟到resolve不得复活刚关闭的表', async () => {
    let resolve!: (target: typeof uriTarget) => void; request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = navigation.open(uriTarget); finish().call(target, 0, true); resolve(uriTarget);
    expect(await pending).toBe(false); expect(workspace.useWorkspace.getState().settings.tabs.some(tab => tab.id === 'old')).toBe(false);
  });
  it('结果未知只使目标页过期并停用URI，不关闭标签、不丢弃草稿', async () => {
    finish().call(target, 0, false); expect(workspace.useWorkspace.getState().settings.tabs.some(tab => tab.id === 'old')).toBe(true);
    await expect(navigation.open(uriTarget)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('执行期间新草稿保留，不能因完整回执静默关页', async () => {
    workspace.useWorkspace.setState({ dirtyTabs: { old: true } }); finish().call(target, 0, true);
    expect(workspace.useWorkspace.getState().settings.tabs.some(tab => tab.id === 'old')).toBe(true); expect(workspace.useWorkspace.getState().dirtyTabs.old).toBe(true);
    await expect(navigation.open(uriTarget)).rejects.toThrow();
  });
  it('整库删除使各类旧URI退役，但保留其它库与其它连接', async () => {
    finish().call(target, 0, true);
    for (const kind of ['database','table','view','procedure','function','trigger','event'] as const) {
      await expect(navigation.open({ ...uriTarget, kind })).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
    request.mockImplementation(async (_: string, value: unknown) => value);
    expect(await navigation.open({ ...uriTarget, database: 'other' })).toBe(true);
    expect(await navigation.open({ ...uriTarget, connectionId: 'other' })).toBe(true);
  });
  it('执行期间新建的干净表页也不被旧完成回调关闭', () => {
    const original = [...workspace.useWorkspace.getState().settings.tabs];
    workspace.useWorkspace.getState().openTab({ id: 'new-page', kind: 'table', title: 'later', connectionId: 'c', database: 'db', table: 'later' });
    finish().call(target, 0, true, original);
    expect(workspace.useWorkspace.getState().settings.tabs.some(tab => tab.id === 'new-page')).toBe(true);
  });
  it('连接已换代时不关闭新连接同名标签或使新连接名称退役', async () => {
    workspace.useWorkspace.setState({ connectionVersions: { c: 2 } }); const callback = finish(); callback.call(target, 0, true);
    expect(workspace.useWorkspace.getState().settings.tabs.some(tab => tab.id === 'old')).toBe(true); expect(callback.mark).not.toHaveBeenCalled(); expect(callback.refresh).not.toHaveBeenCalled();
  });
});
