import { afterAll, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqliteTableFilterSchema, sqliteTablePageSchema, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { buildSqliteReadPlan, buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';
import { SqliteTableExportIntent } from '../../src/renderer/sqliteTableExportUi';

const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'v', declaredType: '' }], special = "'中文\0🚢\r\n? AND DROP TABLE nope;--";
const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,v)');
const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
[-9223372036854775808n, 1n, 2n, 9223372036854775807n, -0, 1.25, 2.5, '', '2', special, Buffer.from('00ff', 'hex'), null, 'A', 'Z', '2026-11-01 12:34:56.123456', '2026-11-01 12:34:56.123457'].forEach((value, index) => insert.run(index + 1, value));
afterAll(() => db.close());
/** 相同查询来源只改变范围，页偏移与多读一行仍由正式构造器控制。 */
function input(filter: SqliteTableFilter): SqliteTablePageInput { return { connectionId: 'owned', database: 'main', table: 'subject', taskId: 'read', limit: 2, offset: 1, mode: 'and', filters: [filter], sort: [{ column: 'id', direction: 'desc' }] }; }
/** 独立绑定使用驱动原类型；INTEGER不经Number，REAL保持显式double。 */
function bound(value: NonNullable<SqliteTableFilter['value']>): SQLInputValue { return value.kind === 'integer' ? BigInt(value.value) : value.kind === 'real' ? Number(value.value) : value.kind === 'blob' ? Buffer.from(value.value, 'hex') : value.value; }
const cases = [
  ['integer', '1', '2'], ['integer', '-9223372036854775808', '9223372036854775807'], ['integer', '2', '1'],
  ['real', '-0', '1.25'], ['real', '2.5', '-0'], ['text', '', 'Z'], ['text', special, special],
  ['text', '2026-11-01 12:34:56.123456', '2026-11-01 12:34:56.123457'],
] as const;
it.each(cases)('%s范围%s到%s：BETWEEN/NOT BETWEEN与独立原生谓词逐行一致，完整SQL和分页都保类型', (kind, lower, upper) => {
  for (const operator of ['between', 'notBetween'] as const) {
    const filter: SqliteTableFilter = { column: 'v', operator, value: { kind, value: lower }, secondValue: { kind, value: upper } }, source = input(filter), complete = buildSqliteReadPlan(source, columns, ['id'], true);
    const values = complete.parameters.map((parameter): SQLInputValue => parameter.kind === 'operand' ? bound(parameter.value) : parameter.value);
    const expected = db.prepare('SELECT id FROM subject WHERE typeof(v)=? AND v ' + (operator === 'between' ? 'BETWEEN' : 'NOT BETWEEN') + ' ? AND ? ORDER BY id DESC').all(kind, bound(filter.value!), bound(filter.secondValue!));
    expect(db.prepare(complete.sql).all(...values)).toEqual(expected);
    const sql = buildSqliteFilteredSelect(source, columns, ['id']); expect(db.prepare(sql).all()).toEqual(expected); expect(sql).not.toMatch(/[\r\n\0]|LIMIT|OFFSET/);
    const page = buildSqliteReadPlan(source, columns, ['id']); expect(db.prepare(page.sql).all(...values, 3, 1)).toEqual(expected.slice(1, 4));
  }
});
it('包含两端且逆序不交换；NOT BETWEEN只比较同类型，NULL不伪装范围值', () => {
  const filter: SqliteTableFilter = { column: 'v', operator: 'between', value: { kind: 'integer', value: '1' }, secondValue: { kind: 'integer', value: '2' } };
  expect(db.prepare(buildSqliteFilteredSelect(input(filter), columns, ['id'])).all()).toEqual([{ id: 3 }, { id: 2 }]);
  expect(db.prepare(buildSqliteFilteredSelect(input({ ...filter, operator: 'notBetween' }), columns, ['id'])).all()).toEqual([{ id: 4 }, { id: 1 }]);
  expect(db.prepare(buildSqliteFilteredSelect(input({ ...filter, value: filter.secondValue, secondValue: filter.value }), columns, ['id'])).all()).toEqual([]);
});
it('范围参数类型与顺序固定，停用完整移除三个参数但不跳过边界校验', () => {
  const filter: SqliteTableFilter = { column: 'v', operator: 'notBetween', value: { kind: 'integer', value: '-9223372036854775808' }, secondValue: { kind: 'integer', value: '9223372036854775807' } };
  const plan = buildSqliteReadPlan(input(filter), columns, ['id']); expect(plan.sql).toContain('(typeof("v") = ? AND "v" NOT BETWEEN ? AND ?)'); expect(plan.parameters).toEqual([{ kind: 'storage-type', value: 'integer' }, { kind: 'operand', value: filter.value }, { kind: 'operand', value: filter.secondValue }, { kind: 'count', value: 3 }, { kind: 'count', value: 1 }]);
  const disabled = input({ ...filter, enabled: false }); expect(buildSqliteReadPlan(disabled, columns, ['id']).parameters).toEqual([{ kind: 'count', value: 3 }, { kind: 'count', value: 1 }]);
  expect(() => buildSqliteReadPlan(input({ ...filter, enabled: false, secondValue: { kind: 'integer', value: '9223372036854775808' } }), columns)).toThrow();
});
it.each([
  { operator: 'between', value: { kind: 'integer', value: '1' } },
  { operator: 'between', secondValue: { kind: 'integer', value: '2' } },
  { operator: 'between', value: { kind: 'integer', value: '1' }, secondValue: { kind: 'real', value: '2' } },
  { operator: 'between', value: { kind: 'real', value: '1' }, secondValue: { kind: 'real', value: 'Infinity' } },
  { operator: 'between', value: { kind: 'text', value: '' }, secondValue: { kind: 'text', value: '\ud800' } },
  { operator: 'between', value: { kind: 'blob', value: '00' }, secondValue: { kind: 'blob', value: 'ff' } },
  { operator: 'eq', value: { kind: 'integer', value: '1' }, secondValue: { kind: 'integer', value: '2' } },
  { operator: 'isNull', secondValue: { kind: 'text', value: '' } },
])('缺失/跨类型/非法/额外边界整体拒绝：$operator/$secondValue.kind', patch => {
  for (const enabled of [false, true]) expect(sqliteTableFilterSchema.safeParse({ column: 'v', ...patch, enabled }).success).toBe(false);
});
it('全组预算包含第二个边界与停用条件，准确131072可用但多一个字符整体拒绝', () => {
  const filter: SqliteTableFilter = { column: 'v', operator: 'between', enabled: false, value: { kind: 'text', value: 'x'.repeat(65536) }, secondValue: { kind: 'text', value: 'y'.repeat(65536) } };
  expect(sqliteTablePageSchema.safeParse(input(filter)).success).toBe(true);
  expect(sqliteTablePageSchema.safeParse({ ...input(filter), filters: [filter, { column: 'v', operator: 'eq', value: { kind: 'text', value: 'z' } }] }).success).toBe(false);
});
it('生成查询与完整导出保两个精确边界，第二值改变后旧计划永久失效，getter不执行', () => {
  const query = sqliteTableDraft({ connectionId: 'owned', database: 'main', table: 'subject' }, 2, 'or', [{ id: 'r', column: 'v', operator: 'between', kind: 'integer', value: '9007199254740993', secondValue: '9223372036854775807', enabled: false }], [{ id: 's', column: 'id', direction: 'desc' }]);
  const page: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'owned', database: 'main', table: 'subject', kind: 'view' }, columns, offset: 100, limit: 2, hasMore: true, result: { columns: [], rows: [], elapsedMs: 0, statement: '', truncated: false } };
  const generated = new SqliteFilteredSelectIntent(page, query, () => true), plan = generated.compile(['id']); expect(plan.sql).not.toContain('WHERE');
  const exported = new SqliteTableExportIntent(page, query, [], () => true); expect(exported.input({ format: 'json', encoding: 'utf8', columns: ['id'] }, 'file', 'export').filters).toEqual(query.filters);
  query.filters[0].secondValue!.value = '9223372036854775806'; expect(generated.current()).toBe(false); query.filters[0].secondValue!.value = '9223372036854775807'; expect(generated.consume(plan)).toBe(false);
  let getter = false; Object.defineProperty(query.filters[0], 'secondValue', { get() { getter = true; return { kind: 'integer', value: '2' }; } }); expect(() => new SqliteFilteredSelectIntent(page, query, () => true)).toThrow(); expect(getter).toBe(false);
});
