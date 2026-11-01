import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteIndexesPlan, parseSqliteIndexDesign, sqliteIndexDesignSchema, sqliteIndexesActionsSchema, sqliteIndexesApplySchema, sqliteIndexesInspectSchema, sqliteIndexesInspectionSchema, sqliteIndexesLimits, sqliteIndexesPreviewOutputSchema, sqliteIndexesPreviewSchema, sqliteIndexesReleaseSchema, type SqliteIndexesDesign, type SqliteIndexesTarget } from '../../src/shared/sqliteIndexes';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const target: SqliteIndexesTarget = { connectionId: 'owned-sqlite', database: 'main', table: '原"表🚢' };
const design = (): SqliteIndexesDesign => ({ name: '索引"🚢', unique: false, keys: [{ kind: 'column', name: 'Name', order: 'desc', collation: 'NOCASE' }, { kind: 'expression', expression: 'coalesce(lower("Name"),\'逗号,;?中文🚢\') || \':\' || ("n" + 1)', order: 'asc' }], where: '"n" >= 2 AND "Name" IS NOT NULL --尾注释' });
/** 仅本例内存库验证原SQLite语法、目录和查询，不访问用户连接或生产IPC。 */
function database(run: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { db.exec('CREATE TABLE "原""表🚢"("Name" TEXT,"n" INTEGER,"payload" BLOB, UNIQUE("n")); INSERT INTO "原""表🚢" VALUES(\'甲\',1,X\'00ff\'),(\'乙\',2,NULL),(NULL,3,X\'01\')'); run(db); } finally { db.close(); } }
const columns = [{ name: 'Name', declaredType: 'TEXT' }, { name: 'n', declaredType: 'INTEGER' }, { name: 'payload', declaredType: 'BLOB' }];

describe('SQLite索引严格目录和DDL合同', () => {
  it('四命令各用独立白名单与严格schema，不接内部回调/路径/操作编号/任意SQL', () => {
    const inspect = { ...target, taskId: 'inspect' }, preview = { catalogueId: 'c', actions: [{ kind: 'create' as const, design: design() }], taskId: 'preview' }, apply = { previewId: 'p', taskId: 'apply', confirmation: 'main.' + target.table };
    for (const command of ['sqlite.indexes.inspect', 'sqlite.indexes.preview', 'sqlite.indexes.apply', 'sqlite.indexes.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('sqlite.indexes.inspect', inspect)).toEqual(inspect); expect(validateCommand('sqlite.indexes.preview', preview)).toEqual(preview); expect(validateCommand('sqlite.indexes.apply', apply)).toEqual(apply); expect(validateCommand('sqlite.indexes.release', { catalogueId: 'c', previewId: 'p' })).toEqual({ catalogueId: 'c', previewId: 'p' });
    for (const key of ['filePath', 'profile', 'assertCurrent', 'recordIndexesFact', 'operationId', 'sql']) { expect(sqliteIndexesInspectSchema.safeParse({ ...inspect, [key]: 'PRIVATE' }).success).toBe(false); expect(sqliteIndexesApplySchema.safeParse({ ...apply, [key]: 'PRIVATE' }).success).toBe(false); }
    expect(sqliteIndexesInspectSchema.safeParse({ ...inspect, database: 'temp' }).success).toBe(false); expect(sqliteIndexesReleaseSchema.safeParse({}).success).toBe(false);
  });

  it('目录显示原column/expression/rowid辅助键和自动约束索引，不把readonly driver等同于profile只读', () => {
    const automatic = { name: 'sqlite_autoindex_表_1', unique: true, origin: 'u' as const, partial: false, sql: null, keys: [{ seqno: 0, cid: 1, name: 'n', desc: false, collation: 'BINARY', key: true }, { seqno: 1, cid: -1, name: null, desc: false, collation: 'BINARY', key: false }] }, explicit = { name: '表达式', unique: false, origin: 'c' as const, partial: true, sql: 'CREATE INDEX 表达式 ON t(lower(a)) WHERE a IS NOT NULL', keys: [{ seqno: 0, cid: -2, name: null, desc: true, collation: 'NOCASE', key: true }, { seqno: 1, cid: -1, name: null, desc: false, collation: 'BINARY', key: false }] }, value = { catalogueId: 'catalogue', target, columns, indexes: [automatic, explicit], collations: ['BINARY', 'NOCASE', 'RTRIM'], readOnly: false, expiresAt: '2030-01-01T00:00:00Z' };
    expect(sqliteIndexesInspectionSchema.parse(value)).toEqual(value); expect(sqliteIndexesInspectionSchema.safeParse({ ...value, readOnly: true }).success).toBe(true);
    for (const patch of [{ indexes: [automatic, { ...automatic }] }, { columns: [{ name: 'A', declaredType: 'TEXT' }, { name: 'a', declaredType: 'TEXT' }] }, { indexes: [{ ...automatic, sql: '伪造DDL' }] }, { indexes: [{ ...explicit, keys: [explicit.keys[0], explicit.keys[0]] }] }, { collations: ['BINARY', 'binary'] }]) expect(sqliteIndexesInspectionSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    expect(sqliteIndexesActionsSchema.safeParse([{ kind: 'drop', name: automatic.name }]).success).toBe(false);
  });

  it('预览数量按DROP/CREATE计数，替换两句；确认必须准确main.table且无额外字段', () => {
    const actions = [{ kind: 'drop' as const, name: '旧索引' }, { kind: 'create' as const, design: design() }], plan = buildSqliteIndexesPlan(target, actions), value = { previewId: 'p', catalogueId: 'c', target, sql: plan.sql, confirmation: 'main.' + target.table, added: 1, removed: 1, expiresAt: '2030-01-01T00:00:00Z' };
    expect(sqliteIndexesPreviewOutputSchema.parse(value)).toEqual(value); for (const patch of [{ added: 2 }, { confirmation: 'main.其它' }, { requestedStatements: 2 }]) expect(sqliteIndexesPreviewOutputSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    expect(plan.removed).toEqual(['旧索引']); expect(plan.sql[0]).toBe('DROP INDEX main."旧索引"'); expect(plan.storedSql).toHaveLength(1);
  });

  it('有界稠密数组/getter/未知字段在复制前拒绝，设计64键/动作128/DDL2MiB硬限额', () => {
    const getter = vi.fn(() => design()), actions = Array.from({ length: 129 }, (_, index) => ({ kind: 'drop', name: '索引' + index })); Object.defineProperty(actions, '0', { enumerable: true, get: getter });
    expect(sqliteIndexesPreviewSchema.safeParse({ catalogueId: 'c', actions, taskId: 'p' }).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(sqliteIndexDesignSchema.safeParse({ ...design(), keys: new Array(1) }).success).toBe(false); expect(sqliteIndexDesignSchema.safeParse(Object.defineProperty(design(), 'where', { enumerable: true, get: getter })).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(sqliteIndexDesignSchema.safeParse({ ...design(), keys: Array.from({ length: 65 }, () => ({ kind: 'column', name: 'n', order: 'asc' })) }).success).toBe(false);
    expect(sqliteIndexDesignSchema.safeParse({ ...design(), name: 'x'.repeat(256) }).success).toBe(false); expect(sqliteIndexDesignSchema.safeParse({ ...design(), name: 'SQLITE_保留' }).success).toBe(false);
    expect(sqliteIndexDesignSchema.safeParse({ ...design(), name: '索引\0' }).success).toBe(false); expect(sqliteIndexDesignSchema.safeParse({ ...design(), where: 'x'.repeat(65537) }).success).toBe(false);
    expect(sqliteIndexesLimits).toMatchObject({ keys: 64, indexes: 128, actions: 128, ddlBytes: 2 * 1024 * 1024, catalogues: 64 });
  });
});

describe('SQLite单一索引构造器及原DDL恢复', () => {
  it('真实创建column/expression/partial索引，storedSql与原生sqlite_schema精确相等，原行和自动约束索引保持', () => {
    database(db => { const before = db.prepare('SELECT * FROM "原""表🚢" ORDER BY n').all(), auto = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index'").all(), plan = buildSqliteIndexesPlan(target, [{ kind: 'create', design: design() }]);
      db.exec(plan.sql[0]); expect(db.prepare("SELECT name,sql FROM sqlite_schema WHERE name=?").get(design().name)).toEqual(plan.storedSql[0]);
      expect(db.prepare('SELECT cid,name,desc,coll,key FROM pragma_index_xinfo(?) ORDER BY seqno').all(design().name)).toMatchObject([{ cid: 0, name: 'Name', desc: 1, coll: 'NOCASE', key: 1 }, { cid: -2, name: null, desc: 0, key: 1 }, { cid: -1, name: null, key: 0 }]);
      expect(db.prepare('SELECT * FROM "原""表🚢" ORDER BY n').all()).toEqual(before); expect(db.prepare('SELECT name,sql FROM sqlite_schema WHERE name=?').get(auto[0].name)).toEqual(auto[0]);
      db.exec(buildSqliteIndexesPlan(target, [{ kind: 'drop', name: design().name }, { kind: 'create', design: { ...design(), unique: true } }]).sql.join(';'));
      expect(db.prepare('SELECT "unique",partial FROM pragma_index_list(?) WHERE name=?').get(target.table, design().name)).toEqual({ unique: 1, partial: 1 });
    });
  });

  it.each(['x); DROP TABLE t;--', 'n; SELECT 1', 'n + ?', 'n + :p', 'n + @p', 'n + $p', 'n /*未闭合', "'未闭合", 'lower(n', 'n)', '--仅注释', 'n\0'])('外部逃逸/参数/不平衡片段拒绝：%s', fragment => {
    expect(sqliteIndexDesignSchema.safeParse({ ...design(), keys: [{ kind: 'expression', expression: fragment, order: 'asc' }] }).success).toBe(false); expect(sqliteIndexDesignSchema.safeParse({ ...design(), where: fragment }).success).toBe(false);
  });

  it('字符串/quoted名/注释内分号参数合法，末尾行注释由换行隔离而不吞闭括号或后继动作', () => {
    const value = { ...design(), keys: [{ kind: 'expression' as const, expression: "coalesce(\"Name\",';? : @ $') || ',中文' --行注释;?", order: 'desc' as const }], where: 'n > 0 /* ; ? */ --尾行注释' }, plan = buildSqliteIndexesPlan(target, [{ kind: 'create', design: value }]);
    database(db => { const before = db.prepare('SELECT count(*) AS rows FROM "原""表🚢"').get(); db.exec(plan.sql[0]); expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(value.name)?.sql).toBe(plan.storedSql[0].sql); expect(db.prepare('SELECT count(*) AS rows FROM "原""表🚢"').get()).toEqual(before); });
  });

  it('解析原DDL按top-level逗号拆键、恢复末尾方向/COLLATE与WHERE，quoted分号/逗号和嵌套函数不混淆', () => {
    const sql = 'CREATE UNIQUE INDEX main."恢复""索引🚢" ON "原""表🚢" ("Name" COLLATE NOCASE DESC, substr("Name",1,2) || \',;?\' ASC, (n+1) DESC) WHERE n > 0 AND "Name" <> \';\'';
    const parsed = parseSqliteIndexDesign(sql, columns); expect(parsed).toEqual({ name: '恢复"索引🚢', unique: true, keys: [{ kind: 'column', name: 'Name', collation: 'NOCASE', order: 'desc' }, { kind: 'expression', expression: 'substr("Name",1,2) || \',;?\'', order: 'asc' }, { kind: 'expression', expression: '(n+1)', order: 'desc' }], where: 'n > 0 AND "Name" <> \';\'' });
    if (!parsed) throw Error('原DDL必须可恢复'); database(db => { db.exec(sql); const before = db.prepare('SELECT * FROM pragma_index_xinfo(?) ORDER BY seqno').all(parsed.name); for (const ddl of buildSqliteIndexesPlan(target, [{ kind: 'drop', name: parsed.name }, { kind: 'create', design: parsed }]).sql) db.exec(ddl); expect(db.prepare('SELECT * FROM pragma_index_xinfo(?) ORDER BY seqno').all(parsed.name)).toEqual(before); });
  });

  it('不能识别或含第二语句时明确返回undefined，原SQL不被改写或静默生成空设计', () => {
    for (const raw of ['CREATE TABLE x(a)', 'CREATE INDEX x ON t(a); DROP TABLE t', 'CREATE INDEX x ON t(a) WHERE n=?', 'CREATE INDEX x ON t(a', 'CREATE INDEX x ON t(a) garbage', 'CREATE INDEX sqlite_autoindex_x_1 ON t(a)']) { expect(parseSqliteIndexDesign(raw, columns)).toBeUndefined(); expect(raw).toBe(raw.slice()); }
    expect(parseSqliteIndexDesign('CREATE INDEX x ON t("Name") WHERE \';\'', columns)?.where).toBe("';'");
    expect(parseSqliteIndexDesign('CREATE INDEX x ON t(\',\' DESC, \';\' ASC)', columns)?.keys).toEqual([{ kind: 'expression', expression: "','", order: 'desc' }, { kind: 'expression', expression: "';'", order: 'asc' }]);
    expect(parseSqliteIndexDesign('CREATE INDEX IF NOT EXISTS [可恢复] ON t([Name] DESC); --尾注释', columns)).toMatchObject({ name: '可恢复', keys: [{ kind: 'column', name: 'Name', order: 'desc' }] });
    expect(parseSqliteIndexDesign('CREATE INDEX x ON t(\u00a0Name DESC)', [{ name: '\u00a0Name' }])?.keys).toEqual([{ kind: 'column', name: '\u00a0Name', order: 'desc' }]);
    expect(parseSqliteIndexDesign('CREATE INDEX x ON t(desc, n + desc, n COLLATE desc)', [{ name: 'desc' }, { name: 'n' }])?.keys).toEqual([{ kind: 'column', name: 'desc', order: 'asc' }, { kind: 'expression', expression: 'n + desc', order: 'asc' }, { kind: 'column', name: 'n', collation: 'desc', order: 'asc' }]);
  });

  it('同名动作只接受先DROP再CREATE，ASCII冲突拒绝而不把Unicode不同索引误合并', () => {
    expect(() => buildSqliteIndexesPlan(target, [{ kind: 'drop', name: 'ABC' }, { kind: 'create', design: { ...design(), name: 'abc' } }])).not.toThrow();
    for (const actions of [[{ kind: 'drop', name: 'ABC' }, { kind: 'drop', name: 'abc' }], [{ kind: 'create', design: design() }, { kind: 'create', design: design() }], [{ kind: 'create', design: design() }, { kind: 'drop', name: design().name }]]) expect(sqliteIndexesActionsSchema.safeParse(actions).success).toBe(false);
    expect(() => buildSqliteIndexesPlan(target, [{ kind: 'create', design: { ...design(), name: target.table } }])).toThrow(); expect(() => buildSqliteIndexesPlan(target, [{ kind: 'create', design: { ...design(), name: 'Ä' } }, { kind: 'create', design: { ...design(), name: 'ä' } }])).not.toThrow();
  });

  it('复合表达式末尾COLLATE保留原优先级，真实替换后xinfo及强制原索引读取一致', () => {
    database(db => {
      const sql = 'CREATE INDEX "复合COLLATE" ON "原""表🚢" ("Name" || \'x\' COLLATE NOCASE DESC)', parsed = parseSqliteIndexDesign(sql, columns); expect(parsed?.keys).toEqual([{ kind: 'expression', expression: '"Name" || \'x\' COLLATE NOCASE', order: 'desc' }]); if (!parsed) throw Error('完整表达式必须保留');
      db.exec(sql); const before = db.prepare('SELECT * FROM pragma_index_xinfo(?) ORDER BY seqno').all(parsed.name), rows = db.prepare('SELECT Name,n FROM "原""表🚢" INDEXED BY "复合COLLATE" ORDER BY "Name" || \'x\' COLLATE NOCASE DESC').all();
      for (const ddl of buildSqliteIndexesPlan(target, [{ kind: 'drop', name: parsed.name }, { kind: 'create', design: parsed }]).sql) db.exec(ddl);
      expect(db.prepare('SELECT * FROM pragma_index_xinfo(?) ORDER BY seqno').all(parsed.name)).toEqual(before); expect(db.prepare('SELECT Name,n FROM "原""表🚢" INDEXED BY "复合COLLATE" ORDER BY "Name" || \'x\' COLLATE NOCASE DESC').all()).toEqual(rows);
    });
  });
});
