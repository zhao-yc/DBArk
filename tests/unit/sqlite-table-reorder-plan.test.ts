import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { compileSqliteTableRebuildDefinition, compileSqliteTableRebuildCopyDefinition, normalizeSqliteTableRebuildDefinitionName, type SqliteTableRebuildDefinitionInput, type SqliteRebuildColumnChange } from '../../src/shared/sqliteTableRebuildPlan';
import { buildSqliteTableRebuildPlan } from '../../src/shared/sqliteTableRebuildExecutionPlan';
import { copySqliteTableRebuildColumnOrder, sqliteTableRebuildChangesSchema, sqliteTableRebuildEditsSchema, sqliteTableRebuildColumnOrderSchema, sqliteTableRebuildPreviewSchema, sqliteTableRebuildPreviewOutputSchema, type SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';

const candidateName = '__dbark_rebuild_' + 'a'.repeat(32), ordinalName = '__dbark_rebuild_order_' + 'b'.repeat(32), verificationName = '__dbark_rebuild_' + 'c'.repeat(32), verificationOrdinal = '__dbark_rebuild_order_' + 'd'.repeat(32);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 原生内存库仅校准候选DDL与按名称复制，不读取用户文件或冒称Main事务验收。 */
function database(sql: string, run: (db: DatabaseSync, input: SqliteTableRebuildDefinitionInput) => void): void {
  const db = new DatabaseSync(':memory:'); try { db.exec(sql); const columns = db.prepare("SELECT name,hidden FROM pragma_table_xinfo('subject') ORDER BY cid").all().map(row => ({ name: String(row.name), hidden: Number(row.hidden) })); run(db, { table: 'subject', tableSql: sql, columns, candidateName, changes: [] }); } finally { db.close(); }
}
/** 提供完整原生目录供纯计划重算，rowid身份只用于固定复制SQL，不授予执行能力。 */
function inspection(db: DatabaseSync, input: SqliteTableRebuildDefinitionInput): SqliteTableRebuildInspectOutput {
  const columns = db.prepare("SELECT cid,name,type,\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo('subject') ORDER BY cid").all().map(row => ({ cid: Number(row.cid), name: String(row.name), declaredType: String(row.type), notNull: row.notnull === 1, defaultSql: row.dflt_value === null ? null : String(row.dflt_value), primaryKey: Number(row.pk), hidden: Number(row.hidden) }));
  return { catalogueId: 'catalogue', target: { connectionId: 'owned', database: 'main', table: 'subject' }, tableSql: input.tableSql, columns, relatedObjects: db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE type IN ('table','index','view','trigger') ORDER BY type,name").all().map(row => ({ type: row.type as 'table' | 'index' | 'view' | 'trigger', name: String(row.name), table: String(row.tbl_name), sql: row.sql === null ? null : String(row.sql) })), strict: false, withoutRowid: false, rowIdentity: { kind: 'rowid', source: '_rowid_' }, readOnly: false, expiresAt: '2030-01-01T00:00:00Z' };
}

describe('SQLite真实列重排的严格合同与旧接口兼容', () => {
  it('旧补丁数组仍非空；新组合仅有效order时允许空changes，回包changedOrder仅可true', () => {
    expect(sqliteTableRebuildChangesSchema.safeParse([]).success).toBe(false); expect(sqliteTableRebuildEditsSchema.parse([])).toEqual([]);
    const request = { catalogueId: 'c', taskId: 'preview', changes: [], columnOrder: ['b', 'a'] }; expect(sqliteTableRebuildPreviewSchema.parse(request)).toEqual(request); expect(sqliteTableRebuildPreviewSchema.safeParse({ ...request, columnOrder: undefined }).success).toBe(false);
    const output = { previewId: 'p', catalogueId: 'c', target: { connectionId: 'owned', database: 'main' as const, table: 'subject' }, sql: ['CREATE TABLE candidate(x)'], confirmation: 'main.subject', changedTypes: 0, changedDefaults: 0, changedOrder: true, warnings: [], expiresAt: '2030-01-01T00:00:00Z' };
    expect(sqliteTableRebuildPreviewOutputSchema.parse(output)).toEqual(output); expect(sqliteTableRebuildPreviewOutputSchema.safeParse({ ...output, changedOrder: false }).success).toBe(false); expect(sqliteTableRebuildPreviewOutputSchema.safeParse({ ...output, changedOrder: undefined }).success).toBe(false); const { changedOrder: _changedOrder, ...legacy } = output; expect(sqliteTableRebuildPreviewOutputSchema.safeParse({ ...legacy, changedTypes: 1 }).success).toBe(true);
  });
  it('完整准确不同排列含生成列，不能缺列/多列/同序/大小写替代；空changes无order不编译', () => database('CREATE TABLE subject(id INTEGER,a TEXT,g TEXT AS(a) VIRTUAL)', (_db, input) => {
    for (const order of [[], ['a', 'id'], ['a', 'id', 'g', 'extra'], ['id', 'a', 'g'], ['a', 'ID', 'g'], ['a', 'id', 'id'], ['a', 'id', 'bad']]) expect(() => compileSqliteTableRebuildDefinition({ ...input, columnOrder: order })).toThrow();
    expect(() => compileSqliteTableRebuildDefinition(input)).toThrow(); expect(() => compileSqliteTableRebuildDefinition({ ...input, columnOrder: undefined })).toThrow(); expect(() => compileSqliteTableRebuildDefinition({ ...input, changes: [{ column: 'a', declaredType: 'TEXT' }], columnOrder: ['id', 'a', 'g'] })).toThrow();
    expect(copySqliteTableRebuildColumnOrder(['g', 'a', 'id'], input.columns.map(column => column.name))).toEqual(['g', 'a', 'id']);
  }));
  it('顺序输入拒绝稀疏、访问器、原型、坏Unicode、符号和无界字段，不能调用getter', () => {
    const getter = vi.fn(() => 'a'), accessed = ['b', 'a']; Object.defineProperty(accessed, '1', { enumerable: true, get: getter }); expect(sqliteTableRebuildColumnOrderSchema.safeParse(accessed).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    const extra = ['b', 'a']; Object.defineProperty(extra, Symbol('hidden'), { value: true }); for (const order of [Array(2), extra, ['b', '\ud800'], ['b', 'nul\0'], ['A', 'a'], ['x'.repeat(513)], Array.from({ length: 1025 }, (_, index) => 'c' + index), Object.assign(Object.create(Array.prototype), { 0: 'b', 1: 'a', length: 2 })]) expect(sqliteTableRebuildColumnOrderSchema.safeParse(order).success).toBe(false);
    database('CREATE TABLE subject(a,b)', (_db, input) => { const raw = { ...input }; Object.defineProperty(raw, 'columnOrder', { enumerable: true, get: getter }); expect(() => compileSqliteTableRebuildDefinition(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); });
  });
  it('未提供order保留旧SQL/列映射，不输出columnOrder；原类型/default计划仍按旧字段顺序', () => database('CREATE TABLE subject(id INTEGER,note TEXT DEFAULT \'old\')', (db, input) => {
    const changes = [{ column: 'note', default: { kind: 'text', value: 'new' } }] as const, first = compileSqliteTableRebuildDefinition({ ...input, changes }), explicit = compileSqliteTableRebuildDefinition({ ...input, changes, columnOrder: undefined }); expect(first).toEqual(explicit); expect(first.columnMapping.map(column => column.name)).toEqual(['id', 'note']);
    const plan = buildSqliteTableRebuildPlan(inspection(db, input), changes, { candidate: candidateName, ordinal: ordinalName, verificationCandidate: verificationName, verificationOrdinal }); expect(plan.changedOrder).toBe(false); expect(plan).not.toHaveProperty('columnOrder'); expect(plan.warnings).toHaveLength(3);
  }));
});

describe('SQLite重排完整声明跨度而非显示顺序', () => {
  it('原生cid真实变化，生成列含前向依赖可移动且仍不INSERT；BIGINT/二进制/真实rowid按名称保留', () => database('CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT,payload BLOB,g TEXT GENERATED ALWAYS AS(note||\'!\') STORED)', (db, input) => {
    db.prepare('INSERT INTO subject(id,note,payload) VALUES(?,?,?)').run(9223372036854775807n, '原值\0🚢', new Uint8Array([0, 255, 128])); const order = ['g', 'payload', 'note', 'id'], compiled = compileSqliteTableRebuildDefinition({ ...input, columnOrder: order }); db.exec(compiled.candidateSql);
    expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName).map(row => row.name)).toEqual(order); expect(compiled.columnMapping).toEqual([{ name: 'g', copy: false }, { name: 'payload', copy: true }, { name: 'note', copy: true }, { name: 'id', copy: true }]);
    const copy = compiled.columnMapping.filter(column => column.copy).map(column => quote(column.name)).join(','); db.exec('INSERT OR ABORT INTO ' + quote(candidateName) + '(' + copy + ') SELECT ' + copy + ' FROM subject'); const query = db.prepare('SELECT id,note,payload,g,_rowid_ AS physical FROM ' + quote(candidateName)); query.setReadBigInts(true); const value = query.get(); expect(value?.id).toBe(9223372036854775807n); expect(value?.physical).toBe(9223372036854775807n); expect(value?.note).toBe('原值\0🚢'); expect(value?.payload).toEqual(new Uint8Array([0, 255, 128])); expect(value?.g).toBe('原值\0🚢!');
  }));
  it('类型/default与重排同时执行只修改准确列，生成标记及完整原约束不漂移', () => database('CREATE TABLE subject(id INTEGER PRIMARY KEY, note TEXT CONSTRAINT note_required NOT NULL DEFAULT \'old\' CHECK(length(note)>0), value DECIMAL(12,4), g TEXT AS(note) VIRTUAL, CONSTRAINT pair UNIQUE(note,value))', (db, input) => {
    const changes: SqliteRebuildColumnChange[] = [{ column: 'note', default: { kind: 'text', value: 'new' } }, { column: 'value', declaredType: 'NUMERIC(20,6)' }], compiled = compileSqliteTableRebuildDefinition({ ...input, changes, columnOrder: ['value', 'g', 'note', 'id'] }); db.exec(compiled.candidateSql); const columns = db.prepare('SELECT name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName);
    expect(columns.map(row => row.name)).toEqual(['value', 'g', 'note', 'id']); expect(columns[0].type).toBe('NUMERIC(20,6)'); expect(columns[1].hidden).toBe(2); expect(columns[2].notnull).toBe(1); expect(columns[2].dflt_value).toBe("'new'"); expect(columns[3].pk).toBe(1); expect(compiled.candidateSql).toContain('CONSTRAINT note_required NOT NULL'); expect(compiled.candidateSql).toContain('CONSTRAINT pair UNIQUE(note,value)'); db.exec('INSERT INTO ' + quote(candidateName) + '(id,value) VALUES(1,2)'); expect(db.prepare('SELECT note,g FROM ' + quote(candidateName)).get()).toEqual({ note: 'new', g: 'new' });
  }));
  it('quoted名称/字符串逗号与注释原字节各出现一次，末尾表级约束及STRICT原样保留', () => {
    const sql = `CREATE TABLE subject(
      /* first-banner */ "id" INTEGER PRIMARY KEY,
      -- note-before
      "note, DEFAULT" TEXT DEFAULT 'comma, /*not comment*/' /* note-tail */,
      [payload] BLOB DEFAULT X'00FF',
      "g" TEXT AS("note, DEFAULT"||',generated') VIRTUAL,
      CONSTRAINT "unique, name" UNIQUE("note, DEFAULT"),
      CHECK(length("note, DEFAULT")>0)
    ) STRICT`;
    database(sql, (db, input) => { const compiled = compileSqliteTableRebuildDefinition({ ...input, columnOrder: ['g', 'payload', 'note, DEFAULT', 'id'] }); db.exec(compiled.candidateSql); for (const literal of ['/* first-banner */', '-- note-before', '/* note-tail */', "'comma, /*not comment*/'", "||',generated'", 'CONSTRAINT "unique, name" UNIQUE("note, DEFAULT")', 'CHECK(length("note, DEFAULT")>0)']) expect(compiled.candidateSql.split(literal)).toHaveLength(2); expect(compiled.candidateSql.endsWith(') STRICT')).toBe(true); expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName).map(row => row.name)).toEqual(['g', 'payload', 'note, DEFAULT', 'id']); });
  });
  it('WITHOUT ROWID完整复合PK、references动作及生成表达式均按字段名保留', () => database('CREATE TABLE subject(a INTEGER,b TEXT,c TEXT REFERENCES subject(a) ON DELETE SET DEFAULT DEFAULT \'fallback\',g TEXT AS(b) VIRTUAL,PRIMARY KEY(a,b)) WITHOUT ROWID', (db, input) => {
    const compiled = compileSqliteTableRebuildDefinition({ ...input, columnOrder: ['g', 'c', 'b', 'a'] }); db.exec(compiled.candidateSql); const columns = db.prepare('SELECT name,pk,hidden,dflt_value FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName); expect(columns.map(row => row.name)).toEqual(['g', 'c', 'b', 'a']); expect(columns[2].pk).toBe(2); expect(columns[3].pk).toBe(1); expect(columns[0].hidden).toBe(2); expect(compiled.candidateSql).toContain("REFERENCES subject(a) ON DELETE SET DEFAULT DEFAULT 'fallback'"); expect(compiled.candidateSql).toContain('PRIMARY KEY(a,b)) WITHOUT ROWID');
  }));
  it('内部ordinal位于重排后首列之前，移除时不吞首列leading注释或改变最终列序', () => database('CREATE TABLE subject(/* original-first */ a TEXT, /* new-first */ b TEXT, c TEXT)', (db, input) => {
    const compiled = compileSqliteTableRebuildCopyDefinition({ ...input, columnOrder: ['b', 'c', 'a'] }, ordinalName); db.exec(compiled.candidateSql); db.exec(compiled.createOrdinalIndexSql); expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName).map(row => row.name)).toEqual([ordinalName, 'b', 'c', 'a']); compiled.removeOrdinalSql.forEach(sql => db.exec(sql)); const actual = String(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(candidateName)?.sql); expect(actual).toContain('/* new-first */'); expect(actual).toContain('/* original-first */'); expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName).map(row => row.name)).toEqual(['b', 'c', 'a']);
  }));
});

describe('完整重建计划和后验头归一', () => {
  it('纯重排可用空changes，固定复制SQL显式同名映射，不把新位置当原值', () => database('CREATE TABLE subject(a TEXT,b BLOB,c INTEGER)', (db, input) => {
    db.exec("INSERT INTO subject(rowid,a,b,c) VALUES(101,'text',X'00FF',9007199254740993)"); const order = ['c', 'a', 'b'], plan = buildSqliteTableRebuildPlan(inspection(db, input), [], { candidate: candidateName, ordinal: ordinalName, verificationCandidate: verificationName, verificationOrdinal }, order);
    expect(plan.changedOrder).toBe(true); expect(plan.columnOrder).toEqual(order); expect(plan.warnings).toHaveLength(4); expect(plan.warnings[3]).toContain('SELECT *'); expect(plan.warnings[3]).toContain('INSERT'); expect(plan.warnings[3]).toContain('视图和触发器'); expect(plan.changedTypes).toBe(0); expect(plan.changedDefaults).toBe(0); expect(plan.losslessColumns).toEqual([]); expect(plan.steps.find(step => step.role === 'original-copy')?.sql).toContain('("c","a","b","_rowid_",' + quote(ordinalName) + ') SELECT "c","a","b","_rowid_",');
    for (const step of plan.steps.slice(0, 3)) db.exec(step.sql); const query = db.prepare('SELECT c,a,b,_rowid_ AS physical FROM ' + quote(candidateName)); query.setReadBigInts(true); const value = query.get(); expect(value?.c).toBe(9007199254740993n); expect(value?.a).toBe('text'); expect(value?.b).toEqual(new Uint8Array([0, 255])); expect(value?.physical).toBe(101n); order.reverse(); expect(plan.columnOrder).toEqual(['c', 'a', 'b']);
  }));
  it('无补丁后验仅换CREATE头，完整body/列序/注释不能被新SQL或错误target覆盖', () => database('CREATE TABLE subject(a TEXT,b INTEGER)', (db, input) => {
    const compiled = compileSqliteTableRebuildDefinition({ ...input, columnOrder: ['b', 'a'] }); db.exec(compiled.candidateSql); const actual = String(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(candidateName)?.sql), columns = [{ name: 'b', hidden: 0 }, { name: 'a', hidden: 0 }]; const normalized = normalizeSqliteTableRebuildDefinitionName({ table: candidateName, tableSql: actual, columns }, verificationName); expect(normalized).toBe(actual.replace(quote(candidateName), quote(verificationName)));
    expect(() => normalizeSqliteTableRebuildDefinitionName({ table: 'different', tableSql: actual, columns }, verificationName)).toThrow(); expect(() => normalizeSqliteTableRebuildDefinitionName({ table: candidateName, tableSql: actual, columns: input.columns }, verificationName)).toThrow(); expect(() => normalizeSqliteTableRebuildDefinitionName({ table: candidateName, tableSql: actual + '; DROP TABLE subject', columns }, verificationName)).toThrow(); expect(() => normalizeSqliteTableRebuildDefinitionName({ table: candidateName, tableSql: actual, columns }, 'arbitrary')).toThrow();
  }));
  it('1024用户列加私有ordinal仍完整重排，最后一列不截断或漏映射', () => {
    const names = Array.from({ length: 1024 }, (_, index) => 'c' + index), sql = 'CREATE TABLE subject(' + names.map(name => quote(name) + ' TEXT').join(',') + ')'; database(sql, (db, input) => { const order = [...names].reverse(), compiled = compileSqliteTableRebuildCopyDefinition({ ...input, columnOrder: order }, ordinalName); db.exec(compiled.candidateSql); const native = db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(candidateName).map(row => row.name); expect(native).toEqual([ordinalName, ...order]); expect(compiled.columnMapping.map(column => column.name)).toEqual(order); expect(compiled.columnMapping.at(-1)?.name).toBe('c0'); });
  });
  it('过量SQL、源多语句与错误生成标记拒绝，不把恶意body搬运成被授权计划', () => database('CREATE TABLE subject(a TEXT,b TEXT,g TEXT AS(a) VIRTUAL)', (_db, input) => {
    const columnOrder = ['g', 'b', 'a']; for (const tableSql of [input.tableSql + '; DROP TABLE subject', input.tableSql + ' /*' + 'x'.repeat(2 * 1024 * 1024) + '*/', 'EXPLAIN ' + input.tableSql, input.tableSql.replace('CREATE TABLE', 'CREATE TEMP TABLE')]) expect(() => compileSqliteTableRebuildDefinition({ ...input, tableSql, columnOrder })).toThrow(); expect(() => compileSqliteTableRebuildDefinition({ ...input, columnOrder, columns: input.columns.map(column => column.name === 'g' ? { ...column, hidden: 0 } : column) })).toThrow();
  }));
});
