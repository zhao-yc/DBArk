import { afterAll, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqliteTablePageSchema, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { buildSqliteReadPlan, buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableExportIntent } from '../../src/renderer/sqliteTableExportUi';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';

const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'v', declaredType: '' }];
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,v)');
const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
[null, '2', 2n, 9223372036854775807n, Buffer.from('00ff', 'hex'), '中文\0🚢'].forEach((value, index) => insert.run(index + 1, value));
afterAll(() => db.close());
/** 真实SQLite使用明确绑定类型，完整读取用于独立核对停用后的结果，不伪造行值。 */
function read(input: SqliteTablePageInput, complete = false) {
  const plan = buildSqliteReadPlan(input, columns, ['id'], complete), statement = db.prepare(plan.sql);
  const params = plan.parameters.map((parameter): SQLInputValue => {
    if (parameter.kind !== 'operand') return parameter.value;
    const value = parameter.value;
    return value.kind === 'integer' ? BigInt(value.value) : value.kind === 'real' ? Number(value.value) : value.kind === 'blob' ? Buffer.from(value.value, 'hex') : value.value;
  });
  return statement.all(...params);
}
function source(filters: SqliteTableFilter[], mode: 'and' | 'or' = 'and'): SqliteTablePageInput {
  return { connectionId: 'owned', database: 'main', table: 'subject', taskId: 'read', offset: 1, limit: 2, mode, filters, sort: [{ column: 'id', direction: 'desc' }] };
}
const first: SqliteTableFilter = { column: 'v', operator: 'eq', value: { kind: 'integer', value: '9223372036854775807' } };
const second: SqliteTableFilter = { column: 'id', operator: 'gte', value: { kind: 'integer', value: '3' } };
it('旧条件缺省启用，不给旧请求补字段；显式true与旧SQL和参数逐字相同', () => {
  const old = source([first]); expect(sqliteTablePageSchema.parse(old).filters).toEqual([first]);
  expect(buildSqliteReadPlan(source([{ ...first, enabled: true }]), columns)).toEqual(buildSqliteReadPlan(old, columns));
});
it.each(['and', 'or'] as const)('%s 全组合：分页、完整导出和生成查询与移除停用谓词逐行一致', mode => {
  for (const a of [false, true]) for (const b of [false, true]) {
    const input = source([{ ...first, enabled: a }, { ...second, enabled: b }], mode), active = source([...(a ? [first] : []), ...(b ? [second] : [])], mode);
    expect(buildSqliteReadPlan(input, columns)).toEqual(buildSqliteReadPlan(active, columns));
    expect(read(input)).toEqual(read(active)); expect(read(input, true)).toEqual(read(active, true));
    const sql = buildSqliteFilteredSelect(input, columns, ['id']); expect(db.prepare(sql).all()).toEqual(read(active, true));
    expect(sql).not.toMatch(/LIMIT|OFFSET/);
  }
});
it.each([
  { column: 'v', operator: 'eq', value: { kind: 'text', value: '中文\0🚢' } },
  { column: 'v', operator: 'eq', value: { kind: 'blob', value: '00ff' } },
  { column: 'v', operator: 'eq', value: { kind: 'real', value: '-0' } },
  { column: 'v', operator: 'isNull' }, first,
] satisfies SqliteTableFilter[])('停用typed/null条件不产生任何占位或字面量：$operator/$value.kind', filter => {
  const input = source([{ ...filter, enabled: false }]), plan = buildSqliteReadPlan(input, columns);
  expect(plan).toEqual(buildSqliteReadPlan(source([]), columns)); expect(plan.parameters).toEqual([{ kind: 'count', value: 3 }, { kind: 'count', value: 1 }]);
  expect(buildSqliteFilteredSelect(input, columns, ['id'])).toBe('SELECT "id" FROM "main"."subject" ORDER BY "id" DESC');
});
it.each([0, 1, 'false', null, {}, []])('enabled=%j不能强制转换为布尔值', enabled => {
  expect(sqliteTablePageSchema.safeParse(source([{ ...first, enabled } as SqliteTableFilter])).success).toBe(false);
});
it.each([
  { column: 'v', operator: 'eq', value: { kind: 'integer', value: '9223372036854775808' } },
  { column: 'v', operator: 'eq', value: { kind: 'real', value: 'Infinity' } },
  { column: 'v', operator: 'eq', value: { kind: 'blob', value: 'abc' } },
  { column: 'v', operator: 'eq', value: { kind: 'text', value: '\ud800' } },
  { column: 'v', operator: 'isNull', value: { kind: 'text', value: '不得提交' } },
  { column: 'gone', operator: 'isNull' },
] satisfies SqliteTableFilter[])('停用也不能绕过值格式或目录白名单：$column/$value.kind', filter => {
  const input = source([{ ...filter, enabled: false }]); expect(() => buildSqliteReadPlan(input, columns)).toThrow(); expect(() => buildSqliteFilteredSelect(input, columns, ['id'])).toThrow();
});
it('停用也占规则数量及全组文本预算，不能把巨量数据藏在disabled字段', () => {
  expect(sqliteTablePageSchema.safeParse(source(Array.from({ length: 33 }, () => ({ ...first, enabled: false })))).success).toBe(false);
  const huge = { column: 'v', operator: 'eq' as const, enabled: false, value: { kind: 'text' as const, value: 'x'.repeat(65536) } };
  expect(sqliteTablePageSchema.safeParse(source([huge, huge, huge])).success).toBe(false);
});
it('本地表单、导出意图和生成SELECT保留准确flag及原值，已捕获查询的flag变化使计划永久失效', () => {
  const query = sqliteTableDraft({ connectionId: 'owned', database: 'main', table: 'subject' }, 2, 'or', [{ id: 'rule', column: 'v', operator: 'eq', kind: 'integer', value: '9223372036854775807', enabled: false }], []);
  expect(query.filters).toEqual([{ ...first, enabled: false }]);
  const page: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'owned', database: 'main', table: 'subject', kind: 'table' }, columns, offset: 1, limit: 2, hasMore: true, result: { columns: [], rows: [], elapsedMs: 0, statement: '', truncated: false } };
  const exported = new SqliteTableExportIntent(page, query, [], () => true);
  expect(exported.input({ format: 'json', encoding: 'utf8', columns: ['id'] }, 'file-token', 'export').filters).toEqual(query.filters);
  const generated = new SqliteFilteredSelectIntent(page, query, () => true), plan = generated.compile(['id']); expect(plan.sql).not.toContain('WHERE');
  query.filters[0].enabled = true; expect(generated.current()).toBe(false); query.filters[0].enabled = false; expect(generated.consume(plan)).toBe(false);
});
