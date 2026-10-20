export interface RecordedTimeRange {
  readonly earliestNs: string;
  readonly latestNs: string;
  readonly precisionNs: number;
}
export interface RecordedIdentityComparison {
  readonly kind: 'reused' | 'possibly-original' | 'unrelated' | 'indeterminate';
  readonly reason: string;
  readonly originalCreation?: RecordedTimeRange;
  readonly observedCreation?: RecordedTimeRange;
  readonly recordedAbsence?: RecordedTimeRange;
  readonly snapshot?: RecordedTimeRange;
}

const millisecondNs = 1000000n;
const dateLimitMs = 8640000000000000n;

/** 以JSON可保存的UTC纳秒字符串表示精度区间，不把格式差异或截断后的同毫秒当作新身份。 */
function range(start: bigint, precision: bigint): RecordedTimeRange {
  return Object.freeze({ earliestNs: String(start), latestNs: String(start + precision - 1n), precisionNs: Number(precision) });
}

/** 仅解析已保存的整数毫秒、CIM JSON Date或带明确时区的ISO；不访问系统时间或进程。 */
export function parseRecordedProcessTime(value: unknown): RecordedTimeRange | undefined {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Math.abs(value) > Number(dateLimitMs)) return;
    return range(BigInt(value) * millisecondNs, millisecondNs);
  }
  if (typeof value !== 'string' || value.length > 64) return;
  const cim = /^\/Date\((-?\d{1,16})\)\/$/.exec(value);
  if (cim) {
    const ms = BigInt(cim[1]);
    if (ms < -dateLimitMs || ms > dateLimitMs) return;
    return range(ms * millisecondNs, millisecondNs);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!iso) return;
  const [year, month, day, hour, minute, second] = iso.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return;
  const date = new Date(0);
  // setUTCFullYear避免Date.UTC把两位年份隐式转换为1900年代，并拒绝日期自动滚动。
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
  let offsetMinutes = 0;
  if (iso[8] !== 'Z') {
    const offsetHour = Number(iso[8].slice(1, 3)), offsetMinute = Number(iso[8].slice(4));
    if (offsetMinute > 59 || offsetHour > 14 || offsetHour === 14 && offsetMinute !== 0) return;
    offsetMinutes = (iso[8][0] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const fraction = iso[7] ?? '';
  const start = BigInt(date.getTime()) * millisecondNs - BigInt(offsetMinutes) * 60000000000n + BigInt(fraction.padEnd(9, '0'));
  return range(start, 10n ** BigInt(9 - fraction.length));
}

/** 只接受数据属性，不执行输入记录上的PID或时间访问器；额外字段不会进入证据结论。 */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && !('value' in descriptor)) return;
    result[key] = descriptor?.value;
  }
  return result;
}

/** PID只用于筛选候选；复用须有正向时间证据，本函数不决定整轮通过、不改原失败记录。 */
export function compareRecordedProcessIdentity(originalInput: unknown, observedInput: unknown, snapshotAt: unknown): RecordedIdentityComparison {
  const original = record(originalInput, ['pid', 'createdAt', 'lastAbsentAt']), observed = record(observedInput, ['pid', 'createdAt']);
  const pidValid = (pid: unknown): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff;
  if (!original || !observed || !pidValid(original.pid) || !pidValid(observed.pid)) return Object.freeze({ kind: 'indeterminate', reason: 'invalid-record' });
  if (original.pid !== observed.pid) return Object.freeze({ kind: 'unrelated', reason: 'different-pid' });
  const old = parseRecordedProcessTime(original.createdAt), current = parseRecordedProcessTime(observed.createdAt);
  const absence = parseRecordedProcessTime(original.lastAbsentAt), snapshot = parseRecordedProcessTime(snapshotAt);
  const evidence = { ...(old ? { originalCreation: old } : {}), ...(current ? { observedCreation: current } : {}), ...(absence ? { recordedAbsence: absence } : {}), ...(snapshot ? { snapshot } : {}) };
  const answer = (kind: RecordedIdentityComparison['kind'], reason: string): RecordedIdentityComparison => Object.freeze({ kind, reason, ...evidence });
  if (!current || !snapshot || original.createdAt !== undefined && !old || original.lastAbsentAt !== undefined && !absence) return answer('indeterminate', 'invalid-timestamp');
  if (BigInt(current.latestNs) > BigInt(snapshot.earliestNs) || old && BigInt(old.earliestNs) > BigInt(snapshot.latestNs)) return answer('indeterminate', 'observation-time-overlap-or-future');
  if (absence) {
    if (BigInt(absence.latestNs) >= BigInt(snapshot.earliestNs) || old && BigInt(old.earliestNs) > BigInt(absence.latestNs)) return answer('indeterminate', 'inconsistent-absence-time');
    if (BigInt(current.earliestNs) > BigInt(absence.latestNs)) return answer('reused', 'created-after-recorded-absence');
    return answer('indeterminate', 'creation-not-proven-after-absence');
  }
  if (!old) return answer('indeterminate', 'missing-generation-evidence');
  const disjoint = BigInt(current.latestNs) < BigInt(old.earliestNs) || BigInt(current.earliestNs) > BigInt(old.latestNs);
  return disjoint ? answer('reused', 'distinct-creation-time') : answer('possibly-original', 'creation-time-intervals-overlap');
}
