import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { columnPageRefreshAction } from '../../src/renderer/columnPatchServices';
import { assertTableTruncateTargetAvailable } from '../../src/renderer/tableTruncateServices';
import { tableTruncateZh } from '../../src/renderer/locales/tableTruncate.zh-CN';
import { assertTableTruncateLiveTarget } from '../helpers/tableTruncateTarget';

/** 运行生产JSX的回调与禁用表达式；不复制一份按钮权限判断充当证据。 */
function source(path: string) { return ts.createSourceFile(path, readFileSync(new URL('../../src/renderer/' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function attribute(tree: ts.SourceFile, tag: string, identity: string, name: string) {
  let value: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === tag && node.attributes.getText(tree).includes(identity)) {
      const attr = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === name) as ts.JsxAttribute | undefined;
      if (attr?.initializer && ts.isJsxExpression(attr.initializer)) value = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }; visit(tree); if (!value) throw Error('缺少实际接线：' + tag + '.' + name); return value.getText(tree);
}
function evaluate(expression: string, context: Record<string, unknown>) { return runInContext(ts.transpileModule('(' + expression + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, createContext(context)); }

describe('清空入口接线与结构失效边界', () => {
  it('无主键/唯一键及不可网格编辑不阻止独立DDL；视图、草稿或正在输入才阻止', () => {
    const tree = source('components/TableTab.tsx'), expr = attribute(tree, 'button', 'tableTruncateZh.title', 'disabled');
    const baseline = { info: { objectKind: 'table', primaryKey: [], editableKey: [] }, editable: false, blocked: false, gridEditing: false, record: { dirty: false, pending: false }, changes: [], showPreferences: false, referenceDialog: null, pasteInsertDialog: null };
    expect(evaluate(expr, baseline)).toBe(false);
    for (const patch of [{ info: { objectKind: 'view' } }, { blocked: true }, { gridEditing: true }, { record: { dirty: true } }, { record: { pending: true } }, { changes: [{}] }, { showPreferences: true }]) expect(evaluate(expr, { ...baseline, ...patch })).toBe(true);
    const onTableTruncate = vi.fn(), click = attribute(tree, 'button', 'tableTruncateZh.title', 'onClick');
    evaluate(click, { onTableTruncate, rootElement: { current: { querySelector: () => ({}) } } })(); expect(onTableTruncate).not.toHaveBeenCalled();
  });
  it('App执行前保护同目标隐藏草稿及连接版本，不提交、不丢弃草稿', () => {
    const tree = source('App.tsx'), truncateTarget = { connectionId: 'c', database: 'db', table: 't' }, workspace = { settings: { tabs: [{ ...truncateTarget, id: 'hidden', kind: 'table' as const, title: 't' }] }, dirtyTabs: { hidden: true }, activeJobs: {}, tableLayoutDrafts: {}, connectionVersions: { c: 1 } };
    const before = evaluate(attribute(tree, 'TableTruncateDialog', 'truncateTarget', 'beforeApply'), { truncateTarget, truncateVersion: 1, useWorkspace: { getState: () => workspace }, assertTableTruncateTargetAvailable, tableTruncateZh });
    expect(() => before()).toThrow('草稿'); expect(workspace.dirtyTabs.hidden).toBe(true);
    workspace.connectionVersions.c = 2; expect(() => before()).toThrow('连接配置');
  });
  it('完成和未知回调只标记固定目标；未知不自动刷新，旧页进入stale保护', () => {
    const tree = source('App.tsx'), truncateTarget = { connectionId: 'c', database: 'db', table: 't' }, mark = vi.fn(), notify = vi.fn();
    const context = { truncateTarget, markStructureTarget: mark, useWorkspace: { getState: () => ({ notify }) }, tableTruncateZh };
    const applied = evaluate(attribute(tree, 'TableTruncateDialog', 'truncateTarget', 'onApplied'), context), unknown = evaluate(attribute(tree, 'TableTruncateDialog', 'truncateTarget', 'onExecutionUncertain'), context);
    applied({ definitionVerified: true }); expect(mark).toHaveBeenLastCalledWith(truncateTarget, true);
    applied({ definitionVerified: false }); expect(mark).toHaveBeenLastCalledWith(truncateTarget, false); unknown('清空未知'); expect(mark).toHaveBeenLastCalledWith(truncateTarget, false);
    expect(columnPageRefreshAction(0, 1, false, false, false)).toBe('stale'); expect(columnPageRefreshAction(0, 1, true, false, false)).toBe('reload'); expect(columnPageRefreshAction(0, 1, true, false, true)).toBe('stale');
  });
  it('正式定义目标仅200两端口，13484未显式TLS或缺CA拒绝，零连接', () => {
    expect(() => assertTableTruncateLiveTarget({ host: '192.168.31.200', port: 13384 })).not.toThrow();
    for (const port of [13357, 13380, 13310, 13311, 3306]) expect(() => assertTableTruncateLiveTarget({ host: '192.168.31.200', port })).toThrow();
    expect(() => assertTableTruncateLiveTarget({ host: 'localhost', port: 13384 })).toThrow(); expect(() => assertTableTruncateLiveTarget({ host: 'deve-server.yinzon.com', port: 13484 })).toThrow();
    expect(() => assertTableTruncateLiveTarget({ host: 'deve-server.yinzon.com', port: 13484, tlsFlag: '1', caPath: '纯配置占位.pem' })).not.toThrow();
  });
});
