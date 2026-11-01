import { afterAll, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqliteTableBrowseLimits, sqliteTableFilterSchema, sqliteTablePageSchema, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';
import { buildSqliteReadPlan, buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';
import { SqliteTableExportIntent } from '../../src/renderer/sqliteTableExportUi';

const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'v', declaredType: '' }], special = "'\0中文🚢\r\n?); DROP TABLE nope;--";
const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,v)');
const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
[1n, 2n, 9223372036854775807n, -9223372036854775808n, 0.5, -0, '2', '', special, Buffer.from('00ff', 'hex'), Buffer.alloc(0), null].forEach((value, index) => insert.run(index + 1, value));
afterAll(() => db.close());
/** 原分页偏移和排序不因列表改变，完整导出及生成查询另走complete分支。 */
function input(filter: SqliteTableFilter): SqliteTablePageInput { return { connectionId: 'c', database: 'main', table: 'subject', taskId: 'read', offset: 1, limit: 2, mode: 'and', filters: [filter], sort: [{ column: 'id', direction: 'desc' }] }; }
/** 独立原生参数保类型，整数与二进制不经浮点或显示文本。 */
function bound(value: NonNullable<SqliteTableFilter['value']>): SQLInputValue { return value.kind === 'integer' ? BigInt(value.value) : value.kind === 'real' ? Number(value.value) : value.kind === 'blob' ? Buffer.from(value.value, 'hex') : value.value; }
it.each([
  ['integer', ['1', '2']], ['integer', ['9223372036854775807', '-9223372036854775808']],
  ['real', ['-0', '0.5']], ['text', ['2', '', special]], ['blob', ['00ff', '']],
] as const)('%s IN/NOT IN与独立原生谓词逐行一致，分页和字面SQL不丢精度', (kind, raw) => {
  const values = raw.map(value => ({ kind, value }));
  for (const operator of ['in', 'notIn'] as const) {
    const filter: SqliteTableFilter = { column: 'v', operator, values }, source = input(filter), expected = db.prepare('SELECT id FROM subject WHERE typeof(v)=? AND v ' + (operator === 'in' ? 'IN' : 'NOT IN') + ' (' + values.map(() => '?').join(',') + ') ORDER BY id DESC').all(kind, ...values.map(bound));
    const plan = buildSqliteReadPlan(source, columns, ['id'], true), parameters = plan.parameters.map((parameter): SQLInputValue => parameter.kind === 'operand' ? bound(parameter.value) : parameter.value);
    expect(db.prepare(plan.sql).all(...parameters)).toEqual(expected);
    const sql = buildSqliteFilteredSelect(source, columns, ['id']); expect(db.prepare(sql).all()).toEqual(expected); expect(sql).not.toMatch(/[\r\n\0]|LIMIT|OFFSET/);
    expect(db.prepare(buildSqliteReadPlan(source, columns, ['id']).sql).all(...parameters, 3, 1)).toEqual(expected.slice(1, 4));
  }
});
it('空TEXT与空BLOB各自是合法一项；重复值不重复返回记录，NOT IN不跨类型或纳入NULL', () => {
  const source = input({ column: 'v', operator: 'notIn', values: [{ kind: 'integer', value: '2' }, { kind: 'integer', value: '2' }] });
  expect(db.prepare(buildSqliteFilteredSelect(source, columns, ['id'])).all()).toEqual([{ id: 4 }, { id: 3 }, { id: 1 }]);
});
it.each([
  [], Array.from({ length: 129 }, () => ({ kind: 'text', value: '' })),
  [{ kind: 'integer', value: '2' }, { kind: 'text', value: '2' }],
  [{ kind: 'integer', value: '9223372036854775808' }], [{ kind: 'real', value: 'Infinity' }], [{ kind: 'text', value: '\ud800' }], [{ kind: 'blob', value: 'abc' }], [{ kind: 'null' }],
].map(values => ({ values })))('无效或跨类型列表整体拒绝，停用也不绕过：$values', ({ values }) => {
  for (const enabled of [true, false]) expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator: 'in', values, enabled }).success).toBe(false);
});
it('列表不得夹带单值或第二界，普通比较不得带被忽略的列表', () => {
  const values = [{ kind: 'integer', value: '2' }];
  for (const patch of [{ operator: 'in', value: values[0], values }, { operator: 'notIn', secondValue: values[0], values }, { operator: 'eq', value: values[0], values }, { operator: 'in' }]) expect(sqliteTableFilterSchema.safeParse({ column: 'v', ...patch }).success).toBe(false);
});
it('128项与总绑定原1024上限独立，准确边界可执行，超限提前拒绝，停用不占参数', () => {
  const filter: SqliteTableFilter = { column: 'v', operator: 'in', values: Array.from({ length: 128 }, () => ({ kind: 'text', value: '' })) };
  expect(sqliteTableBrowseLimits.parameters).toBe(sqliteDriverLimits.columns);
  const filters = [...Array.from({ length: 7 }, () => filter), { ...filter, values: filter.values!.slice(0, 118) }], source = { ...input(filter), filters }, plan = buildSqliteReadPlan(source, columns, ['id']);
  expect(plan.parameters).toHaveLength(1024); expect(db.prepare(plan.sql).all(...plan.parameters.map(parameter => parameter.kind === 'operand' ? bound(parameter.value) : parameter.value))).toEqual([]);
  expect(() => buildSqliteReadPlan({ ...source, filters: [...filters.slice(0, 7), { ...filter, values: filter.values!.slice(0, 119) }] }, columns)).toThrow();
  expect(sqliteTablePageSchema.safeParse({ ...source, filters: Array.from({ length: 32 }, () => ({ ...filter, enabled: false })) }).success).toBe(true);
  const disabled = buildSqliteReadPlan(input({ ...filter, enabled: false }), columns); expect(disabled.parameters).toEqual([{ kind: 'count', value: 3 }, { kind: 'count', value: 1 }]);
  expect(() => buildSqliteReadPlan(input({ ...filter, column: 'gone', enabled: false }), columns)).toThrow();
});
it('先检查列表预算和稠密数据描述符，巨型数组与getter不执行或深复制', () => {
  let called = false; const item = { kind: 'text' }; Object.defineProperty(item, 'value', { enumerable: true, get() { called = true; return ''; } });
  expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator: 'in', values: [item] }).success).toBe(false); expect(called).toBe(false);
  const huge: unknown[] = []; huge.length = 10000000; Object.defineProperty(huge, 0, { get() { called = true; return { kind: 'text', value: '' }; } });
  expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator: 'in', values: huge }).success).toBe(false); expect(called).toBe(false);
  const values = Array.from({ length: 3 }, () => ({ kind: 'text' as const, value: 'x'.repeat(65536) })); expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator: 'in', values }).success).toBe(false);
  expect(sqliteTablePageSchema.safeParse({ ...input({ column: 'v', operator: 'in', values: values.slice(0, 2), enabled: false }), filters: [{ column: 'v', operator: 'in', values: values.slice(0, 2), enabled: false }, { column: 'v', operator: 'eq', value: { kind: 'text', value: 'x' } }] }).success).toBe(false);
});
it('草稿与导出意图保列表原值；生成查询捕获列表引用及项引用，已观察失效后不复活', () => {
  const query = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 2, 'or', [{ id: 'r', column: 'v', operator: 'in', kind: 'integer', value: '不进入请求的旧单值', values: ['9007199254740993', '9223372036854775807'] }], []);
  expect(query.filters[0]).toEqual({ column: 'v', operator: 'in', values: [{ kind: 'integer', value: '9007199254740993' }, { kind: 'integer', value: '9223372036854775807' }] });
  const page: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'view' }, columns, offset: 20, limit: 2, hasMore: true, result: { columns: [], rows: [], elapsedMs: 0, statement: '', truncated: false } };
  const intent = new SqliteFilteredSelectIntent(page, query, () => true), plan = intent.compile(['id']); expect(plan.sql).toContain('IN (9007199254740993, 9223372036854775807)');
  const exported = new SqliteTableExportIntent(page, query, [], () => true); expect(exported.input({ format: 'json', encoding: 'utf8', columns: ['id'] }, 'file', 'export').filters).toEqual(query.filters);
  const before = query.filters[0].values!; query.filters[0].values = [...before]; expect(intent.current()).toBe(false); query.filters[0].values = before; expect(intent.consume(plan)).toBe(false);
});
