import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTableAutoIncrementTargetAvailable } from '../../src/renderer/tableAutoIncrementServices';
import { tableAutoIncrementZh } from '../../src/renderer/locales/tableAutoIncrement.zh-CN';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: request, uid: () => '自增混合测试标签', errorMessage: String }));
const target = { connectionId: 'c', database: 'db', table: 't' }, destination = { ...target, table: 'renamed' };
const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let workspace: typeof import('../../src/renderer/store');
let navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation>;

/** 仅替换组件setter和DOM存在性；执行混合App的真实入口、JSX回调及工作区保护。 */
function app(hasDialog = false) {
  let open: ts.FunctionDeclaration | undefined;
  const expressions = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openTableAutoIncrement') open = node;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(tree);
      for (const item of node.attributes.properties) if (ts.isJsxAttribute(item) && item.initializer && ts.isJsxExpression(item.initializer) && item.initializer.expression) {
        const name = item.name.getText(tree);
        if ((['Sidebar', 'TableTab'].includes(tag) && name === 'onTableAutoIncrement') || (tag === 'TableAutoIncrementDialog' && ['beforeApply', 'onApplied', 'onExecutionUncertain'].includes(name)) || (tag === 'TableRenameDialog' && name === 'onExecutionUncertain')) expressions.set(tag + '_' + name, item.initializer.expression.getText(tree));
      }
    }
    ts.forEachChild(node, visit);
  }; visit(tree); if (!open || expressions.size !== 6) throw Error('混合App缺少唯一自增/重命名真实接线');
  const setTarget = vi.fn(), setVersion = vi.fn(), setEdits = vi.fn(), mark = vi.fn(), invalidate = vi.spyOn(navigation, 'invalidate');
  const context = createContext({ document: { querySelector: () => hasDialog ? {} : null }, structuredClone, useWorkspace: workspace.useWorkspace, workbenchNavigation: navigation, assertTableAutoIncrementTargetAvailable, errorMessage: String, tableAutoIncrementZh, setCounterTarget: setTarget, setCounterVersion: setVersion, setCounterEdits: setEdits, counterTarget: target, counterVersion: 0, renameTarget: target, renameVersion: 0, markStructureTarget: mark, refreshRenameDatabase: vi.fn(), tab: { ...target, id: 'visible', kind: 'table' } });
  runInContext(ts.transpileModule(open.getText(tree) + '\n' + [...expressions].map(([name, value]) => `globalThis.${name}=${value};`).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, setTarget, setVersion, setEdits, mark, invalidate, invoke(entry: 'Sidebar' | 'TableTab') { if (entry === 'Sidebar') context.Sidebar_onTableAutoIncrement(target.connectionId, target.database, target.table); else context.TableTab_onTableAutoIncrement(); } };
}

/** 活动页干净但同目标隐藏页持有数据、布局或任务；保留真实store字段与精确目标大小写。 */
function hidden(field?: 'dirtyTabs' | 'tableLayoutDrafts' | 'activeJobs', table = target.table) {
  const current = workspace.useWorkspace.getState();
  workspace.useWorkspace.setState({ settings: { ...current.settings, activeTabId: 'visible', tabs: [{ ...target, id: 'visible', kind: 'table', title: 't' }, { ...target, table, id: 'hidden', kind: 'table', title: table }] }, dirtyTabs: {}, tableLayoutDrafts: {}, activeJobs: {}, ...(field ? { [field]: { hidden: true } } : {}) });
}
beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); workspace = await import('../../src/renderer/store'); navigation = (await import('../../src/renderer/workbenchNavigation')).createWorkbenchNavigation(vi.fn()); hidden(); });
afterEach(() => { navigation.dispose(); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('自增与当前ROOT表属性、隐藏草稿及未知名称的混合负向保护', () => {
  it.each((['Sidebar', 'TableTab'] as const).flatMap(entry => (['dirtyTabs', 'tableLayoutDrafts', 'activeJobs'] as const).map(field => [entry, field] as const)))('%s真实入口不能绕过隐藏页%s', (entry, field) => {
    hidden(field); const f = app(); f.invoke(entry);
    expect(f.setTarget).not.toHaveBeenCalled(); expect(f.setVersion).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    expect(workspace.useWorkspace.getState().notice?.error).toBe(true);
  });
  it.each(['Sidebar', 'TableTab'] as const)('%s干净目标允许打开，大小写不同的隐藏脏表不误伤', entry => {
    hidden('dirtyTabs', 'T'); const f = app(); f.invoke(entry);
    expect(f.setTarget).toHaveBeenCalledExactlyOnceWith(target); expect(f.setVersion).toHaveBeenCalledExactlyOnceWith(0); expect(f.setEdits).toHaveBeenCalledWith(false); expect(f.invalidate).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
  });
  it('已有重命名或其它模态时两个自增入口都不能覆盖表单', () => {
    const f = app(true); f.invoke('Sidebar'); f.invoke('TableTab'); expect(f.setTarget).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it.each(['dirtyTabs', 'tableLayoutDrafts', 'activeJobs'] as const)('预览后%s才变忙/变脏，实际beforeApply必须重新拒绝', field => {
    const f = app(); f.invoke('Sidebar'); expect(f.setTarget).toHaveBeenCalledOnce(); hidden(field);
    expect(() => f.context.TableAutoIncrementDialog_beforeApply()).toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it.each([false, true])('自增核验结果%s或未知回调不能恢复重命名两端未知URI', async definitionVerified => {
    const f = app(); f.context.TableRenameDialog_onExecutionUncertain('重命名执行结果未知', destination.table);
    f.context.TableAutoIncrementDialog_onExecutionUncertain('自增执行结果未知'); f.context.TableAutoIncrementDialog_onApplied({ definitionVerified });
    for (const name of [target.table, destination.table]) await expect(navigation.open({ connectionId: target.connectionId, database: target.database, kind: 'table', name })).rejects.toThrow('旧对象链接');
    expect(request).not.toHaveBeenCalled(); expect(f.mark).toHaveBeenCalledWith(target, definitionVerified);
  });
  it('连接版本变化后迟到自增成功或未知回调不能把新配置标为已核验或过期', () => {
    const f = app(); workspace.useWorkspace.setState({ connectionVersions: { c: 1 } }); f.context.TableAutoIncrementDialog_onApplied({ definitionVerified: true }); f.context.TableAutoIncrementDialog_onExecutionUncertain('旧服务器未知');
    expect(f.mark).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
});
