import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { assertTableCopyStructureTargetAvailable } from '../../src/renderer/tableCopyStructureServices';
import { tableCopyStructureZh } from '../../src/renderer/locales/tableCopyStructure.zh-CN';

/** 运行生产JSX实际表达式与回调，不另写一份按钮保护或刷新实现。 */
function source(path: string) { return ts.createSourceFile(path, readFileSync(new URL('../../src/renderer/' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function attribute(tree: ts.SourceFile, tag: string, identity: string, name: string) {
  let value: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === tag && node.attributes.getText(tree).includes(identity)) {
      const attr = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === name) as ts.JsxAttribute | undefined;
      if (attr?.initializer && ts.isJsxExpression(attr.initializer)) value = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }; visit(tree); if (!value) throw Error('缺少实际复制入口：' + tag + '.' + name); return value.getText(tree);
}
function evaluate(expression: string, context: Record<string, unknown>) { return runInContext(ts.transpileModule('(' + expression + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, createContext(context)); }
const target = { connectionId: 'c', database: 'db', table: 'source' };
describe('复制结构实际入口与结果刷新接线', () => {
  it('TableTab允许无可编辑键的普通表；草稿、正在输入、布局和视图阻止进入', () => {
    const tree = source('components/TableTab.tsx'), expr = attribute(tree, 'button', 'tableCopyStructureZh.title', 'disabled'), baseline = { info: { objectKind: 'table', primaryKey: [], editableKey: [] }, editable: false, blocked: false, gridEditing: false, record: { dirty: false, pending: false }, changes: [], showPreferences: false, referenceDialog: null, pasteInsertDialog: null };
    expect(evaluate(expr, baseline)).toBe(false);
    for (const patch of [{ info: { objectKind: 'view' } }, { blocked: true }, { gridEditing: true }, { record: { dirty: true } }, { record: { pending: true } }, { changes: [{}] }, { showPreferences: true }]) expect(evaluate(expr, { ...baseline, ...patch })).toBe(true);
    const onTableCopyStructure = vi.fn(), click = attribute(tree, 'button', 'tableCopyStructureZh.title', 'onClick'); evaluate(click, { onTableCopyStructure, rootElement: { current: { querySelector: () => ({}) } } })(); expect(onTableCopyStructure).not.toHaveBeenCalled(); evaluate(click, { onTableCopyStructure, rootElement: { current: { querySelector: () => null } } })(); expect(onTableCopyStructure).toHaveBeenCalledTimes(1);
  });
  it('Sidebar真实对象行绑定准确来源名称，并保留专用回调链', () => {
    const tree = source('components/Sidebar.tsx'), onTableCopyStructure = vi.fn(); evaluate(attribute(tree, 'button', 'tableCopyStructureZh.title', 'onClick'), { object: { name: 'CaseTable' }, onTableCopyStructure })(); expect(onTableCopyStructure).toHaveBeenCalledExactlyOnceWith('CaseTable');
    const forward = attribute(tree, 'DatabaseNode', 'onTableCopyStructure', 'onTableCopyStructure'); evaluate(forward, { profile: { id: 'c' }, database: 'db', onTableCopyStructure })('source'); expect(onTableCopyStructure).toHaveBeenLastCalledWith('c', 'db', 'source');
  });
  it('App执行前同时保护源和新名隐藏草稿，连接变更不能继续', () => {
    const tree = source('App.tsx'), workspace = { settings: { tabs: [{ ...target, table: 'new_t', id: 'hidden', kind: 'table' as const, title: 'new_t' }] }, dirtyTabs: { hidden: true }, activeJobs: {}, connectionVersions: { c: 1 } }, invalidate = vi.fn();
    const before = evaluate(attribute(tree, 'TableCopyStructureDialog', 'copyStructureTarget', 'beforeApply'), { copyStructureTarget: target, copyStructureVersion: 1, useWorkspace: { getState: () => workspace }, assertTableCopyStructureTargetAvailable, tableCopyStructureZh, workbenchNavigation: { invalidate } });
    expect(() => before('new_t')).toThrow('草稿'); expect(workspace.dirtyTabs.hidden).toBe(true); expect(invalidate).not.toHaveBeenCalled(); workspace.connectionVersions.c = 2; expect(() => before('new_t')).toThrow('连接配置');
  });
  it('成功仅刷新真实目录和准确新目标，不关闭源页、迁移收藏或清空草稿；旧版本回调不刷新', () => {
    const tree = source('App.tsx'), refreshRenameDatabase = vi.fn(), markStructureTarget = vi.fn(), notify = vi.fn(), workspace = { connectionVersions: { c: 1 }, notify };
    const completed = evaluate(attribute(tree, 'TableCopyStructureDialog', 'copyStructureTarget', 'onApplied'), { copyStructureTarget: target, copyStructureVersion: 1, useWorkspace: { getState: () => workspace }, refreshRenameDatabase, markStructureTarget, tableCopyStructureZh });
    const newTarget = { ...target, table: 'new_t' }; completed({ newTarget, definitionVerified: true }); expect(refreshRenameDatabase).toHaveBeenCalledExactlyOnceWith(target); expect(markStructureTarget).toHaveBeenCalledExactlyOnceWith(newTarget, true);
    workspace.connectionVersions.c = 2; completed({ newTarget, definitionVerified: true }); expect(refreshRenameDatabase).toHaveBeenCalledTimes(1); expect(markStructureTarget).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledWith(tableCopyStructureZh.targetChanged, true);
  });
  it('未知结果刷新目录且将源/准确新名页都置陈旧，不按名称伪造成功', () => {
    const tree = source('App.tsx'), refreshRenameDatabase = vi.fn(), markStructureTarget = vi.fn(), notify = vi.fn(), workspace = { connectionVersions: { c: 1 }, notify };
    const uncertain = evaluate(attribute(tree, 'TableCopyStructureDialog', 'copyStructureTarget', 'onExecutionUncertain'), { copyStructureTarget: target, copyStructureVersion: 1, useWorkspace: { getState: () => workspace }, refreshRenameDatabase, markStructureTarget });
    uncertain('结果未知', 'new_t'); expect(refreshRenameDatabase).toHaveBeenCalledExactlyOnceWith(target); expect(markStructureTarget.mock.calls).toEqual([[target, false], [{ ...target, table: 'new_t' }, false]]); expect(notify).toHaveBeenCalledWith('结果未知', true);
  });
  it('P2：创建完成但源物理身份后核失败，真实完成回调必须同时置陈旧源页及新页并保留草稿', () => {
    const tree = source('App.tsx'), refreshRenameDatabase = vi.fn(), markStructureTarget = vi.fn(), notify = vi.fn(), dirtyTabs = { sourceDraft: true }, workspace = { connectionVersions: { c: 1 }, dirtyTabs, notify };
    const completed = evaluate(attribute(tree, 'TableCopyStructureDialog', 'copyStructureTarget', 'onApplied'), { copyStructureTarget: target, copyStructureVersion: 1, useWorkspace: { getState: () => workspace }, refreshRenameDatabase, markStructureTarget, tableCopyStructureZh });
    const newTarget = { ...target, table: 'new_t' };
    // 对应真实Engine的DDL已完成但源TABLE_ID变化结果，不能只使新表失效。
    completed({ target, newTarget, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, verificationError: '源物理身份变化', warnings: [] });
    expect(markStructureTarget.mock.calls).toEqual([[newTarget, false], [target, false]]); expect(refreshRenameDatabase).toHaveBeenCalledExactlyOnceWith(target); expect(workspace.dirtyTabs).toBe(dirtyTabs); expect(dirtyTabs.sourceDraft).toBe(true); expect(notify).toHaveBeenCalledWith(tableCopyStructureZh.verificationFailed, true);
    workspace.connectionVersions.c = 2; completed({ target, newTarget, ddlCompleted: true, definitionVerified: false }); expect(markStructureTarget).toHaveBeenCalledTimes(2);
  });
});
