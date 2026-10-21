import { describe, expect, it, vi } from 'vitest';
import type { CellValue, DataRow, QueryResult, ResultColumn } from '../../src/shared/contracts';
import { captureQueryResultSelectedFilter, currentQueryResultSelectedFilter, queryResultSelectedFilterNode } from '../../src/renderer/queryResultSelectedFilter';
import { appendQueryResultFilterNode, appendQueryResultFilterRule, QueryResultFilter, type QueryResultFilterGroup, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { queryResultSelectedFilterZh as text } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';

/** 所有输入均为原行原列RAM对象；不读取剪贴板、文件或数据库。 */
function fixture(values: CellValue[], type = 'TEXT', selected = values.map((_, index) => index), active = 0) {
  const columns: ResultColumn[] = [{ key: 'k', name: '同名字段', type }, { key: 'other', name: '同名字段', type: 'TEXT' }];
  const rows: DataRow[] = values.map(k => ({ k, other: '另一列' })), indices = new Set(selected), cell = { index: active, row: rows[active], column: columns[0] };
  const capture = () => captureQueryResultSelectedFilter(columns, rows, cell, indices);
  return { columns, rows, indices, cell, capture };
}
/** 由正式控制器实际应用完整树，核结果原引用，不以节点对象形状代替筛选行为。 */
function controller(columns: ResultColumn[], rows: DataRow[], expression: QueryResultFilterGroup) {
  const source: QueryResult = { columns, rows, elapsedMs: 1, truncated: false, statement: 'RAM来源' }, filter = new QueryResultFilter();
  const binding = filter.bind(source, [])!; const initial = filter.view(binding)!;
  const view = filter.applyExpression(binding, initial, expression);
  return { source, filter, binding, initial, view };
}
const rule = (value: string, enabled?: boolean): QueryResultFilterRule => ({ column: 'k', operator: 'eq', value, ...(enabled === undefined ? {} : { enabled }) });
const group = (mode: 'AND' | 'OR', ...children: (QueryResultFilterRule | QueryResultFilterGroup)[]): QueryResultFilterGroup => ({ mode, children });

describe('勾选值完整原文捕获及正式筛选', () => {
  it('按显示位置去重，保留空串/NULL字样/逗号换行，活动格不自动加入勾选', () => {
    const f = fixture(['未勾活动值', 'NULL', '', '  A,\n"原文"  ', 'NULL'], 'TEXT', [4, 3, 2, 1]);
    const captured = f.capture(), node = queryResultSelectedFilterNode(captured);
    expect(captured.indices).toEqual([1, 2, 3, 4]); expect(captured.values).toEqual(['NULL', '', '  A,\n"原文"  ']); expect(captured.hasNull).toBe(false);
    expect(captured.cell.row).toBe(f.rows[0]); expect(captured.cell.column).toBe(f.columns[0]); expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen(captured.indices)).toBe(true); expect(Object.isFrozen(captured.values)).toBe(true);
    expect(node).toEqual({ column: 'k', operator: 'in', value: '', values: ['NULL', '', '  A,\n"原文"  '] });
    expect(controller(f.columns, f.rows, appendQueryResultFilterNode(group('AND'), node)).view.sourceIndices).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(f.rows)).toBe(false); expect(Object.isFrozen(f.rows[0])).toBe(false); expect(Object.isFrozen(f.columns[0])).toBe(false); expect(Object.isFrozen(f.indices)).toBe(false);
  });

  it('混合NULL生成OR(in,null)，正式控制器保留空串与NULL且不包含未勾值', () => {
    const f = fixture([null, '', 'A', null, '未勾'], 'TEXT', [3, 2, 1, 0]), captured = f.capture();
    const node = queryResultSelectedFilterNode(captured);
    expect(captured.values).toEqual(['', 'A']); expect(captured.hasNull).toBe(true);
    expect(node).toEqual(group('OR', { column: 'k', operator: 'in', value: '', values: ['', 'A'] }, { column: 'k', operator: 'null', value: '' }));
    const applied = controller(f.columns, f.rows, appendQueryResultFilterNode(group('AND'), node));
    expect(applied.view.sourceIndices).toEqual([0, 1, 2, 3]); expect(applied.view.result.rows[0]).toBe(f.rows[0]);
  });

  it.each(['BLOB', 'GEOMETRY', 'TEXT'])('%s活动格未勾且为非NULL字节，所勾全NULL仍只生成NULL条件', type => {
    const getter = vi.fn(() => { throw Error('不能读取未勾原值'); });
    const f = fixture([{ type: 'binary', base64: 'AP8=' }, null, null], type, [1, 2]);
    Object.defineProperty(f.rows[0], 'k', { get: getter, configurable: true });
    const captured = f.capture(); expect(captured.values).toEqual([]); expect(captured.hasNull).toBe(true); expect(queryResultSelectedFilterNode(captured)).toEqual({ column: 'k', operator: 'null', value: '' });
    expect(currentQueryResultSelectedFilter(captured, f.columns, f.rows)).toBe(true); expect(getter).not.toHaveBeenCalled();
    // 正式控制器的NULL判断仍要求所有原格具有可靠自有值；移除仅用于捕获隔离的访问器再开新捕获。
    Object.defineProperty(f.rows[0], 'k', { value: { type: 'binary', base64: 'AP8=' }, configurable: true, writable: true });
    expect(controller(f.columns, f.rows, appendQueryResultFilterNode(group('AND'), queryResultSelectedFilterNode(f.capture()))).view.sourceIndices).toEqual([1, 2]);
  });

  it.each([
    ['BIGINT', ['18446744073709551615', '9007199254740993']], ['DECIMAL', ['0.12345678901234567891', '0.12345678901234567890']],
    ['DATETIME', ['2026-10-20 12:00:00.123456', '2026-10-20 12:00:00.123457']], ['TIME', ['-100:00:00.000001', '-100:00:00.000002']],
    ['DOUBLE', [1.25, 2.5]]
  ] as [string, CellValue[]][])('%s逐原值往返，不经Number或Date压缩原精度', (type, values) => {
    const f = fixture([...values, null], type, [0, 1]), captured = f.capture();
    expect(captured.values).toEqual(values.map(String));
    expect(controller(f.columns, f.rows, appendQueryResultFilterNode(group('AND'), queryResultSelectedFilterNode(captured))).view.sourceIndices).toEqual([0, 1]);
  });

  it('按literal原文去重，数值相等但原文不同仍保留两项，重复显示名不参与定位', () => {
    const f = fixture(['0002', '2', '0002'], 'BIGINT'), captured = f.capture();
    expect(captured.values).toEqual(['0002', '2']); expect(captured.key).toBe('k'); expect(captured.name).toBe('同名字段');
    expect(controller(f.columns, f.rows, appendQueryResultFilterNode(group('AND'), queryResultSelectedFilterNode(captured))).view.sourceIndices).toEqual([0, 1, 2]);
  });

  it.each([['BLOB', { type: 'binary', base64: 'QQ==' }], ['GEOMETRY', '未知原值'], ['BIGINT', 9007199254740992], ['DECIMAL', '坏值'], ['DOUBLE', Infinity], ['TEXT', true], ['TEXT', undefined], ['TEXT', new Date()]] as [string, any][])('%s任一勾选坏值整份拒绝，不部分采用其它NULL或好值', (type, value) => {
    const f = fixture([null, value], type); expect(() => f.capture()).toThrow();
  });

  it('NULL算一种值，128边界完整接受，129种或后段新增第129种完整拒绝', () => {
    const full = fixture(Array.from({ length: 128 }, (_, index) => String(index)));
    expect(full.capture().values).toHaveLength(128);
    const withNull = fixture([...Array.from({ length: 127 }, (_, index) => String(index)), null]); expect(withNull.capture().values).toHaveLength(127);
    expect(() => fixture([...Array.from({ length: 128 }, (_, index) => String(index)), null]).capture()).toThrow(text.budget);
    expect(() => fixture([...Array.from({ length: 128 }, (_, index) => String(index)), ...Array(2000).fill('0'), '第129种']).capture()).toThrow(text.budget);
  });

  it('100000行重复值完整扫描且不截断，行列硬上限及8Mi总原文预算独立执行', () => {
    const repeated = fixture(Array(100000).fill('A')), captured = repeated.capture();
    expect(captured.indices).toHaveLength(100000); expect(captured.values).toEqual(['A']);
    expect(() => fixture(Array(100001).fill('A')).capture()).toThrow(text.budget);
    const exact = fixture(Array(2048).fill('A'.repeat(4096))); expect(exact.capture().values).toEqual(['A'.repeat(4096)]);
    expect(() => fixture(Array(2049).fill('A'.repeat(4096))).capture()).toThrow(text.budget);
    expect(() => fixture(['A'.repeat(4097)]).capture()).toThrow();
    const wide = fixture(['A']); while (wide.columns.length < 1024) wide.columns.push({ key: 'k' + wide.columns.length, name: '', type: '' }); expect(wide.capture().values).toEqual(['A']);
    wide.columns.push({ key: 'overflow', name: '', type: '' }); expect(() => wide.capture()).toThrow(text.budget);
  });
});

describe('捕获身份、零getter及单向撤销', () => {
  it('空勾选、伪造捕获、越界活动格或勾选索引均拒绝', () => {
    const f = fixture(['A']); f.indices.clear(); expect(() => f.capture()).toThrow();
    for (const index of [-1, 1, 1.5, NaN]) expect(() => captureQueryResultSelectedFilter(f.columns, f.rows, f.cell, new Set([index]))).toThrow();
    expect(() => captureQueryResultSelectedFilter(f.columns, f.rows, { index: 2, row: undefined as any, column: f.columns[0] }, new Set([0]))).toThrow();
    expect(currentQueryResultSelectedFilter({ ...fixture(['A']).capture() }, f.columns, f.rows)).toBe(false);
    expect(() => queryResultSelectedFilterNode({ ...fixture(['A']).capture() })).toThrow(text.stale);
  });

  it.each(['cell', 'column', 'columns', 'rows', 'value', 'inherited', 'hole'] as const)('%s访问器或缺失身份不调用getter', kind => {
    const f = fixture(['A']), getter = vi.fn(() => { throw Error('不能执行getter'); });
    if (kind === 'cell') Object.defineProperty(f.cell, 'column', { get: getter });
    if (kind === 'column') Object.defineProperty(f.columns[0], 'key', { get: getter });
    if (kind === 'columns') Object.defineProperty(f.columns, '0', { get: getter });
    if (kind === 'rows') Object.defineProperty(f.rows, '0', { get: getter });
    if (kind === 'value') Object.defineProperty(f.rows[0], 'k', { get: getter });
    if (kind === 'inherited') { const row = Object.create({ k: 'A' }); f.rows[0] = row; f.cell.row = row; }
    if (kind === 'hole') delete (f.rows as any)[0];
    expect(() => f.capture()).toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('自定义数组和Set迭代器/size getter不执行，原型形状列key仍读取自有值', () => {
    const f = fixture(['A']), getter = vi.fn(() => { throw Error('禁止自定义迭代'); });
    Object.defineProperty(f.rows, Symbol.iterator, { get: getter }); Object.defineProperty(f.columns, Symbol.iterator, { get: getter });
    Object.defineProperty(f.indices, Symbol.iterator, { get: getter }); Object.defineProperty(f.indices, 'size', { get: getter });
    const captured = f.capture(); expect(currentQueryResultSelectedFilter(captured, f.columns, f.rows)).toBe(true); expect(getter).not.toHaveBeenCalled();
    const column = { key: '__proto__', name: '原型同名', type: 'TEXT' }, row = Object.defineProperty({}, '__proto__', { value: '自有原文', enumerable: true });
    expect(captureQueryResultSelectedFilter([column], [row], { index: 0, row, column }, new Set([0])).values).toEqual(['自有原文']);
  });

  it.each(['row', 'column', 'rowOrder', 'columnOrder', 'metadata', 'value', 'selection', 'cell', 'arrayIdentity'] as const)('%s漂移一旦观测即永久失效，恢复原对象也不复活', kind => {
    const f = fixture(['A', 'B']), captured = f.capture(), originalRow = f.rows[0], originalColumn = f.columns[0];
    if (kind === 'row') f.rows[0] = { ...originalRow };
    if (kind === 'column') f.columns[0] = { ...originalColumn };
    if (kind === 'rowOrder') f.rows.reverse();
    if (kind === 'columnOrder') f.columns.reverse();
    if (kind === 'metadata') originalColumn.name = '改名';
    if (kind === 'value') originalRow.k = '后来原值';
    if (kind === 'selection') f.indices.delete(1);
    if (kind === 'cell') f.cell.index = 1;
    expect(currentQueryResultSelectedFilter(captured, kind === 'arrayIdentity' ? [...f.columns] : f.columns, f.rows)).toBe(false);
    if (kind === 'row') f.rows[0] = originalRow; if (kind === 'column') f.columns[0] = originalColumn;
    if (kind === 'rowOrder') f.rows.reverse(); if (kind === 'columnOrder') f.columns.reverse();
    originalColumn.name = captured.name; originalRow.k = 'A'; f.indices.add(1); f.cell.index = 0;
    expect(currentQueryResultSelectedFilter(captured, f.columns, f.rows)).toBe(false); expect(() => queryResultSelectedFilterNode(captured)).toThrow(text.stale);
  });

  it('捕获后改成原值getter也不执行；未勾活动格值变化不误作勾选来源', () => {
    const f = fixture(['未勾', 'A'], 'TEXT', [1]), captured = f.capture(), getter = vi.fn(() => 'A');
    f.rows[0].k = '另一个未勾值'; expect(currentQueryResultSelectedFilter(captured, f.columns, f.rows)).toBe(true);
    Object.defineProperty(f.rows[1], 'k', { get: getter }); expect(currentQueryResultSelectedFilter(captured, f.columns, f.rows)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
});

describe('完整节点AND追加与正式树预算', () => {
  it('旧OR保持括号，混合NULL子组按整体AND追加，停用原值和旧投影保持', () => {
    const f = fixture(['A', null, 'B']), old = group('OR', rule('A'), { ...rule('未完成草稿', false), ignoreCase: true });
    const applied = controller(f.columns, f.rows, old), capture = captureQueryResultSelectedFilter(f.columns, f.rows, f.cell, new Set([0, 1]));
    const node = queryResultSelectedFilterNode(capture), next = appendQueryResultFilterNode(applied.view.expression, node);
    expect(next).toEqual(group('AND', old, node)); expect(applied.filter.view(applied.binding)).toBe(applied.view); expect(applied.view.sourceIndices).toEqual([0]);
    expect(applied.filter.applyExpression(applied.binding, applied.view, next).sourceIndices).toEqual([0]);
    expect(Object.isFrozen(next)).toBe(true); expect(Object.isFrozen((next.children[1] as QueryResultFilterGroup).children)).toBe(true);
  });

  it('旧AND不额外嵌套；单格旧入口复用节点语义且列表数组独立冻结', () => {
    const values = ['A', 'B'], initial = group('AND', { column: 'k', operator: 'in', value: '', values }), next = appendQueryResultFilterRule(initial, rule('A'));
    values[0] = '后来改值'; expect((next.children[0] as QueryResultFilterRule).values).toEqual(['A', 'B']); expect(Object.isFrozen((next.children[0] as QueryResultFilterRule).values)).toBe(true);
    expect(next).toEqual(group('AND', { column: 'k', operator: 'in', value: '', values: ['A', 'B'] }, rule('A')));
  });

  it('混合节点两条叶共同计32条预算，恰好32可正式应用，33拒绝且保留旧投影', () => {
    const f = fixture(['A', null]), node = queryResultSelectedFilterNode(f.capture());
    const fit = controller(f.columns, f.rows, group('AND', ...Array.from({ length: 30 }, () => rule('A', false))));
    expect(fit.filter.applyExpression(fit.binding, fit.view, appendQueryResultFilterNode(fit.view.expression, node)).sourceIndices).toEqual([0, 1]);
    const full = controller(f.columns, f.rows, group('AND', ...Array.from({ length: 31 }, () => rule('A', false))));
    expect(() => appendQueryResultFilterNode(full.view.expression, node)).toThrow(); expect(full.filter.view(full.binding)).toBe(full.view);
  });

  it('16组与8层按最终组合树计费，不能先验各半后绕过总预算', () => {
    const f = fixture(['A', null]), node = queryResultSelectedFilterNode(f.capture());
    const many = controller(f.columns, f.rows, group('OR', ...Array.from({ length: 14 }, () => group('AND', rule('A')))));
    expect(() => appendQueryResultFilterNode(many.view.expression, node)).toThrow(); expect(many.filter.view(many.binding)).toBe(many.view);
    let nested = group('OR', rule('A')); for (let index = 1; index < 8; index++) nested = group('OR', nested);
    const deep = controller(f.columns, f.rows, nested); expect(() => appendQueryResultFilterNode(deep.view.expression, node)).toThrow(); expect(deep.filter.view(deep.binding)).toBe(deep.view);
    let seven = group('OR', rule('A')); for (let index = 1; index < 7; index++) seven = group('OR', seven);
    const eighth = controller(f.columns, f.rows, seven); expect(eighth.filter.applyExpression(eighth.binding, eighth.view, appendQueryResultFilterNode(eighth.view.expression, node)).sourceIndices).toEqual([0]);
    const fit = controller(f.columns, f.rows, group('AND', ...Array.from({ length: 14 }, () => group('AND', rule('A', false)))));
    expect(fit.filter.applyExpression(fit.binding, fit.view, appendQueryResultFilterNode(fit.view.expression, node)).sourceIndices).toEqual([0, 1]);
  });

  it('节点条件/成员getter与自定义迭代器不执行，不冻结旧树原数组', () => {
    const getter = vi.fn(() => { throw Error('禁止getter'); }), members = ['A']; Object.defineProperty(members, Symbol.iterator, { get: getter });
    const expression = group('AND', { column: 'k', operator: 'in', value: '', values: members });
    expect((appendQueryResultFilterNode(expression, rule('A')).children[0] as QueryResultFilterRule).values).toEqual(['A']); expect(Object.isFrozen(members)).toBe(false); expect(getter).not.toHaveBeenCalled();
    Object.defineProperty(members, '0', { get: getter }); expect(() => appendQueryResultFilterNode(expression, rule('A'))).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});
