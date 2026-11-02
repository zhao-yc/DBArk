import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { captureQueryResultValueOptions, currentQueryResultValueOptions, queryResultValueOptionsNode, searchQueryResultValueOptions, type QueryResultValueOptionsOrder } from '../../src/renderer/queryResultValueOptions';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';

/** 只构造内存中的真实结果契约；计数预期独立给定，不执行 SQL。 */
function fixture(values: CellValue[], type = 'VARCHAR', codes?: string[]) {
  const source: QueryResult = { columns: [{ key: 'v', name: '值', type }], rows: values.map(v => ({ v })), statement: '不得重新执行', elapsedMs: 1, truncated: true, ...(codes ? { sqliteStorage: { version: 1 as const, rows: codes } } : {}) };
  return { source, capture: captureQueryResultValueOptions(source.columns, source.rows, source.columns[0], type === 'SQLITE' ? source : undefined) };
}

describe('已返回不同值按次数整理', () => {
  it('默认仍为首次出现顺序，完整集合排序在分页之前，100 与 9 按数值比较', () => {
    const f = fixture([...Array.from({ length: 55 }, (_, i) => 'rare' + i), ...Array(100).fill('hot'), ...Array(9).fill('warm'), null, null, '', 'NULL']);
    const before = structuredClone(f.source), entries = f.capture.entries;
    expect(searchQueryResultValueOptions(f.capture, '')).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(searchQueryResultValueOptions(f.capture, '', 'count-desc').slice(0, 5)).toEqual([55, 56, 57, 0, 1]);
    expect(searchQueryResultValueOptions(f.capture, '', 'count-asc').slice(-3)).toEqual([57, 56, 55]);
    expect(searchQueryResultValueOptions(f.capture, '', 'count-desc')).toHaveLength(60);
    expect(f.capture.entries).toBe(entries); expect(f.source).toEqual(before); expect(Object.isFrozen(searchQueryResultValueOptions(f.capture, '', 'count-desc'))).toBe(true);
  });
  it('同次数稳定沿首次出现顺序，不以字面值或编号字符串排序', () => {
    const f = fixture(['z', 'a', 'z', 'a', null, '', 'NULL']);
    expect(searchQueryResultValueOptions(f.capture, '', 'count-desc')).toEqual([0, 1, 2, 3, 4]);
    expect(searchQueryResultValueOptions(f.capture, '', 'count-asc')).toEqual([2, 3, 4, 0, 1]);
    expect(searchQueryResultValueOptions(f.capture, 'NULL', 'count-desc')).toEqual([2, 4]);
  });
  it('数值精度及首个字面值不变，选值编号不随显示次序改变', () => {
    const f = fixture(['9007199254740993.000001', '1.0', '1.00', '9007199254740993.000002'], 'DECIMAL');
    expect(searchQueryResultValueOptions(f.capture, '', 'count-desc')).toEqual([1, 0, 2]);
    expect(queryResultValueOptionsNode(f.capture, [0, 2], 'include')).toEqual({ column: 'v', operator: 'in', value: '', values: ['9007199254740993.000001', '9007199254740993.000002'] });
    expect(f.capture.entries[1]).toEqual({ id: 1, literal: '1.0', count: 2 });
  });
  it('搜索先取全部匹配再按次数排序，空搜索恢复完整原集合', () => {
    const f = fixture(['other', 'x_a', 'x_b', 'x_b', 'x_b', 'x_c', 'x_c']);
    expect(searchQueryResultValueOptions(f.capture, 'x_', 'count-desc')).toEqual([2, 3, 1]);
    expect(searchQueryResultValueOptions(f.capture, 'x_', 'count-asc')).toEqual([1, 3, 2]);
    expect(searchQueryResultValueOptions(f.capture, 'missing', 'count-desc')).toEqual([]);
    expect(searchQueryResultValueOptions(f.capture, '')).toEqual([0, 1, 2, 3]);
  });
  it('SQLite同显示的存储类型独立排序和勾选，BLOB与NULL保持', () => {
    const f = fixture(['2', '2', '2', '2', '2', '2', { type: 'binary', base64: 'AP8=' }, null], 'SQLITE', ['i', 'r', 't', 't', 'i', 't', 'b', 'n']);
    expect(searchQueryResultValueOptions(f.capture, '', 'count-desc')).toEqual([2, 0, 1, 3, 4]);
    expect(searchQueryResultValueOptions(f.capture, 'INTEGER', 'count-asc')).toEqual([0]);
    expect(queryResultValueOptionsNode(f.capture, [2], 'include')).toEqual({ column: 'v', operator: 'in', value: '', values: ['2'], sqliteType: 'text' });
    expect(f.capture.entries[3]).toMatchObject({ literal: '00ff', sqliteType: 'blob', count: 1 });
  });
  it.each(['', 'COUNT-DESC', null, 0, { toString: vi.fn() }])('拒绝非声明排序，不调用对象转换 %j', order => {
    const f = fixture(['x']); expect(() => searchQueryResultValueOptions(f.capture, '', order as QueryResultValueOptionsOrder)).toThrow(text.invalid);
    if (order && typeof order === 'object') expect(order.toString).not.toHaveBeenCalled();
    expect(currentQueryResultValueOptions(f.capture, f.source.columns, f.source.rows)).toBe(true);
  });
  it('排序仍沿原预算及永久来源失效保护，不因改回原值复活', () => {
    const f = fixture(['x', 'y']); expect(() => searchQueryResultValueOptions(f.capture, 'x'.repeat(4097), 'count-desc')).toThrow(text.searchBudget);
    f.source.rows[0].v = 'changed'; expect(() => searchQueryResultValueOptions(f.capture, '', 'count-desc')).toThrow(text.stale); f.source.rows[0].v = 'x';
    expect(() => searchQueryResultValueOptions(f.capture, '', 'source')).toThrow(text.stale);
  });
});
