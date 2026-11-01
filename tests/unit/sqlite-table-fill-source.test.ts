import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../../src/shared/sqliteTableEdit';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteFill, sqliteFillSourceCurrent, sqliteFillSourceLimits } from '../../src/renderer/sqliteTableFill';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';

/** 合成全typed原页保原动态类型；helper不实例化editor或接触IPC。 */
function fixture(count = 3, width = 6) {
  const columns = Array.from({ length: width }, (_, index) => ({ name: 'c' + index, declaredType: '', generated: width === 6 && index === 5 }));
  const values: SqliteOriginalValue[][] = Array.from({ length: count }, () => columns.map((_, index): SqliteOriginalValue => index === 0 ? { kind: 'integer', value: '9223372036854775807' } : index === 1 ? { kind: 'blob', value: '00ff' } : index === 2 ? { kind: 'null' } : index === 3 ? { kind: 'real', value: 'Infinity' } : { kind: 'text', value: '原\0🚢' }));
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 1000, hasMore: false, result: { columns: [], rows: values.map(() => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 1800000).toISOString(), columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: true })), rows: values, locator: { kind: 'rowid', columns: [] } } };
  const rows: SqliteDraftRow[] = values.map((values, index) => ({ id: 'original-' + index, index, deleted: false, values: structuredClone(values) }));
  return { page, rows, source: () => prepareSqliteFill(page, rows, rows) };
}

describe('SQLite多字段填充来源能力', () => {
  it('按源展示顺序冻结selected及可写列index，不冻结或修改真实页/行/values', () => {
    const f = fixture(), source = prepareSqliteFill(f.page, f.rows, [f.rows[2], f.rows[0]]);
    expect(source.selected).toEqual([f.rows[0], f.rows[2]]); expect(source.selected[0]).toBe(f.rows[0]); expect(source.rows).toBe(f.rows); expect(source.page).toBe(f.page); expect(source.columns).toEqual([0, 1, 2, 3, 4]); expect(source.allNew).toBe(false); expect(Object.isFrozen(source)).toBe(true); expect(Object.isFrozen(source.selected)).toBe(true); expect(Object.isFrozen(source.columns)).toBe(true); expect(Object.isFrozen(f.rows)).toBe(false); expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(true); expect(sqliteFillSourceCurrent({ ...source }, f.page, f.rows)).toBe(false);
  });
  it('全新增才allNew，原DEFAULT槽／大原文／非有限REAL不改成NULL或有限新值', () => {
    const f = fixture(); const added: SqliteDraftRow = { id: 'new', deleted: false, values: f.rows[0].values.map(() => undefined) }; f.rows.push(added); const only = prepareSqliteFill(f.page, f.rows, [added]); expect(only.allNew).toBe(true); expect(prepareSqliteFill(f.page, f.rows, [added, f.rows[0]]).allNew).toBe(false);
    f.rows[0].values[4] = { kind: 'text', value: 'x'.repeat(65537) }; const source = f.source(); expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(true); expect(f.rows[0].values[3]).toEqual({ kind: 'real', value: 'Infinity' }); expect(added.values).toEqual(Array(6).fill(undefined));
  });
  it('超过10000个来源格的宽页仍可用于稀疏填充，单值门与原driver一致', () => {
    const f = fixture(12, 1024), source = f.source(); expect(source.columns).toHaveLength(1024); expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(true); expect(sqliteFillSourceLimits.valueBytes).toBe(sqliteDriverLimits.valueBytes);
  });
  it.each(['page', 'rows', 'row', 'values', 'row-id', 'deleted', 'value', 'metadata', 'snapshot', 'baseline-cell', 'baseline-row', 'baseline-array'] as const)('%s变化观察后留下墓碑，同名／同值恢复也不复活', change => {
    const f = fixture(), source = f.source(), originalRows = [...f.rows], originalValues = f.rows[0].values, originalCell = f.rows[0].values[4], edit = f.page.edit; if (edit?.kind !== 'editable') throw Error('缺少编辑原页'); const baseline = edit.rows, baselineRow = baseline[0], baselineCell = baselineRow[4];
    let page = f.page, rows = f.rows;
    if (change === 'page') page = { ...page }; if (change === 'rows') rows = [...rows]; if (change === 'row') f.rows[0] = { ...f.rows[0] }; if (change === 'values') f.rows[0].values = [...originalValues]; if (change === 'row-id') f.rows[0].id = 'later'; if (change === 'deleted') f.rows[0].deleted = true; if (change === 'value') f.rows[0].values[4] = { kind: 'text', value: '后来值' }; if (change === 'metadata') f.page.columns[0].name = 'later'; if (change === 'snapshot') edit.snapshotId = 'later'; if (change === 'baseline-cell') baseline[0][4] = { kind: 'text', value: '后来基线' }; if (change === 'baseline-row') baseline[0] = [...baselineRow]; if (change === 'baseline-array') edit.rows = [...baseline];
    expect(sqliteFillSourceCurrent(source, page, rows)).toBe(false);
    f.rows.splice(0, f.rows.length, ...originalRows); f.rows[0].values = originalValues; f.rows[0].id = 'original-0'; f.rows[0].deleted = false; f.rows[0].values[4] = originalCell; f.page.columns[0].name = 'c0'; edit.snapshotId = 'snapshot'; edit.rows = baseline; baseline[0] = baselineRow; baselineRow[4] = baselineCell;
    expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(false); expect(sqliteFillSourceCurrent(f.source(), f.page, f.rows)).toBe(true);
  });
  it('未选行的typed原位变化也撤销完整原页来源，原属性顺序变化但等值可保持', () => {
    const f = fixture(), source = prepareSqliteFill(f.page, f.rows, [f.rows[0]]); f.rows[2].values[4] = { value: '原\0🚢', kind: 'text' }; expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(true); f.rows[2].values[4] = { kind: 'text', value: '后来未选值' }; expect(sqliteFillSourceCurrent(source, f.page, f.rows)).toBe(false);
  });
  it.each(['empty', 'duplicate', 'foreign', 'deleted', 'sparse', 'getter', 'huge'] as const)('非法%s选择不签发能力，getter不执行', kind => {
    const f = fixture(), getter = vi.fn(() => f.rows[0]); let selected: unknown = [f.rows[0]];
    if (kind === 'empty') selected = []; if (kind === 'duplicate') selected = [f.rows[0], f.rows[0]]; if (kind === 'foreign') selected = [{ ...f.rows[0] }]; if (kind === 'deleted') f.rows[0].deleted = true; if (kind === 'sparse') selected = new Array(1); if (kind === 'getter') Object.defineProperty(selected, '0', { enumerable: true, get: getter }); if (kind === 'huge') selected = new Array(4294967295);
    expect(() => prepareSqliteFill(f.page, f.rows, selected as SqliteDraftRow[])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['cell-getter', 'row-getter', 'baseline-getter', 'sparse-values', 'hidden-field', 'readonly'] as const)('%s来源无资格且不执行getter', kind => {
    const f = fixture(), getter = vi.fn(() => '原');
    if (kind === 'cell-getter') Object.defineProperty(f.rows[0].values[4], 'value', { enumerable: true, get: getter }); if (kind === 'row-getter') Object.defineProperty(f.rows[0], 'values', { enumerable: true, get: getter }); if (kind === 'baseline-getter' && f.page.edit?.kind === 'editable') Object.defineProperty(f.page.edit.rows[0][4], 'value', { enumerable: true, get: getter }); if (kind === 'sparse-values') delete f.rows[0].values[4]; if (kind === 'hidden-field') Object.defineProperty(f.rows[0].values[4], 'extra', { value: true }); if (kind === 'readonly') f.page.edit = { kind: 'readonly', reason: '只读' };
    expect(f.source).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('单原TEXT按UTF8 1MiB与原BLOB字节转hex两倍界定，超量先拒', () => {
    const f = fixture(1, 1); f.rows[0].values[0] = { kind: 'text', value: 'x'.repeat(sqliteFillSourceLimits.valueBytes) }; expect(sqliteFillSourceCurrent(f.source(), f.page, f.rows)).toBe(true); f.rows[0].values[0] = { kind: 'blob', value: 'ab'.repeat(sqliteFillSourceLimits.valueBytes) }; expect(sqliteFillSourceCurrent(f.source(), f.page, f.rows)).toBe(true); f.rows[0].values[0] = { kind: 'text', value: '汉'.repeat(400000) }; expect(f.source).toThrow();
  });
  it('总来源64MiB有界；不深复制反复引用的大原文，也不把额外原基线遗漏', () => {
    const f = fixture(65, 1), value: SqliteOriginalValue = { kind: 'text', value: 'x'.repeat(sqliteFillSourceLimits.valueBytes) }; for (const row of f.rows) row.values[0] = value; expect(f.source).toThrow();
  });
});
