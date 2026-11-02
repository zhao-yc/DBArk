import type { TableInfo } from '../shared/contracts';
import { tableStatisticsLimits, tableStatisticsMessages, type TableStatisticsInput } from '../shared/tableStatistics';
import { assertTableHistogram, tableHistogramMessages as text, tableHistogramRanges, tableHistogramSchema, tableHistogramType, type TableHistogram, type TableHistogramRequest } from '../shared/tableHistogram';
import { buildTableFilterSql, identifier, inlineParameters, qualified } from './sql';

export interface TableHistogramPlan { sql: string; aliases: string[]; }
/** 元数据列白名单决定唯一表达式；BIT先转无符号，不能把二进制字节隐式当小浮点数。 */
function target(source: TableInfo, request: TableHistogramRequest): { value: string; type: string; approximate: boolean } {
  const fields = source.columns.filter(column => column.name === request.column);
  if (source.objectKind !== 'table' || fields.length !== 1) throw Error(text.invalid);
  const type = fields[0].type, value = identifier(request.column), { approximate } = tableHistogramType(type);
  return { type, approximate, value: /^BIT\b/i.test(type.trim()) ? `CAST(${value} AS UNSIGNED)` : value };
}
/** 固定聚合投影复用原筛选编译器，不接受渲染层SQL、类型正文或自定义边界。 */
function sql(source: TableInfo, input: TableStatisticsInput, selectors: string[]): string {
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup);
  const statement = inlineParameters(`SELECT ${selectors.join(',')} FROM ${qualified(source.database, source.name)}${filter.where ? ' WHERE ' + filter.where : ''}`, filter.params);
  if (Buffer.byteLength(statement) > tableStatisticsLimits.bytes) throw Error(tableStatisticsMessages.budget); return statement;
}
/** MIN/MAX原十进制文本与非空数在原只读事务取得，不计算可能溢出的SUM/AVG。 */
export function planTableHistogramBounds(source: TableInfo, input: TableStatisticsInput): TableHistogramPlan {
  const request = tableHistogramSchema.parse(input.histogram), { value, approximate } = target(source, request), aliases = ['h_nonNull', 'h_nulls', 'h_min', 'h_max'];
  // FLOAT的CHAR显示可能只保留较少位；浮点极值使用原binary协议数值，再生成可往返的DOUBLE字面量。
  return { aliases, sql: sql(source, input, [`CAST(COUNT(${value}) AS CHAR) AS h_nonNull`, `CAST(COUNT(*)-COUNT(${value}) AS CHAR) AS h_nulls`, `${approximate ? `MIN(${value})` : `CAST(MIN(${value}) AS CHAR)`} AS h_min`, `${approximate ? `MAX(${value})` : `CAST(MAX(${value}) AS CHAR)`} AS h_max`]) };
}
/** 只用本轮极值产生的有限数值字面量；浮点边界显式为近似字面量，绝不把精确列改成浮点运算。 */
function literal(value: string, approximate: boolean): string {
  if (typeof value !== 'string' || value.length > 256 || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) || !approximate && /e/i.test(value)) throw Error(text.invalid);
  return approximate && !/e/i.test(value) ? value + 'e0' : value;
}
/** 单个有界聚合SELECT统计所有连续区间；额外范围计数不能把并发越界行默默丢掉。 */
export function planTableHistogramCounts(source: TableInfo, input: TableStatisticsInput, histogram: TableHistogram): TableHistogramPlan {
  const request = tableHistogramSchema.parse(input.histogram), { value, approximate, type } = target(source, request);
  if (histogram.min === null || histogram.max === null || !histogram.ranges.length) throw Error(text.invalid);
  const expected = tableHistogramRanges(type, request.bins, histogram.min, histogram.max);
  if (histogram.column !== request.column || histogram.type !== type || histogram.approximate !== approximate || histogram.requestedBins !== request.bins || JSON.stringify(histogram.ranges.map(({ lower, upper, upperInclusive }) => ({ lower, upper, upperInclusive }))) !== JSON.stringify(expected)) throw Error(text.invalid);
  const expressions = [`COUNT(${value})`, `COUNT(*)-COUNT(${value})`, `COUNT(CASE WHEN ${value}<${literal(histogram.min, approximate)} OR ${value}>${literal(histogram.max, approximate)} THEN 1 END)`];
  for (const range of histogram.ranges) expressions.push(`COUNT(CASE WHEN ${value}>=${literal(range.lower, approximate)} AND ${value}${range.upperInclusive ? '<=' : '<'}${literal(range.upper, approximate)} THEN 1 END)`);
  const aliases = ['h_nonNull', 'h_nulls', 'h_outside', ...histogram.ranges.map((_, index) => 'h_bin' + index)];
  return { aliases, sql: sql(source, input, expressions.map((expression, index) => `CAST(${expression} AS CHAR) AS ${identifier(aliases[index])}`)) };
}
const count = (value: unknown): string => { if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(value)) throw Error(text.invalid); return value; };
/** 完整极值先绑定准确列及模式；零非空值保留NULL，不生成假零区间。 */
export function decodeTableHistogramBounds(source: TableInfo, request: TableHistogramRequest, values: unknown[], rowCount: string): TableHistogram {
  const { type, approximate } = target(source, tableHistogramSchema.parse(request));
  if (values.length !== 4) throw Error(text.invalid);
  const nonNull = count(values[0]), nulls = count(values[1]); if (BigInt(nonNull) + BigInt(nulls) !== BigInt(count(rowCount))) throw Error(text.changed);
  const numeric = (value: unknown) => approximate && typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  const min = numeric(values[2]), max = numeric(values[3]);
  if (nonNull === '0' ? min !== null || max !== null : typeof min !== 'string' || typeof max !== 'string') throw Error(text.invalid);
  const ranges = min === null ? [] : tableHistogramRanges(type, request.bins, min as string, max as string).map(range => ({ ...range, count: '0' }));
  return { column: request.column, type, requestedBins: request.bins, approximate, min: min as string | null, max: max as string | null, nonNull, nulls, ranges };
}
/** 区间总数、原行数、原非空/NULL及范围探针同时成立才发布，不把迟到分布拼到旧极值上。 */
export function decodeTableHistogramCounts(histogram: TableHistogram, values: unknown[], rowCount: string): TableHistogram {
  if (values.length !== histogram.ranges.length + 3 || count(values[0]) !== histogram.nonNull || count(values[1]) !== histogram.nulls || count(values[2]) !== '0') throw Error(text.changed);
  const result = { ...histogram, ranges: histogram.ranges.map((range, index) => ({ ...range, count: count(values[index + 3]) })) };
  assertTableHistogram(result, { column: result.column, bins: result.requestedBins }, { name: result.column, type: result.type }, rowCount); return result;
}
