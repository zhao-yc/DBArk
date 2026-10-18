import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DeferredUpperSqlFormatting } from '../../src/renderer/sqlFormattingDeferred';
import { prepareSqlFormattingRoles } from '../../src/renderer/sqlFormatting';
beforeAll(async () => { await prepareSqlFormattingRoles(); });

/** 真正formatter/角色证明执行生产代码；只有Monaco事件、模块等待与owner为RAM端口。 */
function fixture(selected = false, keywordCase: 'upper' | 'lower' = 'upper') {
  const source = 'select MiXeD from T;', events = new Map<string, Set<() => void>>(), edits: string[] = [], undo: string[] = [];
  let sql = source, version = 1, disposed = false, readonly = false, current = true;
  const callbacks = new Set<() => void>();
  const watch = (key: string, callback: () => void) => { const values = events.get(key) ?? new Set(); events.set(key, values); values.add(callback); return { dispose: () => values.delete(callback) }; };
  const selection = (start: number, end: number) => ({ startLineNumber: 1, startColumn: start, endLineNumber: 1, endColumn: end, selectionStartLineNumber: 1, selectionStartColumn: start, positionLineNumber: 1, positionColumn: end, getStartPosition: () => ({ lineNumber: 1, column: start }), getEndPosition: () => ({ lineNumber: 1, column: end }), isEmpty: () => start === end, setStartPosition: () => selection(start, end), setEndPosition: () => selection(start, end) });
  let ranges = [selection(1, selected ? source.length + 1 : 1)];
  const model = { getValue: () => sql, getValueLength: () => sql.length, getVersionId: () => version, isDisposed: () => disposed, getOffsetAt: (p: any) => p.column - 1, getFullModelRange: () => selection(1, sql.length + 1), getEOL: () => '\n' };
  let activeModel = model;
  const editor = { getModel: () => activeModel, getSelections: () => ranges, getRawOptions: () => ({ readOnly: readonly }), onDidChangeModel: (fn: () => void) => watch('model', fn), onDidChangeModelContent: (fn: () => void) => watch('content', fn), onDidChangeCursorSelection: (fn: () => void) => watch('selection', fn), onDidChangeConfiguration: (fn: () => void) => watch('configuration', fn), onDidDispose: (fn: () => void) => watch('dispose', fn), pushUndoStop: () => { undo.push('stop'); return true; }, focus: vi.fn(), executeEdits: (name: string, values: any[], end: any) => { edits.push(name); sql = values[0].text; version++; if (end) end([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 4 } }]); return true; } };
  let resolve!: () => void, reject!: (reason: unknown) => void; const loading = new Promise<void>((yes, no) => { resolve = yes; reject = no; }), prepare = vi.fn(() => loading);
  const intent = new DeferredUpperSqlFormatting({ editor: () => editor as any, assertCurrent: () => { if (!current) throw Error('原owner已失效'); }, subscribe: callback => { callbacks.add(callback); return () => { callbacks.delete(callback); }; }, prepare }, { keywordCase });
  return { source, intent, edits, undo, prepare, resolve, reject, editor, model, get sql() { return sql; }, event(key: string) { for (const fn of events.get(key) ?? []) fn(); }, owner(value: boolean) { current = value; for (const fn of callbacks) fn(); }, reverse() { ranges[0].selectionStartColumn = source.length + 1; ranges[0].positionColumn = 1; }, cursor() { ranges = [selection(2, 2)]; }, swapModel() { activeModel = { ...model }; }, content() { sql += ' '; version++; }, readonly() { readonly = true; }, disposeModel() { disposed = true; }, subscriptions: () => [...events.values()].reduce((n, set) => n + set.size, callbacks.size) };
}

describe.each(['upper', 'lower'] as const)('显式%s原延迟意图', keywordCase => {
it.each([false, true])('等待期间不编辑，原owner/模型/版本/选区未变后只做一次原事务，选区=%s', async selected => {
  const f = fixture(selected, keywordCase), pending = f.intent.run(); expect(f.edits).toEqual([]); expect(f.undo).toEqual([]); expect(f.prepare).toHaveBeenCalledOnce();
  f.resolve(); expect(await pending).toBe(true); expect(f.edits).toEqual(['dbark-sql-format']); expect(f.undo).toEqual(['stop', 'stop']); expect(f.sql).toContain(keywordCase === 'upper' ? 'SELECT' : 'select'); expect(f.editor.getModel()).toBe(f.model); expect(f.subscriptions()).toBe(0);
});

it.each(['model', 'content', 'selection', 'configuration', 'dispose'])('原%s事件即使值恢复也永久拒绝，迟到模块不产生编辑或Undo', async kind => {
  const f = fixture(false, keywordCase), pending = f.intent.run(); f.event(kind); f.resolve(); await expect(pending).rejects.toThrow(); expect(f.sql).toBe(f.source); expect(f.edits).toEqual([]); expect(f.undo).toEqual([]); expect(f.subscriptions()).toBe(0);
});

it('切走再切回不能复活原owner', async () => {
  const f = fixture(false, keywordCase), pending = f.intent.run(); f.owner(false); f.owner(true); f.resolve(); await expect(pending).rejects.toThrow('原owner已失效'); expect(f.edits).toEqual([]); expect(f.subscriptions()).toBe(0);
});

it.each(['reverse', 'cursor', 'swapModel', 'content', 'readonly', 'disposeModel'] as const)('无事件的%s漂移仍在回包后重核拒绝', async change => {
  const f = fixture(false, keywordCase), pending = f.intent.run(); f[change](); f.resolve(); await expect(pending).rejects.toThrow(); expect(f.edits).toEqual([]); expect(f.undo).toEqual([]);
});

it('关闭取消后模块迟到不写；加载失败保留真实错误并释放观察', async () => {
  const closed = fixture(false, keywordCase), first = closed.intent.run(); closed.intent.dispose(); closed.resolve(); await expect(first).rejects.toThrow(); expect(closed.edits).toEqual([]);
  const f = fixture(false, keywordCase), error = Error('模块加载实际失败'), pending = f.intent.run(); f.reject(error); await expect(pending).rejects.toBe(error); expect(f.edits).toEqual([]); expect(f.undo).toEqual([]); expect(f.subscriptions()).toBe(0);
});

});
