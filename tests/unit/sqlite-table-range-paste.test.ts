import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteRangePaste, sqliteRangePastePlanValues, sqliteRangePastePreview, type SqlitePasteAnchor } from '../../src/renderer/sqliteTableRangePaste';
import { sqliteTableRangePasteZh as text } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';
import { type SqliteClipboardCell } from '../../src/renderer/sqliteTableClipboard';

const cell = (value: string): SqliteClipboardCell => ({ kind: 'text', value });
/** 合成原页与准确草稿对象，只测试本地预检能力，不冒称数据库写入或系统剪贴板验收。 */
function fixture(count = 3, names = ['id', 'note', 'other', 'generated']) {
  const values = Array.from({ length: count }, (_, row) => names.map((name): SqliteClipboardCell => name === 'id' ? { kind: 'integer', value: String(row + 1) } : cell(name + '-' + row)));
  const page: SqliteTablePage = { schemaKey: 'owned-schema', target: { connectionId: 'owned', database: 'main', table: 'subject', kind: 'table' }, columns: names.map(name => ({ name, declaredType: 'TEXT', generated: name === 'generated' })), result: { columns: [], rows: values.map(() => ({})), truncated: false, elapsedMs: 0, statement: '' }, offset: 100, limit: 100, hasMore: false, edit: { kind: 'editable', snapshotId: 'owned-snapshot', expiresAt: '2030-01-01T00:00:00Z', columns: names.map(name => ({ name, declaredType: 'TEXT', generated: name === 'generated', nullable: true, hasDefault: false })), rows: structuredClone(values) as any, locator: { kind: 'rowid', columns: [] } } };
  const rows: SqliteDraftRow[] = values.map((values, index) => ({ id: 'row-' + index, index, values, deleted: false }));
  return { page, rows, anchor: { row: rows[0], column: 1 } satisfies SqlitePasteAnchor };
}

describe('SQLite区域粘贴按位置完整预检', () => {
  it('隐藏中间列和反向重排沿可见顺序，预览仍指向原字段，不改变原行数组', () => {
    const f = fixture(), anchor = { row: f.rows[0], column: 2, columns: Object.freeze([2, 0, 1]) }, input = [[cell('新other'), { kind: 'integer', value: '99' } as SqliteClipboardCell]], before = structuredClone(f.rows);
    const plan = prepareSqliteRangePaste(f.page, f.rows, anchor, input); expect(plan.columns).toEqual(['other', 'id']); expect(plan).toMatchObject({ startColumn: 1, endColumn: 2 });
    const preview = sqliteRangePastePreview(plan, f.page, f.rows, anchor); expect(preview.rows[0].cells.map(cell => cell.oldValue)).toEqual([f.rows[0].values[2], f.rows[0].values[0]]); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, anchor)).toEqual(input); expect(f.rows).toEqual(before);
    expect(() => sqliteRangePastePlanValues(plan, f.page, f.rows, { ...anchor, columns: Object.freeze([2, 0, 1]) })).toThrow(text.stale);
  });
  it('映射重复/越界/缺起点/访问器拒绝，生成列与剩余可见宽度保护保持', () => {
    const f = fixture(); for (const columns of [[1, 1], [1, 99], [0, 2], []]) expect(() => prepareSqliteRangePaste(f.page, f.rows, { ...f.anchor, columns }, [[cell('x')]])).toThrow();
    expect(() => prepareSqliteRangePaste(f.page, f.rows, { ...f.anchor, columns: [1, 3] }, [[cell('x'), cell('y')]])).toThrow(text.generated);
    expect(() => prepareSqliteRangePaste(f.page, f.rows, { ...f.anchor, columns: [1] }, [[cell('x'), cell('y')]])).toThrow(text.outOfBounds);
    const getter = vi.fn(() => 1), columns = [1]; Object.defineProperty(columns, '0', { enumerable: true, get: getter }); expect(() => prepareSqliteRangePaste(f.page, f.rows, { ...f.anchor, columns }, [[cell('x')]])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('准确起点覆盖矩形，仅签发区域矩阵；目标列及当前页行列范围明确，不重排来源', () => {
    const f = fixture(), input = [[cell('a'), cell('b')], [cell('c'), { kind: 'null' } as SqliteClipboardCell]], original = structuredClone(f.rows), plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, input);
    expect(plan).toEqual({ rows: 2, width: 2, changedCells: 4, startRow: 1, endRow: 2, startColumn: 2, endColumn: 3, columns: ['note', 'other'] }); expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.columns)).toBe(true); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor)).toEqual(input); expect(f.rows).toEqual(original);
  });
  it('值相同仍可展示零变化计划，old/new预览准确且不消费或泄漏内部可变值', () => {
    const f = fixture(), input = [[cell('note-0')]], plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, input); expect(plan.changedCells).toBe(0);
    const preview = sqliteRangePastePreview(plan, f.page, f.rows, f.anchor); expect(preview).toEqual({ columns: ['note'], rows: [{ row: 1, cells: [{ column: 'note', oldValue: cell('note-0'), newValue: cell('note-0'), changed: false }] }] }); preview.rows[0].cells[0].newValue = cell('伪改'); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor)).toEqual(input);
  });
  it('预览最多10行但计划及取值保留完整批次', () => {
    const f = fixture(12), input = Array.from({ length: 12 }, (_, index) => [cell('new-' + index)]), plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, input); expect(sqliteRangePastePreview(plan, f.page, f.rows, f.anchor).rows).toHaveLength(10); expect(plan.rows).toBe(12); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor)[11]).toEqual(input[11]);
  });
  it('plain字符串不猜数字NULL，逐来源列类型转换仍复用原SQLite有限/精确门', () => {
    const f = fixture(), values = [[cell('001'), cell('NULL')]], plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, values); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor)).toEqual(values);
    const typed = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('9223372036854775807'), cell('0x00ff')]], ['integer', 'blob']); expect(sqliteRangePastePlanValues(typed, f.page, f.rows, f.anchor)).toEqual([[{ kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }]]);
    expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ kind: 'integer', value: '9007199254740993' }]], ['real'])).toThrow(); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ kind: 'real', value: 'Infinity' }]])).toThrow();
    expect(sqliteRangePastePlanValues(prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ kind: 'real', value: 'Infinity' }]], ['text']), f.page, f.rows, f.anchor)).toEqual([[cell('Infinity')]]);
  });
  it('已有行不能接收源DEFAULT或default转换；本地新增草稿允许省略且不混成NULL', () => {
    const f = fixture(); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[undefined]])).toThrow(text.defaultExisting); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')]], ['default'])).toThrow(text.defaultExisting);
    const inserted: SqliteDraftRow = { id: 'inserted', values: f.page.columns.map(() => undefined), deleted: false }, rows = [...f.rows, inserted], anchor = { row: inserted, column: 1 }, plan = prepareSqliteRangePaste(f.page, rows, anchor, [[undefined, { kind: 'null' }]]); expect(sqliteRangePastePlanValues(plan, f.page, rows, anchor)).toEqual([[undefined, { kind: 'null' }]]);
    expect(sqliteRangePastePlanValues(prepareSqliteRangePaste(f.page, rows, anchor, [[cell('clear')]], ['default']), f.page, rows, anchor)).toEqual([[undefined]]);
  });
  it('混合已有/新增矩形触及任何已有DEFAULT均整组拒绝；失败不改任何原行', () => {
    const f = fixture(1), inserted: SqliteDraftRow = { id: 'inserted', values: f.page.columns.map(() => undefined), deleted: false }, rows = [...f.rows, inserted], original = structuredClone(rows); expect(() => prepareSqliteRangePaste(f.page, rows, f.anchor, [[undefined], [cell('new')]])).toThrow(text.defaultExisting); expect(rows).toEqual(original);
  });
  it('越界、待删除行或生成列即整组拒绝，不跳行跳列、不自动扩展新记录', () => {
    const f = fixture(2), original = structuredClone(f.rows); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('a')], [cell('b')], [cell('c')]])).toThrow(text.outOfBounds); expect(() => prepareSqliteRangePaste(f.page, f.rows, { row: f.rows[0], column: 3 }, [[cell('a'), cell('b')]])).toThrow(text.outOfBounds);
    expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('a'), cell('b'), cell('c')]])).toThrow(text.generated); f.rows[1].deleted = true; expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('a')], [cell('b')]])).toThrow(text.deleted); expect(f.rows[0]).toEqual(original[0]);
  });
  it('只读、错误起点、同id另一row对象、NaN/负列及映射类型错误都不能签发', () => {
    const f = fixture(); for (const anchor of [{ row: { ...f.rows[0] }, column: 1 }, { row: f.rows[0], column: -1 }, { row: f.rows[0], column: NaN }, { row: f.rows[0], column: 1.5 }]) expect(() => prepareSqliteRangePaste(f.page, f.rows, anchor, [[cell('x')]])).toThrow(text.anchorRequired);
    expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')]], [])).toThrow(text.kindsInvalid); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')]], ['SQL' as any])).toThrow(text.kindsInvalid); f.page.edit = { kind: 'readonly', reason: '只读' }; expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')]])).toThrow(text.readonly);
  });
});

describe('SQLite区域粘贴原页计划不能迟到接管', () => {
  it('输入/取值均独立复制；原page、原rows数组、准确anchor pair及真实plan都不可替代', () => {
    const f = fixture(), input = [[cell('new')]], plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, input); input[0][0] = cell('后来改'); const values = sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor); values[0][0] = cell('伪改'); expect(sqliteRangePastePlanValues(plan, f.page, f.rows, { row: f.anchor.row, column: f.anchor.column })).toEqual([[cell('new')]]);
    expect(() => sqliteRangePastePlanValues({ ...plan }, f.page, f.rows, f.anchor)).toThrow(text.stale); expect(() => sqliteRangePastePlanValues(plan, structuredClone(f.page), f.rows, f.anchor)).toThrow(text.stale); expect(() => sqliteRangePastePlanValues(plan, f.page, [...f.rows], f.anchor)).toThrow(text.stale); expect(() => sqliteRangePastePlanValues(plan, f.page, f.rows, { row: f.rows[0], column: 0 })).toThrow(text.stale);
  });
  it.each(['schema', 'target', 'snapshot', 'columns', 'locator', 'deleted', 'index', 'id', 'row', 'values', 'cell'] as const)('原%s变化使Values和Preview同时失效，即使对象引用仍在', change => {
    const f = fixture(), plan = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('new')]]); const edit = f.page.edit; if (edit?.kind !== 'editable') throw Error('夹具无效');
    switch (change) { case 'schema': f.page.schemaKey = 'changed'; break; case 'target': f.page.target.table = 'changed'; break; case 'snapshot': edit.snapshotId = 'changed'; break; case 'columns': edit.columns[1].declaredType = 'BLOB'; break; case 'locator': edit.locator.columns.push('id'); break; case 'deleted': f.rows[0].deleted = true; break; case 'index': f.rows[0].index = undefined; break; case 'id': f.rows[0].id = 'changed'; break; case 'row': f.rows[1] = { ...f.rows[1] }; break; case 'values': f.rows[0].values = [...f.rows[0].values]; break; case 'cell': f.rows[0].values[1] = cell('外部改'); break; }
    expect(() => sqliteRangePastePlanValues(plan, f.page, f.rows, f.anchor)).toThrow(text.stale); expect(() => sqliteRangePastePreview(plan, f.page, f.rows, f.anchor)).toThrow(text.stale);
  });
});

describe('SQLite区域粘贴完整预算与纯数据输入', () => {
  it('500行、10000格、65536单格、2MiB及有效Unicode在任何本地写入前严格限制', () => {
    const f = fixture(501, ['value']); expect(() => prepareSqliteRangePaste(f.page, f.rows, { row: f.rows[0], column: 0 }, Array.from({ length: 501 }, () => [cell('x')]))).toThrow(text.rowLimit);
    const area = fixture(500, Array.from({ length: 21 }, (_, index) => 'c' + index)); expect(() => prepareSqliteRangePaste(area.page, area.rows, { row: area.rows[0], column: 0 }, Array.from({ length: 500 }, () => Array(21).fill(cell('x'))))).toThrow();
    for (const value of ['x'.repeat(65537), '\ud800']) expect(() => prepareSqliteRangePaste(f.page, f.rows, { row: f.rows[0], column: 0 }, [[cell(value)]])).toThrow();
    const large = Array.from({ length: 40 }, () => [cell('x'.repeat(65536))]); expect(() => prepareSqliteRangePaste(f.page, f.rows, { row: f.rows[0], column: 0 }, large)).toThrow();
  });
  it('getter、稀疏或非矩形来源、不完整kinds不能被NULL/default转换掩盖', () => {
    const f = fixture(), getter = vi.fn(() => 'private'), raw = { kind: 'text' }; Object.defineProperty(raw, 'value', { enumerable: true, get: getter }); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[raw as any]], ['null'])).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [Array(1)])).toThrow(); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')], [cell('x'), cell('y')]])).toThrow();
    const kinds = ['text']; Object.defineProperty(kinds, '0', { enumerable: true, get: getter }); expect(() => prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[cell('x')]], kinds as any)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

it('typed属性逆序不产生虚假变化，恢复原内容的计划及前十行预览一致显示noop', () => {
  const f = fixture(), original = { value: 'same', kind: 'text' as const }; f.rows[0].values[1] = original;
  const same = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ kind: 'text', value: 'same' }]]); expect(same.changedCells).toBe(0); expect(sqliteRangePastePreview(same, f.page, f.rows, f.anchor).rows[0].cells[0]).toEqual({ column: 'note', oldValue: original, newValue: { kind: 'text', value: 'same' }, changed: false });
  const changed = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ value: 'new', kind: 'text' }]]); expect(changed.changedCells).toBe(1); expect(sqliteRangePastePreview(changed, f.page, f.rows, f.anchor).rows[0].cells[0].changed).toBe(true);
  const restored = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ value: 'same', kind: 'text' }]]); expect(restored.changedCells).toBe(0); expect(sqliteRangePastePreview(restored, f.page, f.rows, f.anchor).rows[0].cells[0].changed).toBe(false); expect(f.rows[0].values[1]).toBe(original);
  // 同一值数组内换为属性顺序不同但内容相同的对象，不伪造新写入；内容真正变化仍拒旧计划。
  f.rows[0].values[1] = { kind: 'text', value: 'same' }; expect(sqliteRangePastePlanValues(same, f.page, f.rows, f.anchor)).toEqual([[{ kind: 'text', value: 'same' }]]); f.rows[0].values[1] = { kind: 'text', value: 'changed' }; expect(() => sqliteRangePastePlanValues(same, f.page, f.rows, f.anchor)).toThrow(text.stale);
});
it('规范化签名保持NULL/DEFAULT区分及真实typed内容，原非有限REAL仍可预览', () => {
  const f = fixture(), inserted: SqliteDraftRow = { id: 'inserted-signature', values: f.page.columns.map(() => undefined), deleted: false }, rows = [...f.rows, inserted], anchor = { row: inserted, column: 1 };
  const toNull = prepareSqliteRangePaste(f.page, rows, anchor, [[{ kind: 'null' }]]); expect(toNull.changedCells).toBe(1); expect(sqliteRangePastePreview(toNull, f.page, rows, anchor).rows[0].cells[0]).toMatchObject({ oldValue: undefined, newValue: { kind: 'null' }, changed: true });
  f.rows[0].values[1] = { value: 'Infinity', kind: 'real' }; const finite = prepareSqliteRangePaste(f.page, f.rows, f.anchor, [[{ kind: 'real', value: '1' }]]); expect(finite.changedCells).toBe(1); expect(sqliteRangePastePreview(finite, f.page, f.rows, f.anchor).rows[0].cells[0].oldValue).toEqual({ kind: 'real', value: 'Infinity' });
});
