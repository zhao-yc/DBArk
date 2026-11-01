import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileSqliteTableRebuildDefinition as compile, sqliteTableRebuildPlanLimits as limits, type SqliteRebuildColumnChange, type SqliteTableRebuildDefinitionInput } from '../../src/shared/sqliteTableRebuildPlan';

const candidate = '__dbark_rebuild_0123456789abcdef0123456789abcdef';
const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';
/** 内存native原库提供真实sqlite_schema/xinfo；候选只CREATE，不执行迁移或触碰用户文件。 */
function fixture(sql: string, action: (db: DatabaseSync, input: SqliteTableRebuildDefinitionInput) => void, table = 'target'): void {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
  try {
    db.exec('CREATE TABLE parent(code TEXT PRIMARY KEY);' + sql);
    const tableSql = db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(table)!.sql as string;
    const columns = db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(table).map(row => ({ name: row.name as string, hidden: row.hidden as number }));
    action(db, { table, tableSql, columns, candidateName: candidate, changes: [{ column: columns[0].name, default: { kind: 'null' } }] });
  } finally { db.close(); }
}
function xinfo(db: DatabaseSync, table: string) { return db.prepare('SELECT name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(table); }
function schema(db: DatabaseSync) { return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name<>? ORDER BY type,name').all(candidate); }
/** 编译前后原库完全不变，native执行候选CREATE只用于证明语法及元数据，不代表真实重建提交。 */
function create(db: DatabaseSync, input: SqliteTableRebuildDefinitionInput, changes: SqliteRebuildColumnChange[]) {
  const before = schema(db), result = compile({ ...input, changes }); expect(schema(db)).toEqual(before);
  db.exec(result.candidateSql); expect(schema(db)).toEqual(before); return result;
}

describe('SQLite重建声明跨度编译与真实native候选CREATE', () => {
  it('只改目标类型/default，原CHECK、生成列、命名约束、外键动作和其它定义保留', () => {
    fixture(`CREATE TABLE target (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code varchar(20) COLLATE NOCASE CONSTRAINT original_unique UNIQUE ON CONFLICT ABORT,
      raw BLOB CONSTRAINT original_default DEFAULT X'00ff',
      gen TEXT GENERATED ALWAYS AS (code || ',DEFAULT REFERENCES') STORED,
      CONSTRAINT original_check CHECK(length(code)>0),
      FOREIGN KEY (code) REFERENCES parent(code) ON UPDATE CASCADE ON DELETE SET DEFAULT DEFERRABLE INITIALLY DEFERRED
    ); CREATE INDEX ix ON target(code) WHERE code<>'DEFAULT'; CREATE VIEW viewed AS SELECT * FROM target; CREATE TRIGGER tracked AFTER UPDATE ON target BEGIN SELECT 1; END;`, (db, input) => {
      const result = create(db, input, [{ column: 'code', declaredType: 'TEXT' }, { column: 'raw', default: { kind: 'blob', value: 'fe00' } }]);
      expect(result.candidateSql).toContain('COLLATE NOCASE CONSTRAINT original_unique UNIQUE ON CONFLICT ABORT');
      expect(result.candidateSql).toContain("gen TEXT GENERATED ALWAYS AS (code || ',DEFAULT REFERENCES') STORED");
      expect(result.candidateSql).toContain('CONSTRAINT original_check CHECK(length(code)>0)');
      expect(result.candidateSql).toContain('ON DELETE SET DEFAULT DEFERRABLE INITIALLY DEFERRED');
      expect(result.candidateSql).not.toContain('original_default');
      expect(result.columnMapping).toEqual([{ name: 'id', copy: true }, { name: 'code', copy: true }, { name: 'raw', copy: true }, { name: 'gen', copy: false }]);
      const original = xinfo(db, 'target'); expect(xinfo(db, candidate)).toEqual(original.map(row => row.name === 'code' ? { ...row, type: 'TEXT' } : row.name === 'raw' ? { ...row, dflt_value: "X'fe00'" } : row));
    });
  });

  it.each([
    ['signed', '-9223372036854775808'], ['positive', '+1.25e+2'], ['hex', '0x7fff'], ['underscore', '1_000'],
    ['blob', "X'00ff'"], ['clock', 'CURRENT_TIMESTAMP'], ['parentheses', "(CASE WHEN 1 THEN printf('%s,%s','a','b') ELSE 'DEFAULT' END)"],
    ['comments', "(/* DEFAULT , */ (1 + /*,*/ 2))"], ['literal', "'DEFAULT , ''中文🚢'"], ['identifier', 'legacy_value'],
  ])('完整移除%s默认值，不残留表达式或命名约束', (_name, value) => {
    fixture(`CREATE TABLE target (x TEXT CONSTRAINT old_default DEFAULT ${value} NOT NULL, y)`, (db, input) => {
      const result = create(db, input, [{ column: 'x', default: { kind: 'none' } }]);
      expect(xinfo(db, candidate)[0]).toMatchObject({ dflt_value: null, notnull: 1 }); expect(result.candidateSql).not.toContain('old_default');
    });
  });

  it('重复DEFAULT全部移除，SET DEFAULT和其它命名约束不会被删除', () => {
    fixture("CREATE TABLE target (x TEXT CONSTRAINT a DEFAULT 'earlier' CONSTRAINT b DEFAULT('later') CONSTRAINT unique_x UNIQUE REFERENCES parent(code) ON DELETE SET DEFAULT ON UPDATE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE)", (db, input) => {
      expect(xinfo(db, 'target')[0].dflt_value).toBe("'later'");
      const result = create(db, input, [{ column: 'x', default: { kind: 'none' } }]);
      expect(xinfo(db, candidate)[0].dflt_value).toBeNull(); expect(result.candidateSql).toContain('CONSTRAINT unique_x UNIQUE REFERENCES parent(code) ON DELETE SET DEFAULT ON UPDATE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE');
    });
  });

  it.each(['"GENERATED"', 'GENERATED', 'GENERATED ALWAYS', 'DOUBLE GENERATED', '"DEFAULT"', 'DOUBLE PRECISION', 'DECIMAL(38,18)', '"custom AS DEFAULT (type)"', ''])('保留合法原声明类型%s，默认修改不重序列化类型', type => {
    fixture(`CREATE TABLE target (x ${type} DEFAULT 1, other TEXT)`, (db, input) => {
      const result = create(db, input, [{ column: 'x', default: { kind: 'integer', value: '7' } }]);
      expect(result.candidateSql).toContain(`x ${type}`); expect(xinfo(db, candidate)[0].type).toBe(xinfo(db, 'target')[0].type);
      db.exec(`INSERT INTO ${q(candidate)}(other) VALUES('a')`); expect(db.prepare(`SELECT x=7 AS matches FROM ${q(candidate)}`).get()!.matches).toBe(1);
    });
  });

  it.each(['"quoted"', '`back``tick`', '[bracket]', "'single''quote'", '中文🚢', 'abort', 'key'])('按native解码名匹配%s，不替换同名字符串和注释', token => {
    fixture(`CREATE TABLE target (${token} TEXT DEFAULT '${token.replaceAll("'", "''")}', other CHECK(other<>',DEFAULT'))`, (db, input) => {
      const name = input.columns[0].name, result = create(db, input, [{ column: name, declaredType: 'VARCHAR(80)' }]);
      expect(result.candidateSql).toContain(`${token} `); expect(result.candidateSql).toContain(`DEFAULT '${token.replaceAll("'", "''")}'`); expect(xinfo(db, candidate)[0].type).toBe('VARCHAR(80)');
    });
  });

  it('无类型列可同时增加类型与默认值，也可从既有列明确删除声明类型', () => {
    fixture('CREATE TABLE target (x, y INT)', (db, input) => {
      create(db, input, [{ column: 'x', declaredType: 'TEXT', default: { kind: 'text', value: 'a' } }, { column: 'y', declaredType: '' }]);
      expect(xinfo(db, candidate)).toEqual([{ name: 'x', type: 'TEXT', notnull: 0, dflt_value: "'a'", pk: 0, hidden: 0 }, { name: 'y', type: '', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }]);
    });
  });

  it('声明类型整体引用，类型中的约束或SQL不能成为额外操作', () => {
    fixture('CREATE TABLE target (x TEXT)', (db, input) => {
      const type = 'TEXT\" DEFAULT 9); DROP TABLE target;--'; create(db, input, [{ column: 'x', declaredType: type }]);
      expect(xinfo(db, candidate)[0]).toMatchObject({ type, dflt_value: null }); expect(xinfo(db, 'target')).toHaveLength(1);
    });
  });

  it('候选DDL可创建不代表亲和性保精度，REAL的int64默认值仍须由未来写入门单独处理', () => {
    fixture('CREATE TABLE target (x DOUBLE PRECISION)', (db, input) => {
      create(db, input, [{ column: 'x', default: { kind: 'integer', value: '9223372036854775807' } }]);
      expect(xinfo(db, candidate)[0].dflt_value).toBe('9223372036854775807');
      db.exec(`INSERT INTO ${q(candidate)} DEFAULT VALUES`);
      expect(db.prepare(`SELECT typeof(x) AS t,CAST(x AS TEXT) AS s FROM ${q(candidate)}`).get()).toEqual({ t: 'real', s: '9.2233720368547758e+18' });
    });
  });

  it.each([
    { kind: 'none' as const }, { kind: 'null' as const }, { kind: 'text' as const, value: "'中文\0🚢" },
    { kind: 'integer' as const, value: '-9223372036854775808' }, { kind: 'real' as const, value: '1.25e-2' },
    { kind: 'blob' as const, value: '00ff' }, { kind: 'current-date' as const }, { kind: 'current-time' as const }, { kind: 'current-timestamp' as const },
  ])('typed默认值$kind可native创建，精确值由原typed builder生成', value => {
    fixture('CREATE TABLE target (x)', (db, input) => {
      create(db, input, [{ column: 'x', default: value }]); db.exec(`INSERT INTO ${q(candidate)} DEFAULT VALUES`);
      const row = db.prepare(`SELECT typeof(x) AS t, CAST(x AS TEXT) AS s,hex(x) AS b FROM ${q(candidate)}`).get()!;
      if (value.kind === 'text') expect(row.s).toBe(value.value);
      if (value.kind === 'integer') expect(row.s).toBe(value.value);
      if (value.kind === 'blob') expect(row.b).toBe('00FF');
      if (value.kind === 'none' || value.kind === 'null') expect(row.t).toBe('null');
    });
  });

  it.each(['STRICT', 'WITHOUT ROWID', 'WITHOUT ROWID, STRICT', 'STRICT, WITHOUT ROWID', 'STRICT, STRICT', 'WITHOUT ROWID, WITHOUT ROWID'])('保留%s及复合主键/冲突策略', suffix => {
    fixture(`CREATE TABLE target (x TEXT NOT NULL, y INTEGER, PRIMARY KEY(x,y) ON CONFLICT REPLACE) ${suffix}`, (db, input) => {
      const result = create(db, input, [{ column: 'x', default: { kind: 'text', value: 'hello' } }]);
      expect(result.candidateSql.endsWith(suffix)).toBe(true); expect(xinfo(db, candidate)[0].dflt_value).toBe("'hello'");
    });
  });

  it('尾部行注释、列内嵌套注释、括号和逗号不会吞掉新增默认值', () => {
    fixture("CREATE TABLE target (x /* type comment */ TEXT /* gap */ CHECK(instr(x,',')=0) -- keep DEFAULT\n, y TEXT /*,) DEFAULT*/)", (db, input) => {
      const result = create(db, { ...input, tableSql: input.tableSql + ' -- trailing' }, [{ column: 'x', default: { kind: 'text', value: 'ok' } }, { column: 'y', declaredType: 'BLOB' }]);
      expect(result.candidateSql).toContain('-- keep DEFAULT\n'); expect(result.candidateSql).toContain('/*,) DEFAULT*/'); expect(result.candidateSql.endsWith(' -- trailing')).toBe(true);
      expect(xinfo(db, candidate)[0].dflt_value).toBe("'ok'");
    });
  });

  it('主键DESC和AUTOINCREMENT保持原文，不推断或宣称隐藏rowid已保存', () => {
    for (const key of ['INTEGER PRIMARY KEY DESC', 'INTEGER PRIMARY KEY AUTOINCREMENT', 'INTEGER, PRIMARY KEY(x DESC)']) fixture(`CREATE TABLE target (x ${key})`, (db, input) => {
      const result = create(db, input, [{ column: 'x', default: { kind: 'integer', value: '7' } }]);
      expect(result.candidateSql).toContain(key.includes(',') ? 'PRIMARY KEY(x DESC)' : key);
    });
  });

  it('生成列只给copy=false，不生成普通INSERT映射或允许添加默认值', () => {
    fixture('CREATE TABLE target (x TEXT, gen TEXT AS (x) VIRTUAL, stored TEXT AS (x) STORED)', (db, input) => {
      const result = create(db, input, [{ column: 'gen', declaredType: 'BLOB' }]); expect(result.columnMapping).toEqual([{ name: 'x', copy: true }, { name: 'gen', copy: false }, { name: 'stored', copy: false }]);
      expect(() => compile({ ...input, changes: [{ column: 'stored', default: { kind: 'none' } }] })).toThrow('生成列');
    });
  });

  it.each(['GENERATED ALWAYS AS(x)', 'GENERATED AS(x)', 'ALWAYS AS(x)', 'SOME GENERATED AS(x)', 'TEXT GENERATED ALWAYS AS(x)'])('生成声明%s的类型跨度与native吻合，GENERATED AS中的GENERATED是类型名', declaration => {
    fixture(`CREATE TABLE target (x TEXT, g ${declaration})`, (db, input) => {
      create(db, input, [{ column: 'g', declaredType: 'BLOB' }]); expect(xinfo(db, candidate)[1]).toMatchObject({ type: 'BLOB', hidden: 2 });
    });
  });

  it.each(['CONSTRAINT first CONSTRAINT last DEFAULT 1', 'CONSTRAINT dangling', 'DEFAULT 1 CONSTRAINT dangling', 'REFERENCES parent(code) ON INSERT SET DEFAULT DEFAULT 1'])('保留native旧兼容语法%s，只修改所选默认值', constraints => {
    fixture(`CREATE TABLE target (x TEXT ${constraints})`, (db, input) => {
      create(db, input, [{ column: 'x', default: { kind: 'text', value: 'new' } }]); expect(xinfo(db, candidate)[0].dflt_value).toBe("'new'");
    });
  });

  it.each(['target', '中文表🚢', 'table"quote', "single'quote"] )('仅修改CREATE头中准确表名%s，不修改自引用外键和字符串', table => {
    fixture(`CREATE TABLE main.${q(table)} (x INTEGER PRIMARY KEY, p INTEGER REFERENCES ${q(table)}(x), note TEXT DEFAULT 'target')`, (db, input) => {
      const result = create(db, input, [{ column: 'p', declaredType: 'BIGINT' }]); expect(result.candidateSql).toContain(`REFERENCES ${q(table)}(x)`); expect(result.candidateSql).toContain("DEFAULT 'target'");
      expect(db.prepare('SELECT "table" FROM pragma_foreign_key_list(?)').get(candidate)!.table).toBe(table);
    }, table);
  });
});

describe('SQLite重建编译拒绝歧义、额外SQL及预算不足', () => {
  const input: SqliteTableRebuildDefinitionInput = { table: 'target', tableSql: 'CREATE TABLE target (x TEXT DEFAULT 1)', columns: [{ name: 'x', hidden: 0 }], candidateName: candidate, changes: [{ column: 'x', declaredType: 'BLOB' }] };
  it.each([
    'CREATE TEMP TABLE target (x TEXT)', 'CREATE VIRTUAL TABLE target USING fts5(x)', 'CREATE TABLE target AS SELECT 1 AS x',
    'CREATE TABLE IF NOT EXISTS target (x TEXT)', 'CREATE TABLE other (x TEXT)', 'CREATE TABLE attached.target (x TEXT)',
    'CREATE TABLE target (x TEXT); DROP TABLE parent;', 'CREATE TABLE target (x TEXT);;', 'CREATE TABLE target (x TEXT) STRICT,',
    'CREATE TABLE target (x TEXT) STRICT STRICT',
    'CREATE TABLE target (x TEXT /*unclosed)', 'CREATE TABLE target (x "unclosed)', 'CREATE TABLE target (x TEXT,)',
    'CREATE TABLE target (x TEXT DEFAULT)', 'CREATE TABLE target (x TEXT DEFAULT +abc)', 'CREATE TABLE target (x TEXT CHECK(1);)',
    'CREATE TABLE target (x TEXT REFERENCES p ON DELETE DEFAULT)', 'CREATE TABLE target (x TEXT CONSTRAINT)',
  ])('拒绝无法确认的原定义%s', tableSql => { expect(() => compile({ ...input, tableSql })).toThrow(); });

  it.each([
    { table: 'sqlite_hidden' }, { candidateName: 'target' }, { candidateName: candidate + ';' }, { candidateName: candidate + '\n' },
    { columns: [] }, { columns: [{ name: 'wrong', hidden: 0 }] }, { columns: [{ name: 'x', hidden: 1 }] },
    { columns: [{ name: 'x', hidden: 0 }, { name: 'X', hidden: 0 }] },
    { changes: [] }, { changes: [{ column: 'absent', declaredType: 'TEXT' }] }, { changes: [{ column: 'x' }] },
    { changes: [{ column: 'x', declaredType: 'INT' }, { column: 'X', declaredType: 'TEXT' }] },
    { changes: [{ column: 'x', declaredType: 'a\0b' }] }, { changes: [{ column: 'x', declaredType: 'a\nb' }] },
    { changes: [{ column: 'x', default: { kind: 'text', value: '\ud800' } }] },
  ])('拒绝目录、候选身份或typed变更不符%j', patch => { expect(() => compile({ ...input, ...patch } as SqliteTableRebuildDefinitionInput)).toThrow(); });

  it('ASCII折叠匹配不会把不同Unicode列名合并，原native顺序必须完全一致', () => {
    fixture('CREATE TABLE target (É TEXT, é TEXT)', (db, source) => {
      create(db, source, [{ column: 'É', declaredType: 'BLOB' }]); expect(xinfo(db, candidate)[1].type).toBe('TEXT');
      expect(() => compile({ ...source, columns: [...source.columns].reverse() })).toThrow();
    });
  });

  it('生成列标记必须与原SQL吻合，不能把普通列漏复制或把生成列直接插入', () => {
    fixture('CREATE TABLE target (x TEXT, g TEXT AS(x) STORED, v AS(x))', (_db, source) => {
      for (const [ordinal, hidden] of [[0, 2], [1, 0], [1, 2], [2, 3]]) {
        const columns = source.columns.map((column, index) => index === ordinal ? { ...column, hidden } : column);
        expect(() => compile({ ...source, columns })).toThrow();
      }
    });
  });

  it('SQL、变更数和表达式深度在构造前检查，不以截断目录生成候选', () => {
    expect(() => compile({ ...input, tableSql: input.tableSql + ' '.repeat(limits.sqlBytes) })).toThrow();
    expect(() => compile({ ...input, changes: Array.from({ length: limits.changes + 1 }, () => input.changes[0]) })).toThrow();
    expect(() => compile({ ...input, tableSql: 'CREATE TABLE target (x TEXT DEFAULT ' + '('.repeat(limits.nesting + 1) + '1' + ')'.repeat(limits.nesting + 1) + ')' })).toThrow();
  });

  it('一万份原DEFAULT按原片段一次拼接删除，native不重新暴露早期默认值', () => {
    fixture('CREATE TABLE target(x TEXT ' + 'DEFAULT 1 '.repeat(10000) + ')', (db, source) => {
      const result = create(db, source, [{ column: 'X', default: { kind: 'none' } }]); expect(xinfo(db, candidate)[0].dflt_value).toBeNull(); expect(result.candidateSql).not.toContain('DEFAULT');
    });
  });

  it('累计新增UTF8预算超限时拒绝，不先拼出数MiB新SQL', () => {
    const names = Array.from({ length: 40 }, (_, index) => 'c' + index), tableSql = 'CREATE TABLE target(' + names.join(',') + ')';
    const columns = names.map(name => ({ name, hidden: 0 })), value = 'x'.repeat(65536);
    expect(() => compile({ ...input, tableSql, columns, changes: names.map(column => ({ column, default: { kind: 'text', value } })) })).toThrow();
  });
});
