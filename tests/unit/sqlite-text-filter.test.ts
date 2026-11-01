import { afterAll, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { sqliteTextFilterOperators, sqliteTableFilterSchema, sqliteTablePageSchema, type SqliteTableFilter, type SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { buildSqliteReadPlan, buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { sqlitePresetDraft } from '../../src/renderer/sqliteTablePresetDraft';
import { sqliteTablePresetDocumentSchema } from '../../src/shared/sqliteTablePresets';

const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'v', declaredType: '' }];
const values = ['', 'Alpha', 'alpha', '%_中文🚢', '前\0后🚢', '\0', '末\r\n', "' OR 1=1 --", 'e\u0301', 'é', '🚢🚢', '尾 ', ' 空白', null, 2n, 2.5, Buffer.from('00ff', 'hex')];
const databases: DatabaseSync[] = [];
afterAll(() => { for (const db of databases) db.close(); });
/** 独立JS字符串谓词作为期望，不用待验SQL构造器计算自身答案。 */
function matches(operator: typeof sqliteTextFilterOperators[number], value: unknown, needle: string): boolean {
  if (typeof value !== 'string') return false;
  const result = operator.endsWith('Contains') || operator === 'contains' ? value.includes(needle) : operator.endsWith('StartsWith') || operator === 'startsWith' ? value.startsWith(needle) : value.endsWith(needle);
  return operator.startsWith('not') ? !result : result;
}
/** 保持原分页、排序和typed参数形状，完整读取及字面查询共用同一输入。 */
function input(filter: SqliteTableFilter): SqliteTablePageInput { return { connectionId: 'text', database: 'main', table: 'subject', taskId: 'text-filter', offset: 1, limit: 2, mode: 'and', filters: [filter], sort: [{ column: 'id', direction: 'asc' }] }; }
/** 原生参数严格保类型，位置参数不依赖SQL中的问号计数。 */
function parameters(plan: ReturnType<typeof buildSqliteReadPlan>): SQLInputValue[] { return plan.parameters.map(item => item.kind !== 'operand' ? item.value : item.value.kind === 'text' ? item.value.value : item.value.kind === 'integer' ? BigInt(item.value.value) : item.value.kind === 'real' ? Number(item.value.value) : Buffer.from(item.value.value, 'hex')); }

it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s下六种TEXT匹配与独立原文期望一致，包含NUL、空值、通配字符、大小写及组合字符', encoding => {
  const db = new DatabaseSync(':memory:'); databases.push(db); db.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE subject(id INTEGER PRIMARY KEY,v COLLATE NOCASE)");
  expect(Object.values(db.prepare('PRAGMA encoding').get()!)[0]).toBe(encoding);
  const insert = db.prepare('INSERT INTO subject VALUES(?,?)'); values.forEach((value, index) => insert.run(index + 1, value));
  for (const operator of sqliteTextFilterOperators) for (const needle of ['', 'A', 'a', '%_', '中文🚢', '前\0', '\0后🚢', '\0', '\r\n', "' OR 1=1 --", 'é', '🚢', ' ', '超过所有记录长度的后缀文本']) {
    const source = input({ column: 'v', operator, value: { kind: 'text', value: needle } }), expected = values.flatMap((value, index) => matches(operator, value, needle) ? [{ id: index + 1 }] : []);
    const complete = buildSqliteReadPlan(source, columns, ['id'], true), paged = buildSqliteReadPlan(source, columns, ['id']);
    expect(db.prepare(complete.sql).all(...parameters(complete)), operator + '/' + JSON.stringify(needle)).toEqual(expected);
    expect(db.prepare(paged.sql).all(...parameters(paged))).toEqual(expected.slice(1, 4));
    const generated = buildSqliteFilteredSelect(source, columns, ['id']); expect(db.prepare(generated).all()).toEqual(expected); expect(generated).not.toMatch(/[\r\n\0]/);
  }
});
it.each(sqliteTextFilterOperators)('%s只接受TEXT，停用同样拒绝跨类型、列表、第二值和无效Unicode', operator => {
  expect(sqliteTableFilterSchema.parse({ column: 'v', operator, value: { kind: 'text', value: '' } }).operator).toBe(operator);
  for (const enabled of [true, false]) for (const patch of [
    { value: { kind: 'integer', value: '2' } }, { value: { kind: 'real', value: '2' } }, { value: { kind: 'blob', value: '00ff' } },
    { value: { kind: 'text', value: '\ud800' } }, { secondValue: { kind: 'text', value: 'x' } }, { values: [{ kind: 'text', value: 'x' }] },
  ]) expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator, value: { kind: 'text', value: 'x' }, enabled, ...patch }).success).toBe(false);
});
it('后缀双值绑定计入准确1024预算；停用仅保草稿，字段白名单不能绕过', () => {
  const list = { column: 'v', operator: 'in' as const, values: Array.from({ length: 128 }, () => ({ kind: 'text' as const, value: 'x' })) }, suffix: SqliteTableFilter = { column: 'v', operator: 'endsWith', value: { kind: 'text', value: '\0🚢' } };
  const source = { ...input(suffix), filters: [...Array.from({ length: 7 }, () => list), { ...list, values: list.values.slice(0, 115) }, suffix] };
  expect(buildSqliteReadPlan(source, columns).parameters).toHaveLength(1024);
  expect(sqliteTablePageSchema.safeParse({ ...source, filters: [...source.filters, { column: 'v', operator: 'isNull' }] }).success).toBe(true);
  expect(sqliteTablePageSchema.safeParse({ ...source, filters: [...source.filters, suffix] }).success).toBe(false);
  expect(buildSqliteReadPlan(input({ ...suffix, enabled: false }), columns).parameters).toEqual([{ kind: 'count', value: 3 }, { kind: 'count', value: 1 }]);
  expect(() => buildSqliteReadPlan(input({ ...suffix, column: 'v" OR 1=1--', enabled: false }), columns)).toThrow('列已不存在');
});
it('文本方案载入与表单往返保留原文及停用标记，旧运算符和文档版本兼容', () => {
  for (const operator of sqliteTextFilterOperators) {
    const query = sqliteTableDraft({ connectionId: 'text', database: 'main', table: 'subject' }, 5, 'or', [{ id: 'r', column: 'v', operator, kind: 'text', value: '前\0🚢%_\r\n', enabled: false }], []);
    const restored = sqlitePresetDraft(query, ['id', 'v'], () => 'new');
    expect(restored.filters[0]).toEqual({ id: 'new', column: 'v', operator, kind: 'text', value: '前\0🚢%_\r\n', enabled: false });
    expect(sqliteTableDraft({ connectionId: 'text', database: 'main', table: 'subject' }, restored.query.limit, restored.query.mode, restored.filters, restored.sort)).toEqual(query);
    const document = sqliteTablePresetDocumentSchema.parse({ version: 1, target: { connectionId: 'text', database: 'main', table: 'subject' }, revision: 1, entries: [{ id: 'c7b3aeb0-1dd2-4cc9-986d-c61aa9fb3d88', name: '文本方案', connectionDigest: 'a'.repeat(64), query }] });
    expect(sqliteTablePresetDocumentSchema.parse(JSON.parse(JSON.stringify(document))).entries[0].query).toEqual(query);
  }
});
