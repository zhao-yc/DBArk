import { describe, expect, it } from 'vitest';
import { analyzeCompletionDefinition } from '../../src/shared/completionDefinitionAnalysis';
import { analyzeCompletion } from '../../src/shared/completionAnalysis';
import { validCompletionDefinition } from '../../src/shared/completionDefinitionResult';
import type { CompletionLexicalMode } from '../../src/shared/completionLexical';

const capabilities = { lateralDerivedTables: true, windowFunctions: true, insertRowAliases: true };
/** 竖线标引用位置、节号标声明位置；两者均先从生产解析文本剔除。 */
function parse(marked: string, mode: CompletionLexicalMode = {}) {
  const caret = marked.indexOf('|'), declaration = marked.indexOf('§');
  const source = marked.replace('|', '').replace('§', ''), offset = caret - (declaration >= 0 && declaration < caret ? 1 : 0);
  return { source, offset, declaration: declaration - (caret < declaration ? 1 : 0), result: analyzeCompletionDefinition(source, offset, mode, capabilities) };
}
function definition(marked: string, word: string, mode: CompletionLexicalMode = {}) {
  const value = parse(marked, mode);
  expect(value.result).toMatchObject({ status: 'ready', definition: { start: value.declaration, end: value.declaration + word.length }, relations: [], localRelations: [], syntax: [] });
  expect(validCompletionDefinition(value.result, value.source, value.offset, mode)).toBe(true);
}

describe('MySQL与MariaDB本文声明范围', () => {
  it.each([
    ['SELECT |s.id FROM subject AS §s', 's'],
    ['SELECT s|.id FROM subject §s', 's'],
    ['SELECT lo|ng_name.id FROM subject AS §long_name', 'long_name'],
    ['SELECT `s.x|``y`.id FROM subject AS §`s.x``y`', '`s.x``y`'],
    ['SELECT subject|.id FROM §subject', 'subject'],
    ['SELECT db.subject|.id FROM db.§subject', 'subject'],
    ['SELECT db1.subject|.id FROM db1.§subject JOIN db2.subject ON 1=1', 'subject'],
    ['SELECT db2.subject|.id FROM db1.subject JOIN db2.§subject ON 1=1', 'subject'],
    ['SELECT |s.* FROM subject §s', 's'],
    ['SELECT 1 FROM subject §s WHERE |s.id=1', 's'],
    ['SELECT 1 FROM subject §s JOIN other_table o ON |s.id=o.id', 's'],
    ['SELECT |d.n FROM (SELECT 1 AS n) AS §d', 'd'],
    ['WITH §q AS (SELECT 1 AS n) SELECT n FROM q|', 'q'],
    ['WITH q AS (SELECT 1 AS n) SELECT |a.n FROM q AS §a', 'a'],
    ['WITH q AS (SELECT 1 AS n) SELECT |q.n FROM §q', 'q'],
    ['WITH §q AS (SELECT 1 AS n), r AS (SELECT n FROM q|) SELECT * FROM r', 'q'],
    ['WITH RECURSIVE §q(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM q| WHERE n<3) SELECT * FROM q', 'q'],
    ['SELECT |x.id FROM first_table §x UNION ALL SELECT x.id FROM second_table x', 'x'],
    ['SELECT x.id FROM first_table x UNION ALL SELECT |x.id FROM second_table §x', 'x'],
  ])('精确声明：%s', (source, word) => definition(source, word));

  it('关联内层遮蔽外层，合法祖先引用仍可见', () => {
    definition('SELECT (SELECT |x.id FROM child §x) FROM parent x', 'x');
    definition('SELECT (SELECT |x.id FROM child y) FROM parent §x', 'x');
  });
  it('当前语句的CTE不借其它语句的同名声明', () => {
    definition('WITH q AS (SELECT 1 AS n) SELECT * FROM q; WITH §q AS (SELECT 2 AS n) SELECT * FROM q|', 'q');
  });
  it('已确定ANSI_QUOTES才导航双引号标识符；别名完整预算沿原解析器', () => {
    definition('SELECT "s|".id FROM subject §"s"', '"s"', { ansiQuotes: true, noBackslashEscapes: true });
    const alias = 'a'.repeat(200); definition('SELECT ' + alias + '|.id FROM subject §' + alias, alias);
  });
  it.each([
    'SELECT s.i|d FROM subject s', 'SELECT |subject FROM subject', 'SELECT * FROM sub|ject',
    'SELECT |db.subject.id FROM db.subject', 'SELECT |s.f() FROM subject s',
    'SELECT 1 FROM |s.subject JOIN other_table s ON 1=1',
    "SELECT '|s.id' FROM subject s", 'SELECT 1 -- |s.id\nFROM subject s',
    'SELECT |s.id FROM first_table s JOIN second_table s ON 1=1',
    'SELECT |subject.id FROM db1.subject JOIN db2.subject ON 1=1',
    'SELECT |s.id FROM subject S', 'SELECT |subject.id FROM subject AS s',
    'WITH q AS (SELECT * FROM r|), r AS (SELECT 1 AS n) SELECT * FROM q',
    'WITH q AS (SELECT * FROM q|) SELECT * FROM q',
    'WITH q AS (SELECT 1), q AS (SELECT 2) SELECT * FROM q|',
    'WITH q AS (SELECT 1) SELECT * FROM db.q|',
    'SELECT * FROM (SELECT |s.id) AS d, subject s',
    'SELECT s.id FROM subject AS |s', 'SELECT "s|".id FROM subject s',
    'SELECT |s.id FROM subject s WHERE (', 'SELECT @|s.id FROM subject s',
    'SELECT s.id FROM subject s UNION ALL SELECT |s.id FROM other_table x',
    'WITH q AS (SELECT 1 AS n) SELECT (WITH q AS (SELECT 2 AS n) SELECT n FROM q|) FROM q',
  ])('歧义或非引用不猜测：%s', marked => expect(parse(marked).result.status).toBe('blocked'));
  it('普通补全结果不夹带导航范围', () => { const source = 'SELECT s.id FROM subject s'; expect(analyzeCompletion(source, 8)).not.toHaveProperty('definition'); });
  it('回包只能指向同一原文的同名完整词，不能注入URI、越界或不完整目标', () => {
    const value = parse('SELECT |s.id FROM subject AS §s');
    expect(value.result.status).toBe('ready');
    expect(validCompletionDefinition(value.result, value.source, value.offset, {})).toBe(true);
    for (const malicious of [
      { ...value.result, uri: 'command:danger' }, { ...value.result, definition: { start: -1, end: 1 } },
      { ...value.result, definition: { start: 9, end: 11 } }, { ...value.result, definition: { start: 7, end: 8 } },
      { ...value.result, definition: { start: value.declaration, end: value.declaration + 1, targetUri: 'file:///secret' } },
    ]) expect(validCompletionDefinition(malicious, value.source, value.offset, {})).toBe(false);
  });
});
