export interface HistoryTimeRange { from?: string; until?: string; }
export interface HistoryClockParts { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number; }
/** 先检查日历往返，禁止Date自动把2月30日、24时或两位年份归一化。 */
export function historyClockEpoch(parts: HistoryClockParts): number {
  const { year, month, day, hour, minute, second, millisecond } = parts;
  if (![year, month, day, hour, minute, second, millisecond].every(Number.isInteger) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) throw Error('时间格式或日历日期无效');
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, millisecond);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw Error('时间格式或日历日期无效');
  return date.getTime();
}
/** 仅接受明确Z或数值偏移的毫秒精度绝对时刻；拒绝无时区、未知-00:00、闰秒及多余小数。 */
export function historyAbsoluteEpoch(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw Error('执行历史开始时间不是明确的绝对时刻，无法按时间范围筛选');
  const nominal = historyClockEpoch({ year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: +match[6], millisecond: +(match[7] ?? '').padEnd(3, '0') });
  let offset = 0;
  if (match[8] !== 'Z') {
    const zone = match[8], hours = +zone.slice(1, 3), minutes = +zone.slice(4);
    if (hours > 23 || minutes > 59 || zone === '-00:00') throw Error('执行历史时间偏移未知或无效');
    offset = (hours * 60 + minutes) * 60000 * (zone[0] === '+' ? 1 : -1);
  }
  const instant = nominal - offset;
  if (new Date(instant).getUTCFullYear() < 1 || new Date(instant).getUTCFullYear() > 9999) throw Error('绝对时刻超出支持的四位年份范围');
  return instant;
}
/** IPC边界只接受规范UTC，等价偏移由界面明确转换，后端不猜测或修改时间。 */
export function canonicalHistoryInstant(value: string): boolean {
  try { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(historyAbsoluteEpoch(value)).toISOString() === value; } catch { return false; }
}
/** 无范围保持原匹配行为；启用范围时先校验真实startedAt，坏/遗留时间必须进入既有onError路径。 */
export function historyTimeMatches(startedAt: string, range?: HistoryTimeRange): boolean {
  if (!range) return true;
  const actual = historyAbsoluteEpoch(startedAt);
  return (range.from === undefined || actual >= historyAbsoluteEpoch(range.from)) && (range.until === undefined || actual < historyAbsoluteEpoch(range.until));
}
