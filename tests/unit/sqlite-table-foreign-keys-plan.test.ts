import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteTableForeignKey, sqliteTableForeignKeyEditsSchema, sqliteTableForeignKeyLimits, type SqliteTableForeignKeyDefinition } from '../../src/shared/sqliteTableForeignKeys';
import { compileSqliteTableForeignKeys as compile, inspectSqliteTableForeignKeys as inspect, compileSqliteTableRebuildDefinition, type SqliteRebuildSourceColumn } from '../../src/shared/sqliteTableRebuildPlan';

const parents = 'CREATE TABLE parent(id INTEGER PRIMARY KEY,a TEXT,b INTEGER,UNIQUE(a,b)); CREATE TABLE other(id INTEGER PRIMARY KEY);';
const design = (patch: Partial<SqliteTableForeignKeyDefinition> = {}): SqliteTableForeignKeyDefinition => ({ name: 'fk_new', columns: ['b'], referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'CASCADE', deferral: 'deferred', ...patch });
/** 原定义与列目录从独立真实SQLite读取；编译候选放入另一内存库，不修改源表。 */
function fixture(sql: string) {
  const db = new DatabaseSync(':memory:'); try { db.exec(parents); db.exec(sql); } catch (error) { db.close(); throw error; }
  const table = 'child', tableSql = db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', table)!.sql as string;
  const columns: SqliteRebuildSourceColumn[] = db.prepare('PRAGMA table_xinfo(child)').all().map(column => ({ name: String(column.name), hidden: Number(column.hidden) }));
  const input = { table, tableSql, columns };
  return { db, input, validate(candidate: string) { const next = new DatabaseSync(':memory:'); try { next.exec(parents); next.exec(candidate); return next; } catch (error) { next.close(); throw error; } } };
}
/** PRAGMA编号按native生成，断言使用真实字段和动作而非编译器的读取结果。 */
function foreign(db: DatabaseSync) { return db.prepare('PRAGMA foreign_key_list(child)').all().map(row => ({ parent: row.table, from: row.from, to: row.to, onDelete: row.on_delete, onUpdate: row.on_update, seq: row.seq })); }

describe('SQLite已有外键的原文定位与结构化编译', () => {
  it('同时定位inline和表级外键，跳过注释、字符串、CHECK与DEFAULT假关键字', () => {
    const f = fixture(`CREATE TABLE child(id INTEGER PRIMARY KEY, a TEXT DEFAULT 'REFERENCES(fake),CONSTRAINT x', b INTEGER CONSTRAINT "f,1" REFERENCES parent(id) ON DELETE SET DEFAULT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED, g TEXT AS (a||'REFERENCES p,') VIRTUAL, CONSTRAINT keep CHECK(length(a)>=0), CONSTRAINT "f,2" FOREIGN KEY(a,b) REFERENCES parent(a,b) MATCH SIMPLE ON DELETE RESTRICT);`);
    try {
      const keys = inspect(f.input); expect(keys).toHaveLength(2);
      expect(keys[0]).toMatchObject({ ordinal: 0, location: 'column', column: 'b', names: ['f,1'], columns: ['b'], referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'SET DEFAULT', onUpdate: 'CASCADE', deferral: 'deferred', matches: [], onInsert: [] });
      expect(keys[1]).toMatchObject({ ordinal: 1, location: 'table', names: ['f,2'], columns: ['a', 'b'], referencedColumns: ['a', 'b'], matches: ['SIMPLE'], onDelete: 'RESTRICT', deferral: 'not-deferrable' });
      expect(keys[0].sql).toBe('CONSTRAINT "f,1" REFERENCES parent(id) ON DELETE SET DEFAULT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED'); expect(Object.isFrozen(keys[0].columns)).toBe(true); expect(Object.isFrozen(keys[0])).toBe(true);
    } finally { f.db.close(); }
  });
  it('移除单列原FK仅移除准确跨度，NOT NULL／DEFAULT／CHECK／生成列与未改FK原文保持', () => {
    const f = fixture(`CREATE TABLE child(id INTEGER PRIMARY KEY AUTOINCREMENT,a TEXT COLLATE NOCASE NOT NULL DEFAULT '约束, REFERENCES p',b INTEGER CONSTRAINT fk_old REFERENCES parent(id) ON DELETE SET NULL CONSTRAINT must_be_null CHECK(b IS NULL OR b>0),g TEXT AS(a||','||b) VIRTUAL,CONSTRAINT u_keep UNIQUE(a,b), CONSTRAINT f_keep FOREIGN KEY(a,b) REFERENCES parent(a,b)) STRICT;`);
    try {
      const old = inspect(f.input), output = compile(f.input, [{ kind: 'remove', ordinal: 0, expectedSql: old[0].sql }]), next = f.validate(output.tableSql);
      try {
        expect(foreign(next)).toEqual([{ parent: 'parent', from: 'a', to: 'a', onDelete: 'NO ACTION', onUpdate: 'NO ACTION', seq: 0 }, { parent: 'parent', from: 'b', to: 'b', onDelete: 'NO ACTION', onUpdate: 'NO ACTION', seq: 1 }]);
        for (const sql of ["a TEXT COLLATE NOCASE NOT NULL DEFAULT '约束, REFERENCES p'", 'CONSTRAINT must_be_null CHECK(b IS NULL OR b>0)', "g TEXT AS(a||','||b) VIRTUAL", 'CONSTRAINT u_keep UNIQUE(a,b)', old[1].sql]) expect(output.tableSql).toContain(sql);
        expect(next.prepare('PRAGMA table_xinfo(child)').all()).toEqual(f.db.prepare('PRAGMA table_xinfo(child)').all()); expect(output).toMatchObject({ added: 0, removed: 1, replaced: 0 });
      } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('重复约束名和相同FK各按声明序号定位，移除其中一个不误删另一个', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER CONSTRAINT same REFERENCES parent(id) CONSTRAINT same REFERENCES parent(id), CONSTRAINT same FOREIGN KEY(b) REFERENCES other(id));');
    try { const old = inspect(f.input); expect(old).toHaveLength(3); const output = compile(f.input, [{ kind: 'remove', ordinal: 1, expectedSql: old[1].sql }]), next = f.validate(output.tableSql); try { expect(foreign(next).map(row => row.parent).sort()).toEqual(['other', 'parent']); expect(output.foreignKeys.map(key => key.names)).toEqual([['same'], ['same']]); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('增加复合FK和替换inline为表级FK，原约束名可准确复用且父列省略保持隐式主键', () => {
    const f = fixture('CREATE TABLE child(id INTEGER PRIMARY KEY,a TEXT,b INTEGER CONSTRAINT fk_old REFERENCES other);');
    try {
      const old = inspect(f.input), output = compile(f.input, [{ kind: 'replace', ordinal: 0, expectedSql: old[0].sql, definition: design({ name: 'fk_old', referencedColumns: [] }) }, { kind: 'add', definition: design({ name: 'fk_pair', columns: ['a', 'b'], referencedColumns: ['a', 'b'], onDelete: 'SET DEFAULT', deferral: 'immediate' }) }]), next = f.validate(output.tableSql);
      try { expect(foreign(next)).toEqual([{ parent: 'parent', from: 'a', to: 'a', onDelete: 'SET DEFAULT', onUpdate: 'CASCADE', seq: 0 }, { parent: 'parent', from: 'b', to: 'b', onDelete: 'SET DEFAULT', onUpdate: 'CASCADE', seq: 1 }, { parent: 'parent', from: 'b', to: null, onDelete: 'NO ACTION', onUpdate: 'CASCADE', seq: 0 }]); expect(output).toMatchObject({ added: 1, removed: 0, replaced: 1 }); } finally { next.close(); }
    } finally { f.db.close(); }
  });
  it('保留表级FK前后注释及未修改片段，全部外键移除仍是有效CREATE', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER, /*前置*/ CONSTRAINT f1 FOREIGN KEY(b) REFERENCES parent(id) /*尾注*/, --第二项\n CONSTRAINT f2 FOREIGN KEY(id) REFERENCES other(id)\n) /*表后注*/;');
    // SQLite目录会省略语句末尾注释；本反例明确把有效尾注加入传入原文，检验编译跨度保真。
    f.input.tableSql += ' /*表后注*/;';
    try { const old = inspect(f.input), output = compile(f.input, old.map(key => ({ kind: 'remove', ordinal: key.ordinal, expectedSql: key.sql }))), next = f.validate(output.tableSql); try { expect(foreign(next)).toEqual([]); for (const comment of ['/*前置*/', '/*尾注*/', '--第二项', '/*表后注*/']) expect(output.tableSql).toContain(comment); expect(output.tableSql).toContain('id INTEGER,b INTEGER'); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'] as const)('%s删除／更新动作由真实native目录核对', action => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER);');
    try { const output = compile(f.input, [{ kind: 'add', definition: design({ onDelete: action, onUpdate: action }) }]), next = f.validate(output.tableSql); try { expect(foreign(next)[0]).toMatchObject({ onDelete: action, onUpdate: action }); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['not-deferrable', 'immediate', 'deferred'] as const)('%s延迟规则以真实事务行为核对，不只比较生成字符串', deferral => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER);');
    try { const output = compile(f.input, [{ kind: 'add', definition: design({ deferral }) }]), next = f.validate(output.tableSql); try { next.exec('PRAGMA foreign_keys=ON; BEGIN;'); if (deferral === 'deferred') { next.exec('INSERT INTO child VALUES(1,99)'); expect(() => next.exec('COMMIT')).toThrow(/FOREIGN KEY/); } else expect(() => next.exec('INSERT INTO child VALUES(1,99)')).toThrow(/FOREIGN KEY/); next.exec('ROLLBACK'); expect(next.prepare('SELECT count(*) AS n FROM child').get()!.n).toBe(0); } finally { next.close(); } } finally { f.db.close(); }
  });
  it.each(['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'] as const)('%s动作在真实父行删除／改键后产生对应约束行为', action => {
    for (const operation of ['DELETE FROM parent WHERE id=2', 'UPDATE parent SET id=3 WHERE id=2']) {
      const f = fixture('CREATE TABLE child(id INTEGER PRIMARY KEY,b INTEGER DEFAULT 1);');
      try {
        const output = compile(f.input, [{ kind: 'add', definition: design({ onDelete: action, onUpdate: action, deferral: 'not-deferrable' }) }]), next = f.validate(output.tableSql);
        try {
          next.exec('PRAGMA foreign_keys=ON; INSERT INTO parent(id) VALUES(1),(2); INSERT INTO child VALUES(7,2);');
          if (action === 'NO ACTION' || action === 'RESTRICT') { expect(() => next.exec(operation)).toThrow(/FOREIGN KEY/); expect(next.prepare('SELECT b FROM child').get()!.b).toBe(2); }
          else { next.exec(operation); const row = next.prepare('SELECT b FROM child').get(); if (action === 'CASCADE' && operation.startsWith('DELETE')) expect(row).toBeUndefined(); else expect(row!.b).toBe(action === 'SET NULL' ? null : action === 'SET DEFAULT' ? 1 : 3); }
        } finally { next.close(); }
      } finally { f.db.close(); }
    }
  });
  it('旧父字段空名称保持原文和真实目录，不把它误作省略父列的隐式主键', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER REFERENCES parent(""));');
    try { const original = inspect(f.input)[0]; expect(original.referencedColumns).toEqual(['']); const output = compile(f.input, [{ kind: 'add', definition: design({ name: 'second' }) }]), next = f.validate(output.tableSql); try { expect(output.tableSql).toContain(original.sql); expect(foreign(next).some(key => key.to === '')).toBe(true); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('引号、分号、非BMP和注释形状的名称只作为标识符，不构造第二条语句', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER);');
    try { const output = compile(f.input, [{ kind: 'add', definition: design({ name: '外键";--🚢', referencedTable: '父"; DROP TABLE child;--', referencedColumns: ['键",/*🚢'] }) }]), next = f.validate(output.tableSql); try { expect(foreign(next)[0]).toMatchObject({ parent: '父"; DROP TABLE child;--', to: '键",/*🚢' }); expect(next.prepare('SELECT name FROM sqlite_schema WHERE name=?').get('child')).toBeDefined(); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('自引用使用准确原表名，编译后的类型/default重建仍保留新FK', () => {
    const f = fixture('CREATE TABLE child(id INTEGER PRIMARY KEY,b INTEGER);');
    try { const output = compile(f.input, [{ kind: 'add', definition: design({ referencedTable: 'CHILD', referencedColumns: ['id'] }) }]), candidate = compileSqliteTableRebuildDefinition({ ...f.input, tableSql: output.tableSql, candidateName: '__dbark_rebuild_' + '1'.repeat(32), changes: [{ column: 'b', declaredType: 'INT' }] }); expect(candidate.candidateSql).toContain('REFERENCES "child" ("id")'); const next = f.validate(candidate.candidateSql); try { expect(next.prepare('SELECT name FROM sqlite_schema WHERE name=?').get('__dbark_rebuild_' + '1'.repeat(32))).toBeDefined(); } finally { next.close(); } } finally { f.db.close(); }
  });
  it('ON INSERT与MATCH原文标示为兼容信息，未修改约束逐字保留', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER REFERENCES parent(id) ON INSERT CASCADE MATCH FULL NOT DEFERRABLE INITIALLY DEFERRED);');
    try { const old = inspect(f.input); expect(old[0]).toMatchObject({ onInsert: ['CASCADE'], matches: ['FULL'], deferral: 'not-deferrable' }); const output = compile(f.input, [{ kind: 'add', definition: design({ name: 'additional', columns: ['id'] }) }]); expect(output.tableSql).toContain(old[0].sql); const next = f.validate(output.tableSql); next.close(); } finally { f.db.close(); }
  });
  it.each(['ordinal', 'sql', 'duplicate-source', 'name-collision', 'unknown-column', 'self-column', 'duplicate-name'] as const)('%s错误完整拒绝且不改变输入', mode => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER CONSTRAINT f1 REFERENCES parent(id), CONSTRAINT keep CHECK(b>=0));');
    try {
      const old = inspect(f.input), before = structuredClone(f.input); let edits: unknown = [{ kind: 'remove', ordinal: 0, expectedSql: old[0].sql }];
      if (mode === 'ordinal') edits = [{ kind: 'remove', ordinal: 1, expectedSql: old[0].sql }];
      if (mode === 'sql') edits = [{ kind: 'remove', ordinal: 0, expectedSql: old[0].sql + ' ' }];
      if (mode === 'duplicate-source') edits = [...edits as object[], ...edits as object[]];
      if (mode === 'name-collision') edits = [{ kind: 'add', definition: design({ name: 'KEEP' }) }];
      if (mode === 'unknown-column') edits = [{ kind: 'add', definition: design({ columns: ['B'] }) }];
      if (mode === 'self-column') edits = [{ kind: 'add', definition: design({ referencedTable: 'child', referencedColumns: ['missing'] }) }];
      if (mode === 'duplicate-name') edits = [{ kind: 'add', definition: design() }, { kind: 'add', definition: design({ name: 'FK_NEW' }) }];
      expect(() => compile(f.input, edits)).toThrow(); expect(f.input).toEqual(before);
    } finally { f.db.close(); }
  });
  it.each(['empty', 'extra', 'mismatched', 'repeat-column', 'bad-action', 'path', 'lone-surrogate', 'nul', 'sparse', 'getter', 'cycle', 'budget'] as const)('%s输入在能力接口接入前即严格拒绝，getter零调用', mode => {
    let edits: any = [{ kind: 'add', definition: design() }]; const getter = vi.fn(() => { throw Error('不应读取'); });
    if (mode === 'empty') edits = [];
    if (mode === 'extra') edits[0].sql = 'DROP TABLE child';
    if (mode === 'mismatched') edits[0].definition.referencedColumns = ['id', 'b'];
    if (mode === 'repeat-column') { edits[0].definition.columns = ['b', 'B']; edits[0].definition.referencedColumns = []; }
    if (mode === 'bad-action') edits[0].definition.onDelete = 'CASCADE; DROP TABLE child';
    if (mode === 'path') edits[0].definition.filePath = '不可传文件';
    if (mode === 'lone-surrogate') edits[0].definition.name = '\uD800';
    if (mode === 'nul') edits[0].definition.name = '\0';
    if (mode === 'sparse') delete edits[0];
    if (mode === 'getter') Object.defineProperty(edits[0], 'definition', { enumerable: true, get: getter });
    if (mode === 'cycle') edits[0].definition = edits;
    if (mode === 'budget') edits = [{ kind: 'remove', ordinal: 0, expectedSql: '🚢'.repeat(sqliteTableForeignKeyLimits.bytes / 4 + 1) }];
    expect(sqliteTableForeignKeyEditsSchema.safeParse(edits).success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('源元数据及SQL访问器零调用；缺列、CTAS、虚拟表、多语句及未闭合SQL不猜测', () => {
    const f = fixture('CREATE TABLE child(id INTEGER,b INTEGER REFERENCES parent(id));');
    try {
      const getter = vi.fn(() => { throw Error('不应读取'); }); const input = { ...f.input }; Object.defineProperty(input, 'tableSql', { get: getter }); expect(() => inspect(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
      const column = { ...f.input.columns[0] }; Object.defineProperty(column, 'name', { get: getter }); expect(() => inspect({ ...f.input, columns: [column, f.input.columns[1]] })).toThrow();
      const columns = [...f.input.columns]; Object.defineProperty(columns, '0', { get: getter }); expect(() => inspect({ ...f.input, columns })).toThrow(); expect(getter).not.toHaveBeenCalled();
      for (const tableSql of ['CREATE TABLE child AS SELECT 1 AS id;', 'CREATE VIRTUAL TABLE child USING fts5(id,b);', f.input.tableSql + '; DROP TABLE parent;', 'CREATE TABLE child(id,b REFERENCES parent(']) expect(() => inspect({ ...f.input, tableSql })).toThrow();
      expect(() => inspect({ ...f.input, columns: f.input.columns.slice(1) })).toThrow();
    } finally { f.db.close(); }
  });
  it('直接SQL构造器只接结构，不接受表达式字段或额外可执行属性', () => {
    expect(buildSqliteTableForeignKey(design({ name: null, referencedColumns: [] }), 'child', ['id', 'b'])).toBe('FOREIGN KEY ("b") REFERENCES "parent" ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED');
    expect(() => buildSqliteTableForeignKey({ ...design(), sql: '任意SQL' }, 'child', ['b'])).toThrow();
  });
});
