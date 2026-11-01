import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { buildSqliteTableRenamePlan, sqliteTableRenameInspectSchema, sqliteTableRenameInspectionSchema, sqliteTableRenamePreviewSchema, sqliteTableRenamePreviewOutputSchema, sqliteTableRenameApplySchema, sqliteTableRenameReleaseSchema, sqliteTableRenameOutcomeSchema, sqliteTableRenameLimits, type SqliteTableRenameInspectOutput } from '../../src/shared/sqliteTableRename';

const navigationIdentity = 'a'.repeat(64);
const target = { connectionId: 'owned', database: 'main' as const, table: '原"表🚢' }, newName = '新"表🚢;DROP TABLE control;--';
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 独立内存数据库验证构造SQL的实际语义，不代替文件driver/native验收。 */
function database(action: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { db.exec('PRAGMA foreign_keys=ON; PRAGMA legacy_alter_table=OFF'); action(db); } finally { db.close(); } }
/** 完整目录仅用于严格IPC合同，不授予任何文件或运行时能力。 */
function inspection(): SqliteTableRenameInspectOutput { return { catalogueId: 'catalogue', navigationIdentity, target, columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 1, hidden: 0 }], tableSql: 'CREATE TABLE subject(id INTEGER PRIMARY KEY)', relatedObjects: [{ type: 'table', name: target.table, table: target.table, sql: 'CREATE TABLE subject(id INTEGER PRIMARY KEY)' }], strict: false, withoutRowid: false, readOnly: false, expiresAt: '2030-01-01T00:00:00Z' }; }

describe('SQLite表重命名公开合同', () => {
  it('四命令严格解析，公开输入拒绝SQL/路径/私有回执回调和任意schema', () => {
    const inspect = { ...target, taskId: 'inspect' }, preview = { catalogueId: 'c', newName, taskId: 'preview' }, apply = { previewId: 'p', taskId: 'apply', confirmation: 'main.' + target.table };
    for (const command of ['sqlite.tableRename.inspect', 'sqlite.tableRename.preview', 'sqlite.tableRename.apply', 'sqlite.tableRename.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('sqlite.tableRename.inspect', inspect)).toEqual(inspect); expect(validateCommand('sqlite.tableRename.preview', preview)).toEqual(preview); expect(validateCommand('sqlite.tableRename.apply', apply)).toEqual(apply); expect(validateCommand('sqlite.tableRename.release', { catalogueId: 'c', previewId: 'p' })).toEqual({ catalogueId: 'c', previewId: 'p' });
    for (const key of ['sql', 'filePath', 'profile', 'operationId', 'recordTableRenameFact', 'assertCurrent']) { expect(sqliteTableRenameInspectSchema.safeParse({ ...inspect, [key]: 'private' }).success).toBe(false); expect(sqliteTableRenameApplySchema.safeParse({ ...apply, [key]: 'private' }).success).toBe(false); }
    expect(sqliteTableRenameInspectSchema.safeParse({ ...inspect, database: 'temp' }).success).toBe(false); expect(sqliteTableRenameReleaseSchema.safeParse({}).success).toBe(false);
  });
  it('完整xinfo与依赖目录原样通过，重复/超限/缺少定义或伪截断字段拒绝', () => {
    const original = inspection(); expect(sqliteTableRenameInspectionSchema.parse(original)).toEqual(original);
    for (const patch of [{ columns: [original.columns[0], { ...original.columns[0], cid: 1, name: 'ID' }] }, { columns: [{ ...original.columns[0], hidden: 4 }] }, { relatedObjects: [original.relatedObjects[0], original.relatedObjects[0]] }, { relatedObjects: Array.from({ length: sqliteTableRenameLimits.relatedObjects + 1 }, (_, index) => ({ ...original.relatedObjects[0], name: 't' + index })) }, { tableSql: '' }, { truncated: true }]) expect(sqliteTableRenameInspectionSchema.safeParse({ ...original, ...patch }).success).toBe(false);
  });
  it('一条准确引用的原生ALTER，名字完整保留且无法逃逸修改control', () => database(db => {
    db.exec('CREATE TABLE ' + quote(target.table) + '(id INTEGER PRIMARY KEY,note TEXT); CREATE TABLE control(value TEXT); INSERT INTO control VALUES (\'保持\'); INSERT INTO ' + quote(target.table) + ' VALUES(9223372036854775807,\'源值🚢\')');
    const plan = buildSqliteTableRenamePlan(target, newName); expect(plan.sql).toEqual(['ALTER TABLE main."原""表🚢" RENAME TO "新""表🚢;DROP TABLE control;--"']); db.exec(plan.sql[0]);
    const query = db.prepare('SELECT id,note FROM ' + quote(newName)); query.setReadBigInts(true); expect(query.get()).toEqual({ id: 9223372036854775807n, note: '源值🚢' }); expect(db.prepare('SELECT value FROM control').get()?.value).toBe('保持');
    const output = { previewId: 'p', catalogueId: 'c', target, newName, navigationIdentity, sql: plan.sql, confirmation: 'main.' + target.table, expiresAt: '2030-01-01T00:00:00Z' }; expect(sqliteTableRenamePreviewOutputSchema.parse(output)).toEqual(output);
    for (const patch of [{ sql: [] }, { sql: [...plan.sql, 'SELECT 1'] }, { confirmation: 'main.other' }, { newName: target.table }, { filePath: 'private' }]) expect(sqliteTableRenamePreviewOutputSchema.safeParse({ ...output, ...patch }).success).toBe(false);
  }));
  it('native重命名自动更新索引/视图/触发器/外键并保留AUTOINCREMENT高水位', () => database(db => {
    db.exec('CREATE TABLE source(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT); CREATE TABLE child(id INTEGER REFERENCES source(id)); CREATE INDEX by_note ON source(note); CREATE VIEW dependent AS SELECT note FROM source; CREATE TABLE audit(note TEXT); CREATE TRIGGER on_source AFTER INSERT ON source BEGIN INSERT INTO audit VALUES(new.note); END; INSERT INTO source(note) VALUES(\'原值\'); INSERT INTO child VALUES(1); INSERT INTO source(id,note) VALUES(100,\'已删除高水位\'); DELETE FROM source WHERE id=100');
    db.exec(buildSqliteTableRenamePlan({ ...target, table: 'source' }, 'destination').sql[0]);
    expect(db.prepare('SELECT * FROM dependent').all()).toEqual([{ note: '原值' }]); expect(db.prepare('PRAGMA foreign_key_list(child)').get()?.table).toBe('destination'); expect(db.prepare("SELECT tbl_name FROM sqlite_schema WHERE name='by_note'").get()?.tbl_name).toBe('destination');
    db.exec("INSERT INTO destination(note) VALUES('新值')"); expect(db.prepare('SELECT max(id) AS id FROM destination').get()?.id).toBe(101); expect(db.prepare('SELECT note FROM audit ORDER BY rowid DESC LIMIT 1').get()?.note).toBe('新值'); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='destination'").get()?.seq).toBe(101);
  }));
  it('名字拒绝保留前缀/NUL/坏Unicode/超长；大小写单独变更保留原请求供native判断', () => {
    for (const value of ['', 'sqlite_schema', 'SQLITE_user', 'x\0y', '\ud800', 'x'.repeat(513)]) expect(sqliteTableRenamePreviewSchema.safeParse({ catalogueId: 'c', taskId: 'p', newName: value }).success).toBe(false);
    expect(() => buildSqliteTableRenamePlan(target, target.table)).toThrow(); expect(() => buildSqliteTableRenamePlan({ ...target, table: 'sqlite_sequence' }, 'ordinary')).toThrow();
    expect(buildSqliteTableRenamePlan({ ...target, table: 'case' }, 'CASE').sql[0]).toBe('ALTER TABLE main."case" RENAME TO "CASE"'); expect(buildSqliteTableRenamePlan(target, '  空格原样  ').sql[0]).toContain('"  空格原样  "');
  });
  it('预算在深复制前拒绝访问器/循环/过大UTF8，不读取getter', () => {
    const getter = vi.fn(() => 'secret'), input = { catalogueId: 'c', taskId: 'p' }; Object.defineProperty(input, 'newName', { enumerable: true, get: getter }); expect(sqliteTableRenamePreviewSchema.safeParse(input).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    const original = inspection(); original.relatedObjects[0].sql = '🚢'.repeat(sqliteTableRenameLimits.ddlBytes / 4); expect(sqliteTableRenameInspectionSchema.safeParse(original).success).toBe(false);
    const cyclic: any = { ...target, taskId: 'p' }; cyclic.extra = cyclic; expect(sqliteTableRenameInspectSchema.safeParse(cyclic).success).toBe(false);
  });
  it('outcome必须携带原preview的新名且与原操作事实一致，新名不属于持久fact', () => {
    const fact = { operationId: 'operation', target, phase: 'committed', requestedStatements: 1, completedStatements: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, value = { operationId: 'operation', target, newName, navigationIdentity, outcome: 'committed', fact, message: '已确认', definitionVerified: true };
    expect(sqliteTableRenameOutcomeSchema.parse(value)).toEqual(value); for (const patch of [{ newName: undefined }, { newName: target.table }, { fact: { ...fact, newName } }, { operationId: 'other' }, { target: { ...target, table: 'other' } }]) expect(sqliteTableRenameOutcomeSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  });
  it('导航身份仅是有界会话回包能力，公开输入及持久fact不能传入或恢复它', () => {
    const value = inspection(); for (const identity of [undefined, '', 'A'.repeat(64), 'a'.repeat(63), 'x'.repeat(64)]) expect(sqliteTableRenameInspectionSchema.safeParse({ ...value, navigationIdentity: identity }).success).toBe(false);
    expect(sqliteTableRenameInspectSchema.safeParse({ ...target, taskId: 'read', navigationIdentity }).success).toBe(false); expect(sqliteTableRenamePreviewSchema.safeParse({ catalogueId: 'c', newName, taskId: 'preview', navigationIdentity }).success).toBe(false);
  });
});
