import { describe, expect, it } from 'vitest';
import { validateTableSort } from '../../src/renderer/tableSort';
import type { SortRule } from '../../src/shared/contracts';

describe('服务器多列排序草稿校验', () => {
  it('严格保留字段名、优先级和方向，返回独立规则，允许清空', () => {
    const original: SortRule[] = [{ column: 'a`b', direction: 'DESC' }, { column: '__proto__', direction: 'ASC' }], rules = validateTableSort(original, ['a`b', '__proto__']);
    expect(rules).toEqual(original); rules[0].direction = 'ASC'; expect(original[0].direction).toBe('DESC'); expect(validateTableSort([], ['a'])).toEqual([]);
  });
  it('共用20项IPC边界，拒绝未知／重复字段、非法方向及扩展SQL字段', () => {
    const columns = Array.from({ length: 21 }, (_, index) => 'c' + index), rules = columns.map(column => ({ column, direction: 'ASC' as const }));
    expect(validateTableSort(rules.slice(0, 20), columns)).toHaveLength(20);
    for (const value of [rules, [{ column: 'missing', direction: 'ASC' }], [rules[0], rules[0]], [{ column: 'c0', direction: 'asc' }], [{ ...rules[0], sql: 'DROP TABLE x' }]]) expect(() => validateTableSort(value as SortRule[], columns)).toThrow();
    expect(() => validateTableSort([], ['c0', 'c0'])).toThrow();
  });
});
