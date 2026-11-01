import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteColumnsPlan, sqliteColumnsActionsSchema, sqliteColumnsApplySchema, sqliteColumnsDefaultSql, sqliteColumnsInspectSchema, sqliteColumnsInspectionSchema, sqliteColumnsLimits, sqliteColumnsPreviewOutputSchema, sqliteColumnsReleaseSchema, type SqliteColumnsAction, type SqliteColumnsInspectOutput, type SqliteColumnsTarget } from '../../src/shared/sqliteColumns';
import { buildSqliteTableCreate, buildSqliteTableCreateColumn, buildSqliteTableCreateDefault, type SqliteTableCreateDefault, type SqliteTableCreateDesign } from '../../src/shared/sqliteTableCreate';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const target: SqliteColumnsTarget = { connectionId: 'owned-sqlite', database: 'main', table: '原"表🚢' };
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const column = (name = '新增"🚢', value: SqliteTableCreateDefault = { kind: 'none' }) => ({ name, declaredType: 'TEXT', nullable: true, default: value });
/** 本例仅内存SQLite验证受限ALTER及共享默认值，不读取用户文件或产品连接。 */
function database(run: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { db.exec('CREATE TABLE ' + quote(target.table) + '(id INTEGER PRIMARY KEY,note TEXT,unused BLOB); INSERT INTO ' + quote(target.table) + " VALUES(1,'源值🚢',X'00ff')"); run(db); } finally { db.close(); } }
function inspection(): SqliteColumnsInspectOutput { return { catalogueId: 'catalogue', target, columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 1, hidden: 0 }, { cid: 1, name: 'note', declaredType: 'TEXT', notNull: true, defaultSql: "'原文'", primaryKey: 0, hidden: 0 }, { cid: 2, name: 'generated', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKey: 0, hidden: 3 }], tableSql: 'CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT NOT NULL)', relatedObjects: [{ type: 'table', name: target.table, table: target.table, sql: 'CREATE TABLE subject(id,note)' }, { type: 'index', name: 'sqlite_autoindex_subject_1', table: target.table, sql: null }, { type: 'view', name: '依赖视图', table: '依赖视图', sql: 'CREATE VIEW v AS SELECT note FROM subject' }], strict: false, withoutRowid: false, capabilities: { alterNullability: false }, readOnly: false, expiresAt: '2030-01-01T00:00:00Z' }; }

describe('SQLite普通表原生字段管理合同', () => {
  it('四命令严格公开边界，不接受任意SQL、路径、profile或内部持久化回调', () => {
    const input = { ...target, taskId: 'inspect' }, preview = { catalogueId: 'c', taskId: 'preview', actions: [{ kind: 'add', column: column() }] }, apply = { previewId: 'p', taskId: 'apply', confirmation: 'main.' + target.table };
    for (const command of ['sqlite.columns.inspect', 'sqlite.columns.preview', 'sqlite.columns.apply', 'sqlite.columns.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('sqlite.columns.inspect', input)).toEqual(input); expect(validateCommand('sqlite.columns.preview', preview)).toEqual(preview); expect(validateCommand('sqlite.columns.apply', apply)).toEqual(apply); expect(validateCommand('sqlite.columns.release', { catalogueId: 'c', previewId: 'p' })).toEqual({ catalogueId: 'c', previewId: 'p' });
    for (const key of ['sql', 'filePath', 'profile', 'operationId', 'recordColumnsFact', 'assertCurrent']) { expect(sqliteColumnsInspectSchema.safeParse({ ...input, [key]: 'PRIVATE' }).success).toBe(false); expect(sqliteColumnsApplySchema.safeParse({ ...apply, [key]: 'PRIVATE' }).success).toBe(false); }
    expect(sqliteColumnsInspectSchema.safeParse({ ...input, database: 'temp' }).success).toBe(false); expect(sqliteColumnsReleaseSchema.safeParse({}).success).toBe(false);
  });
  it('完整xinfo/依赖定义、实际profile只读和显式版本能力原样保留，重复及截断伪字段拒绝', () => {
    const value = inspection(); expect(sqliteColumnsInspectionSchema.parse(value)).toEqual(value); expect(sqliteColumnsInspectionSchema.parse({ ...value, readOnly: true, capabilities: { alterNullability: true } }).readOnly).toBe(true);
    for (const patch of [{ columns: [value.columns[0], { ...value.columns[0], name: 'ID', cid: 1 }] }, { columns: [value.columns[0], { ...value.columns[1], cid: 0 }] }, { relatedObjects: [value.relatedObjects[0], value.relatedObjects[0]] }, { relatedObjects: Array.from({ length: sqliteColumnsLimits.relatedObjects + 1 }, (_, index) => ({ ...value.relatedObjects[0], name: 't' + index })) }, { capabilities: {} }, { truncated: true }, { tableSql: '' }, { columns: [{ ...value.columns[0], hidden: 4 }] }]) expect(sqliteColumnsInspectionSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  });
  it('四类动作各生成一条准确引用的原生ALTER，计数与main目标必须一致', () => {
    const actions: SqliteColumnsAction[] = [{ kind: 'add', column: column() }, { kind: 'rename', name: 'note', newName: '新"名' }, { kind: 'drop', name: 'unused' }, { kind: 'nullable', name: '新"名', nullable: false }, { kind: 'nullable', name: 'id', nullable: true }], plan = buildSqliteColumnsPlan(target, actions);
    expect(plan.sql).toEqual(['ALTER TABLE main."原""表🚢" ADD COLUMN "新增""🚢" "TEXT"', 'ALTER TABLE main."原""表🚢" RENAME COLUMN "note" TO "新""名"', 'ALTER TABLE main."原""表🚢" DROP COLUMN "unused"', 'ALTER TABLE main."原""表🚢" ALTER COLUMN "新""名" SET NOT NULL', 'ALTER TABLE main."原""表🚢" ALTER COLUMN "id" DROP NOT NULL']);
    const value = { previewId: 'p', catalogueId: 'c', target, sql: plan.sql, confirmation: 'main.' + target.table, added: 1, renamed: 1, removed: 1, nullabilityChanged: 2, expiresAt: '2030-01-01T00:00:00Z' };
    expect(sqliteColumnsPreviewOutputSchema.parse(value)).toEqual(value); for (const patch of [{ added: 2 }, { confirmation: 'main.other' }, { requestedStatements: 5 }]) expect(sqliteColumnsPreviewOutputSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    expect(plan.sql.join('\n')).not.toMatch(/writable_schema|CREATE TABLE|DROP TABLE|PRAGMA|ATTACH|INSERT|REPLACE/i);
  });
  it.each(['current-date', 'current-time', 'current-timestamp'] as const)('ADD明确拒绝%s及额外value，不把原生限制改成重建或替换默认值', kind => {
    expect(() => buildSqliteColumnsPlan(target, [{ kind: 'add', column: column('clock', { kind }) }])).toThrow(/原生ADD COLUMN/);
    expect(sqliteColumnsActionsSchema.safeParse([{ kind: 'add', column: { ...column('clock', { kind }), default: { kind, value: 'PRIVATE' } } }]).success).toBe(false);
  });
  it('ADD NUL文本原值明确拒绝；新建表复用构造仍保留精确NUL及全部既有时钟默认', () => {
    expect(() => buildSqliteColumnsPlan(target, [{ kind: 'add', column: column('nul', { kind: 'text', value: '\0首🚢\0\0尾\0' }) }])).toThrow(/NUL/);
    const value = { kind: 'text', value: '\0首🚢\0\0尾\0' } as const; expect(sqliteColumnsDefaultSql(value)).toBe(buildSqliteTableCreateDefault(value));
    const design: SqliteTableCreateDesign = { name: 'owned', columns: [column('nul', value), column('clock', { kind: 'current-timestamp' })], primaryKey: [], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false };
    database(db => { const built = buildSqliteTableCreate(design); db.exec(built.sql[0]); db.exec('INSERT INTO owned DEFAULT VALUES'); expect(db.prepare('SELECT nul FROM owned').get()?.nul).toBe(value.value); expect(db.prepare('SELECT typeof(clock) AS kind FROM owned').get()?.kind).toBe('text'); expect(built.storedSql[0].sql).toBe(db.prepare("SELECT sql FROM sqlite_schema WHERE name='owned'").get()?.sql); });
  });
  it.each([
    ['文本', 'TEXT', { kind: 'text', value: "引号'中文🚢;?" }, "引号'中文🚢;?", 'text'],
    ['整数', 'INTEGER', { kind: 'integer', value: '9223372036854775807' }, 9223372036854775807n, 'integer'],
    ['负整数', 'INTEGER', { kind: 'integer', value: '-9223372036854775808' }, -9223372036854775808n, 'integer'],
    ['实数', 'REAL', { kind: 'real', value: '2' }, 2, 'real'],
    ['空值', 'TEXT', { kind: 'null' }, null, 'null'],
    ['字节', 'BLOB', { kind: 'blob', value: '00ff80' }, new Uint8Array([0, 255, 128]), 'blob'],
  ] as const)('独立原生ADD %s默认值、存储类型、目录精确回读及原控制行保持', (label, declaredType, value, expected, kind) => database(db => {
    const input = { ...column(label, value), declaredType }, sql = buildSqliteColumnsPlan(target, [{ kind: 'add', column: input }]).sql[0]; db.exec(sql);
    const query = db.prepare('SELECT ' + quote(label) + ' AS value,typeof(' + quote(label) + ') AS kind,note FROM ' + quote(target.table)); query.setReadBigInts(true); const row = query.get(); expect(row?.value).toEqual(expected); expect(row?.kind).toBe(kind); expect(row?.note).toBe('源值🚢');
    const info = db.prepare('SELECT dflt_value FROM pragma_table_xinfo(?) WHERE name=?').get(target.table, label); expect(info?.dflt_value).toBe(sqliteColumnsDefaultSql(value)); expect(sql).toContain(buildSqliteTableCreateColumn(input));
  }));
  it('原生rename自动改写依赖并保源行，drop仅原列，类型文本整体引用不能逃逸成SQL', () => database(db => {
    db.exec('CREATE VIEW dependent AS SELECT note FROM ' + quote(target.table)); const actions: SqliteColumnsAction[] = [{ kind: 'rename', name: 'note', newName: '新"名🚢' }, { kind: 'drop', name: 'unused' }, { kind: 'add', column: { ...column('安全类型'), declaredType: "TEXT DEFAULT '偷值'); DROP TABLE owned;--" } }];
    for (const sql of buildSqliteColumnsPlan(target, actions).sql) db.exec(sql);
    expect(db.prepare('SELECT * FROM dependent').get()).toEqual({ '新"名🚢': '源值🚢' }); expect(db.prepare('SELECT count(*) AS total FROM ' + quote(target.table)).get()?.total).toBe(1); expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(target.table).map(row => row.name)).toEqual(['id', '新"名🚢', '安全类型']); expect(db.prepare('SELECT ' + quote('安全类型') + ' AS value FROM ' + quote(target.table)).get()?.value).toBeNull();
  }));
  it('ADD受限排序规则真实生效且不会把COLLATE字符串拼成额外约束', () => database(db => {
    const input = { ...column('比较', { kind: 'text', value: 'AbC' }), collation: 'NOCASE' as const };
    db.exec(buildSqliteColumnsPlan(target, [{ kind: 'add', column: input }]).sql[0]); expect(db.prepare('SELECT count(*) AS total FROM ' + quote(target.table) + ' WHERE "比较"=?').get('abc')?.total).toBe(1);
    expect(sqliteColumnsActionsSchema.safeParse([{ kind: 'add', column: { ...input, collation: 'NOCASE; DROP TABLE subject' } }]).success).toBe(false);
  }));
  it('动作重复、坏Unicode、无界默认与总UTF8预算在深复制前拒绝，不调用getter', () => {
    expect(sqliteColumnsActionsSchema.safeParse([{ kind: 'drop', name: 'A' }, { kind: 'drop', name: 'a' }]).success).toBe(false); expect(sqliteColumnsActionsSchema.safeParse([{ kind: 'rename', name: 'a', newName: 'a' }]).success).toBe(false);
    for (const bad of [column('\ud800'), column('nul\0'), column('x', { kind: 'text', value: '🚢'.repeat(17000) }), column('x', { kind: 'integer', value: '9'.repeat(100000) }), column('x', { kind: 'real', value: '1e999' })]) expect(sqliteColumnsActionsSchema.safeParse([{ kind: 'add', column: bad }]).success).toBe(false);
    const getter = vi.fn(() => 'private'), accessor = { kind: 'drop' }; Object.defineProperty(accessor, 'name', { enumerable: true, get: getter }); expect(sqliteColumnsActionsSchema.safeParse([accessor]).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(sqliteColumnsActionsSchema.safeParse(Array.from({ length: 40 }, (_, index) => ({ kind: 'add', column: column('c' + index, { kind: 'text', value: 'x'.repeat(65536) }) }))).success).toBe(false);
    expect(sqliteColumnsActionsSchema.safeParse(Array.from({ length: 129 }, (_, index) => ({ kind: 'drop', name: 'c' + index }))).success).toBe(false);
  });
});
