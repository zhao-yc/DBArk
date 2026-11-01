import { expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteHeaderSortFromGrid, sqliteHeaderSortToGrid } from '../../src/renderer/sqliteTableHeaderSort';

/** 带引号、非BMP和cN同名字段仍只走准确本页映射，不拼接标识符。 */
function page(): SqliteTablePage {
  const names = ['id', '字段"船🚢', 'c0', 'nullable', 'g', '六', '七', '八', '九'];
  return { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), offset: 100, limit: 100, hasMore: true, columns: names.map(name => ({ name, declaredType: '' })), result: { columns: names.map((name, i) => ({ key: 'c' + i, name, type: 'SQLITE' })), rows: [{ c0: '9223372036854775807', c1: '原字节\0🚢', c2: { type: 'binary', base64: 'AP8=' }, c3: null }], statement: '', elapsedMs: 0, truncated: false } };
}
it('八列完整保序，方向往返且不转原BIGINT／BLOB／NULL', () => {
  const source = page(), before = structuredClone(source), raw = source.columns.slice(0, 8).map((_, i) => ({ columnKey: 'c' + i, direction: i % 2 ? 'DESC' as const : 'ASC' as const }));
  const sort = sqliteHeaderSortFromGrid(raw, source);
  expect(sort).toEqual(source.columns.slice(0, 8).map((c, i) => ({ column: c.name, direction: i % 2 ? 'desc' : 'asc' })));
  expect(sqliteHeaderSortToGrid(sort, source)).toEqual(raw); expect(source).toEqual(before);
  sort.reverse(); expect(sqliteHeaderSortToGrid(sort, source).map(rule => rule.columnKey)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1', 'c0']);
});
it('清空只产生空ORDER BY；表单列名不能直接当网格键', () => {
  expect(sqliteHeaderSortFromGrid([], page())).toEqual([]); expect(sqliteHeaderSortToGrid([], page())).toEqual([]);
  expect(() => sqliteHeaderSortFromGrid([{ columnKey: '字段"船🚢', direction: 'ASC' }], page())).toThrow();
});
it.each([null, {}, 'c0', [{ columnKey: 'c0', direction: 'asc' }], [{ columnKey: 'c0', direction: 'DROP' }], [{ columnKey: 'c00', direction: 'ASC' }], [{ columnKey: '__row', direction: 'ASC' }], [{ columnKey: '__select', direction: 'ASC' }], [{ columnKey: 'c9', direction: 'ASC' }], [{ columnKey: 'c0', direction: 'ASC', sql: 'ignored' }], [{ columnKey: 'c0', direction: 'ASC' }, { columnKey: 'c0', direction: 'DESC' }], Array.from({ length: 9 }, (_, i) => ({ columnKey: 'c' + i, direction: 'ASC' })), new Array(1)].map(raw => ({ raw })))('拒绝非法、重复、稀疏或超预算规则 $#', ({ raw }) => {
  const source = page(), before = structuredClone(source); expect(() => sqliteHeaderSortFromGrid(raw, source)).toThrow(); expect(source).toEqual(before);
});
it.each(['name', 'key', 'length', 'duplicate-name', 'duplicate-key'] as const)('错误或歧义列目录不投影 %s', change => {
  const source = page();
  if (change === 'name') source.result.columns[0].name = 'new';
  if (change === 'key') source.result.columns[0].key = 'renamed';
  if (change === 'length') source.result.columns.pop();
  if (change === 'duplicate-name') { source.columns[1].name = source.columns[0].name; source.result.columns[1].name = source.result.columns[0].name; }
  if (change === 'duplicate-key') source.result.columns[1].key = source.result.columns[0].key;
  if (change === 'key') { expect(sqliteHeaderSortFromGrid([{ columnKey: 'renamed', direction: 'ASC' }], source)).toEqual([{ column: 'id', direction: 'asc' }]); return; }
  expect(() => sqliteHeaderSortFromGrid([], source)).toThrow(); expect(() => sqliteHeaderSortToGrid([], source)).toThrow();
});
it.each(([[{ column: 'missing', direction: 'asc' }], [{ column: 'id', direction: 'ASC' }], [{ column: 'id', direction: 'asc' }, { column: 'id', direction: 'desc' }]] as const).map(sort => ({ sort })))('过期／错误表单排序不假投影成成功箭头 $#', ({ sort }) => {
  expect(() => sqliteHeaderSortToGrid(sort as never, page())).toThrow();
});
