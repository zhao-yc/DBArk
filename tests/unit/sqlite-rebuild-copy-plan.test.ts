import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileSqliteTableRebuildCopyDefinition as compile, compileSqliteTableRebuildDefinition, type SqliteRebuildColumnChange, type SqliteTableRebuildDefinitionInput } from '../../src/shared/sqliteTableRebuildPlan';

const candidate = '__dbark_rebuild_0123456789abcdef0123456789abcdef', ordinal = '__dbark_rebuild_order_fedcba9876543210fedcba9876543210';
const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';
/** 独立内存native校准临时编号方案；不访问真实文件，不冒充Main正式提交或GUI验收。 */
async function fixture(sql: string, action: (db: DatabaseSync, input: SqliteTableRebuildDefinitionInput) => void | Promise<void>): Promise<void> {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: false, enableForeignKeyConstraints: true, allowExtension: false, defensive: true });
  try {
    db.exec(sql); const tableSql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='target'").get()!.sql as string;
    const columns = db.prepare("SELECT name,hidden FROM pragma_table_xinfo('target') ORDER BY cid").all().map(row => ({ name: row.name as string, hidden: row.hidden as number }));
    await action(db, { table: 'target', tableSql, columns, candidateName: candidate, changes: [{ column: columns[0].name, default: { kind: 'none' } }] });
  } finally { db.close(); }
}
function rows(db: DatabaseSync, sql: string) { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(); }
function definition(db: DatabaseSync, table: string) { return db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(table)!.sql as string; }
function xinfo(db: DatabaseSync, table: string) { return db.prepare('SELECT cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(table); }
/** 源排序明确BINARY以消除列collation与PK不同导致的tie；按真实完整行身份排序，而非标签页当前sort。 */
function copySql(input: SqliteTableRebuildDefinitionInput, sourceOrder: string[], preserveRowid?: string): string {
  const names = input.columns.filter(column => column.hidden === 0).map(column => q(column.name));
  return 'INSERT OR ABORT INTO ' + q(candidate) + '(' + [q(ordinal), ...(preserveRowid ? [q(preserveRowid)] : []), ...names].join(',') + ') SELECT ROW_NUMBER() OVER(ORDER BY ' + sourceOrder.map(name => q(name) + ' COLLATE BINARY ASC').join(',') + '),' + [...(preserveRowid ? [q(preserveRowid)] : []), ...names].join(',') + ' FROM main.target';
}
/** 原DDL候选的native目录是移除私有字段后的独立预期，不从实际迁移结果反推成功条件。 */
function expectedDefinition(db: DatabaseSync, input: SqliteTableRebuildDefinitionInput): string {
  const pure = compileSqliteTableRebuildDefinition(input); db.exec(pure.candidateSql); const expected = definition(db, candidate); db.exec('DROP TABLE ' + q(candidate)); return expected;
}

describe('SQLite私有复制编号的原生结构、行身份和依赖校准', () => {
  it('编号在原列前加入，删除后原cid/约束/生成列/SQL精确复原，外部依赖和高水位保持', async () => {
    await fixture(`CREATE TABLE target( /* 保留首字段前注释 */
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code VARCHAR(20) UNIQUE NOT NULL,
      parent TEXT REFERENCES target(code) ON DELETE CASCADE,
      note TEXT DEFAULT 'old' CHECK(length(note)>0),
      raw BLOB,
      generated TEXT AS (code||hex(raw)) STORED
    ); CREATE INDEX old_index ON target(note) WHERE note<>'excluded';
    CREATE TABLE child(id INTEGER PRIMARY KEY,code TEXT REFERENCES target(code) ON DELETE CASCADE);
    CREATE TABLE audit(value TEXT); CREATE TRIGGER tracked AFTER UPDATE OF code ON target BEGIN INSERT INTO audit VALUES(new.code); END;
    CREATE VIEW viewed AS SELECT id,code FROM target;
    INSERT INTO target(id,code,parent,note,raw) VALUES(-77,'a',NULL,'old',X'00ff'),(9223372036854775807,'b','a','old',X'0001');
    INSERT INTO child VALUES(1,'a'); UPDATE sqlite_sequence SET seq=9223372036854775807 WHERE name='target';`, (db, original) => {
      const input = { ...original, changes: [{ column: 'code', declaredType: 'TEXT' }, { column: 'note', default: { kind: 'text', value: 'new' } }] satisfies SqliteRebuildColumnChange[] };
      const sourceRows = rows(db, 'SELECT rowid,* FROM target ORDER BY rowid'), originalChildren = rows(db, 'SELECT * FROM child'), originalAudit = rows(db, 'SELECT * FROM audit');
      const external = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name IN ('child','viewed','audit') ORDER BY name").all();
      const attached = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='target' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
      db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
      const expected = expectedDefinition(db, input), plan = compile(input, ordinal);
      db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['id']));
      expect(rows(db, 'SELECT ' + q(ordinal) + ' FROM ' + q(candidate) + ' ORDER BY ' + q(ordinal))).toEqual([{ [ordinal]: 1n }, { [ordinal]: 2n }]);
      expect(rows(db, 'SELECT id,code,parent,note,raw,generated FROM ' + q(candidate) + ' ORDER BY id')).toEqual(rows(db, 'SELECT id,code,parent,note,raw,generated FROM target ORDER BY id'));
      expect(rows(db, 'SELECT * FROM audit')).toEqual(originalAudit);
      for (const sql of plan.removeOrdinalSql) db.exec(sql);
      expect(definition(db, candidate)).toBe(expected);
      const expectedColumns = xinfo(db, 'target').map(column => column.name === 'code' ? { ...column, type: 'TEXT' } : column.name === 'note' ? { ...column, dflt_value: "'new'" } : column);
      expect(xinfo(db, candidate)).toEqual(expectedColumns);
      db.exec('DROP TABLE target; ALTER TABLE ' + q(candidate) + ' RENAME TO target');
      for (const object of attached) db.exec(object.sql as string);
      // 保留真实高水位；这里id已达maxint64，实际未来插入不能假定可继续增长。
      expect(rows(db, "SELECT seq FROM sqlite_sequence WHERE name='target'")).toEqual([{ seq: 9223372036854775807n }]);
      expect(rows(db, 'SELECT rowid,* FROM target ORDER BY rowid')).toEqual(sourceRows);
      expect(rows(db, 'SELECT * FROM child')).toEqual(originalChildren); expect(rows(db, 'SELECT * FROM audit')).toEqual(originalAudit);
      expect(db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name IN ('child','viewed','audit') ORDER BY name").all()).toEqual(external);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.exec('COMMIT; PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON');
      db.exec("UPDATE target SET code='b-new' WHERE id=9223372036854775807"); expect(rows(db, 'SELECT value FROM audit')).toEqual([{ value: 'b-new' }]);
    });
  });

  it.each(['', 'DESC'])('普通rowid与INTEGER PRIMARY KEY %s分开保留，不把DESC误当真实别名', async descending => {
    await fixture(`CREATE TABLE target(id INTEGER PRIMARY KEY ${descending},note TEXT); INSERT INTO target(rowid,id,note) VALUES(-77,${descending ? '4' : '-77'},'a'),(9223372036854775807,${descending ? '5' : '9223372036854775807'},'b')`, (db, source) => {
      const input = { ...source, changes: [{ column: 'id', declaredType: 'TEXT' }] }, plan = compile(input, ordinal);
      const before = rows(db, 'SELECT rowid AS physical_rowid,CAST(id AS TEXT) AS id,note FROM target ORDER BY rowid');
      db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['_rowid_'], '_rowid_'));
      for (const sql of plan.removeOrdinalSql) db.exec(sql);
      expect(rows(db, 'SELECT rowid AS physical_rowid,id,note FROM ' + q(candidate) + ' ORDER BY rowid')).toEqual(before); db.exec('ROLLBACK');
      expect(rows(db, 'SELECT rowid AS physical_rowid,CAST(id AS TEXT) AS id,note FROM target ORDER BY rowid')).toEqual(before);
    });
  });

  it('WITHOUT ROWID转换主键类型改变物理顺序后，ordinal仍和原行一一对应', async () => {
    await fixture("CREATE TABLE target(id INTEGER,note TEXT, PRIMARY KEY(id,note)) WITHOUT ROWID; INSERT INTO target VALUES(2,'a'),(10,'a')", (db, source) => {
      const input = { ...source, changes: [{ column: 'id', declaredType: 'TEXT' }] }, plan = compile(input, ordinal);
      db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['id', 'note']));
      expect(rows(db, 'SELECT id,' + q(ordinal) + ' FROM ' + q(candidate) + ' ORDER BY id')).toEqual([{ id: '10', [ordinal]: 2n }, { id: '2', [ordinal]: 1n }]);
      for (const sql of plan.removeOrdinalSql) db.exec(sql);
      expect(xinfo(db, candidate).map(row => row.cid)).toEqual([0, 1]); expect(rows(db, 'SELECT id,note FROM ' + q(candidate) + ' ORDER BY id')).toEqual([{ id: '10', note: 'a' }, { id: '2', note: 'a' }]); db.exec('ROLLBACK');
    });
  });

  it('列NOCASE与主键BINARY排序不同也用明确全键排序，不能依赖默认collation的tie', async () => {
    await fixture("CREATE TABLE target(code TEXT COLLATE NOCASE,note INTEGER,PRIMARY KEY(code COLLATE BINARY,note)) WITHOUT ROWID; INSERT INTO target VALUES('a',1),('A',1)", (db, input) => {
      const plan = compile(input, ordinal); db.exec('BEGIN'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['code', 'note']));
      expect(rows(db, 'SELECT code,' + q(ordinal) + ' FROM ' + q(candidate) + ' ORDER BY ' + q(ordinal))).toEqual([{ code: 'A', [ordinal]: 1n }, { code: 'a', [ordinal]: 2n }]); db.exec('ROLLBACK');
    });
  });

  it('OR ABORT覆盖原ON CONFLICT IGNORE/REPLACE，不允许亲和性转换静默丢行', async () => {
    await fixture("CREATE TABLE target(id BLOB PRIMARY KEY ON CONFLICT IGNORE,note TEXT); INSERT INTO target VALUES(1,'numeric'),('1','text')", (db, source) => {
      const input = { ...source, changes: [{ column: 'id', declaredType: 'TEXT' }] }, plan = compile(input, ordinal), before = rows(db, 'SELECT rowid,* FROM target ORDER BY rowid');
      db.exec('BEGIN'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); expect(() => db.exec(copySql(input, ['_rowid_'], '_rowid_'))).toThrow(); db.exec('ROLLBACK');
      expect(rows(db, 'SELECT rowid,* FROM target ORDER BY rowid')).toEqual(before); expect(db.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(candidate)).toBeUndefined();
    });
  });

  it('全部伪rowid名遮蔽后，INTEGER主键改INT会让隐藏rowid变号，用户列全等也不能作为通过证据', async () => {
    await fixture("CREATE TABLE target(rowid TEXT,_rowid_ TEXT,oid TEXT,id INTEGER PRIMARY KEY,payload TEXT); INSERT INTO target VALUES('r1','u1','o1',123,'a'),('r2','u2','o2',987,'b')", (db, source) => {
      const input = { ...source, changes: [{ column: 'id', declaredType: 'INT' }] }, plan = compile(input, ordinal), before = rows(db, 'SELECT rowid,_rowid_,oid,id,payload FROM target ORDER BY id');
      db.exec('BEGIN'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['id']));
      expect(rows(db, 'SELECT rowid,_rowid_,oid,id,payload FROM ' + q(candidate) + ' ORDER BY id')).toEqual(before);
      // 仅在合成候选审计时移除遮蔽列来暴露实际rowid；产品不能靠这种改变用户列的方式验收。
      db.exec('ALTER TABLE ' + q(candidate) + ' DROP COLUMN rowid');
      expect(rows(db, 'SELECT rowid AS physical_rowid,id FROM ' + q(candidate) + ' ORDER BY id')).toEqual([{ physical_rowid: 1n, id: 123n }, { physical_rowid: 2n, id: 987n }]); db.exec('ROLLBACK');
      expect(rows(db, 'SELECT rowid,_rowid_,oid,id,payload FROM target ORDER BY id')).toEqual(before);
    });
  });

  it('1024个用户列可加私有第1025列，删除后目录和原null行完全恢复', async () => {
    const names = Array.from({ length: 1024 }, (_, index) => 'c' + index);
    await fixture('CREATE TABLE target(' + names.map(name => q(name) + ' TEXT').join(',') + '); INSERT INTO target DEFAULT VALUES', (db, input) => {
      db.limits.column = Math.min(db.limits.column, 2050); const plan = compile(input, ordinal); db.exec('BEGIN'); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['_rowid_'], '_rowid_'));
      expect(xinfo(db, candidate)).toHaveLength(1025); for (const sql of plan.removeOrdinalSql) db.exec(sql); expect(xinfo(db, candidate)).toEqual(xinfo(db, 'target'));
      expect(db.prepare('SELECT count(*) AS n FROM ' + q(candidate)).get()!.n).toBe(1); db.exec('ROLLBACK');
    });
  });

  it('候选无法解析旧限定CHECK时原库仍完整，不能据编译成功宣称可重建', async () => {
    await fixture('CREATE TABLE target(x INTEGER CHECK(target.x>0)); INSERT INTO target VALUES(7)', (db, input) => {
      const plan = compile(input, ordinal), before = definition(db, 'target'); db.exec('BEGIN'); expect(() => db.exec(plan.candidateSql)).toThrow(); db.exec('ROLLBACK');
      expect(definition(db, 'target')).toBe(before); expect(rows(db, 'SELECT * FROM target')).toEqual([{ x: 7n }]);
    });
  });

  it('原首字段前的行注释和引用名在移除ordinal后逐字保留', async () => {
    await fixture('CREATE TABLE target( -- 首列之前\n [quoted first] TEXT, g AS (length([quoted first])) VIRTUAL); INSERT INTO target([quoted first]) VALUES(\'中文🚢\')', (db, input) => {
      db.exec('BEGIN'); const expected = expectedDefinition(db, input), plan = compile(input, ordinal); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['_rowid_'], '_rowid_'));
      for (const sql of plan.removeOrdinalSql) db.exec(sql); expect(definition(db, candidate)).toBe(expected); expect(rows(db, 'SELECT * FROM ' + q(candidate))).toEqual(rows(db, 'SELECT * FROM target')); db.exec('ROLLBACK');
    });
  });

  it('关闭DQS时无关旧双引号view也可能阻止DROP ordinal，明确回滚保持全部原定义', async () => {
    await fixture('CREATE TABLE target(x TEXT); CREATE VIEW legacy AS SELECT "old literal" AS val FROM target; INSERT INTO target VALUES(\'原值\')', (db, input) => {
      const before = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
      db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN'); const plan = compile(input, ordinal); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['_rowid_'], '_rowid_'));
      db.exec(plan.removeOrdinalSql[0]); expect(() => db.exec(plan.removeOrdinalSql[1])).toThrow(); db.exec('ROLLBACK');
      expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(before); expect(rows(db, 'SELECT * FROM target')).toEqual([{ x: '原值' }]);
    });
  });

  it('复制当前行会重置已删除的AUTOINCREMENT高水位，必须额外准确恢复', async () => {
    await fixture('CREATE TABLE target(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT); INSERT INTO target VALUES(1,\'保留\'),(9000,\'已删除\'); DELETE FROM target WHERE id=9000', (db, input) => {
      const sequence = rows(db, "SELECT seq FROM sqlite_sequence WHERE name='target'"); expect(sequence).toEqual([{ seq: 9000n }]);
      db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN'); const plan = compile(input, ordinal); db.exec(plan.candidateSql); db.exec(plan.createOrdinalIndexSql); db.exec(copySql(input, ['id']));
      for (const sql of plan.removeOrdinalSql) db.exec(sql); db.exec('DROP TABLE target; ALTER TABLE ' + q(candidate) + ' RENAME TO target');
      expect(rows(db, "SELECT seq FROM sqlite_sequence WHERE name='target'")).toEqual([{ seq: 1n }]);
      db.prepare("DELETE FROM sqlite_sequence WHERE name='target'").run(); db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('target', sequence[0].seq);
      expect(rows(db, "SELECT seq FROM sqlite_sequence WHERE name='target'")).toEqual(sequence); db.exec('ROLLBACK');
      expect(rows(db, "SELECT seq FROM sqlite_sequence WHERE name='target'")).toEqual(sequence);
    });
  });

  it('严格私有ordinal名称与已有列冲突均拒绝，不额外授予SQL入口', async () => {
    await fixture('CREATE TABLE target(x TEXT)', (_db, input) => {
      for (const name of ['', ordinal + '\n', ordinal + ';', 'user-column']) expect(() => compile(input, name)).toThrow();
      expect(() => compile({ ...input, columns: [{ name: ordinal.toUpperCase(), hidden: 0 }] }, ordinal)).toThrow();
    });
  });
});
