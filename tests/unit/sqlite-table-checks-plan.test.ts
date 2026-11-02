import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { assertSqliteCheckExpression, buildSqliteTableCheck, sqliteTableCheckDefinitionSchema, sqliteTableCheckEditsSchema, sqliteTableCheckLimits, type SqliteTableCheckDefinition } from '../../src/shared/sqliteTableChecks';
import { compileSqliteTableChecks as compile, inspectSqliteTableChecks as inspect, compileSqliteTableRebuildDefinition, compileSqliteTableRebuildCopyDefinition, inspectSqliteTablePrimaryKey, inspectSqliteTableForeignKeys, inspectSqliteTableUniques } from '../../src/shared/sqliteTableRebuildPlan';
import { sqliteTableRebuildPreviewSchema } from '../../src/shared/sqliteTableRebuild';

/** 两座真实native内存库分别验证来源及候选，不打开任何外部文件或产品会话。 */
function fixture(sql = 'CREATE TABLE child(a,b INTEGER)') {
  const db = new DatabaseSync(':memory:'); try { db.exec(sql); } catch (reason) { db.close(); throw reason; }
  const tableSql = db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', 'child')!.sql as string;
  const columns = db.prepare('PRAGMA table_xinfo(child)').all().map(column => ({ name: String(column.name), hidden: Number(column.hidden) }));
  const input = { table: 'child', tableSql, columns };
  return { db, input, validate(sql: string) { const candidate = new DatabaseSync(':memory:'); try { candidate.exec(sql); return candidate; } catch (reason) { candidate.close(); throw reason; } } };
}
const design = (expression = 'a>0'): SqliteTableCheckDefinition => ({ location: 'table', name: 'new_check', expression });
/** 原序号及原SQL共同绑定；同名、匿名和相同表达式不能被按名称合并。 */
function remove(input: Parameters<typeof inspect>[0], ordinal = 0) { return { kind: 'remove' as const, ordinal, expectedSql: inspect(input)[ordinal].sql }; }

describe('SQLite CHECK真实声明定位与native语义', () => {
  it('字符串、生成表达式、默认值和注释中的CHECK不会生成假约束', () => {
    const f = fixture(`CREATE TABLE child(a TEXT DEFAULT 'CHECK(a)',b INTEGER,g TEXT AS(a||'CHECK(DEFAULT)') VIRTUAL /*CHECK(b)*/)`); try { expect(inspect(f.input)).toEqual([]); } finally { f.db.close(); }
  });
  it('完整读取行内连续命名、表达式原空白与注释，不吞相邻DEFAULT和NOT NULL', () => {
    const f = fixture("CREATE TABLE child(a INTEGER CONSTRAINT first CONSTRAINT second CHECK( a > 0 /*CHECK(DEFAULT)*/ ) NOT NULL DEFAULT 3,b TEXT)");
    try { expect(inspect(f.input)).toEqual([{ ordinal: 0, location: 'column', column: 'a', sql: 'CONSTRAINT first CONSTRAINT second CHECK( a > 0 /*CHECK(DEFAULT)*/ )', names: ['first', 'second'], expression: ' a > 0 /*CHECK(DEFAULT)*/ ', legacyConflict: null }]); } finally { f.db.close(); }
  });
  it('重名与重复声明按准确位置区分，移除中间声明只改变其约束', () => {
    const f = fixture('CREATE TABLE child(a INTEGER CONSTRAINT same CHECK(a>0) CONSTRAINT same CHECK(a<10),b INTEGER,CONSTRAINT same CHECK(b>0))');
    try { expect(inspect(f.input).map(check => [check.ordinal, check.location, check.names])).toEqual([[0, 'column', ['same']], [1, 'column', ['same']], [2, 'table', ['same']]]); const output = compile(f.input, [remove(f.input, 1)]), next = f.validate(output.tableSql); try { expect(output.removed).toBe(1); expect(output.checks.map(check => check.expression)).toEqual(['a>0', 'b>0']); next.exec('INSERT INTO child VALUES(20,1)'); expect(() => next.exec('INSERT INTO child VALUES(-1,1)')).toThrow(/CHECK/); expect(() => next.exec('INSERT INTO child VALUES(1,-1)')).toThrow(/CHECK/); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('%s声明可引用其它字段，CHECK不是附着字段的单值验证', location => {
    const f = fixture();
    try { const value: SqliteTableCheckDefinition = location === 'column' ? { location, name: null, column: 'a', expression: 'a>0 AND b>=a' } : design('a>0 AND b>=a'), output = compile(f.input, [{ kind: 'add', definition: value }]), next = f.validate(output.tableSql); try { next.exec('INSERT INTO child VALUES(1,2)'); expect(() => next.exec('INSERT INTO child VALUES(2,1)')).toThrow(/CHECK/); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each([
    { value: null, accepted: true }, { value: 0, accepted: false }, { value: 1, accepted: true }, { value: -1, accepted: true },
    { value: 0.0, accepted: false }, { value: '0', accepted: false }, { value: '2.5', accepted: true }, { value: 'abc', accepted: false },
  ])('CHECK按native NUMERIC求真而不是JS布尔：%j', ({ value, accepted }) => {
    const f = fixture(); try { const output = compile(f.input, [{ kind: 'add', definition: design('a') }]), next = f.validate(output.tableSql); try { const statement = next.prepare('INSERT INTO child VALUES(?,1)'); if (accepted) statement.run(value); else expect(() => statement.run(value)).toThrow(/CHECK/); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(accepted ? 1 : 0); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('NULL不会被CHECK(a>0)拒绝，需要显式IS NOT NULL，且不暗改列NOT NULL属性', () => {
    const f = fixture(); try { for (const required of [false, true]) { const output = compile(f.input, [{ kind: 'add', definition: design(required ? 'a IS NOT NULL AND a>0' : 'a>0') }]), next = f.validate(output.tableSql); try { expect(next.prepare('PRAGMA table_xinfo(child)').all()[0].notnull).toBe(0); if (required) expect(() => next.exec('INSERT INTO child VALUES(NULL,1)')).toThrow(/CHECK/); else next.exec('INSERT INTO child VALUES(NULL,1)'); } finally { next.close(); } } } finally { f.db.close(); }
  });
  it.each(['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'])('兼容表级ON CONFLICT %s只读记录，真实CHECK默认仍是整句ABORT', conflict => {
    const f = fixture(`CREATE TABLE child(a,b INTEGER,CONSTRAINT old CHECK(a>0) ON CONFLICT ${conflict})`);
    try { expect(inspect(f.input)[0]).toMatchObject({ expression: 'a>0', legacyConflict: conflict, sql: 'CONSTRAINT old CHECK(a>0) ON CONFLICT ' + conflict }); expect(() => f.db.exec('INSERT INTO child VALUES(1,1),(0,2)')).toThrow(/CHECK/); expect(f.db.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(0); const output = compile(f.input, [remove(f.input)]), next = f.validate(output.tableSql); try { expect(output.tableSql).not.toContain('ON CONFLICT'); next.exec('INSERT INTO child VALUES(0,1)'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['column', 'table'] as const)('替换为%s时保留默认值、主外键、唯一约束和STRICT表选项', location => {
    const f = fixture("CREATE TABLE child(a INTEGER CONSTRAINT p PRIMARY KEY,b INTEGER CONSTRAINT u UNIQUE CONSTRAINT f REFERENCES parent(id) DEFAULT 7,CONSTRAINT old CHECK(b>=0)) STRICT");
    try { const original = inspect(f.input)[0], value: SqliteTableCheckDefinition = location === 'column' ? { location, column: 'b', name: 'old', expression: 'b>=1' } : { location, name: 'old', expression: 'b>=1' }, output = compile(f.input, [{ kind: 'replace', ordinal: 0, expectedSql: original.sql, definition: value }]), next = f.validate(output.tableSql); try { expect(output).toMatchObject({ added: 0, removed: 0, replaced: 1 }); expect(output.checks[0].location).toBe(location); for (const read of [inspectSqliteTablePrimaryKey, inspectSqliteTableForeignKeys, inspectSqliteTableUniques]) expect(read({ ...f.input, tableSql: output.tableSql })).toEqual(read(f.input)); expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); expect(output.tableSql).toContain('DEFAULT 7'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['VIRTUAL', 'STORED'])('%s生成字段可承载或参与CHECK，生成值真实核验', storage => {
    const f = fixture(`CREATE TABLE child(a,b INTEGER,g INTEGER AS(a+b) ${storage})`);
    try { const output = compile(f.input, [{ kind: 'add', definition: { location: 'column', column: 'g', name: 'generated_check', expression: 'g>0' } }]), next = f.validate(output.tableSql); try { next.exec('INSERT INTO child(a,b) VALUES(1,2)'); expect(next.prepare('SELECT g FROM child').get()!.g).toBe(3); expect(() => next.exec('INSERT INTO child(a,b) VALUES(-3,1)')).toThrow(/CHECK/); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('尾部行注释不能吞闭括号，字符串中的分号／参数／括号均是原文', () => {
    const expression = "a>0 AND instr('); DROP TABLE child; ? @name', 'DROP')>0 -- ) ; :arg\r\n/*尾注释*/", f = fixture();
    try { const output = compile(f.input, [{ kind: 'add', definition: design(expression) }]), next = f.validate(output.tableSql); try { expect(output.checks[0].expression).toBe('\n' + expression + '\n'); next.exec('INSERT INTO child VALUES(1,1)'); expect(() => next.exec('INSERT INTO child VALUES(0,1)')).toThrow(/CHECK/); expect(next.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE type=\'table\'').get()!.n).toBe(1); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['"a,b"', '`a,b`', '[a,b]'])('引用逗号字段%s与括号／字符串不按逗号拆开', column => {
    const f = fixture('CREATE TABLE child("a,b" INTEGER,b INTEGER)'); try { const output = compile(f.input, [{ kind: 'add', definition: design(column + ">0 AND 'CHECK(DEFAULT,UNIQUE)'<>''") }]), next = f.validate(output.tableSql); try { next.exec('INSERT INTO child VALUES(1,1)'); expect(() => next.exec('INSERT INTO child VALUES(0,1)')).toThrow(/CHECK/); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('词法器保留带美元符号的普通字段名，不把字段中缀当外部参数', () => {
    const f = fixture('CREATE TABLE child(a$part,b INTEGER)'); try { const output = compile(f.input, [{ kind: 'add', definition: design('a$part>0') }]), next = f.validate(output.tableSql); try { next.exec('INSERT INTO child VALUES(1,1)'); expect(() => next.exec('INSERT INTO child VALUES(-1,1)')).toThrow(/CHECK/); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('删除连续表级CHECK保留边界注释和其它列，移除后未来负值可以写入', () => {
    const f = fixture('CREATE TABLE child(/*lead*/a,b INTEGER,/*first*/CHECK(a>0)/*end1*/,/*second*/CHECK(b>0)/*end2*/)');
    try { const output = compile(f.input, [remove(f.input, 0), remove(f.input, 1)]), next = f.validate(output.tableSql); try { for (const marker of ['lead', 'first', 'end1', 'second', 'end2']) expect(output.tableSql).toContain('/*' + marker + '*/'); expect(output.checks).toEqual([]); next.exec('INSERT INTO child VALUES(-1,-1)'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('行内新增不改变尾部孤立CONSTRAINT的归属，新声明放在它之前', () => {
    const f = fixture('CREATE TABLE child(a CONSTRAINT orphan,b INTEGER)'); try { const output = compile(f.input, [{ kind: 'add', definition: { location: 'column', column: 'a', name: 'inserted', expression: 'a>0' } }]), next = f.validate(output.tableSql); try { expect(output.checks[0].names).toEqual(['inserted']); expect(output.tableSql).toMatch(/CHECK \(\na>0\n\)\s+CONSTRAINT orphan/); next.exec('INSERT INTO child VALUES(1,1)'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('编译不求值、不调用用户函数；真实native只在写行时执行CHECK', () => {
    const f = fixture(), call = vi.fn((_value: unknown) => 1);
    try { const output = compile(f.input, [{ kind: 'add', definition: design('touch(a)') }]), next = new DatabaseSync(':memory:'); try { next.function('touch', { deterministic: true }, value => call(value)); expect(call).not.toHaveBeenCalled(); next.exec(output.tableSql); expect(call).not.toHaveBeenCalled(); next.exec('INSERT INTO child VALUES(1,1)'); expect(call).toHaveBeenCalledTimes(1); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['(SELECT 1)', 'missing_column>0', '1,2'])('词法隔离不冒充完整语义验证，native拒绝%s且无任何其它表或数据', expression => {
    const f = fixture(); try { const output = compile(f.input, [{ kind: 'add', definition: design(expression) }]); expect(() => f.validate(output.tableSql)).toThrow(); expect(f.db.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(0); } finally { f.db.close(); }
  });
  it('先前绕过CHECK保存的坏行仍能读取；新库完整OR ABORT复制失败且不跳行', () => {
    const f = fixture('CREATE TABLE child(a CHECK(a>0),b INTEGER)');
    try { f.db.exec('PRAGMA ignore_check_constraints=ON; INSERT INTO child VALUES(1,1),(-1,2)'); expect(f.db.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(2); const next = f.validate(f.input.tableSql); try { expect(() => next.exec('INSERT OR ABORT INTO child VALUES(1,1),(-1,2)')).toThrow(/CHECK/); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(0); } finally { next.close(); } } finally { f.db.close(); }
  });
});

describe('SQLite CHECK组合编译与准确来源保护', () => {
  it('主外键／UNIQUE／CHECK名称循环交换、类型和真实重排共同核最终命名空间', () => {
    const f = fixture('CREATE TABLE child(a INT CONSTRAINT p PRIMARY KEY,b INTEGER CONSTRAINT f REFERENCES parent(id),g TEXT AS(a||b) VIRTUAL,CONSTRAINT u UNIQUE(b),CONSTRAINT c CHECK(a>=0))');
    try {
      const original = inspect(f.input)[0], input = { ...f.input, candidateName: '__dbark_rebuild_' + '1'.repeat(32), changes: [{ column: 'a', declaredType: 'INTEGER', default: { kind: 'integer' as const, value: '7' } }], columnOrder: ['g', 'b', 'a'], primaryKeyEdit: { kind: 'replace' as const, expectedSql: 'CONSTRAINT p PRIMARY KEY', definition: { name: 'f', location: 'column' as const, columns: [{ column: 'a', collation: null, order: null }], conflict: null, autoIncrement: true } }, foreignKeyEdits: [{ kind: 'replace' as const, ordinal: 0, expectedSql: 'CONSTRAINT f REFERENCES parent(id)', definition: { name: 'u', columns: ['b'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'CASCADE' as const, onDelete: 'RESTRICT' as const, deferral: 'deferred' as const } }], uniqueEdits: [{ kind: 'replace' as const, ordinal: 0, expectedSql: 'CONSTRAINT u UNIQUE(b)', definition: { name: 'c', location: 'table' as const, columns: [{ column: 'b', collation: null, order: 'DESC' as const }], conflict: null } }], checkEdits: [{ kind: 'replace' as const, ordinal: 0, expectedSql: original.sql, definition: { location: 'column' as const, column: 'a', name: 'p', expression: 'a>=0' } }] };
      const output = compileSqliteTableRebuildDefinition(input), next = f.validate(output.candidateSql); try { const columns = next.prepare('SELECT name,type,pk,dflt_value FROM pragma_table_xinfo(?) ORDER BY cid').all(input.candidateName); expect(columns).toEqual([{ name: 'g', type: 'TEXT', pk: 0, dflt_value: null }, { name: 'b', type: 'INTEGER', pk: 0, dflt_value: null }, { name: 'a', type: 'INTEGER', pk: 1, dflt_value: '7' }]); for (const expected of ['CONSTRAINT "f" PRIMARY KEY', 'CONSTRAINT "u" FOREIGN KEY', 'CONSTRAINT "c" UNIQUE', 'CONSTRAINT "p" CHECK']) expect(output.candidateSql).toContain(expected); } finally { next.close(); }
      const copied = compileSqliteTableRebuildCopyDefinition(input, '__dbark_rebuild_order_' + '2'.repeat(32)); expect(copied.columnMapping).toEqual([{ name: 'g', copy: false }, { name: 'b', copy: true }, { name: 'a', copy: true }]); expect(copied.candidateSql).toContain('INTEGER NOT NULL');
    } finally { f.db.close(); }
  });
  it.each(['STRICT', 'WITHOUT ROWID', 'WITHOUT ROWID,STRICT'])('%s表选项和原PK／可空性均原样保持', suffix => {
    const f = fixture('CREATE TABLE child(a INTEGER PRIMARY KEY,b INTEGER CHECK(b>=0)) ' + suffix); try { const output = compile(f.input, [{ kind: 'replace', ordinal: 0, expectedSql: inspect(f.input)[0].sql, definition: design('b>0') }]), next = f.validate(output.tableSql); try { expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); expect(inspectSqliteTablePrimaryKey({ ...f.input, tableSql: output.tableSql })).toEqual(inspectSqliteTablePrimaryKey(f.input)); expect(output.tableSql).toContain(suffix); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('两个CHECK名称可以同批互换，但不能覆盖保留的其它约束名称', () => {
    const f = fixture('CREATE TABLE child(a CONSTRAINT one CHECK(a>0),b INTEGER CONSTRAINT keep UNIQUE,CONSTRAINT two CHECK(b>=0))');
    try { const checks = inspect(f.input), output = compile(f.input, checks.map((check, ordinal) => ({ kind: 'replace', ordinal, expectedSql: check.sql, definition: { ...design(check.expression), name: ordinal === 0 ? 'two' : 'one' } }))), next = f.validate(output.tableSql); try { expect(output.checks.map(check => check.names)).toEqual([['two'], ['one']]); } finally { next.close(); } expect(() => compile(f.input, [{ kind: 'add', definition: { ...design(), name: 'KEEP' } }])).toThrow(/保留的原约束名冲突/); } finally { f.db.close(); }
  });
  it('原序号／SQL、重复编辑、空批次和未知字段不能被旧来源或名称猜测替代', () => {
    const f = fixture('CREATE TABLE child(a CHECK(a>0),b INTEGER)'); try { for (const edits of [[], [remove(f.input), remove(f.input)], [{ ...remove(f.input), expectedSql: 'CHECK(a>0) ' }], [{ ...remove(f.input), ordinal: 1 }], [{ kind: 'add', definition: { location: 'column', column: 'A', name: null, expression: 'a>0' } }]]) expect(() => compile(f.input, edits)).toThrow(); } finally { f.db.close(); }
  });
  it('冻结原声明和名称数组，外部不能改写已读取身份', () => {
    const f = fixture('CREATE TABLE child(a CHECK(a>0),b INTEGER)'); try { const keys = inspect(f.input); expect(Object.isFrozen(keys)).toBe(true); expect(Object.isFrozen(keys[0])).toBe(true); expect(Object.isFrozen(keys[0].names)).toBe(true); } finally { f.db.close(); }
  });
  it('旧预览契约仍拒绝checkEdits，内部声明编译没有签发新写权限', () => {
    const valid = { catalogueId: 'c', taskId: 't', changes: [{ column: 'a', declaredType: 'INTEGER' }] }; expect(sqliteTableRebuildPreviewSchema.safeParse(valid).success).toBe(true); expect(sqliteTableRebuildPreviewSchema.safeParse({ ...valid, checkEdits: [{ kind: 'add', definition: design() }] }).success).toBe(false);
  });
});

describe('SQLite CHECK词法、预算及访问器保护', () => {
  it.each(['a>0); DROP TABLE child;--', 'a>?', 'a>:arg', 'a>@arg', 'a>$arg', '/*未闭合', "a>'未闭合", 'a>(0', 'a>0)', ' /*空*/ --空', '1\0', '\ud800'])('拒绝表达式逃逸、外部参数及坏文本：%j', expression => { expect(() => assertSqliteCheckExpression(expression)).toThrow(); expect(sqliteTableCheckDefinitionSchema.safeParse(design(expression)).success).toBe(false); });
  it('拒绝无效位置、执行选项和无效冲突策略，不把兼容旧语法当新生效意图', () => {
    for (const patch of [{ conflict: 'IGNORE' }, { enabled: false }, { ignoreChecks: true }, { sql: 'DROP TABLE child' }, { location: 'column' }, { column: 'a' }, { name: '\0' }, { name: '\ud800' }]) expect(sqliteTableCheckDefinitionSchema.safeParse({ ...design(), ...patch }).success).toBe(false);
  });
  it('64KiB按真实UTF8计量，表达式隔离到64层，超量前拒绝', () => {
    expect(() => assertSqliteCheckExpression('1' + ' '.repeat(sqliteTableCheckLimits.expressionBytes - 1))).not.toThrow(); expect(() => assertSqliteCheckExpression('1' + ' '.repeat(sqliteTableCheckLimits.expressionBytes))).toThrow(); expect(() => assertSqliteCheckExpression('中'.repeat(Math.ceil(sqliteTableCheckLimits.expressionBytes / 3)))).toThrow(); expect(() => assertSqliteCheckExpression('('.repeat(64) + '1' + ')'.repeat(64))).not.toThrow(); expect(() => assertSqliteCheckExpression('('.repeat(65) + '1' + ')'.repeat(65))).toThrow();
  });
  it('深层getter在Zod之前被拒绝且零调用，稀疏、循环、符号及非枚举输入同样拒绝', () => {
    const getter = vi.fn(() => 'a>0'), value = Object.defineProperty({ location: 'table', name: null }, 'expression', { enumerable: true, get: getter }), cycle: unknown[] = []; cycle.push(cycle);
    expect(sqliteTableCheckDefinitionSchema.safeParse(value).success).toBe(false); expect(sqliteTableCheckEditsSchema.safeParse([{ kind: 'add', definition: value }]).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    for (const input of [Array(2), cycle, Object.create(design()), { ...design(), [Symbol('x')]: true }, Object.defineProperty(design(), 'extra', { value: true })]) expect(sqliteTableCheckEditsSchema.safeParse(input).success).toBe(false);
  });
  it.each(['checkEdits', 'uniqueEdits', 'primaryKeyEdit', 'foreignKeyEdits', 'columnOrder'])('组合参数%s的getter不能被spread先执行', key => {
    const f = fixture(), getter = vi.fn(() => undefined); try { const input = { ...f.input, candidateName: '__dbark_rebuild_' + '3'.repeat(32), changes: [], checkEdits: [{ kind: 'add' as const, definition: design() }] }; Object.defineProperty(input, key, { enumerable: true, get: getter }); expect(() => compileSqliteTableRebuildDefinition(input)).toThrow(); expect(getter).not.toHaveBeenCalled(); } finally { f.db.close(); }
  });
  it('批次和2MiB序列化预算限制在克隆前执行，行内必须准确原字段', () => {
    expect(sqliteTableCheckEditsSchema.safeParse(Array.from({ length: 129 }, () => ({ kind: 'add', definition: design() }))).success).toBe(false); expect(sqliteTableCheckEditsSchema.safeParse([{ kind: 'remove', ordinal: 0, expectedSql: '中'.repeat(700000) }]).success).toBe(false); expect(sqliteTableCheckEditsSchema.safeParse(Array.from({ length: 40 }, () => ({ kind: 'add', definition: design('1' + '\n'.repeat(65535)) }))).success).toBe(false); expect(() => buildSqliteTableCheck({ location: 'column', column: 'a', name: null, expression: 'a>0' }, [{ name: 'a', hidden: 1 }])).toThrow(/准确选择/);
  });
  it('源SQL或列目录异常先拒绝，原库不执行夹带语句', () => {
    const f = fixture('CREATE TABLE child(a CHECK(a>0),b INTEGER)'), getter = vi.fn(() => f.input.tableSql); try { expect(() => inspect(Object.defineProperty({ ...f.input }, 'tableSql', { get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => inspect({ ...f.input, tableSql: f.input.tableSql + ';DROP TABLE child' })).toThrow(); expect(() => inspect({ ...f.input, columns: [{ name: 'wrong', hidden: 0 }, { name: 'b', hidden: 0 }] })).toThrow(); expect(f.db.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE name=\'child\'').get()!.n).toBe(1); } finally { f.db.close(); }
  });
});
