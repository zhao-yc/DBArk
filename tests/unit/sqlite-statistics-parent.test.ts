import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { sqliteStatisticsZh as statisticsText } from '../../src/renderer/locales/sqliteStatistics.zh-CN';

/** 直接执行正式父入口及其owner方法，只用RAM代替工作区和React发布，不复制父业务判断。 */
function fixture() {
  const tree = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let method = '';
  function walk(node: ts.Node): void { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openStatistics') method = node.getText(tree); ts.forEachChild(node, walk); } walk(tree); expect(method).not.toBe('');
  const tab = { id: 't', connectionId: 'c', database: 'main', table: 'subject' }, profile = { id: 'c', dialect: 'sqlite' }, page = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'v', declaredType: '' }] }, render = {}, form = { limit: 5, mode: 'or', filters: [{ id: 'pending', column: 'v', operator: 'eq', kind: 'text', value: '未应用草稿' }], sort: [] }, state = { settings: { activeTabId: 't', tabs: [tab] }, connections: [profile], connectionVersions: { c: 0 } }, allowed = { value: true, modal: false }, setFilters = vi.fn(), setConditions = vi.fn();
  const context: any = createContext({ tab, profile, page, version: 0, refreshVersion: 0, mode: 'or', editRenderTicket: render, editRender: { current: render }, available: () => allowed.value, view: { busy: false }, latest: { current: { active: true, refreshVersion: 0 } }, applied: { current: { limit: 5, mode: 'and', filters: [], sort: [] } }, valuesForm: { current: form }, statisticsRef: { current: undefined }, editorRef: { current: undefined }, controller: { pageCurrent: (value: unknown) => value === page }, useWorkspace: { getState: () => state }, document: { querySelectorAll: () => allowed.modal ? [{ getAttribute: () => '其它模态' }] : [] }, statisticsText, uid: () => 'generated', structuredClone, sqliteTableDraft, setFilters, setConditions, setStatisticsOpen: vi.fn() });
  runInContext(ts.transpileModule(method + '\nglobalThis.open=openStatistics;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.setCountedPage = vi.fn();
  return { context, form, state, allowed, setFilters, setConditions, open: (countOnly = false) => { context.open(countOnly); return context.statisticsRef.current; } };
}
it('概况只冻结已应用条件，保留未应用表单与草稿；父busy重绘不撤销自己的来源', () => {
  const f = fixture(), owner = f.open(); expect(owner.base).toMatchObject({ mode: 'and', filters: [] }); expect(owner.base).not.toHaveProperty('column'); expect(owner.columns).toEqual(['v']); expect(f.form.filters[0].value).toBe('未应用草稿');
  f.context.editRender.current = {}; expect(owner.current()).toBe(true); expect(f.setFilters).not.toHaveBeenCalled();
});
it.each(['profile', 'tab', 'form', 'modal', 'refresh', 'successor'] as const)('%s变化使原概况永久失效，同名ABA不复活', kind => {
  const f = fixture(), owner = f.open(), original = f.state.connections[0];
  if (kind === 'profile') f.state.connections[0] = { ...original }; if (kind === 'tab') f.state.settings.activeTabId = 'other'; if (kind === 'form') f.form.filters[0].value = '后继草稿'; if (kind === 'modal') f.allowed.modal = true; if (kind === 'refresh') f.context.latest.current.refreshVersion = 1; if (kind === 'successor') f.context.statisticsRef.current = {};
  expect(owner.current()).toBe(false); f.state.connections[0] = original; f.state.settings.activeTabId = 't'; f.form.filters[0].value = '未应用草稿'; f.allowed.modal = false; f.context.latest.current.refreshVersion = 0; f.context.statisticsRef.current = owner; expect(owner.current()).toBe(false);
});
it('未提交的旧父级事件不能打开概况；活跃编辑器只保留引用而不丢弃其草稿', () => {
  const f = fixture(); f.context.editRender.current = undefined; expect(f.open()).toBeUndefined(); expect(f.context.setStatisticsOpen).not.toHaveBeenCalled();
  f.context.editRender.current = f.context.editRenderTicket; const editor = { page: f.context.page, dirty: true, view: { valid: true } }; f.context.editorRef.current = editor;
  const owner = f.open(); expect(owner.current()).toBe(true); expect(editor.dirty).toBe(true); expect(f.context.editorRef.current).toBe(editor);
});
it('分页栏计数只在原页有效时发布，切换连接后的晚回包不覆盖旧计数', () => {
  const f = fixture(), owner = f.open(true);
  owner.onCount('9223372036854775807');
  expect(f.context.setCountedPage).toHaveBeenCalledExactlyOnceWith({ page: f.context.page, query: f.context.applied.current, refreshVersion: 0, rows: '9223372036854775807' });
  f.state.connectionVersions.c = 1;
  owner.onCount('5');
  f.state.connectionVersions.c = 0;
  owner.onCount('2');
  expect(f.context.setCountedPage).toHaveBeenCalledTimes(1);
});
