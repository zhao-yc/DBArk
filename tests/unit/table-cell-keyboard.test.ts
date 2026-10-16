import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { collectChanges } from '../../src/renderer/dataChanges';
import { ownCell } from '../../src/renderer/lib';
import { isBinaryCell } from '../../src/renderer/binaryCell';
import { recordReadonlyReason, type RecordContext } from '../../src/renderer/recordViews';
import { blocksBinaryTextInput, tableCellKeyIsComposing } from '../../src/renderer/tableCellKeyboard';
import { draftHistoryKey } from '../../src/renderer/draftHistory';

/** 固定当前生产处理函数源码，只替换DOM/状态端口，不能复制一套守卫实现使断言自证。 */
const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = '', editable = '';
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleGridKeyDown') handler = node.getText(tree); if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'editable') editable = node.initializer.getText(tree); node.forEachChild(visit); }
visit(tree);
const code = ts.transpileModule(handler + '\nglobalThis.handler=handleGridKeyDown;globalThis.canEdit=(' + editable + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function column(name: string, patch: Partial<ColumnInfo> = {}): ColumnInfo { return { name, type: 'varchar(100)', nullable: true, defaultValue: null, extra: '', generated: false, comment: '', ...patch }; }
/** 与表页相同的UUID、独立original及精度字符串；所有副作用都由生产处理函数决定。 */
function fixture() {
  const info: TableInfo = { database: 'd', name: 't', engine: 'InnoDB', objectKind: 'table', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: [column('id', { nullable: false, type: 'bigint unsigned' }), column('bytes', { type: 'varbinary(32)', nullable: false }), column('nullable_bytes', { type: 'blob' }), column('text', { type: 'text', nullable: false }), column('generated', { type: 'blob', generated: true })] };
  const state: RecordContext = { target: { connectionId: 'c', database: 'd', table: 't' }, connectionVersion: 2, generation: 3, info, loaded: true, busy: false, stale: false };
  const data = { id: '18446744073709551615', bytes: { type: 'binary' as const, base64: 'AAH/' }, nullable_bytes: { type: 'binary' as const, base64: 'qg==' }, text: '普通文本', amount: '12345678901234567890.123456', generated: { type: 'binary' as const, base64: 'AA==' } };
  const row: DraftRow = { id: 'uuid-1', data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }, other: DraftRow = { ...row, id: 'uuid-2', data: { ...row.data, id: '9007199254740993' }, original: { ...row.original, id: '9007199254740993' } };
  const rows = [row, other], setRows = vi.fn<(update: DraftRow[] | ((current: DraftRow[]) => DraftRow[])) => void>(), preview = vi.fn(), open = vi.fn(), find = vi.fn(); let dirtyInput = false, modal = false;
  const context = createContext({ draftHistoryKey, moveHistory: vi.fn(), blocked: false, editable: true, document: { querySelector: () => modal ? {} : null }, HTMLElement: class {}, record: { dirty: false, hasInput: () => dirtyInput, openCell: open }, info, page: { columns: [{ key: 'bytes', type: 'VAR_STRING' }, { key: 'nullable_bytes', type: 'BLOB' }, { key: 'text', type: 'BLOB' }, { key: 'generated', type: 'BLOB' }] }, rowsRef: { current: rows }, getRecordContext: () => state, ownCell, isBinaryCell, recordReadonlyReason, blocksBinaryTextInput, tableCellKeyIsComposing, changes: [{ kind: 'update' }], column: { key: 'bytes' }, setRows, makePreview: preview, openPageFind: find });
  setRows.mockImplementation(update => { context.rowsRef.current = typeof update === 'function' ? update(context.rowsRef.current) : update; });
  runInContext(code, context);
  /** React事件端口只记录两种prevent语义，浏览器原生输入与网格命令不能混为一个开关。 */
  function press(key: string, options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; nativeEvent?: { isComposing?: boolean; keyCode?: number }; mode?: 'ACTIVE' | 'EDIT'; column?: string; activeRow?: DraftRow } = {}) {
    const event = { key, ctrlKey: false, metaKey: false, shiftKey: false, nativeEvent: { isComposing: false, keyCode: 0 }, target: {}, preventGridDefault: vi.fn(), preventDefault: vi.fn(), ...options };
    context.handler({ mode: options.mode ?? 'ACTIVE', row: options.activeRow ?? row, column: { key: options.column ?? 'bytes' } }, event); return event;
  }
  return { context, state, info, row, other, rows, setRows, preview, open, find, press, input(value: boolean) { dirtyInput = value; }, modal(value: boolean) { modal = value; }, canEdit(key: string) { context.column.key = key; return context.canEdit(row) as boolean; } };
}

const compositionFlags = [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }, { isComposing: true, keyCode: 229 }];
describe('表格键盘组合输入命令守卫', () => {
  it.each(compositionFlags)('组合标志%j不清空、不查看、不预览或查找', nativeEvent => {
    const f = fixture();
    for (const [key, modifiers] of [['Delete', {}], ['Enter', {}], ['Enter', { ctrlKey: true }], ['Enter', { metaKey: true }], ['f', { ctrlKey: true }], ['h', { metaKey: true }]] as const) { const event = f.press(key, { nativeEvent, ...modifiers }); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.preventGridDefault).toHaveBeenCalled(); }
    expect(f.setRows).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.find).not.toHaveBeenCalled(); expect(f.context.rowsRef.current).toBe(f.rows);
  });
  it.each(compositionFlags)('普通TEXT默认IME输入不被取消：%j', nativeEvent => {
    const f = fixture(); for (const key of ['a', 'Process', 'Enter', 'Delete']) { const event = f.press(key, { column: 'text', nativeEvent }); expect(event.preventGridDefault).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled(); }
    expect(f.setRows).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.find).not.toHaveBeenCalled();
  });
  it.each(compositionFlags)('EDIT态组合事件阻止网格自动提交，仍保留原生输入：%j', nativeEvent => {
    const f = fixture(); for (const key of ['Enter', 'Escape', 'a']) { const event = f.press(key, { mode: 'EDIT', column: 'text', ctrlKey: key === 'Enter', nativeEvent }); expect(event.preventGridDefault).toHaveBeenCalledOnce(); expect(event.preventDefault).not.toHaveBeenCalled(); }
    expect(f.setRows).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled();
  });
  it('非组合Enter查看、Ctrl/Meta+Enter预览及CtrlF/H均保留', () => {
    const f = fixture(); f.press('Enter'); expect(f.open).toHaveBeenCalledExactlyOnceWith(f.row.id, 'bytes');
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) { f.press('Enter', modifier); f.press('f', modifier); f.press('h', modifier); }
    expect(f.preview).toHaveBeenCalledTimes(2); expect(f.find.mock.calls.map(call => call[0])).toEqual(['query', 'replacement', 'query', 'replacement']); expect(f.setRows).not.toHaveBeenCalled();
  });
  it('原生Ctrl/Meta+C/V与方向导航继续交给网格，普通TEXT不按wire BLOB误判', () => {
    const f = fixture(); for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) for (const key of ['c', 'v']) { const event = f.press(key, modifier); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.preventGridDefault).not.toHaveBeenCalled(); }
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Home', 'End', 'PageUp', 'PageDown']) expect(f.press(key).preventGridDefault).not.toHaveBeenCalled();
    expect(f.press('a', { column: 'text' }).preventGridDefault).not.toHaveBeenCalled(); expect(f.press('F2').preventGridDefault).toHaveBeenCalled(); expect(f.press('a').preventGridDefault).toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled();
  });
});

describe('Delete共享列级可写资格与明确值语义', () => {
  it('page仍含列但元数据缺列时与editable一样拒绝，不能把缺列当非生成列', () => {
    const f = fixture(); f.info.columns = f.info.columns.filter(column => column.name !== 'bytes'); expect(f.canEdit('bytes')).toBe(false); f.press('Delete'); expect(f.setRows).not.toHaveBeenCalled(); expect(f.context.rowsRef.current).toBe(f.rows); expect(collectChanges(f.rows)).toEqual([]);
  });
  it.each(['busy', 'stale', 'not-loaded', 'no-info', 'view', 'unknown-object', 'no-key', 'non-InnoDB', 'deleted', 'generated', 'record-input', 'record-dirty', 'grid-readonly', 'no-page-column', 'blocked', 'dialog'] as const)('%s拒绝Delete且不触发其它命令', condition => {
    const f = fixture(); let key = 'bytes';
    if (condition === 'busy') f.state.busy = true; else if (condition === 'stale') f.state.stale = true; else if (condition === 'not-loaded') f.state.loaded = false; else if (condition === 'no-info') f.state.info = null; else if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'unknown-object') f.info.objectKind = undefined; else if (condition === 'no-key') f.info.editableKey = []; else if (condition === 'non-InnoDB') f.info.engine = 'MyISAM'; else if (condition === 'deleted') f.row.deleted = true; else if (condition === 'generated') key = 'generated'; else if (condition === 'record-input') f.input(true); else if (condition === 'record-dirty') f.context.record.dirty = true; else if (condition === 'grid-readonly') f.context.editable = false; else if (condition === 'no-page-column') f.context.page.columns = []; else if (condition === 'blocked') f.context.blocked = true; else f.modal(true);
    f.press('Delete', { column: key }); expect(f.setRows).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.context.rowsRef.current).toBe(f.rows);
  });
  it('同步当前上下文覆盖渲染时旧字段，迟到行引用也不能清空新草稿', () => {
    const f = fixture(); f.state.info = { ...f.info, columns: f.info.columns.filter(column => column.name !== 'bytes') }; expect(f.context.info).toBe(f.info); f.press('Delete'); expect(f.setRows).not.toHaveBeenCalled();
    const next = fixture(); next.context.rowsRef.current = [{ ...next.row, data: { ...next.row.data, bytes: { type: 'binary', base64: 'AQI=' } } }, next.other]; next.press('Delete'); expect(next.setRows).not.toHaveBeenCalled(); expect(next.context.rowsRef.current[0].data.bytes).toEqual({ type: 'binary', base64: 'AQI=' });
  });
  it.each([['bytes', { type: 'binary', base64: '' }], ['nullable_bytes', null], ['text', '']] as const)('%s明确清空保留零字节/NULL/空串区别及原始精度', (key, expected) => {
    const f = fixture(), before = f.row.original; expect(f.canEdit(key)).toBe(true); f.press('Delete', { column: key }); expect(f.setRows).toHaveBeenCalledOnce();
    const next = f.context.rowsRef.current as DraftRow[]; expect(next[0].data[key]).toEqual(expected); expect(next[0].original).toBe(before); expect(next[1]).toBe(f.other); expect(next[0].data.id).toBe('18446744073709551615'); expect(next[0].data.amount).toBe('12345678901234567890.123456'); expect(collectChanges(next)).toEqual([{ kind: 'update', before, values: { [key]: expected } }]);
  });
  it('新行DEFAULT字节清空是明确零字节值，不把未填写或NULL写成字符串', () => {
    const f = fixture(); f.row.inserted = true; f.row.original = undefined; delete f.row.data.bytes; f.press('Delete'); expect(f.context.rowsRef.current[0].data.bytes).toEqual({ type: 'binary', base64: '' }); expect(f.context.rowsRef.current[0].inserted).toBe(true);
  });
});
