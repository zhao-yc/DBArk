import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteRangePaste, sqliteRangePastePlanValues } from '../../src/renderer/sqliteTableRangePaste';
import { readSqliteClipboard } from '../../src/renderer/sqliteTableClipboard';
import { sqliteTableRangePasteZh as rangeText } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';

/** 提取真实父处理器；外界端口只替代React、store和editor发布，不替代位置计划或来源核对。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('SqliteTableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods: string[] = [];
  const names = ['selectPasteCell', 'rangeCurrent', 'openRange', 'closeRange', 'stageRange'];
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(file)); ts.forEachChild(node, visit); } visit(file); expect(methods).toHaveLength(names.length);
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }, { name: 'payload', declaredType: 'BLOB' }, { name: 'g', declaredType: 'TEXT', generated: true }];
  const rows: SqliteDraftRow[] = [1, 2].map((id, index) => ({ id: 'original-' + index, index, deleted: false, values: [{ kind: 'integer', value: String(id) }, { kind: 'text', value: '原' + id }, { kind: 'blob', value: '00ff' }, { kind: 'text', value: '生成' }] }));
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false, result: { columns: columns.map((column, index) => ({ name: column.name, key: 'c' + index, type: 'SQLITE' })), rows: [], elapsedMs: 0, statement: '', truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: true })), rows: rows.map(row => row.values as Exclude<typeof row.values[number], undefined>[]), locator: { kind: 'rowid', columns: ['id'] } } };
  const valid = { value: true }, currentRows = { value: rows }, workspace = { settings: { activeTabId: 't' }, activeJobs: {} as Record<string, boolean> }, modal = { count: 0 }, editRenderTicket = {}, editRender = { current: editRenderTicket as object | undefined };
  const editor = { page, view: { get rows() { return currentRows.value; } }, canEdit: vi.fn(() => valid.value), inputOpen: vi.fn(), pasteCells: vi.fn((_id: string, _column: number, _values: unknown) => 1) }, editorRef = { current: editor as typeof editor | null }, rangeCellRef = { current: undefined as { row: SqliteDraftRow; column: number } | undefined }, rangeRef = { current: null as any }, pasteRef = { current: null as any }, latest = { current: { active: true } };
  const setRangeCell = vi.fn(), setRangeOpen = vi.fn(), setValidation = vi.fn(), editActionCurrent = vi.fn(() => true), available = vi.fn(() => true); let sequence = 0;
  const context: any = createContext({ Error, rangeCellRef, rangeRef, pasteRef, editorRef, renderedEditor: editor, page, editRows: rows, editRenderTicket, editRender, inputRef: { current: null }, previewRef: { current: null }, latest, tab: { id: 't' }, useWorkspace: { getState: () => workspace }, document: { querySelectorAll: () => Array.from({ length: modal.count }) }, rangeText, readSqliteClipboard, sqliteRangePastePlanValues, editActionCurrent, available, uid: () => 'range-' + ++sequence, setRangeCell, setRangeOpen, setValidation, errorMessage: (reason: unknown) => reason instanceof Error ? reason.message : String(reason) });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={selectPasteCell,rangeCurrent,openRange,closeRange,stageRange};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const anchor = { row: rows[0], column: 1 }, plan = () => prepareSqliteRangePaste(page, rows, anchor, [[{ kind: 'text', value: '新值' }]]);
  return { ...context.api, context, editor, editorRef, rows, page, valid, currentRows, workspace, modal, latest, editRenderTicket, editRender, rangeCellRef, rangeRef, pasteRef, setRangeCell, setRangeOpen, setValidation, editActionCurrent, available, anchor, plan };
}
it('只记录真实数据格，布局交接和同格重复通知不循环；旧render及旧editor不能清后来起点', () => {
  const f = fixture(); f.editRender.current = undefined; f.selectPasteCell(f.anchor); expect(f.rangeCellRef.current).toEqual(f.anchor); f.selectPasteCell({ ...f.anchor }); expect(f.setRangeCell).toHaveBeenCalledOnce(); f.editRender.current = {}; f.selectPasteCell(undefined); expect(f.rangeCellRef.current).toEqual(f.anchor); f.editRender.current = f.editRenderTicket; f.editorRef.current = null; f.selectPasteCell(undefined); expect(f.rangeCellRef.current).toEqual(f.anchor);
});
it('生成列、deleted和同id克隆行不能成为起点，不能从selectedRow猜位置', () => {
  const f = fixture(); for (const anchor of [{ row: { ...f.rows[0] }, column: 1 }, { row: f.rows[0], column: 3 }, { row: f.rows[0], column: -1 }]) { f.selectPasteCell(anchor); expect(f.rangeCellRef.current).toBeUndefined(); } f.rows[0].deleted = true; f.selectPasteCell(f.anchor); expect(f.rangeCellRef.current).toBeUndefined(); f.openRange(); expect(f.rangeRef.current).toBeNull(); expect(f.setValidation).toHaveBeenCalledWith(rangeText.anchorRequired); expect(f.editor.inputOpen).not.toHaveBeenCalled();
});
it('本次paste绑定准确起点与typed源，打开和关闭没有任何editor覆盖调用', () => {
  const f = fixture(); f.selectPasteCell(f.anchor); const getData = vi.fn((type: string) => type === 'text/plain' ? 'NULL\t001' : ''); f.openRange({ types: ['text/plain'], getData }, f.anchor); const ticket = f.rangeRef.current; expect(ticket.anchor.row).toBe(f.rows[0]); expect(ticket.anchor.column).toBe(1); expect(ticket.rows).toBe(f.rows); expect(ticket.source.values).toEqual([[{ kind: 'text', value: 'NULL' }, { kind: 'text', value: '001' }]]); expect(f.editor.inputOpen).toHaveBeenCalledExactlyOnceWith(true); f.openRange(); expect(f.setRangeOpen).toHaveBeenCalledOnce(); expect(f.editor.pasteCells).not.toHaveBeenCalled(); f.closeRange(ticket); expect(f.editor.inputOpen.mock.calls).toEqual([[true], [false]]);
});
it('旧或克隆起点在读取剪贴板之前即拒绝；新增窗口占用时不领取第二个owner', () => {
  const f = fixture(); f.selectPasteCell(f.anchor); const getData = vi.fn(() => '禁止读取'); f.openRange({ types: ['text/plain'], getData }, { row: f.rows[1], column: 1 }); expect(getData).not.toHaveBeenCalled(); f.pasteRef.current = {}; f.openRange(); expect(f.rangeRef.current).toBeNull(); expect(f.editor.inputOpen).not.toHaveBeenCalled();
});
it.each(['inactive', 'job', 'modal', 'rows', 'editor', 'page', 'source', 'deleted'] as const)('区域%s变化撤销原票据，恢复引用也不能复活', change => {
  const f = fixture(); f.selectPasteCell(f.anchor); f.openRange(); const ticket = f.rangeRef.current;
  if (change === 'inactive') f.latest.current.active = false; if (change === 'job') f.workspace.activeJobs.t = true; if (change === 'modal') f.modal.count = 2; if (change === 'rows') f.currentRows.value = []; if (change === 'editor') f.editorRef.current = null; if (change === 'page') f.editor.page = { ...f.page }; if (change === 'source') f.valid.value = false; if (change === 'deleted') f.rows[0].deleted = true;
  expect(f.rangeCurrent(ticket)).toBe(false); f.latest.current.active = true; f.workspace.activeJobs = {}; f.modal.count = 1; f.currentRows.value = f.rows; f.editorRef.current = f.editor; f.editor.page = f.page; f.valid.value = true; f.rows[0].deleted = false; expect(f.rangeCurrent(ticket)).toBe(false); expect(() => f.stageRange(ticket, f.plan())).toThrow(rangeText.stale); expect(f.editor.pasteCells).not.toHaveBeenCalled();
});
it('窗口保持原锚点；准确plan仅覆盖一次本地范围，旧stage/close不能消费后来窗口', () => {
  const f = fixture(); f.selectPasteCell(f.anchor); f.openRange(); const ticket = f.rangeRef.current; f.rangeCellRef.current = { row: f.rows[1], column: 2 }; expect(f.rangeCurrent(ticket)).toBe(true); f.stageRange(ticket, f.plan()); expect(f.editor.pasteCells).toHaveBeenCalledExactlyOnceWith('original-0', 1, [[{ kind: 'text', value: '新值' }]]); expect(f.rangeRef.current).toBeNull(); f.rangeCellRef.current = f.anchor; f.openRange(); const next = f.rangeRef.current; f.closeRange(ticket); expect(f.rangeRef.current).toBe(next); expect(() => f.stageRange(ticket, f.plan())).toThrow(); expect(f.editor.pasteCells).toHaveBeenCalledOnce();
});
it('旧rows计划和伪plan拒绝；editor预算拒绝保输入及原票据，不部分发布', () => {
  const f = fixture(); f.selectPasteCell(f.anchor); f.openRange(); const ticket = f.rangeRef.current; expect(() => f.stageRange(ticket, {})).toThrow(); expect(f.editor.pasteCells).not.toHaveBeenCalled(); f.editor.pasteCells.mockImplementationOnce(() => { throw Error('原整批预算拒绝'); }); expect(() => f.stageRange(ticket, f.plan())).toThrow('原整批预算拒绝'); expect(f.rangeRef.current).toBe(ticket); expect(f.editor.inputOpen).toHaveBeenCalledExactlyOnceWith(true);
});
