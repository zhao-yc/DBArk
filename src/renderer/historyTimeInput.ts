import { canonicalHistoryInstant, historyAbsoluteEpoch, historyClockEpoch, type HistoryClockParts, type HistoryTimeRange } from '../shared/historyTimeRange';

/** 使用固定IANA时区读取真实日历分量，不能套用当前UTC偏移推算另一天。 */
function zonedClock(formatter: Intl.DateTimeFormat, instant: number): HistoryClockParts {
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  if (values.era !== 'AD') throw Error('时间超出支持的公元日历范围');
  return { year: +values.year, month: +values.month, day: +values.day, hour: +values.hour, minute: +values.minute, second: +values.second, millisecond: 0 };
}
/** 本机墙钟必须只有一个对应时刻；不使用Date默认的缺口前移或重复时刻择早行为。 */
export function historyLocalInstant(value: string, timeZone: string): string {
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return new Date(historyAbsoluteEpoch(value)).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw Error('请输入完整日期和时间；不可省略日期、自动补日期或包含前后空格');
  const clock: HistoryClockParts = { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: +(match[6] ?? '0'), millisecond: +(match[7] ?? '').padEnd(3, '0') };
  const nominal = historyClockEpoch(clock);
  if (!timeZone) throw Error('无法读取本机时区，请明确输入带Z或数值偏移的绝对时间');
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', { timeZone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { throw Error('本机时区不可解析，请明确输入带Z或数值偏移的绝对时间'); }
  const offsets = new Set<number>(), candidates = new Set<number>(), anchor = Math.floor(nominal / 3600000) * 3600000;
  // 覆盖日期前后两天的时区状态，兼容半小时夏令时、历史秒偏移和跨日期线跳日；有界97次读取。
  for (let hour = -48; hour <= 48; hour++) { const instant = anchor + hour * 3600000; try { offsets.add(historyClockEpoch(zonedClock(formatter, instant)) - instant); } catch { /* 四位公元年份边界的窗口样本不参与推断。 */ } }
  for (const offset of offsets) {
    const instant = nominal - offset;
    try { const roundtrip = zonedClock(formatter, instant); if (roundtrip.year === clock.year && roundtrip.month === clock.month && roundtrip.day === clock.day && roundtrip.hour === clock.hour && roundtrip.minute === clock.minute && roundtrip.second === clock.second) candidates.add(instant); } catch { /* 不接受越过公元日历边界的候选。 */ }
  }
  if (!candidates.size) throw Error('该本机时间不存在（夏令时或时区跳变），请修改输入或明确填写Z/数值偏移');
  if (candidates.size !== 1) throw Error('该本机时间重复出现，无法确定时刻；请明确填写Z或数值偏移');
  const canonical = new Date([...candidates][0]).toISOString();
  // 本机年份合法不代表换算后的UTC年份合法；复用IPC校验，公元零年也在界面先拒绝。
  if (!canonicalHistoryInstant(canonical)) throw Error('绝对时刻超出支持的四位年份范围');
  return canonical;
}
/** 草稿只在明确搜索时转换，保留原输入；开始包含、结束不包含，空端点表示不限。 */
export function historyInputRange(from: string, until: string, timeZone: string): HistoryTimeRange | undefined {
  if (from === '' && until === '') return;
  const range = { ...(from !== '' ? { from: historyLocalInstant(from, timeZone) } : {}), ...(until !== '' ? { until: historyLocalInstant(until, timeZone) } : {}) };
  if (range.from && range.until && range.from >= range.until) throw Error('开始时间必须早于结束时间，结束端点不包含');
  return range;
}
