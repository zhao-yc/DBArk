import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { compileSqliteTableRebuildDefinition as compile, compileSqliteTableRebuildCheckedCopyDefinition, inspectSqliteTableNotNull as inspect, inspectSqliteTableRebuildKeyLayout, type SqliteTableRebuildDefinitionInput } from '../../src/shared/sqliteTableRebuildPlan';
import { sqliteTableRebuildChangesSchema } from '../../src/shared/sqliteTableRebuild';

const candidate = '__dbark_rebuild_' + 'a'.repeat(32), ordinal = '__dbark_rebuild_order_' + 'b'.repeat(32);
/** 真实native内存库只提供原声明和候选语义证明，不打开用户文件或签发执行能力。 */
function fixture(sql = 'CREATE TABLE target(a INTEGER,b TEXT,g TEXT AS(b) STORED)') {
  const db = new DatabaseSync(':memory:'); try { db.exec(sql); } catch (reason) { db.close(); throw reason; }
  const tableSql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='target'").get()!.sql), columns = db.prepare('PRAGMA table_xinfo(target)').all().map(column => ({ name: String(column.name), hidden: Number(column.hidden) }));
  const input: SqliteTableRebuildDefinitionInput = { table: 'target', tableSql, columns, candidateName: candidate, changes: [] };
  return { db, input, compile(changes: SqliteTableRebuildDefinitionInput['changes']) { const before = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all(), result = compile({ ...input, changes }); expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all()).toEqual(before); db.exec(result.candidateSql); return result; } };
}

describe('SQLite显式NOT NULL准确声明编译', () => {
  it('读取完整命名和冲突子句，不把默认值、CHECK或注释当声明', () => {
    const f = fixture("CREATE TABLE target(a INTEGER CONSTRAINT first CONSTRAINT second NOT NULL ON CONFLICT FAIL,b TEXT DEFAULT 'NOT NULL' CHECK(b<>'NOT NULL') /*NOT NULL*/,g TEXT AS(b) STORED)");
    try { expect(inspect(f.input)).toEqual([{ column: 'a', explicitNotNull: true, sql: ['CONSTRAINT first CONSTRAINT second NOT NULL ON CONFLICT FAIL'] }, { column: 'b', explicitNotNull: false, sql: [] }, { column: 'g', explicitNotNull: false, sql: [] }]); expect(Object.isFrozen(inspect(f.input)[0].sql)).toBe(true); } finally { f.db.close(); }
  });
  it.each(['', 'NULL ON CONFLICT IGNORE', "DEFAULT '原'", 'CONSTRAINT lonely'])('新增不吞原声明或尾部注释：%s', suffix => {
    const f = fixture('CREATE TABLE target(a INTEGER ' + suffix + ' /*尾部保留*/,b TEXT,g TEXT AS(b) STORED)');
    try { const result = f.compile([{ column: 'a', notNull: true }]); expect(result.candidateSql).toContain(suffix); expect(result.candidateSql).toContain('/*尾部保留*/'); expect(f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all()[0].notnull).toBe(1); expect(() => f.db.exec('INSERT INTO ' + candidate + '(a) VALUES(NULL)')).toThrow(/NOT NULL/); } finally { f.db.close(); }
  });
  it.each(['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'])('设置已有NOT NULL保持原ON CONFLICT %s，不默默规范化或改名', conflict => {
    const f = fixture('CREATE TABLE target(a INTEGER CONSTRAINT kept NOT NULL ON CONFLICT ' + conflict + ',b TEXT,g TEXT AS(b) STORED)');
    try { const result = f.compile([{ column: 'a', notNull: true }]); expect(result.candidateSql).toContain('CONSTRAINT kept NOT NULL ON CONFLICT ' + conflict); expect(inspect({ ...f.input, table: candidate, tableSql: result.candidateSql })[0].sql).toEqual(inspect(f.input)[0].sql); } finally { f.db.close(); }
  });
  it('移除所有重复NOT NULL及其命名，不复活前一个冲突策略或误删独立NULL', () => {
    const f = fixture('CREATE TABLE target(a INTEGER CONSTRAINT n NOT NULL ON CONFLICT FAIL CONSTRAINT n NOT NULL ON CONFLICT REPLACE CONSTRAINT kept NULL ON CONFLICT IGNORE,b TEXT,g TEXT AS(b) STORED)');
    try { expect(inspect(f.input)[0].sql).toHaveLength(2); const result = f.compile([{ column: 'a', notNull: false }]); expect(result.candidateSql).toContain('CONSTRAINT kept NULL ON CONFLICT IGNORE'); expect(result.candidateSql).not.toContain('CONSTRAINT n'); expect(f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all()[0].notnull).toBe(0); f.db.exec('INSERT INTO ' + candidate + '(a) VALUES(NULL)'); } finally { f.db.close(); }
  });
  it.each(['VIRTUAL', 'STORED'])('已有%s生成字段允许设置NOT NULL，NULL生成值由native拒绝', storage => {
    const f = fixture('CREATE TABLE target(a INTEGER,b TEXT,g TEXT AS(b) ' + storage + ')');
    try { f.compile([{ column: 'g', notNull: true }]); expect(() => f.db.exec('INSERT INTO ' + candidate + '(a,b) VALUES(1,NULL)')).toThrow(/NOT NULL/); f.db.exec('INSERT INTO ' + candidate + '(a,b) VALUES(1,\'原\')'); expect(f.db.prepare('SELECT g FROM ' + candidate).get()!.g).toBe('原'); } finally { f.db.close(); }
  });
  it.each(['', ' STRICT', ' WITHOUT ROWID'])('移除显式声明不取消主键隐含规则：%s', option => {
    const type = option === ' STRICT' ? 'TEXT' : 'INTEGER', f = fixture('CREATE TABLE target(a ' + type + ' NOT NULL,b TEXT,g TEXT AS(b) STORED,PRIMARY KEY(a,b))' + option);
    try { const result = f.compile([{ column: 'a', notNull: false }]), parsed = inspectSqliteTableRebuildKeyLayout({ table: candidate, tableSql: result.candidateSql, columns: f.input.columns }), actual = f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all(); expect(inspect({ ...f.input, table: candidate, tableSql: result.candidateSql })[0].explicitNotNull).toBe(false); expect(parsed.columns.map(column => column.notNull)).toEqual(actual.map(column => column.notnull === 1)); expect(actual[0].notnull).toBe(option ? 1 : 0); } finally { f.db.close(); }
  });
  it.each([true, false])('INTEGER主键的NULL输入生成ROWID，显式NOT NULL=%s不伪称可存NULL', notNull => {
    const f = fixture('CREATE TABLE target(a INTEGER PRIMARY KEY,b TEXT,g TEXT AS(b) STORED)');
    try { f.compile([{ column: 'a', notNull }]); f.db.exec('INSERT INTO ' + candidate + '(a,b) VALUES(NULL,\'原\')'); expect(f.db.prepare('SELECT a FROM ' + candidate).get()!.a).toBe(1); expect(f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all()[0].notnull).toBe(notNull ? 1 : 0); } finally { f.db.close(); }
  });
  it('NOT NULL REPLACE与默认值不能授权OR ABORT复制把NULL替换为默认值', () => {
    const f = fixture('CREATE TABLE target(a INTEGER NOT NULL ON CONFLICT REPLACE DEFAULT 9,b TEXT,g TEXT AS(b) STORED)');
    try { f.compile([{ column: 'a', notNull: true }]); expect(() => f.db.exec('INSERT OR ABORT INTO ' + candidate + '(a) VALUES(NULL)')).toThrow(/NOT NULL/); expect(f.db.prepare('SELECT * FROM ' + candidate).all()).toEqual([]); } finally { f.db.close(); }
  });
  it('与默认值、类型和实际重排共同编译，不互相吞掉新声明', () => {
    const f = fixture('CREATE TABLE target(a INTEGER NOT NULL DEFAULT 1,b TEXT,g TEXT AS(b) STORED)');
    try { const result = compile({ ...f.input, changes: [{ column: 'a', notNull: false, declaredType: 'TEXT', default: { kind: 'text', value: '新' } }, { column: 'b', notNull: true }], columnOrder: ['g', 'b', 'a'] }); f.db.exec(result.candidateSql); const actual = f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all(); expect(actual.map(column => [column.name, column.notnull])).toEqual([['g', 0], ['b', 1], ['a', 0]]); expect(actual[2]).toMatchObject({ type: 'TEXT', dflt_value: "'新'" }); } finally { f.db.close(); }
  });
  it('释放NOT NULL名字后可用于同批新外键，不把合法组合误拒为原命名冲突', () => {
    const f = fixture('CREATE TABLE target(a INTEGER CONSTRAINT available NOT NULL,b TEXT,g TEXT AS(b) STORED)');
    try { const result = compile({ ...f.input, changes: [{ column: 'a', notNull: false }], foreignKeyEdits: [{ kind: 'add', definition: { name: 'available', columns: ['a'], referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE', deferral: 'deferred' } }] }); expect(result.candidateSql).toContain('CONSTRAINT "available" FOREIGN KEY'); f.db.exec(result.candidateSql); expect(f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all()[0].notnull).toBe(0); } finally { f.db.close(); }
  });
  it('限定CHECK私有复制保留新NOT NULL和最终原名表达式', () => {
    const f = fixture('CREATE TABLE target(a INTEGER CHECK(target.a>0),b TEXT,g TEXT AS(b) STORED)');
    try { const result = compileSqliteTableRebuildCheckedCopyDefinition({ ...f.input, changes: [{ column: 'a', notNull: true }] }, ordinal); f.db.exec(result.candidateSql); expect(result.finalSql).toContain('CHECK(target.a>0)'); expect(result.qualifiedCheckReferences).toBe(1); expect(f.db.prepare('PRAGMA table_xinfo(' + candidate + ')').all().find(column => column.name === 'a')!.notnull).toBe(1); } finally { f.db.close(); }
  });
  it.each([0, 1, 'false', null])('NOT NULL只接受布尔值，不隐式转换%j', notNull => { expect(sqliteTableRebuildChangesSchema.safeParse([{ column: 'a', notNull }]).success).toBe(false); });
  it('false是真实移除请求，访问器/重复字段/未知字段均拒绝且不调用getter', () => {
    expect(sqliteTableRebuildChangesSchema.parse([{ column: 'a', notNull: false }])).toEqual([{ column: 'a', notNull: false }]); const f = fixture(), getter = vi.fn(() => true);
    try { const patch = { column: 'a' }; Object.defineProperty(patch, 'notNull', { enumerable: true, get: getter }); expect(() => compile({ ...f.input, changes: [patch] })).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => compile({ ...f.input, changes: [{ column: 'a', notNull: false }, { column: 'A', notNull: true }] })).toThrow(); expect(() => compile({ ...f.input, changes: [{ column: '不存在', notNull: true }] })).toThrow(); } finally { f.db.close(); }
  });
});
