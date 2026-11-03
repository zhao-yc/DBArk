import { afterEach, describe, expect, it, vi } from 'vitest';
import { MySQL } from 'dt-sql-parser/dist/parser/mysql/index';
import { analyzeMysqlPhysicalObject } from '../../src/shared/mysqlPhysicalObject';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { validPhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
import type { CompletionLexicalMode } from '../../src/shared/completionLexical';

const capabilities = { lateralDerivedTables: true, windowFunctions: true, insertRowAliases: true };
/** 标记只描述输入位置与物理表的原token范围，断言不依赖字符串拆点号。 */
function input(marked: string) {
  let source = '', offset = -1, start = -1, end = -1;
  for (const unit of marked.split('')) { if (unit === '|') offset = source.length; else if (unit === '«') start = source.length; else if (unit === '»') end = source.length; else source += unit; }
  return { source, offset, start, end };
}
/** 使用实际生产解析器，不提供数据库、目录或预先准备的binding替身。 */
function analyze(marked: string, dialect: 'mysql' | 'sqlite', table: string, database?: string, mode: CompletionLexicalMode = {}) {
  const value = input(marked), result = dialect === 'mysql' ? analyzeMysqlPhysicalObject(value.source, value.offset, mode, capabilities) : analyzeSqlitePhysicalObject(value.source, value.offset);
  expect(result).toMatchObject({ status: 'ready', object: { table, tableRange: { start: value.start, end: value.end }, ...(database ? { database } : {}) } });
  expect(validPhysicalObjectAnalysis(result, value.source, value.offset, dialect, mode)).toBe(true);
  if (result.status !== 'ready') throw Error('物理对象分析失败');
  expect(value.source.slice(result.target.start, result.target.end).length).toBeGreaterThan(0);
  if (!database) { expect(result.object).not.toHaveProperty('database'); expect(result.object).not.toHaveProperty('databaseRange'); }
  return { ...value, result };
}

afterEach(() => vi.restoreAllMocks());
describe('MySQL完整AST物理关系角色', () => {
  it.each([
    ['SELECT * FROM «sub|ject»', 'subject', undefined],
    ['SELECT 1 FROM db.«sub|ject»', 'subject', 'db'],
    ['SELECT 1 FROM first_table a JOIN «oth|er_table» b ON a.id=b.id', 'other_table', undefined],
    ['SELECT |s.id FROM db.«subject» AS s', 'subject', 'db'],
    ['SELECT s|.* FROM «subject» s', 'subject', undefined],
    ['SELECT db.sub|ject.id FROM db.«subject»', 'subject', 'db'],
    ['SELECT db2.sub|ject.id FROM db1.subject,db2.«subject»', 'subject', 'db2'],
    ['SELECT 1 FROM «subject» AS |s', 'subject', undefined],
    ['SELECT |s.id FROM db.«subject» AS \'s\'', 'subject', 'db'],
    ['SELECT `s.x|`.id FROM `db.x`.«`table.x`» AS `s.x`', 'table.x', 'db.x'],
    ['SELECT |x.id FROM «first_table» x UNION ALL SELECT x.id FROM second_table x', 'first_table', undefined],
    ['SELECT x.id FROM first_table x UNION ALL SELECT |x.id FROM «second_table» x', 'second_table', undefined],
    ['SELECT (SELECT |x.id FROM «child» x) FROM parent x', 'child', undefined],
    ['SELECT (SELECT |x.id FROM child y) FROM «parent» x', 'parent', undefined],
    ['WITH q AS (SELECT * FROM «sub|ject») SELECT * FROM q', 'subject', undefined],
    ['WITH q AS (SELECT 1) SELECT * FROM db.«q|»', 'q', 'db'],
    ['UPDATE «sub|ject» SET id=1', 'subject', undefined],
    ['UPDATE «subject» AS s SET id=|s.id+1', 'subject', undefined],
    ['INSERT INTO db.«sub|ject»(id) VALUES(1)', 'subject', 'db'],
    ['DELETE FROM db.«sub|ject» WHERE id=1', 'subject', 'db'],
    ['DELETE FROM «subject» AS s WHERE |s.id=1', 'subject', undefined],
    ['DELETE s FROM db.«subject» s WHERE |s.id=1', 'subject', 'db'],
    ['SELECT * FROM other_table; SELECT |s.id FROM «subject» s', 'subject', undefined],
  ])('完整来源及范围：%s', (marked, table, database) => { analyze(marked!, 'mysql', table!, database); });

  it('ANSI_QUOTES与反斜线模式沿原词法；名称内点号保持一个token', () => {
    analyze('SELECT "s|".id FROM "db.x".«"subject.x"» AS "s"', 'mysql', 'subject.x', 'db.x', { ansiQuotes: true, noBackslashEscapes: true });
    const alias = 'a'.repeat(200); analyze(`SELECT ${alias}|.id FROM «subject» AS ${alias}`, 'mysql', 'subject');
  });
  it.each([
    'SELECT s.i|d FROM subject s', 'SELECT |subject FROM subject', 'SELECT |db.subject.id FROM db.subject',
    'SELECT 1 FROM |db.subject', 'SELECT |s.f() FROM subject s', 'SELECT @|s.id FROM subject s',
    "SELECT '|s.id' FROM subject s", 'SELECT 1 -- |s.id\nFROM subject s',
    'SELECT |s.id FROM first_table s JOIN second_table s ON 1=1',
    'SELECT |subject.id FROM db1.subject JOIN db2.subject ON 1=1',
    'SELECT |subject.id FROM subject AS s', 'SELECT |s.id FROM subject S',
    'WITH q AS (SELECT 1 AS id) SELECT * FROM |q',
    'WITH q AS (SELECT 1 AS id) SELECT |s.id FROM q s',
    'WITH q AS (SELECT * FROM r|),r AS (SELECT 1) SELECT * FROM q',
    'WITH q AS (SELECT * FROM q|) SELECT * FROM q',
    'SELECT |s.id FROM (SELECT 1 AS id) s', 'SELECT * FROM (SELECT |s.id) x,subject s',
    'SELECT s.id FROM subject s UNION ALL SELECT |s.id FROM other_table x',
    'SELECT |s.id FROM subject s WHERE (', 'SELECT FROM sub|ject',
    'SELECT |s.id FROM subject s /*', 'SELECT |s.id FROM subject s WHERE x=\'unclosed',
    'DELETE |s FROM db.subject s WHERE id=1', 'CREATE TABLE sub|ject(id int)',
  ])('不猜测非物理目标或非法语法：%s', marked => { const value = input(marked); expect(analyzeMysqlPhysicalObject(value.source, value.offset, {}, capabilities).status).toBe('blocked'); });

  it('仅走完整AST和语法校验，不生成补全候选', () => {
    const suggestions = vi.spyOn(MySQL.prototype, 'getSuggestionAtCaretPosition').mockImplementation(() => { throw Error('对象身份不能请求补全候选'); });
    const validate = vi.spyOn(MySQL.prototype, 'validate');
    analyze('SELECT |s.id FROM «subject» s', 'mysql', 'subject');
    expect(suggestions).not.toHaveBeenCalled(); expect(validate).toHaveBeenCalled();
  });
});

describe('SQLite既有结构解析的物理binding', () => {
  it.each([
    ['SELECT 1 FROM «sub|ject»', 'subject', undefined],
    ['SELECT |s.id FROM main.«subject» AS s', 'subject', 'main'],
    ['SELECT main.sub|ject.id FROM main.«subject»', 'subject', 'main'],
    ['SELECT temp.sub|ject.id FROM main.subject,temp.«subject»', 'subject', 'temp'],
    ['SELECT 1 FROM «subject» AS |s', 'subject', undefined],
    ['SELECT [s.x|].id FROM MAIN.«[table.x]» [s.x]', 'table.x', 'MAIN'],
    ['SELECT "s|🚢".id FROM «"subject🚢"» "s🚢"', 'subject🚢', undefined],
    ['SELECT |x.id FROM «first_table» x UNION ALL SELECT x.id FROM second_table x', 'first_table', undefined],
    ['SELECT x.id FROM first_table x UNION ALL SELECT |x.id FROM «second_table» x', 'second_table', undefined],
    ['SELECT (SELECT |x.id FROM «child» x) FROM parent x', 'child', undefined],
    ['SELECT (SELECT |x.id FROM child y) FROM «parent» x', 'parent', undefined],
    ['WITH q AS (SELECT * FROM «sub|ject») SELECT * FROM q', 'subject', undefined],
    ['WITH q AS (SELECT 1) SELECT * FROM main.«q|»', 'q', 'main'],
    ['UPDATE «sub|ject» SET id=1', 'subject', undefined],
    ['UPDATE «subject» AS s SET id=|s.id+1', 'subject', undefined],
    ['INSERT INTO temp.«sub|ject»(id) VALUES(1)', 'subject', 'temp'],
    ['DELETE FROM temp.«sub|ject» WHERE id=1', 'subject', 'temp'],
    ['DELETE FROM «subject» AS s WHERE |s.id=1', 'subject', undefined],
  ])('只返回实际表词与可见来源：%s', (marked, table, database) => { analyze(marked!, 'sqlite', table!, database); });

  it.each([
    'SELECT s.i|d FROM subject s', 'SELECT |subject FROM subject', 'SELECT |main.subject.id FROM main.subject',
    'SELECT 1 FROM |main.subject', 'SELECT |s.f() FROM subject s', 'SELECT :|s FROM subject s',
    "SELECT '|s.id' FROM subject s", 'SELECT 1 --|s.id\nFROM subject s',
    'SELECT |s.id FROM first_table s JOIN second_table s ON 1', 'SELECT |subject.id FROM subject s',
    'WITH q AS (SELECT 1 AS id) SELECT * FROM |q', 'WITH q AS (SELECT 1 AS id) SELECT |s.id FROM q s',
    'SELECT |s.id FROM (SELECT 1 AS id) s', 'SELECT * FROM (SELECT |s.id) x,subject s',
    'SELECT s.id FROM subject s UNION ALL SELECT |s.id FROM other_table x',
    'SELECT |s.id FROM subject s WHERE (', 'SELECT |s.id FROM subject s /*',
    'SELECT |s.id FROM subject s WHERE id=\'unclosed', 'SELECT * FROM attached.sub|ject',
    'SELECT * FROM json_each(1) AS |s', 'CREATE TABLE sub|ject(id int)',
  ])('拒绝局部关系、未闭合及未支持结构：%s', marked => { const value = input(marked); expect(analyzeSqlitePhysicalObject(value.source, value.offset).status).toBe('blocked'); });
});

it.each(['mysql', 'sqlite'] as const)('%s回包严格限制原token、同语句、名称和附加字段', dialect => {
  const f = analyze('SELECT |s.id FROM db.«subject» s; SELECT * FROM other_table'.replace('db.', dialect === 'sqlite' ? 'main.' : 'db.'), dialect, 'subject', dialect === 'sqlite' ? 'main' : 'db');
  const object = f.result.object;
  for (const malicious of [
    { ...f.result, uri: 'command:run' }, { ...f.result, sql: 'DROP TABLE x' },
    { ...f.result, target: { ...f.result.target, uri: 'file:///x' } },
    { ...f.result, object: { ...object, table: 'other_table' } },
    { ...f.result, object: { ...object, tableRange: { start: object.tableRange.start + 1, end: object.tableRange.end } } },
    { ...f.result, object: { ...object, tableRange: { start: f.source.lastIndexOf('other_table'), end: f.source.length } } },
    { ...f.result, object: { ...object, databaseRange: undefined } },
    { ...f.result, object: { ...object, database: 'fake' } },
    { ...f.result, object: { ...object, source: f.source } },
    { status: 'blocked', reason: 'command:run' }, { status: 'blocked', reason: 'syntax', uri: 'file:///x' },
  ]) expect(validPhysicalObjectAnalysis(malicious, f.source, f.offset, dialect)).toBe(false);
});
