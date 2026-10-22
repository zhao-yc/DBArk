import { describe, expect, it } from 'vitest';
import type { FilterMode, FilterRule, TableInfo } from '../../src/shared/contracts';
import { FILTER_LIMITS, validateFilterRules } from '../../src/shared/filtering';
import { validateCommand } from '../../src/shared/validation';
import { buildPageSql, inlineParameters } from '../../src/engine/sql';

const table: TableInfo = { database: 'test', name: 'rows', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: [
  { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: null, extra: '', comment: '', generated: false },
  { name: 'title', type: 'VARCHAR(100)', nullable: true, defaultValue: null, extra: '', comment: '', generated: false },
  { name: 'amount', type: 'DECIMAL(40,18)', nullable: false, defaultValue: null, extra: '', comment: '', generated: false },
] };
const base = { connectionId: 'test', database: 'test', table: 'rows', page: 1, pageSize: 2, sort: [] };

describe('集合区间与组合筛选边界', () => {
  it('IN保留值的空白/逗号/空字符串并独立绑定，整个OR组与BETWEEN条件都有括号', () => {
    const result = buildPageSql(table, 2, 2, [
      { column: 'title', operator: 'IN', values: ["文'字\\", ' a,b ', ''] },
      { column: 'amount', operator: 'BETWEEN', values: ['1.000000000000000001', '1.000000000000000002'] },
      { column: 'title', operator: 'IS NULL' },
    ], [], 'any');
    expect(result.sql).toContain('WHERE ((`title` IN (?, ?, ?)) OR (`amount` BETWEEN CAST(? AS DECIMAL(65,18)) AND CAST(? AS DECIMAL(65,18))) OR (`title` IS NULL))');
    expect(result.sql).toContain('ORDER BY `id` ASC LIMIT 3 OFFSET 2');
    expect(result.params).toEqual(["文'字\\", ' a,b ', '', '1.000000000000000001', '1.000000000000000002']);
    expect(inlineParameters(result.sql, result.params)).not.toContain("文'字");
  });
  it('默认AND与NOT IN/NOT LIKE均只使用预定义运算符，不把注入字符串当SQL', () => {
    const value = "x') OR 1=1 --";
    const result = buildPageSql(table, 1, 2, [{ column: 'title', operator: 'NOT IN', values: [value] }, { column: 'title', operator: 'NOT LIKE', value: '%中%' }], []);
    expect(result.sql).toContain('WHERE ((`title` NOT IN (?)) AND (`title` NOT LIKE ?))');
    expect(result.params).toEqual([value, '%中%']); expect(result.sql).not.toContain(value);
  });
  it('BIGINT相邻值与精确小数参数不经JS Number，也不触发MySQL字符串转DOUBLE', () => {
    const result = buildPageSql(table, 1, 2, [{ column: 'id', operator: 'IN', values: ['9007199254740992', '9007199254740993'] }, { column: 'amount', operator: '=', value: '12345678901234567890.123456789012345678' }], []);
    expect(result.sql).toContain('`id` IN (CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED))');
    expect(result.params[1]).toBe('9007199254740993'); expect(result.sql).toContain('`amount` = CAST(? AS DECIMAL(65,18))');
    expect(() => buildPageSql(table, 1, 2, [{ column: 'id', operator: '=', value: '1e30' }], [])).toThrow('普通十进制');
    expect(() => buildPageSql(table, 1, 2, [{ column: 'amount', operator: '=', value: '1'.repeat(66) }], [])).toThrow('精确比较范围');
  });
  it('非唯一排序补可靠主键，显式排过的主键不重复追加', () => {
    expect(buildPageSql(table, 1, 2, [], [{ column: 'title', direction: 'DESC' }]).sql).toContain('ORDER BY `title` DESC, `id` ASC');
    expect(buildPageSql(table, 1, 2, [], [{ column: 'id', direction: 'DESC' }]).sql).toContain('ORDER BY `id` DESC LIMIT');
  });
  it.each<FilterRule>([
    { column: 'title', operator: 'IN', values: [] }, { column: 'title', operator: 'NOT IN' },
    { column: 'id', operator: 'BETWEEN', values: ['1'] }, { column: 'id', operator: 'BETWEEN', values: ['1', '2', '3'] },
    { column: 'title', operator: 'IN', value: '', values: ['x'] }, { column: 'title', operator: '=', values: ['x'] },
    { column: 'title', operator: 'IS NULL', value: 'NULL' },
  ])('IPC和引擎都拒绝不完整或含混规则：%j', filter => {
    expect(() => validateCommand('table.page', { ...base, filters: [filter] })).toThrow();
    expect(() => buildPageSql(table, 1, 2, [filter], [])).toThrow();
  });
  it('单项和全组值预算同时生效，避免许多小集合绕过整体限制', () => {
    expect(() => validateFilterRules([{ column: 'title', operator: 'IN', values: Array(201).fill('x') }])).toThrow('1～200');
    expect(() => validateFilterRules([{ column: 'title', operator: '=', value: 'x'.repeat(FILTER_LIMITS.valueLength + 1) }])).toThrow('4096');
    const many: FilterRule[] = Array.from({ length: 6 }, () => ({ column: 'title', operator: 'IN', values: Array(200).fill('x') }));
    expect(() => validateCommand('table.page', { ...base, filters: many })).toThrow('1000 个值');
    const large: FilterRule[] = Array.from({ length: 2 }, () => ({ column: 'title', operator: 'IN', values: Array(200).fill('x'.repeat(3000)) }));
    expect(() => validateFilterRules(large)).toThrow('1000000 个字符');
  });
  it('列与组合模式仍受白名单保护，旧标量缺省值兼容为空字符串', () => {
    expect(() => buildPageSql(table, 1, 2, [{ column: 'title) OR 1=1', operator: 'IN', values: ['x'] }], [])).toThrow('未知筛选字段');
    expect(() => buildPageSql(table, 1, 2, [], [], 'any;DROP TABLE rows' as FilterMode)).toThrow('组合模式');
    expect(buildPageSql(table, 1, 2, [{ column: 'title', operator: '=' }], []).params).toEqual(['']);
    expect(validateCommand('table.page', { ...base, filterMode: 'any', filters: [{ column: 'title', operator: 'IN', values: [''] }] })).toMatchObject({ filterMode: 'any' });
  });
});
