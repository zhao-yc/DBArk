import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqlitePresetDraft } from '../../src/renderer/sqliteTablePresetDraft';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
/** 直接执行真实父函数，行草稿及已应用条件用RAM观察；不冒充窗口测试。 */
function fixture() {
  const tree = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['presetCurrent', 'presetConfiguration', 'loadPreset'], methods: string[] = [];
  function walk(n: ts.Node): void { if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '')) methods.push(n.getText(tree)); ts.forEachChild(n, walk); } walk(tree); expect(methods).toHaveLength(3);
  const page = { id: 'original' }, dataDraft = { rows: [{ id: 1, memo: '未提交' }], selection: new Set(['1']), dirty: true }, state = { available: true, editable: true }, editor = { page, canEdit: () => state.editable, ...dataDraft };
  const setters = Object.fromEntries(['Limit', 'Mode', 'Filters', 'Sort', 'Validation', 'Conditions'].map(name => ['set' + name, vi.fn()])), load = vi.fn(() => { throw Error('禁止数据库读取'); }), applied = { current: { old: true } }, ticket = {};
  let sequence = 0; const context: any = createContext({ page, available: () => state.available, view: { busy: false }, externalBusy: false, latest: { current: { refreshVersion: 0 } }, refreshVersion: 0, editorRef: { current: editor }, renderedEditor: editor, controller: { pageCurrent: () => true, load }, editRender: { current: ticket }, editRenderTicket: ticket, sqlitePresetDraft, sqliteTableDraft, names: ['id', 'memo'], uid: () => 'new-' + ++sequence, presetText: { changed: '原页变化' }, limit: 5, mode: 'and', filters: [], sort: [], tab: { connectionId: 'active-tab', database: 'main', table: 'subject' }, leftTree: { connectionId: 'another', database: 'wrong' }, applied, ...setters });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, api: context.api, setters, state, editor, applied, load, dataDraft };
}
const query = { limit: 7, mode: 'or', filters: [{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '9007199254740993' }, enabled: false }], sort: [{ column: 'memo', direction: 'desc' }] };
it('载入只回填完整表单，原编辑器/行草稿/选择/applied保持，同左树目标无关', () => {
  const f = fixture(); expect(f.api.loadPreset(query)).toBe(true);
  expect(f.setters.setLimit).toHaveBeenCalledExactlyOnceWith(7); expect(f.setters.setFilters.mock.calls[0][0][0]).toMatchObject({ value: '9007199254740993', enabled: false });
  expect(f.context.editorRef.current).toBe(f.editor); expect(f.editor.rows).toBe(f.dataDraft.rows); expect(f.editor.selection).toBe(f.dataDraft.selection); expect(f.applied.current).toEqual({ old: true }); expect(f.load).not.toHaveBeenCalled();
  expect(f.api.presetConfiguration()).toEqual({ limit: 5, mode: 'and', filters: [], sort: [] });
});
it.each(['missing', 'invalid', 'busy', 'unavailable', 'render', 'editor', 'refresh'] as const)('%s不作任何部分回填或数据库读取', mode => {
  const f = fixture(); let value: unknown = query;
  if (mode === 'missing') value = { ...query, sort: [{ column: 'gone', direction: 'asc' }] }; if (mode === 'invalid') value = { ...query, sql: 'DROP TABLE t' };
  if (mode === 'busy') f.context.view.busy = true; if (mode === 'unavailable') f.state.available = false; if (mode === 'render') f.context.editRender.current = {};
  if (mode === 'editor') f.state.editable = false; if (mode === 'refresh') f.context.latest.current.refreshVersion = 1;
  if (mode === 'missing' || mode === 'invalid') expect(() => f.api.loadPreset(value)).toThrow(); else expect(f.api.loadPreset(value)).toBe(false);
  for (const setter of Object.values(f.setters)) expect(setter).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.editor.dirty).toBe(true);
});
