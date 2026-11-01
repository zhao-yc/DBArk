import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteTableEditLimits, type SqliteOriginalValue, type SqliteTableEditOutcome, type SqliteTableEditPreview } from '../../src/shared/sqliteTableEdit';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';

const text = (value: string): SqliteOriginalValue => ({ kind: 'text', value }), nil = (): SqliteOriginalValue => ({ kind: 'null' });
/** 原页包含真实可显示的非有限值/生成值；矩形外的这些原对象不应被新输入schema重写。 */
function page(count = 3, width = 5, generated = new Set([3]), nonfinite = new Set([4])): SqliteTablePage {
  const columns = Array.from({ length: width }, (_, index) => ({ name: 'c' + index, declaredType: '', generated: generated.has(index) })), rows = Array.from({ length: count }, (_, row) => columns.map((column, index): SqliteOriginalValue => nonfinite.has(index) ? { kind: 'real', value: 'Infinity' } : column.generated ? text('生成' + row) : index === 0 ? { kind: 'integer', value: String(row + 1) } : text('原' + row + ':' + index)));
  return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '矩形草稿', kind: 'table' }, columns, offset: 0, limit: 1000, hasMore: false, result: { columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })), rows: rows.map(() => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot-original', expiresAt: new Date(1800000).toISOString(), columns: columns.map(column => ({ ...column, nullable: true, hasDefault: true })), rows, locator: { kind: 'rowid', columns: [] } } };
}
function fixture(source = page()) {
  let current = true, active = true, available = true, now = 0, serial = 0;
  const previewResult: SqliteTableEditPreview = { previewId: 'preview-original', snapshotId: 'snapshot-original', target: source.target, schemaKey: source.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.矩形草稿', sql: ['原SQL预览'], counts: { insert: 0, update: 1, delete: 0 } }, id = vi.fn(() => 'draft-' + ++serial), release = vi.fn(async (_value: { snapshotId?: string; previewId?: string }) => {}), preview = vi.fn(async (_value: unknown) => previewResult), apply = vi.fn(async (_value: unknown): Promise<SqliteTableEditOutcome> => { throw Error('矩形暂存不得写入DB'); }), changed = vi.fn(), dirty = vi.fn();
  const editor = new SqliteTableEditor(source, { current: () => current, active: () => active, available: () => available, now: () => now, id, acquire: () => ({ owns: () => true, release: () => true }), release, preview, apply, changed, dirty, cancel: async () => {}, committed: () => {} });
  const save = (row: number, column: number, value: SqliteOriginalValue) => { const values = [...editor.view.rows[row].values]; values[column] = value; editor.save(editor.view.rows[row].id, values); };
  const ready = async () => { save(0, 1, text('已修改')); await editor.preview(); expect(editor.view.preview).toBe(previewResult); };
  return { editor, source, id, release, preview, apply, changed, dirty, previewResult, save, ready, active: (value: boolean) => { active = value; }, available: (value: boolean) => { available = value; }, current: (value: boolean) => { current = value; editor.observe(); }, expire: () => { now = 1800000; editor.observe(); } };
}
/** 只读检查真实账本引用和副作用次数，断言拒绝/noop不触发半批发布或释放。 */
function capture(f: ReturnType<typeof fixture>) { const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }; return { rows: f.editor.view.rows, past: inner.past, pastLength: inner.past.length, future: inner.future, futureLength: inner.future.length, input: inner.input, preview: f.editor.view.preview, message: f.editor.view.message, changes: structuredClone(f.editor.changes), ids: f.id.mock.calls.length, releases: f.release.mock.calls.length, previews: f.preview.mock.calls.length, applies: f.apply.mock.calls.length, changed: f.changed.mock.calls.length, dirty: f.dirty.mock.calls.length }; }
function unchanged(f: ReturnType<typeof fixture>, before: ReturnType<typeof capture>) { const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }; expect(f.editor.view.rows).toBe(before.rows); expect(inner.past).toBe(before.past); expect(inner.past).toHaveLength(before.pastLength); expect(inner.future).toBe(before.future); expect(inner.future).toHaveLength(before.futureLength); expect(inner.input).toBe(before.input); expect(f.editor.view.preview).toBe(before.preview); expect(f.editor.view.message).toBe(before.message); expect(f.editor.changes).toEqual(before.changes); expect(f.id).toHaveBeenCalledTimes(before.ids); expect(f.release).toHaveBeenCalledTimes(before.releases); expect(f.preview).toHaveBeenCalledTimes(before.previews); expect(f.apply).toHaveBeenCalledTimes(before.applies); expect(f.changed).toHaveBeenCalledTimes(before.changed); expect(f.dirty).toHaveBeenCalledTimes(before.dirty); }

describe('SQLite连续矩形粘贴只暂存已有本地格', () => {
  it('显示映射反向/跳过隐藏列仍只改原字段，整组一次暂存及撤销', () => {
    const f = fixture(), original = f.editor.view.rows;
    expect(f.editor.pasteCells('original-0', 2, [[text('other新值'), { kind: 'integer', value: '99' }]], [2, 0])).toBe(2);
    expect(f.editor.view.rows[0].values[2]).toEqual(text('other新值')); expect(f.editor.view.rows[0].values[0]).toEqual({ kind: 'integer', value: '99' }); expect(f.editor.view.rows[0].values[1]).toBe(original[0].values[1]); expect(f.editor.view.rows[0].values[3]).toBe(original[0].values[3]);
    expect(f.editor.changes).toEqual([{ kind: 'update', row: 0, values: [{ column: 'c0', value: { kind: 'integer', value: '99' } }, { column: 'c2', value: text('other新值') }] }]);
    f.editor.undo(); expect(f.editor.view.rows).toBe(original); expect(f.apply).not.toHaveBeenCalled();
  });
  it('映射重复、首格不符、越界、生成列及超宽整批拒绝，不丢原草稿', () => {
    const f = fixture(), original = f.editor.view.rows;
    for (const indices of [[2, 2], [1, 2], [2, 99], [2, 3]]) expect(() => f.editor.pasteCells('original-0', 2, [[text('x'), text('y')]], indices)).toThrow();
    expect(() => f.editor.pasteCells('original-0', 2, [[text('x'), text('y')]], [2])).toThrow(); expect(f.editor.view.rows).toBe(original); expect(f.changed).not.toHaveBeenCalled();
  });
  it('update与newrow连续混合，DEFAULT清新增值，未触及原对象/非有限/generated引用均保持', () => {
    const f = fixture(), added = f.editor.add()!, pending = [undefined, text('待清除'), undefined, undefined, undefined]; f.editor.save(added, pending); const original = f.editor.view.rows, before = f.id.mock.calls.length;
    expect(f.editor.pasteCells('original-2', 1, [[nil(), text('已替换')], [undefined, { kind: 'blob', value: '' }]])).toBe(4); const after = f.editor.view.rows; expect(after).not.toBe(original); expect(after[0]).toBe(original[0]); expect(after[1]).toBe(original[1]); expect(after[2]).not.toBe(original[2]); expect(after[3]).not.toBe(original[3]); expect(after[2].values[0]).toBe(original[2].values[0]); expect(after[2].values[3]).toBe(original[2].values[3]); expect(after[2].values[4]).toBe(original[2].values[4]); expect(after[2].values[4]).toEqual({ kind: 'real', value: 'Infinity' });
    expect(f.editor.changes).toEqual([{ kind: 'update', row: 2, values: [{ column: 'c1', value: { kind: 'null' } }, { column: 'c2', value: text('已替换') }] }, { kind: 'insert', values: [{ column: 'c2', value: { kind: 'blob', value: '' } }] }]); expect(f.id).toHaveBeenCalledTimes(before); expect(f.apply).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled();
    f.editor.undo(); expect(f.editor.view.rows).toBe(original); f.editor.redo(); expect(f.editor.view.rows).toBe(after);
  });

  it('只克隆实际changedrows，同行未变格/其它行保引用，调用方值随后修改不影响草稿', () => {
    const f = fixture(), original = f.editor.view.rows, cell = text('新值'), matrix = [[cell, original[0].values[2]], [original[1].values[1], original[1].values[2]]]; expect(f.editor.pasteCells('original-0', 1, matrix)).toBe(1); const after = f.editor.view.rows; expect(after[0]).not.toBe(original[0]); expect(after[0].values).not.toBe(original[0].values); expect(after[0].values[2]).toBe(original[0].values[2]); expect(after[1]).toBe(original[1]); expect(after[2]).toBe(original[2]); if ('value' in cell) cell.value = '外部修改'; expect(after[0].values[1]).toEqual(text('新值')); expect(f.id).not.toHaveBeenCalled();
  });

  it('无实际变化返回0，保原preview/input/redo及所有通知计数；属性顺序不制造修改', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(f.editor.pasteCells('original-0', 0, [[{ value: '1', kind: 'integer' }, text('已修改')]])).toBe(0); unchanged(f, before);
    const g = fixture(), added = g.editor.add()!, afterAdd = capture(g); expect(g.editor.pasteCells(added, 1, [[undefined]])).toBe(0); unchanged(g, afterAdd);
  });

  it('成功单次replace释放旧preview一次并清input，undo恢复完整原rows对象', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(f.editor.pasteCells('original-0', 1, [[text('新1'), text('新2')], [text('新3'), nil()]])).toBe(4); expect(f.release).toHaveBeenCalledTimes(before.releases + 1); expect(f.release).toHaveBeenLastCalledWith({ previewId: f.previewResult.previewId }); expect((f.editor as unknown as { input: boolean }).input).toBe(false); expect(f.editor.view.preview).toBeUndefined(); expect(f.changed).toHaveBeenCalledTimes(before.changed + 1); f.editor.undo(); expect(f.editor.view.rows).toBe(before.rows); expect(f.editor.changes).toEqual(before.changes); expect(f.id).toHaveBeenCalledTimes(before.ids);
  });

  it('粘回准确原值可消除最后一项修改，即使原preview schema要求至少一条也允许纯本地恢复', () => {
    const source = page(); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); source.edit.rows[0][1] = { value: '原值次序', kind: 'text' }; const f = fixture(source); f.save(0, 1, text('改变')); const before = f.editor.view.rows; expect(f.editor.pasteCells('original-0', 1, [[text('原值次序')]])).toBe(1); expect(f.editor.changes).toEqual([]); expect(f.editor.dirty).toBe(false); f.editor.undo(); expect(f.editor.view.rows).toBe(before); expect(f.editor.changes).toHaveLength(1); expect(f.id).not.toHaveBeenCalled();
  });

  it('NULL显式写入、DEFAULT仅清newrow，不新增行不折行也不自动跳过生成列', () => {
    const f = fixture(), id = f.editor.add()!, originalLength = f.editor.view.rows.length; expect(f.editor.pasteCells(id, 1, [[nil(), { kind: 'blob', value: '' }]])).toBe(2); expect(f.editor.pasteCells(id, 1, [[undefined, undefined]])).toBe(2); expect(f.editor.changes).toEqual([{ kind: 'insert', values: [] }]); expect(f.editor.view.rows).toHaveLength(originalLength);
    const before = capture(f); expect(() => f.editor.pasteCells('original-0', 1, [[undefined]])).toThrow(); unchanged(f, before); expect(() => f.editor.pasteCells(id, 3, [[undefined]])).toThrow(); unchanged(f, before);
  });

  it.each(['Infinity', '-Infinity', 'NaN', '1e999'])('任何新显式REAL %s都拒绝，即使等于原展示值', value => { const f = fixture(), before = capture(f); expect(() => f.editor.pasteCells('original-0', 4, [[{ kind: 'real', value }]])).toThrow(); unchanged(f, before); });

  it.each([-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', undefined])('非法列起点%j整组拒绝不变', column => { const f = fixture(), before = capture(f); expect(() => f.editor.pasteCells('original-0', column as number, [[text('新')]])).toThrow(); unchanged(f, before); });

  it.each(['', '不存在'])('原rowId %s不能猜测/回退到别行', rowId => { const f = fixture(), before = capture(f); expect(() => f.editor.pasteCells(rowId, 1, [[text('新')]])).toThrow(); unchanged(f, before); });

  it('任何目标deleted/跨generated/横向或纵向越界整组拒绝，不部分发布前面的合法格', () => {
    const f = fixture(); f.editor.remove('original-1'); const before = capture(f); for (const action of [() => f.editor.pasteCells('original-0', 1, [[text('前格')], [text('后格')]]), () => f.editor.pasteCells('original-0', 2, [[text('前格'), undefined]]), () => f.editor.pasteCells('original-0', 4, [[nil(), nil()]]), () => f.editor.pasteCells('original-2', 1, [[text('前格')], [text('补行')]])]) { expect(action).toThrow(); unchanged(f, before); }
  });

  it('重复id即使不是起点也拒绝歧义；不分配新ID或把第一条同名当准确来源', () => { const f = fixture(); f.id.mockReturnValue('original-1'); f.editor.add(); const before = capture(f); expect(() => f.editor.pasteCells('original-0', 1, [[text('新')]])).toThrow(); unchanged(f, before); });

  it.each(['empty', 'empty-row', 'ragged', 'outer-sparse', 'row-sparse', 'outer-getter', 'row-getter', 'cell-getter', 'extra-key', 'nonplain'] as const)('拒绝%s结构且getter从未被调用', kind => {
    const f = fixture(), before = capture(f), getter = vi.fn(() => text('不可读')); let matrix: unknown = [[text('新')]];
    if (kind === 'empty') matrix = []; if (kind === 'empty-row') matrix = [[]]; if (kind === 'ragged') matrix = [[text('前')], [text('后'), text('多列')]]; if (kind === 'outer-sparse') matrix = new Array(1); if (kind === 'row-sparse') matrix = [new Array(1)]; if (kind === 'outer-getter') Object.defineProperty(matrix, '0', { enumerable: true, get: getter }); if (kind === 'row-getter') Object.defineProperty((matrix as unknown[][])[0], '0', { enumerable: true, get: getter }); if (kind === 'cell-getter') { const cell = { kind: 'text' }; Object.defineProperty(cell, 'value', { enumerable: true, get: getter }); matrix = [[cell]]; } if (kind === 'extra-key') Object.defineProperty(matrix, 'extra', { value: 1 }); if (kind === 'nonplain') matrix = [[new (class { kind = 'text'; value = '原型值'; })()]];
    expect(() => f.editor.pasteCells('original-0', 1, matrix as Parameters<SqliteTableEditor['pasteCells']>[2])).toThrow(); expect(getter).not.toHaveBeenCalled(); unchanged(f, before);
  });

  it('整组最后一格非法时原rows/undo/redo/preview/input完全不变', async () => { const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(() => f.editor.pasteCells('original-0', 1, [[text('第一格'), nil()], [text('第三格'), { kind: 'integer', value: '9223372036854775808' }]])).toThrow(); unchanged(f, before); });

  it('逻辑矩形超过10000格或500行先拒绝，包括DEFAULT，绝不分配大矩阵或补行', () => {
    const f = fixture(page(501, 101, new Set(), new Set())), before = capture(f); expect(() => f.editor.pasteCells('original-0', 0, Array.from({ length: 100 }, () => Array.from({ length: 101 }, nil)))).toThrow(); unchanged(f, before); expect(() => f.editor.pasteCells('original-0', 0, Array.from({ length: 501 }, () => [nil()]))).toThrow(); unchanged(f, before); expect(() => f.editor.pasteCells('original-0', 0, new Array(4294967295))).toThrow(); unchanged(f, before);
  });

  it('真实post-patch changes可把501条旧修改减回500，不能按旧行数再累加误拒', () => {
    const f = fixture(page(501, 1, new Set(), new Set())); for (let index = 0; index < 501; index++) f.save(index, 0, text('修改' + index)); expect(f.editor.changes).toHaveLength(501); expect(f.editor.pasteCells('original-0', 0, [[{ kind: 'integer', value: '1' }]])).toBe(1); expect(f.editor.changes).toHaveLength(500); const before = capture(f); expect(() => f.editor.pasteCells('original-0', 0, [[text('新第501项')]])).toThrow(); unchanged(f, before);
  });

  it('10000字段按最终差异计算：新第10001字段拒绝，先还原旧字段后可再写新字段', () => {
    const f = fixture(page(101, 100, new Set(), new Set())); for (let row = 0; row < 100; row++) f.editor.save('original-' + row, Array.from({ length: 100 }, nil)); const before = capture(f); expect(() => f.editor.pasteCells('original-100', 0, [[nil()]])).toThrow(); unchanged(f, before);
    expect(f.editor.pasteCells('original-0', 0, [[{ kind: 'integer', value: '1' }]])).toBe(1); expect(f.editor.pasteCells('original-100', 0, [[nil()]])).toBe(1); expect(f.editor.changes.reduce((count, change) => count + (change.kind === 'delete' ? 0 : change.values.length), 0)).toBe(10000); expect(f.id).not.toHaveBeenCalled();
  });

  it('2MiB预算也是post-patch，清除旧大修改后允许新格；没有变更也不能绕输入总量', () => {
    const f = fixture(page(33, 1, new Set(), new Set())), size = sqliteTableEditLimits.valueUnits; for (let row = 0; row < 32; row++) f.save(row, 0, text('x'.repeat(row === 31 ? size - 64 : size))); const before = capture(f); expect(() => f.editor.pasteCells('original-32', 0, [[text('')]])).toThrow(); unchanged(f, before); expect(f.editor.pasteCells('original-0', 0, [[{ kind: 'integer', value: '1' }]])).toBe(1); expect(f.editor.pasteCells('original-32', 0, [[text('')]])).toBe(1);
    const source = page(32, 1, new Set(), new Set()); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); for (const row of source.edit.rows) row[0] = text('原'.repeat(size)); const g = fixture(source), stable = capture(g); expect(() => g.editor.pasteCells('original-0', 0, Array.from({ length: 32 }, () => [text('原'.repeat(size))]))).toThrow(); unchanged(g, stable);
  });

  it.each(['inactive', 'unavailable', 'expired', 'source-aba', 'disposed'] as const)('资格%s禁止矩形写入，保留草稿且无ID/IPC', state => {
    const f = fixture(); if (state === 'inactive') f.active(false); if (state === 'unavailable') f.available(false); if (state === 'expired') f.expire(); if (state === 'source-aba') { f.current(false); f.current(true); } if (state === 'disposed') f.editor.dispose(); const before = capture(f); expect(() => f.editor.pasteCells('original-0', 1, [[text('新')]])).toThrow(); unchanged(f, before);
  });

  it('真实pending preview busy以及unknown写入终态禁止粘贴或重放', async () => {
    const f = fixture(); f.save(0, 1, text('旧草稿')); let resolve!: (value: SqliteTableEditPreview) => void; f.preview.mockImplementationOnce(() => new Promise<SqliteTableEditPreview>(yes => { resolve = yes; })); const pending = f.editor.preview(), busy = capture(f); expect(f.editor.busy).toBe(true); expect(() => f.editor.pasteCells('original-0', 1, [[text('新')]])).toThrow(); unchanged(f, busy); resolve(f.previewResult); await pending;
    f.apply.mockResolvedValue({ operationId: 'op', target: f.source.target, outcome: 'unknown', counts: { insert: 0, update: 1, delete: 0 }, message: '未知', fact: { operationId: 'op', target: f.source.target, phase: 'unknown', requestedRows: 1, appliedRows: 0, commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: false } }); await f.editor.apply(); const unknown = capture(f); expect(f.editor.view.unknown).toBe(true); expect(() => f.editor.pasteCells('original-0', 1, [[text('新')]])).toThrow(); unchanged(f, unknown);
  });

  it('解析期间重入产生新rows时旧矩形不得覆盖后继编辑，不提交任何半批目标格', () => {
    const f = fixture(), original = f.editor.view.rows, value = new Proxy({ kind: 'text', value: '旧矩形输入' }, { ownKeys(target) { f.save(2, 1, text('后继编辑')); return Reflect.ownKeys(target); } }); expect(() => f.editor.pasteCells('original-0', 1, [[value as SqliteOriginalValue]])).toThrow(); expect(f.editor.view.rows[0]).toBe(original[0]); expect(f.editor.view.rows[0].values[1]).toEqual(text('原0:1')); expect(f.editor.view.rows[2].values[1]).toEqual(text('后继编辑')); expect(f.editor.changes).toEqual([{ kind: 'update', row: 2, values: [{ column: 'c1', value: text('后继编辑') }] }]); expect((f.editor as unknown as { past: unknown[] }).past).toHaveLength(1); expect(f.id).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
});
