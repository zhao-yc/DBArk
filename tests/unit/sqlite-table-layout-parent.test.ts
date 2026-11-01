import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { changeTablePreference } from '../../src/renderer/tableColumnPreferences';

/** 原父函数直接执行，外部发布和布局状态仅RAM；不冒充原生窗口或磁盘验收。 */
function fixture() {
  const tree = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['layoutSourceCurrent', 'layoutUiCurrent', 'changeLayout', 'resizeLayout', 'closeLayout'], methods: string[] = [];
  let disabled = ''; function walk(n: ts.Node): void { if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '')) methods.push(n.getText(tree)); if (ts.isJsxOpeningElement(n) && n.tagName.getText(tree) === 'button' && n.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'aria-label' && p.initializer?.getText(tree) === '{layoutText.entry}')) { const p = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'disabled') as ts.JsxAttribute; disabled = (p.initializer as ts.JsxExpression).expression!.getText(tree); } ts.forEachChild(n, walk); } walk(tree); expect(methods).toHaveLength(5); expect(disabled).not.toBe('');
  const key = {}, render = {}, before = { version: 1 as const, columns: [{ name: 'A', hidden: false }, { name: 'B', hidden: false }] }, view = { preferences: before, dirty: false }, state = { valid: true, modal: false }, set = vi.fn(), restore = vi.fn(), close = vi.fn(), confirm = vi.fn(() => true), validation = vi.fn();
  const context: any = createContext({ editRender: { current: render }, editRenderTicket: render, layoutDialog: { scope: key, preferences: before, dirty: false }, layoutScope: key, layoutScopeRef: { current: { key, current: () => state.valid } }, layoutView: { pending: false }, view: { busy: false }, externalBusy: false, layout: { view, set, restore }, setLayoutDialog: close, window: { confirm }, layoutText: { discard: '放弃列布局？' }, setValidation: validation, errorMessage: (e: Error) => e.message, changeTablePreference, document: { querySelector: () => state.modal ? {} : null }, page: { result: { columns: [{ key: 'c0' }, { key: 'c1' }] }, columns: [{ name: 'A' }, { name: 'B' }] } });
  Object.assign(context, { active: true, invalidTarget: false }); context.layoutView.ready = true;
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + ',disabled:()=>(' + disabled + ')};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, api: context.api, before, view, state, set, restore, close, confirm, validation };
}
it('渲染时新事件票据尚未提交也应显示启用按钮，点击仍须等待真实提交', () => {
  const f = fixture(); f.context.editRender.current = {}; expect(f.api.disabled()).toBe(false); expect(f.api.layoutUiCurrent()).toBe(false); f.api.changeLayout(f.before); expect(f.set).not.toHaveBeenCalled();
});
it('调宽用物理key匹配原字段，隐藏/重排不将第2显示列错当原列', () => {
  const f = fixture(); f.api.resizeLayout('c1', 222); expect(f.set).toHaveBeenCalledExactlyOnceWith({ version: 1, columns: [{ name: 'A', hidden: false }, { name: 'B', hidden: false, width: 222 }] });
});
it.each(['stale', 'render', 'scope', 'pending', 'busy', 'modal'] as const)('%s不允许旧调宽写当前布局', mode => {
  const f = fixture(); if (mode === 'stale') f.state.valid = false; if (mode === 'render') f.context.editRender.current = {}; if (mode === 'scope') f.context.layoutDialog.scope = {}; if (mode === 'pending') f.context.layoutView.pending = true; if (mode === 'busy') f.context.externalBusy = true; if (mode === 'modal') f.state.modal = true;
  f.api.resizeLayout('c1', 400); expect(f.set).not.toHaveBeenCalled();
});
it('关闭dirty窗口取消保持当前布局，确认仅恢复布局副本不触及数据', () => {
  const f = fixture(); f.view.dirty = true; f.view.preferences = { ...f.before }; f.confirm.mockReturnValue(false); f.api.closeLayout(); expect(f.close).not.toHaveBeenCalled(); expect(f.restore).not.toHaveBeenCalled();
  f.confirm.mockReturnValue(true); f.api.closeLayout(); expect(f.restore).toHaveBeenCalledExactlyOnceWith(f.before, false); expect(f.close).toHaveBeenCalledExactlyOnceWith(undefined);
});
it('原页失效仍可关闭自己的布局窗口，不恢复到失效目标也不清后继窗口', () => {
  const f = fixture(); f.state.valid = false; f.api.closeLayout(); expect(f.close).toHaveBeenCalledExactlyOnceWith(undefined); expect(f.restore).not.toHaveBeenCalled();
  f.close.mockClear(); f.context.layoutDialog.scope = {}; f.api.closeLayout(); expect(f.close).not.toHaveBeenCalled();
});
it('真实父JSX把显示映射及调宽处理器交给编辑网格，原page/rows身份保持，恢复完成前禁用编辑', () => {
  const tree = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let jsx = '';
  function walk(node: ts.Node): void { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SqliteTableEditGrid') { expect(jsx).toBe(''); jsx = node.getText(tree); } ts.forEachChild(node, walk); } walk(tree); expect(jsx).not.toBe('');
  const page = {}, rows: object[] = [], projection = [{ index: 4, frozen: true }, { index: 0, frozen: false }], resize = vi.fn();
  const context: any = createContext({ React: { createElement: (_type: unknown, props: unknown) => props }, SqliteTableEditGrid: {}, page, editView: { rows }, projection, resizeLayout: resize, editBlocked: false, layoutView: { ready: true }, selectedRow: undefined, findHit: undefined, headerSort: [], sortFromHeader: vi.fn(), selectEditRow: vi.fn(), editRow: vi.fn(), openRange: vi.fn(), selectPasteCell: vi.fn(), selectEditFilterCell: vi.fn(), selectCheckedRows: vi.fn() });
  runInContext(ts.transpileModule('globalThis.renderGrid=()=>(' + jsx + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const props = context.renderGrid(); expect(props.page).toBe(page); expect(props.rows).toBe(rows); expect(props.projection).toBe(projection); expect(props.onColumnResize).toBe(resize); expect(props.disabled).toBe(false);
  context.layoutView.ready = false; expect(context.renderGrid().disabled).toBe(true);
});
