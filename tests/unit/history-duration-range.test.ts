import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { historyDurationMatches, historyDurationRangeSchema } from '../../src/shared/historyDurationRange';
import { parseHistoryRecord, summarizeHistoryRecord } from '../../src/main/historyPageMatch';
import type { HistoryPageInput, HistoryRecord } from '../../src/shared/historyPages';

const input = (patch: Partial<HistoryPageInput> = {}): HistoryPageInput => ({ taskId: randomUUID(), search: '', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', onError: 'continue', ...patch });
const entry = (patch: Partial<HistoryRecord> = {}): HistoryRecord => ({ id: 'duration-test', connectionId: 'source', startedAt: '2026-10-22T00:00:00.000Z', elapsedMs: 100, sql: 'SELECT 1', success: true, ...patch });
/** 原始记录与原索引一起送进真实worker摘要函数，不在测试中重算耗时或模拟命中。 */
function summarize(record: HistoryRecord, request: HistoryPageInput) { return summarizeHistoryRecord(record.id, JSON.stringify(record), request, { id: record.id, startedAt: record.startedAt, connectionId: record.connectionId ?? '' }); }

describe('历史耗时范围严格IPC和原数值语义', () => {
  it.each([{ minMs: 0 }, { maxMs: 0 }, { minMs: 1, maxMs: 1 }, { minMs: 0, maxMs: Number.MAX_SAFE_INTEGER }, { minMs: Number.MAX_SAFE_INTEGER }])('真实history.page接收有效范围%j', durationRange => {
    expect(validateCommand('history.page', input({ durationRange }))).toMatchObject({ durationRange });
  });
  it.each([{}, null, false, 1, [], { minMs: -1 }, { maxMs: -1 }, { minMs: 1.1 }, { maxMs: 1.1 }, { minMs: NaN }, { maxMs: NaN }, { minMs: Infinity }, { maxMs: -Infinity }, { minMs: null }, { maxMs: null }, { minMs: '1' }, { maxMs: Number.MAX_SAFE_INTEGER + 1 }, { minMs: Number.MAX_SAFE_INTEGER + 1 }, { minMs: 2, maxMs: 1 }, { minMs: 0, unknown: 1 }])('真实IPC拒绝不可信范围%j而非悄悄取消筛选', durationRange => {
    expect(() => validateCommand('history.page', { ...input(), durationRange })).toThrow();
  });
  it('省略范围不增加筛选字段；续页不能注入或替换范围、排序、位置', () => {
    expect(validateCommand('history.page', input())).not.toHaveProperty('durationRange');
    for (const extra of [{ durationRange: { minMs: 0 } }, { sort: 'duration' }, { after: { elapsedMs: 1 } }]) expect(() => validateCommand('history.pageContinue', { taskId: randomUUID(), cursor: randomUUID(), ...extra })).toThrow();
  });
  it.each([
    [0, { minMs: 0, maxMs: 0 }, true], [0.0001, { minMs: 0, maxMs: 0 }, false],
    [1, { minMs: 1, maxMs: 2 }, true], [2, { minMs: 1, maxMs: 2 }, true],
    [1.25, { minMs: 1, maxMs: 2 }, true], [0.999999, { minMs: 1 }, false],
    [2.000001, { maxMs: 2 }, false], [Number.MAX_SAFE_INTEGER, { minMs: Number.MAX_SAFE_INTEGER, maxMs: Number.MAX_SAFE_INTEGER }, true],
    [Number.MAX_SAFE_INTEGER + 1, { maxMs: Number.MAX_SAFE_INTEGER }, false], [Number.MAX_SAFE_INTEGER + 1, { minMs: 0 }, true],
  ] as const)('原耗时%j按包含两端的范围%j匹配%j，不取整', (elapsedMs, durationRange, expected) => {
    expect(historyDurationMatches(elapsedMs, durationRange)).toBe(expected);
    expect(!!summarize(entry({ elapsedMs }), input({ durationRange }))).toBe(expected);
  });
  it('合法范围必须保留至少一个端点；零值不能按空值丢失', () => { expect(historyDurationRangeSchema.parse({ maxMs: 0 })).toEqual({ maxMs: 0 }); expect(() => historyDurationRangeSchema.parse({ minMs: undefined, maxMs: undefined })).toThrow(); });
  it('负值在无范围时保留遗留行为；启用范围后不能被其他筛选隐藏且错误不回显正文', () => {
    const record = entry({ elapsedMs: -12345, sql: '不得回显的SQL正文', error: '不得回显的错误原文', success: false });
    expect(parseHistoryRecord(record.id, JSON.stringify(record)).elapsedMs).toBe(-12345); expect(summarize(record, input())).toBeTruthy();
    for (const patch of [{}, { scope: { kind: 'connection', connectionId: 'other' } as const }, { status: 'success' as const }, { search: '无命中' }, { timeRange: { from: '2027-01-01T00:00:00.000Z' } }]) {
      try { summarize(record, input({ ...patch, durationRange: { minMs: 0 } })); throw Error('必须拒绝负耗时'); }
      catch (reason) { expect((reason as Error).message).toBe('执行历史耗时无效，无法按耗时范围筛选'); expect((reason as Error).message).not.toMatch(/12345|正文|原文/); }
    }
  });
  it('完整记录finite校验、索引校验和旧时间校验顺序保持不变', () => {
    const badTime = entry({ elapsedMs: -1, startedAt: '2026-10-22' });
    expect(() => summarize(badTime, input({ timeRange: { from: '2026-01-01T00:00:00.000Z' }, durationRange: { minMs: 0 } }))).toThrow('明确的绝对时刻');
    expect(() => summarizeHistoryRecord(badTime.id, JSON.stringify(badTime), input({ durationRange: { minMs: 0 } }), { id: badTime.id, startedAt: '不同索引', connectionId: 'source' })).toThrow('索引不一致');
    const raw = JSON.stringify(entry()).replace('"elapsedMs":100', '"elapsedMs":1e309'); expect(() => parseHistoryRecord('duration-test', raw)).toThrow('结构无效：elapsedMs');
    expect(() => summarize(entry({ elapsedMs: NaN }), input({ durationRange: { minMs: 0 }, status: 'failed' }))).toThrow('结构无效：elapsedMs');
  });
  it('耗时范围与完整SQL/错误、状态、来源和实际绝对时间组合且概要保留原分数', () => {
    const record = entry({ elapsedMs: 1.25, sql: 'x'.repeat(9000) + 'SQL尾部', error: 'x'.repeat(9000) + '错误尾部', success: false, startedAt: '2026-10-22T08:00:00+08:00' });
    const request = input({ durationRange: { minMs: 1, maxMs: 2 }, timeRange: { from: '2026-10-22T00:00:00.000Z', until: '2026-10-22T00:00:00.001Z' }, scope: { kind: 'connection', connectionId: 'source' }, status: 'failed', search: '错误尾部', fields: ['error'] });
    const result = summarize(record, request)!; expect(result.entry.elapsedMs).toBe(1.25); expect(result.errorTruncated).toBe(true); expect(JSON.stringify(result)).not.toContain('错误尾部');
    expect(summarize(record, { ...request, durationRange: { maxMs: 1 } })).toBeUndefined(); expect(summarize(record, { ...request, fields: ['sql'] })).toBeUndefined();
  });
});
