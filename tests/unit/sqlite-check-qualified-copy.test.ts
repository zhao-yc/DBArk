import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { compileSqliteTableRebuildCheckedCopyDefinition as compile, compileSqliteTableRebuildCopyDefinition, inspectSqliteTableChecks, type SqliteTableRebuildDefinitionInput } from '../../src/shared/sqliteTableRebuildPlan';

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const names = { candidate: '__dbark_rebuild_' + 'a'.repeat(32), ordinal: '__dbark_rebuild_order_' + 'b'.repeat(32), verification: '__dbark_rebuild_' + 'c'.repeat(32), verificationOrdinal: '__dbark_rebuild_order_' + 'd'.repeat(32) };
/** 仅使用当前进程native内存库；来源目录从实际sqlite_schema/table_xinfo读取。 */
function source(db: DatabaseSync, table = 'child', changes: SqliteTableRebuildDefinitionInput['changes'] = [{ column: 'a', default: { kind: 'integer', value: '2' } }]): SqliteTableRebuildDefinitionInput {
  return { table, tableSql: db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', table)!.sql as string, columns: db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(table).map(column => ({ name: String(column.name), hidden: Number(column.hidden) })), candidateName: names.candidate, changes };
}
/** 两个独立native表逐行核对值、存储类型、BLOB字节及64位整数，不用JSON或number近似替代。 */
function typed(db: DatabaseSync, table: string, columns: string[], order: string[] = ['id']) {
  const projection = columns.flatMap(column => ['typeof(' + quote(column) + ')', quote(column)]).map((value, index) => value + ' AS ' + quote('v' + index));
  return bigRows(db, 'SELECT ' + projection.join(',') + ' FROM ' + quote(table) + ' ORDER BY ' + order.map(quote).join(','));
}
/** Node原生setReadBigInts返回void；配置后再读取，整数始终以BigInt保真。 */
function bigRows(db: DatabaseSync, sql: string) { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(); }

/** 按候选/验证/最终三次真实复制证明原名CREATE路线；这是内存原型，不是Main执行能力。 */
function rebuildProof(db: DatabaseSync, input: SqliteTableRebuildDefinitionInput, withoutRowid: boolean, physicalRowid: boolean, beforeFinalCopy?: () => void) {
  const candidate = compile(input, names.ordinal), verification = compile({ ...input, candidateName: names.verification }, names.verificationOrdinal), columns = candidate.columnMapping.map(column => column.name), copied = candidate.columnMapping.filter(column => column.copy).map(column => column.name);
  const order = withoutRowid ? ['id', 'a'] : ['_rowid_'], compared = withoutRowid ? columns : ['_rowid_', ...columns], copyColumns = physicalRowid ? ['_rowid_', ...copied] : copied;
  const related = db.prepare("SELECT type,sql FROM sqlite_schema WHERE tbl_name='child' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
  const sequence = db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='sqlite_sequence'").get()!.n ? bigRows(db, "SELECT rowid,name,seq FROM sqlite_sequence WHERE name='child'")[0] : undefined;
  const comparisons: number[] = [];
  /** 四个证明点均独立从真实表读取完整存储类型和值，不以复制成功替代数据核对。 */
  const compare = (left: string, right: string) => { const rows = typed(db, left, compared, order); expect(typed(db, right, compared, order)).toEqual(rows); comparisons.push(rows.length); };
  /** 固定OR ABORT显式列复制，生成字段由native计算，最终复制不含私有序号。 */
  const copy = (from: string, to: string, ordinal?: string) => db.exec('INSERT OR ABORT INTO ' + quote(to) + '(' + [...copyColumns.map(quote), ...(ordinal ? [quote(ordinal)] : [])].join(',') + ') SELECT ' + [...copyColumns.map(quote), ...(ordinal ? ['ROW_NUMBER() OVER(ORDER BY ' + order.map(quote).join(',') + ')'] : [])].join(',') + ' FROM ' + quote(from));
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON'); expect(db.prepare('PRAGMA ignore_check_constraints').get()!.ignore_check_constraints).toBe(0);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(candidate.candidateSql); db.exec(candidate.createOrdinalIndexSql); copy('child', names.candidate, names.ordinal); compare('child', names.candidate);
    db.exec(verification.candidateSql); db.exec(verification.createOrdinalIndexSql); copy(names.candidate, names.verification, names.verificationOrdinal); compare(names.candidate, names.verification);
    for (const sql of candidate.removeOrdinalSql) db.exec(sql); compare(names.candidate, names.verification);
    expect(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(names.candidate)!.sql).toBe(candidate.privateSql);
    db.exec('DROP TABLE child'); db.exec(candidate.finalSql); beforeFinalCopy?.(); copy(names.candidate, 'child');
    for (const item of related) db.exec(String(item.sql)); compare('child', names.verification);
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='child'").get()!.sql).toBe(candidate.finalSql);
    db.exec('DROP TABLE ' + quote(names.candidate)); db.exec('DROP TABLE ' + quote(names.verification));
    if (db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='sqlite_sequence'").get()!.n) { db.prepare("DELETE FROM sqlite_sequence WHERE name='child'").run(); if (sequence) db.prepare('INSERT INTO sqlite_sequence(rowid,name,seq) VALUES(?,?,?)').run(sequence.rowid, sequence.name, sequence.seq); }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]); db.exec('COMMIT');
  } catch (reason) { db.exec('ROLLBACK'); throw reason; }
  finally { db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON'); }
  return { candidate, comparisons };
}

/** 四种真实表布局共同包含入/出外键、依赖视图、显式索引、触发器、生成字段及精度样本。 */
function graphFixture(kind: 'rowid' | 'autoincrement' | 'without-rowid' | 'strict', gate = false) {
  const db = new DatabaseSync(':memory:'); let allowed = true;
  if (gate) db.function('phase_gate', (_value) => allowed ? 1 : 0);
  const withoutRowid = kind === 'without-rowid', physicalRowid = kind === 'rowid', id = kind === 'autoincrement' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : kind === 'strict' ? 'INTEGER PRIMARY KEY' : 'INTEGER NOT NULL';
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(7); CREATE TABLE audit(id INTEGER); CREATE TABLE other_auto(id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO other_auto VALUES(9); UPDATE sqlite_sequence SET seq=99 WHERE name=\'other_auto\'');
    db.exec('CREATE TABLE child(id ' + id + ',a INTEGER CHECK(main.child.a>0),b TEXT NOT NULL,payload BLOB,measure REAL,p INTEGER REFERENCES parent(id),g INTEGER AS(length(b)) STORED CHECK("child"."g">0),v INTEGER AS(a*2) VIRTUAL,UNIQUE(id,a)' + (withoutRowid ? ',PRIMARY KEY(id ASC,a DESC)' : '') + ')' + (withoutRowid ? ' WITHOUT ROWID' : kind === 'strict' ? ' STRICT' : ''));
    db.exec('CREATE INDEX idx_child_measure ON child(measure DESC,b COLLATE NOCASE) WHERE a>0; CREATE VIEW child_view AS SELECT * FROM child; CREATE VIEW nested_view AS SELECT id,g FROM child_view; CREATE TRIGGER child_audit AFTER INSERT ON child BEGIN INSERT INTO audit VALUES(new.id); END');
    const target = (physicalRowid ? '_rowid_,' : '') + 'id,a,b,payload,measure,p';
    db.exec('INSERT INTO child(' + target + ') VALUES(' + (physicalRowid ? '-9223372036854775808,' : '') + "9007199254740993,1,'99999999999999999999.000000000000000001',X'00FF0080',1.25,7),(" + (physicalRowid ? '9007199254740997,' : '') + "9007199254740995,2,'中文与精度',X'',-3.5,7)");
    db.exec('CREATE TABLE inbound(id INTEGER PRIMARY KEY,child_id INTEGER,child_a INTEGER,FOREIGN KEY(child_id,child_a) REFERENCES child(id,a)); INSERT INTO inbound VALUES(1,9007199254740993,1)');
    if (kind === 'autoincrement') db.exec("UPDATE sqlite_sequence SET seq=9007199254741999 WHERE name='child'");
    const input = { ...source(db, 'child', [{ column: 'a', default: { kind: 'integer' as const, value: '3' } }]), checkEdits: [{ kind: 'add' as const, definition: { location: 'table' as const, name: 'new_range', expression: 'main.child.a<10 AND child.v<20' + (gate ? ' AND phase_gate(child.a)' : '') } }] };
    return { db, input, withoutRowid, physicalRowid, rejectFinal() { allowed = false; } };
  } catch (reason) { db.close(); throw reason; }
}

describe('SQLite限定CHECK私有复制定义', () => {
  it.each(['child.a', 'main.child.a', '"CHILD"."A"', '`child`.`a`', '[main].[child].[a]', "'child'.'a'", "main.'CHILD'.[a]", 'main /*库*/ . child --表\n . a'])('%s只在私有CHECK转为准确字段，最终原表达式保持', reference => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER CHECK(' + reference + '>0), b TEXT)');
      const input = source(db), output = compile(input, names.ordinal), original = inspectSqliteTableChecks(input)[0].expression;
      expect(output.qualifiedCheckReferences).toBe(1); expect(output.finalSql).toContain(original); expect(output.privateSql).toContain('"a">0');
      db.exec(output.candidateSql); db.prepare('INSERT INTO ' + quote(names.candidate) + '(a,' + quote(names.ordinal) + ') VALUES(?,?)').run(1, 1);
      expect(() => db.prepare('INSERT INTO ' + quote(names.candidate) + '(a,' + quote(names.ordinal) + ') VALUES(?,?)').run(-1, 2)).toThrow(/CHECK/);
      db.exec(output.createOrdinalIndexSql); for (const sql of output.removeOrdinalSql) db.exec(sql);
      expect(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(names.candidate)!.sql).toBe(output.privateSql);
      if (reference.includes('/*库*/')) { expect(output.privateSql).toContain('/*库*/'); expect(output.privateSql).toContain('--表\n'); }
    } finally { db.close(); }
  });
  it('带点、引号、中文的表名与字段名不会被按文本拆解，字段引用保留真实含义', () => {
    const db = new DatabaseSync(':memory:'), table = '账.表"名', column = '金.额"值'; try {
      const reference = quote('main') + '.' + quote(table) + '.' + quote(column); db.exec('CREATE TABLE ' + quote(table) + '(' + quote(column) + ' INTEGER CHECK(' + reference + '>0))');
      const output = compile(source(db, table, [{ column, default: { kind: 'integer', value: '3' } }]), names.ordinal); expect(output.qualifiedCheckReferences).toBe(1); expect(output.finalSql).toContain(reference); db.exec(output.candidateSql);
      const insert = db.prepare('INSERT INTO ' + quote(names.candidate) + '(' + quote(column) + ',' + quote(names.ordinal) + ') VALUES(?,?)'); insert.run(2, 1); expect(() => insert.run(-1, 2)).toThrow(/CHECK/);
    } finally { db.close(); }
  });
  it('字符串、JSON路径、注释、默认值和约束名均保持，普通字段不会改成字符串常量', () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec(`CREATE TABLE child(a INTEGER DEFAULT 1 CONSTRAINT "child.a" CHECK('child.a'='child.a' AND "child".'a'>0 /* main.child.a */),b TEXT DEFAULT 'main.child.a',CHECK(json_extract('{"child.a":1}','$."child.a"')=1))`);
      const output = compile(source(db), names.ordinal); expect(output.qualifiedCheckReferences).toBe(1); expect(output.privateSql).toContain('CONSTRAINT "child.a"'); expect(output.privateSql).toContain("DEFAULT 'main.child.a'"); expect(output.privateSql).toContain('/* main.child.a */'); expect(output.privateSql).toContain("'child.a'='child.a'"); db.exec(output.candidateSql);
      expect(() => db.prepare('INSERT INTO ' + quote(names.candidate) + '(a,' + quote(names.ordinal) + ') VALUES(?,?)').run(-1, 1)).toThrow(/CHECK/);
    } finally { db.close(); }
  });
  it.each(['other.a>0', 'temp.child.a>0', 'other.child.a>0', 'main.child.a.b>0', 'child.abs(a)>0', 'child.missing>0'])('未知或不完整限定%s不被修成另一合法语义', expression => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER)'); const output = compile({ ...source(db, 'child', []), checkEdits: [{ kind: 'add', definition: { location: 'table', name: null, expression } }] }, names.ordinal);
      expect(output.qualifiedCheckReferences).toBe(0); expect(output.privateSql).toContain(expression); expect(() => db.exec(output.candidateSql)).toThrow();
    } finally { db.close(); }
  });
  it('跨字段行内CHECK和虚拟/存储生成字段保留准确来源，重排后仍检查真实计算值', () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER CHECK(child.b>=child.a),b INTEGER,g INTEGER AS(a+b) STORED CHECK(main.child.g>0),v INTEGER AS(b-a) VIRTUAL)');
      const output = compile({ ...source(db), columnOrder: ['v', 'b', 'g', 'a'], checkEdits: [{ kind: 'add', definition: { location: 'column', column: 'v', name: 'nonnegative', expression: 'child.v>=0' } }] }, names.ordinal);
      expect(output.qualifiedCheckReferences).toBe(4); expect(output.columnMapping.map(column => [column.name, column.copy])).toEqual([['v', false], ['b', true], ['g', false], ['a', true]]); db.exec(output.candidateSql);
      db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(1,2,1)'); expect(() => db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(3,2,2)')).toThrow(/CHECK/);
      expect(db.prepare('SELECT v,b,g,a FROM ' + quote(names.candidate)).get()).toMatchObject({ v: 1, b: 2, g: 3, a: 1 });
    } finally { db.close(); }
  });
  it('同时增改删只迁移最终保留的CHECK，旧兼容冲突及重复声明不会消失', () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER CHECK(child.a>0),b INTEGER,CHECK(child.b>0),CHECK(child.b<10) ON CONFLICT IGNORE)'); const input = source(db), originals = inspectSqliteTableChecks(input);
      const output = compile({ ...input, checkEdits: [{ kind: 'remove', ordinal: 0, expectedSql: originals[0].sql }, { kind: 'replace', ordinal: 1, expectedSql: originals[1].sql, definition: { location: 'table', name: 'range', expression: 'main.child.b>=2' } }, { kind: 'add', definition: { location: 'table', name: 'extra', expression: 'child.a<0' } }] }, names.ordinal);
      expect(output.qualifiedCheckReferences).toBe(3); expect(output.finalSql).toContain('CHECK(child.b<10) ON CONFLICT IGNORE'); db.exec(output.candidateSql); db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(-1,2,1)'); expect(() => db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(-1,11,2)')).toThrow(/CHECK/);
    } finally { db.close(); }
  });
  it('未限定CHECK的旧完整复制SQL逐字保持，不改变原字段/主外键/UNIQUE组合', () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER PRIMARY KEY AUTOINCREMENT,b TEXT UNIQUE,CHECK(a>0))'); const input = source(db), old = compileSqliteTableRebuildCopyDefinition(input, names.ordinal), output = compile(input, names.ordinal);
      expect(output.qualifiedCheckReferences).toBe(0); for (const key of Object.keys(old) as (keyof typeof old)[]) expect(output[key]).toEqual(old[key]);
    } finally { db.close(); }
  });
  it('限定CHECK与主外键/UNIQUE名称循环交换、实际重排和默认值共同编译，不丢新旧声明', () => {
    const db = new DatabaseSync(':memory:'), final = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE child(a INTEGER CONSTRAINT p PRIMARY KEY CONSTRAINT c CHECK(main.child.a>=0),b INTEGER CONSTRAINT f REFERENCES parent(id),g INTEGER AS(a+b) STORED,CONSTRAINT u UNIQUE(b))');
      const input = source(db, 'child', [{ column: 'a', default: { kind: 'integer', value: '7' } }]), check = inspectSqliteTableChecks(input)[0];
      const output = compile({ ...input, columnOrder: ['g', 'b', 'a'], primaryKeyEdit: { kind: 'replace', expectedSql: 'CONSTRAINT p PRIMARY KEY', definition: { name: 'f', location: 'column', columns: [{ column: 'a', collation: null, order: null }], conflict: null, autoIncrement: true } }, foreignKeyEdits: [{ kind: 'replace', ordinal: 0, expectedSql: 'CONSTRAINT f REFERENCES parent(id)', definition: { name: 'u', columns: ['b'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'CASCADE', onDelete: 'RESTRICT', deferral: 'deferred' } }], uniqueEdits: [{ kind: 'replace', ordinal: 0, expectedSql: 'CONSTRAINT u UNIQUE(b)', definition: { name: 'c', location: 'table', columns: [{ column: 'b', collation: null, order: 'DESC' }], conflict: null } }], checkEdits: [{ kind: 'replace', ordinal: 0, expectedSql: check.sql, definition: { name: 'p', location: 'column', column: 'a', expression: 'main.child.a>=0 AND child.g>=0' } }] }, names.ordinal);
      expect(output.qualifiedCheckReferences).toBe(2); db.exec(output.candidateSql); db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(1,1,1)'); expect(() => db.exec('INSERT INTO ' + quote(names.candidate) + '(a,b,' + quote(names.ordinal) + ') VALUES(-2,1,2)')).toThrow(/CHECK/);
      final.exec('PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1)'); final.exec(output.finalSql); final.exec('INSERT INTO child(a,b) VALUES(1,1)'); expect(final.prepare('SELECT g,b,a FROM child').get()).toEqual({ g: 2, b: 1, a: 1 }); expect(final.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(final.prepare('PRAGMA table_xinfo(child)').all().map(column => column.name)).toEqual(['g', 'b', 'a']); expect(final.prepare('PRAGMA table_xinfo(child)').all().at(-1)!.dflt_value).toBe('7');
    } finally { db.close(); final.close(); }
  });
  it('新复制编译仍在任何spread前拒绝约束/顺序访问器，预览零求值', () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE child(a INTEGER CHECK(child.a>0))'); const get = vi.fn(() => []);
      for (const key of ['checkEdits', 'uniqueEdits', 'primaryKeyEdit', 'foreignKeyEdits', 'columnOrder']) { const input = source(db); Object.defineProperty(input, key, { get, enumerable: true }); expect(() => compile(input, names.ordinal)).toThrow(); }
      expect(get).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it.each(['rowid', 'autoincrement', 'without-rowid', 'strict'] as const)('%s原名CREATE路线保留完整依赖、精度和行身份，四次比较后提交', kind => {
    const f = graphFixture(kind), { db } = f;
    try {
      const columns = f.input.columns.map(column => column.name), order = f.withoutRowid ? ['id', 'a'] : ['_rowid_'], compared = f.withoutRowid ? columns : ['_rowid_', ...columns], before = typed(db, 'child', compared, order);
      const others = db.prepare("SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema WHERE tbl_name<>'child' ORDER BY type,name").all(), attached = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name='child' AND type<>'table' ORDER BY type,name").all();
      const audit = typed(db, 'audit', ['id']), inbound = typed(db, 'inbound', ['id', 'child_id', 'child_a']), sequences = bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid'), indexes = db.prepare('PRAGMA index_xinfo(idx_child_measure)').all();
      const result = rebuildProof(db, f.input, f.withoutRowid, f.physicalRowid);
      expect(result.comparisons).toEqual([2, 2, 2, 2]); expect(typed(db, 'child', compared, order)).toEqual(before);
      expect(db.prepare("SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema WHERE tbl_name<>'child' ORDER BY type,name").all()).toEqual(others); expect(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name='child' AND type<>'table' ORDER BY type,name").all()).toEqual(attached);
      expect(typed(db, 'audit', ['id'])).toEqual(audit); expect(typed(db, 'inbound', ['id', 'child_id', 'child_a'])).toEqual(inbound); expect(db.prepare('PRAGMA index_xinfo(idx_child_measure)').all()).toEqual(indexes); expect(bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid')).toEqual(sequences);
      expect(bigRows(db, 'SELECT id,g FROM nested_view ORDER BY id')).toEqual(bigRows(db, 'SELECT id,g FROM child ORDER BY id'));
      expect(inspectSqliteTableChecks(source(db, 'child', [])).map(check => check.expression)).toEqual(['main.child.a>0', '"child"."g">0', '\nmain.child.a<10 AND child.v<20\n']);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB '__dbark_rebuild_*'").all()).toEqual([]); expect(db.prepare("SELECT name FROM sqlite_sequence WHERE name GLOB '__dbark_rebuild_*'").all()).toEqual([]);
      for (const [a, p, message] of [[11, 7, /CHECK/], [-1, 7, /CHECK/], [3, 999, /FOREIGN KEY/]] as const) expect(() => db.exec("INSERT INTO child(id,a,b,payload,measure,p) VALUES(9007199254742010," + a + ",'拒绝样本',X'00',1.25," + p + ')')).toThrow(message);
      expect(() => db.exec("INSERT INTO child(id,a,b,payload,measure,p) VALUES(9007199254740993,1,'重复键',X'00',1.25,7)")).toThrow(/UNIQUE/);
      expect(typed(db, 'audit', ['id'])).toEqual(audit); expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1); expect(db.prepare('PRAGMA legacy_alter_table').get()!.legacy_alter_table).toBe(0); expect(db.prepare('PRAGMA ignore_check_constraints').get()!.ignore_check_constraints).toBe(0);
      db.exec("INSERT INTO child(id,a,b,payload,measure,p) VALUES(9007199254742010,3,'有效新行',X'0080',1.25,7)"); expect(db.prepare('SELECT count(*) AS n FROM audit').get()!.n).toBe(audit.length + 1); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    } finally { db.close(); }
  });
  it.each(['rowid', 'autoincrement', 'without-rowid', 'strict'] as const)('%s最终原名CHECK在原表已删除后失败，真实ROLLBACK恢复全部原定义和行', kind => {
    const f = graphFixture(kind, true), { db } = f;
    try {
      const original = db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all(), columns = f.input.columns.map(column => column.name), order = f.withoutRowid ? ['id', 'a'] : ['_rowid_'], compared = f.withoutRowid ? columns : ['_rowid_', ...columns], rows = typed(db, 'child', compared, order), audit = typed(db, 'audit', ['id']), inbound = typed(db, 'inbound', ['id', 'child_id', 'child_a']), sequences = bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid');
      const hook = vi.fn(() => { expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='child'").get()!.sql).toContain('CONSTRAINT "new_range"'); f.rejectFinal(); });
      expect(() => rebuildProof(db, f.input, f.withoutRowid, f.physicalRowid, hook)).toThrow(/CHECK/); expect(hook).toHaveBeenCalledTimes(1);
      expect(db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(original); expect(typed(db, 'child', compared, order)).toEqual(rows); expect(typed(db, 'audit', ['id'])).toEqual(audit); expect(typed(db, 'inbound', ['id', 'child_id', 'child_a'])).toEqual(inbound); expect(bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid')).toEqual(sequences);
      expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1); expect(db.prepare('PRAGMA legacy_alter_table').get()!.legacy_alter_table).toBe(0); expect(db.prepare('PRAGMA ignore_check_constraints').get()!.ignore_check_constraints).toBe(0); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    } finally { db.close(); }
  });
  it.each([false, true])('空自增表原序列存在性=%s仍准确保持，不用0值伪造不存在', present => {
    const f = graphFixture('autoincrement'), { db } = f; try {
      db.exec('DELETE FROM inbound; DELETE FROM child; DELETE FROM audit'); if (!present) db.exec("DELETE FROM sqlite_sequence WHERE name='child'");
      const before = bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid'), result = rebuildProof(db, f.input, false, false);
      expect(result.comparisons).toEqual([0, 0, 0, 0]); expect(bigRows(db, 'SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid')).toEqual(before); expect(bigRows(db, "SELECT rowid,name,seq FROM sqlite_sequence WHERE name='child'").length).toBe(present ? 1 : 0);
    } finally { db.close(); }
  });
});
