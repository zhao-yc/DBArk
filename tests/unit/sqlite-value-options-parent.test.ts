import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { sqliteValueOptionsZh as valuesText } from '../../src/renderer/locales/sqliteValueOptions.zh-CN';

/** 直接执行正式父入口及其owner方法，只用RAM代替工作区和React发布，不复制父业务判断。 */
function fixture() {
  const tree = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let method = '';
  function walk(node: ts.Node): void { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openValues') method = node.getText(tree); ts.forEachChild(node, walk); } walk(tree); expect(method).not.toBe('');
  const tab = { id: 't', connectionId: 'c', database: 'main', table: 'subject' }, profile = { id: 'c', dialect: 'sqlite' }, page = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'v', declaredType: '' }] }, render = {}, form = { limit: 5, mode: 'or', filters: [{ id: 'pending', column: 'v', operator: 'eq', kind: 'text', value: '未应用草稿' }], sort: [] }, state = { settings: { activeTabId: 't', tabs: [tab] }, connections: [profile], connectionVersions: { c: 0 } }, allowed = { value: true, modal: false }, setFilters = vi.fn(), setConditions = vi.fn();
  const context: any = createContext({ tab, profile, page, version: 0, refreshVersion: 0, mode: 'or', editRenderTicket: render, editRender: { current: render }, available: () => allowed.value, view: { busy: false }, latest: { current: { active: true, refreshVersion: 0 } }, applied: { current: { limit: 5, mode: 'and', filters: [], sort: [] } }, valuesForm: { current: form }, valuesRef: { current: undefined }, editorRef: { current: undefined }, controller: { pageCurrent: (value: unknown) => value === page }, useWorkspace: { getState: () => state }, document: { querySelectorAll: () => allowed.modal ? [{ getAttribute: () => '其它模态' }] : [] }, valuesText, uid: () => 'generated', structuredClone, sqliteTableDraft, setFilters, setConditions, setValuesOpen: vi.fn() });
  runInContext(ts.transpileModule(method + '\nglobalThis.open=openValues;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, form, state, allowed, setFilters, setConditions, open: () => { context.open(); return context.valuesRef.current; } };
}
it('候选使用已应用条件，加入保留未应用草稿；父busy重绘后原owner仍可准确接纳', () => {
  const f = fixture(), owner = f.open(); expect(owner.base).toMatchObject({ connectionId: 'c', table: 'subject', mode: 'and', filters: [] }); expect(owner.mode).toBe('or'); f.context.editRender.current = {};
  expect(owner.apply({ column: 'v', operator: 'oneOf', selectedValues: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }] })).toBe(true);
  expect(f.setFilters.mock.calls[0][0]).toEqual([f.form.filters[0], { id: 'generated', column: 'v', operator: 'oneOf', kind: 'text', value: '', selectedValues: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }] }]); expect(f.setConditions).toHaveBeenCalledExactlyOnceWith(true);
});
it.each(['profile', 'tab', 'form', 'modal', 'refresh', 'successor'] as const)('%s变化撤销旧owner，返回同名原值也不复活', mode => {
  const f = fixture(), owner = f.open(), original = f.state.connections[0];
  if (mode === 'profile') f.state.connections[0] = { ...original }; if (mode === 'tab') f.state.settings.activeTabId = 'other'; if (mode === 'form') f.form.filters[0].value = '后继草稿'; if (mode === 'modal') f.allowed.modal = true; if (mode === 'refresh') f.context.latest.current.refreshVersion = 1; if (mode === 'successor') f.context.valuesRef.current = {};
  expect(owner.current()).toBe(false); f.state.connections[0] = original; f.state.settings.activeTabId = 't'; f.form.filters[0].value = '未应用草稿'; f.allowed.modal = false; f.context.latest.current.refreshVersion = 0; f.context.valuesRef.current = owner;
  expect(owner.apply({ column: 'v', operator: 'oneOf', selectedValues: [{ kind: 'null' }] })).toBe(false); expect(f.setFilters).not.toHaveBeenCalled();
});
it('父级尚未提交或全组超限时不发布任何条件，也不改变原行草稿', () => {
  const f = fixture(), owner = f.open(); f.context.editRender.current = undefined; expect(owner.apply({ column: 'v', operator: 'oneOf', selectedValues: [{ kind: 'null' }] })).toBe(false); f.context.editRender.current = {};
  expect(() => owner.apply({ column: 'v', operator: 'oneOf', selectedValues: Array.from({ length: 129 }, () => ({ kind: 'null' })) })).toThrow(); expect(f.setFilters).not.toHaveBeenCalled(); expect(f.form.filters[0].value).toBe('未应用草稿');
});
