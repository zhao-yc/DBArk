import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

const source = ts.createSourceFile('SqliteTableTab.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['editActionCurrent', 'selectEditRow', 'openInput', 'editRow', 'inputCurrent', 'saveInput', 'closeInput', 'addRow', 'removeRow', 'undoEdit', 'redoEdit', 'discardEdit', 'previewChanges', 'previewCurrent', 'applyPreview', 'closePreview', 'stopPreview'];
const methods = new Map<string, string>();
/** 保留真实 parent 处理器原文，只注入 React 状态/store/服务端端口。 */
function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) methods.set(node.name.text, node.getText(source)); ts.forEachChild(node, walk); } walk(source);
function page(snapshot: string): SqliteTablePage { return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '相同行号', kind: 'table' }, columns: [{ name: 'id', declaredType: 'INTEGER' }], offset: 0, limit: 10, hasMore: false, result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: 1 }], statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: snapshot, expiresAt: new Date(1800000).toISOString(), columns: [{ name: 'id', declaredType: 'INTEGER', generated: false, nullable: false, hasDefault: false }], rows: [[{ kind: 'integer', value: '1' }]], locator: { kind: 'primary-key', columns: ['id'] } } }; }
function fixture() {
  let sequence = 0; const preview = vi.fn(async (_input: unknown): Promise<any> => { throw Error('此用例只核准入'); }), apply = vi.fn(async (_input: unknown): Promise<any> => { throw Error('此用例不应写入'); }), cancel = vi.fn(async (_id: string) => {}), release = vi.fn(async (_input: unknown) => {}), read = vi.fn();
  function editor(id: string) { return new SqliteTableEditor(page(id), { current: () => true, active: () => true, available: () => true, acquire: () => ({ owns: () => true, release: () => true }), now: () => 0, id: () => 'task-' + ++sequence, changed: () => {}, dirty: () => {}, preview, apply, cancel, release, committed: () => {} }); }
  const first = editor('first'), editorRef = { current: first }, editRenderTicket = {}, editRender = { current: editRenderTicket }, inputRef = { current: null as any }, previewRef = { current: null as any }, setCellInput = vi.fn(), setPreviewOpen = vi.fn(), setSelectedRow = vi.fn(), confirm = vi.fn(() => true);
  const vm: any = createContext({ renderedEditor: first, editorRef, page: first.page, editRows: first.view.rows, editRenderTicket, editRender, inputRef, previewRef, setCellInput, setPreviewOpen, setSelectedRow, selectedRow: 'original-0', latest: { current: { active: true } }, useWorkspace: { getState: () => ({ settings: { activeTabId: 'tab' } }) }, tab: { id: 'tab' }, available: () => true, window: { confirm }, uid: () => 'ticket-' + ++sequence, editText, read });
  expect(methods.size).toBe(names.length); runInContext(ts.transpileModule([...methods.values()].join('\n') + '\nglobalThis.actions={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, vm);
  return { vm, first, editor, editorRef, editRender, inputRef, previewRef, setCellInput, setPreviewOpen, setSelectedRow, confirm, preview, apply, cancel, release, read };
}

describe('SQLite 编辑 parent 真实旧回调准入', () => {
  it.each(['addRow', 'removeRow', 'undoEdit', 'redoEdit', 'discardEdit', 'previewChanges'])('旧%s不能作用于同row id的新编辑器', async name => {
    const f = fixture(), old = f.vm.actions[name], next = f.editor('next'); f.editorRef.current = next; f.editRender.current = {}; await old();
    expect(next.changes).toEqual([]); expect(f.first.changes).toEqual([]); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it('旧grid选格、双击处理器拒绝旧行及同id的克隆行；当前真实原行仍能打开', () => {
    const f = fixture(), row = f.first.view.rows[0]; f.vm.actions.selectEditRow({ ...row }); f.vm.actions.editRow({ ...row }, 0); expect(f.setSelectedRow).not.toHaveBeenCalled(); expect(f.setCellInput).not.toHaveBeenCalled(); f.vm.actions.editRow(row, 0); expect(f.inputRef.current.row).toBe(row);
    const oldInput = f.inputRef.current, next = f.editor('next'); f.editorRef.current = next; f.editRender.current = {}; f.vm.actions.selectEditRow(row); f.vm.actions.editRow(row, 0); expect(f.inputRef.current).toBe(oldInput); expect(next.dirty).toBe(false);
  });
  it('同编辑器草稿数组变化及undo返回原数组后，旧渲染票据仍不能新增或删除', () => {
    const f = fixture(), oldAdd = f.vm.actions.addRow, oldRemove = f.vm.actions.removeRow; f.first.remove('original-0'); oldAdd(); oldRemove(); expect(f.first.changes).toEqual([{ kind: 'delete', row: 0 }]); f.first.undo(); f.editRender.current = {}; oldAdd(); oldRemove(); expect(f.first.changes).toEqual([]); expect(f.confirm).not.toHaveBeenCalled();
  });
  it('旧typed保存及关闭票据不能改新页同original-0，也不能清后继输入dirty', () => {
    const f = fixture(); f.vm.actions.editRow(f.first.view.rows[0], 0); const old = f.inputRef.current, next = f.editor('next'), nextTicket = { id: 'new-input', editor: next, page: next.page, rows: next.view.rows, row: next.view.rows[0] };
    f.editorRef.current = next; f.inputRef.current = nextTicket; next.inputOpen(true); f.setCellInput.mockClear(); expect(f.vm.actions.saveInput(old, [{ kind: 'integer', value: '99' }])).toBe(false); f.vm.actions.closeInput(old); expect(next.changes).toEqual([]); expect(next.dirty).toBe(true); expect(f.inputRef.current).toBe(nextTicket); expect(f.setCellInput).not.toHaveBeenCalled();
  });
  it('准确typed票据只能保存原草稿，保存改变rows后自己的close仍能结束原输入', () => {
    const f = fixture(); f.vm.actions.editRow(f.first.view.rows[0], 0); const input = f.inputRef.current; expect(f.vm.actions.saveInput(input, [{ kind: 'integer', value: '2' }])).toBe(true); expect(f.first.changes).toEqual([{ kind: 'update', row: 0, values: [{ column: 'id', value: { kind: 'integer', value: '2' } }] }]); f.vm.actions.closeInput(input); expect(f.inputRef.current).toBeNull(); expect(f.first.dirty).toBe(true);
  });
  it('删除确认等待期间换editor，确认返回后也不能删除后继页', () => {
    const f = fixture(), next = f.editor('next'); f.confirm.mockImplementation(() => { f.editorRef.current = next; f.editRender.current = {}; return true; }); f.vm.actions.removeRow(); expect(f.confirm).toHaveBeenCalledOnce(); expect(f.first.changes).toEqual([]); expect(next.changes).toEqual([]);
  });
  it('旧preview submit/close/stop票据不能作用于后继预览，pending task替换也不能误停apply', () => {
    const f = fixture(), oldTicket = { id: 'old', editor: f.first, page: f.first.page, rows: f.first.view.rows }, next = f.editor('next'), nextTicket = { id: 'next', editor: next, page: next.page, rows: next.view.rows };
    f.previewRef.current = nextTicket; f.editorRef.current = next; f.vm.actions.applyPreview(oldTicket, { previewId: 'old' }); f.vm.actions.closePreview(oldTicket, undefined); f.vm.actions.stopPreview(oldTicket, undefined, 'old-task'); expect(f.apply).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(f.previewRef.current).toBe(nextTicket); expect(f.setPreviewOpen).not.toHaveBeenCalled();
    f.previewRef.current = oldTicket; f.editorRef.current = f.first; f.vm.actions.stopPreview(oldTicket, undefined, 'old-preview-task'); expect(f.cancel).not.toHaveBeenCalled();
  });
});
