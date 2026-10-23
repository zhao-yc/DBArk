import { describe, expect, it, vi } from 'vitest';
import type { CellValue, FilterRule, TableInfo } from '../../src/shared/contracts';
import type { TableValueOptionsOutput } from '../../src/shared/tableValueOptions';
import { buildTableValueOptionsConditions as build, checkTableValueOptionsOutput, tableValueOptionsLiteral, type TableValueOptionsConditions } from '../../src/renderer/tableValueOptionsUi';

const empty: TableValueOptionsConditions = { filters: [], filterMode: 'all' };
const source: TableInfo = { database: 'd', name: 't', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE t(a TEXT)', columns: [{ name: 'a', type: 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [], primaryKey: [], editableKey: [], foreignKeys: [] };
const output = (values: CellValue[] = ['a']): TableValueOptionsOutput => ({ source: structuredClone(source), sourceDigest: 'a'.repeat(64), column: 'a', values: values.map(value => ({ value, count: '9007199254740993' })), truncated: false, warnings: ['服务器排序规则分组'] });

describe('服务器不同值完整表页条件提案', () => {
  it.each([
    { values: ['a'], exclude: false, mode: 'all', rules: [{ column: 'a', operator: 'IN', values: ['a'] }] },
    { values: [null], exclude: false, mode: 'all', rules: [{ column: 'a', operator: 'IS NULL' }] },
    { values: ['a', null], exclude: false, mode: 'any', rules: [{ column: 'a', operator: 'IN', values: ['a'] }, { column: 'a', operator: 'IS NULL' }] },
    { values: ['a'], exclude: true, mode: 'any', rules: [{ column: 'a', operator: 'NOT IN', values: ['a'] }, { column: 'a', operator: 'IS NULL' }] },
    { values: [null], exclude: true, mode: 'all', rules: [{ column: 'a', operator: 'IS NOT NULL' }] },
    { values: ['a', null], exclude: true, mode: 'all', rules: [{ column: 'a', operator: 'NOT IN', values: ['a'] }, { column: 'a', operator: 'IS NOT NULL' }] },
  ])('包含/排除集合及NULL互为完整补集 $values / $exclude', ({ values, exclude, mode, rules }) => {
    const result = build(empty, 'a', values, exclude);
    expect(result.filters).toEqual(rules); expect(result.filterMode).toBe(mode); expect(result.filterGroup).toEqual({ mode, children: rules.map((_, index) => index) });
  });
  it('旧OR和嵌套、停用、原值均整体AND新增集合，输入不变且提案深冻结', () => {
    const filters: FilterRule[] = [{ column: 'x', operator: '=', value: '原值', enabled: false }, { column: 'y', operator: 'IS NULL' }, { column: 'z', operator: '=', value: 'z' }];
    const original: TableValueOptionsConditions = { filters, filterMode: 'any', filterGroup: { mode: 'any', children: [0, { mode: 'all', children: [1, 2] }] } }, before = structuredClone(original);
    const result = build(original, 'a', ['line1\nline2', null], false);
    expect(original).toEqual(before); expect(result.filters.slice(0, 3)).toEqual(filters);
    expect(result.filterGroup).toEqual({ mode: 'all', children: [original.filterGroup, { mode: 'any', children: [3, 4] }] });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.filters)).toBe(true); expect(Object.isFrozen(result.filters[3].values)).toBe(true); expect(Object.isFrozen(result.filterGroup!.children)).toBe(true);
  });
  it('空串、文本NULL、逗号、引号、CRLF、大整数和decimal字面原样保留', () => {
    const values = ['', 'NULL', 'a,b', 'a\r\nb', '"q"', '9007199254740993', '1.00000000000000000001'];
    expect(build(empty, 'a', values, false).filters[0].values).toEqual(values);
  });
  it('旧all根扁平追加避免无必要增加深度', () => { expect(build({ filters: [{ column: 'x', operator: '=', value: 'x' }], filterMode: 'all' }, 'a', ['a'], false).filterGroup).toEqual({ mode: 'all', children: [0, 1] }); });
  it('完整200值允许，第201值整份拒绝', () => { expect(build(empty, 'a', Array.from({ length: 200 }, (_, i) => String(i)), false).filters[0].values).toHaveLength(200); expect(() => build(empty, 'a', Array.from({ length: 201 }, (_, i) => String(i)), false)).toThrow(); });
  it('空选择和重复原值不被静默清理', () => { expect(() => build(empty, 'a', [], false)).toThrow(); expect(() => build(empty, 'a', ['a', 'a'], false)).toThrow(); expect(() => build(empty, 'a', [null, null], false)).toThrow(); });
  it('原30条件不被截断，新成员超预算时保持原对象', () => { const original: TableValueOptionsConditions = { filters: Array.from({ length: 30 }, () => ({ column: 'x', operator: 'IS NULL' })), filterMode: 'all' }; const before = structuredClone(original); expect(() => build(original, 'a', ['a'], false)).toThrow('预算'); expect(original).toEqual(before); });
  it('大文本候选可完整校验展示，但超过4096值不能写入规则', () => { const value = 'a'.repeat(4097); expect(() => checkTableValueOptionsOutput(source, 'a', '', output([value]))).not.toThrow(); expect(tableValueOptionsLiteral(value)).toBe(value); expect(() => build(empty, 'a', [value], false)).toThrow('预算'); });
  it.each([NaN, Infinity, { type: 'binary', base64: 'YQ==' }])('不可表示值原子拒绝 %j', value => { expect(() => build(empty, 'a', [value as CellValue], false)).toThrow(); });
  it('超safeinteger的原有限浮点只在原字段确为浮点时保留roundtrip原文', () => { const value = 1e30; expect(() => build(empty, 'a', [value], false)).toThrow(); expect(() => build(empty, 'a', [value], false, 'BIGINT')).toThrow(); expect(build(empty, 'a', [value], false, 'DOUBLE').filters[0].values).toEqual(['1e+30']); });
  it('稀疏、访问器、额外字段和自定义iterator不能偷换勾选值', () => {
    const getter = vi.fn(() => 'a'), values = ['a']; Object.defineProperty(values, '0', { get: getter }); expect(() => build(empty, 'a', values, false)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => build(empty, 'a', Array(1), false)).toThrow(); expect(() => build(empty, 'a', Object.assign(['a'], { extra: true }), false)).toThrow();
  });
  it('条件getter不被执行，继承字段也不能变成空筛选', () => { const getter = vi.fn(() => []); expect(() => build(Object.defineProperty({ filterMode: 'all' }, 'filters', { get: getter }) as TableValueOptionsConditions, 'a', ['a'], false)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => build(Object.create(empty), 'a', ['a'], false)).toThrow(); });
});
describe('不同值服务回执源绑定', () => {
  it('精确大计数保留string，输出不修改', () => { const result = output([null, '', 'NULL']); const before = structuredClone(result); expect(() => checkTableValueOptionsOutput(source, 'a', '', result)).not.toThrow(); expect(result).toEqual(before); });
  it.each(['database', 'name', 'engine', 'comment'])('同名回包的完整源元数据漂移拒绝 %s', key => { const result = output(); Reflect.set(result.source, key, 'changed'); expect(() => checkTableValueOptionsOutput(source, 'a', '', result)).toThrow(); });
  it('DDL计数变化不替代完整元数据身份', () => { const result = output(); result.source.ddl += ' AUTO_INCREMENT=9'; expect(() => checkTableValueOptionsOutput(source, 'a', '', result)).not.toThrow(); });
  it('另列、另搜索、重复候选、无效计数、截断不足500整份拒绝', () => {
    for (const result of [Object.assign(output(), { column: 'b' }), Object.assign(output(), { searchPattern: '%' }), output(['a', 'a']), Object.assign(output(), { truncated: true })]) expect(() => checkTableValueOptionsOutput(source, 'a', '', result)).toThrow();
    const result = output(); result.values[0].count = '0'; expect(() => checkTableValueOptionsOutput(source, 'a', '', result)).toThrow();
  });
});
