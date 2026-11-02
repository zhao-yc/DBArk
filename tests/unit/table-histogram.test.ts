import { describe, expect, it } from 'vitest';
import { tableHistogramRanges, assertTableHistogram, type TableHistogram, type TableHistogramRequest } from '../../src/shared/tableHistogram';
import { planTableHistogramBounds, planTableHistogramCounts, decodeTableHistogramBounds, decodeTableHistogramCounts } from '../../src/engine/tableHistogram';
import { validateCommand } from '../../src/shared/validation';
import type { TableInfo } from '../../src/shared/contracts';
import type { TableStatisticsInput } from '../../src/shared/tableStatistics';
import { TableStatisticsIntent } from '../../src/renderer/tableStatisticsIntent';
import { checkTableStatisticsOutput } from '../../src/renderer/tableStatisticsResult';

const source: TableInfo = { database: 'db`a', name: 'subject`b', objectKind: 'table', engine: 'InnoDB', columns: [['big', 'BIGINT UNSIGNED'], ['amount', 'DECIMAL(65,30)'], ['f', 'FLOAT'], ['bits', 'BIT(64)'], ['name', 'VARCHAR(80)']].map(([name, type]) => ({ name, type, nullable: true, defaultValue: null, generated: false, extra: '', comment: '' })), primaryKey: [], editableKey: [], foreignKeys: [], indexes: [], ddl: '合成目录' };
const request: TableHistogramRequest = { column: 'big', bins: 5 };
const input: TableStatisticsInput = { connectionId: 'c', database: source.database, table: source.name, taskId: 'hist', columns: [], filters: [], histogram: request };
/** 目录、手写极值和数量与规划器分开，真实服务器语义另有只读派生表验收。 */
function bounds(column = 'big', min: string | number | null = '0', max: string | number | null = '100', nonNull = '10', nulls = '1', bins: TableHistogramRequest['bins'] = 5) { return decodeTableHistogramBounds(source, { column, bins }, [nonNull, nulls, min, max], (BigInt(nonNull) + BigInt(nulls)).toString()); }
describe('全表数值直方图区间', () => {
  it('UINT64最大值精确切分，SQL中不出现浮点字面量、数据分页或客户端行读取', () => {
    const ranges = tableHistogramRanges('BIGINT UNSIGNED', 5, '0', '18446744073709551615');
    expect(ranges.map(range => range.lower)).toEqual(['0', '3689348814741910323', '7378697629483820646', '11068046444225730969', '14757395258967641292']); expect(ranges.at(-1)).toEqual({ lower: '14757395258967641292', upper: '18446744073709551615', upperInclusive: true });
    const histogram = bounds('big', '0', '18446744073709551615'), plan = planTableHistogramCounts(source, input, histogram);
    expect(plan.sql).toContain('>=14757395258967641292 AND `big`<=18446744073709551615'); expect(plan.sql).not.toMatch(/\d[eE][+-]?\d|LIMIT|OFFSET|SELECT \*|SUM\(/); expect(plan.aliases).toHaveLength(8);
  });
  it('负区间和30位DECIMAL按原单位向上量化，边界连续且不通过浮点数', () => {
    expect(tableHistogramRanges('DECIMAL(65,30)', 5, '-10', '10').map(range => range.lower)).toEqual(['-10', '-6', '-2', '2', '6'].map(value => value + '.' + '0'.repeat(30)));
    const prefix = '0.' + '0'.repeat(29), ranges = tableHistogramRanges('DECIMAL(65,30)', 5, '-' + prefix + '3', prefix + '3');
    expect(ranges.map(range => range.lower)).toEqual(['-' + prefix + '3', '-' + prefix + '1', prefix + '0', prefix + '1', prefix + '2']); expect(ranges.at(-1)?.upper).toBe(prefix + '3');
  });
  it('常量只有一个闭区间，原精度只有两个值时20个目标区间减少为两个', () => {
    expect(tableHistogramRanges('INT', 10, '7', '7')).toEqual([{ lower: '7', upper: '7', upperInclusive: true }]);
    expect(tableHistogramRanges('BIGINT', 20, '9007199254740993', '9007199254740994')).toEqual([{ lower: '9007199254740993', upper: '9007199254740994', upperInclusive: false }, { lower: '9007199254740994', upper: '9007199254740994', upperInclusive: true }]);
  });
  it('原声明小数位决定可表示单位，整数极值不使DECIMAL丢掉中间小数；不可能的原类型范围拒绝', () => {
    expect(tableHistogramRanges('DECIMAL(10,2)', 5, '0', '1').map(range => range.lower)).toEqual(['0.00', '0.20', '0.40', '0.60', '0.80']);
    expect(() => tableHistogramRanges('INT', 5, '0.1', '1')).toThrow(); expect(() => tableHistogramRanges('DECIMAL(3,2)', 5, '0', '10')).toThrow(); expect(() => tableHistogramRanges('DECIMAL(3,2)', 5, '0.001', '1')).toThrow();
  });
  it('浮点极值走binary原数值，极大异号范围不因max-min溢出而丢掉分布', () => {
    const min = Math.fround(.1), max = Math.fround(.2), histogram = bounds('f', min, max), plan = planTableHistogramBounds(source, { ...input, histogram: { column: 'f', bins: 5 } });
    expect(histogram.min).toBe(String(min)); expect(histogram.max).toBe(String(max)); expect(histogram.approximate).toBe(true); expect(plan.sql).toContain('MIN(`f`) AS h_min'); expect(plan.sql).not.toContain('CAST(MIN');
    const extreme = tableHistogramRanges('DOUBLE', 5, String(-Number.MAX_VALUE), String(Number.MAX_VALUE)); expect(extreme).toHaveLength(5); expect(extreme.every(range => Number.isFinite(Number(range.lower)) && Number.isFinite(Number(range.upper)))).toBe(true);
    const adjacent = tableHistogramRanges('DOUBLE', 20, '1', String(1 + Number.EPSILON)); expect(adjacent).toEqual([{ lower: '1', upper: String(1 + Number.EPSILON), upperInclusive: true }]);
  });
  it('BIT使用显式UNSIGNED，筛选与嵌套/停用保持，显示选择不改变其它统计列', () => {
    const specific = { ...input, histogram: { column: 'bits', bins: 5 as const }, filters: [{ column: 'name', operator: '=' as const, value: "' OR 1=1 --" }, { column: 'big', operator: '=' as const, value: '3', enabled: false }], filterMode: 'all' as const, filterGroup: { mode: 'all' as const, children: [0, 1] } }, plan = planTableHistogramBounds(source, specific);
    expect(plan.sql).toContain('MIN(CAST(`bits` AS UNSIGNED))'); expect(plan.sql).toContain('FROM `db``a`.`subject``b` WHERE'); expect(plan.sql).not.toContain("' OR 1=1 --"); expect(specific.columns).toEqual([]);
  });
  it.each(['VARCHAR(80)', 'JSON', 'BLOB', 'DATE', 'POINT'])('%s不被文本原值或显示名称升级为数值', type => { expect(() => tableHistogramRanges(type, 5, '0', '100')).toThrow(); });
  it.each([['NaN', '1'], ['0', 'Infinity'], ['2', '1'], ['0;SELECT 1', '2'], ['1e10000000', '2']])('坏范围%j不能成为SQL片段', (min, max) => { expect(() => tableHistogramRanges('DOUBLE', 5, min, max)).toThrow(); expect(() => tableHistogramRanges('DECIMAL(65,30)', 5, min, max)).toThrow(); });
});
describe('完整分布计数与来源', () => {
  it('NULL和空集不造区间，原大整数计数不转换Number', () => {
    const empty = bounds('big', null, null, '0', '18446744073709551615'); expect(empty.ranges).toEqual([]); assertTableHistogram(empty, request, { name: 'big', type: 'BIGINT UNSIGNED' }, '18446744073709551615');
    const value = bounds('big', '7', '7', '18446744073709551615', '0'); expect(decodeTableHistogramCounts(value, ['18446744073709551615', '0', '0', '18446744073709551615'], '18446744073709551615').ranges[0].count).toBe('18446744073709551615');
  });
  it('边界上每行只进一个区间，零数量区间保留并核对总数', () => {
    const value = decodeTableHistogramCounts(bounds(), ['10', '1', '0', '2', '0', '3', '4', '1'], '11'); expect(value.ranges.map(range => range.count)).toEqual(['2', '0', '3', '4', '1']);
    assertTableHistogram(value, request, { name: 'big', type: 'BIGINT UNSIGNED' }, '11');
  });
  it.each([['11', '1', '0', '2', '0', '3', '4', '1'], ['10', '2', '0', '2', '0', '3', '4', '1'], ['10', '1', '1', '2', '0', '3', '4', '1'], ['10', '1', '0', '2', '0', '3', '4', '2'], ['10', '1', '0', '0', '2', '3', '4', '1'], ['10', '1', '0', '2', '0', '3', '5', '0']].map(values => ({ values })))('数量或范围探针矛盾%j整份拒绝', ({ values }) => { expect(() => decodeTableHistogramCounts(bounds(), values, '11')).toThrow(); });
  it('列、区间顺序、闭开规则和请求绑定，不能拼接另一列或模式的成功回包', () => {
    const value = decodeTableHistogramCounts(bounds(), ['10', '1', '0', '2', '0', '3', '4', '1'], '11');
    for (const mutate of [(v: TableHistogram) => { v.column = 'amount'; }, (v: TableHistogram) => { v.requestedBins = 10; }, (v: TableHistogram) => { v.ranges[0].upperInclusive = true; }, (v: TableHistogram) => { v.ranges.reverse(); }, (v: TableHistogram) => { v.approximate = true; }]) { const changed = structuredClone(value); mutate(changed); expect(() => assertTableHistogram(changed, request, { name: 'big', type: 'BIGINT UNSIGNED' }, '11')).toThrow(); }
  });
  it('原Main合同仅增加明确字段和5/10/20枚举，拒绝任意边界/SQL/非法列及视图', () => {
    expect(validateCommand('table.statistics', input)).toEqual(input);
    for (const histogram of [{ column: 'big', bins: 6 }, { ...request, boundaries: [0, 100] }, { ...request, sql: 'SELECT 1' }, { ...request, bins: '5' }, { column: '', bins: 5 }]) expect(() => validateCommand('table.statistics', { ...input, histogram })).toThrow();
    expect(() => planTableHistogramBounds(source, { ...input, histogram: { column: 'name', bins: 5 } })).toThrow(); expect(() => planTableHistogramBounds({ ...source, objectKind: 'view' }, input)).toThrow();
  });
  it('渲染回执核准确源及显式请求，未请求的分布和错计数不显示', () => {
    const intent = new TableStatisticsIntent(source, { filters: [], filterMode: 'all' }, [source], () => true), histogram = decodeTableHistogramCounts(bounds(), ['10', '1', '0', '2', '0', '3', '4', '1'], '11');
    const output = { source, sourceDigest: 'a'.repeat(64), rowCount: '11', columns: [], warnings: [], histogram };
    checkTableStatisticsOutput(intent, [], output, false, request); expect(() => checkTableStatisticsOutput(intent, [], output)).toThrow(); expect(() => checkTableStatisticsOutput(intent, [], output, false, { column: 'amount', bins: 5 })).toThrow();
  });
});
