import { expect, it } from 'vitest';
import { analyzeSqliteLocalReferences, validSqliteLocalReferences } from '../../src/shared/sqliteLocalReferences';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';
import { sqliteReferenceContext } from '../../src/shared/sqliteCompletionAnalysis';

/** 独立标记准确声明和引用完整范围；保留UTF16坐标，包括非BMP和各种SQLite引用形式。 */
function marked(text: string) {
  let source = '', declaration: { start: number; end: number } | undefined, open: { marker: string; start: number } | undefined;
  const references: { start: number; end: number }[] = [];
  for (const character of text) {
    if (character === '«' || character === '‹') { if (open) throw Error('标记嵌套'); open = { marker: character, start: source.length }; }
    else if (character === '»' || character === '›') { if (!open || (open.marker === '«') !== (character === '»')) throw Error('标记不配对'); const range = { start: open.start, end: source.length }; if (character === '»') declaration = range; else references.push(range); open = undefined; }
    else source += character;
  }
  if (open || !declaration) throw Error('声明标记缺失'); return { source, declaration, references };
}
it.each([
  'SELECT ‹s›.id, ‹s›.name FROM subject AS «s» WHERE ‹s›.id=1',
  'SELECT ‹s›.id FROM subject AS «S» WHERE ‹S›.id=1',
  'SELECT ‹[s]›.id FROM subject AS «"S"» WHERE ‹`s`›.id=1',
  'SELECT ‹"s🚢"›.id FROM subject AS «"S🚢"» WHERE ‹[s🚢]›.id=1',
  'SELECT ‹"a""b"›.id FROM subject AS «`a"b`» WHERE ‹[A"b]›.id=1',
  'SELECT ‹subject›.id FROM «subject» WHERE ‹subject›.id=1',
  'SELECT main.‹subject›.id FROM main.«subject» JOIN temp.subject ON main.‹subject›.id=temp.subject.id',
  'WITH «q» AS (SELECT 1 n) SELECT ‹q›.n FROM ‹q›',
  'WITH «Q»(n) AS (SELECT 1) SELECT ‹q›.n FROM ‹Q›',
  'WITH RECURSIVE «q»(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ‹q› WHERE n<3) SELECT ‹q›.n FROM ‹q›',
  'WITH «q» AS (SELECT 1 n), r AS (SELECT n FROM ‹q›) SELECT ‹q›.n FROM ‹q› JOIN r ON 1',
  'WITH q AS (SELECT 1 n) SELECT ‹a›.n FROM q AS «a» WHERE ‹a›.n=1',
  'WITH «q» AS (SELECT 1 n) SELECT a.n FROM ‹q› AS a',
  'WITH q AS (SELECT 1 n) SELECT ‹q›.n FROM q AS «q»',
  'SELECT ‹d›.n FROM (SELECT 1 n) AS «d» WHERE ‹d›.n=1',
  'SELECT ‹s›.id, (SELECT ‹s›.id FROM child c) FROM parent «s»',
  'SELECT ‹s›.id, (SELECT s.id FROM child s) FROM parent «s» WHERE ‹s›.id=1',
  'SELECT s.id, (SELECT ‹s›.id FROM child «s») FROM parent s',
  'WITH q(n) AS (SELECT 1) SELECT * FROM q WHERE EXISTS(WITH «q»(n) AS (SELECT 2) SELECT ‹q›.n FROM ‹q›)',
  'SELECT ‹s›.id FROM first_table «s» UNION ALL SELECT s.id FROM second_table s',
  'SELECT s.id FROM first_table s UNION ALL SELECT ‹s›.id FROM second_table «s»',
  'SELECT s.id FROM first_table s; SELECT ‹s›.id FROM subject «s» WHERE ‹s›.id=1',
  'UPDATE subject AS «s» SET id=‹s›.id+1 WHERE ‹s›.id=1',
  'DELETE FROM subject AS «s» WHERE ‹s›.id=1',
  "SELECT 's.id', 1 /* s.id */ FROM subject «s» WHERE ‹s›.id=1",
  'SELECT 1 --s.id\nFROM subject «s» WHERE ‹s›.id=1',
])('SQLite准确引用及声明：%s', text => {
  const input = marked(text);
  for (const target of [input.declaration, ...input.references]) {
    const result = analyzeSqliteLocalReferences(input.source, target.start);
    expect(result).toEqual({ status: 'ready', target, declaration: input.declaration, references: input.references });
    expect(validSqliteLocalReferences(result, input.source, target.start)).toBe(true);
  }
});
it('名称保留512 UTF16预算，不借MySQL 256或前缀限制截断', () => {
  const name = '长'.repeat(300), input = marked(`SELECT ‹"${name}"›.id FROM subject «"${name}"»`);
  expect(analyzeSqliteLocalReferences(input.source, input.references[0].start)).toMatchObject({ status: 'ready', declaration: input.declaration });
});
it('只折叠ASCII，不把非ASCII大小写或相似显示字符合并', () => {
  const input = marked('SELECT ‹"Ä"›.id, "ä".id FROM first_table AS «"Ä"» JOIN second_table AS "ä" ON 1');
  expect(analyzeSqliteLocalReferences(input.source, input.references[0].start)).toEqual({ status: 'ready', target: input.references[0], declaration: input.declaration, references: input.references });
});
it.each([
  ['SELECT s.id FROM subject S JOIN other s ON 1', 7], ['SELECT s.f() FROM subject s', 7],
  ['SELECT id FROM subject', 7], ['SELECT 1 FROM subject s', 22], ['SELECT s.id FROM subject AS x', 7],
  ["SELECT 's.id' FROM subject s", 9], ['SELECT --s.id\n1 FROM subject s', 10], ['SELECT :s FROM subject s', 8],
  ['SELECT [s.id FROM subject s', 8], ['SELECT main.subject.id FROM main.subject', 7],
  ['SELECT s.id FROM subject s UNION SELECT t.id FROM other t ORDER BY s.id', 63],
  ['CREATE TRIGGER x AFTER INSERT ON subject BEGIN SELECT s.id FROM subject s; END', 53],
])('无法确认绑定时不回退文本匹配：%s', (source, offset) => expect(analyzeSqliteLocalReferences(source, offset).status).toBe('blocked'));
it('位置、Unicode、来源、深度和候选超预算整份阻断', () => {
  for (const [source, offset] of [['SELECT \ud800', 7], ['SELECT "🚢".id FROM subject "🚢"', 9], ['SELECT s.id FROM subject s', -1], ['x'.repeat(262145), 0], ['SELECT ' + '('.repeat(65) + 's.id', 72]] as const) expect(analyzeSqliteLocalReferences(source, offset).status).toBe('blocked');
  const source = 'SELECT ' + Array.from({ length: 256 }, () => 's.id').join(',') + ' FROM subject s';
  expect(analyzeSqliteLocalReferences(source, 7)).toEqual({ status: 'blocked', reason: 'budget' });
});
it('SQLite原生语句边界保留trigger保护，不把DELIMITER当客户端指令', () => {
  expect(sqliteReferenceContext('CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END', 8).status).toBe('blocked');
  const input = marked('SELECT s.id FROM other s; SELECT ‹s›.id FROM subject «s»');
  expect(sqliteReferenceContext(input.source, input.references[0].start)).toMatchObject({ status: 'ready' });
  expect(analyzeSqliteLocalReferences('DELIMITER $$\nSELECT s.id FROM subject s', 20).status).toBe('blocked');
});
it('回包拒绝伪造范围、跨句、乱序、重复、外部URI、原文及非ASCII折叠', () => {
  const input = marked('SELECT ‹[s]›.id FROM subject AS «"S"» WHERE ‹s›.id=1; SELECT s.id FROM other s'), offset = input.references[0].start;
  const result = analyzeSqliteLocalReferences(input.source, offset); expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('缺少结果');
  for (const forged of [
    { ...result, uri: 'command:run' }, { ...result, sql: input.source }, { ...result, references: [] }, { ...result, references: [...result.references].reverse() },
    { ...result, target: { start: offset + 1, end: offset + 2 } }, { ...result, references: [input.references[0], input.references[0]] },
    { ...result, declaration: { ...result.declaration, value: 'S' } },
    { ...result, references: [{ start: input.source.lastIndexOf('s.id'), end: input.source.lastIndexOf('s.id') + 1 }] },
  ]) expect(validSqliteLocalReferences(forged, input.source, offset)).toBe(false);
  expect(validSqliteLocalReferences({ status: 'blocked', reason: 'timeout', sql: input.source }, input.source, offset)).toBe(false);
});
it('共享索引不放宽MySQL名称大小写及引号规则', () => {
  expect(analyzeLocalReferences('SELECT s.id FROM subject S', 7).status).toBe('blocked');
  expect(analyzeLocalReferences('SELECT [s].id FROM subject s', 8).status).toBe('blocked');
});
