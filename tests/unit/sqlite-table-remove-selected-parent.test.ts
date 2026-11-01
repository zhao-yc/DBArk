import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

/** 真实父入口与真实editor，仅Grid捕获、store／DOM／React发布端口为RAM。 */
function fixture(count = 3) {
  const file = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['selectCheckedRows', 'checkedRowsCurrent', 'removeCheckedRows'], methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(file)); ts.forEachChild(node, walk); } walk(file); expect(methods).toHaveLength(names.length);
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }], page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), offset: 0, limit: 1000, hasMore: false, columns, result: { columns: columns.map((c, i) => ({ key: 'c' + i, name: c.name, type: 'SQLITE' })), rows: Array.from({ length: count }, () => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(c => ({ ...c, generated: false, nullable: true, hasDefault: false })), rows: Array.from({ length: count }, (_, i) => [{ kind: 'integer', value: String(i + 1) }, { kind: 'text', value: '原值' + i }]), locator: { kind: 'rowid', columns: [] } } };
  const workspace = { settings: { activeTabId: 't' }, activeJobs: {} as Record<string, boolean> }, alive = { value: true }, modal = { value: false }, listeners = new Set<() => void>(); let sequence = 0;
  const release = vi.fn(async () => {}), preview = vi.fn(), apply = vi.fn(), editor = new SqliteTableEditor(page, { current: () => alive.value, active: () => workspace.settings.activeTabId === 't', available: () => !workspace.activeJobs.t, acquire: () => ({ owns: () => true, release: () => true }), now: Date.now, id: () => 'new-' + ++sequence, changed: () => {}, dirty: () => {}, preview, apply, release, cancel: vi.fn(), committed: () => {} });
  // 父方法在VM构造的ids数组只换外层realm容器；删除计算、预算和原子replace仍运行真实editor。
  const remove = editor.removeRows.bind(editor); vi.spyOn(editor, 'removeRows').mockImplementation(ids => remove(Array.from(ids)));
  const rows = editor.view.rows, checkedRef = { current: undefined as any }, editorRef = { current: editor as SqliteTableEditor | null }, confirm = vi.fn(() => false), setValidation = vi.fn(), setSelectedRow = vi.fn(), current = { value: true };
  const editActionCurrent = vi.fn(() => current.value && editorRef.current === editor && editor.canEdit());
  const context: any = createContext({ checkedRef, checkedRows: undefined, editorRef, renderedEditor: editor, editRows: rows, page, selectedRow: rows[0].id, editActionCurrent, available: () => !modal.value, inputRef: { current: null as any }, previewRef: { current: null as any }, pasteRef: { current: null as any }, rangeRef: { current: null as any }, importRef: { current: null as any }, fullExportRef: { current: null as any }, findRef: { current: null as any }, exportData: null, useWorkspace: { subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } }, window: { confirm }, editText, uid: () => 'selection-' + ++sequence, setValidation, setSelectedRow, errorMessage: (reason: Error) => reason.message });
  context.setCheckedRows = vi.fn((owner: unknown) => { context.checkedRows = owner; });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const capture = (indices = [0, 1]) => { const valid = { value: true }, value = Object.freeze({ page, rows: editor.view.rows, selected: Object.freeze(indices.map(i => editor.view.rows[i])), current: () => valid.value }); return { value, valid }; };
  const choose = (indices = [0, 1]) => { context.editRows = editor.view.rows; const c = capture(indices); context.api.selectCheckedRows(c.value); expect(checkedRef.current?.capture).toBe(c.value); return c; };
  return { context, api: context.api, page, rows, editor, editorRef, workspace, alive, modal, checkedRef, confirm, setValidation, setSelectedRow, current, editActionCurrent, preview, apply, release, listeners, choose, capture, emit: () => [...listeners].forEach(cb => cb()), dispose: () => editor.dispose() };
}
it('选中不修改草稿，取消确认不清选择／undo也不读写', () => {
  const f = fixture(), selected = f.choose(), owner = f.checkedRef.current; f.api.removeCheckedRows();
  expect(f.confirm).toHaveBeenCalledWith(editText.removeSelectedConfirm(2)); expect(f.checkedRef.current).toBe(owner); expect(owner.capture).toBe(selected.value); expect(f.editor.view.rows).toBe(f.rows); expect(f.editor.changes).toEqual([]); expect(f.editor.view.undo).toBe(false); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0); f.dispose();
});
it('确认仅标两条本地删除、一次undo/redo、清自己勾选，原主键和字段不改', () => {
  const f = fixture(), before = structuredClone(f.rows); f.choose(); f.confirm.mockReturnValue(true); f.api.removeCheckedRows();
  expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }, { kind: 'delete', row: 1 }]); expect(f.editor.view.rows.map(row => row.values)).toEqual(before.map(row => row.values)); expect(f.checkedRef.current).toBeUndefined(); expect(f.setSelectedRow).toHaveBeenCalledWith('original-2'); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); f.editor.undo(); expect(f.editor.view.rows).toBe(f.rows); f.editor.redo(); expect(f.editor.changes).toHaveLength(2); expect(f.listeners.size).toBe(0); f.dispose();
});
it.each(['rows', 'selection', 'selection-content', 'owner', 'profile-aba', 'active-aba', 'busy-aba', 'modal-aba', 'render', 'input', 'find-preview'] as const)('确认期间%s变化不标记后继目标，也不复活原意图', change => {
  const f = fixture(), c = f.choose(); f.confirm.mockImplementation(() => {
    if (change === 'rows') f.context.editRows = [...f.rows];
    if (change === 'selection-content') c.valid.value = false;
    if (change === 'owner') f.context.checkedRows = { ...f.context.checkedRows };
    if (change === 'selection') { const next = f.capture([2]); f.api.selectCheckedRows(next.value); }
    if (change === 'profile-aba') { f.alive.value = false; f.editor.observe(); f.alive.value = true; }
    if (change === 'active-aba') { f.workspace.settings.activeTabId = 'other'; f.emit(); f.workspace.settings.activeTabId = 't'; }
    if (change === 'busy-aba') { f.workspace.activeJobs.t = true; f.emit(); delete f.workspace.activeJobs.t; }
    if (change === 'modal-aba') { f.modal.value = true; f.emit(); f.modal.value = false; }
    if (change === 'render') f.current.value = false;
    if (change === 'input') f.context.inputRef.current = {};
    if (change === 'find-preview') f.context.findRef.current = { preview: true };
    f.emit(); return true;
  });
  f.api.removeCheckedRows(); expect(f.editor.changes).toEqual([]); expect(f.editor.view.rows).toBe(f.rows); expect(f.listeners.size).toBe(0); f.dispose();
});
it('501条最终变化整批拒绝，保选择及原rows，错误清楚说明预算', () => {
  const f = fixture(501); f.choose(Array.from({ length: 501 }, (_, i) => i)); const owner = f.checkedRef.current; f.confirm.mockReturnValue(true); f.api.removeCheckedRows();
  expect(f.setValidation).toHaveBeenCalledWith(editText.bulkDeleteLimit); expect(f.editor.changes).toEqual([]); expect(f.editor.view.rows).toBe(f.rows); expect(f.checkedRef.current).toBe(owner); expect(f.listeners.size).toBe(0); f.dispose();
});
it.each(['empty', 'foreign-page', 'foreign-rows', 'foreign-row', 'deleted', 'duplicate-row', 'old-capture'] as const)('非法%s勾选通知不覆盖已接纳来源', reason => {
  const f = fixture(), previous = f.choose(), owner = f.checkedRef.current;
  let capture: any = { ...previous.value };
  if (reason === 'empty') { capture = { ...capture, selected: [] }; f.api.selectCheckedRows(capture); f.api.removeCheckedRows(); expect(f.confirm).not.toHaveBeenCalled(); f.dispose(); return; }
  if (reason === 'foreign-page') capture.page = { ...f.page };
  if (reason === 'foreign-rows') capture.rows = [...f.rows];
  if (reason === 'foreign-row') capture.selected = [{ ...f.rows[0] }];
  if (reason === 'deleted') { f.rows[0].deleted = true; capture.selected = [f.rows[0]]; }
  if (reason === 'duplicate-row') capture.selected = [f.rows[0], f.rows[0]];
  if (reason === 'old-capture') capture.current = () => false;
  f.api.selectCheckedRows(capture); expect(f.checkedRef.current).toBe(owner); f.dispose();
});
it.each(['inputRef', 'previewRef', 'pasteRef', 'rangeRef', 'importRef', 'fullExportRef'] as const)('%s占用时零确认／零暂存', async field => {
  const f = fixture(); f.choose(); f.context[field].current = {}; f.api.removeCheckedRows(); expect(f.confirm).not.toHaveBeenCalled(); expect(f.editor.changes).toEqual([]); f.dispose();
});
