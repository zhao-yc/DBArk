import { describe, expect, it } from 'vitest';
import { explainNodeDetail } from '../../src/shared/explain';
import { parsePostgresExplain, postgresExplainSql } from '../../src/shared/postgresExplain';
import { validateCommand } from '../../src/shared/validation';

const options = { standardStrings: true, version: '18.1', format: 'auto' } as const;

describe('PostgreSQL估算计划', () => {
  it('专用命令接收光标偏移，原计划命令仍保持严格边界', () => {
    const input = { sessionId: '原会话', taskId: '计划任务', sql: 'SELECT 1;', maxRows: 1, currentStatement: { offset: 2 } };
    expect(validateCommand('postgres.explain', input)).toEqual(input);
    expect(() => validateCommand('postgres.explain', { ...input, currentStatement: { offset: 11 } })).toThrow();
    expect(() => validateCommand('query.explain', input)).toThrow();
  });
  it('只编译选区或光标位置的原语句，保留注释、引号及转义边界', () => {
    const source = "SELECT 0; /* 外 /* 内 */ */ SELECT $标签$含;号$标签$; DELETE FROM items;";
    expect(postgresExplainSql(source, { ...options, offset: source.indexOf('含') }).sql)
      .toBe('EXPLAIN (ANALYZE FALSE, VERBOSE TRUE, FORMAT JSON)\n /* 外 /* 内 */ */ SELECT $标签$含;号$标签$');
    expect(postgresExplainSql(String.raw`SELECT 'a\';b';`, { ...options, standardStrings: false, format: 'text' }).sql)
      .toContain('FORMAT TEXT');
    expect(() => postgresExplainSql(source, options)).toThrow('只接受一条语句');
    expect(() => postgresExplainSql('EXPLAIN ANALYZE DELETE FROM items', options)).toThrow('不支持估算计划');
    expect(() => postgresExplainSql('COPY items TO STDOUT', options)).toThrow('不支持估算计划');
    expect(postgresExplainSql('SELECT $1::int', options)).toMatchObject({ generic: true, sql: expect.stringContaining('GENERIC_PLAN TRUE') });
    expect(() => postgresExplainSql('SELECT $1::int', { ...options, version: '15.10' })).toThrow('PostgreSQL 16');
  });

  it('按原顺序保留节点、成本和长整数，错误计划保留原始输出', () => {
    const raw = '[{"Plan":{"Node Type":"Nested Loop","Plan Rows":9007199254740993,"Total Cost":1.2300,"Plans":[{"Node Type":"Seq Scan","Relation Name":"甲"},{"Node Type":"Index Scan","Index Name":"idx","Index Cond":"(id = 2)"}]}}]';
    const plan = parsePostgresExplain(raw, '18.1', 'json', false);
    expect(plan.nodes).toMatchObject([
      { kind: 'Nested Loop', path: '/0/Plan', rows: { value: '9007199254740993' }, costs: [{ source: 'Total Cost', value: '1.2300' }] },
      { kind: 'Seq Scan', name: '甲', parent: '0', depth: 1 },
      { kind: 'Index Scan', index: 'idx', path: '/0/Plan/Plans/1', parent: '0', properties: [{ source: 'Index Cond', value: '(id = 2)' }] },
    ]);
    expect(explainNodeDetail(raw, plan.nodes[2].path)).toContain('idx');
    expect(parsePostgresExplain('[{"Plan":{"Node Type":"Result"}},{"Plan":{"Node Type":"Sort"}}]', '18.1', 'json', false).nodes)
      .toMatchObject([{ path: '/0/Plan', depth: 0 }, { path: '/1/Plan', depth: 0 }]);
    expect(parsePostgresExplain('[{}]', '18.1', 'json', false)).toMatchObject({ nodes: [], raw: '[{}]', warnings: [expect.stringContaining('根节点')] });
    expect(parsePostgresExplain('', '18.1', 'json', true)).toMatchObject({ nodes: [], rawTruncated: true, warnings: [expect.stringContaining('上限')] });
  });
});
