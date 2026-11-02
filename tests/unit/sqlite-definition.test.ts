import { expect, it } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';

/** |为真实UTF16光标，«»包住独立预期声明；去标记后不改SQL或把名称当字符串搜索答案。 */
function input(marked: string) {
  let source = '', offset = -1, start = -1, end = -1;
  for (const unit of marked.split('')) { if (unit === '|') offset = source.length; else if (unit === '«') start = source.length; else if (unit === '»') end = source.length; else source += unit; }
  expect(offset).toBeGreaterThanOrEqual(0); return { source, offset, start, end };
}
it.each([
  'SELECT |s.id FROM subject AS «s»',
  'SELECT s|.id FROM subject «s»',
  'SELECT "s|🚢".id FROM subject AS «"s🚢"»',
  'SELECT [名|字].id FROM subject «[名字]»',
  'SELECT `a|``b`.id FROM subject AS «`a``b`»',
  'SELECT sub|ject.id FROM «subject»',
  'SELECT main.sub|ject.id FROM main.«subject»',
  'SELECT temp.sub|ject.id FROM main.subject, temp.«subject»',
  'WITH «c»(id) AS (SELECT 1) SELECT * FROM |c',
  'WITH «c» AS (SELECT 1 AS id) SELECT |c.id FROM c',
  'WITH c AS (SELECT 1 AS id) SELECT |x.id FROM c AS «x»',
  'SELECT |d.id FROM (SELECT * FROM subject) AS «d»',
  'SELECT 1 FROM outer_table AS «o» WHERE EXISTS(SELECT |o.id FROM inner_table i)',
  'SELECT 1 FROM outer_table AS s WHERE EXISTS(SELECT |s.id FROM inner_table AS «s»)',
  'WITH c AS (SELECT 1) SELECT * FROM c WHERE EXISTS(WITH «c» AS (SELECT 2) SELECT * FROM |c)',
  'WITH RECURSIVE «c»(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM |c WHERE n<5) SELECT * FROM c',
  'SELECT |s.id FROM subject AS «s» UNION ALL SELECT s.id FROM second s',
  'SELECT s.id FROM subject s UNION ALL SELECT |s.id FROM second AS «s»',
  'SELECT old.id FROM subject old; SELECT |s.id FROM second AS «s»;',
  'UPDATE subject AS «s» SET id=|s.id+1',
  'DELETE FROM subject AS «s» WHERE |s.id=1',
])('本文绑定跳到准确声明：%s', marked => {
  const f = input(marked), result = analyzeSqliteCompletion(f.source, f.offset, 'definition');
  expect(result.status).toBe('ready'); expect(validateSqliteCompletionAnalysis(result, f.source, f.offset, 'definition')).toEqual(result);
  if (result.status !== 'ready') throw Error('声明分析失败：' + result.reason);
  expect(result.definition).toEqual({ start: f.start, end: f.end });
});
it.each([
  'SELECT s.|id FROM subject AS s', 'SELECT |id FROM subject', 'SELECT |subject.id FROM subject AS s',
  'SELECT |s.id FROM first s JOIN second s ON 1', 'SELECT |main.subject.id FROM main.subject',
  'SELECT 1 FROM |subject', 'SELECT 1 FROM main.|subject', 'WITH |c(n) AS (SELECT 1) SELECT * FROM c',
  'SELECT 1 AS |s FROM subject', 'SELECT "|s.id" FROM subject s', "SELECT '|s.id' FROM subject s", 'SELECT -- |s.id\n1 FROM subject s',
  'SELECT :|s FROM subject s', 'SELECT |COUNT(id) FROM subject', 'SELECT |s.f() FROM subject s', 'SELECT [|s.id FROM subject s',
  'SELECT s.id FROM subject s UNION ALL SELECT t.id FROM second t ORDER BY |s.id',
])('不把字段、外部对象、声明或不确定范围冒充本文定义：%s', marked => {
  const f = input(marked); expect(analyzeSqliteCompletion(f.source, f.offset, 'definition').status).toBe('blocked');
});
it('未指定意图与悬停不能接收声明范围，伪造出界/不同名称/附加字段均拒绝', () => {
  const f = input('SELECT |s.id FROM subject AS «s»'), result = analyzeSqliteCompletion(f.source, f.offset, 'definition');
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('缺少声明');
  for (const definition of [{ start: 0, end: 6 }, { start: -1, end: 2 }, { start: 0, end: f.source.length + 1 }, { start: f.source.indexOf('subject'), end: f.source.indexOf('subject') + 1 }, { start: f.offset, end: f.offset + 1 }, { ...result.definition, uri: 'command:run' }, undefined]) expect(() => validateSqliteCompletionAnalysis({ ...result, definition }, f.source, f.offset, 'definition')).toThrow();
  expect(() => validateSqliteCompletionAnalysis(result, f.source, f.offset)).toThrow();
  expect(() => validateSqliteCompletionAnalysis(result, f.source, f.offset, 'hover')).toThrow();
});
it('复合查询声明分支不放宽原补全或悬停，预算及坏Unicode继续拒绝', () => {
  const f = input('SELECT |s.id FROM subject AS «s» UNION SELECT t.id FROM second t');
  expect(analyzeSqliteCompletion(f.source, f.offset).status).toBe('blocked'); expect(analyzeSqliteCompletion(f.source, f.offset, 'hover').status).toBe('blocked');
  expect(analyzeSqliteCompletion('x'.repeat(262145), 0, 'definition').status).toBe('blocked'); expect(analyzeSqliteCompletion('SELECT \ud800', 7, 'definition').status).toBe('blocked');
});
