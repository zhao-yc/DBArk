import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteOriginalValue } from '../../src/shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteDuplicate, sqliteDuplicateSourceCurrent } from '../../src/renderer/sqliteTableDuplicate';

/** 真实父处理器、source和editor参与；仅DOM／store／React发布为RAM，不接触剪贴板或数据库。 */
function fixture() {
  const file = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['duplicateRow', 'inputCurrent', 'saveInput', 'closeInput'], methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(file)); ts.forEachChild(node, walk); } walk(file); expect(methods).toHaveLength(names.length);
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }, { name: 'g', declaredType: 'TEXT', generated: true }, { name: 'exact', declaredType: 'INTEGER' }, { name: 'payload', declaredType: 'BLOB' }, { name: 'nullable', declaredType: 'TEXT' }];
  const original: SqliteOriginalValue[] = [{ kind: 'integer', value: '1' }, { kind: 'text', value: '源\0🚢' }, { kind: 'text', value: '生成值' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }];
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false, result: { columns: columns.map((c, i) => ({ name: c.name, key: 'c' + i, type: 'SQLITE' })), rows: [{}], statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(c => ({ ...c, generated: !!c.generated, nullable: true, hasDefault: true })), rows: [original], locator: { kind: 'rowid', columns: [] } } };
  const workspace = { settings: { activeTabId: 't' }, activeJobs: {} as Record<string, boolean> }, alive = { value: true }, latest = { current: { active: true } }, dialogs = { owners: [] as string[] }; let sequence = 0;
  const release = vi.fn(async () => {}), preview = vi.fn(), apply = vi.fn(), editor = new SqliteTableEditor(page, { current: () => alive.value, active: () => latest.current.active && workspace.settings.activeTabId === 't', available: () => !workspace.activeJobs.t, acquire: () => ({ owns: () => true, release: () => true }), now: Date.now, id: () => 'id-' + ++sequence, changed: () => {}, dirty: () => {}, preview, apply, release, cancel: vi.fn(), committed: () => {} });
  // VM中的父方法字面量外层数组跨realm；只复制这层协议容器，内部值仍交真实editor完整校验。
  const append = editor.appendRows.bind(editor); vi.spyOn(editor, 'appendRows').mockImplementation(matrix => append(Array.from(matrix)));
  const editorRef = { current: editor as SqliteTableEditor | null }, inputRef = { current: null as any }, setCellInput = vi.fn(), setSelectedRow = vi.fn(), setValidation = vi.fn(), available = vi.fn(() => dialogs.owners.length === 0), editActionCurrent = vi.fn(() => editor.canEdit());
  const context: any = createContext({ editorRef, inputRef, previewRef: { current: null as any }, pasteRef: { current: null as any }, rangeRef: { current: null as any }, renderedEditor: editor, editRows: editor.view.rows, selectedRow: editor.view.rows[0].id, prepareSqliteDuplicate, sqliteDuplicateSourceCurrent, latest, tab: { id: 't' }, useWorkspace: { getState: () => workspace }, document: { querySelectorAll: () => dialogs.owners.map(id => ({ querySelector: (selector: string) => selector === '[data-sqlite-duplicate-input="' + id + '"]' ? {} : null })) }, available, editActionCurrent, uid: () => 'input-' + ++sequence, setCellInput, setSelectedRow, setValidation, errorMessage: (reason: Error) => reason.message });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const open = () => { context.editRows = editor.view.rows; context.api.duplicateRow(); const ticket = inputRef.current; expect(ticket?.duplicate).toBeTruthy(); dialogs.owners = [ticket.id]; return ticket; };
  return { api: context.api, context, page, editor, editorRef, inputRef, workspace, alive, latest, dialogs, setCellInput, setSelectedRow, setValidation, available, editActionCurrent, release, preview, apply, open, values: () => original.map((v, i) => i === 0 ? { kind: 'integer' as const, value: '2' } : i === 2 ? undefined : v), dispose: () => editor.dispose() };
}
it('打开／取消不添加草稿、不分配持久行ID、不清源PK，取消还原原dirty', () => {
  const f = fixture(), rows = f.editor.view.rows, source = structuredClone(rows), ticket = f.open();
  expect(f.editor.view.rows).toBe(rows); expect(ticket.row.index).toBeUndefined(); expect(ticket.row.values[0]).toEqual(rows[0].values[0]); expect(ticket.row.values[2]).toBeUndefined(); expect(f.editor.changes).toEqual([]); expect(f.editor.dirty).toBe(true);
  f.api.closeInput(ticket); expect(f.inputRef.current).toBeNull(); expect(f.editor.view.rows).toBe(rows); expect(rows).toEqual(source); expect(f.editor.dirty).toBe(false); expect(f.editor.view.undo).toBe(false); expect(f.release).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); f.dispose();
});
it('保存仅append一条且一次undo／redo，全部typed与原源值保持；旧save不能重放', () => {
  const f = fixture(), before = f.editor.view.rows, ticket = f.open(); expect(f.api.saveInput(ticket, f.values())).toBe(true);
  expect(f.editor.view.rows).toHaveLength(2); expect(f.editor.view.rows[0]).toBe(before[0]); expect(f.editor.changes).toEqual([{ kind: 'insert', values: [{ column: 'id', value: { kind: 'integer', value: '2' } }, { column: 'note', value: before[0].values[1] }, { column: 'exact', value: before[0].values[3] }, { column: 'payload', value: before[0].values[4] }, { column: 'nullable', value: before[0].values[5] }] }]);
  expect(f.api.saveInput(ticket, f.values())).toBe(false); expect(f.editor.view.rows).toHaveLength(2); f.editor.undo(); expect(f.editor.view.rows).toBe(before); expect(f.editor.changes).toEqual([]); f.editor.redo(); expect(f.editor.changes).toHaveLength(1); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); f.dispose();
});
it('复制本地已保存修改，取消不清既有源更新和undo；新插入草稿也可再复制', () => {
  const f = fixture(), values = [...f.editor.view.rows[0].values]; values[1] = { kind: 'text', value: '已保存本地修改' }; f.editor.save(f.editor.view.rows[0].id, values); const before = f.editor.view.rows, ticket = f.open();
  expect(ticket.row.values[1]).toEqual(values[1]); f.api.closeInput(ticket); expect(f.editor.view.rows).toBe(before); expect(f.editor.changes).toHaveLength(1); expect(f.editor.dirty).toBe(true);
  f.editor.appendRows([f.values()]); f.context.selectedRow = f.editor.view.rows[1].id; f.dialogs.owners = []; const inserted = f.open(); expect(inserted.row.values).toEqual(f.editor.view.rows[1].values); f.api.closeInput(inserted); expect(f.editor.changes).toHaveLength(2); f.dispose();
});
it.each(['source-value', 'source-values', 'rows', 'deleted', 'metadata', 'profile-aba', 'inactive-aba', 'busy-aba', 'foreign-modal', 'successor'] as const)('%s变化后旧输入不新增，来源返回也不复活', change => {
  const f = fixture(), ticket = f.open();
  if (change === 'source-value') (f.editor.view.rows[0].values[1] as { value: string }).value = '后来值';
  if (change === 'source-values') f.editor.view.rows[0].values = [...f.editor.view.rows[0].values];
  if (change === 'rows') { f.editor.inputOpen(false); f.editor.save(f.editor.view.rows[0].id, [...f.values()].map((v, i) => i === 2 ? f.editor.view.rows[0].values[2] : v)); }
  if (change === 'deleted') f.editor.view.rows[0].deleted = true;
  if (change === 'metadata') f.page.columns[0].name = 'later';
  if (change === 'profile-aba') { f.alive.value = false; f.editor.observe(); f.alive.value = true; }
  if (change === 'inactive-aba') { f.workspace.settings.activeTabId = 'other'; expect(f.api.inputCurrent(ticket)).toBe(false); f.workspace.settings.activeTabId = 't'; }
  if (change === 'busy-aba') { f.workspace.activeJobs.t = true; expect(f.api.inputCurrent(ticket)).toBe(false); delete f.workspace.activeJobs.t; }
  if (change === 'foreign-modal') f.dialogs.owners = ['other'];
  if (change === 'successor') f.inputRef.current = { ...ticket, id: 'later' };
  const length = f.editor.view.rows.length; expect(f.api.saveInput(ticket, f.values())).toBe(false); expect(f.editor.view.rows).toHaveLength(length);
  if (change === 'foreign-modal') { f.dialogs.owners = [ticket.id]; expect(f.api.saveInput(ticket, f.values())).toBe(false); }
  f.dispose();
});
it('失效窗口可取消且只消费自己输入；旧关闭不能清后来窗口dirty', () => {
  const f = fixture(), ticket = f.open(); f.page.columns[0].name = 'later'; expect(f.api.inputCurrent(ticket)).toBe(false); f.api.closeInput(ticket); expect(f.inputRef.current).toBeNull(); expect(f.editor.dirty).toBe(false);
  f.inputRef.current = { ...ticket, id: 'next' }; f.editor.inputOpen(true); f.api.closeInput(ticket); expect(f.inputRef.current.id).toBe('next'); expect(f.editor.dirty).toBe(true); f.dispose();
});
it('保存必须有唯一准确窗口；零marker或两modal不授予暂存资格', () => {
  const f = fixture(), ticket = f.open(); f.dialogs.owners = []; expect(f.api.saveInput(ticket, f.values())).toBe(false); expect(f.editor.changes).toEqual([]); f.dialogs.owners = [ticket.id, ticket.id]; expect(f.api.saveInput(ticket, f.values())).toBe(false); expect(f.editor.changes).toEqual([]); f.dispose();
});
it('500条已有修改超预算时整组拒绝，保输入与原撤销步骤', () => {
  const f = fixture(); f.editor.appendRows(Array.from({ length: 500 }, () => [undefined, { kind: 'text', value: '已有草稿' }, undefined, undefined, undefined, undefined] as (SqliteOriginalValue | undefined)[])); const before = f.editor.view.rows, ticket = f.open();
  expect(() => f.api.saveInput(ticket, f.values())).toThrow(); expect(f.editor.view.rows).toBe(before); expect(f.editor.changes).toHaveLength(500); expect(f.inputRef.current).toBe(ticket); expect(f.editor.dirty).toBe(true); f.dispose();
});
it.each(['no-selection', 'deleted', 'readonly', 'input', 'busy', 'modal'] as const)('%s不创建复制输入', block => {
  const f = fixture();
  if (block === 'no-selection') f.context.selectedRow = 'absent';
  if (block === 'deleted') f.editor.view.rows[0].deleted = true;
  if (block === 'readonly') f.editActionCurrent.mockReturnValue(false);
  if (block === 'input') f.inputRef.current = {};
  if (block === 'busy') f.workspace.activeJobs.t = true;
  if (block === 'modal') f.dialogs.owners = ['other'];
  const before = f.inputRef.current, changes = f.editor.changes; f.api.duplicateRow(); expect(f.inputRef.current).toBe(before); expect(f.setCellInput).not.toHaveBeenCalled(); expect(f.editor.changes).toEqual(changes); f.dispose();
});
