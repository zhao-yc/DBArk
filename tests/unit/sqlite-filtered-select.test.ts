import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { buildSqliteFilteredSelect, buildSqliteReadPlan, quoteSqliteIdentifier } from '../../src/shared/sqliteReadSql';
import { buildSqliteTableSelect } from '../../src/main/sqliteTableBrowse';
import type { SqliteTableFilter, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import type { SqliteValue } from '../../src/engine/sqlite/protocol';

const table = '表?"🚢--', field = 'v?"🚢', columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: field, declaredType: '' }, { name: 'tc', declaredType: 'TEXT' }, { name: 'nc', declaredType: 'NUMERIC' }, { name: 'rc', declaredType: 'REAL' }];
const needle = "'%_?🚢\0\r\n'; DROP TABLE nope; --", longNul = '\0'.repeat(65536), encodings = ['UTF-8', 'UTF-16le', 'UTF-16be'] as const;
const databases: DatabaseSync[] = []; let directory: string, failed = false;
/** 三个独占真实磁盘库，不用内存仿真、Docker、外部数据库或Electron。 */
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'dbark-filtered-select-'));
  for (const [index, encoding] of encodings.entries()) {
    const file = join(directory, index + '.sqlite'), writer = new DatabaseSync(file);
    try {
      writer.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE " + quoteSqliteIdentifier(table) + '(id INTEGER PRIMARY KEY,' + quoteSqliteIdentifier(field) + ',tc TEXT COLLATE NOCASE,nc NUMERIC,rc REAL)');
      const insert = writer.prepare('INSERT INTO ' + quoteSqliteIdentifier(table) + ' VALUES(?,?,?,?,?)');
      const values: SQLInputValue[] = [null, '', '1', '01', 'abc', 'ABC', 1n, 2n, 0.5, -0, 9223372036854775807n, -9223372036854775808n, Buffer.alloc(0), Buffer.from('00ff', 'hex'), needle, longNul, 'a\0b\r\nc', '\ue000\ue001\0'];
      values.forEach((value, row) => insert.run(row + 1, value, value, value, value));
    } finally { writer.close(); }
    const reader = new DatabaseSync(file, { readOnly: true }); expect(reader.prepare('PRAGMA encoding').get()?.encoding).toBe(encoding); databases.push(reader);
  }
});
afterEach(context => { failed ||= context.task.result?.state === 'fail'; });
afterAll(() => { databases.forEach(db => db.close()); if (!failed) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-filtered-select-')).toBe(true); rmSync(directory, { recursive: true }); } });
function input(filters: SqliteTableFilter[] = [], patch: Partial<SqliteTablePageInput> = {}): SqliteTablePageInput { return { connectionId: 'owned', database: 'main', table, taskId: 'read', limit: 5, offset: 10, mode: 'and', filters, sort: [{ column: 'id', direction: 'desc' }], ...patch }; }
/** 与原driver绑定类型一致，INTEGER不转Number，REAL显式double，BLOB原字节。 */
function bound(value: SqliteValue): SQLInputValue { if (value === null || typeof value === 'string' || typeof value === 'number') return value; if (value.type === 'integer') return BigInt(value.value); if (value.type === 'real') return Number(value.value); return Buffer.from(value.base64, 'base64'); }
function rows(db: DatabaseSync, sql: string, parameters: SQLInputValue[] = []) { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(...parameters); }
const values: NonNullable<SqliteTableFilter['value']>[] = [{ kind: 'integer', value: '1' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'real', value: '-0' }, { kind: 'real', value: '1.000' }, { kind: 'real', value: '5e-1' }, { kind: 'text', value: '' }, { kind: 'text', value: 'ABC' }, { kind: 'text', value: needle }, { kind: 'blob', value: '' }, { kind: 'blob', value: '00FF' }];
const cases = [field, 'tc', 'nc', 'rc'].flatMap(column => values.flatMap(value => (value.kind === 'blob' ? ['eq', 'ne'] as const : ['eq', 'ne', 'gt', 'lte'] as const).map(operator => ({ column, value, operator }))));
describe('真实SQLite三编码与不同亲和性／排序规则的绑定查询逐行对照', () => {
  it.each(cases)('$column $operator $value.kind/$value.value', filter => {
    const source = input([filter]), original = buildSqliteTableSelect(source, columns, ['id', field, 'tc'], true), sql = buildSqliteFilteredSelect(source, columns, ['id', field, 'tc']);
    expect(sql).not.toMatch(/LIMIT|OFFSET/); for (const db of databases) expect(rows(db, sql)).toEqual(rows(db, original.sql, original.parameters.map(bound)));
  });
  it.each(['and', 'or'] as const)('%s包含、NULL与多列排序保持原谓词，不改成LIKE', mode => {
    const source = input([{ column: field, operator: 'contains', value: { kind: 'text', value: "'%_?🚢\0\r\n" } }, { column: 'tc', operator: 'isNull' }], { mode, sort: [{ column: 'nc', direction: 'asc' }, { column: 'id', direction: 'desc' }] });
    const original = buildSqliteTableSelect(source, columns, undefined, true), sql = buildSqliteFilteredSelect(source, columns, columns.map(c => c.name)); expect(sql).toContain('instr('); expect(sql).not.toContain('LIKE'); expect(sql).not.toMatch(/[\r\n\0]/);
    for (const db of databases) expect(rows(db, sql)).toEqual(rows(db, original.sql, original.parameters.map(bound)));
  });
  it('65536连续NUL与哨兵冲突不引入表达式深度爆炸，三编码都准确匹配', () => {
    for (const text of [longNul, '\ue000\ue001\0', 'a\0b\r\nc']) { const source = input([{ column: field, operator: 'eq', value: { kind: 'text', value: text } }]), sql = buildSqliteFilteredSelect(source, columns, ['id']); expect(sql).not.toMatch(/[\r\n\0]/); for (const db of databases) expect(rows(db, sql)).toHaveLength(1); }
  });
});
it('原分页SQL、typed参数和project/complete合同逐字保持，名称中的问号不当占位符', () => {
  const source = input([{ column: field, operator: 'eq', value: { kind: 'integer', value: '1' } }]); const result = buildSqliteTableSelect(source, columns, ['id']);
  expect(result).toEqual({ sql: 'SELECT "id" FROM "main".' + quoteSqliteIdentifier(table) + ' WHERE (typeof(' + quoteSqliteIdentifier(field) + ') = ? AND ' + quoteSqliteIdentifier(field) + ' = ?) ORDER BY "id" DESC LIMIT ? OFFSET ?', parameters: ['integer', { type: 'integer', value: '1' }, { type: 'integer', value: '6' }, { type: 'integer', value: '10' }] });
  const projected = buildSqliteReadPlan(source, columns, ['id'], true, name => 'typeof(' + name + ')'); expect(projected.sql).toContain('typeof("__dbark_source"."id") AS "id"'); expect(projected.sql).toContain(' AS "__dbark_source"'); expect(projected.parameters).toHaveLength(2);
});
it('显式LIMIT只限制完整匹配首N行，不继承当前页或探测多一行', () => { const source = input(); for (const db of databases) { const sql = buildSqliteFilteredSelect(source, columns, ['id'], 3); expect(sql).toMatch(/ LIMIT 3$/); expect(sql).not.toContain('OFFSET'); expect(rows(db, sql)).toEqual([{ id: 18n }, { id: 17n }, { id: 16n }]); } });
it.each([{ selected: [] }, { selected: ['missing'] }, { selected: ['id', 'id'] }])('空／丢失／重复投影$selected整体拒绝', ({ selected }) => { expect(() => buildSqliteFilteredSelect(input(), columns, selected)).toThrow(); });
it.each([0, -1, 1.5, 1000001, NaN, Infinity])('非法LIMIT %s不生成', limit => { expect(() => buildSqliteFilteredSelect(input(), columns, ['id'], limit)).toThrow(); });
it('输出预算拒整份，不截SQL；坏条件不静默过滤', () => {
  const wide = Array.from({ length: 1024 }, (_, i) => ({ name: '"'.repeat(500) + String(i), declaredType: '' })), source = input([{ column: wide[0].name, operator: 'eq', value: { kind: 'text', value: 'x'.repeat(65536) } }], { sort: [] }); expect(() => buildSqliteFilteredSelect(source, wide, wide.map(c => c.name))).toThrow(/预算/);
  expect(() => buildSqliteFilteredSelect(input([{ column: 'gone', operator: 'isNull' }]), columns, ['id'])).toThrow();
});
it.each(['between', 'notBetween'] as const)('%s在真实UTF8/UTF16LE/UTF16BE源及不同亲和性保持原范围语义', operator => {
  for (const column of [field, 'tc', 'nc', 'rc']) for (const [kind, lower, upper] of [['integer', '-9223372036854775808', '9223372036854775807'], ['real', '-0', '1.0'], ['text', 'ABC', 'abc'], ['text', needle, needle]] as const) {
    const filter: SqliteTableFilter = { column, operator, value: { kind, value: lower }, secondValue: { kind, value: upper } }, source = input([filter]);
    const generated = buildSqliteFilteredSelect(source, columns, ['id']), original = buildSqliteTableSelect(source, columns, ['id'], true);
    for (const db of databases) expect(rows(db, generated)).toEqual(rows(db, original.sql, original.parameters.map(bound)));
  }
});
it.each(['in', 'notIn'] as const)('%s列表在三种真实源编码及不同亲和性保持类型与参数语义', operator => {
  for (const column of [field, 'tc', 'nc', 'rc']) for (const values of [
    [{ kind: 'integer' as const, value: '-9223372036854775808' }, { kind: 'integer' as const, value: '9223372036854775807' }],
    [{ kind: 'real' as const, value: '-0' }, { kind: 'real' as const, value: '0.5' }],
    [{ kind: 'text' as const, value: needle }, { kind: 'text' as const, value: 'ABC' }, { kind: 'text' as const, value: '' }],
    [{ kind: 'blob' as const, value: '' }, { kind: 'blob' as const, value: '00ff' }],
  ]) {
    const source = input([{ column, operator, values }]), generated = buildSqliteFilteredSelect(source, columns, ['id']), original = buildSqliteTableSelect(source, columns, ['id'], true);
    for (const db of databases) expect(rows(db, generated)).toEqual(rows(db, original.sql, original.parameters.map(bound)));
  }
});
