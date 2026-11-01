import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteTableEditLimits, type SqliteOriginalValue, type SqliteTableEditOutcome, type SqliteTableEditPreview } from '../../src/shared/sqliteTableEdit';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';

const nullValue = (): SqliteOriginalValue => ({ kind: 'null' }), text = (value: string): SqliteOriginalValue => ({ kind: 'text', value });
/** 原生值只属于原页；包括不可作为新输入的REAL及生成值，用真实editor核验无隐式重写。 */
function page(width = 4, generated = new Set([3]), originalRows = 1): SqliteTablePage {
  const columns = Array.from({ length: width }, (_, index) => ({ name: 'c' + index, declaredType: '', generated: generated.has(index) })), rows = Array.from({ length: originalRows }, () => columns.map((column, index): SqliteOriginalValue => column.generated ? { kind: 'real', value: 'Infinity' } : index === 0 ? { kind: 'integer', value: '9223372036854775807' } : text('原')));
  return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '本地草稿', kind: 'table' }, columns, offset: 0, limit: 1000, hasMore: false, result: { columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })), rows: rows.map(() => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot-original', expiresAt: new Date(1800000).toISOString(), columns: columns.map(column => ({ ...column, nullable: true, hasDefault: true })), rows, locator: { kind: 'rowid', columns: [] } } };
}
function fixture(source = page()) {
  let current = true, active = true, available = true, now = 0, serial = 0;
  const previewResult: SqliteTableEditPreview = { previewId: 'preview-original', snapshotId: 'snapshot-original', target: source.target, schemaKey: source.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.本地草稿', sql: ['原预览'], counts: { insert: 0, update: 1, delete: 0 } };
  const id = vi.fn(() => 'draft-' + ++serial), release = vi.fn(async (_input: { snapshotId?: string; previewId?: string }) => {}), preview = vi.fn(async (_input: unknown) => previewResult), apply = vi.fn(async (_input: unknown): Promise<SqliteTableEditOutcome> => { throw Error('本地追加不应申请写入'); }), dirty = vi.fn(), changed = vi.fn();
  const editor = new SqliteTableEditor(source, { current: () => current, active: () => active, available: () => available, now: () => now, id, acquire: () => ({ owns: () => true, release: () => true }), preview, apply, release, cancel: async () => {}, committed: () => {}, dirty, changed });
  const defaults = (): (SqliteOriginalValue | undefined)[] => Array.from({ length: source.columns.length }, () => undefined);
  const saved = (column: number, value: SqliteOriginalValue) => { const values = [...editor.view.rows[0].values]; values[column] = value; editor.save('original-0', values); };
  const ready = async () => { saved(1, text('已修改')); await editor.preview(); expect(editor.view.preview).toBe(previewResult); };
  return { editor, source, id, preview, apply, release, dirty, changed, previewResult, defaults, saved, ready, active: (value: boolean) => { active = value; }, available: (value: boolean) => { available = value; }, current: (value: boolean) => { current = value; }, now: (value: number) => { now = value; } };
}
/** 私有账本只读断言，不能用替代状态机假装undo、preview或原行未变化。 */
function capture(f: ReturnType<typeof fixture>) {
  const internal = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }, view = f.editor.view;
  return { rows: view.rows, past: internal.past, pastLength: internal.past.length, future: internal.future, futureLength: internal.future.length, input: internal.input, preview: view.preview, message: view.message, undo: view.undo, redo: view.redo, releases: f.release.mock.calls.length, changes: structuredClone(f.editor.changes), emitted: f.changed.mock.calls.length, dirtyCalls: f.dirty.mock.calls.length, ids: f.id.mock.calls.length };
}
function unchanged(f: ReturnType<typeof fixture>, before: ReturnType<typeof capture>, noIds = true) {
  const internal = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }, view = f.editor.view;
  expect(view.rows).toBe(before.rows); expect(internal.past).toBe(before.past); expect(internal.past).toHaveLength(before.pastLength); expect(internal.future).toBe(before.future); expect(internal.future).toHaveLength(before.futureLength); expect(internal.input).toBe(before.input); expect(view.preview).toBe(before.preview); expect(view.message).toBe(before.message); expect(view.undo).toBe(before.undo); expect(view.redo).toBe(before.redo); expect(f.editor.changes).toEqual(before.changes); expect(f.release).toHaveBeenCalledTimes(before.releases); expect(f.changed).toHaveBeenCalledTimes(before.emitted); expect(f.dirty).toHaveBeenCalledTimes(before.dirtyCalls); if (noIds) expect(f.id).toHaveBeenCalledTimes(before.ids);
}

describe('SQLite多行粘贴仅一次追加本地草稿', () => {
  it('DEFAULT/NULL/空BLOB/64位及Unicode原文分明，严格复制全部值且不预览或写DB', () => {
    const f = fixture(), original = f.editor.view.rows[0], first = [undefined, nullValue(), { kind: 'blob', value: '' } as SqliteOriginalValue, undefined], second = [{ kind: 'integer', value: '-9223372036854775808' } as SqliteOriginalValue, text('中文\0🚢'), undefined, undefined], ids = f.editor.appendRows([first, second]);
    expect(ids).toEqual(['draft-1', 'draft-2']); expect(f.editor.view.rows[0]).toBe(original); expect(original.values[3]).toEqual({ kind: 'real', value: 'Infinity' }); expect(f.editor.changes).toEqual([{ kind: 'insert', values: [{ column: 'c1', value: { kind: 'null' } }, { column: 'c2', value: { kind: 'blob', value: '' } }] }, { kind: 'insert', values: [{ column: 'c0', value: { kind: 'integer', value: '-9223372036854775808' } }, { column: 'c1', value: { kind: 'text', value: '中文\0🚢' } }] }]); first[1] = text('输入已变'); const secondCell = second[1]; if (secondCell && 'value' in secondCell) secondCell.value = '输入也变'; ids[0] = '外部ID已变'; expect(f.editor.view.rows[1].id).toBe('draft-1'); expect(f.editor.view.rows[1].values[1]).toEqual({ kind: 'null' }); expect(f.editor.view.rows[2].values[1]).toEqual(text('中文\0🚢')); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.changed).toHaveBeenCalledOnce();
  });

  it('多行形成一步undo，保留原脏修改和原行引用，redo恢复同批全部ID', () => {
    const f = fixture(); f.saved(1, text('原脏修改')); const rows = f.editor.view.rows, before = f.editor.changes; const ids = f.editor.appendRows([f.defaults(), f.defaults(), f.defaults()]); expect(f.editor.changes).toHaveLength(4); f.editor.undo(); expect(f.editor.view.rows).toBe(rows); expect(f.editor.changes).toEqual(before); f.editor.redo(); expect(f.editor.view.rows.slice(1).map(row => row.id)).toEqual(ids); expect(f.editor.changes).toHaveLength(4);
  });

  it('只有成功追加才释放旧preview并清input标志，失败不变旧预览与redo', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(() => f.editor.appendRows([[undefined, { kind: 'real', value: 'Infinity' }, undefined, undefined]])).toThrow(); unchanged(f, before); const ids = f.editor.appendRows([f.defaults(), f.defaults()]); expect(ids).toHaveLength(2); expect(f.editor.view.preview).toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenLastCalledWith({ previewId: f.previewResult.previewId }); expect((f.editor as unknown as { input: boolean }).input).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });

  it.each(['Infinity', '-Infinity', 'NaN', '1e999'])('原非有限REAL允许展示，但新插入的%s仍一律拒绝', value => {
    const f = fixture(), before = capture(f); expect(f.editor.view.rows[0].values[3]).toEqual({ kind: 'real', value: 'Infinity' }); expect(() => f.editor.appendRows([[undefined, { kind: 'real', value }, undefined, undefined]])).toThrow(); unchanged(f, before);
  });

  it('生成列仅可undefined，不能把原生成值或NULL伪装为待插入字段', () => {
    const f = fixture(), before = capture(f); for (const value of [f.editor.view.rows[0].values[3], nullValue(), text('生成')]) { expect(() => f.editor.appendRows([[undefined, undefined, undefined, value]])).toThrow(); unchanged(f, before); }
  });

  it('一组末行typed失败也零发布、零ID，已有撤销及重做账本原样', () => {
    const f = fixture(); f.saved(1, text('一')); f.saved(1, text('二')); f.editor.undo(); const before = capture(f); expect(() => f.editor.appendRows([f.defaults(), [undefined, undefined, { kind: 'blob', value: 'f' }, undefined]])).toThrow(); unchanged(f, before); f.editor.redo(); expect(f.editor.view.rows[0].values[1]).toEqual(text('二'));
  });

  it.each(['empty', 'outer-sparse', 'row-short', 'row-long', 'row-sparse', 'huge-outer', 'huge-row', 'outer-extra', 'row-symbol'] as const)('矩阵%s格式失败先于值读取或ID分配', kind => {
    const f = fixture(), before = capture(f); let matrix: unknown = [f.defaults()];
    if (kind === 'empty') matrix = []; if (kind === 'outer-sparse') matrix = new Array(1); if (kind === 'row-short') matrix = [[undefined]]; if (kind === 'row-long') matrix = [[undefined, undefined, undefined, undefined, undefined]]; if (kind === 'row-sparse') matrix = [new Array(4)]; if (kind === 'huge-outer') matrix = new Array(4294967295); if (kind === 'huge-row') matrix = [new Array(4294967295)]; if (kind === 'outer-extra') Object.defineProperty(matrix, 'extra', { value: 1 }); if (kind === 'row-symbol') Object.defineProperty((matrix as unknown[][])[0], Symbol('隐藏字段'), { value: 1 });
    expect(() => f.editor.appendRows(matrix as Parameters<SqliteTableEditor['appendRows']>[0])).toThrow(); unchanged(f, before);
  });

  it.each(['outer', 'row', 'kind', 'value', 'hidden-value'] as const)('拒绝%s访问器且从不调用getter', kind => {
    const f = fixture(), before = capture(f), getter = vi.fn(() => text('不能读取')), row: unknown[] = f.defaults(), matrix: unknown[] = [row];
    if (kind === 'outer') Object.defineProperty(matrix, '0', { enumerable: true, get: getter }); else if (kind === 'row') Object.defineProperty(row, '1', { enumerable: true, get: getter }); else { const cell: Record<string, unknown> = { kind: 'text' }; Object.defineProperty(cell, kind === 'kind' ? 'kind' : 'value', { enumerable: kind !== 'hidden-value', get: getter }); row[1] = cell; }
    expect(() => f.editor.appendRows(matrix as Parameters<SqliteTableEditor['appendRows']>[0])).toThrow(); expect(getter).not.toHaveBeenCalled(); unchanged(f, before);
  });

  it.each([null, '原始文本', ['非对象'], new Date(0), new (class { kind = 'text'; value = '原型实例'; })(), { kind: 'null', value: undefined }, { kind: 'text', value: 'a', extra: true }])('新值必须严格plain typed对象：%j', value => {
    const f = fixture(), before = capture(f); expect(() => f.editor.appendRows([[undefined, value as SqliteOriginalValue, undefined, undefined]])).toThrow(); unchanged(f, before);
  });

  it('冻结稠密数组/null原型plain值可复制，调用方随后修改不影响草稿', () => {
    const f = fixture(), cell = Object.assign(Object.create(null), { kind: 'text', value: '纯数据' }); const row = Object.freeze([undefined, cell, undefined, undefined]); f.editor.appendRows(Object.freeze([row])); cell.value = '已修改'; expect(f.editor.view.rows[1].values[1]).toEqual(text('纯数据')); expect(Object.getPrototypeOf(f.editor.view.rows[1].values[1])).toBe(Object.prototype);
  });

  it.each(['empty', 'existing', 'batch', 'throws'] as const)('ID%s失败整组不发布、不释放原preview，也没有部分新行', async kind => {
    const f = fixture(); await f.ready(); const before = capture(f); if (kind === 'empty') f.id.mockReturnValue(''); if (kind === 'existing') f.id.mockReturnValue('original-0'); if (kind === 'batch') f.id.mockReturnValue('同一新ID'); if (kind === 'throws') f.id.mockImplementationOnce(() => '第一新ID').mockImplementationOnce(() => { throw Error('ID生成失败'); }); expect(() => f.editor.appendRows([f.defaults(), f.defaults()])).toThrow(); unchanged(f, before, false); expect(f.editor.view.rows).toHaveLength(1);
  });

  it('已有待删除原行也保留ID命名空间，追加不得复用', () => {
    const f = fixture(); f.editor.remove('original-0'); const before = capture(f); f.id.mockReturnValue('original-0'); expect(() => f.editor.appendRows([f.defaults()])).toThrow(); unchanged(f, before, false);
  });

  it('500条修改预算包含已有update；恰500成功，再追加失败不消耗ID', () => {
    const f = fixture(); f.saved(1, text('既有修改')); f.editor.appendRows(Array.from({ length: 499 }, f.defaults)); expect(f.editor.changes).toHaveLength(500); const before = capture(f); expect(() => f.editor.appendRows([f.defaults()])).toThrow(); unchanged(f, before);
  });

  it('10000实际字段包含已有脏修改，DEFAULT不计字段，恰边界成功再多一格原样拒绝', () => {
    const f = fixture(page(100, new Set())); const original = [...f.editor.view.rows[0].values]; for (let index = 0; index < 50; index++) original[index] = nullValue(); f.editor.save('original-0', original);
    const rows: (SqliteOriginalValue | undefined)[][] = Array.from({ length: 99 }, () => Array.from({ length: 100 }, nullValue)); rows.push(Array.from({ length: 100 }, (_, index) => index < 50 ? nullValue() : undefined)); f.editor.appendRows(rows); expect(f.editor.changes.reduce((count, change) => count + (change.kind === 'delete' ? 0 : change.values.length), 0)).toBe(10000);
    const before = capture(f), extra = f.defaults(); extra[0] = nullValue(); expect(() => f.editor.appendRows([extra])).toThrow(); unchanged(f, before);
  });

  it('2MiB文本单位预算与原脏修改统一，正好边界可追加DEFAULT却不能再多字段名', () => {
    const f = fixture(page(1, new Set())), width = sqliteTableEditLimits.valueUnits; f.saved(0, text('a'.repeat(width))); const rows = Array.from({ length: 31 }, (_, index) => [text('b'.repeat(index === 30 ? width - 64 : width))]); f.editor.appendRows(rows); expect(f.editor.changes.reduce((units, change) => units + (change.kind === 'delete' ? 0 : change.values.reduce((sum, field) => sum + field.column.length + ('value' in field.value ? field.value.value.length : 0), 0)), 0)).toBe(sqliteTableEditLimits.inputUnits);
    f.editor.appendRows([[undefined]]); const before = capture(f); expect(() => f.editor.appendRows([[text('')]])).toThrow(); unchanged(f, before);
  });

  it('512000个完整生成/DEFAULT槽有界允许，只计算500条insert而不是512000个写字段', () => {
    const f = fixture(page(1024, new Set(Array.from({ length: 1023 }, (_, index) => index + 1)), 0)), row = f.defaults(), ids = f.editor.appendRows(Array.from({ length: 500 }, () => row)); expect(ids).toHaveLength(500); expect(new Set(ids).size).toBe(500); expect(f.editor.changes).toHaveLength(500); expect(f.editor.changes.every(change => change.kind === 'insert' && change.values.length === 0)).toBe(true); expect(f.editor.view.rows[0].values).toHaveLength(1024);
  });

  it.each(['inactive', 'unavailable', 'expired', 'source', 'disposed'] as const)('不具资格%s时不能追加或发送请求', state => {
    const f = fixture(), rows = f.editor.view.rows; if (state === 'inactive') f.active(false); if (state === 'unavailable') f.available(false); if (state === 'expired') f.now(1800000); if (state === 'source') f.current(false); if (state === 'disposed') f.editor.dispose(); const before = f.id.mock.calls.length; expect(() => f.editor.appendRows([f.defaults()])).toThrow(); expect(f.editor.view.rows).toBe(rows); expect(f.id).toHaveBeenCalledTimes(before); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it('原unknown结算锁定后不能追加或重放，保留已存在草稿', async () => {
    const f = fixture(); await f.ready(); f.apply.mockResolvedValue({ operationId: 'operation', target: f.source.target, outcome: 'unknown', counts: { insert: 0, update: 1, delete: 0 }, fact: { operationId: 'operation', target: f.source.target, phase: 'unknown', requestedRows: 1, appliedRows: 0, commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: false }, message: '未知' }); await f.editor.apply(); const rows = f.editor.view.rows, calls = f.id.mock.calls.length; expect(f.editor.view.unknown).toBe(true); expect(() => f.editor.appendRows([f.defaults()])).toThrow(); expect(f.editor.view.rows).toBe(rows); expect(f.id).toHaveBeenCalledTimes(calls); expect(f.apply).toHaveBeenCalledOnce();
  });

  it('真实preview Promise未结算时busy禁止追加，不能抢原租约或另发预览', async () => {
    const f = fixture(); f.saved(1, text('原修改')); let resolve!: (value: SqliteTableEditPreview) => void; const pending = new Promise<SqliteTableEditPreview>(yes => { resolve = yes; }); f.preview.mockImplementationOnce(() => pending); const work = f.editor.preview(), before = capture(f); expect(f.editor.busy).toBe(true); expect(() => f.editor.appendRows([f.defaults()])).toThrow(); unchanged(f, before); expect(f.preview).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); resolve(f.previewResult); await work; expect(f.editor.busy).toBe(false);
  });

  it('超过1024页字段的异常来源不允许先分配矩阵或ID', () => {
    const f = fixture(page(1025, new Set())), before = capture(f); expect(() => f.editor.appendRows([f.defaults()])).toThrow(); unchanged(f, before);
  });
});
