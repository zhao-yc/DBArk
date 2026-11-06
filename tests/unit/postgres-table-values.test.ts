import { describe, expect, it } from 'vitest';
import { postgresTableValuesSchema } from '../../src/shared/postgresTable';
import { appendPostgresValueFilter } from '../../src/renderer/postgresTableValues';
import { filterDraftFromRule, filterRuleFromDraft } from '../../src/renderer/tableFilters';

describe('PostgreSQL 不同值筛选草稿', () => {
  it('保留旧的任一满足分组并与新候选相交，空串和多行值保持原文', () => {
    const rules = [{ column: 'id', operator: '=' as const, value: '1' }, { column: 'id', operator: '=' as const, value: '2' }];
    const selected = ['','a\r\nb', null];
    const next = appendPostgresValueFilter({ rules, mode: 'any' }, 'note', selected, false);
    expect(next.group).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: 'any', children: [2, 3] }] });
    expect(next.rules).toEqual([...rules, { column: 'note', operator: 'IN', values: selected.slice(0, 2) },
      { column: 'note', operator: 'IS NULL' }]);
    const draft = filterDraftFromRule(next.rules[2], true);
    expect(draft.valuesJson).toBe(true);
    expect(filterRuleFromDraft(draft, ['note'])).toEqual(next.rules[2]);
  });

  it('排除非空候选保留 NULL，同时排除 NULL 时明确增加非空约束', () => {
    const empty = { rules: [], mode: 'all' as const };
    expect(appendPostgresValueFilter(empty, 'note', [''], true).group?.children).toEqual([{ mode: 'any', children: [0, 1] }]);
    const both = appendPostgresValueFilter(empty, 'note', ['', null], true);
    expect(both.group?.children).toEqual([{ mode: 'all', children: [0, 1] }]);
    expect(both.rules.map(rule => rule.operator)).toEqual(['NOT IN', 'IS NOT NULL']);
    expect(appendPostgresValueFilter(empty, 'note', [null], true).rules).toEqual([{ column: 'note', operator: 'IS NOT NULL' }]);
  });

  it('候选查询只允许原页能力、目录列编号、文本搜索与固定排序', () => {
    const input = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1', search: '_%😀' };
    expect(postgresTableValuesSchema.safeParse(input).success).toBe(true);
    for (const order of ['value', 'count-desc', 'count-asc'])
      expect(postgresTableValuesSchema.parse({ ...input, order }).order).toBe(order);
    expect(postgresTableValuesSchema.safeParse({ ...input, order: 'frequency DESC' }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, filter: {} }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, search: '\0' }).success).toBe(false);
    expect(postgresTableValuesSchema.safeParse({ ...input, column: '字段名' }).success).toBe(false);
  });
});
