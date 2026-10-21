import { describe, expect, it } from 'vitest';
import type { FilterGroup, FilterRule } from '../../src/shared/contracts';
import { validateFilterGroup } from '../../src/shared/filtering';
import { tableFilterGroupAfterChange, tableFilterGroupSummary, tableFilterGroupWithMode } from '../../src/renderer/tableFilterGroups';

/** 相同文本的条件也保留独立对象身份，不以文案猜测分组映射。 */
function rules(): FilterRule[] {
  return [{ column: 'id', operator: '=', value: '18446744073709551615' }, { column: 'note', operator: 'IN', values: ['', '  ', 'NULL', '甲,乙\n下一行'], enabled: false }, { column: 'amount', operator: '=', value: '0.12345678901234567890' }, { column: 'note', operator: 'IS NULL' }];
}
const group: FilterGroup = { mode: 'all', children: [{ mode: 'any', children: [0, { mode: 'all', children: [1] }] }, 2, 3] };

describe('表条件变化保持完整分组的纯helper', () => {
  it('平铺旧调用和清空保持undefined，不隐式增加分组协议', () => {
    const previous = rules(); expect(tableFilterGroupAfterChange(previous, previous, undefined, 'all')).toBeUndefined();
    expect(tableFilterGroupAfterChange(previous, [], group, 'all')).toBeUndefined(); expect(tableFilterGroupWithMode(undefined, 'any')).toBeUndefined();
  });

  it('同位置编辑和批量启停保留全部括号及叶号，不改原组或原值', () => {
    const previous = rules(), before = structuredClone(group), edited = previous.map((rule, index) => index === 1 ? { ...rule, values: ['新值', ''], enabled: true } : rule);
    expect(tableFilterGroupAfterChange(previous, edited, group, 'all')).toEqual(group);
    expect(tableFilterGroupAfterChange(previous, previous.map(rule => ({ ...rule, enabled: false })), group, 'all')).toEqual(group);
    expect(group).toEqual(before); expect(previous[1].values).toEqual(['', '  ', 'NULL', '甲,乙\n下一行']);
  });

  it('删除按对象身份重编号，空孙组及父组逐层剔除，单叶组不被平铺', () => {
    const previous = rules();
    expect(tableFilterGroupAfterChange(previous, [previous[0], previous[2], previous[3]], group, 'all')).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0] }, 1, 2] });
    expect(tableFilterGroupAfterChange(previous, [previous[2], previous[3]], group, 'all')).toEqual({ mode: 'all', children: [0, 1] });
  });

  it('新增置根末尾，既有组不因新filters中的位置变化丢失', () => {
    const previous = rules(), added: FilterRule = { column: 'note', operator: '=', value: '' }, next = [added, ...previous];
    const changed = tableFilterGroupAfterChange(previous, next, group, 'all');
    expect(changed).toEqual({ mode: 'all', children: [{ mode: 'any', children: [1, { mode: 'all', children: [2] }] }, 3, 4, 0] });
    expect(validateFilterGroup(next, 'all', changed)).toEqual(changed);
  });

  it('完整引用重排跟随身份，文本相等条件删除仍保留正确旧叶', () => {
    const previous = rules(); expect(tableFilterGroupAfterChange(previous, [...previous].reverse(), group, 'all')).toEqual({ mode: 'all', children: [{ mode: 'any', children: [3, { mode: 'all', children: [2] }] }, 1, 0] });
    const duplicate: FilterRule[] = [{ column: 'id', operator: '=', value: '同文' }, { column: 'id', operator: '=', value: '同文' }];
    expect(tableFilterGroupAfterChange(duplicate, [duplicate[1]], { mode: 'all', children: [0, { mode: 'any', children: [1] }] }, 'all')).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0] }] });
  });

  it('删除后克隆及重复对象身份有歧义时拒绝，不按相同文本猜测映射', () => {
    const previous = rules(); expect(() => tableFilterGroupAfterChange(previous, [{ ...previous[0] }], group, 'all')).toThrow('身份');
    expect(() => tableFilterGroupAfterChange(previous, [previous[2], { ...previous[1] }, previous[0], previous[3]], group, 'all')).toThrow('身份');
    const repeated = [previous[0], previous[0]];
    expect(() => tableFilterGroupAfterChange(repeated, [previous[0]], { mode: 'all', children: [0, 1] }, 'all')).toThrow('身份');
  });

  it('根模式单独更新，子组模式及停用叶保留，结果不共享可变树', () => {
    const changed = tableFilterGroupWithMode(group, 'any')!;
    expect(changed).toEqual({ ...group, mode: 'any' }); expect(changed).not.toBe(group); expect(changed.children).not.toBe(group.children); expect(group.mode).toBe('all');
    expect(() => tableFilterGroupWithMode(group, 'AND' as 'all')).toThrow();
  });

  it('摘要只含有界编号和括号，循环或越界树拒绝而不读取原值/SQL', () => {
    expect(tableFilterGroupSummary(group)).toBe('((条件1 或 (条件2)) 且 条件3 且 条件4)');
    const cycle: FilterGroup = { mode: 'all', children: [] }; (cycle.children as FilterGroup[]).push(cycle); expect(() => tableFilterGroupSummary(cycle)).toThrow();
    expect(() => tableFilterGroupSummary({ mode: 'all', children: [30] })).toThrow();
  });
});
