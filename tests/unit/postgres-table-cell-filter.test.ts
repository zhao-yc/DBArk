import { describe, expect, it } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { postgresTableCellFilterDraft } from '../../src/renderer/postgresTableCellFilter';
import { filterRuleFromDraft } from '../../src/renderer/tableFilters';

const column: ResultColumn = { key: 'c0', name: '列"名', type: 'text' };

function rule(value: DataRow[string], exclude = false) {
  const row = { c0: value };
  const draft = postgresTableCellFilterDraft({ index: 0, row, column }, [column], [row], exclude);
  return filterRuleFromDraft(draft, [column.name]);
}

describe('PostgreSQL 表页单元格筛选', () => {
  it.each(['9007199254740993', '1.230000000000000001', '', 'NULL', 'a\r\nb', " O'Brien "])('保留协议原值 %j', value => {
    expect(rule(value)).toEqual({ column: column.name, operator: '=', value });
    expect(rule(value, true)).toEqual({ column: column.name, operator: '!=', value });
  });

  it('为空值使用独立运算符', () => {
    expect(rule(null)).toEqual({ column: column.name, operator: 'IS NULL' });
    expect(rule(null, true)).toEqual({ column: column.name, operator: 'IS NOT NULL' });
  });

  it('拒绝超限字符串、不可传输字符和有精度风险的数字', () => {
    for (const value of ['x'.repeat(100_000), 'a\0b', '\ud800', 2 ** 53, NaN, Infinity]) {
      expect(() => rule(value)).toThrow();
    }
  });

  it('拒绝过期行、过期列及访问器，且不触发访问器', () => {
    const row = { c0: '值' };
    expect(() => postgresTableCellFilterDraft({ index: 0, row, column }, [column], [{ ...row }])).toThrow();
    expect(() => postgresTableCellFilterDraft({ index: 0, row, column }, [{ ...column }], [row])).toThrow();
    let accessed = false;
    const accessor = { get c0() { accessed = true; return '值'; } };
    expect(() => postgresTableCellFilterDraft({ index: 0, row: accessor, column }, [column], [accessor])).toThrow();
    expect(accessed).toBe(false);
  });
});
