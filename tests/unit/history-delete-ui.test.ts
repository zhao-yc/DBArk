import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HistoryDeleteIntent, checkHistoryDeleteApply, checkHistoryDeletePreview, selectHistoryDeleteRecords } from '../../src/renderer/historyDeleteUi';
import type { HistoryDeletePreviewOutput } from '../../src/shared/historyDelete';

const item = (id: string, digest = 'a'.repeat(64)) => ({ entry: { id, startedAt: '2026-10-23T00:00:00.000Z', elapsedMs: 0, success: true }, digest });
const scope = () => ({ kind: 'filtered' as const, filters: { search: '未截断错误全文', fields: ['error' as const], scope: { kind: 'connection' as const, connectionId: 'original' }, status: 'failed' as const, timeRange: { from: '2026-10-22T00:00:00.000Z' }, durationRange: { minMs: 0, maxMs: 9007199254740991 } } });
const preview = (): HistoryDeletePreviewOutput => ({ previewToken: randomUUID(), kind: 'filtered', count: 26, scanned: 30, samples: ['1', '2', '3'].map(id => ({ entry: item(id).entry, sqlPreview: 'SELECT\n原文', sqlUnits: 10, previewTruncated: true })), expiresAt: new Date(Date.now() + 60_000).toISOString() });

describe('历史清理UI纯边界（不访问SQLite或执行SQL）', () => {
  it('跨页只保留id/digest，重复相同摘要不挤掉旧选择', () => {
    const first = selectHistoryDeleteRecords([], [item('a'), item('b')]);
    const second = selectHistoryDeleteRecords(first, [item('b'), item('c')]);
    expect(second).toEqual(['a', 'b', 'c'].map(id => ({ id, digest: 'a'.repeat(64) })));
    expect(first).toEqual(['a', 'b'].map(id => ({ id, digest: 'a'.repeat(64) })));
    expect(second.every(value => Object.keys(value).sort().join(',') === 'digest,id')).toBe(true);
  });
  it('摘要变化或第101项整批拒绝，不部分加入、不改原数组', () => {
    const first = selectHistoryDeleteRecords([], Array.from({ length: 99 }, (_, i) => item(String(i))));
    expect(() => selectHistoryDeleteRecords(first, [item('new1'), item('new2')])).toThrow('100');
    expect(first).toHaveLength(99); expect(() => selectHistoryDeleteRecords(first, [item('0', 'b'.repeat(64))])).toThrow('变化');
    expect(selectHistoryDeleteRecords(first, [item('99')])).toHaveLength(100);
  });
  it('筛选完整深快照，不带onError/taskId；只允许规范筛选', () => {
    const source = scope(), intent = new HistoryDeleteIntent(source, () => true); source.filters.durationRange.minMs = 9;
    const input = intent.input(randomUUID()); expect(input.scope).toEqual(scope()); expect(Object.isFrozen(intent.scope)).toBe(true);
    expect(input).not.toHaveProperty('onError'); expect(input.scope).not.toHaveProperty('filters.onError');
    expect(() => new HistoryDeleteIntent({ ...scope(), filters: { ...scope().filters, onError: 'continue' } } as never, () => true)).toThrow();
  });
  it('来源失效为永久租约，ABA不能复活或重新生成请求', () => {
    let valid = true; const intent = new HistoryDeleteIntent({ kind: 'selected', records: [{ id: 'a', digest: 'a'.repeat(64) }] }, () => valid), listener = vi.fn();
    intent.subscribe(listener); valid = false; expect(intent.current()).toBe(false); valid = true;
    expect(intent.current()).toBe(false); expect(() => intent.input(randomUUID())).toThrow('变化'); expect(listener).toHaveBeenCalledOnce();
  });
  it('准确数量可大于25张卡片，但样本必须有限完整，零匹配允许空样本', () => {
    const result = preview(); expect(checkHistoryDeletePreview(result, 'filtered')).toBe(result);
    expect(checkHistoryDeletePreview({ ...result, count: 0, scanned: 30, samples: [] }, 'filtered').count).toBe(0);
    for (const bad of [{ count: 31 }, { scanned: 1001 }, { count: -1 }, { count: 1.5 }, { samples: result.samples.slice(0, 2) }, { kind: 'selected' }, { previewToken: 'x' }, { expiresAt: 'bad' }]) expect(() => checkHistoryDeletePreview({ ...result, ...bad } as never, 'filtered')).toThrow();
    expect(() => checkHistoryDeletePreview({ ...result, samples: result.samples.map(value => ({ ...value, sqlPreview: 'x'.repeat(513), sqlUnits: 514 })) }, 'filtered')).toThrow();
  });
  it('apply只接受明确已提交事实和有限整数', () => {
    expect(checkHistoryDeleteApply({ applied: true, deleted: 1000 })).toEqual({ applied: true, deleted: 1000 });
    for (const value of [{ applied: false, deleted: 1 }, { applied: true, deleted: -1 }, { applied: true, deleted: 1001 }, { applied: true, deleted: 0.5 }]) expect(() => checkHistoryDeleteApply(value as never)).toThrow();
  });
});
