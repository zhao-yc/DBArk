import { describe, expect, it } from 'vitest';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';
import { validLocalReferences } from '../../src/shared/localReferences';
import { completionLimits } from '../../src/shared/sqlCompletion';
import type { CompletionLexicalMode } from '../../src/shared/completionLexical';

const capabilities = { lateralDerivedTables: true, windowFunctions: true, insertRowAliases: true };
/** 节号仅标本例声明，竖线仅标其引用；逐个真实位置调用生产语义，不以全文计数替代作用域。 */
function check(marked: string, mode: CompletionLexicalMode = {}) {
  const ranges: { start: number; end: number }[] = []; let source = '', declaration = -1;
  for (let index = 0; index < marked.length; index++) {
    if (marked[index] === '§') { declaration = source.length; continue; }
    if (marked[index] === '|') { const word = /^(?:`(?:``|[^`])+`|"(?:""|[^"])+"|[\w$]+)/.exec(marked.slice(index + 1))?.[0]; if (!word) throw Error('缺少标记词'); ranges.push({ start: source.length, end: source.length + word.length }); continue; }
    source += marked[index];
  }
  const declarationWord = /^(?:`(?:``|[^`])+`|"(?:""|[^"])+"|[\w$]+)/.exec(source.slice(declaration))![0];
  for (const offset of [declaration + 1, ...ranges.map(item => item.start + 1)]) {
    const result = analyzeLocalReferences(source, offset, mode, capabilities);
    expect(result).toMatchObject({ status: 'ready', declaration: { start: declaration, end: declaration + declarationWord.length }, references: ranges });
    expect(validLocalReferences(result, source, offset, mode)).toBe(true);
  }
}

describe('本文关系引用的语义范围', () => {
  it.each([
    'SELECT |s.id, |s.name FROM subject AS §s WHERE |s.id>1 ORDER BY |s.name',
    'SELECT |d.n FROM (SELECT 1 n) AS §d WHERE |d.n=1',
    'WITH §q AS (SELECT 1 n) SELECT |q.n FROM |q',
    'WITH §q AS (SELECT 1 n), r AS (SELECT * FROM |q) SELECT |q.n FROM |q JOIN r ON 1=1',
    'WITH RECURSIVE §q(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM |q WHERE n<3) SELECT |q.n FROM |q',
    'SELECT |s.id, (SELECT |s.id FROM child c) FROM parent §s',
    'SELECT |s.id, (SELECT s.id FROM child s) FROM parent §s',
    'SELECT s.id, (SELECT |s.id FROM child §s) FROM parent s',
    'SELECT |s.id FROM first_table §s UNION ALL SELECT s.id FROM second_table s',
    'SELECT s.id FROM first_table s UNION ALL SELECT |s.id FROM second_table §s',
    'SELECT |subject.id FROM §subject WHERE |subject.id=1',
    'SELECT db1.|subject.id FROM db1.§subject JOIN db2.subject ON db1.|subject.id=db2.subject.id',
    'SELECT |`s.x``y`.id FROM subject AS §`s.x``y` WHERE |`s.x``y`.id=1',
    "SELECT '|s.id', 1 /* s.id */ FROM subject §s WHERE |s.id=1".replace("'|s.id'", "'s.id'"),
    'SELECT s.id FROM other s; SELECT |s.id FROM subject §s WHERE |s.id=1',
    'WITH q AS (SELECT 1 n) SELECT |a.n FROM q AS §a WHERE |a.n=1',
    'WITH §q AS (SELECT 1 n) SELECT a.n FROM |q AS a',
    'WITH q AS (SELECT 1 n) SELECT |q.n FROM q AS §q',
  ])('%s', marked => check(marked));
  it('ANSI_QUOTES按实际会话模式保留引用范围', () => check('SELECT |"s".id FROM subject §"s" WHERE |"s".id=1', { ansiQuotes: true, noBackslashEscapes: true }));
  it('长别名与光标词中间均使用完整词', () => { const alias = 'a'.repeat(200); check(`SELECT |${alias}.id FROM subject §${alias}`); });
  it.each([
    ['SELECT s.id FROM subject S', 8], ['SELECT s.id FROM first_table s JOIN second_table s ON 1=1', 8],
    ["SELECT 's.id' FROM subject s", 9], ['SELECT 1 -- s.id\nFROM subject s', 14],
    ['SELECT s.f() FROM subject s', 8], ['SELECT subject FROM subject', 8],
    ['SELECT 1 FROM subject s', 22], ['SELECT @@s.id FROM subject s', 10],
    ['SELECT s.id FROM subject s WHERE (', 8], ['SELECT s.id FROM subject s /*! WHERE s.id=1 */', 8],
  ])('不能确认局部绑定时不提供文本匹配：%s', (source, offset) => expect(analyzeLocalReferences(source, offset, {}, capabilities).status).toBe('blocked'));
  it('超过完整候选预算整份拒绝，无截断列表', () => {
    const source = 'SELECT ' + Array.from({ length: completionLimits.entries }, () => 's.id').join(',') + ' FROM subject s';
    expect(analyzeLocalReferences(source, 8, {}, capabilities)).toEqual({ status: 'blocked', reason: 'budget' });
  });
  it('Worker结果拒绝跨词、跨语句、重复、无序、外部URI和未声明扩展字段', () => {
    const source = 'SELECT s.id FROM subject s WHERE s.id=1; SELECT s.id FROM other s', result = analyzeLocalReferences(source, 8, {}, capabilities);
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('缺少结果');
    for (const changed of [
      { ...result, uri: 'file:///other' }, { ...result, target: { start: 7, end: 9 } },
      { ...result, references: [...result.references].reverse() }, { ...result, references: [result.references[0], result.references[0]] },
      { ...result, references: [{ start: source.lastIndexOf('s.id'), end: source.lastIndexOf('s.id') + 1 }] },
      { ...result, declaration: { ...result.declaration, sql: 'hidden' } }, { ...result, references: [] },
    ]) expect(validLocalReferences(changed, source, 8, {})).toBe(false);
    expect(validLocalReferences({ status: 'blocked', reason: 'timeout' }, source, 8, {})).toBe(true);
    expect(validLocalReferences({ status: 'blocked', reason: 'timeout', sql: source }, source, 8, {})).toBe(false);
  });
});
