import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { resolve } from 'node:path';
import { compareSqliteRebuildTables, type SqliteRebuildComparisonInput } from '../../src/engine/sqlite/rebuildComparison';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';
import { createSqliteNativeInvoke, resolveSqliteNativeResource } from '../../src/engine/sqlite/nativeRuntime';
import { SqliteRawStatement } from '../../src/engine/sqlite/rawStatement';

const input: SqliteRebuildComparisonInput = { source: 'source', candidate: 'candidate', sourceOrder: ['id'], candidateOrdinal: 'ordinal', columns: ['id', 'value'], rowid: { source: 'id', candidate: 'id' } };
const limitCode = 'SQLITE_REBUILD_COMPARISON_VALUE_LIMIT';
/** 比较保持在调用方已开启的真实SQLite事务内；所有数据仅为本例内存库。 */
async function fixture(action: (db: DatabaseSync) => Promise<void>, encoding = 'UTF-8'): Promise<void> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE source(id INTEGER PRIMARY KEY,value); CREATE TABLE candidate(id INTEGER PRIMARY KEY,value,ordinal INTEGER NOT NULL UNIQUE); BEGIN IMMEDIATE");
    db.limits.length = sqliteDriverLimits.recordBytes; await action(db);
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
}
/** 每次比较只允许让出控制和发布计数，控制端不接收业务值或执行事务语句。 */
function control() { return { check: () => {}, yield: async () => { await Promise.resolve(); } }; }
/** 真实SQL绑定准备两端，不能用伪造结果证明原生单值保护。 */
function insert(db: DatabaseSync, left: SQLInputValue, right: SQLInputValue = left): void { db.prepare('INSERT INTO source VALUES(1,?)').run(left); db.prepare('INSERT INTO candidate VALUES(1,?,1)').run(right); }

describe('SQLite重建比较与私有逐值读取的独立单值门', () => {
  it.each(['text', 'blob'] as const)('%s恰好1MiB可比较，超1字节在两端分别拒绝且保留原事务', async kind => fixture(async db => {
    const bounded = kind === 'text' ? 'a'.repeat(sqliteDriverLimits.valueBytes) : Buffer.alloc(sqliteDriverLimits.valueBytes, 7), oversized = kind === 'text' ? 'a'.repeat(sqliteDriverLimits.valueBytes + 1) : Buffer.alloc(sqliteDriverLimits.valueBytes + 1, 7);
    insert(db, bounded); expect((await compareSqliteRebuildTables(db, input, control())).verifiedRows).toBe('1');
    for (const table of ['source', 'candidate']) {
      db.prepare('UPDATE ' + table + ' SET value=?').run(oversized);
      await expect(compareSqliteRebuildTables(db, input, control())).rejects.toMatchObject({ code: limitCode }); expect(db.isTransaction).toBe(true);
      expect(db.prepare('SELECT length(value) AS n FROM ' + table).get()!.n).toBe(sqliteDriverLimits.valueBytes + 1);
      db.prepare('UPDATE ' + table + ' SET value=?').run(bounded);
    }
    expect((await compareSqliteRebuildTables(db, input, control())).verifiedRows).toBe('1');
  }));

  it('真实SQLite比较投影用不可能的NULL类型槽拒绝，大值没有进入Node游标结果', async () => fixture(async db => {
    insert(db, Buffer.alloc(sqliteDriverLimits.valueBytes + 1)); const prepare = db.prepare.bind(db), observed: unknown[][] = [];
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.includes('CASE WHEN') && sql.includes('typeof(')) {
        const iterate = statement.iterate.bind(statement);
        vi.spyOn(statement, 'iterate').mockImplementation((...parameters) => {
          const iterator = iterate(...parameters);
          return (function* () { for (const row of iterator) { observed.push(row as unknown as unknown[]); yield row; } })() as ReturnType<typeof statement.iterate>;
        });
      }
      return statement;
    });
    try { await expect(compareSqliteRebuildTables(db, input, control())).rejects.toMatchObject({ code: limitCode }); }
    finally { spy.mockRestore(); }
    expect(observed.length).toBe(2); expect(observed.every(row => row.slice(-3).every(value => value === null))).toBe(true); expect(db.isTransaction).toBe(true);
  }));

  it.each(['UTF-16le', 'UTF-16be'])('%s原编码和UTF8表示分别受1MiB单值门约束', async encoding => fixture(async db => {
    for (const value of ['a'.repeat(600000), '中'.repeat(400000)]) {
      expect(Math.max(Buffer.byteLength(value, 'utf16le'), Buffer.byteLength(value, 'utf8'))).toBeGreaterThan(sqliteDriverLimits.valueBytes);
      insert(db, value); await expect(compareSqliteRebuildTables(db, input, control())).rejects.toMatchObject({ code: limitCode }); expect(db.isTransaction).toBe(true); db.exec('DELETE FROM candidate; DELETE FROM source');
    }
  }, encoding));

  it.each(['text', 'blob'] as const)('原生私有逐值%s在描述符或字节交付前拒绝超量，原事务可继续', async kind => {
    const db = new DatabaseSync(':memory:', { allowExtension: true });
    try {
      db.loadExtension(resolveSqliteNativeResource(resolve('src/engine/sqlite/sqlite-native')), 'sqlite3_dbarkrawprobe_init'); db.enableLoadExtension(false); db.limits.length = sqliteDriverLimits.recordBytes;
      db.exec('CREATE TABLE source(value); BEGIN'); db.prepare('INSERT INTO source VALUES(?)').run(kind === 'text' ? 'a'.repeat(sqliteDriverLimits.valueBytes + 1) : Buffer.alloc(sqliteDriverLimits.valueBytes + 1));
      const statement = SqliteRawStatement.prepare(createSqliteNativeInvoke(db, () => {}), 'SELECT value FROM source');
      try { expect(() => statement.next()).toThrow(); } finally { statement.finish(); }
      expect(db.isTransaction).toBe(true); expect(db.prepare('SELECT length(value) AS n FROM source').get()!.n).toBe(sqliteDriverLimits.valueBytes + 1); db.exec('ROLLBACK');
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  });
});
