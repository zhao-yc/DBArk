import { describe, expect, it } from 'vitest';
import type { FilterRule, TableInfo } from '../../src/shared/contracts';
import { buildPageSql, buildTableFilterSql, inlineParameters } from '../../src/engine/sql';
import { planTableStatistics } from '../../src/engine/tableStatistics';

/** 同一真实整数类型元数据供表页和统计共用；测试不通过Number生成大整数边界。 */
function info(type = 'BIGINT UNSIGNED'): TableInfo { return { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], columns: [{ name: 'u', type, nullable: true, defaultValue: null, generated: false, extra: '', comment: '' }] }; }
const unsigned = 'CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)';

describe('5.7无符号整型筛选的参数定型边界', () => {
  it.each(['0', '+0', '0000', '+0001', '9007199254740992', '9007199254740993', '9223372036854775807', '9223372036854775808', '18446744073709551614', '18446744073709551615'])('范围内普通非负整数%s走unsigned且保留原始参数', value => {
    const page = buildPageSql(info(), 1, 10, [{ column: 'u', operator: '=', value }], []);
    expect(page.sql).toContain('`u` = ' + unsigned); expect(page.params).toEqual([value]);
    expect(inlineParameters(page.sql, page.params)).toContain(Buffer.from(value).toString('hex'));
    expect(page.sql).not.toContain('CAST(`u`');
  });
  it.each(['TINYINT UNSIGNED', 'SMALLINT(5) UNSIGNED', 'MEDIUMINT UNSIGNED', 'INT(10) UNSIGNED ZEROFILL', 'INTEGER UNSIGNED', 'bigint(20) unsigned'])('只有实际整型UNSIGNED属性%s可进入新路径', type => {
    expect(buildTableFilterSql(info(type), [{ column: 'u', operator: '=', value: '18446744073709551615' }]).where).toContain(unsigned);
  });
  it.each(['BIGINT', 'BIGINT(20)', 'DECIMAL(65,0) UNSIGNED', 'NUMERIC(65,0) UNSIGNED', 'BIT(64)', 'YEAR'])('类型%s不借整数UNSIGNED路径改变原精度比较', type => {
    const query = buildTableFilterSql(info(type), [{ column: 'u', operator: '=', value: '18446744073709551615' }]); expect(query.where).toContain('CAST(? AS DECIMAL(65,0))'); expect(query.where).not.toContain('AS UNSIGNED');
  });
  it.each(['-0', '-1', '0.0', '1.1', '18446744073709551615.1', '18446744073709551616', '-18446744073709551616', '9'.repeat(65)])('负号/分数/超UINT64%s保留原DECIMAL，不取模或截断', value => {
    const query = buildTableFilterSql(info(), [{ column: 'u', operator: '=', value }]); expect(query.where).toContain('CAST(? AS DECIMAL(65,'); expect(query.where).not.toContain('AS UNSIGNED'); expect(query.params).toEqual([value]);
  });
  it.each(['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'BETWEEN'] as const)('运算符%s统一使用同一安全参数定型，列本身不包CAST', operator => {
    const rule: FilterRule = operator === 'IN' || operator === 'NOT IN' ? { column: 'u', operator, values: ['18446744073709551614', '18446744073709551615'] } : operator === 'BETWEEN' ? { column: 'u', operator, values: ['18446744073709551614', '18446744073709551615'] } : { column: 'u', operator, value: '18446744073709551615' };
    const filter = buildTableFilterSql(info(), [rule]), plan = planTableStatistics(info(), { columns: ['u'], filters: [rule] });
    expect(filter.where).toContain(unsigned); expect(plan.sql).toContain('AS UNSIGNED'); expect(plan.sql).not.toContain('CAST(`u`'); expect(plan.sql).not.toContain('9007199254740992');
  });
  it('相邻最大值IN/NOT IN保留每个值；混合范围外项不被强转或悄悄移除', () => {
    const query = buildTableFilterSql(info(), [{ column: 'u', operator: 'NOT IN', values: ['18446744073709551614', '18446744073709551615'] }]); expect(query.where).toBe(`((\`u\` NOT IN (${unsigned}, ${unsigned})))`); expect(query.params).toEqual(['18446744073709551614', '18446744073709551615']);
    const mixed = buildTableFilterSql(info(), [{ column: 'u', operator: 'IN', values: ['18446744073709551615', '-1', '0.5', '18446744073709551616'] }]); expect(mixed.params).toEqual(['18446744073709551615', '-1', '0.5', '18446744073709551616']); expect(mixed.where).toContain(`${unsigned}, CAST(? AS DECIMAL(65,0)), CAST(? AS DECIMAL(65,1)), CAST(? AS DECIMAL(65,0))`);
  });
  it('不放宽原词法和65位预算；LIKE及NULL不变，停用项不额外生成参数', () => {
    for (const value of ['1e20', ' 1', '1 ', 'NaN', '1;SELECT 1', '1'.repeat(66)]) expect(() => buildTableFilterSql(info(), [{ column: 'u', operator: '=', value }])).toThrow();
    expect(buildTableFilterSql(info(), [{ column: 'u', operator: 'LIKE', value: '18446744073709551615' }])).toEqual({ where: '((`u` LIKE ?))', params: ['18446744073709551615'] });
    expect(buildTableFilterSql(info(), [{ column: 'u', operator: 'IS NULL' }])).toEqual({ where: '((`u` IS NULL))', params: [] });
    expect(buildTableFilterSql(info(), [{ column: 'u', operator: '=', value: '18446744073709551615', enabled: false }])).toEqual({ where: undefined, params: [] });
  });
});
