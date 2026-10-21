import { describe, expect, it } from 'vitest';
import type { FilterRule, TableInfo } from '../../src/shared/contracts';
import { FILTER_LIMITS, validateFilterRules } from '../../src/shared/filtering';
import { validateCommand } from '../../src/shared/validation';
import { tablePresetConfigurationSchema, validateTablePresetColumns } from '../../src/shared/tablePresets';
import { buildPageSql } from '../../src/engine/sql';
import { buildReferencePageSql } from '../../src/engine/references';
import { replaceFilterRule, setAllFilterRulesEnabled, setFilterRuleEnabled } from '../../src/renderer/tableFilters';

const info: TableInfo = { database: 'db', name: 'items', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], columns: ['id', 'note', 'amount'].map(name => ({ name, type: name === 'id' ? 'bigint' : name === 'amount' ? 'decimal(65,30)' : 'varchar(100)', nullable: name !== 'id', defaultValue: null, extra: '', generated: false, comment: '' })) };
const filters: FilterRule[] = [{ column: 'amount', operator: '=', value: '0.00000000000000000000001' }, { column: 'note', operator: 'IN', values: ['', '  ', 'NULL', '甲,乙'] }, { column: 'note', operator: 'IS NULL' }];

describe('表服务器筛选启停契约及语义', () => {
  it('启用位只接受布尔值，缺省规则保持旧IPC形状', () => {
    const input = { connectionId: 'c', database: 'db', table: 'items', page: 1, pageSize: 50, filters, filterMode: 'all', sort: [] };
    expect(validateCommand('table.page', input)).toEqual(input);
    expect(validateCommand('table.page', { ...input, filters: setAllFilterRulesEnabled(filters, false) })).toMatchObject({ filters: filters.map(rule => ({ ...rule, enabled: false })) });
    for (const enabled of ['false', 0, null, {}]) { const next = [{ ...filters[0], enabled }]; expect(() => validateCommand('table.page', { ...input, filters: next })).toThrow(); expect(() => validateFilterRules(next as FilterRule[])).toThrow(); }
  });
  it.each(['all', 'any'] as const)('%s只组合启用条件且仅绑定活动参数，精确值和原数组不变', mode => {
    const before = structuredClone(filters), next = setFilterRuleEnabled(filters, 1, false), sql = buildPageSql(info, 3, 50, next, [{ column: 'amount', direction: 'DESC' }], mode);
    expect(sql.params).toEqual(['0.00000000000000000000001']); expect(sql.sql).not.toContain(' IN '); expect(sql.sql).toContain(mode === 'all' ? ' AND ' : ' OR '); expect(sql.sql).toContain('`note` IS NULL'); expect(sql.sql).toContain('ORDER BY `amount` DESC, `id` ASC LIMIT 51 OFFSET 100'); expect(filters).toEqual(before);
  });
  it('全部停用不生成WHERE或参数，仍按原排序分页；未知列仍整体拒绝', () => {
    const next = setAllFilterRulesEnabled(filters, false), sql = buildPageSql(info, 1, 50, next, [{ column: 'amount', direction: 'DESC' }], 'any');
    expect(sql.params).toEqual([]); expect(sql.sql).not.toContain(' WHERE '); expect(sql.sql).toContain('ORDER BY `amount` DESC, `id` ASC'); expect(setAllFilterRulesEnabled(next, true)).toEqual(filters);
    expect(() => buildPageSql(info, 1, 50, [{ column: 'missing', operator: '=', value: '', enabled: false }], [])).toThrow('未知筛选字段');
  });
  it('关联浏览全部停用也必须保留强制外键范围及NULL无匹配保护', () => {
    const key = { name: 'fk', columns: ['owner'], referencedDatabase: 'db', referencedTable: 'items', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' };
    const next = setAllFilterRulesEnabled(filters, false), sql = buildReferencePageSql(info, key, ['7'], 1, 50, next, [], 'any');
    expect(sql).toMatch(/WHERE \(`id` = .*\) ORDER BY `id` ASC/); expect(sql).not.toContain(' OR '); expect(buildReferencePageSql(info, key, [null], 1, 50, next, [])).toContain('WHERE (0 = 1)');
  });
  it('停用仍计全部数量和值预算，非法条件和错误切换参数不会被跳过', () => {
    expect(() => setAllFilterRulesEnabled(Array(FILTER_LIMITS.conditions + 1).fill({ ...filters[0], enabled: false }), true)).toThrow();
    expect(() => setAllFilterRulesEnabled([{ column: 'note', operator: 'IN', values: [], enabled: false }], false)).toThrow();
    for (const index of [-1, 0.5, 3]) expect(() => setFilterRuleEnabled(filters, index, false)).toThrow();
    expect(() => setAllFilterRulesEnabled(filters, 'false' as unknown as boolean)).toThrow();
  });
  it('编辑停用条件保留停用位，命名方案JSON往返及列校验不丢原值', () => {
    const disabled = setFilterRuleEnabled(filters, 0, false), next = replaceFilterRule(disabled, { ...filters[0], value: '' }, 0);
    expect(next[0]).toEqual({ ...filters[0], value: '', enabled: false });
    const configuration = { filters: next, filterMode: 'any', sort: [{ column: 'amount', direction: 'DESC' }] };
    expect(tablePresetConfigurationSchema.parse(JSON.parse(JSON.stringify(configuration)))).toEqual(configuration);
    expect(validateTablePresetColumns(configuration as any, ['id', 'note', 'amount'])).toEqual(configuration);
    expect(() => validateTablePresetColumns(configuration as any, ['id', 'note'])).toThrow('字段已不存在');
  });
});
