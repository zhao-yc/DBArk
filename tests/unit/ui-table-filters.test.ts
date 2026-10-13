import { describe, expect, it } from 'vitest';
import type { FilterRule } from '../../src/shared/contracts';
import { FILTER_LIMITS, validateFilterRules } from '../../src/shared/filtering';
import { emptyFilterDraft, filterDraftFromRule, filterRuleFromDraft, filterRuleSummary, maxTablePage, parseFilterSet, parsePageJump, replaceFilterRule } from '../../src/renderer/tableFilters';

describe('表格筛选输入保持原始数据', () => {
  it('逐行集合保留中文、逗号、空格和空行，不按逗号拆分或修剪', () => {
    expect(parseFilterSet('甲,乙\r\n\r\n 前后空格 \n18446744073709551615\r结尾\n')).toEqual(['甲,乙', '', ' 前后空格 ', '18446744073709551615', '结尾', '']);
    expect(parseFilterSet('a,b')).toEqual(['a,b']);
  });

  it('空文本不是有效集合；仅空字符串必须显式选择，重复空行不会被删除', () => {
    expect(() => parseFilterSet('')).toThrow('至少需要一个值');
    expect(parseFilterSet('', true)).toEqual(['']);
    expect(parseFilterSet('\n', true)).toEqual(['', '']);
    expect(parseFilterSet('甲', true)).toEqual(['甲', '']);
  });

  it('集合数量和单值长度使用IPC同一上限，边界可用且超限不会截断', () => {
    expect(parseFilterSet(Array(FILTER_LIMITS.setValues).fill('值').join('\n'))).toHaveLength(FILTER_LIMITS.setValues);
    expect(() => parseFilterSet(Array(FILTER_LIMITS.setValues + 1).fill('值').join('\n'))).toThrow('最多包含');
    expect(parseFilterSet('甲'.repeat(FILTER_LIMITS.valueLength))[0]).toHaveLength(FILTER_LIMITS.valueLength);
    expect(() => parseFilterSet('甲'.repeat(FILTER_LIMITS.valueLength + 1))).toThrow('单个筛选值');
  });

  it('NULL条件丢弃编辑器中残留的标量、集合和区间内容', () => {
    const rule = filterRuleFromDraft({ ...emptyFilterDraft('内容'), operator: 'IS NULL', value: '旧值', upperValue: '旧上界', valuesText: '旧集合' }, ['内容']);
    expect(rule).toEqual({ column: '内容', operator: 'IS NULL' });
    expect(Object.hasOwn(rule, 'value')).toBe(false);
    expect(Object.hasOwn(rule, 'values')).toBe(false);
    expect(() => validateFilterRules([rule])).not.toThrow();
  });

  it('区间仅使用两个独立边界，保留精确小数、空串，不发送标量value', () => {
    const rule = filterRuleFromDraft({ ...emptyFilterDraft('金额'), operator: 'BETWEEN', value: '', upperValue: '999999999999999.123456789', valuesText: '不应发送' }, ['金额']);
    expect(rule).toEqual({ column: '金额', operator: 'BETWEEN', values: ['', '999999999999999.123456789'] });
    expect(() => validateFilterRules([rule], 'any')).not.toThrow();
  });

  it('标量保留模式与空串，拒绝已从元数据移除的字段和超长值', () => {
    expect(filterRuleFromDraft({ ...emptyFilterDraft('内容'), operator: 'NOT LIKE', value: '%中文_,逗号%' }, ['内容'])).toEqual({ column: '内容', operator: 'NOT LIKE', value: '%中文_,逗号%' });
    expect(filterRuleFromDraft(emptyFilterDraft('内容'), ['内容']).value).toBe('');
    expect(() => filterRuleFromDraft(emptyFilterDraft('旧字段'), ['新字段'])).toThrow('有效的筛选字段');
    expect(() => filterRuleFromDraft({ ...emptyFilterDraft('内容'), value: 'x'.repeat(FILTER_LIMITS.valueLength + 1) }, ['内容'])).toThrow('单个筛选值');
  });

  it.each<FilterRule>([
    { column: '内容', operator: 'IN', values: [''] },
    { column: '内容', operator: 'NOT IN', values: ['', 'a,b', '', ' 空格 ', ''] },
    { column: '内容', operator: 'BETWEEN', values: ['18446744073709551614', '18446744073709551615'] },
    { column: '内容', operator: '=', value: '' },
    { column: '内容', operator: 'IS NOT NULL' }
  ])('编辑条件后保持原有语义：%j', rule => {
    expect(filterRuleFromDraft(filterDraftFromRule(rule), ['内容'])).toEqual(rule);
  });

  it('芯片摘要明确显示空字符串并限制大集合的显示长度', () => {
    expect(filterRuleSummary({ column: '内容', operator: '=', value: '' })).toContain('空字符串');
    const summary = filterRuleSummary({ column: '内容', operator: 'IN', values: Array(200).fill('甲'.repeat(4096)) });
    expect(summary).toContain('200 个值');
    expect(summary.length).toBeLessThan(260);
  });
});

describe('筛选条件修改的数量边界', () => {
  it('在30条条件时仍可原位置编辑，新增第31条被拒绝且原条件不变', () => {
    const current: FilterRule[] = Array.from({ length: FILTER_LIMITS.conditions }, (_, index) => ({ column: 'id', operator: '=', value: String(index) }));
    const updated: FilterRule = { column: 'id', operator: 'IN', values: ['甲,乙', ''] };
    const next = replaceFilterRule(current, updated, 3);
    expect(next).toHaveLength(FILTER_LIMITS.conditions); expect(next[3]).toBe(updated); expect(next[2]).toBe(current[2]);
    expect(current[3].value).toBe('3');
    expect(() => replaceFilterRule(current, updated, null)).toThrow('最多添加');
    expect(() => replaceFilterRule(current, updated, current.length)).toThrow('条件已不存在');
  });

  it('整组值总数和字符预算在应用前校验，不截断或部分应用', () => {
    const group: FilterRule[] = Array.from({ length: 5 }, () => ({ column: 'id', operator: 'IN', values: Array(200).fill('值') }));
    expect(() => replaceFilterRule(group, { column: 'id', operator: '=', value: '超出' }, null)).toThrow('最多包含 1000 个值');
    const large: FilterRule = { column: '内容', operator: 'IN', values: Array(200).fill('x'.repeat(4096)) };
    expect(() => replaceFilterRule([large], large, null)).toThrow('合计最多包含');
    expect(group).toHaveLength(5);
  });
});

describe('服务端页码直接跳转', () => {
  it('支持首尾合法页码、前导零和外围空格，不需要知道总页数', () => {
    expect(parsePageJump('1')).toBe(1); expect(parsePageJump(' 001000 ')).toBe(1000);
    expect(parsePageJump(String(maxTablePage))).toBe(maxTablePage);
  });
  it.each(['', ' ', '0', '-1', '1.5', '1e3', '+2', '12abc', '1 2', '１２', String(maxTablePage + 1), '9007199254740993'])('拒绝非法或超范围页码 %j', input => {
    expect(() => parsePageJump(input)).toThrow('正整数');
  });
});
