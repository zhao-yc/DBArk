import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { postgresTablePageSchema } from '../../src/shared/postgresTable';
import { PostgresDraftHistory, type PostgresDraftEntry } from '../../src/renderer/postgresDraftHistory';

const entry = (pageToken = randomUUID(), text = '9223372036854775807'): PostgresDraftEntry => ({
  change: { kind: 'update', pageToken, row: 0, fields: [{ column: 'c1', value: { mode: 'text', value: text } }] },
  rowKey: '原主键', offset: 0,
});

describe('PostgreSQL 草稿撤销和重做', () => {
  it('整批重做恢复原页令牌和字段原值，分支编辑释放旧重做，恢复不复用发布数组', () => {
    const history = new PostgresDraftHistory(), first = [entry()], second = [...first, entry()];
    history.record(first);
    history.record(second, 'template');
    expect(history.status).toEqual({ undo: 2, redo: 0, undoGroup: 'template' });
    expect(history.move('undo')).toEqual(first);
    const replay = history.move('redo');
    expect(replay).toEqual(second);
    expect(replay).not.toBe(second);
    history.move('undo');
    const third = [entry()];
    history.record(third);
    expect(history.move('redo')).toBeUndefined();
    expect(history.move('undo')).toEqual(first);
    expect(history.move('undo')).toEqual([]);
  });

  it('翻页优先保留当前草稿，有效历史可跨空草稿恢复，缺失原页截断对应路径', () => {
    const history = new PostgresDraftHistory(), [a, b, c] = [entry(), entry(), entry()];
    history.record([a]);
    history.record([a, b]);
    history.record([]);
    history.record([c]);
    history.move('undo');
    expect(history.pins()).toEqual({ retainPageTokens: [], retainHistoryPageTokens: [a.change.pageToken, b.change.pageToken, c.change.pageToken] });
    history.retain(new Set([a.change.pageToken, c.change.pageToken]));
    expect(history.status).toMatchObject({ undo: 0, redo: 1 });
    expect(history.move('redo')).toEqual([c]);
    expect(history.pins()).toEqual({ retainPageTokens: [c.change.pageToken], retainHistoryPageTokens: [] });
    history.reset([c]);
    expect(history.status).toMatchObject({ undo: 0, redo: 0 });
  });

  it('原页最多保留 16 个，优先保留当前草稿并剪掉较远的路径', () => {
    const history = new PostgresDraftHistory(), entries = Array.from({ length: 18 }, () => entry());
    for (const item of entries) history.record([item]);
    const { retainPageTokens, retainHistoryPageTokens } = history.pins();
    expect(retainPageTokens).toEqual([entries[17].change.pageToken]);
    expect(retainHistoryPageTokens).toEqual(entries.slice(2, 17).reverse().map(item => item.change.pageToken));
    history.retain(new Set([...retainPageTokens, ...retainHistoryPageTokens]));
    for (const item of entries.slice(2, 17).reverse()) expect(history.move('undo')).toEqual([item]);
    expect(history.move('undo')).toBeUndefined();
  });

  it('编辑步数和字节预算均淘汰最早历史', () => {
    const history = new PostgresDraftHistory();
    for (let index = 0; index < 105; index++) history.record([entry()]);
    expect(history.status.undo).toBe(100);
    history.reset([]);
    const value = '大'.repeat(60000);
    for (let index = 0; index < 30; index++) history.record([entry(undefined, value)]);
    expect(history.status.undo).toBe(30);
    for (let index = 0; index < 60; index++) history.record([entry(undefined, value)]);
    expect(history.status.undo).toBeGreaterThan(30);
    expect(history.status.undo).toBeLessThan(90);
  });

  it('IPC 同时限制草稿及历史的快照数量和重复令牌', () => {
    const base = { connectionId: 'c', database: 'db', table: 't', tabId: 'tab', offset: 0, limit: 1 };
    const pins = Array.from({ length: 17 }, () => randomUUID());
    expect(postgresTablePageSchema.safeParse({ ...base, retainPageTokens: pins.slice(0, 12), retainHistoryPageTokens: pins.slice(12, 16) }).success).toBe(true);
    expect(postgresTablePageSchema.safeParse({ ...base, retainPageTokens: pins.slice(0, 12), retainHistoryPageTokens: pins.slice(12) }).success).toBe(false);
    expect(postgresTablePageSchema.safeParse({ ...base, retainPageTokens: [pins[0]], retainHistoryPageTokens: [pins[0]] }).success).toBe(false);
  });
});
