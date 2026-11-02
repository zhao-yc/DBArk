import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteTablePrimaryKey, sqliteTablePrimaryKeyEditSchema, sqliteTablePrimaryKeyLimits, sqlitePrimaryKeyConflicts, type SqliteTablePrimaryKeyDefinition } from '../../src/shared/sqliteTablePrimaryKey';
import { compileSqliteTablePrimaryKey as compile, inspectSqliteTablePrimaryKey as inspect, inspectSqliteTableForeignKeys, type SqliteRebuildSourceColumn } from '../../src/shared/sqliteTableRebuildPlan';
import { sqliteTableRebuildPreviewSchema } from '../../src/shared/sqliteTableRebuild';

const design = (patch: Partial<SqliteTablePrimaryKeyDefinition> = {}): SqliteTablePrimaryKeyDefinition => ({ name: 'new_pk', location: 'table', columns: [{ column: 'a', collation: null, order: null }], conflict: null, autoIncrement: false, ...patch });
/** 来源与候选在两座真实内存库独立验证，不执行任意文件或复用产品连接。 */
function fixture(sql = 'CREATE TABLE child(a TEXT,b INTEGER)') {
  const db = new DatabaseSync(':memory:'); try { db.exec(sql); } catch (reason) { db.close(); throw reason; }
  const tableSql = db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', 'child')!.sql as string;
  const columns: SqliteRebuildSourceColumn[] = db.prepare('PRAGMA table_xinfo(child)').all().map(column => ({ name: String(column.name), hidden: Number(column.hidden) }));
  const input = { table: 'child', tableSql, columns };
  return { db, input, validate(sql: string) { const candidate = new DatabaseSync(':memory:'); try { candidate.exec(sql); return candidate; } catch (reason) { candidate.close(); throw reason; } } };
}
/** 读取真实索引附属信息，排序规则和DESC不通过被测解析器自证。 */
function indexes(db: DatabaseSync) { return db.prepare('PRAGMA index_list(child)').all().filter(index => index.origin === 'pk').map(index => db.prepare('SELECT name,coll,"desc","key" FROM pragma_index_xinfo(?) ORDER BY seqno').all(index.name)); }

describe('SQLite主键准确声明定位与结构化编译', () => {
  it('无PK时不把字符串、注释、CHECK或外键中的PRIMARY KEY解释成主键', () => {
    const f = fixture(`CREATE TABLE child(a TEXT DEFAULT 'PRIMARY KEY(a)',b INTEGER CHECK(b>0) REFERENCES parent,/* PRIMARY KEY(b) */g TEXT AS(a||' PRIMARY KEY') VIRTUAL)`);
    try { expect(inspect(f.input)).toEqual({ primaryKey: null, strict: false, withoutRowid: false }); } finally { f.db.close(); }
  });
  it('行内主键完整读取命名、原文、冲突动作及DESC，并保持原列COLLATE为独立约束', () => {
    const f = fixture('CREATE TABLE child(a INTEGER COLLATE NOCASE CONSTRAINT "键,🚢" PRIMARY KEY DESC ON CONFLICT FAIL,b TEXT)');
    try { const value = inspect(f.input).primaryKey!; expect(value).toEqual({ location: 'column', column: 'a', sql: 'CONSTRAINT "键,🚢" PRIMARY KEY DESC ON CONFLICT FAIL', names: ['键,🚢'], columns: [{ column: 'a', collation: null, order: 'DESC' }], conflict: 'FAIL', autoIncrement: false }); expect(indexes(f.db)).toHaveLength(1); expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.columns[0])).toBe(true); } finally { f.db.close(); }
  });
  it('表级复合PK保留字段顺序、逐项COLLATE和ASC／DESC；WITHOUT ROWID与STRICT原样读取', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,CONSTRAINT "pk" PRIMARY KEY(a COLLATE NOCASE DESC,b ASC) ON CONFLICT ABORT) WITHOUT ROWID,STRICT');
    try { expect(inspect(f.input)).toMatchObject({ strict: true, withoutRowid: true, primaryKey: { location: 'table', names: ['pk'], columns: [{ column: 'a', collation: 'NOCASE', order: 'DESC' }, { column: 'b', collation: null, order: 'ASC' }], conflict: 'ABORT', autoIncrement: false } }); expect(indexes(f.db)[0].filter(row => row.key)).toEqual([{ name: 'a', coll: 'NOCASE', desc: 1, key: 1 }, { name: 'b', coll: 'BINARY', desc: 0, key: 1 }]); } finally { f.db.close(); }
  });
  it('原生重复字段PK准确读取，不按PRAGMA去重或猜测；新设计明确拒绝重复字段', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(a,a DESC))');
    try { expect(inspect(f.input).primaryKey?.columns.map(term => term.column)).toEqual(['a', 'a']); expect(() => buildSqliteTablePrimaryKey(design({ columns: [{ column: 'a', collation: null, order: null }, { column: 'A', collation: null, order: null }] }), f.input.columns)).toThrow(); } finally { f.db.close(); }
  });
  it.each([
    ['((a))', null, null], ['(((a)) DESC)', null, 'DESC'], ['((a COLLATE NOCASE) DESC)', 'NOCASE', 'DESC'],
    ['(a COLLATE NOCASE COLLATE RTRIM)', 'RTRIM', null], ['((a COLLATE NOCASE) COLLATE RTRIM DESC)', 'RTRIM', 'DESC'],
  ] as const)('合法旧字段表达式%s读取实际排序规则，明确替换才规范化', (body, collation, order) => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY' + body + ')');
    try { const old = inspect(f.input).primaryKey!; expect(old.columns).toEqual([{ column: 'a', collation, order }]); expect(indexes(f.db)[0][0]).toEqual({ name: 'a', coll: collation ?? 'BINARY', desc: order === 'DESC' ? 1 : 0, key: 1 }); const output = compile(f.input, { kind: 'replace', expectedSql: old.sql, definition: design({ columns: [{ column: 'a', collation, order }] }) }), next = f.validate(output.tableSql); try { expect(indexes(next)).toEqual(indexes(f.db)); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('移除行内PK仅删准确跨度；独立NOT NULL、UNIQUE、默认值、CHECK、FK和生成列保留', () => {
    const f = fixture(`CREATE TABLE child(a INTEGER CONSTRAINT p PRIMARY KEY ON CONFLICT IGNORE CONSTRAINT n NOT NULL DEFAULT (7) UNIQUE CHECK(a>0) REFERENCES parent(id),b TEXT,g TEXT AS(b||',PRIMARY KEY') STORED)`);
    try { const old = inspect(f.input).primaryKey!, output = compile(f.input, { kind: 'remove', expectedSql: old.sql }), next = f.validate(output.tableSql); try { expect(inspect({ ...f.input, tableSql: output.tableSql }).primaryKey).toBeNull(); for (const fragment of ['CONSTRAINT n NOT NULL DEFAULT (7) UNIQUE CHECK(a>0) REFERENCES parent(id)', "g TEXT AS(b||',PRIMARY KEY') STORED"]) expect(output.tableSql).toContain(fragment); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all().map(column => ({ ...column, pk: 0 }))); expect(inspectSqliteTableForeignKeys({ ...f.input, tableSql: output.tableSql })).toEqual(inspectSqliteTableForeignKeys(f.input)); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('表级主键删除保留前后注释和其它约束，完全移除时没有多余逗号', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER, /*头*/ CONSTRAINT p PRIMARY KEY(a,b) /*尾*/, -- 下一项\n CONSTRAINT c CHECK(b>0))');
    f.input.tableSql += ' /*表后*/;';
    try { const output = compile(f.input, { kind: 'remove', expectedSql: inspect(f.input).primaryKey!.sql }), next = f.validate(output.tableSql); try { for (const fragment of ['/*头*/', '/*尾*/', '-- 下一项', 'CONSTRAINT c CHECK(b>0)', '/*表后*/']) expect(output.tableSql).toContain(fragment); expect(indexes(next)).toEqual([]); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('%s新增PK以准确引用支持引号、逗号与非BMP名称', location => {
    const f = fixture('CREATE TABLE child("a,\""🚢" TEXT COLLATE NOCASE,b INTEGER)');
    try { const output = compile(f.input, { kind: 'add', definition: design({ location, name: '键"🚢', columns: [{ column: 'a,"🚢', collation: null, order: 'DESC' }] }) }), next = f.validate(output.tableSql); try { expect(next.prepare('PRAGMA table_xinfo(child)').all()[0].pk).toBe(1); expect(indexes(next)[0][0]).toEqual({ name: 'a,"🚢', coll: 'NOCASE', desc: 1, key: 1 }); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('替换复合主键可改变字段顺序与排序规则，原列声明及旁列约束保持', () => {
    const f = fixture('CREATE TABLE child(a TEXT COLLATE NOCASE,b INTEGER DEFAULT 3,CONSTRAINT p PRIMARY KEY(a,b),CONSTRAINT c CHECK(b>0))');
    try { const output = compile(f.input, { kind: 'replace', expectedSql: inspect(f.input).primaryKey!.sql, definition: design({ name: 'p', columns: [{ column: 'b', collation: null, order: 'DESC' }, { column: 'a', collation: 'RTRIM', order: 'ASC' }] }) }), next = f.validate(output.tableSql); try { expect(indexes(next)[0].filter(row => row.key)).toEqual([{ name: 'b', coll: 'BINARY', desc: 1, key: 1 }, { name: 'a', coll: 'RTRIM', desc: 0, key: 1 }]); expect(output.tableSql).toContain('a TEXT COLLATE NOCASE,b INTEGER DEFAULT 3'); expect(output.tableSql).toContain('CONSTRAINT c CHECK(b>0)'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('行内INTEGER PK DESC替换仍使用行内声明；显式改表级DESC才成为ROWID别名', () => {
    const f = fixture('CREATE TABLE child(a INTEGER PRIMARY KEY DESC,b TEXT)');
    try { for (const location of ['column', 'table'] as const) { const output = compile(f.input, { kind: 'replace', expectedSql: inspect(f.input).primaryKey!.sql, definition: design({ location, columns: [{ column: 'a', collation: null, order: 'DESC' }] }) }), next = f.validate(output.tableSql); try { expect(indexes(next)).toHaveLength(location === 'column' ? 1 : 0); next.exec('INSERT INTO child(a,b) VALUES(NULL,\'原\')'); expect(next.prepare('SELECT rowid AS physical,a FROM child').get()).toEqual({ physical: 1, a: location === 'column' ? null : 1 }); } finally { next.close(); } } } finally { f.db.close(); }
  });
  it.each(sqlitePrimaryKeyConflicts)('%s实际冲突策略由native验证，强制INSERT OR ABORT始终拒绝丢行', conflict => {
    const f = fixture();
    try { const output = compile(f.input, { kind: 'add', definition: design({ conflict }) }), next = f.validate(output.tableSql); try { next.exec("INSERT INTO child VALUES('same',1)"); if (conflict === 'IGNORE' || conflict === 'REPLACE') { next.exec("INSERT INTO child VALUES('same',2)"); expect(next.prepare('SELECT b FROM child').get()!.b).toBe(conflict === 'IGNORE' ? 1 : 2); } else expect(() => next.exec("INSERT INTO child VALUES('same',2)")).toThrow(/UNIQUE/); expect(() => next.exec("INSERT OR ABORT INTO child VALUES('same',3)")).toThrow(/UNIQUE/); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(1); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('%s自增声明保留真实序列与未来不复用语义，表级AUTOINCREMENT位于列表内', location => {
    const f = fixture('CREATE TABLE child(a "INTEGER",b TEXT)');
    try { const output = compile(f.input, { kind: 'add', definition: design({ location, autoIncrement: true }) }), next = f.validate(output.tableSql); try { expect(inspect({ ...f.input, tableSql: output.tableSql }).primaryKey?.autoIncrement).toBe(true); next.exec('INSERT INTO child VALUES(9000,\'高水位\');DELETE FROM child;INSERT INTO child(b) VALUES(\'新\')'); expect(next.prepare('SELECT a FROM child').get()!.a).toBe(9001); expect(next.prepare('SELECT seq FROM sqlite_sequence WHERE name=\'child\'').get()!.seq).toBe(9001); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('表级INTEGER DESC AUTOINCREMENT仍是ROWID别名，不能与行内DESC等同', () => {
    const f = fixture('CREATE TABLE child(a INTEGER,b TEXT,PRIMARY KEY(a DESC AUTOINCREMENT) ON CONFLICT REPLACE)');
    try { expect(inspect(f.input).primaryKey).toMatchObject({ location: 'table', autoIncrement: true, conflict: 'REPLACE', columns: [{ column: 'a', collation: null, order: 'DESC' }] }); const output = compile(f.input, { kind: 'replace', expectedSql: inspect(f.input).primaryKey!.sql, definition: design({ autoIncrement: true, columns: [{ column: 'a', collation: null, order: 'DESC' }] }) }), next = f.validate(output.tableSql); try { expect(indexes(next)).toEqual([]); next.exec("INSERT INTO child(b) VALUES('原')"); expect(next.prepare('SELECT rowid,a FROM child').get()).toEqual({ a: 1 }); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['INT', 'BIGINT', 'INTEGER(8)', 'TEXT'])('自增不能从类型%s猜测INTEGER身份', type => {
    const f = fixture(`CREATE TABLE child(a ${type},b TEXT)`); try { expect(() => compile(f.input, { kind: 'add', definition: design({ autoIncrement: true }) })).toThrow(/准确单列INTEGER/); } finally { f.db.close(); }
  });
  it('WITHOUT ROWID不可直接删PK，可完整替换；表选项保持，native核对新主键顺序', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID, STRICT');
    try { const old = inspect(f.input).primaryKey!; expect(() => compile(f.input, { kind: 'remove', expectedSql: old.sql })).toThrow(/必须保留主键/); expect(() => compile(f.input, { kind: 'replace', expectedSql: old.sql, definition: design({ autoIncrement: true }) })).toThrow(); const output = compile(f.input, { kind: 'replace', expectedSql: old.sql, definition: design({ columns: [{ column: 'b', collation: null, order: null }, { column: 'a', collation: null, order: null }] }) }), next = f.validate(output.tableSql); try { expect(output).toMatchObject({ withoutRowid: true, strict: true }); expect(next.prepare('SELECT wr,strict FROM pragma_table_list WHERE name=\'child\'').get()).toEqual({ wr: 1, strict: 1 }); expect(next.prepare('PRAGMA table_xinfo(child)').all().map(column => column.pk)).toEqual([2, 1]); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each([false, true])('普通复合PK与STRICT=%s的NULL规则交给native，不擅自补NOT NULL', strict => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER)' + (strict ? ' STRICT' : ''));
    try { const output = compile(f.input, { kind: 'add', definition: design({ columns: [{ column: 'a', collation: null, order: null }, { column: 'b', collation: null, order: null }] }) }), next = f.validate(output.tableSql); try { expect(output.tableSql).not.toContain('NOT NULL'); if (strict) expect(() => next.exec('INSERT INTO child VALUES(NULL,1)')).toThrow(/NOT NULL/); else { next.exec('INSERT INTO child VALUES(NULL,1),(NULL,1)'); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(2); } } finally { next.close(); } } finally { f.db.close(); }
  });
  it('保留已存在的重复／特殊命名标记，只有明确替换准确原SQL才移除其归属', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT "" CONSTRAINT p PRIMARY KEY CONSTRAINT dangling,b INTEGER CONSTRAINT p CHECK(b>0))');
    try { const key = inspect(f.input).primaryKey!; expect(key.names).toEqual(['', 'p']); expect(() => compile(f.input, { kind: 'replace', expectedSql: key.sql, definition: design({ name: 'p' }) })).toThrow(/保留的原约束名冲突/); const output = compile(f.input, { kind: 'replace', expectedSql: key.sql, definition: design({ name: null, location: 'column' }) }), next = f.validate(output.tableSql); try { expect(output.tableSql).toContain('CONSTRAINT dangling'); expect(output.tableSql).toContain('CONSTRAINT p CHECK(b>0)'); expect(inspect({ ...f.input, tableSql: output.tableSql }).primaryKey?.names).toEqual([]); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('原PK准确SQL不匹配、存在性变化或名称冲突均拒绝；不触碰来源数据库', () => {
    const f = fixture('CREATE TABLE child(a TEXT PRIMARY KEY,b INTEGER CONSTRAINT kept CHECK(b>0))');
    try { const original = f.db.prepare('SELECT sql FROM sqlite_schema').all(); expect(() => compile(f.input, { kind: 'add', definition: design() })).toThrow(/存在性已变化/); expect(() => compile(f.input, { kind: 'remove', expectedSql: 'PRIMARY KEY DESC' })).toThrow(/声明或存在性/); expect(() => compile(f.input, { kind: 'replace', expectedSql: 'PRIMARY KEY', definition: design({ name: 'KEPT' }) })).toThrow(/保留的原约束名冲突/); expect(f.db.prepare('SELECT sql FROM sqlite_schema').all()).toEqual(original); } finally { f.db.close(); }
  });
  it.each(['missing', 'A', 'g'])('新PK必须准确选择普通字段%s，不接受近似名称或生成字段', column => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,g TEXT AS(a) VIRTUAL)'); try { expect(() => compile(f.input, { kind: 'add', definition: design({ columns: [{ column, collation: null, order: null }] }) })).toThrow(); } finally { f.db.close(); }
  });
  it('新行内主键插入于尾部孤立命名前，不把该命名标记变成新主键名', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT dangling,b INTEGER)'); try { const output = compile(f.input, { kind: 'add', definition: design({ location: 'column', name: null }) }), next = f.validate(output.tableSql); try { expect(inspect({ ...f.input, tableSql: output.tableSql }).primaryKey?.names).toEqual([]); expect(output.tableSql).toContain('CONSTRAINT dangling'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['CHECK', 'UNIQUE', 'FOREIGN'])('新增主键名不能与保留%s约束冲突', kind => {
    const constraint = kind === 'CHECK' ? 'CHECK(b>0)' : kind === 'UNIQUE' ? 'UNIQUE(b)' : 'FOREIGN KEY(b) REFERENCES parent(id)', f = fixture(`CREATE TABLE child(a TEXT,b INTEGER,CONSTRAINT kept ${constraint})`);
    try { expect(() => compile(f.input, { kind: 'add', definition: design({ name: 'kept' }) })).toThrow(/约束名冲突/); } finally { f.db.close(); }
  });
  it('新编译器不开放原重建IPC的主键输入，未接入完整事务证明前严格拒绝', () => {
    const original = { catalogueId: 'owned', taskId: 'preview', changes: [{ column: 'a', declaredType: 'TEXT' }] };
    expect(sqliteTableRebuildPreviewSchema.safeParse(original).success).toBe(true);
    expect(sqliteTableRebuildPreviewSchema.safeParse({ ...original, primaryKeyEdit: { kind: 'add', definition: design() } }).success).toBe(false);
  });
  it.each([
    'CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(+a))', 'CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(lower(a)))',
    'CREATE TABLE child(a TEXT PRIMARY KEY,b INTEGER PRIMARY KEY)', 'CREATE TABLE child(a INTEGER PRIMARY KEY DESC AUTOINCREMENT,b TEXT)',
    'CREATE TABLE child(a TEXT,b INTEGER) WITHOUT ROWID', 'CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(gone))',
  ])('不能确认的源声明不生成可执行候选：%s', tableSql => {
    const source = { table: 'child', tableSql, columns: [{ name: 'a', hidden: 0 }, { name: 'b', hidden: 0 }] }; expect(() => inspect(source)).toThrow(); expect(() => compile(source, { kind: 'add', definition: design() })).toThrow();
  });
  it.each([
    design({ location: 'column', columns: [{ column: 'a', collation: 'NOCASE', order: null }] }),
    design({ location: 'column', autoIncrement: true, columns: [{ column: 'a', collation: null, order: 'DESC' }] }),
    design({ location: 'column', columns: [{ column: 'a', collation: null, order: null }, { column: 'b', collation: null, order: null }] }),
    design({ conflict: 'ABORT; DROP TABLE child' as any }),
  ])('不一致或注入式新设计被整项拒绝', definition => {
    expect(() => buildSqliteTablePrimaryKey(definition, [{ name: 'a', hidden: 0 }, { name: 'b', hidden: 0 }])).toThrow();
  });
  it('访问器、循环、稀疏、原型、symbol和UTF8预算在深解析前拒绝，不执行getter', () => {
    const getter = vi.fn(() => 'add'), accessor = Object.defineProperty({ definition: design() }, 'kind', { enumerable: true, get: getter }), cyclic: Record<string, unknown> = { kind: 'add' }; cyclic.definition = cyclic;
    const sparse = design(); sparse.columns = new Array(2); const symbol = { kind: 'add', definition: design(), [Symbol('界外')]: true };
    for (const value of [accessor, cyclic, { kind: 'add', definition: sparse }, Object.create({ kind: 'add' }), symbol, { kind: 'remove', expectedSql: '🚢'.repeat(sqliteTablePrimaryKeyLimits.bytes / 4) }]) expect(sqliteTablePrimaryKeyEditSchema.safeParse(value).success).toBe(false);
    expect(getter).not.toHaveBeenCalled(); const sourceGetter = vi.fn(() => 'child'); expect(() => inspect(Object.defineProperty({ tableSql: 'CREATE TABLE child(a TEXT)', columns: [{ name: 'a', hidden: 0 }] }, 'table', { get: sourceGetter }) as any)).toThrow(); expect(sourceGetter).not.toHaveBeenCalled();
  });
  it.each(['a\0b', '\ud800', 'a'.repeat(513)])('新名称或排序规则无效时整项拒绝', invalid => {
    for (const definition of [design({ name: invalid }), design({ columns: [{ column: 'a', collation: invalid, order: null }] })]) expect(() => buildSqliteTablePrimaryKey(definition, [{ name: 'a', hidden: 0 }])).toThrow();
  });
});
