import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { assertSqliteTableCreateFactTransition, buildSqliteTableCreate, sqliteTableCreateApplySchema, sqliteTableCreateDefaultSchema, sqliteTableCreateDesignSchema, sqliteTableCreateFactSchema, sqliteTableCreateLimits, sqliteTableCreateOutcomeSchema, sqliteTableCreatePlannedNames, sqliteTableCreatePreviewSchema, sqliteTableCreateReleaseSchema, type SqliteTableCreateDesign, type SqliteTableCreateFact } from '../../src/shared/sqliteTableCreate';

/** 全部原生验证只使用本测试的内存库，不读取用户文件、网络连接或安装配置。 */
function database(run: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { run(db); } finally { db.close(); } }
function design(patch: Partial<SqliteTableCreateDesign> = {}): SqliteTableCreateDesign {
  return { name: '原表"🚢', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'note', declaredType: 'TEXT', nullable: true, default: { kind: 'text', value: "原文'中文🚢" }, collation: 'NOCASE' }], primaryKey: ['id'], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false, ...structuredClone(patch) };
}
function quote(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }
/** 预期定义逐对象读取原sqlite_schema，不用另一套DDL解析器伪造正常化结果。 */
function create(db: DatabaseSync, value: SqliteTableCreateDesign) {
  const built = buildSqliteTableCreate(value); for (const sql of built.sql) db.exec(sql);
  for (const stored of built.storedSql) expect(db.prepare('SELECT type,name,sql FROM main.sqlite_schema WHERE name=? COLLATE BINARY').get(stored.name)).toEqual(stored);
  return built;
}
const target = { connectionId: 'owned-sqlite', database: 'main' as const, table: '新表🚢' };
function fact(patch: Partial<SqliteTableCreateFact> = {}): SqliteTableCreateFact { return { operationId: 'operation-owned', target, phase: 'not-sent', requestedStatements: 2, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, ...structuredClone(patch) }; }

describe('SQLite新建表的严格设计及纯浏览器DDL构造', () => {
  it('字段/默认值均严格判别；未知SQL、生成列、表达式和跨分支value不能混入', () => {
    expect(sqliteTableCreateDesignSchema.parse(design())).toEqual(design());
    for (const invalid of [{ ...design(), sql: 'DROP TABLE main.x' }, { ...design(), columns: [{ ...design().columns[0], generated: '1+1' }] }, { ...design(), indexes: [{ name: 'idx', unique: false, columns: [{ name: 'id', order: 'asc', expression: 'id+1' }] }] }]) expect(sqliteTableCreateDesignSchema.safeParse(invalid).success).toBe(false);
    for (const invalid of [{ kind: 'none', value: '' }, { kind: 'null', value: null }, { kind: 'current-date', value: 'now' }, { kind: 'current-timestamp', expression: 'datetime()' }, { kind: 'integer', value: 7 }, { kind: 'text' }, { kind: 'expression', value: 'random()' }]) expect(sqliteTableCreateDefaultSchema.safeParse(invalid).success).toBe(false);
    for (const kind of ['none', 'null', 'current-date', 'current-time', 'current-timestamp']) expect(sqliteTableCreateDefaultSchema.safeParse({ kind }).success).toBe(true);
  });

  it('有效Unicode引号/非BMP名称保留；控制、孤立代理项与ASCII保留前缀拒绝', () => {
    const valid = design({ name: '🚢'.repeat(255) }); expect(sqliteTableCreateDesignSchema.parse(valid).name).toBe(valid.name);
    for (const name of ['', '   ', '🚢'.repeat(256), 'a\0b', 'a\nb', 'a\u007fb', 'a\u0085b', '\ud800', 'SQLite_reserved']) expect(sqliteTableCreateDesignSchema.safeParse(design({ name })).success).toBe(false);
    for (const name of ['sqlite_idx', 'SQLITE_idx']) expect(sqliteTableCreateDesignSchema.safeParse(design({ indexes: [{ name, unique: false, columns: [{ name: 'id', order: 'asc' }] }] })).success).toBe(false);
    expect(sqliteTableCreateDesignSchema.safeParse(design({ columns: [{ ...design().columns[0], name: 'sqlite_column' }], primaryKey: ['sqlite_column'] })).success).toBe(true);
  });

  it('列名只按ASCII去重，键引用按同一规则定位并保存有序原列名', () => {
    const first = design().columns[0]; expect(sqliteTableCreateDesignSchema.safeParse(design({ columns: [first, { ...first, name: 'ID' }] })).success).toBe(false);
    const unicode = design({ columns: [{ ...first, name: 'Ä' }, { ...first, name: 'ä' }], primaryKey: ['Ä', 'ä'] }); expect(sqliteTableCreateDesignSchema.safeParse(unicode).success).toBe(true);
    database(db => { create(db, unicode); expect(db.prepare(`PRAGMA main.table_xinfo(${quote(unicode.name)})`).all().map(row => row.name)).toEqual(['Ä', 'ä']); });
    const value = design({ primaryKey: ['ID'], indexes: [{ name: 'idx_note', unique: false, columns: [{ name: 'NOTE', order: 'desc' }, { name: 'ID', order: 'asc' }] }] }); const built = buildSqliteTableCreate(value); expect(built.sql[0]).toContain('PRIMARY KEY ("id")'); expect(built.sql[1]).toContain('("note" DESC, "id" ASC)');
    for (const primaryKey of [['missing'], ['id', 'ID'], ['note']]) expect(sqliteTableCreateDesignSchema.safeParse(design({ primaryKey })).success).toBe(false);
    expect(sqliteTableCreateDesignSchema.safeParse(design({ indexes: [{ name: 'idx', unique: false, columns: [{ name: 'id', order: 'asc' }, { name: 'ID', order: 'desc' }] }] })).success).toBe(false);
  });

  it('字段、索引、外键与parts的界限及表/索引命名冲突在编译前拒绝', () => {
    const column = design().columns[0]; const columns = Array.from({ length: 128 }, (_, index) => ({ ...column, name: 'c' + index })); expect(sqliteTableCreateDesignSchema.safeParse(design({ columns, primaryKey: [] })).success).toBe(true);
    for (const list of [[], [...columns, { ...column, name: 'overflow' }]]) expect(sqliteTableCreateDesignSchema.safeParse(design({ columns: list, primaryKey: [] })).success).toBe(false);
    const index = { name: 'idx', unique: false, columns: [{ name: 'id', order: 'asc' as const }] };
    for (const indexes of [Array.from({ length: 33 }, (_, number) => ({ ...index, name: 'i' + number })), [index, { ...index, name: 'IDX' }], [{ ...index, name: design().name }], [{ ...index, columns: [] }], [{ ...index, columns: Array.from({ length: 33 }, () => ({ name: 'id', order: 'asc' as const })) }]]) expect(sqliteTableCreateDesignSchema.safeParse(design({ indexes })).success).toBe(false);
    const key = { name: 'fk', columns: ['id'], referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'CASCADE' as const, onUpdate: 'NO ACTION' as const, deferred: false };
    for (const foreignKeys of [Array.from({ length: 33 }, (_, number) => ({ ...key, name: 'f' + number })), [{ ...key, columns: [] }], [{ ...key, columns: ['missing'] }], [{ ...key, referencedColumns: ['id', 'other'] }], [{ ...key, referencedColumns: ['id', 'ID'] }], [{ ...key, referencedTable: design().name, referencedColumns: ['missing'] }]]) expect(sqliteTableCreateDesignSchema.safeParse(design({ foreignKeys })).success).toBe(false);
    expect(sqliteTableCreateDesignSchema.safeParse({ ...design(), foreignKeys: [{ ...key, onDelete: 'DROP TABLE' }] }).success).toBe(false);
  });

  it('每值64KiB UTF8/Blob预算和整体2MiB预算先于DDL发布，巨长整数不进入BigInt', () => {
    expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'text', value: '🚢'.repeat(16384) }).success).toBe(true); expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'text', value: '🚢'.repeat(16385) }).success).toBe(false);
    expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'text', value: '中'.repeat(21846) }).success).toBe(false); expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'text', value: '\udfff' }).success).toBe(false);
    expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'blob', value: 'af'.repeat(65536) }).success).toBe(true); expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'blob', value: 'af'.repeat(65537) }).success).toBe(false);
    for (const value of ['f', '0x00', '00 gg']) expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'blob', value }).success).toBe(false);
    const parse = vi.spyOn(globalThis, 'BigInt'); try { expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'integer', value: '0'.repeat(100000) }).success).toBe(false); expect(parse).not.toHaveBeenCalled(); } finally { parse.mockRestore(); }
    const columns = Array.from({ length: 32 }, (_, index) => ({ name: 'c' + index, declaredType: 'TEXT', nullable: true, default: { kind: 'text' as const, value: 'a'.repeat(65536) } })); expect(sqliteTableCreateDesignSchema.safeParse(design({ columns, primaryKey: [] })).success).toBe(false); expect(sqliteTableCreateDesignSchema.safeParse(design({ columns: columns.slice(1), primaryKey: [] })).success).toBe(true); expect(sqliteTableCreateLimits.designBytes).toBe(2 * 1024 * 1024);
  });

  it('INTEGER规范化且不越signed64，REAL拒非有限/表达式并把整数外观变为REAL字面量', () => {
    for (const value of ['-9223372036854775808', '9223372036854775807', '+00042', '-0000']) expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'integer', value }).success).toBe(true);
    for (const value of ['-9223372036854775809', '9223372036854775808', '1e3', '1;SELECT 2', '000000000000000000001']) expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'integer', value }).success).toBe(false);
    for (const value of ['Infinity', '-Infinity', 'NaN', '1e999', '1/2', '1;SELECT 2']) expect(sqliteTableCreateDefaultSchema.safeParse({ kind: 'real', value }).success).toBe(false);
    const value = design({ columns: [{ name: 'i', declaredType: 'INTEGER', nullable: false, default: { kind: 'integer', value: '+00042' } }, { name: 'r', declaredType: 'BLOB', nullable: false, default: { kind: 'real', value: '7' } }], primaryKey: [] });
    const built = buildSqliteTableCreate(value); expect(built.sql[0]).toContain('DEFAULT 42'); expect(built.sql[0]).toContain('DEFAULT 7.0'); database(db => { create(db, value); db.exec(`INSERT INTO ${quote(value.name)} DEFAULT VALUES`); expect(db.prepare(`SELECT i,r,typeof(r) AS real_type FROM ${quote(value.name)}`).get()).toEqual({ i: 42, r: 7, real_type: 'real' }); });
  });

  it('名称/类型整体引用，内嵌DEFAULT/分号/引号不能制造约束或第二条语句', () => {
    const value = design({ name: 'table"; DROP TABLE guard; --🚢', columns: [{ name: 'x"🚢', declaredType: 'TEXT" DEFAULT 7); DROP TABLE guard; --', nullable: true, default: { kind: 'none' } }], primaryKey: [], indexes: [{ name: 'index"🚢', unique: false, columns: [{ name: 'x"🚢', order: 'desc' }] }] }); const before = structuredClone(value), built = buildSqliteTableCreate(value); expect(value).toEqual(before); expect(sqliteTableCreatePlannedNames(value)).toEqual({ table: value.name, indexes: [value.indexes[0].name] }); expect(built.sql).toHaveLength(2);
    database(db => { db.exec('CREATE TABLE guard(value TEXT); INSERT INTO guard VALUES(\'仍存在\')'); create(db, value); expect(db.prepare('SELECT * FROM guard').all()).toEqual([{ value: '仍存在' }]); expect(db.prepare(`PRAGMA main.table_xinfo(${quote(value.name)})`).all()).toMatchObject([{ name: value.columns[0].name, type: value.columns[0].declaredType, dflt_value: null, pk: 0 }]); });
    vi.stubGlobal('Buffer', undefined); try { expect(buildSqliteTableCreate(design({ columns: [{ name: 'text', declaredType: 'TEXT', nullable: true, default: { kind: 'text', value: "中文'🚢\0尾" } }], primaryKey: [] })).sql[0]).toContain('char(0)'); } finally { vi.unstubAllGlobals(); }
  });
});

describe('SQLite真实原生DDL、默认值及键语义', () => {
  it('quoted INTEGER仍是原生AUTOINCREMENT rowid alias，普通/unique索引顺序与collation精确保留', () => database(db => {
    const value = design({ autoIncrement: true, indexes: [{ name: 'unique_note_id🚢', unique: true, columns: [{ name: 'note', order: 'asc' }, { name: 'id', order: 'desc' }] }, { name: 'normal_note', unique: false, columns: [{ name: 'note', order: 'desc' }] }] }); create(db, value);
    db.exec(`INSERT INTO ${quote(value.name)} DEFAULT VALUES; INSERT INTO ${quote(value.name)}(id) VALUES(10); DELETE FROM ${quote(value.name)} WHERE id=10; INSERT INTO ${quote(value.name)} DEFAULT VALUES`); expect(db.prepare(`SELECT rowid AS physical_rowid,id,note FROM ${quote(value.name)} ORDER BY id`).all()).toEqual([{ physical_rowid: 1, id: 1, note: "原文'中文🚢" }, { physical_rowid: 11, id: 11, note: "原文'中文🚢" }]);
    const parts = db.prepare(`PRAGMA main.index_xinfo(${quote(value.indexes[0].name)})`).all().filter(row => row.key === 1); expect(parts.map(row => ({ name: row.name, desc: row.desc, coll: row.coll }))).toEqual([{ name: 'note', desc: 0, coll: 'NOCASE' }, { name: 'id', desc: 1, coll: 'BINARY' }]); expect(db.prepare(`PRAGMA main.index_list(${quote(value.name)})`).all().map(row => ({ name: row.name, unique: row.unique })).sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual([{ name: 'normal_note', unique: 0 }, { name: 'unique_note_id🚢', unique: 1 }]);
  }));

  it('PK必须全非空，AUTOINCREMENT/STRICT/WITHOUT ROWID不合法组合在执行前拒绝', () => {
    for (const value of [design({ primaryKey: ['note'] }), design({ autoIncrement: true, primaryKey: [] }), design({ autoIncrement: true, withoutRowid: true }), design({ autoIncrement: true, columns: [{ ...design().columns[0], declaredType: 'INT' }] }), design({ autoIncrement: true, columns: [{ ...design().columns[0], default: { kind: 'integer', value: '1' } }] }), design({ withoutRowid: true, primaryKey: [] }), design({ strict: true, columns: [{ ...design().columns[0], declaredType: 'VARCHAR(255)' }] })]) expect(() => buildSqliteTableCreate(value)).toThrow();
    for (const declaredType of ['INT', 'INTEGER', 'REAL', 'TEXT', 'BLOB', 'ANY', 'integer']) database(db => { const value = design({ strict: true, primaryKey: [], columns: [{ name: 'value', declaredType, nullable: true, default: { kind: 'none' } }] }); create(db, value); expect(db.prepare('PRAGMA main.table_list').all().find(row => row.name === value.name)).toMatchObject({ strict: 1 }); });
  });

  it('WITHOUT ROWID复合PK、STRICT与延迟复合FK在同一原生事务生效', () => database(db => {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE parent(a INTEGER,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID'); const value = design({ name: 'child🚢', columns: [{ name: 'tenant', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'parent_id', declaredType: 'INTEGER', nullable: true, default: { kind: 'null' } }], primaryKey: ['tenant', 'id'], strict: true, withoutRowid: true, foreignKeys: [{ name: 'fk_复合🚢', columns: ['tenant', 'parent_id'], referencedTable: 'parent', referencedColumns: ['a', 'b'], onDelete: 'CASCADE', onUpdate: 'CASCADE', deferred: true }] }); create(db, value);
    expect(db.prepare('PRAGMA main.table_list').all().find(row => row.name === value.name)).toMatchObject({ wr: 1, strict: 1 }); expect(() => db.prepare(`SELECT rowid FROM ${quote(value.name)}`).all()).toThrow(); db.exec(`BEGIN; INSERT INTO ${quote(value.name)} VALUES(1,5,2); INSERT INTO parent VALUES(1,2); COMMIT`); expect(db.prepare(`SELECT * FROM ${quote(value.name)}`).all()).toEqual([{ tenant: 1, id: 5, parent_id: 2 }]); expect(db.prepare(`PRAGMA main.foreign_key_list(${quote(value.name)})`).all().map(row => ({ seq: row.seq, from: row.from, to: row.to, on_update: row.on_update, on_delete: row.on_delete }))).toEqual([{ seq: 0, from: 'tenant', to: 'a', on_update: 'CASCADE', on_delete: 'CASCADE' }, { seq: 1, from: 'parent_id', to: 'b', on_update: 'CASCADE', on_delete: 'CASCADE' }]); db.exec('DELETE FROM parent'); expect(db.prepare(`SELECT * FROM ${quote(value.name)}`).all()).toEqual([]);
  }));

  it('自引用外键使用已设计列，真实SET NULL动作不借外部数据库', () => database(db => {
    db.exec('PRAGMA foreign_keys=ON'); const value = design({ name: 'self🚢', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'parent_id', declaredType: 'INTEGER', nullable: true, default: { kind: 'none' } }], foreignKeys: [{ name: 'self_fk', columns: ['parent_id'], referencedTable: 'SELF🚢', referencedColumns: ['ID'], onDelete: 'SET NULL', onUpdate: 'RESTRICT', deferred: false }] }); create(db, value); db.exec(`INSERT INTO ${quote(value.name)} VALUES(1,NULL),(2,1); DELETE FROM ${quote(value.name)} WHERE id=1`); expect(db.prepare(`SELECT * FROM ${quote(value.name)}`).all()).toEqual([{ id: 2, parent_id: null }]);
  }));

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s默认TEXT完整保留普通段、首尾连续NUL、引号和非BMP字符', encoding => database(db => {
    db.exec(`PRAGMA encoding='${encoding}'`); const texts = { value: "\0首'🚢\0\0尾中文\0", empty: '', nul_only: '\0\0', plain: "普通'中文🚢" }, value = design({ name: 'encoding默认🚢', columns: Object.entries(texts).map(([name, text]) => ({ name, declaredType: 'TEXT', nullable: false, default: { kind: 'text' as const, value: text } })), primaryKey: [] }); const built = create(db, value); expect(built.sql[0]).toContain('char(0)'); expect(built.sql[0]).not.toContain('CAST('); db.exec(`INSERT INTO ${quote(value.name)} DEFAULT VALUES`);
    for (const [name, text] of Object.entries(texts)) { const bytes = encoding === 'UTF-8' ? Buffer.from(text, 'utf8') : Buffer.from(text, 'utf16le'); if (encoding === 'UTF-16be') bytes.swap16(); expect(db.prepare(`SELECT ${quote(name)} AS value,typeof(${quote(name)}) AS storage,hex(CAST(${quote(name)} AS BLOB)) AS encoded FROM ${quote(value.name)}`).get()).toEqual({ value: text, storage: 'text', encoded: bytes.toString('hex').toUpperCase() }); }
  }));

  it('大量连续NUL采用平衡表达式，原生DEFAULT不超过线性树深度限制', () => database(db => {
    const text = '\0'.repeat(1024), value = design({ primaryKey: [], columns: [{ name: 'value', declaredType: 'TEXT', nullable: false, default: { kind: 'text', value: text } }] }); create(db, value); db.exec(`INSERT INTO ${quote(value.name)} DEFAULT VALUES`); expect(db.prepare(`SELECT value FROM ${quote(value.name)}`).get()).toEqual({ value: text });
  }));

  it('全部typed默认值是真实原生默认值；SQL clock固定、NULL与省略可区分，REAL/BLOB/int64不靠JS Number', () => database(db => {
    const value = design({ name: 'defaults', primaryKey: [], columns: [{ name: 'absent', declaredType: 'TEXT', nullable: true, default: { kind: 'none' } }, { name: 'nil', declaredType: 'TEXT', nullable: true, default: { kind: 'null' } }, { name: 'i', declaredType: 'INTEGER', nullable: false, default: { kind: 'integer', value: '-9223372036854775808' } }, { name: 'r', declaredType: 'BLOB', nullable: false, default: { kind: 'real', value: '-1e2' } }, { name: 'b', declaredType: 'BLOB', nullable: false, default: { kind: 'blob', value: '00fFa1' } }, { name: 'day', declaredType: 'TEXT', nullable: false, default: { kind: 'current-date' } }, { name: 'clock', declaredType: 'TEXT', nullable: false, default: { kind: 'current-time' } }, { name: 'stamp', declaredType: 'TEXT', nullable: false, default: { kind: 'current-timestamp' } }] }); create(db, value); db.exec('INSERT INTO defaults DEFAULT VALUES'); const row = db.prepare('SELECT absent,nil,CAST(i AS TEXT) AS i,typeof(i) AS it,r,typeof(r) AS rt,hex(b) AS b,typeof(b) AS bt,day,clock,stamp FROM defaults').get(); expect(row).toMatchObject({ absent: null, nil: null, i: '-9223372036854775808', it: 'integer', r: -100, rt: 'real', b: '00FFA1', bt: 'blob', day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), clock: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/), stamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) }); const columns = db.prepare('PRAGMA main.table_xinfo(defaults)').all(); expect(columns.find(column => column.name === 'absent')?.dflt_value).toBe(null); expect(columns.find(column => column.name === 'nil')?.dflt_value).toBe('NULL');
  }));
});

describe('SQLite新建表预览令牌与不可矛盾的提交事实', () => {
  it('公共输入strict且只允许main设计/准确预览确认，不接受SQL、路径或私有回调', () => {
    const preview = { connectionId: target.connectionId, database: 'main', design: design(), taskId: 'preview-task' }; expect(sqliteTableCreatePreviewSchema.parse(preview)).toEqual(preview);
    for (const input of [{ ...preview, database: 'temp' }, { ...preview, sql: ['CREATE TABLE x(x)'] }, { ...preview, path: '外部文件' }, { ...preview, assertCurrent: () => {} }]) expect(sqliteTableCreatePreviewSchema.safeParse(input).success).toBe(false);
    expect(sqliteTableCreateApplySchema.parse({ previewId: 'preview-owned', taskId: 'apply-task', confirmation: target.table })).toEqual({ previewId: 'preview-owned', taskId: 'apply-task', confirmation: target.table }); expect(sqliteTableCreateApplySchema.safeParse({ previewId: 'p', taskId: 't', confirmation: 'x', design: design() }).success).toBe(false); expect(sqliteTableCreateReleaseSchema.safeParse({ previewId: 'p', connectionId: 'other' }).success).toBe(false);
  });

  it('阶段/数量/ACK相互约束，fact不允许设计/SQL/路径或凭据', () => {
    for (const value of [fact(), fact({ phase: 'writing', completedStatements: 1 }), fact({ phase: 'commit-pending', completedStatements: 2, commitMayHaveBeenSent: true }), fact({ phase: 'committed', completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: true }), fact({ phase: 'rolled-back', completedStatements: 1, rollbackAcknowledged: true }), fact({ phase: 'unknown', completedStatements: 1, commitMayHaveBeenSent: true })]) expect(sqliteTableCreateFactSchema.safeParse(value).success).toBe(true);
    for (const value of [fact({ completedStatements: 1 }), fact({ phase: 'writing', commitMayHaveBeenSent: true }), fact({ phase: 'commit-pending', completedStatements: 1, commitMayHaveBeenSent: true }), fact({ phase: 'committed', completedStatements: 2, commitAcknowledged: true }), fact({ phase: 'rolled-back' }), fact({ phase: 'unknown', rollbackAcknowledged: true }), fact({ phase: 'committed', completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: true }), fact({ phase: 'writing', completedStatements: 3 }), { ...fact(), sql: 'CREATE TABLE x(x)' }, { ...fact(), filePath: '外部路径' }]) expect(sqliteTableCreateFactSchema.safeParse(value).success).toBe(false);
    const committed = fact({ phase: 'committed', completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: true }), outcome = { operationId: committed.operationId, target: committed.target, outcome: 'committed', fact: committed, message: '已提交', definitionVerified: true }; expect(sqliteTableCreateOutcomeSchema.safeParse(outcome).success).toBe(true); for (const input of [{ ...outcome, operationId: 'other' }, { ...outcome, target: { ...target, connectionId: 'other' } }, { ...outcome, outcome: 'unknown' }, { ...outcome, sql: ['secret'] }, { ...outcome, outcome: 'not-sent', fact: fact() }]) expect(sqliteTableCreateOutcomeSchema.safeParse(input).success).toBe(false);
  });

  it('事实不能倒退；同步COMMIT前持久失败的真实rollbackACK允许收束maySent', () => {
    const writing = fact({ phase: 'writing', completedStatements: 1 }), pending = fact({ phase: 'commit-pending', completedStatements: 2, commitMayHaveBeenSent: true }), committed = fact({ phase: 'committed', completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: true }), rolledBack = fact({ phase: 'rolled-back', completedStatements: 2, rollbackAcknowledged: true }), unknown = fact({ phase: 'unknown', completedStatements: 2, commitMayHaveBeenSent: true });
    expect(() => assertSqliteTableCreateFactTransition(fact(), writing)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(writing, pending)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(pending, committed)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(pending, rolledBack)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(pending, unknown)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(unknown, committed)).not.toThrow(); expect(() => assertSqliteTableCreateFactTransition(unknown, rolledBack)).not.toThrow();
    for (const [before, after] of [[writing, fact()], [committed, unknown], [rolledBack, committed], [pending, fact({ phase: 'unknown', completedStatements: 2 })], [writing, fact({ phase: 'writing' })], [writing, { ...writing, operationId: 'other' }], [writing, { ...writing, requestedStatements: 3 }], [writing, { ...writing, target: { ...target, table: 'other' } }]]) expect(() => assertSqliteTableCreateFactTransition(before, after)).toThrow();
  });
});
