import { z } from 'zod';
import { tableStatisticsColumnKind } from './tableStatistics';

export const tableHistogramSchema = z.object({ column: z.string().min(1).max(512).refine(value => !value.includes('\0')), bins: z.union([z.literal(5), z.literal(10), z.literal(20)]) }).strict();
export type TableHistogramRequest = z.infer<typeof tableHistogramSchema>;
export interface TableHistogramRange { lower: string; upper: string; upperInclusive: boolean; count: string; }
export interface TableHistogram {
  column: string; type: string; requestedBins: 5 | 10 | 20; approximate: boolean;
  min: string | null; max: string | null; nonNull: string; nulls: string; ranges: TableHistogramRange[];
}
export const tableHistogramMessages = {
  invalid: '数值分布的字段、区间或计数无效，未发布部分分布。',
  changed: '分布读取期间行数、非空数或极值范围已变化，未发布不完整分布；请重新统计。',
  scope: '分布使用同一独立只读事务，覆盖当前服务器筛选的全部匹配行；NULL单独计数，不进入数值区间。非事务表或非确定性视图无法保证快照一致性。',
};
const fail = (): never => { throw Error(tableHistogramMessages.invalid); };
/** 只有已证明的数值类型可建立分布，不能通过列显示名称或原值文本猜测。 */
export function tableHistogramType(type: string): { approximate: boolean } {
  if (tableStatisticsColumnKind(type) !== 'numeric') return fail();
  return { approximate: /^(?:FLOAT|DOUBLE|REAL)\b/i.test(type.trim()) };
}
/** 十进制原文转有界整数单位；不把BIGINT/DECIMAL、BIT64或负值交给Number。 */
function decimal(value: string): { units: bigint; scale: number } {
  if (typeof value !== 'string' || value.length > 132 || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return fail();
  const negative = value.startsWith('-'), parts = value.replace(/^[+-]/, '').split('.'), scale = parts[1]?.length ?? 0, digits = (parts[0] + (parts[1] ?? '')).replace(/^0+/, '') || '0';
  if (scale > 65 || digits.length > 65) return fail();
  return { units: BigInt((negative ? '-' : '') + digits), scale };
}
/** 生成可以直接证明为精确数值字面量的原精度字符串；不增加数据库不支持的小数位。 */
function format(units: bigint, scale: number): string {
  const sign = units < 0n ? '-' : '', digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const value = sign + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
  if (digits.replace(/^0+/, '').length > 65) return fail(); return value;
}
/** 区间边界由极值决定，邻接连续、最后含上界；精度不足时减少区间，不伪造重复边界。 */
export function tableHistogramRanges(type: string, bins: TableHistogramRequest['bins'], minimum: string, maximum: string): Omit<TableHistogramRange, 'count'>[] {
  if (![5, 10, 20].includes(bins)) return fail();
  const { approximate } = tableHistogramType(type); let low: string, high: string, cuts: string[] = [];
  if (approximate) {
    if ([minimum, maximum].some(value => typeof value !== 'string' || value.length > 256 || !/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) return fail();
    const min = Number(minimum), max = Number(maximum); if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return fail();
    low = String(min); high = String(max); let before = min;
    for (let index = 1; index < bins && min !== max; index++) {
      const ratio = index / bins, span = max - min, next = Number.isFinite(span) ? min + span * ratio : min * (1 - ratio) + max * ratio;
      if (!Number.isFinite(next)) return fail(); if (next > before && next < max) { cuts.push(String(next)); before = next; }
    }
  } else {
    const min = decimal(minimum), max = decimal(maximum), decimalType = /^(?:DECIMAL|NUMERIC|FIXED)\b/i.test(type.trim()), declaration = /^(?:DECIMAL|NUMERIC|FIXED)\((\d+)(?:,\s*(\d+))?\)/i.exec(type.trim());
    const declaredScale = declaration ? Number(declaration[2] ?? 0) : 0;
    if (!decimalType && (min.scale || max.scale) || declaration && (Number(declaration[1]) < 1 || Number(declaration[1]) > 65 || declaredScale > Number(declaration[1]) || min.scale > declaredScale || max.scale > declaredScale)) return fail();
    // 列声明精度才是可表示单位；极值恰为整数也不能把DECIMAL退化成整数区间。
    const scale = Math.max(min.scale, max.scale, declaredScale), start = min.units * 10n ** BigInt(scale - min.scale), end = max.units * 10n ** BigInt(scale - max.scale);
    if (declaration && [start, end].some(value => (value < 0n ? -value : value).toString().length > Number(declaration[1]))) return fail();
    if (start > end) return fail(); low = format(start, scale); high = format(end, scale); let before = start;
    for (let index = 1; index < bins && start !== end; index++) {
      // 向上量化到该列原小数单位，负区间也沿同一有序整数轴；不会形成不可精确表示的1/3等界限。
      const next = start + ((end - start) * BigInt(index) + BigInt(bins - 1)) / BigInt(bins);
      if (next > before && next <= end) { cuts.push(format(next, scale)); before = next; }
    }
  }
  const boundaries = [low, ...cuts, high];
  return boundaries.slice(0, -1).map((lower, index) => ({ lower, upper: boundaries[index + 1], upperInclusive: index === boundaries.length - 2 }));
}
/** 区间、模式、准确字段和数量恒等式全核对；空集保留零而不造一个假零值区间。 */
export function assertTableHistogram(value: TableHistogram | undefined, request: TableHistogramRequest | undefined, source: { name: string; type: string } | undefined, rowCount: string): void {
  if (!request) { if (value !== undefined) return fail(); return; }
  if (!value || !source || source.name !== request.column || value.column !== request.column || value.type !== source.type || value.requestedBins !== request.bins || value.approximate !== tableHistogramType(source.type).approximate || !Array.isArray(value.ranges)) return fail();
  const count = (raw: string) => { if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(raw)) return fail(); return BigInt(raw); };
  const nonNull = count(value.nonNull); if (nonNull + count(value.nulls) !== count(rowCount)) return fail();
  if (nonNull === 0n) { if (value.min !== null || value.max !== null || value.ranges.length) return fail(); return; }
  if (value.min === null || value.max === null) return fail();
  const expected = tableHistogramRanges(source.type, request.bins, value.min, value.max);
  if (expected.length !== value.ranges.length || expected.some((range, index) => { const actual = value.ranges[index]; return actual.lower !== range.lower || actual.upper !== range.upper || actual.upperInclusive !== range.upperInclusive; }) || value.ranges.reduce((sum, range) => sum + count(range.count), 0n) !== nonNull || count(value.ranges[0].count) === 0n || count(value.ranges.at(-1)!.count) === 0n) return fail();
}
