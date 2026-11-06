import { describe, expect, it, vi } from 'vitest';
import type { DataRow, TableInfo } from '../../src/shared/contracts';
import type { SqliteEditColumn } from '../../src/shared/sqliteTableEdit';
import type { PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { recordTemplateContentSchema, recordTemplateLimits } from '../../src/shared/recordTemplates';
import { mysqlTemplateCandidate, mysqlTemplateRows, mysqlTemplateColumns, postgresTemplateCandidate, postgresTemplateColumns, postgresTemplateRows, sqliteTemplateCandidate, sqliteTemplateRows, validateRecordTemplate } from '../../src/renderer/recordTemplates';
import { DraftHistory } from '../../src/renderer/draftHistory';

/** 普通表目录包含自增、生成和原型同名字段，值只来自当前本地草稿。 */
function info(): TableInfo {
  return { database: '库', name: '表', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: [
    { name: 'id', type: 'bigint', nullable: false, extra: 'auto_increment', generated: false, defaultValue: null, comment: '' },
    ...['__proto__', 'amount', 'empty', 'null', 'binary', 'number', 'boolean', 'missing'].map(name => ({ name, type: 'text', nullable: true, extra: '', generated: false, defaultValue: null, comment: '' })),
    { name: 'generated', type: 'bigint', nullable: true, extra: '', generated: true, defaultValue: null, comment: '' },
  ] };
}
describe('记录模板精确值与新增草稿模型', () => {
  const postgresColumn = (name: string, index: number, overrides?: Partial<PostgresTableColumn>): PostgresTableColumn =>
    ({ name, key: `c${index}`, type: 'text', nullable: true, defaultValue: false, generated: false, primary: false, binary: false, ...overrides });

  it('PostgreSQL 捕获精确数值及暂存字节，区分空字节、NULL、DEFAULT、未载入和自动列', () => {
    const columns = [
      postgresColumn('id', 0, { identityAlways: true, primary: true }),
      postgresColumn('seq', 1, { sequenceDefault: true }),
      postgresColumn('generated', 2, { generated: true }),
      postgresColumn('big', 3, { type: 'bigint' }),
      postgresColumn('amount', 4, { type: 'numeric(40,18)' }),
      postgresColumn('raw', 5, { type: 'bytea', binary: true }),
      postgresColumn('emptyRaw', 6, { type: 'bytea', binary: true }),
      postgresColumn('nil', 7), postgresColumn('default', 8), postgresColumn('missing', 9),
    ];
    const page: PostgresTablePage = { columns, rows: [{
      c0: '1', c1: '2', c2: '生成值', c3: '9223372036854775807', c4: '0',
      c5: { type: 'binary', base64: 'AQ==' }, c6: { type: 'binary', base64: '' }, c7: null, c8: '原值',
    }], capabilities: { insert: true, update: true, delete: true }, hasNext: false, truncated: false, order: 'primary', relationKind: 'r' };
    const amount = '90071992547409931234.012345678901234567';
    const source = postgresTemplateCandidate(page, 0, { kind: 'update', row: 0, fields: [
      { column: 'c4', value: { mode: 'text', value: amount } },
      { column: 'c5', value: { mode: 'binary', value: '00FF' } },
      { column: 'c8', value: { mode: 'default' } },
    ] })!;
    expect(source.fields.map(field => field.name)).toEqual(['big', 'amount', 'raw', 'emptyRaw', 'nil', 'default', 'missing']);
    expect(source.fields.filter(field => field.unavailable).map(field => field.name)).toEqual(['default', 'missing']);
    const content = { version: 1, dialect: 'postgresql', fields: source.fields.filter(field => field.value) };
    const reordered = [...columns].reverse().map((column, index) => ({ ...column, key: `c${index}` }));
    const expected = { kind: 'insert', fields: [
      { column: 'c6', value: { mode: 'text', value: '9223372036854775807' } },
      { column: 'c5', value: { mode: 'text', value: amount } },
      { column: 'c4', value: { mode: 'binary', value: '00ff' } },
      { column: 'c3', value: { mode: 'binary', value: '' } },
      { column: 'c2', value: { mode: 'null' } },
    ] };
    const rows = postgresTemplateRows(JSON.parse(JSON.stringify(content)), reordered, 2);
    expect(rows).toEqual([expected, expected]);
    expect(rows[0]).not.toBe(rows[1]);
    expect(postgresTemplateCandidate(page, 0, { kind: 'delete', row: 0 })).toBeUndefined();
  });

  it('PostgreSQL 拒绝过期列、其他驱动、伪造模式和超限字节，整批没有可暂存的返回值', () => {
    const columns = [postgresColumn('text', 0), postgresColumn('raw', 1, { type: 'bytea', binary: true })];
    const [note, binary] = postgresTemplateColumns(columns);
    const raw = { version: 1, dialect: 'postgresql', fields: [{ ...note, value: { kind: 'text', value: '原文本' } }] };
    expect(() => postgresTemplateRows(raw, [postgresColumn('text', 0, { nullable: false })], 1)).toThrow(/字段已删除/);
    expect(() => postgresTemplateRows({ ...raw, dialect: 'mysql' }, columns, 1)).toThrow(/字段已删除/);
    expect(() => postgresTemplateRows(raw, columns, 101)).toThrow(/超过上限/);
    for (const value of [{ kind: 'boolean', value: true }, { kind: 'text', value: 'a\0b' }, { kind: 'number', value: '1' }]) {
      expect(recordTemplateContentSchema.safeParse({ ...raw, fields: [{ ...note, value }] }).success).toBe(false);
    }
    expect(() => postgresTemplateRows({ ...raw, fields: [{ ...note, value: { kind: 'binary', value: 'AP8=' } }] }, columns, 1)).toThrow(/不适用于/);
    const over = Buffer.alloc(32769).toString('base64');
    expect(() => postgresTemplateRows({ ...raw, fields: [...raw.fields, { ...binary, value: { kind: 'binary', value: over } }] }, columns, 2)).toThrow(/不适用于/);
  });

  it('MySQL字符串大数、JSON词法、NUL、空串、NULL、字节、负零和布尔存盘后分别还原', () => {
    const metadata = info(), original = Object.fromEntries([['id', 1], ['__proto__', '{"n":9007199254740993,"n":-0}'], ['amount', '0.12345678901234567890'], ['empty', '\0🚢\r\n'], ['null', null], ['binary', { type: 'binary', base64: 'AP8=' }], ['number', -0], ['boolean', false], ['generated', 99]]) as DataRow;
    const source = mysqlTemplateCandidate(original, metadata);
    expect(source.fields.map(field => field.name)).not.toContain('id'); expect(source.fields.map(field => field.name)).not.toContain('generated');
    expect(source.fields.find(field => field.name === 'missing')?.unavailable).toBeTruthy();
    const content = recordTemplateContentSchema.parse({ version: 1, dialect: 'mysql', fields: source.fields.filter(field => field.value).map(({ name, signature, value }) => ({ name, signature, value })) });
    const stored = JSON.parse(JSON.stringify(content)), rows = mysqlTemplateRows(stored, metadata, 2);
    expect(rows[0].__proto__).toBe(original.__proto__); expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
    for (const name of ['amount', 'empty', 'null', 'boolean']) expect(rows[0][name]).toBe(original[name]);
    expect(Object.is(rows[0].number, -0)).toBe(true); expect(rows[0].binary).toEqual(original.binary); expect(rows[0].binary).not.toBe(rows[1].binary);
    expect(Object.hasOwn(rows[0], 'id')).toBe(false); expect(Object.hasOwn(rows[0], 'missing')).toBe(false); expect(Object.hasOwn(original, 'missing')).toBe(false);
  });
  it('SQLite实际存储类型和省略DEFAULT保持，重排列按准确字段名映射', () => {
    const columns: SqliteEditColumn[] = ['int', 'text', 'blob', 'nil', 'default', 'generated'].map(name => ({ name, declaredType: 'ANY', nullable: true, hasDefault: name === 'default', generated: name === 'generated' }));
    const source = sqliteTemplateCandidate([{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '2\0🚢' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }, undefined, { kind: 'integer', value: '9' }], columns);
    const content = { version: 1, dialect: 'sqlite', fields: source.fields.filter(field => field.value).map(({ name, signature, value }) => ({ name, signature, value })) };
    const reordered = [columns[2], columns[0], ...columns.slice(3), columns[1]], rows = sqliteTemplateRows(content, reordered, 2);
    expect(rows[0]).toEqual([{ kind: 'blob', value: '00ff' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }, undefined, undefined, { kind: 'text', value: '2\0🚢' }]);
    expect(rows[0][0]).not.toBe(rows[1][0]); expect(source.fields.find(field => field.name === 'default')?.unavailable).toBeTruthy();
  });
  it.each(['missing', 'type', 'nullable', 'generated', 'auto', 'charset', 'dialect'] as const)('%s变化整份拒绝，不丢字段或把旧值转换后继续', change => {
    const original = info(), source = mysqlTemplateCandidate({ amount: '1.2300' }, original), field = source.fields.find(field => field.name === 'amount')!;
    const content = { version: 1, dialect: 'mysql', fields: [{ name: field.name, signature: field.signature, value: field.value }] }, current = structuredClone(original), column = current.columns.find(column => column.name === 'amount')!;
    if (change === 'missing') current.columns = current.columns.filter(column => column.name !== 'amount');
    if (change === 'type') column.type = 'bigint'; if (change === 'nullable') column.nullable = false; if (change === 'generated') column.generated = true; if (change === 'auto') column.extra = 'auto_increment'; if (change === 'charset') column.characterSet = 'latin1';
    expect(() => validateRecordTemplate(content, change === 'dialect' ? 'sqlite' : 'mysql', mysqlTemplateColumns(current))).toThrow();
  });
  it('访问器、稀疏与巨量数组在任何getter执行前拒绝；原型同名字段不触发setter', () => {
    const get = vi.fn(() => '不应读取'), content = { version: 1, dialect: 'mysql', fields: new Array(2) };
    Object.defineProperty(content.fields, '0', { enumerable: true, get }); expect(recordTemplateContentSchema.safeParse(content).success).toBe(false); expect(get).not.toHaveBeenCalled();
    content.fields.length = recordTemplateLimits.fields + 1; expect(recordTemplateContentSchema.safeParse(content).success).toBe(false); expect(get).not.toHaveBeenCalled();
    expect(recordTemplateContentSchema.safeParse({ ...content, fields: [{ name: 'x', signature: 's', value: Object.defineProperty({}, 'kind', { enumerable: true, get }) }] }).success).toBe(false); expect(get).not.toHaveBeenCalled();
  });
  it.each([{ kind: 'number', value: 'NaN' }, { kind: 'number', value: 'Infinity' }, { kind: 'number', value: '01' }, { kind: 'binary', value: 'AB==' }, { kind: 'text', value: '\ud800' }, { kind: 'text', value: 'x'.repeat(65537) }])('非法或超量值$kind不能写成模板', value => {
    expect(recordTemplateContentSchema.safeParse({ version: 1, dialect: 'mysql', fields: [{ name: 'x', signature: 's', value }] }).success).toBe(false);
  });
  it('新增数量、总格数和复制前字节预算阻止过量分配，原模板保持原文', () => {
    const metadata = info(), source = mysqlTemplateCandidate({ amount: 'x'.repeat(30000) }, metadata), field = source.fields.find(field => field.name === 'amount')!, content = { version: 1, dialect: 'mysql', fields: [{ name: field.name, signature: field.signature, value: field.value }] };
    expect(() => mysqlTemplateRows(content, metadata, 0)).toThrow(); expect(() => mysqlTemplateRows(content, metadata, 101)).toThrow(); expect(() => mysqlTemplateRows(content, metadata, 100)).toThrow(/2 MiB/);
    expect(mysqlTemplateRows(content, metadata, 1)[0].amount).toBe('x'.repeat(30000));
  });
  it('原草稿差异撤销和清空均发布新代次，不因返回原内容复活旧捕获', () => {
    const history = new DraftHistory(), rows = [{ id: 'source', data: { amount: '原' }, inserted: true, deleted: false }], before = history.generation;
    const next = [{ ...rows[0], data: { amount: '新' } }]; history.record(rows, next); const written = history.generation;
    expect(written).not.toBe(before); expect(history.move(next, 'undo')?.[0].data).toEqual(rows[0].data); expect(history.generation).not.toBe(before); expect(history.generation).not.toBe(written);
    const previous = history.generation; history.clear(); expect(history.generation).not.toBe(previous);
  });
});
