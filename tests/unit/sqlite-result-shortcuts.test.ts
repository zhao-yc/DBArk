import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { captureQueryResultCellFilter, currentQueryResultCellFilter, queryResultCellFilterNode, queryResultCellFilterRule } from '../../src/renderer/queryResultCellFilter';
import { captureQueryResultSelectedFilter, currentQueryResultSelectedFilter, queryResultSelectedFilterNode } from '../../src/renderer/queryResultSelectedFilter';
import { QueryResultFilter, appendQueryResultFilterNode } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultPresetValueSchema } from '../../src/shared/queryResultPresets';

/** 三个同显示值保留独立存储类型；可见列重排且隐藏字段仍占原代码位置。 */
function fixture() {
  const source: QueryResult = { columns: [{ key: 'value', name: '同名', type: 'SQLITE' }, { key: 'id', name: '同名', type: 'SQLITE' }, { key: 'hidden', name: '同名', type: 'SQLITE' }],
    rows: ['2', '2', '2', { type: 'binary', base64: 'AP8=' }, null, '', '9223372036854775807', '00ff', 'Infinity'].map((value, index) => ({ value: value as CellValue, id: String(index), hidden: '隐藏字段' })),
    sqliteStorage: { version: 1, rows: ['iit', 'rit', 'tit', 'bit', 'nit', 'tit', 'iit', 'tit', 'rit'] }, truncated: true, elapsedMs: 1, statement: '源SQL，不执行' };
  const visible = [source.columns[1], source.columns[0]], cell = (index: number) => ({ index, row: source.rows[index], column: visible[1] });
  const capture = (index: number) => captureQueryResultCellFilter(visible, source.rows, cell(index), source);
  const selected = (indices: number[], active = 0) => captureQueryResultSelectedFilter(visible, source.rows, cell(active), new Set(indices), source);
  const filter = new QueryResultFilter(), binding = filter.bind(source, [], visible)!;
  return { source, visible, cell, capture, selected, apply(node: ReturnType<typeof queryResultCellFilterNode>) { return filter.applyExpression(binding, filter.view(binding)!, 'children' in node ? node : { mode: 'AND', children: [node] }); } };
}

describe('SQLite结果原格与勾选值生成条件', () => {
  it.each([[0, 'integer', '2'], [1, 'real', '2'], [2, 'text', '2'], [3, 'blob', '00ff'], [5, 'text', ''], [6, 'integer', '9223372036854775807'], [7, 'text', '00ff'], [8, 'real', 'Infinity']] as const)('原格%d保%s原值，不依赖重复名或可见列序', (index, type, value) => {
    const f = fixture(), before = structuredClone(f.source), capture = f.capture(index), node = queryResultCellFilterNode(capture, 'eq');
    expect(node).toEqual({ column: 'value', operator: 'eq', value, sqliteType: type }); expect(f.apply(node).sourceIndices).toEqual([index]); expect(f.source).toEqual(before); expect(currentQueryResultCellFilter(capture, f.visible, f.source.rows)).toBe(true);
  });
  it('排除原格保留其它非NULL类型，不把同类型NE误当完整补集；NULL原格独立处理', () => {
    const f = fixture(), node = queryResultCellFilterNode(f.capture(2), 'ne');
    expect(node).toEqual({ mode: 'OR', children: [{ column: 'value', operator: 'ne', value: '2', sqliteType: 'text' }, { column: 'value', operator: 'notType', value: '', sqliteType: 'text' }] });
    expect(f.apply(node).sourceIndices).toEqual([0, 1, 3, 5, 6, 7, 8]);
    expect(f.apply(queryResultCellFilterNode(f.capture(4), 'eq')).sourceIndices).toEqual([4]); expect(f.apply(queryResultCellFilterNode(f.capture(4), 'ne')).sourceIndices).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    const preset = { columns: f.source.columns, visible: f.visible, configuration: { expression: node, sort: [] } }; expect(queryResultPresetValueSchema.parse(preset)).toEqual(preset);
  });
  it('同显示2按类型分别去重并与NULL组成OR；字节和相同十六进制文本也不合并', () => {
    const f = fixture(), capture = f.selected([0, 1, 2, 4]), node = queryResultSelectedFilterNode(capture);
    expect(capture.values).toEqual(['2', '2', '2']); expect(node).toEqual({ mode: 'OR', children: [{ column: 'value', operator: 'in', value: '', values: ['2'], sqliteType: 'integer' }, { column: 'value', operator: 'in', value: '', values: ['2'], sqliteType: 'real' }, { column: 'value', operator: 'in', value: '', values: ['2'], sqliteType: 'text' }, { column: 'value', operator: 'null', value: '' }] });
    expect(f.apply(node).sourceIndices).toEqual([0, 1, 2, 4]);
    const byteNode = queryResultSelectedFilterNode(f.selected([3, 7])); expect(f.apply(byteNode).sourceIndices).toEqual([3, 7]);
  });
  it('排序后沿新行坐标与代码捕获，当前未勾选格不读取其值或触发getter', () => {
    const f = fixture(), sort = new QueryResultSort(), binding = sort.bind(f.source, [])!, view = sort.apply(binding, sort.view(binding)!, [{ column: 'id', direction: 'DESC' }]);
    const capture = captureQueryResultCellFilter(f.visible, view.result.rows, { index: 0, row: view.result.rows[0], column: f.visible[1] }, view.result); expect(queryResultCellFilterRule(capture, 'eq')).toMatchObject({ sqliteType: 'real', value: 'Infinity' });
    const getter = vi.fn(() => { throw Error('未勾选格不能读取'); }); Object.defineProperty(f.source.rows[2], 'value', { configurable: true, enumerable: true, get: getter });
    const selected = f.selected([0], 2); expect(queryResultSelectedFilterNode(selected)).toEqual({ column: 'value', operator: 'in', value: '', values: ['2'], sqliteType: 'integer' }); expect(currentQueryResultSelectedFilter(selected, f.visible, f.source.rows, f.source)).toBe(true); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['code', 'storage', 'rows', 'column', 'binary'] as const)('%s变化使原捕获永久失效，恢复旧值也不能复活', mode => {
    const f = fixture(), cell = f.capture(3), selected = f.selected([3]), original = f.source.sqliteStorage, rows = f.source.rows, name = f.source.columns[0].name, binary = rows[3].value as { type: 'binary'; base64: string }, code = original!.rows[3];
    if (mode === 'code') original!.rows[3] = 'tit'; else if (mode === 'storage') f.source.sqliteStorage = structuredClone(original); else if (mode === 'rows') f.source.rows = rows.slice(); else if (mode === 'column') f.source.columns[0].name = '变化'; else binary.base64 = 'AAAA';
    expect(currentQueryResultCellFilter(cell, f.visible, rows)).toBe(false); expect(currentQueryResultSelectedFilter(selected, f.visible, rows, f.source)).toBe(false);
    f.source.sqliteStorage = original; original!.rows[3] = code; f.source.rows = rows; f.source.columns[0].name = name; binary.base64 = 'AP8=';
    expect(() => queryResultCellFilterNode(cell, 'eq')).toThrow(); expect(() => queryResultSelectedFilterNode(selected)).toThrow();
  });
  it('伪造捕获、新结果wrapper、选择变化及继承或访问器代码均拒绝', () => {
    const f = fixture(), capture = f.capture(0), selected = f.selected([0]); expect(() => queryResultCellFilterNode({ ...capture }, 'eq')).toThrow(); expect(() => queryResultSelectedFilterNode({ ...selected })).toThrow();
    expect(currentQueryResultSelectedFilter(selected, f.visible, f.source.rows, { ...f.source })).toBe(false);
    const getter = vi.fn(() => f.source.sqliteStorage!.rows); Object.defineProperty(f.source.sqliteStorage!, 'rows', { enumerable: true, get: getter }); expect(() => f.capture(0)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('缺少类型时不猜测，NULL仍可生成；BLOB解码前核完整HEX上限', () => {
    const f = fixture(); delete f.source.sqliteStorage; expect(() => f.capture(0)).toThrow(text.sqliteUnknown); expect(queryResultCellFilterNode(f.capture(4), 'eq')).toEqual({ column: 'value', operator: 'null', value: '' });
    const bytes = fixture(); bytes.source.rows[3].value = { type: 'binary', base64: Buffer.alloc(2048).toString('base64') }; expect(bytes.capture(3).literal).toHaveLength(4096);
    bytes.source.rows[3].value = { type: 'binary', base64: Buffer.alloc(2049).toString('base64') }; const decode = vi.spyOn(globalThis, 'atob'); try { expect(() => bytes.capture(3)).toThrow(text.budget); expect(decode).not.toHaveBeenCalled(); } finally { decode.mockRestore(); }
  });
  it('总成员和最终树预算失败不返回部分选择或扩大已有OR', () => {
    const f = fixture(); f.source.rows = Array.from({ length: 129 }, (_, index) => ({ value: String(index), id: String(index), hidden: '' })); f.source.sqliteStorage!.rows = Array(129).fill('iit');
    expect(() => f.selected(Array.from({ length: 129 }, (_, index) => index))).toThrow();
    const mixed = fixture(), node = queryResultSelectedFilterNode(mixed.selected([0, 1, 2, 4]));
    const old = { mode: 'AND' as const, children: Array.from({ length: 29 }, () => ({ column: 'value', operator: 'null' as const, value: '' })) }; expect(() => appendQueryResultFilterNode(old, node)).toThrow(text.budget); expect(old.children).toHaveLength(29);
  });
});
