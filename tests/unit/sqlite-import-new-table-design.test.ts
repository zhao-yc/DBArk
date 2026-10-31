import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildSqliteImportNewTableDesign, sqliteImportNewTableDesignMessages, type SqliteImportNewTableDesignInput } from '../../src/renderer/sqliteImportNewTableDesign';
import { buildSqliteTableCreate, sqliteTableCreateDesignSchema } from '../../src/shared/sqliteTableCreate';
import { buildSqliteTableImportPlan, sqliteTableImportAffinity, type SqliteTableImportColumn } from '../../src/shared/sqliteTableImport';
import type { DataRow } from '../../src/shared/contracts';
import type { SqliteValue } from '../../src/engine/sqlite/protocol';

/** 真实Node SQLite只打开本例内存库，验证安全设计生成器与原typed绑定，不借产品IPC或用户配置。 */
function database(run: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { run(db); } finally { db.close(); } }
function parameter(value: SqliteValue): SQLInputValue { if (value === null || typeof value === 'string') return value; if (value.type === 'integer') return BigInt(value.value); if (value.type === 'real') return Number(value.value); return Buffer.from(value.base64, 'base64'); }
function input(patch: Partial<SqliteImportNewTableDesignInput> = {}): SqliteImportNewTableDesignInput { return { name: '导入"表🚢', sourceColumns: ['数字', '日期'], selectedSources: ['数字', '日期'], ...patch }; }

describe('SQLite导入新表的人工选择与精确TEXT设计', () => {
  it('只生成明确选中字段的完整可编辑设计与映射，不猜主键/数值/日期，不修改原输入', () => {
    const value = input({ sourceColumns: ['数字', '日期', '未选列'], selectedSources: ['日期', '数字'], sample: [{ 数字: '18446744073709551615', 日期: '2026-11-01', 未选列: '原值' }] }), original = structuredClone(value), result = buildSqliteImportNewTableDesign(value);
    expect(result.design).toEqual({ name: value.name, columns: [{ name: '日期', declaredType: 'TEXT', nullable: true, default: { kind: 'none' } }, { name: '数字', declaredType: 'TEXT', nullable: true, default: { kind: 'none' } }], primaryKey: [], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false });
    expect(result.mapping).toEqual([{ source: '日期', target: '日期', kind: 'text' }, { source: '数字', target: '数字', kind: 'text' }]); expect(result.warnings).toEqual([sqliteImportNewTableDesignMessages.text]); expect(sqliteTableCreateDesignSchema.parse(result.design)).toEqual(result.design); expect(value).toEqual(original);
    result.design.columns[0].name = '只改设计'; result.mapping[1].source = '只改映射'; expect(value).toEqual(original);
  });

  it('JSON空键/NUL/控制名使用稳定fallback，quoted/emoji原名保留，source身份不变', () => {
    const sourceColumns = ['', '坏\0键', '坏\n键', '\u0080', '  ', '正常"列🚢', '__proto__', 'constructor'], result = buildSqliteImportNewTableDesign(input({ sourceColumns, selectedSources: sourceColumns }));
    expect(result.design.columns.map(column => column.name)).toEqual(['字段1', '字段2', '字段3', '字段4', '字段5', '正常"列🚢', '__proto__', 'constructor']); expect(result.mapping.map(item => item.source)).toEqual(sourceColumns);
    expect(buildSqliteImportNewTableDesign(input({ sourceColumns, selectedSources: sourceColumns }))).toEqual(result);
    database(db => { for (const sql of buildSqliteTableCreate(result.design).sql) db.exec(sql); expect(db.prepare('SELECT name FROM pragma_table_xinfo(?) ORDER BY cid').all(result.design.name).map(row => row.name)).toEqual(result.mapping.map(item => item.target)); });
  });

  it('仅ASCII大小写碰撞去重，Unicode不同名保留，后缀裁剪不截代理对', () => {
    const names = ['id', 'ID', 'iD', 'ä', 'Ä', '字段6', '\0'], result = buildSqliteImportNewTableDesign(input({ sourceColumns: names, selectedSources: names }));
    expect(result.design.columns.map(column => column.name)).toEqual(['id', 'ID_2', 'iD_3', 'ä', 'Ä', '字段6', '字段7']);
    const upper = 'A'.repeat(255), lower = 'a'.repeat(255), long = buildSqliteImportNewTableDesign(input({ sourceColumns: [upper, lower], selectedSources: [upper, lower] })); expect(long.design.columns[1].name).toBe('a'.repeat(253) + '_2');
    const emoji = '🚢'.repeat(128), fallback = buildSqliteImportNewTableDesign(input({ sourceColumns: [emoji], selectedSources: [emoji] })); expect(fallback.design.columns[0].name).toBe(emoji);
    expect(() => buildSqliteImportNewTableDesign(input({ sourceColumns: ['x'.repeat(256)], selectedSources: ['x'.repeat(256)] }))).not.toThrow();
  });

  it('完整1000列目录可人工只选子集；129列必须返回错误而非静默截断', () => {
    const sourceColumns = Array.from({ length: 1000 }, (_, index) => '源' + index), selectedSources = sourceColumns.slice(0, 128), result = buildSqliteImportNewTableDesign(input({ sourceColumns, selectedSources })); expect(result.design.columns).toHaveLength(128); expect(result.mapping.map(item => item.source)).toEqual(selectedSources);
    const chosen = buildSqliteImportNewTableDesign(input({ sourceColumns, selectedSources: ['源999', '源4'] })); expect(chosen.mapping.map(item => item.source)).toEqual(['源999', '源4']);
    for (const values of [[], sourceColumns.slice(0, 129), ['不存在'], ['源0', '源0']]) expect(() => buildSqliteImportNewTableDesign(input({ sourceColumns, selectedSources: values }))).toThrow();
    expect(() => buildSqliteImportNewTableDesign(input({ sourceColumns: [...sourceColumns, '源1000'], selectedSources: ['源0'] }))).toThrow();
  });

  it('binary样本仅警示，不靠样本推断BLOB或把二进制对象改成字符串', () => {
    const sample: DataRow[] = [{ 数字: { type: 'binary', base64: 'AAH/' }, 日期: null }], result = buildSqliteImportNewTableDesign(input({ sample }));
    expect(result.design.columns.every(column => column.declaredType === 'TEXT')).toBe(true); expect(result.mapping.every(item => item.kind === 'text')).toBe(true); expect(result.warnings).toEqual([sqliteImportNewTableDesignMessages.text, sqliteImportNewTableDesignMessages.binary]); expect(sample[0].数字).toEqual({ type: 'binary', base64: 'AAH/' });
    expect(buildSqliteImportNewTableDesign(input({ sample, selectedSources: ['日期'] })).warnings).toEqual([sqliteImportNewTableDesignMessages.text]);
  });

  it('先拒getter/稀疏/超额选中字段及未知键，样本不含原目录外字段', () => {
    const getter = vi.fn(() => '原值'), selected = Array.from({ length: 129 }, (_, index) => '列' + index); Object.defineProperty(selected, '0', { enumerable: true, get: getter }); expect(() => buildSqliteImportNewTableDesign(input({ selectedSources: selected }))).toThrow(); expect(getter).not.toHaveBeenCalled();
    const accessor = Object.defineProperty(input(), 'sourceColumns', { enumerable: true, get: getter }); expect(() => buildSqliteImportNewTableDesign(accessor)).toThrow();
    const row = Object.defineProperty({}, '数字', { enumerable: true, get: getter }); expect(() => buildSqliteImportNewTableDesign(input({ sample: [row] }))).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => buildSqliteImportNewTableDesign(input({ selectedSources: new Array(1) }))).toThrow(); expect(() => buildSqliteImportNewTableDesign(input({ sample: [{ 不在目录: '原值' }] }))).toThrow();
    expect(() => buildSqliteImportNewTableDesign({ ...input(), sql: 'CREATE TABLE x(a)' } as SqliteImportNewTableDesignInput)).toThrow(); expect(() => buildSqliteImportNewTableDesign(input({ name: 'sqlite_禁止' }))).toThrow();
  });

  it('真实建表并参数化导入后，大整数/精确小数/日期/NUL/引号/非BMP/注入串保持TEXT原值，NULL独立', () => {
    const names = ['大整数', '小数', '日期', '原文"🚢', '', '__proto__', '空串', 'NULL'], row: DataRow = Object.fromEntries([['大整数', '18446744073709551615'], ['小数', '0.10000000000000001'], ['日期', '2026-11-01T23:59:59'], ['原文"🚢', "原文'\0🚢; DROP TABLE control;--"], ['', '空键原值'], ['__proto__', '原型原值'], ['空串', ''], ['NULL', null]]), result = buildSqliteImportNewTableDesign(input({ sourceColumns: names, selectedSources: names, sample: [row] }));
    database(db => {
      db.exec("CREATE TABLE control(value TEXT); INSERT INTO control VALUES('原控制行')"); for (const sql of buildSqliteTableCreate(result.design).sql) db.exec(sql);
      const columns: SqliteTableImportColumn[] = result.design.columns.map(column => ({ name: column.name, declaredType: column.declaredType, nullable: column.nullable, hasDefault: false, generated: false, affinity: sqliteTableImportAffinity(column.declaredType) })), plan = buildSqliteTableImportPlan({ target: { connectionId: 'owned', database: 'main', table: result.design.name }, columns, sourceColumns: names, mapping: result.mapping, strict: false }), converted = plan.convertRow(row, 1);
      expect(converted.ok).toBe(true); if (!converted.ok) throw Error('本例TEXT设计必须允许原值'); db.prepare(plan.sql).run(...converted.parameters.map(parameter));
      const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"', stored = db.prepare('SELECT * FROM ' + quote(result.design.name)).get(); expect(stored).toEqual(Object.fromEntries(result.mapping.map(item => [item.target, row[item.source]])));
      const types = db.prepare('SELECT ' + result.mapping.map((item, index) => 'typeof(' + quote(item.target) + ') AS ' + quote('t' + index)).join(',') + ' FROM ' + quote(result.design.name)).get(); expect(types).toEqual(Object.fromEntries(result.mapping.map((item, index) => ['t' + index, row[item.source] === null ? 'null' : 'text'])));
      expect(db.prepare('SELECT value FROM control').all()).toEqual([{ value: '原控制行' }]); expect(db.prepare('SELECT count(*) AS rows FROM ' + quote(result.design.name)).get()?.rows).toBe(1);
    });
  });
});
