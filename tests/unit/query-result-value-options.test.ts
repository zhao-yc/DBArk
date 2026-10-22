import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter } from '../../src/renderer/queryResultFilter';
import { captureQueryResultValueOptions, currentQueryResultValueOptions, queryResultValueOptionLabel, queryResultValueOptionsLimits as limits, queryResultValueOptionsNode, searchQueryResultValueOptions } from '../../src/renderer/queryResultValueOptions';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';

/** 只构造内存协议值；不连接数据库或触及系统剪贴板。 */
function fixture(type = 'TEXT', values: CellValue[] = ['a', '', null, 'NULL', 'a']) {
  const source: QueryResult = { columns: [{ key: 'k', name: '同名列', type }, { key: 'other', name: '同名列', type: 'TEXT' }], rows: values.map((k, index) => ({ k, other: `行${index}` })), truncated: true, statement: 'SELECT 原文', elapsedMs: 1 };
  const capture = () => captureQueryResultValueOptions(source.columns, source.rows, source.columns[0]);
  return { source, capture };
}
/** 生成的树交回现有筛选控制器，证明没有第二套 NULL 或精度匹配语义。 */
function matches(source: QueryResult, ids: number[], mode: 'include' | 'exclude') {
  const capture = captureQueryResultValueOptions(source.columns, source.rows, source.columns[0]), node = queryResultValueOptionsNode(capture, ids, mode), filter = new QueryResultFilter(), binding = filter.bind(source, [])!;
  return filter.applyExpression(binding, filter.view(binding)!, { mode: 'AND', children: [node] }).sourceIndices;
}

describe('已返回结果不同值完整捕获', () => {
  it('保留首次出现次序和计数，NULL、空串和文本NULL互不混淆', () => {
    const f = fixture(), saved = structuredClone(f.source), capture = f.capture();
    expect(capture).toEqual({ column: f.source.columns[0], rows: 5, entries: [{ id: 0, literal: 'a', count: 2 }, { id: 1, literal: '', count: 1 }, { id: 2, literal: null, count: 1 }, { id: 3, literal: 'NULL', count: 1 }] });
    expect(f.source).toEqual(saved); expect(capture.column).not.toBe(f.source.columns[0]);
    expect(Object.isFrozen(capture)).toBe(true); expect(Object.isFrozen(capture.column)).toBe(true); expect(Object.isFrozen(capture.entries)).toBe(true); expect(capture.entries.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(f.source.columns)).toBe(false); expect(Object.isFrozen(f.source.rows)).toBe(false); expect(Object.isFrozen(f.source.rows[0])).toBe(false);
    expect(capture.entries.map(queryResultValueOptionLabel)).toEqual(['"a"', '""（空字符串）', 'NULL（空值）', '"NULL"']);
  });
  it.each([
    ['DECIMAL', ['1.0', '1.00', '+01.000', '-0.0', '000.00', '9007199254740993.000001'], ['1.0', '-0.0', '9007199254740993.000001'], [3, 2, 1]],
    ['BIGINT', ['+0001', 1, '1', '-0', '0', '9007199254740993'], ['+0001', '-0', '9007199254740993'], [3, 2, 1]],
    ['DOUBLE', [0, -0, 1e100, 1e-100], ['0', '1e+100', '1e-100'], [2, 1, 1]],
    ['DATETIME', ['2026-10-23 05:00:00.000001', '2026-10-23T05:00:00.000001', '2026-10-23 05:00:00.000002'], ['2026-10-23 05:00:00.000001', '2026-10-23 05:00:00.000002'], [2, 1]],
    ['TIME', ['-001:00:00.0', '-1:00:00.000000', '838:59:59.000001'], ['-001:00:00.0', '838:59:59.000001'], [2, 1]],
  ] as [string, CellValue[], string[], number[]][])('%s复用精确键等值，保留首个真实原文供筛选往返', (type, values, literals, counts) => {
    const f = fixture(type, values), capture = f.capture();
    expect(capture.entries.map(entry => entry.literal)).toEqual(literals); expect(capture.entries.map(entry => entry.count)).toEqual(counts);
    expect(matches(f.source, [0], 'include')).toEqual(values.map((_, index) => index).slice(0, counts[0]));
  });
  it('文本不按外观转数值、解析JSON、折叠大小写或Unicode组合形式', () => {
    const f = fixture('TEXT', ['1', '1.0', 'A', 'a', 'é', 'e\u0301', ' {"x":1} ', '{"x":1}', 'x\ny']);
    expect(f.capture().entries).toHaveLength(9); expect(matches(f.source, [0], 'include')).toEqual([0]);
  });
  it('空结果保留完整列身份且产生空候选，不能生成空成员条件', () => {
    const f = fixture('TEXT', []), capture = f.capture();
    expect(capture.rows).toBe(0); expect(capture.entries).toEqual([]); expect(searchQueryResultValueOptions(capture, '')).toEqual([]);
    expect(() => queryResultValueOptionsNode(capture, [], 'include')).toThrow(text.selection);
  });
  it('候选来自原结果全部行；另一个已筛选投影不能冒充原捕获', () => {
    const f = fixture(), capture = f.capture(), filter = new QueryResultFilter(), binding = filter.bind(f.source, [])!;
    const projection = filter.apply(binding, filter.view(binding)!, [{ column: 'k', operator: 'eq', value: 'a' }], 'AND');
    expect(capture.rows).toBe(5); expect(capture.entries).toHaveLength(4); expect(projection.result.rows).toHaveLength(2);
    expect(currentQueryResultValueOptions(capture, projection.result.columns, projection.result.rows)).toBe(false);
    expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(false);
  });
});

describe('勾选与排除的完整 NULL 补集', () => {
  it.each([
    [[0], [0, 4], [1, 2, 3]], [[1], [1], [0, 2, 3, 4]], [[2], [2], [0, 1, 3, 4]],
    [[3], [3], [0, 1, 2, 4]], [[0, 2], [0, 2, 4], [1, 3]], [[1, 2, 3], [1, 2, 3], [0, 4]], [[0, 1, 2, 3], [0, 1, 2, 3, 4], []],
  ] as [number[], number[], number[]][])('选择%s：include与exclude逐行互为补集', (ids, include, exclude) => {
    const f = fixture(); expect(matches(f.source, ids, 'include')).toEqual(include); expect(matches(f.source, ids, 'exclude')).toEqual(exclude);
  });
  it('排除普通值使用 notIn OR null，排除含NULL使用 notIn AND notNull', () => {
    const capture = fixture().capture();
    expect(queryResultValueOptionsNode(capture, [0], 'exclude')).toEqual({ mode: 'OR', children: [{ column: 'k', operator: 'notIn', value: '', values: ['a'] }, { column: 'k', operator: 'null', value: '' }] });
    expect(queryResultValueOptionsNode(capture, [0, 2], 'exclude')).toEqual({ mode: 'AND', children: [{ column: 'k', operator: 'notIn', value: '', values: ['a'] }, { column: 'k', operator: 'notNull', value: '' }] });
    expect(queryResultValueOptionsNode(capture, [2], 'include')).toEqual({ column: 'k', operator: 'null', value: '' });
    expect(queryResultValueOptionsNode(capture, [2], 'exclude')).toEqual({ column: 'k', operator: 'notNull', value: '' });
  });
  it('输出独立冻结树，不将编号或SQL加入原共享契约', () => {
    const f = fixture('TEXT', ["'); DROP TABLE t;--", null]), capture = f.capture(), node = queryResultValueOptionsNode(capture, [0, 1], 'include');
    expect(Object.isFrozen(node)).toBe(true); expect('children' in node && Object.isFrozen(node.children)).toBe(true);
    expect(node).toEqual({ mode: 'OR', children: [{ column: 'k', operator: 'in', value: '', values: ["'); DROP TABLE t;--"] }, { column: 'k', operator: 'null', value: '' }] });
    expect(f.source.statement).toBe('SELECT 原文');
  });
  it.each([[], [0, 0], [-1], [-0], [0.5], [999], [NaN], [Infinity]].map(ids => ({ ids })))('拒绝空选、重复、负零或未知编号：$ids', ({ ids }) => {
    expect(() => queryResultValueOptionsNode(fixture().capture(), ids, 'include')).toThrow();
  });
  it('最多128项且包括NULL，不能用稀疏数组或访问器隐藏编号', () => {
    const f = fixture('TEXT', [null, ...Array.from({ length: 128 }, (_, index) => String(index))]), capture = f.capture();
    expect(() => queryResultValueOptionsNode(capture, Array.from({ length: 128 }, (_, index) => index), 'include')).not.toThrow();
    expect(() => queryResultValueOptionsNode(capture, Array.from({ length: 129 }, (_, index) => index), 'include')).toThrow(text.budget);
    const getter = vi.fn(() => 0), ids = [0]; Object.defineProperty(ids, '0', { get: getter });
    expect(() => queryResultValueOptionsNode(capture, ids, 'include')).toThrow(text.invalid); expect(getter).not.toHaveBeenCalled();
    expect(() => queryResultValueOptionsNode(capture, new Array(1), 'include')).toThrow(text.invalid);
  });
});

describe('捕获当前性、坏值与完整扫描预算', () => {
  it.each(['cell', 'name', 'type', 'key', 'columnReference', 'rowReference', 'rowOrder', 'columnOrder', 'append'] as const)('%s漂移永久撤销，恢复源不能复活', change => {
    const f = fixture(), capture = f.capture(), columns = [...f.source.columns], rows = [...f.source.rows], cell = rows[0].k;
    if (change === 'cell') rows[0].k = '变化';
    else if (change === 'name' || change === 'type' || change === 'key') f.source.columns[1][change] = '变化';
    else if (change === 'columnReference') f.source.columns[0] = { ...f.source.columns[0] };
    else if (change === 'rowReference') f.source.rows[0] = { ...rows[0] };
    else if (change === 'rowOrder') f.source.rows.reverse();
    else if (change === 'columnOrder') f.source.columns.reverse();
    else f.source.rows.push({ k: '追加', other: '追加' });
    expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(false);
    f.source.columns.splice(0, f.source.columns.length, ...columns); f.source.rows.splice(0, f.source.rows.length, ...rows); rows[0].k = cell;
    expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(false);
    expect(() => queryResultValueOptionsNode(capture, [0], 'include')).toThrow(text.stale); expect(() => searchQueryResultValueOptions(capture, '')).toThrow(text.stale);
  });
  it('伪造或克隆捕获、非成员列和重复键全部拒绝', () => {
    const f = fixture(), capture = f.capture(), clone = { ...capture };
    expect(currentQueryResultValueOptions(clone, f.source.columns, f.source.rows)).toBe(false); expect(() => searchQueryResultValueOptions(clone, '')).toThrow(text.stale);
    expect(() => captureQueryResultValueOptions(f.source.columns, f.source.rows, { ...f.source.columns[0] })).toThrow(text.invalid);
    f.source.columns[1].key = 'k'; expect(f.capture).toThrow(text.invalid);
  });
  it.each(['cell', 'columnIndex', 'rowIndex', 'metadata'] as const)('拒绝%s访问器且一次也不调用', place => {
    const f = fixture(), originalColumn = f.source.columns[0], getter = vi.fn(() => '伪造');
    if (place === 'cell') Object.defineProperty(f.source.rows[0], 'k', { get: getter });
    else if (place === 'columnIndex') Object.defineProperty(f.source.columns, '0', { get: getter });
    else if (place === 'rowIndex') Object.defineProperty(f.source.rows, '0', { get: getter });
    else Object.defineProperty(f.source.columns[1], 'type', { get: getter });
    expect(() => captureQueryResultValueOptions(f.source.columns, f.source.rows, originalColumn)).toThrow(text.invalid); expect(getter).not.toHaveBeenCalled();
  });
  it('捕获后改为访问器即失效，不读取该访问器或其他列单元格', () => {
    const f = fixture(), getter = vi.fn(() => '秘密'); Object.defineProperty(f.source.rows[0], 'other', { get: getter });
    const capture = f.capture(); expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(true);
    Object.defineProperty(f.source.rows[0], 'k', { get: getter });
    expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    ['TEXT', { type: 'binary', base64: 'AA==' }], ['BLOB', { type: 'binary', base64: '' }], ['TEXT', true], ['TEXT', 1],
    ['BIT', null], ['GEOMETRY', '点'], ['BIGINT', 9007199254740992], ['DECIMAL', 1.1], ['BIGINT', '1.0'],
    ['DECIMAL UNSIGNED', '-1'], ['DOUBLE', '1.25'], ['DOUBLE', Infinity], ['DOUBLE', NaN], ['DATE', '2026-13-01'], ['TIME', '839:00:00'],
  ] as [string, CellValue][])('%s坏协议值整份拒绝：%j', (type, bad) => {
    const f = fixture(type, [bad]); expect(f.capture).toThrow(text.unsupported);
  });
  it('2000种恰好完整准入，第2001种整份拒绝', () => {
    const f = fixture('TEXT', Array.from({ length: limits.entries }, (_, index) => String(index)));
    expect(f.capture().entries).toHaveLength(limits.entries); f.source.rows.push({ k: '额外新值', other: '' }); expect(f.capture).toThrow(text.budget);
  });
  it('原行数、列数、单值长度及累计原文超限不能以前N项代替', () => {
    const f = fixture(); f.source.rows.length = limits.rows + 1; expect(f.capture).toThrow(text.budget);
    const g = fixture(); g.source.columns.length = limits.columns + 1; expect(g.capture).toThrow(text.budget);
    expect(fixture('TEXT', ['x'.repeat(limits.valueUnits + 1)]).capture).toThrow(text.budget);
    const large = fixture('TEXT', Array.from({ length: 2049 }, () => 'x'.repeat(4096))); expect(large.capture).toThrow(text.budget);
  });
  it('稀疏原数组与重复行身份不能充当完整扫描', () => {
    const f = fixture(); delete f.source.rows[2]; expect(f.capture).toThrow(text.invalid);
    const g = fixture(); g.source.rows[1] = g.source.rows[0]; expect(g.capture).toThrow(text.invalid);
  });
  it('长精确键的二分比较另受文字工作预算约束，未到原文8Mi也不能无界比较', () => {
    const values = Array.from({ length: 1000 }, (_, index) => `${'x'.repeat(2048)}${String(index).padStart(4, '0')}`);
    expect(values.reduce((sum, value) => sum + value.length, 0)).toBeLessThan(limits.units);
    expect(fixture('TEXT', values).capture).toThrow(text.budget);
  });
});

describe('有界显示文字与原文搜索', () => {
  it('返回所有匹配编号供分页，空搜索完整返回而非前一页', () => {
    const f = fixture('TEXT', Array.from({ length: 501 }, (_, index) => `条目${index}`)), capture = f.capture();
    expect(searchQueryResultValueOptions(capture, '')).toHaveLength(501); expect(searchQueryResultValueOptions(capture, '条目')).toHaveLength(501);
    expect(searchQueryResultValueOptions(capture, '条目500')).toEqual([500]); expect(Object.isFrozen(searchQueryResultValueOptions(capture, '条目'))).toBe(true);
  });
  it('按字面搜索原文及JSON标签，忽略大小写但不执行正则SQL通配符', () => {
    const f = fixture('TEXT', ['AbC', 'a%b', 'x\ny', '', null, 'NULL', '.*']), capture = f.capture();
    expect(searchQueryResultValueOptions(capture, 'abc')).toEqual([0]); expect(searchQueryResultValueOptions(capture, '%')).toEqual([1]);
    expect(searchQueryResultValueOptions(capture, '\\n')).toEqual([2]); expect(searchQueryResultValueOptions(capture, '\n')).toEqual([2]);
    expect(searchQueryResultValueOptions(capture, '空字符串')).toEqual([3]); expect(searchQueryResultValueOptions(capture, 'NULL')).toEqual([4, 5]);
    expect(searchQueryResultValueOptions(capture, '.*')).toEqual([6]); expect(searchQueryResultValueOptions(capture, '^')).toEqual([]);
  });
  it('最坏文字比较预算先完整准入，超限不返回部分匹配也不撤销有效捕获', () => {
    const f = fixture('TEXT', Array.from({ length: 100 }, (_, index) => `${index}${'x'.repeat(1000)}`)), capture = f.capture();
    expect(() => searchQueryResultValueOptions(capture, 'x'.repeat(4096))).toThrow(text.searchBudget);
    expect(() => searchQueryResultValueOptions(capture, 'x'.repeat(4097))).toThrow(text.searchBudget);
    expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows)).toBe(true); expect(searchQueryResultValueOptions(capture, 'x')).toHaveLength(100);
  });
});
