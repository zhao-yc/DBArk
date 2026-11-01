import type { SqliteValue } from '../../src/engine/sqlite/protocol';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { compareSqliteRebuildTables as compare, copySqliteRebuildComparisonInput as copyInput, copySqliteRebuildComparisonResult as copyResult, SqliteRebuildComparisonError, sqliteRebuildStoredKeyEquivalent as storedKeyEquivalent, type SqliteRebuildComparisonInput } from '../../src/engine/sqlite/rebuildComparison';

const valueMismatch = 'SQLITE_REBUILD_COMPARISON_VALUE_MISMATCH', rowidMismatch = 'SQLITE_REBUILD_COMPARISON_ROWID_INVALID';
/** 只比较原生内存库中已存在的两表；本夹具不冒称Main复制、提交或真实文件验收。 */
async function fixture(action: (db: DatabaseSync, input: SqliteRebuildComparisonInput) => Promise<void>, sql = 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE)'): Promise<void> {
  const db = new DatabaseSync(':memory:');
  try { db.exec(sql + '; BEGIN IMMEDIATE'); await action(db, { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' } }); }
  finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
}
/** 控制端口无SQL行为；每次yield和进度均是真实异步Promise，取消异常保持原身份。 */
function control() { return { check: vi.fn(), yield: vi.fn(async () => { await Promise.resolve(); }), progress: vi.fn(async (_rows: string) => { await Promise.resolve(); }) }; }
/** 固定复制仅用于准备原生候选；模块本身不执行任何写操作。 */
function copy(db: DatabaseSync): void { db.exec('INSERT OR ABORT INTO candidate(id,value,ordinal) SELECT id,value,ROW_NUMBER() OVER(ORDER BY id COLLATE BINARY ASC) FROM source'); }

describe('SQLite私有全量比较的原生数据与精度', () => {
  it('混合NULL/int64/REAL/TEXT/NUL/BLOB全量逐值核对，不改变两表或事务', async () => fixture(async (db, input) => {
    const insert = db.prepare('INSERT INTO source(id,value) VALUES(?,?)'), values: SQLInputValue[] = [null, 9223372036854775807n, -9223372036854775808n, 1.25, Infinity, '中文🚢\0尾\0', new Uint8Array([0, 255, 128])]; values.forEach((value, index) => insert.run(BigInt(index + 1), value)); copy(db); const before = db.prepare('SELECT id,typeof(value) AS kind,hex(value) AS bytes FROM candidate ORDER BY id').all(), c = control();
    expect(await compare(db, input, c)).toEqual({ sourceRows: '7', candidateRows: '7', verifiedRows: '7', columnGroups: 1 }); expect(db.prepare('SELECT id,typeof(value) AS kind,hex(value) AS bytes FROM candidate ORDER BY id').all()).toEqual(before); expect(db.isTransaction).toBe(true); expect(c.progress.mock.calls.at(-1)).toEqual(['7']);
  }));
  it.each([
    ['整数到REAL精确', 9007199254740992n, 'REAL', true], ['大于安全整数但恰可IEEE表示', 1152921504606846976n, 'REAL', true],
    ['整数到REAL舍入', 9007199254740993n, 'REAL', false], ['int64最大值到REAL', 9223372036854775807n, 'REAL', false],
    ['canonical文本到整数', '123', 'INTEGER', true], ['文本前导零', '001', 'INTEGER', false], ['文本正号', '+1', 'INTEGER', false], ['文本负零到整数', '-0', 'INTEGER', false],
    ['二进制精确小数', '1.5', 'REAL', true], ['另一个精确小数', '0.125', 'REAL', true], ['十进制0.1无法精确IEEE', '0.1', 'REAL', false], ['表面canonical的次正规舍入', '5e-324', 'REAL', false],
    ['实数精确转整数', 1, 'INTEGER', true], ['整数亲和性不强截小数', 1.5, 'INTEGER', true], ['整数转文本', 9223372036854775807n, 'TEXT', true], ['REAL转文本可还原', 1.5, 'TEXT', true], ['REAL转文本原生保留可还原低位', 0.10000000000000002, 'TEXT', true],
  ] as const)('%s必须由实际存储值证明', async (_label, value, type, accepted) => fixture(async (db, input) => {
    db.prepare('INSERT INTO source VALUES(1,?)').run(value); copy(db); const pending = compare(db, { ...input, losslessColumns: ['value'] }, control()); if (accepted) expect((await pending).verifiedRows).toBe('1'); else await expect(pending).rejects.toMatchObject({ code: valueMismatch });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value ' + type + ',ordinal INTEGER NOT NULL UNIQUE)'));
  it('原生REAL转TEXT保留低位时可通过，显式截短后必须拒绝，不能只看十进制前缀', async () => fixture(async (db, input) => {
    const original = 0.10000000000000002; db.prepare('INSERT INTO source VALUES(1,?)').run(original); copy(db);
    const source = db.prepare('SELECT value FROM source').get()?.value, candidate = db.prepare('SELECT value FROM candidate').get()?.value;
    const request = { ...input, losslessColumns: ['value'] }; expect(source).toBe(original); expect(typeof candidate).toBe('string'); expect(Object.is(Number(candidate), source)).toBe(true); expect((await compare(db, request, control())).verifiedRows).toBe('1');
    db.exec("UPDATE candidate SET value='0.1'"); expect(Object.is(Number(db.prepare('SELECT value FROM candidate').get()?.value), source)).toBe(false); await expect(compare(db, request, control())).rejects.toMatchObject({ code: valueMismatch });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value TEXT,ordinal INTEGER NOT NULL UNIQUE)'));
  it('相同storage的无效UTF8只按真实BLOB字节核对，不能因JS替换字符串相同而误通过', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source VALUES(1,CAST(X'80FF00' AS TEXT)); INSERT INTO candidate VALUES(1,CAST(X'80FF00' AS TEXT),1)"); expect((await compare(db, input, control())).verifiedRows).toBe('1');
    db.exec("UPDATE candidate SET value=CAST(X'81FF00' AS TEXT)"); expect(db.prepare('SELECT value FROM source').get()?.value).toBe(db.prepare('SELECT value FROM candidate').get()?.value); await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch });
  }));
  it('无效TEXT即使获列转换权也不能借替换字符变成整数', async () => fixture(async (db, input) => { db.exec("INSERT INTO source VALUES(1,CAST(X'FF' AS TEXT)); INSERT INTO candidate VALUES(1,0,1)"); await expect(compare(db, { ...input, losslessColumns: ['value'] }, control())).rejects.toMatchObject({ code: valueMismatch }); }));
  it.each(['UTF-16le', 'UTF-16be'])('%s TEXT比较使用库原编码，保留BOM和NUL', async encoding => {
    const db = new DatabaseSync(':memory:'); try { db.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value TEXT,ordinal INTEGER NOT NULL UNIQUE); BEGIN IMMEDIATE"); db.prepare('INSERT INTO source VALUES(1,?)').run('\uFEFF中文\0🚢'); copy(db); expect((await compare(db, { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' } }, control())).verifiedRows).toBe('1'); } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('两端原生typeof均为REAL时必须按Object.is拒绝不同零位，不能只测跨storage分支', async () => {
    const db = new DatabaseSync(':memory:'); try {
      db.function('negative_zero', { deterministic: true }, () => -0); db.exec('CREATE TABLE source(id INTEGER PRIMARY KEY,value AS(negative_zero()) VIRTUAL); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value AS(0.0) VIRTUAL,ordinal INTEGER NOT NULL UNIQUE); INSERT INTO source(id) VALUES(1); INSERT INTO candidate(id,ordinal) VALUES(1,1); BEGIN IMMEDIATE');
      const source = db.prepare('SELECT value,typeof(value) AS kind FROM source').get()!, candidate = db.prepare('SELECT value,typeof(value) AS kind FROM candidate').get()!; expect(source.kind).toBe('real'); expect(candidate.kind).toBe('real'); expect(Object.is(source.value, -0)).toBe(true); expect(Object.is(candidate.value, 0)).toBe(true);
      await expect(compare(db, { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' } }, control())).rejects.toMatchObject({ code: valueMismatch });
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('跨INTEGER/TEXT即使获转换权也不能抹负零，文本必须可还原原REAL位', async () => {
    const db = new DatabaseSync(':memory:'); try {
      // 真实probe证明REAL亲和性会规范化负零；无声明type的VIRTUAL原生计算值才保留原IEEE负零。
      db.function('negative_zero', { deterministic: true }, () => -0); db.exec('CREATE TABLE source(id INTEGER PRIMARY KEY,value AS(negative_zero()) VIRTUAL); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE); INSERT INTO source(id) VALUES(1); INSERT INTO candidate VALUES(1,0,1); BEGIN IMMEDIATE');
      const input = { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' }, losslessColumns: ['value'] }; expect(Object.is(db.prepare('SELECT value FROM source').get()?.value, -0)).toBe(true); expect(db.prepare('SELECT typeof(value) AS kind FROM candidate').get()?.kind).toBe('integer');
      await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch }); db.exec("UPDATE candidate SET value='0'"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch }); db.exec("UPDATE candidate SET value='-0'"); expect((await compare(db, input, control())).verifiedRows).toBe('1');
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('所有用户列包含VIRTUAL和STORED生成列，任一重算变化都失败', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source(id,raw) VALUES(1,'原值'); INSERT INTO candidate(id,raw,ordinal) SELECT id,raw,1 FROM source"); const request = { ...input, columns: ['id', 'raw', 'virtual_value', 'stored_value'] }; expect((await compare(db, request, control())).verifiedRows).toBe('1'); db.exec("UPDATE candidate SET raw='变化'"); await expect(compare(db, request, control())).rejects.toMatchObject({ code: valueMismatch });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,raw TEXT,virtual_value TEXT AS(raw||\'v\') VIRTUAL,stored_value TEXT AS(raw||\'s\') STORED); CREATE TABLE candidate(id INTEGER PRIMARY KEY,raw TEXT,virtual_value TEXT AS(raw||\'v\') VIRTUAL,stored_value TEXT AS(raw||\'s\') STORED,ordinal INTEGER NOT NULL UNIQUE)'));
  it('缺省及空名单均禁止跨storage；仅指定列获得转换权，精度门仍独立生效', async () => fixture(async (db, input) => {
    db.exec('INSERT INTO source VALUES(1,7)'); copy(db); await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch }); await expect(compare(db, { ...input, losslessColumns: [] }, control())).rejects.toMatchObject({ code: valueMismatch }); await expect(compare(db, { ...input, losslessColumns: ['id'] }, control())).rejects.toMatchObject({ code: valueMismatch }); expect((await compare(db, { ...input, losslessColumns: ['value'] }, control())).verifiedRows).toBe('1');
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value TEXT,ordinal INTEGER NOT NULL UNIQUE)'));
  it('生成列也要逐列授权，不能因其它字段获类型转换权而默许生成值换storage', async () => fixture(async (db, input) => {
    db.exec('INSERT INTO source(id) VALUES(1); INSERT INTO candidate(id,ordinal) VALUES(1,1)'); const request = { ...input, columns: ['id', 'generated'] }; await expect(compare(db, request, control())).rejects.toMatchObject({ code: valueMismatch }); await expect(compare(db, { ...request, losslessColumns: ['id'] }, control())).rejects.toMatchObject({ code: valueMismatch }); expect((await compare(db, { ...request, losslessColumns: ['generated'] }, control())).verifiedRows).toBe('1');
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,generated AS(id) VIRTUAL); CREATE TABLE candidate(id INTEGER PRIMARY KEY,generated TEXT AS(id) VIRTUAL,ordinal INTEGER NOT NULL UNIQUE)'));
});

describe('SQLite全量比较的真实rowid、WR顺序和候选序号', () => {
  it('真正IPK与未遮蔽伪别名均可核对，源rowid负数/大int64也逐行保存', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source VALUES(-8,'a'),(9223372036854775807,'b')"); copy(db); expect((await compare(db, input, control())).verifiedRows).toBe('2'); expect((await compare(db, { ...input, sourceOrder: ['_rowid_'], rowid: { source: '_rowid_', candidate: '_rowid_' } }, control())).verifiedRows).toBe('2');
  }));
  it('所有用户值相同也不能掩盖候选隐藏rowid重编号', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source(rowid,value) VALUES(101,'a'),(205,'b'); INSERT INTO candidate(value,ordinal) SELECT value,ROW_NUMBER() OVER(ORDER BY rowid COLLATE BINARY ASC) FROM source"); await expect(compare(db, { ...input, sourceOrder: ['_rowid_'], columns: ['value'], rowid: { source: '_rowid_', candidate: '_rowid_' } }, control())).rejects.toMatchObject({ code: rowidMismatch });
  }, 'CREATE TABLE source(value); CREATE TABLE candidate(value,ordinal INTEGER NOT NULL UNIQUE)'));
  it('INTEGER PRIMARY KEY DESC不是rowid别名，必须通过真实伪别名核对', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source(rowid,id,value) VALUES(100,1,'a'); INSERT INTO candidate(rowid,id,value,ordinal) VALUES(100,1,'a',1)"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: rowidMismatch }); expect((await compare(db, { ...input, sourceOrder: ['_rowid_'], rowid: { source: '_rowid_', candidate: '_rowid_' } }, control())).verifiedRows).toBe('1');
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY DESC,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY DESC,value,ordinal INTEGER NOT NULL UNIQUE)'));
  it('三个伪别名都被遮蔽时只接受真实IPK，candidate将INTEGER改INT后不能冒充保rowid', async () => fixture(async (db, input) => {
    db.exec("INSERT INTO source VALUES(100,'r','o','u'); INSERT INTO candidate VALUES(100,'r','o','u',1)"); const request = { ...input, columns: ['id', 'rowid', 'oid', '_rowid_'] }; await expect(compare(db, request, control())).rejects.toMatchObject({ code: rowidMismatch });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,rowid TEXT,oid TEXT,_rowid_ TEXT); CREATE TABLE candidate(id INT PRIMARY KEY,rowid TEXT,oid TEXT,_rowid_ TEXT,ordinal INTEGER NOT NULL UNIQUE)'));
  it('WR完整PK按BINARY形成总序，candidate类型改变后主键物理顺序不同仍按ordinal核对', async () => {
    const db = new DatabaseSync(':memory:'); try { db.exec("CREATE TABLE source(key TEXT COLLATE NOCASE,value TEXT,PRIMARY KEY(key COLLATE BINARY)) WITHOUT ROWID; CREATE TABLE candidate(key TEXT COLLATE NOCASE,value TEXT,ordinal INTEGER NOT NULL UNIQUE,PRIMARY KEY(key COLLATE BINARY)) WITHOUT ROWID; INSERT INTO source VALUES('a','lower'),('A','upper'); INSERT INTO candidate SELECT key,value,ROW_NUMBER() OVER(ORDER BY key COLLATE BINARY ASC) FROM source; BEGIN IMMEDIATE"); const input = { source: 'source', candidate: 'candidate', sourceOrder: ['key'], candidateOrdinal: 'ordinal', columns: ['key', 'value'] }; expect((await compare(db, input, control())).verifiedRows).toBe('2'); await expect(compare(db, { ...input, rowid: { source: 'rowid', candidate: 'rowid' } }, control())).rejects.toMatchObject({ code: rowidMismatch }); await expect(compare(db, { ...input, sourceOrder: ['value'] }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_SOURCE_ORDER_INVALID' }); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
    await fixture(async (native, input) => { native.exec("INSERT INTO source VALUES(2,'two'),(10,'ten'); INSERT INTO candidate SELECT key,value,ROW_NUMBER() OVER(ORDER BY key COLLATE BINARY ASC) FROM source"); expect((await compare(native, { ...input, sourceOrder: ['key'], columns: ['key', 'value'], rowid: undefined, losslessColumns: ['key'] }, control())).verifiedRows).toBe('2'); }, 'CREATE TABLE source(key INTEGER PRIMARY KEY,value TEXT) WITHOUT ROWID; CREATE TABLE candidate(key TEXT PRIMARY KEY,value TEXT,ordinal INTEGER NOT NULL UNIQUE) WITHOUT ROWID');
  });
  it.each([
    'ordinal TEXT NOT NULL UNIQUE', 'ordinal INTEGER UNIQUE', 'ordinal INTEGER NOT NULL',
    'ordinal INTEGER NOT NULL, UNIQUE(ordinal,id)', 'ordinal INTEGER AS(id) STORED NOT NULL UNIQUE',
  ])('候选序号定义%s不足以证明完整连续单列唯一', async ordinal => fixture(async (db, input) => { await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID' }); }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,' + ordinal + ')'));
  it.each(['CREATE UNIQUE INDEX ordinal_key ON candidate(ordinal) WHERE ordinal>0', 'CREATE UNIQUE INDEX ordinal_key ON candidate(ordinal+0)'])('partial或expression索引不授予ordinal事实：%s', async index => fixture(async (db, input) => { db.exec(index); await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID' }); }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL)'));
  it.each([0, 2, -1])('候选第一序号%d不连续即失败，不能仅靠行数相等放行', async ordinal => fixture(async (db, input) => { db.exec("INSERT INTO source VALUES(1,'a')"); db.prepare('INSERT INTO candidate VALUES(1,\'a\',?)').run(ordinal); await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID' }); }));
  it('空表全量核对成功，候选缺行或多余行均失败', async () => fixture(async (db, input) => { expect(await compare(db, input, control())).toEqual({ sourceRows: '0', candidateRows: '0', verifiedRows: '0', columnGroups: 1 }); db.exec("INSERT INTO source VALUES(1,'a')"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH' }); copy(db); db.exec("INSERT INTO candidate VALUES(2,'extra',2)"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH' }); }));
});

describe('SQLite比较边界、宽列、取消和完整游标', () => {
  it('1024用户列分四组，额外ordinal第1025列不缩用户能力，每个SELECT至多770列', async () => {
    const db = new DatabaseSync(':memory:'); try { const names = Array.from({ length: 1024 }, (_, index) => 'c' + index); db.exec('CREATE TABLE source(' + names.join(',') + '); CREATE TABLE candidate(' + names.join(',') + ',ordinal INTEGER NOT NULL UNIQUE); INSERT INTO source(c0,c1023) VALUES(1,\'尾\'); INSERT INTO candidate(rowid,' + names.join(',') + ',ordinal) SELECT rowid,' + names.join(',') + ',1 FROM source; BEGIN IMMEDIATE'); const c = control(), input = { source: 'source', candidate: 'candidate', sourceOrder: ['_rowid_'], candidateOrdinal: 'ordinal', columns: names, rowid: { source: '_rowid_', candidate: '_rowid_' } }; expect(await compare(db, input, c)).toEqual({ sourceRows: '1', candidateRows: '1', verifiedRows: '1', columnGroups: 4 }); expect(c.progress.mock.calls.map(([rows]) => rows)).toEqual(['1', '2', '3', '4']); db.exec("UPDATE candidate SET c1023='末组变化'"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch }); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('取消或进度消费者失败均结束原生双游标，不假装提交或回滚', async () => fixture(async (db, input) => {
    db.exec('WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<600) INSERT INTO source SELECT x,x FROM n'); copy(db); const cancelled = Error('明确取消'), c = control(); c.yield.mockImplementationOnce(async () => { throw cancelled; }); await expect(compare(db, input, c)).rejects.toBe(cancelled); expect(c.progress.mock.calls[0]).toEqual(['256']); expect(db.isTransaction).toBe(true);
    const consumer = Error('明确进度失败'), p = control(); p.progress.mockImplementationOnce(async () => { throw consumer; }); await expect(compare(db, input, p)).rejects.toBe(consumer); expect((await compare(db, input, control())).verifiedRows).toBe('600');
  }));
  it('超过百万行使用真实schema与惰性模拟数据游标，无累计行截断且不累计全表内存', async () => fixture(async (db, input) => {
    const total = 1000001, original = db.prepare.bind(db), c = { check() {}, yield: vi.fn(async () => { await Promise.resolve(); }), progress: vi.fn(async (_rows: string) => { await Promise.resolve(); }) };
    // 只有数据SELECT被明确替换成惰性游标；元数据、PK/唯一索引及事务仍由真实内存SQLite确认。
    const prepare = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const source = sql.startsWith('SELECT "__dbark_source"'), candidate = sql.startsWith('SELECT "__dbark_candidate"'); if (!source && !candidate) return original(sql);
      return { setReadBigInts() {}, setReturnArrays() {}, *iterate() { const value: unknown[] = source ? [0n, 'integer', 0n, null] : [0n, 0n, 'integer', 0n, null]; for (let index = 1; index <= total; index++) { value[0] = BigInt(index); if (candidate) value[1] = BigInt(index); yield value; } } } as unknown as StatementSync;
    });
    try { expect(await compare(db, { ...input, sourceOrder: ['_rowid_'], columns: ['value'], rowid: { source: '_rowid_', candidate: '_rowid_' } }, c)).toEqual({ sourceRows: '1000001', candidateRows: '1000001', verifiedRows: '1000001', columnGroups: 1 }); expect(c.progress.mock.calls.at(-1)).toEqual(['1000001']); expect(c.yield.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(total / 256)); } finally { prepare.mockRestore(); }
  }, 'CREATE TABLE source(value); CREATE TABLE candidate(value,ordinal INTEGER NOT NULL UNIQUE)'));
  it('私有复制拒getter、原型、稀疏数组、重复/坏Unicode/额外字段，结果只含完整相等计数', () => {
    const input: SqliteRebuildComparisonInput = { source: 'source', candidate: 'candidate', sourceOrder: ['rowid'], candidateOrdinal: 'ordinal', columns: ['value'], rowid: { source: 'rowid', candidate: 'rowid' }, losslessColumns: ['value'] }, copied = copyInput(input); input.columns[0] = '后来修改'; input.rowid!.source = '后来修改'; input.losslessColumns![0] = '后来修改'; expect(copied.columns).toEqual(['value']); expect(copied.rowid?.source).toBe('rowid'); expect(copied.losslessColumns).toEqual(['value']);
    const getter = vi.fn(() => 'source'), value = { ...copied }; Object.defineProperty(value, 'source', { enumerable: true, get: getter }); expect(() => copyInput(value)).toThrow(SqliteRebuildComparisonError); expect(getter).not.toHaveBeenCalled();
    for (const patch of [{ columns: ['value', 'VALUE'] }, { columns: Array(1) }, { source: '\ud800' }, { source: 'sqlite_sequence' }, { source: 'candidate' }, { sourceOrder: [] }, { rowid: { source: 'rowid', candidate: 'rowid', sql: 'PRIVATE' } }, { columns: Array.from({ length: 1025 }, (_, index) => 'c' + index) }, { losslessColumns: ['absent'] }, { losslessColumns: ['VALUE'] }, { losslessColumns: ['value', 'value'] }, { losslessColumns: ['\ud800'] }, { losslessColumns: Array(1) }, { losslessColumns: Array.from({ length: 1025 }, () => 'value') }]) expect(() => copyInput({ ...copied, ...patch })).toThrow(SqliteRebuildComparisonError); expect(() => copyInput(Object.assign(Object.create({ inherited: true }), copied))).toThrow(SqliteRebuildComparisonError);
    const permissionGetter = vi.fn(() => 'value'), permissions = ['value']; Object.defineProperty(permissions, '0', { enumerable: true, get: permissionGetter }); expect(() => copyInput({ ...copied, losslessColumns: permissions })).toThrow(SqliteRebuildComparisonError); expect(permissionGetter).not.toHaveBeenCalled();
    expect(copyResult({ sourceRows: '0', candidateRows: '0', verifiedRows: '0', columnGroups: 4 })).toEqual({ sourceRows: '0', candidateRows: '0', verifiedRows: '0', columnGroups: 4 }); for (const patch of [{ sourceRows: '01' }, { sourceRows: '9223372036854775808' }, { candidateRows: '1' }, { verifiedRows: '1' }, { columnGroups: 0 }, { sql: 'PRIVATE' }]) expect(() => copyResult({ sourceRows: '0', candidateRows: '0', verifiedRows: '0', columnGroups: 1, ...patch })).toThrow(SqliteRebuildComparisonError);
  });
  it('没有原事务、view目标或缺少完整用户列目录时不能验证', async () => {
    const db = new DatabaseSync(':memory:'); try { db.exec('CREATE TABLE source(value); CREATE TABLE candidate(value,ordinal INTEGER NOT NULL UNIQUE); CREATE VIEW viewed AS SELECT value FROM source'); const input = { source: 'source', candidate: 'candidate', sourceOrder: ['rowid'], candidateOrdinal: 'ordinal', columns: ['value'], rowid: { source: 'rowid', candidate: 'rowid' } }; await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_TRANSACTION_REQUIRED' }); db.exec('BEGIN IMMEDIATE'); await expect(compare(db, { ...input, source: 'viewed' }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_TARGET_INVALID' }); await expect(compare(db, { ...input, columns: ['not-existing'] }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID' }); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('原生失败只交付固定类别，不泄露函数原错、SQL或值', async () => {
    const db = new DatabaseSync(':memory:'); try { db.function('private_failure', { deterministic: true }, () => 0); db.exec('CREATE TABLE source(id INTEGER PRIMARY KEY,value AS(private_failure()) VIRTUAL); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE); INSERT INTO source(id) VALUES(1); INSERT INTO candidate VALUES(1,0,1)'); db.function('private_failure', { deterministic: true }, () => { throw Error('PRIVATE_ROW_VALUE_915'); }); db.exec('BEGIN IMMEDIATE'); const input = { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' } }; let failure: unknown; try { await compare(db, input, control()); } catch (reason) { failure = reason; } expect(failure).toBeInstanceOf(SqliteRebuildComparisonError); expect(failure).toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_NATIVE_FAILED' }); expect((failure as Error).message).not.toContain('PRIVATE'); expect((failure as Error).message).not.toContain('SELECT'); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
});


describe('双验证表源ordinal完整证明', () => {
  it('WR类型变化后的PK顺序与旧ordinal相反，源序号独立核验而主值按当前PK对齐', async () => {
    const db = new DatabaseSync(':memory:'); try {
      db.exec("CREATE TABLE source(key TEXT PRIMARY KEY,value TEXT,old_order INTEGER NOT NULL UNIQUE) WITHOUT ROWID; CREATE TABLE candidate(key TEXT PRIMARY KEY,value TEXT,new_order INTEGER NOT NULL UNIQUE) WITHOUT ROWID; INSERT INTO source VALUES('2','two',1),('10','ten',2); INSERT INTO candidate SELECT key,value,ROW_NUMBER() OVER(ORDER BY key COLLATE BINARY ASC) FROM source; BEGIN IMMEDIATE");
      const input = { source: 'source', candidate: 'candidate', sourceOrder: ['key'], sourceOrdinal: 'old_order', candidateOrdinal: 'new_order', columns: ['key', 'value'] }; expect((await compare(db, input, control())).verifiedRows).toBe('2');
      await expect(compare(db, { ...input, sourceOrdinal: undefined }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID' });
      db.exec("UPDATE candidate SET value='CHANGED' WHERE key='2'"); await expect(compare(db, input, control())).rejects.toMatchObject({ code: valueMismatch });
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('普通表两端同名ordinal合法，仍逐值核真实rowid并拒隐藏rowid变化', async () => fixture(async (db, base) => {
    db.exec("INSERT INTO source VALUES(100,'a',1),(205,'b',2); INSERT INTO candidate SELECT * FROM source"); const input = { ...base, sourceOrdinal: 'ordinal' }; expect((await compare(db, input, control())).verifiedRows).toBe('2');
    db.exec('UPDATE candidate SET id=101 WHERE id=100'); await expect(compare(db, input, control())).rejects.toMatchObject({ code: rowidMismatch });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE)'));
  it.each(['old_order TEXT NOT NULL UNIQUE', 'old_order INTEGER UNIQUE', 'old_order INTEGER NOT NULL', 'old_order INTEGER NOT NULL, UNIQUE(old_order,id)'])('源序号%s不能替代真实完整单列整数唯一证明', async declaration => fixture(async (db, base) => {
    await expect(compare(db, { ...base, sourceOrdinal: 'old_order' }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID' });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value,' + declaration + '); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE)'));
  it.each([0, 2, -1])('源序号首值%s或缺号不能被候选连续序号掩盖', async ordinal => fixture(async (db, base) => {
    db.prepare("INSERT INTO source VALUES(1,'a',?)").run(ordinal); db.exec("INSERT INTO candidate VALUES(1,'a',1)"); await expect(compare(db, { ...base, sourceOrdinal: 'old_order' }, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID' });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value,old_order INTEGER NOT NULL UNIQUE); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE)'));
  it('带源ordinal仍必须提供准确WR全PK，不能以任意列或部分键冒充已验证身份', async () => {
    const db = new DatabaseSync(':memory:'); try { db.exec('CREATE TABLE source(a,b,value,old_order INTEGER NOT NULL UNIQUE,PRIMARY KEY(a,b)) WITHOUT ROWID; CREATE TABLE candidate(a,b,value,ordinal INTEGER NOT NULL UNIQUE,PRIMARY KEY(a,b)) WITHOUT ROWID; BEGIN IMMEDIATE');
      const input = { source: 'source', candidate: 'candidate', sourceOrdinal: 'old_order', candidateOrdinal: 'ordinal', sourceOrder: ['a'], columns: ['a', 'b', 'value'] }; await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_SOURCE_ORDER_INVALID' }); expect((await compare(db, { ...input, sourceOrder: ['a', 'b'] }, control())).verifiedRows).toBe('0');
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
  it('sourceOrdinal严格复制且不属于用户列；getter、坏Unicode和额外源列均拒绝', async () => fixture(async (db, base) => {
    const input = { ...base, sourceOrdinal: 'old_order' }; expect(copyInput(input).sourceOrdinal).toBe('old_order'); expect(() => copyInput({ ...base, sourceOrdinal: 'value' })).toThrow(); expect(() => copyInput({ ...base, sourceOrdinal: '\ud800' })).toThrow();
    const getter = vi.fn(() => 'old_order'); const accessed = { ...base }; Object.defineProperty(accessed, 'sourceOrdinal', { enumerable: true, get: getter }); expect(() => copyInput(accessed)).toThrow(); expect(getter).not.toHaveBeenCalled(); await expect(compare(db, input, control())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID' });
  }, 'CREATE TABLE source(id INTEGER PRIMARY KEY,value,old_order INTEGER NOT NULL UNIQUE,extra); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE)'));
});


describe('外键违规行typed主键身份复用全量比较精度门', () => {
  const integer = (value: string): SqliteValue => ({ type: 'integer', value }), real = (value: string): SqliteValue => ({ type: 'real', value }), binary = (value: string): SqliteValue => ({ type: 'binary', base64: value });
  it('保持原storage和有符号int64；不同storage缺省不得替换同一违规行身份', () => {
    for (const value of ['-9223372036854775808', '-1', '0', '9223372036854775807']) expect(storedKeyEquivalent(integer(value), integer(value), false)).toBe(true);
    expect(storedKeyEquivalent(integer('9223372036854775807'), integer('9223372036854775806'), false)).toBe(false); expect(storedKeyEquivalent(integer('2'), real('2'), false)).toBe(false); expect(storedKeyEquivalent(integer('2'), '2', false)).toBe(false); expect(storedKeyEquivalent(null, null, false)).toBe(true); expect(storedKeyEquivalent(null, '', true)).toBe(false);
  });
  it('跨storage必须逐列获权且整数/REAL转换由BigInt反算证明，不能只比较Number', () => {
    expect(storedKeyEquivalent(integer('9007199254740992'), real('9007199254740992'), true)).toBe(true); expect(storedKeyEquivalent(integer('9007199254740993'), real('9007199254740992'), true)).toBe(false); expect(storedKeyEquivalent(integer('9223372036854775807'), real('9223372036854776000'), true)).toBe(false); expect(storedKeyEquivalent(real('1.5'), integer('1'), true)).toBe(false);
    expect(storedKeyEquivalent('9223372036854775807', integer('9223372036854775807'), true)).toBe(true); for (const value of ['001', '+1', '-0', '1\0']) expect(storedKeyEquivalent(value, integer('1'), true)).toBe(false);
  });
  it('TEXT到REAL仍要求canonical与精确十进制有理数，表面Number往返不能冒充身份', () => {
    expect(storedKeyEquivalent('1.5', real('1.5'), true)).toBe(true); expect(storedKeyEquivalent('0.125', real('0.125'), true)).toBe(true); expect(storedKeyEquivalent('0.1', real('0.1'), true)).toBe(false); expect(storedKeyEquivalent('5e-324', real('5e-324'), true)).toBe(false);
    expect(storedKeyEquivalent(real('0.10000000000000002'), '0.10000000000000002', true)).toBe(true); expect(storedKeyEquivalent(real('0.10000000000000002'), '0.1', true)).toBe(false);
    // Root的等数量违规替换反例依赖此区别：旧TEXT2.0不能冒充原INTEGER2的严格行身份。
    expect(storedKeyEquivalent('2.0', integer('2'), false)).toBe(false); expect(storedKeyEquivalent(real('2'), '2.0', true)).toBe(true);
  });
  it('负零按原REAL位保存，Infinity同storage可匹配，跨storage无穷不获转换权', () => {
    expect(storedKeyEquivalent(real('-0'), real('-0'), false)).toBe(true); expect(storedKeyEquivalent(real('-0'), real('0'), false)).toBe(false); expect(storedKeyEquivalent(real('-0'), integer('0'), true)).toBe(false); expect(storedKeyEquivalent(real('-0'), '-0', true)).toBe(true); expect(storedKeyEquivalent('-0', real('-0'), true)).toBe(true);
    for (const value of ['Infinity', '-Infinity']) { expect(storedKeyEquivalent(real(value), real(value), false)).toBe(true); expect(storedKeyEquivalent(real(value), value, true)).toBe(false); expect(storedKeyEquivalent(value, real(value), true)).toBe(false); }
  });
  it('TEXT完整Unicode/UTF8/BOM/NUL与BLOB原字节比较，禁止前缀、替换字符或编码近似', () => {
    const value = '\uFEFF中文🚢\0尾\0'; expect(storedKeyEquivalent(value, value, false)).toBe(true); expect(storedKeyEquivalent(value, value.slice(1), false)).toBe(false); expect(storedKeyEquivalent('a\0b', 'a', true)).toBe(false); expect(storedKeyEquivalent('é', 'e\u0301', true)).toBe(false);
    expect(storedKeyEquivalent(binary('AP+A'), binary('AP+A'), false)).toBe(true); expect(storedKeyEquivalent(binary('AP+A'), binary('AP+B'), false)).toBe(false); expect(storedKeyEquivalent(binary(''), '', true)).toBe(false); expect(storedKeyEquivalent(binary(Buffer.from(value).toString('base64')), value, true)).toBe(false);
  });
  it('拒绝伪造tag、非canonical数字或Base64、越界、原型与getter，错误不回显任何原值', () => {
    const getter = vi.fn(() => 'PRIVATE_VALUE'), accessed = { type: 'integer' }; Object.defineProperty(accessed, 'value', { enumerable: true, get: getter });
    const invalid: unknown[] = [1, NaN, undefined, { type: 'integer', value: '01' }, { type: 'integer', value: '+1' }, { type: 'integer', value: '-0' }, { type: 'integer', value: '9223372036854775808' }, { type: 'integer', value: '-9223372036854775809' }, { type: 'real', value: 'NaN' }, { type: 'real', value: '1.0' }, { type: 'real', value: ' 1' }, { type: 'real', value: '1e999' }, { type: 'binary', base64: 'AA' }, { type: 'binary', base64: 'AB==' }, { type: 'binary', base64: 'AA==\n' }, { type: 'integer', value: '1', extra: 'PRIVATE_VALUE' }, Object.assign(Object.create({ secret: 'PRIVATE_VALUE' }), { type: 'integer', value: '1' }), accessed, '\ud800', 'x'.repeat(1024 * 1024 + 1), '🚢'.repeat(262145)];
    for (const value of invalid) { let error: unknown; try { storedKeyEquivalent(value as SqliteValue, null, false); } catch (reason) { error = reason; } expect(error).toBeInstanceOf(SqliteRebuildComparisonError); expect(error).toMatchObject({ code: 'SQLITE_REBUILD_COMPARISON_INPUT_INVALID' }); expect((error as Error).message).not.toContain('PRIVATE_VALUE'); }
    expect(getter).not.toHaveBeenCalled(); expect(() => storedKeyEquivalent('x', 'x', 1 as any)).toThrow(SqliteRebuildComparisonError);
  });
  it('null原型的准确自有字段可用，读取失败的Proxy仅得到固定输入错误', () => {
    const value = Object.assign(Object.create(null), { type: 'integer', value: '-1' }); expect(storedKeyEquivalent(value, integer('-1'), false)).toBe(true);
    const bad = new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_VALUE'); } }); expect(() => storedKeyEquivalent(bad as SqliteValue, integer('0'), false)).toThrow(SqliteRebuildComparisonError);
  });
});
