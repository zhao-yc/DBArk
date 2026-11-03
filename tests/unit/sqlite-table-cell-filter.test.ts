import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { assertSqliteStorageTypes, type SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { captureSqliteCellFilter, sqliteCheckedFilterDraft } from '../../src/renderer/sqliteTableCellFilter';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';

/** 显示值故意相同，存储类型必须依赖Main原协议事实。 */
function fixture(code = 't', value: unknown = '2') {
  const page: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'view' }, columns: [{ name: 'v', declaredType: 'NUMERIC' }], offset: 0, limit: 10, hasMore: false, storageTypes: [code], result: { columns: [{ key: 'c0', name: 'v', type: 'SQLITE' }], rows: [{ c0: value as any }], statement: '', elapsedMs: 0, truncated: false } };
  const state = { current: true }, source = () => captureSqliteCellFilter(page, 0, 0, () => state.current);
  return { page, state, source };
}
it.each([
  ['t', '2', 'text', '2'], ['i', '2', 'integer', '2'], ['r', '2', 'real', '2'],
  ['i', '9223372036854775807', 'integer', '9223372036854775807'], ['i', '-9223372036854775808', 'integer', '-9223372036854775808'],
  ['r', '-0', 'real', '-0'], ['t', '', 'text', ''], ['t', "'\0中文🚢\r\n", 'text', "'\0中文🚢\r\n"],
  ['b', { type: 'binary', base64: 'AP8=' }, 'blob', '00ff'], ['b', { type: 'binary', base64: '' }, 'blob', ''],
] as const)('%s/%j依原类型生成等值和排除草稿，保留精确原文', (code, value, kind, raw) => {
  const f = fixture(code, value), source = f.source();
  for (const exclude of [false, true]) expect(source.draft(exclude, 'rule')).toEqual({ id: 'rule', column: 'v', operator: exclude ? 'ne' : 'eq', kind, value: raw });
  expect(f.page.result.rows[0].c0).toEqual(value); expect(Object.isFrozen(source)).toBe(true); expect(Object.isFrozen(source.value)).toBe(true);
});
it('NULL与文本NULL不同，NULL只生成IS NULL或IS NOT NULL，合同省略值', () => {
  const source = fixture('n', null).source();
  for (const exclude of [false, true]) {
    const draft = source.draft(exclude, 'rule'), query = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 10, 'and', [draft], []);
    expect(query.filters).toEqual([{ column: 'v', operator: exclude ? 'notNull' : 'isNull' }]);
  }
  expect(fixture('t', 'NULL').source().draft(false, 'rule')).toMatchObject({ operator: 'eq', kind: 'text', value: 'NULL' });
});
it.each([
  ['i', '9223372036854775808'], ['i', '2.0'], ['r', 'Infinity'], ['r', '-Infinity'], ['r', 'NaN'],
  ['t', '\ud800'], ['t', 'x'.repeat(65537)], ['i', 2], ['n', 'NULL'], ['t', null], ['b', { type: 'binary', base64: 'AB==' }], ['b', { type: 'binary', base64: 'AP8' }], ['b', { type: 'binary', base64: 'AAAA'.repeat(11000) }],
])('类型不匹配或超限原格%s不产生可用来源', (code, value) => { expect(() => fixture(String(code), value).source()).toThrow(); });
it.each([undefined, [], [''], ['x'], ['tt'], [, 't']].map(facts => ({ facts })))('缺失、稀疏或失配存储事实$facts不能猜测类型', ({ facts }) => {
  const f = fixture(); f.page.storageTypes = facts as string[] | undefined; expect(() => f.source()).toThrow();
  if (facts !== undefined) expect(() => assertSqliteStorageTypes(f.page)).toThrow(); else expect(() => assertSqliteStorageTypes(f.page)).not.toThrow();
});
it('旧回调的目标、目录、原行或存储事实变化后永久失效，恢复原对象也不复活', () => {
  for (const change of ['target', 'schema', 'columns', 'rows', 'value', 'types', 'active'] as const) {
    const f = fixture(), source = f.source(), restore: (() => void)[] = [];
    if (change === 'target') { const before = f.page.target; f.page.target = { ...before }; restore.push(() => { f.page.target = before; }); }
    if (change === 'schema') { f.page.schemaKey = 'b'.repeat(64); restore.push(() => { f.page.schemaKey = 'a'.repeat(64); }); }
    if (change === 'columns') { const before = f.page.columns; f.page.columns = [...before]; restore.push(() => { f.page.columns = before; }); }
    if (change === 'rows') { const before = f.page.result.rows; f.page.result.rows = [...before]; restore.push(() => { f.page.result.rows = before; }); }
    if (change === 'value') { f.page.result.rows[0].c0 = 'changed'; restore.push(() => { f.page.result.rows[0].c0 = '2'; }); }
    if (change === 'types') { f.page.storageTypes![0] = 'i'; restore.push(() => { f.page.storageTypes![0] = 't'; }); }
    if (change === 'active') { f.state.current = false; restore.push(() => { f.state.current = true; }); }
    expect(source.current()).toBe(false); restore.forEach(run => run()); expect(source.current()).toBe(false); expect(() => source.draft(false, 'rule')).toThrow();
  }
});
it('可编辑来源仅接纳未修改原格，新增/删除/改值拒绝，生成列与其它格的既有草稿可保留', () => {
  const f = fixture('i', '2'); f.page.columns[0].generated = true;
  const value = { kind: 'integer' as const, value: '2' }; f.page.edit = { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date().toISOString(), locator: { kind: 'rowid', columns: [] }, columns: [{ name: 'v', declaredType: '', generated: true, nullable: true, hasDefault: false }], rows: [[value]] };
  const row: SqliteDraftRow = { id: 'row', index: 0, deleted: false, values: [{ ...value }] }, rows = [row];
  const source = () => captureSqliteCellFilter(f.page, 0, 0, () => true, { row, rows }); expect(source().draft(false, 'rule').kind).toBe('integer');
  row.values = [{ kind: 'integer', value: '3' }]; expect(() => source()).toThrow(); row.values = [{ ...value }]; row.deleted = true; expect(() => source()).toThrow(); row.deleted = false; row.index = undefined; expect(() => source()).toThrow();
});
it('原格getter不执行，外部current抛错不能留下可用动作', () => {
  const f = fixture(); let called = false; Object.defineProperty(f.page.result.rows[0], 'c0', { get() { called = true; return '2'; } }); expect(() => f.source()).toThrow(); expect(called).toBe(false);
  const g = fixture(); expect(() => captureSqliteCellFilter(g.page, 0, 0, () => { throw Error('目标失效'); })).toThrow();
});
it('真实SQLite混合类型全表筛选准确区分INTEGER/REAL/TEXT/BLOB/NULL，排除仍遵循typed语义', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE subject(v); INSERT INTO subject VALUES('2'),(2),(2.0),(NULL),(X'00ff'),('3'),(3),(3.5),(X'00fe');");
    for (const [code, value, expected] of [['t', '2', 'text'], ['i', '2', 'integer'], ['r', '2', 'real'], ['n', null, 'null'], ['b', { type: 'binary', base64: 'AP8=' }, 'blob']] as const) {
      const f = fixture(code, value), draft = f.source().draft(false, 'rule'), query = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 10, 'and', [draft], []);
      const sql = buildSqliteFilteredSelect({ ...query, connectionId: 'c', database: 'main', table: 'subject', taskId: 'read', offset: 0 }, f.page.columns, ['v']);
      const records = db.prepare('SELECT typeof(v) AS t FROM (' + sql + ')').all(); expect(records).toEqual([{ t: expected }]);
      const exclude = f.source().draft(true, 'exclude'), excludeQuery = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 10, 'and', [exclude], []);
      const excludeSql = buildSqliteFilteredSelect({ ...excludeQuery, connectionId: 'c', database: 'main', table: 'subject', taskId: 'read', offset: 0 }, f.page.columns, ['v']);
      const excluded = db.prepare('SELECT typeof(v) AS t FROM (' + excludeSql + ')').all();
      if (expected === 'null') { expect(excluded).toHaveLength(8); expect(excluded.every(row => row.t !== 'null')).toBe(true); }
      else expect(excluded).toEqual([{ t: expected }]);
    }
  } finally { db.close(); }
});

it('勾选行去重但保留同显示的不同存储类型，排除是包含集合的完整补集', () => {
  const { page } = fixture();
  page.storageTypes = ['t', 'i', 'n', 'b', 't'];
  page.result.rows = [{ c0: '2' }, { c0: '2' }, { c0: null }, { c0: { type: 'binary', base64: 'AP8=' } }, { c0: '2' }];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE subject(v); INSERT INTO subject VALUES('2'),(2),(NULL),(X'00ff'),('2'),(2.0),('NULL'),(X'');");
    for (const exclude of [false, true]) {
      const draft = sqliteCheckedFilterDraft(page, 0, [0, 1, 2, 3, 4], exclude, 'rule');
      expect(draft.selectedValues).toEqual([{ kind: 'text', value: '2' }, { kind: 'integer', value: '2' }, { kind: 'null' }, { kind: 'blob', value: '00ff' }]);
      const { kind: _kind, ...target } = page.target;
      const query = sqliteTableDraft(target, 10, 'and', [draft], []);
      const sql = buildSqliteFilteredSelect({ ...query, ...target, taskId: 'read', offset: 0 }, page.columns, ['v']);
      expect(db.prepare('SELECT typeof(v) AS t FROM (' + sql + ')').all().map(row => row.t)).toEqual(exclude ? ['real', 'text', 'blob'] : ['text', 'integer', 'null', 'blob', 'text']);
    }
  } finally { db.close(); }
});

it('勾选的新行、删除行和被修改字段拒绝整个条件；超过 128 个不同值也不截断', () => {
  const { page } = fixture('i', '2');
  const original = { kind: 'integer' as const, value: '2' };
  page.edit = { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date().toISOString(), locator: { kind: 'rowid', columns: [] }, columns: [{ name: 'v', declaredType: '', generated: false, nullable: true, hasDefault: false }], rows: [[original]] };
  const row: SqliteDraftRow = { id: 'row', index: 0, deleted: false, values: [original] };
  const draft = (value: SqliteDraftRow) => sqliteCheckedFilterDraft(page, 0, [0], false, 'rule', [value]);
  expect(draft(row).selectedValues).toEqual([original]);
  for (const invalid of [{ ...row, index: undefined }, { ...row, deleted: true }, { ...row, values: [{ ...original, value: '3' }] }]) expect(() => draft(invalid)).toThrow();
  page.storageTypes = Array.from({ length: 129 }, () => 'i');
  page.result.rows = page.storageTypes.map((_, index) => ({ c0: String(index) }));
  expect(() => sqliteCheckedFilterDraft(page, 0, page.storageTypes!.map((_, index) => index), false, 'rule')).toThrow('上限');
});
