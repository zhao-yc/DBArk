import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { planTableValueOptions } from '../../src/engine/tableValueOptions';
import { readTableValueOptionsOrder, validateTableValueOptionsOutput, type TableValueOptionsOutput } from '../../src/shared/tableValueOptions';
import { tableValueFrequencyReadOnlyCases } from '../helpers/tableValueFrequencyReadOnlyCases';

/** 元数据与期望计数独立手写；不使用生成SQL反算排序期望。 */
function source(name = 'label', type = 'VARCHAR(100)'): TableInfo {
  return { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE subject(label VARCHAR(100))', columns: [{ name, type, nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [] };
}
const response = (counts: string[], order?: TableValueOptionsOutput['order']): TableValueOptionsOutput => ({ source: source(), sourceDigest: 'a'.repeat(64), column: 'label', ...(order === undefined ? {} : { order }), values: counts.map((count, index) => ({ value: index === 0 ? null : 'value' + index, count })), truncated: false, warnings: ['原服务器分组'] });
const expected = { database: 'db', table: 'subject', column: 'label' };

describe('服务器常见/罕见值排序', () => {
  it('只读实库向量不引用物理对象，期望包含500组之外热门值和数值计数序', () => {
    const vectors = tableValueFrequencyReadOnlyCases(); expect(vectors).toHaveLength(15);
    for (const vector of vectors) { expect(vector.sql).not.toContain('`dbark_readonly`.`subject`'); expect(vector.sql).toMatch(/^SELECT CASE /); expect(vector.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/); }
    expect(vectors[1].expected.slice(0, 2)).toEqual([{ value: 'zz_hot', count: '100' }, { value: 'yy_warm', count: '9' }]); expect(vectors[0].expected).toHaveLength(501); expect(vectors[0].expected.some(value => value.value === 'zz_hot')).toBe(false);
  });
  it.each([['count-desc', 'DESC'], ['count-asc', 'ASC']] as const)('%s先按原COUNT数值排序再取501组，外层不按展示计数字符串排序', (order, direction) => {
    const plan = planTableValueOptions(source(), { column: 'label', filters: [], order });
    expect(plan.sql).toContain('GROUP BY `label` ORDER BY COUNT(*) ' + direction + ',`label` LIMIT 501');
    expect(plan.sql).toContain('CAST(`g`.`n` AS CHAR) AS `count`');
    expect(plan.sql).toMatch(new RegExp('ORDER BY `g`\\.`n` ' + direction + ',`g`\\.`v`$'));
    expect(plan.sql).not.toMatch(/ORDER BY `count`|OFFSET|\bCOLLATE\b|\bDOUBLE\b|SUBSTRING/); expect(plan.order).toBe(order);
  });
  it('缺省报文保持旧值序与旧形状，不隐式启用全分组次数排序', () => {
    const plan = planTableValueOptions(source(), { column: 'label', filters: [] });
    expect(plan).not.toHaveProperty('order'); expect(plan.sql).toContain('ORDER BY `label` LIMIT 501'); expect(plan.sql).toMatch(/ORDER BY `g`\.`v`$/); expect(readTableValueOptionsOrder(undefined)).toBe('value');
  });
  it('ENUM次数相同仍按原序号，而不是派生后的标签字母排序', () => {
    const plan = planTableValueOptions(source('label', "ENUM('z','a')"), { column: 'label', filters: [], order: 'count-desc' });
    expect(plan.sql).toContain('MIN(`label`+0) AS `s`'); expect(plan.sql).toContain('ORDER BY COUNT(*) DESC,`label` LIMIT 501'); expect(plan.sql).toMatch(/ORDER BY `g`\.`n` DESC,`g`\.`s`$/);
  });
  it.each(['v', 'n', 'b', 's', 'N'])('原列%s不被内部聚合别名遮蔽，含缺省值序', name => {
    for (const order of [undefined, 'count-desc', 'count-asc'] as const) {
      const plan = planTableValueOptions(source(name), { column: name, filters: [], order });
      expect(plan.sql).toContain('GROUP BY `db`.`subject`.`' + name + '` ORDER BY ');
      expect(plan.sql).toContain((order ? 'COUNT(*) ' + (order === 'count-desc' ? 'DESC' : 'ASC') + ',' : 'ORDER BY ') + '`db`.`subject`.`' + name + '` LIMIT 501');
    }
  });
  it('搜索和冻结原筛选仍先过滤，再对匹配全集分组排序', () => {
    const plan = planTableValueOptions(source(), { column: 'label', filters: [{ column: 'label', operator: '!=', value: 'old' }], searchPattern: '%z%', order: 'count-desc' });
    expect(plan.sql.indexOf(' WHERE ')).toBeLessThan(plan.sql.indexOf(' GROUP BY ')); expect(plan.sql).toContain(' AND `label` LIKE '); expect(plan.searchPattern).toBe('%z%'); expect(plan.order).toBe('count-desc');
  });
  it('大计数用BigInt核序，NULL仍是独立真实组，不把字符串顺序当数值顺序', () => {
    expect(validateTableValueOptionsOutput(response(['9007199254740993', '9007199254740992', '100', '9'], 'count-desc'), { ...expected, order: 'count-desc' }).values[0]).toEqual({ value: null, count: '9007199254740993' });
    expect(() => validateTableValueOptionsOutput(response(['9', '100'], 'count-desc'), { ...expected, order: 'count-desc' })).toThrow();
    expect(() => validateTableValueOptionsOutput(response(['100', '9'], 'count-asc'), { ...expected, order: 'count-asc' })).toThrow();
    expect(validateTableValueOptionsOutput(response(['9', '100', '9007199254740993'], 'count-asc'), { ...expected, order: 'count-asc' }).values).toHaveLength(3);
  });
  it.each([undefined, 'value', 'count-asc'] as const)('次数降序请求不能接纳%s旧回执', order => expect(() => validateTableValueOptionsOutput(response(['2', '1'], order), { ...expected, order: 'count-desc' })).toThrow());
  it.each(['COUNT(*) DESC', '', null, false, 1, [], {}])('未知排序%j不能注入SQL或放宽回包', order => {
    expect(() => readTableValueOptionsOrder(order)).toThrow(); expect(() => planTableValueOptions(source(), { column: 'label', filters: [], order: order as never })).toThrow(); expect(() => validateTableValueOptionsOutput({ ...response(['1']), order }, expected)).toThrow();
  });
});
