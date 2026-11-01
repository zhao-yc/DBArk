import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { prepareSqlitePaste, readSqliteClipboard, sqlitePastePlanValues } from '../../src/renderer/sqliteTableClipboard';
import { sqliteTableClipboardZh as clipboardText } from '../../src/renderer/locales/sqliteTableClipboard.zh-CN';

/** 真实父函数在明确外界端口下运行；不替换粘贴解码、计划签发或原来源比较。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('SqliteTableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && ['pasteCurrent', 'openPaste', 'closePaste', 'stagePaste'].includes(node.name?.text ?? '')) methods.push(node.getText(file)); ts.forEachChild(node, visit); }; visit(file); expect(methods).toHaveLength(4);
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }, { name: 'g', declaredType: 'TEXT', generated: true }];
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false, result: { columns: columns.map((column, index) => ({ name: column.name, key: 'c' + index, type: 'SQLITE' })), rows: [], elapsedMs: 0, statement: '', truncated: false }, edit: { kind: 'editable', snapshotId: 'original', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: true })), rows: [], locator: { kind: 'rowid', columns: ['id'] } } };
  const rows: unknown[] = [], currentRows = { value: rows }, valid = { value: true }, workspace = { settings: { activeTabId: 't' }, activeJobs: {} as Record<string, boolean> }, modal = { count: 0 };
  const editor = { page, view: { get rows() { return currentRows.value; } }, canEdit: vi.fn(() => valid.value), inputOpen: vi.fn(), appendRows: vi.fn((_values: unknown) => ['new-1']) };
  const pasteRef = { current: null as any }, editorRef = { current: editor as typeof editor | null }, latest = { current: { active: true } }, setPasteOpen = vi.fn(), setSelectedRow = vi.fn(), setValidation = vi.fn(), available = vi.fn(() => true), editActionCurrent = vi.fn(() => true), pageCurrent = vi.fn(() => true); let sequence = 0;
  const context: any = createContext({ pasteRef, rangeRef: { current: null }, editorRef, renderedEditor: editor, page, inputRef: { current: null }, previewRef: { current: null }, latest, tab: { id: 't' }, useWorkspace: { getState: () => workspace }, controller: { pageCurrent }, document: { querySelectorAll: () => Array.from({ length: modal.count }) }, clipboardText, readSqliteClipboard, sqlitePastePlanValues, editActionCurrent, available, uid: () => 'owner-' + ++sequence, setPasteOpen, setSelectedRow, setValidation, errorMessage: (reason: unknown) => reason instanceof Error ? reason.message : String(reason) });
  let menuCurrent = '';
  const menu = (node: ts.Node) => { if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'ActionMenu') { const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'isCurrent'); if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) menuCurrent = attribute.initializer.expression!.getText(file); } ts.forEachChild(node, menu); }; menu(file); expect(menuCurrent).not.toBe('');
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={pasteCurrent,openPaste,closePaste,stagePaste,menuCurrent:' + menuCurrent + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const plan = () => prepareSqlitePaste(page, [[{ kind: 'text', value: '9223372036854775807' }]], [{ column: 'note', kind: 'preserve' }]);
  return { ...context.api, pasteRef, editorRef, editor, rows, currentRows, valid, workspace, modal, latest, setPasteOpen, setSelectedRow, setValidation, available, editActionCurrent, pageCurrent, page, plan, context };
}

it('显式入口领取一次准确owner并标输入dirty，打开和关闭不改原rows或投递写入', () => {
  const f = fixture(); f.openPaste(); const ticket = f.pasteRef.current; expect(ticket).toMatchObject({ editor: f.editor, page: f.page, rows: f.rows, valid: true }); expect(f.editor.inputOpen).toHaveBeenCalledExactlyOnceWith(true); f.openPaste(); expect(f.setPasteOpen).toHaveBeenCalledOnce(); expect(f.editor.appendRows).not.toHaveBeenCalled(); f.closePaste(ticket); expect(f.pasteRef.current).toBeNull(); expect(f.editor.inputOpen.mock.calls).toEqual([[true], [false]]); expect(f.currentRows.value).toBe(f.rows);
});
it('paste事件只读取本次DataTransfer；未知自有typed不降级或打开旧来源', () => {
  const f = fixture(), getData = vi.fn((type: string) => type === 'text/plain' ? '原文NULL\t001' : ''); f.openPaste({ types: ['text/plain'], getData }); expect(f.pasteRef.current.source.values).toEqual([[{ kind: 'text', value: '原文NULL' }, { kind: 'text', value: '001' }]]); expect(f.editor.appendRows).not.toHaveBeenCalled(); f.closePaste(f.pasteRef.current);
  f.openPaste({ types: ['application/x-dbark-sqlite-cells-v999', 'text/plain'], getData }); expect(f.pasteRef.current).toBeNull(); expect(f.setValidation).toHaveBeenCalled();
});
it.each(['inactive', 'job', 'modal', 'rows', 'editor', 'source', 'page'] as const)('来源%s变化留下墓碑，恢复原引用也不能再次暂存', change => {
  const f = fixture(); f.openPaste(); const ticket = f.pasteRef.current;
  if (change === 'inactive') f.latest.current.active = false;
  if (change === 'job') f.workspace.activeJobs.t = true;
  if (change === 'modal') f.modal.count = 2;
  if (change === 'rows') f.currentRows.value = [];
  if (change === 'editor') f.editorRef.current = null;
  if (change === 'source') f.valid.value = false;
  if (change === 'page') f.editor.page = { ...f.page };
  expect(f.pasteCurrent(ticket)).toBe(false); f.latest.current.active = true; f.workspace.activeJobs = {}; f.modal.count = 1; f.currentRows.value = f.rows; f.editorRef.current = f.editor; f.valid.value = true; f.editor.page = f.page; expect(f.pasteCurrent(ticket)).toBe(false); expect(() => f.stagePaste(ticket, f.plan())).toThrow(clipboardText.stale); expect(f.editor.appendRows).not.toHaveBeenCalled();
});
it('已接管的当前脏草稿在标签往返后仍能粘贴，不借browser已释放的只读页票据', () => {
  const f = fixture(); f.pageCurrent.mockReturnValue(false); expect(f.menuCurrent()).toBe(true); f.openPaste(); const ticket = f.pasteRef.current; expect(f.pasteCurrent(ticket)).toBe(true); f.stagePaste(ticket, f.plan()); expect(f.editor.appendRows).toHaveBeenCalledOnce();
});
it('More租约接受当前编辑器或只读browser任一准确来源，外界模态/忙态仍拒绝', () => {
  const f = fixture(); f.pageCurrent.mockReturnValue(false); f.editActionCurrent.mockReturnValue(false); expect(f.menuCurrent()).toBe(false); f.pageCurrent.mockReturnValue(true); expect(f.menuCurrent()).toBe(true); f.available.mockReturnValue(false); expect(f.menuCurrent()).toBe(false); f.pageCurrent.mockReturnValue(false); f.editActionCurrent.mockReturnValue(true); expect(f.menuCurrent()).toBe(false);
});
it('暂存核真实计划和原page，只调用一次append；关闭后旧stage/close不能清后来owner', () => {
  const f = fixture(); f.openPaste(); const old = f.pasteRef.current; f.modal.count = 1; f.stagePaste(old, f.plan()); expect(f.editor.appendRows).toHaveBeenCalledExactlyOnceWith([[undefined, { kind: 'text', value: '9223372036854775807' }, undefined]]); expect(f.setSelectedRow).toHaveBeenCalledExactlyOnceWith('new-1'); expect(f.pasteRef.current).toBeNull();
  f.modal.count = 0; f.openPaste(); const next = f.pasteRef.current; f.closePaste(old); expect(f.pasteRef.current).toBe(next); expect(() => f.stagePaste(old, f.plan())).toThrow(); expect(f.editor.appendRows).toHaveBeenCalledOnce();
});
it('伪计划与旧页计划拒绝，append预算错误保原票据与输入，不发布半批', () => {
  const f = fixture(); f.openPaste(); const ticket = f.pasteRef.current; expect(() => f.stagePaste(ticket, { rows: 1, width: 1 })).toThrow(); expect(f.editor.appendRows).not.toHaveBeenCalled(); f.editor.appendRows.mockImplementationOnce(() => { throw Error('原整批预算拒绝'); }); expect(() => f.stagePaste(ticket, f.plan())).toThrow('原整批预算拒绝'); expect(f.pasteRef.current).toBe(ticket); expect(f.editor.inputOpen).toHaveBeenCalledExactlyOnceWith(true); expect(f.setSelectedRow).not.toHaveBeenCalled();
});
