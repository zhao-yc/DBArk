import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteTableUnique, sqliteTableUniqueDefinitionSchema, sqliteTableUniqueEditsSchema, sqliteTableUniqueLimits, sqliteUniqueConflicts, type SqliteTableUniqueDefinition } from '../../src/shared/sqliteTableUnique';
import { compileSqliteTableUniques as compile, inspectSqliteTableUniques as inspect, compileSqliteTableRebuildDefinition, inspectSqliteTablePrimaryKey, inspectSqliteTableForeignKeys } from '../../src/shared/sqliteTableRebuildPlan';
import { sqliteTableRebuildPreviewSchema } from '../../src/shared/sqliteTableRebuild';

/** 来源和候选分别使用独立真实SQLite内存库，不打开业务文件或产品连接。 */
function fixture(sql = 'CREATE TABLE child(a TEXT,b INTEGER)') {
  const db = new DatabaseSync(':memory:'); try { db.exec(sql); } catch (reason) { db.close(); throw reason; }
  const tableSql = db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', 'child')!.sql as string;
  const columns = db.prepare('PRAGMA table_xinfo(child)').all().map(column => ({ name: String(column.name), hidden: Number(column.hidden) }));
  const input = { table: 'child', tableSql, columns };
  return { db, input, validate(sql: string) { const next = new DatabaseSync(':memory:'); try { next.exec(sql); return next; } catch (reason) { next.close(); throw reason; } } };
}
const design = (patch: Partial<SqliteTableUniqueDefinition> = {}): SqliteTableUniqueDefinition => ({ name: 'new_u', location: 'table', columns: [{ column: 'a', collation: null, order: null }], conflict: null, ...patch });
/** 由native实际自动索引而非被测解析结果独立核对唯一性、顺序和排序规则。 */
function indexes(db: DatabaseSync) {
  return db.prepare('PRAGMA index_list(child)').all().filter(index => index.origin === 'u').map(index => ({ unique: index.unique, keys: db.prepare('SELECT name,coll,"desc" FROM pragma_index_xinfo(?) WHERE "key"=1 ORDER BY seqno').all(index.name) }));
}
/** 完整原声明＋序号绑定；同名约束不能用名称猜测为同一目标。 */
function remove(input: Parameters<typeof inspect>[0], ordinal = 0) { return { kind: 'remove' as const, ordinal, expectedSql: inspect(input)[ordinal].sql }; }

describe('SQLite UNIQUE准确声明与有界结构化编译', () => {
  it('忽略字符串、CHECK、默认值、注释和生成表达式中的UNIQUE文字', () => {
    const f = fixture(`CREATE TABLE child(a TEXT DEFAULT 'UNIQUE(a)', b INTEGER CHECK(b>0 AND 'UNIQUE'<>''),g TEXT AS(a||' UNIQUE') VIRTUAL /* UNIQUE(b) */)`);
    try { expect(inspect(f.input)).toEqual([]); } finally { f.db.close(); }
  });
  it('保留行内COLLATE的继承事实，读取完整原命名和冲突声明', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT first CONSTRAINT second UNIQUE ON CONFLICT IGNORE COLLATE NOCASE,b INTEGER)');
    try { expect(inspect(f.input)).toEqual([{ ordinal: 0, location: 'column', column: 'a', sql: 'CONSTRAINT first CONSTRAINT second UNIQUE ON CONFLICT IGNORE', names: ['first', 'second'], columns: [{ column: 'a', collation: null, order: null }], conflict: 'IGNORE' }]); expect(indexes(f.db)).toEqual([{ unique: 1, keys: [{ name: 'a', coll: 'NOCASE', desc: 0 }] }]); } finally { f.db.close(); }
  });
  it('相同UNIQUE可共用一个自动索引，三个原声明仍按准确跨度分开', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT same UNIQUE CONSTRAINT same UNIQUE,b INTEGER,CONSTRAINT same UNIQUE(a))');
    try {
      const before = inspect(f.input); expect(before.map(key => [key.ordinal, key.location, key.names])).toEqual([[0, 'column', ['same']], [1, 'column', ['same']], [2, 'table', ['same']]]); expect(indexes(f.db)).toHaveLength(1);
      const output = compile(f.input, [remove(f.input, 1)]), next = f.validate(output.tableSql); try { expect(output.removed).toBe(1); expect(output.uniques).toHaveLength(2); expect(indexes(next)).toHaveLength(1); expect(output.tableSql.match(/CONSTRAINT same/g)).toHaveLength(2); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('重复旧字段引用保留为实际声明，不能按字段去重或按自动索引反推', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,UNIQUE(a,a COLLATE NOCASE DESC,b))');
    try { expect(inspect(f.input)[0].columns.map(term => term.column)).toEqual(['a', 'a', 'b']); expect(indexes(f.db)[0].keys).toEqual([{ name: 'a', coll: 'BINARY', desc: 0 }, { name: 'a', coll: 'NOCASE', desc: 1 }, { name: 'b', coll: 'BINARY', desc: 0 }]); } finally { f.db.close(); }
  });
  it.each(['((a COLLATE NOCASE) COLLATE RTRIM)', '(a COLLATE NOCASE COLLATE RTRIM)', '((a)) COLLATE RTRIM'])('旧括号和连续排序规则由真实native核对：%s', term => {
    const f = fixture(`CREATE TABLE child(a TEXT,b INTEGER,UNIQUE(${term} DESC,b ASC))`);
    try { expect(inspect(f.input)[0].columns).toEqual([{ column: 'a', collation: 'RTRIM', order: 'DESC' }, { column: 'b', collation: null, order: 'ASC' }]); expect(indexes(f.db)[0].keys).toEqual([{ name: 'a', coll: 'RTRIM', desc: 1 }, { name: 'b', coll: 'BINARY', desc: 0 }]); } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('在%s新增后NULL各自不同，空文本和大小写按原列排序规则比较', location => {
    const f = fixture('CREATE TABLE child(a TEXT COLLATE NOCASE,b INTEGER)');
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ location }) }]), next = f.validate(output.tableSql);
      try { next.exec("INSERT INTO child VALUES(NULL,1),(NULL,2),('',3),('A',4)"); expect(() => next.exec("INSERT INTO child VALUES('',5)")).toThrow(/UNIQUE/); expect(() => next.exec("INSERT INTO child VALUES('a',6)")).toThrow(/UNIQUE/); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(4); expect(output).toMatchObject({ added: 1, removed: 0, replaced: 0 }); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it.each(sqliteUniqueConflicts)('策略%s的真实追加语义与INSERT OR ABORT复制门分开', conflict => {
    const f = fixture();
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ conflict }) }]), next = f.validate(output.tableSql);
      try {
        next.exec("INSERT INTO child VALUES('same',1)");
        if (conflict === 'IGNORE' || conflict === 'REPLACE') { next.exec("INSERT INTO child VALUES('same',2)"); expect(next.prepare('SELECT b FROM child').get()!.b).toBe(conflict === 'IGNORE' ? 1 : 2); }
        else expect(() => next.exec("INSERT INTO child VALUES('same',2)")).toThrow(/UNIQUE/);
        expect(() => next.exec("INSERT OR ABORT INTO child VALUES('same',3)")).toThrow(/UNIQUE/); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(1);
      } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('有序复合字段与显式排序规则、DESC由native索引及冲突结果共同证明', () => {
    const f = fixture();
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ columns: [{ column: 'b', collation: null, order: 'DESC' }, { column: 'a', collation: 'NOCASE', order: 'ASC' }] }) }]), next = f.validate(output.tableSql);
      try { expect(indexes(next)).toEqual([{ unique: 1, keys: [{ name: 'b', coll: 'BINARY', desc: 1 }, { name: 'a', coll: 'NOCASE', desc: 0 }] }]); next.exec("INSERT INTO child VALUES('A',1),('a',2)"); expect(() => next.exec("INSERT INTO child VALUES('a',1)")).toThrow(/UNIQUE/); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it.each(['VIRTUAL', 'STORED'])('已有%s生成字段可以是唯一约束字段，不能误用主键禁用规则', storage => {
    const f = fixture(`CREATE TABLE child(a TEXT,b INTEGER,g TEXT AS(lower(a)) ${storage})`);
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ columns: [{ column: 'g', collation: null, order: null }] }) }]), next = f.validate(output.tableSql);
      try { next.exec("INSERT INTO child(a,b) VALUES('A',1)"); expect(() => next.exec("INSERT INTO child(a,b) VALUES('a',2)")).toThrow(/UNIQUE/); expect(next.prepare('SELECT g FROM child').get()!.g).toBe('a'); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('将原表级UNIQUE替换为%s，原非空、默认、检查、主外键和表选项保持', location => {
    const f = fixture(`CREATE TABLE child(a TEXT NOT NULL CONSTRAINT keep CHECK(a<>'') DEFAULT 'UNIQUE',b INTEGER PRIMARY KEY REFERENCES parent(id),CONSTRAINT old UNIQUE(a)) STRICT`);
    try {
      const original = inspect(f.input)[0], output = compile(f.input, [{ kind: 'replace', ordinal: 0, expectedSql: original.sql, definition: design({ location, name: 'old', columns: [{ column: 'a', collation: null, order: null }], conflict: 'FAIL' }) }]), next = f.validate(output.tableSql);
      try { expect(output).toMatchObject({ added: 0, removed: 0, replaced: 1 }); expect(output.uniques[0]).toMatchObject({ location, conflict: 'FAIL' }); expect(output.tableSql).toContain("CONSTRAINT keep CHECK(a<>'') DEFAULT 'UNIQUE'"); expect(inspectSqliteTablePrimaryKey({ ...f.input, tableSql: output.tableSql })).toEqual(inspectSqliteTablePrimaryKey(f.input)); expect(inspectSqliteTableForeignKeys({ ...f.input, tableSql: output.tableSql })).toEqual(inspectSqliteTableForeignKeys(f.input)); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('从行内改为复合表级约束，只移除准确旧跨度而保留邻接NOT NULL及命名检查', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT old UNIQUE ON CONFLICT IGNORE NOT NULL CONSTRAINT keep CHECK(length(a)>0),b INTEGER)');
    try {
      const output = compile(f.input, [{ kind: 'replace', ordinal: 0, expectedSql: inspect(f.input)[0].sql, definition: design({ columns: [{ column: 'b', collation: null, order: null }, { column: 'a', collation: null, order: null }] }) }]), next = f.validate(output.tableSql);
      try { expect(output.tableSql).toContain('NOT NULL CONSTRAINT keep CHECK(length(a)>0)'); expect(output.uniques[0].columns.map(term => term.column)).toEqual(['b', 'a']); expect(next.prepare('PRAGMA table_xinfo(child)').all()[0].notnull).toBe(1); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('删除尾部和连续表级约束保留边界注释，剩余列与原序号各自准确', () => {
    const f = fixture('CREATE TABLE child(/*lead*/a TEXT,b INTEGER,/*one*/UNIQUE(a)/*end1*/,/*two*/UNIQUE(b)/*end2*/)');
    try {
      const output = compile(f.input, [remove(f.input, 0), remove(f.input, 1)]), next = f.validate(output.tableSql);
      try { expect(inspect({ ...f.input, tableSql: output.tableSql })).toEqual([]); for (const marker of ['lead', 'one', 'end1', 'two', 'end2']) expect(output.tableSql).toContain(`/*${marker}*/`); expect(indexes(next)).toEqual([]); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); next.exec("INSERT INTO child VALUES('repeat',1),('repeat',1)"); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('多个同列行内新增须放在孤立CONSTRAINT之前，不偷改原标记归属', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT orphan,b INTEGER)');
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ location: 'column' }) }, { kind: 'add', definition: design({ location: 'column', name: 'another' }) }]), next = f.validate(output.tableSql);
      try { expect(output.uniques.map(key => key.names)).toEqual([['new_u'], ['another']]); expect(output.tableSql).toMatch(/CONSTRAINT "another" UNIQUE\s+CONSTRAINT orphan/); expect(indexes(next)).toHaveLength(1); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('两个唯一约束名称可在一批内交换，只与保留声明检查冲突', () => {
    const f = fixture('CREATE TABLE child(a TEXT CONSTRAINT one UNIQUE,b INTEGER,CONSTRAINT two UNIQUE(b))');
    try {
      const before = inspect(f.input), output = compile(f.input, before.map((key, ordinal) => ({ kind: 'replace', ordinal, expectedSql: key.sql, definition: design({ name: ordinal === 0 ? 'two' : 'one', columns: [{ column: ordinal === 0 ? 'a' : 'b', collation: null, order: null }] }) }))), next = f.validate(output.tableSql);
      try { expect(output.uniques.map(key => key.names)).toEqual([['two'], ['one']]); expect(indexes(next)).toHaveLength(2); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it.each(['pk', 'fk', 'checkname', 'defaultname', 'orphan'])('新名不能覆盖保留的%s约束标记', name => {
    const f = fixture("CREATE TABLE child(a TEXT CONSTRAINT checkname CHECK(a<>'') CONSTRAINT defaultname DEFAULT 'x' CONSTRAINT orphan,b INTEGER CONSTRAINT pk PRIMARY KEY CONSTRAINT fk REFERENCES parent(id))");
    try { expect(() => compile(f.input, [{ kind: 'add', definition: design({ name: name.toUpperCase() }) }])).toThrow(/保留的原约束名冲突/); } finally { f.db.close(); }
  });
  it('Unicode名称只折叠ASCII，且标识符中的引号、逗号、关键字不会注入DDL', () => {
    const f = fixture('CREATE TABLE child("a\"\"), UNIQUE(x); --" TEXT,b INTEGER,CONSTRAINT "Å" CHECK(b>0))');
    try {
      const output = compile(f.input, [{ kind: 'add', definition: design({ name: 'å', columns: [{ column: f.input.columns[0].name, collation: null, order: null }] }) }]), next = f.validate(output.tableSql);
      try { expect(output.uniques[0].columns[0].column).toBe(f.input.columns[0].name); expect(next.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE type=\'table\'').get()!.n).toBe(1); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('WITHOUT ROWID的主键、严格字段及主键存储身份不被UNIQUE修改暗改', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER,PRIMARY KEY(b,a),UNIQUE(a)) WITHOUT ROWID,STRICT');
    try {
      const output = compile(f.input, [remove(f.input), { kind: 'add', definition: design({ columns: [{ column: 'a', collation: null, order: 'DESC' }, { column: 'b', collation: null, order: 'ASC' }] }) }]), next = f.validate(output.tableSql);
      try { expect(inspectSqliteTablePrimaryKey({ ...f.input, tableSql: output.tableSql })).toEqual(inspectSqliteTablePrimaryKey(f.input)); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); expect(() => next.prepare('SELECT rowid FROM child')).toThrow(/no such column/); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('读取结果全部冻结，不能通过外部修改破坏原序号或字段集合', () => {
    const f = fixture('CREATE TABLE child(a TEXT UNIQUE,b INTEGER)');
    try { const output = inspect(f.input); expect(Object.isFrozen(output)).toBe(true); for (const key of output) { expect(Object.isFrozen(key)).toBe(true); expect(Object.isFrozen(key.names)).toBe(true); expect(Object.isFrozen(key.columns)).toBe(true); expect(Object.isFrozen(key.columns[0])).toBe(true); } } finally { f.db.close(); }
  });
  it('预览IPC仅增加结构化uniqueEdits，仍拒绝任意SQL和额外执行内容', () => {
    const valid = { catalogueId: 'c', taskId: 't', changes: [{ column: 'a', declaredType: 'TEXT' }] };
    expect(sqliteTableRebuildPreviewSchema.safeParse(valid).success).toBe(true);
    expect(sqliteTableRebuildPreviewSchema.safeParse({ ...valid, changes: [], uniqueEdits: [{ kind: 'add', definition: design() }] }).success).toBe(true);
    expect(sqliteTableRebuildPreviewSchema.safeParse({ ...valid, uniqueEdits: [{ kind: 'add', definition: { ...design(), sql: 'DROP TABLE child' } }] }).success).toBe(false);
  });
  it('唯一约束声明可供后续字段改动编译，但原写入协议并未因此开放', () => {
    const f = fixture('CREATE TABLE child(a TEXT,b INTEGER)');
    try { const changed = compile(f.input, [{ kind: 'add', definition: design() }]), output = compileSqliteTableRebuildDefinition({ ...f.input, tableSql: changed.tableSql, candidateName: '__dbark_rebuild_' + '3'.repeat(32), changes: [{ column: 'b', default: { kind: 'integer', value: '7' } }], columnOrder: ['b', 'a'] }), next = f.validate(output.candidateSql); try { const rows = next.prepare('SELECT name,dflt_value FROM pragma_table_xinfo(?) ORDER BY cid').all('__dbark_rebuild_' + '3'.repeat(32)); expect(rows).toEqual([{ name: 'b', dflt_value: '7' }, { name: 'a', dflt_value: null }]); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('删除被外键使用的唯一键会产生真实父键失效，编译结果不冒充可提交', () => {
    const f = fixture('CREATE TABLE child(a TEXT UNIQUE,b INTEGER)');
    try {
      const output = compile(f.input, [remove(f.input)]), next = f.validate(output.tableSql);
      try { next.exec('PRAGMA foreign_keys=ON; CREATE TABLE dependent(a TEXT REFERENCES child(a))'); expect(() => next.prepare('PRAGMA foreign_key_check').all()).toThrow(/foreign key mismatch/); } finally { next.close(); }
    } finally { f.db.close(); }
  });
});

describe('SQLite UNIQUE来源和结构预算保护', () => {
  it.each(['primaryKeyEdit', 'foreignKeyEdits', 'columnOrder', 'uniqueEdits'])('组合编译先拒绝%s访问器，不能由对象复制提前调用getter', key => {
    const f = fixture(), getter = vi.fn(() => undefined);
    try { const input = { ...f.input, candidateName: '__dbark_rebuild_' + '4'.repeat(32), changes: [], uniqueEdits: [{ kind: 'add' as const, definition: design() }] }; Object.defineProperty(input, key, { enumerable: true, get: getter }); expect(() => compileSqliteTableRebuildDefinition(input)).toThrow(); expect(getter).not.toHaveBeenCalled(); } finally { f.db.close(); }
  });
  it('原位置或原SQL变化、重复编辑、空批次以及名称碰撞均拒绝', () => {
    const f = fixture('CREATE TABLE child(a TEXT UNIQUE,b INTEGER)');
    try {
      for (const edits of [[{ ...remove(f.input), expectedSql: 'UNIQUE ' }], [{ ...remove(f.input), ordinal: 1 }], [remove(f.input), remove(f.input)], [], [{ kind: 'add', definition: design() }, { kind: 'add', definition: design({ name: 'NEW_U' }) }]]) expect(() => compile(f.input, edits)).toThrow();
    } finally { f.db.close(); }
  });
  it.each([
    { location: 'column', columns: [{ column: 'a', collation: null, order: 'DESC' }] },
    { location: 'column', columns: [{ column: 'a', collation: 'BINARY', order: null }] },
    { location: 'column', columns: [{ column: 'a', collation: null, order: null }, { column: 'b', collation: null, order: null }] },
    { columns: [{ column: 'a', collation: null, order: null }, { column: 'A', collation: null, order: null }] },
    { columns: [] }, { columns: [{ expression: 'lower(a)', collation: null, order: null }] },
    { autoIncrement: true }, { conflict: 'ABORT; DROP TABLE child' }, { name: '\ud800' }, { name: '\0' },
  ])('严格拒绝非法位置、字段和伪造DDL：%j', patch => {
    expect(sqliteTableUniqueDefinitionSchema.safeParse({ ...design(), ...patch }).success).toBe(false);
  });
  it('原字段须准确名称且不能是隐藏虚拟列，不能按大小写猜测', () => {
    expect(() => buildSqliteTableUnique(design(), [{ name: 'A', hidden: 0 }])).toThrow(/准确选择/);
    expect(() => buildSqliteTableUnique(design(), [{ name: 'a', hidden: 1 }])).toThrow(/准确选择/);
  });
  it('任意访问器必须在Zod前拒绝且零调用，深层字段和数组同样保护', () => {
    const getter = vi.fn(() => 'a'), accessor = Object.defineProperty({}, 'column', { enumerable: true, get: getter });
    for (const value of [Object.defineProperty({}, 'name', { enumerable: true, get: getter }), { ...design(), columns: [accessor] }, [Object.defineProperty({}, 'kind', { enumerable: true, get: getter })]]) { expect(sqliteTableUniqueDefinitionSchema.safeParse(value).success).toBe(false); expect(sqliteTableUniqueEditsSchema.safeParse(value).success).toBe(false); } expect(getter).not.toHaveBeenCalled();
  });
  it('循环、额外原型、稀疏数组、符号及非枚举字段均不进入结构解析', () => {
    const cycle: unknown[] = []; cycle.push(cycle); const sparse = Array(2), symbol = { ...design(), [Symbol('x')]: true }, hidden = Object.defineProperty(design(), 'hidden', { value: true });
    for (const raw of [cycle, sparse, symbol, hidden, Object.create(design()), [{ kind: 'add', definition: Object.create(design()) }]]) expect(sqliteTableUniqueEditsSchema.safeParse(raw).success).toBe(false);
  });
  it('2MiB预算按UTF8与JSON转义计算，不让大旧SQL、过量操作或字段先分配解析副本', () => {
    for (const expectedSql of ['中'.repeat(Math.floor(sqliteTableUniqueLimits.bytes / 3)), '\n'.repeat(sqliteTableUniqueLimits.bytes / 2)]) expect(sqliteTableUniqueEditsSchema.safeParse([{ kind: 'remove', ordinal: 0, expectedSql }]).success).toBe(false);
    expect(sqliteTableUniqueEditsSchema.safeParse(Array.from({ length: sqliteTableUniqueLimits.edits + 1 }, () => ({ kind: 'add', definition: design() }))).success).toBe(false);
    expect(sqliteTableUniqueDefinitionSchema.safeParse(design({ columns: Array.from({ length: sqliteTableUniqueLimits.parts + 1 }, (_, index) => ({ column: 'c' + index, collation: null, order: null })) })).success).toBe(false);
  });
  it('原来源的字段getter、错误目录及夹带多语句不被执行或猜测', () => {
    const f = fixture('CREATE TABLE child(a TEXT UNIQUE,b INTEGER)'), getter = vi.fn(() => f.input.tableSql);
    try { expect(() => inspect(Object.defineProperty({ ...f.input }, 'tableSql', { get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => inspect({ ...f.input, columns: [{ name: 'wrong', hidden: 0 }, { name: 'b', hidden: 0 }] })).toThrow(); expect(() => inspect({ ...f.input, tableSql: f.input.tableSql + ';DROP TABLE child' })).toThrow(); expect(f.db.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE name=\'child\'').get()!.n).toBe(1); } finally { f.db.close(); }
  });
});
