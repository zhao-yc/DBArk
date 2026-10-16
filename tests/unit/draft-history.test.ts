import { describe, expect, it } from 'vitest';
import { DraftHistory, draftHistoryKey, draftHistoryLimits } from '../../src/renderer/draftHistory';
import { collectChanges, newDraftRow, type DraftRow } from '../../src/renderer/dataChanges';
import { assertRecordDraftCurrent, beginRecordDraft, type RecordContext } from '../../src/renderer/recordViews';

/** 合成不可变页；没有IPC、连接或真实用户数据。 */
function row(id = '一', note = '原值'): DraftRow { const data = { id, note }; return { id, data, original: { ...data }, inserted: false, deleted: false }; }
function edit(rows: DraftRow[], value: string) { return rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: value } }); }

describe('本页稀疏草稿编辑历史', () => {
  it('多格一次原子撤销/重做，未变行与original保持，当前行身份不复用', () => {
    const history = new DraftHistory(), before = [row(), row('二')], after = [{ ...before[0], data: { ...before[0].data, note: '后值', extra: null } }, before[1]];
    history.record(before, after); expect(history.status.undo).toBe(1);
    const undo = history.move(after, 'undo')!; expect(undo).toEqual(before); expect(undo[0]).not.toBe(before[0]); expect(undo[0].data).not.toBe(before[0].data); expect(undo[0].original).toBe(before[0].original); expect(undo[1]).toBe(before[1]);
    const redo = history.move(undo, 'redo')!; expect(redo).toEqual(after); expect(redo[0].data).not.toBe(after[0].data); expect(collectChanges(redo)).toEqual(collectChanges(after));
  });
  it('批量新增保留原UUID，删除标记及实体移除均可原子往返，不重签UUID', () => {
    const history = new DraftHistory(), before = [row()], inserted = [newDraftRow('甲'), newDraftRow('乙', { note: '乙值' })], after = [...before, ...inserted];
    history.record(before, after); let current = history.move(after, 'undo')!; expect(current).toEqual(before); current = history.move(current, 'redo')!; expect(current.map(row => row.id)).toEqual(['一', '甲', '乙']); expect(Object.hasOwn(current[1].data, 'note')).toBe(false);
    const deleted = current.map(row => ({ ...row, deleted: true })); history.record(current, deleted); current = history.move(deleted, 'undo')!; expect(current.every(row => !row.deleted)).toBe(true);
    const removed = [current[2], current[0]]; history.record(current, removed); expect(history.move(removed, 'undo')).toEqual(current);
  });
  it('NULL、DEFAULT缺字段、BLOB、空字节、精度和JSON词法均逐值往返', () => {
    const history = new DraftHistory(), before = [newDraftRow('新增', { note: null, bytes: { type: 'binary', base64: '' }, amount: '900719925474099312345', doc: '{"x":1,"x":-0,"n":9007199254740993}' })];
    const after = [{ ...before[0], data: { ...before[0].data, bytes: { type: 'binary' as const, base64: 'AAH/' }, note: 'NULL', precise: '2026-10-16 12:34:56.123456' } }];
    history.record(before, after); const undo = history.move(after, 'undo')!; expect(undo).toEqual(before); expect(Object.hasOwn(undo[0].data, 'precise')).toBe(false); expect(history.move(undo, 'redo')).toEqual(after);
  });
  it('原型同名字段保留自有属性，-0与0分开计操作', () => {
    const history = new DraftHistory(), before = [newDraftRow('新增', JSON.parse('{"__proto__":"原值","constructor":-0}'))];
    const after = [{ ...before[0], data: { ...before[0].data, constructor: 0 } }]; history.record(before, after); const undo = history.move(after, 'undo')!;
    expect(Object.hasOwn(undo[0].data, '__proto__')).toBe(true); expect(undo[0].data.__proto__).toBe('原值'); expect(Object.is(undo[0].data.constructor, -0)).toBe(true); expect(Object.getPrototypeOf(undo[0].data)).toBe(Object.prototype);
  });
  it('撤销后新编辑清空重做，无变化的发布不占操作也不清重做', () => {
    const history = new DraftHistory(), before = [row()], after = edit(before, '后值'); history.record(before, after);
    let current = history.move(after, 'undo')!; const noop = current.map(row => ({ ...row, data: { ...row.data } })); history.record(current, noop); expect(history.status.redo).toBe(1); current = edit(noop, '分支'); history.record(noop, current); expect(history.status).toMatchObject({ undo: 1, redo: 0 });
    expect(history.move(current, 'undo')![0].data.note).toBe('原值');
  });
  it('操作数淘汰最早项，只能回到已淘汰之前的最新基线', () => {
    const history = new DraftHistory({ operations: 3, bytes: 100000 }); let current = [row()];
    for (let index = 1; index <= 8; index++) { const next = edit(current, String(index)); history.record(current, next); current = next; }
    expect(history.status.undo).toBe(3); for (let index = 0; index < 3; index++) current = history.move(current, 'undo')!; expect(current[0].data.note).toBe('5'); expect(history.move(current, 'undo')).toBeNull(); expect(history.status.redo).toBe(3);
  });
  it('累计字节预算覆盖撤销与重做两栈，重放不持续增加保留字节', () => {
    const history = new DraftHistory({ operations: 100, bytes: 3500 }); let current = [row()];
    for (let index = 0; index < 30; index++) { const next = edit(current, '值'.repeat(150) + index); history.record(current, next); current = next; expect(history.status.bytes).toBeLessThanOrEqual(3500); }
    const retained = history.status.bytes; for (let index = 0; index < 100; index++) { current = history.move(current, 'undo')!; current = history.move(current, 'redo')!; expect(history.status.bytes).toBe(retained); }
  });
  it('单次超限保留新草稿、不截值，并清空旧两栈及提示容量', () => {
    const history = new DraftHistory({ operations: 100, bytes: 1800 }), before = [row()], after = edit(before, '小值'); history.record(before, after);
    const huge = edit(after, '大'.repeat(10000)); history.record(after, huge); expect(huge[0].data.note).toHaveLength(10000); expect(history.status).toEqual({ undo: 0, redo: 0, bytes: 0 }); expect(history.notice).toContain('草稿已保留'); expect(history.move(huge, 'undo')).toBeNull();
  });
  it('仅单行小改时不把整页大字节计入每步历史', () => {
    const history = new DraftHistory(), before = [row(), newDraftRow('未改大行', { bytes: { type: 'binary', base64: 'A'.repeat(10_000_000) } })], after = edit(before, '小改'); history.record(before, after);
    expect(history.status.undo).toBe(1); expect(history.status.bytes).toBeLessThan(3000); expect(history.move(after, 'undo')![1]).toBe(before[1]);
  });
  it('每次重放的新data身份拒绝原行旧票据ABA，original不变', () => {
    const before = [row()], context = { target: { connectionId: 'c', database: 'd', table: 't' }, connectionVersion: 1, generation: 1, loaded: true, stale: false, busy: false, info: null } satisfies RecordContext;
    const ticket = beginRecordDraft(before[0], context), history = new DraftHistory(), after = edit(before, '后值'); history.record(before, after); const undo = history.move(after, 'undo')!;
    expect(() => assertRecordDraftCurrent(undo, ticket, context)).toThrow(); expect(undo[0].original).toBe(before[0].original);
  });
  it('外部数组替换及明确清空不能重放旧页', () => {
    const history = new DraftHistory(), before = [row()], after = edit(before, '后值'); history.record(before, after); expect(history.move([...after], 'undo')).toBeNull(); expect(history.status.undo).toBe(0);
    history.record(before, after); history.clear(); expect(history.status).toEqual({ undo: 0, redo: 0, bytes: 0 });
  });
  it('默认容量固定100步8MiB，非法容量不创建无界历史', () => {
    expect(draftHistoryLimits).toEqual({ operations: 100, bytes: 8388608 }); for (const value of [0, -1, NaN, Infinity, 1.5]) expect(() => new DraftHistory({ operations: value, bytes: 1000 })).toThrow();
  });
  it('全新页或已清空历史上的快捷键不制造页面变化提示', () => {
    const history = new DraftHistory(); expect(history.move([row()], 'undo')).toBeNull(); expect(history.notice).toBe('');
  });
  it('复制标记随两栈保留，分支编辑删除重做后不再保留旧新增UUID', () => {
    const history = new DraftHistory(), before = [row()], after = [...before, newDraftRow('复制UUID')]; history.record(before, after);
    const undo = history.move(after, 'undo')!; expect(history.retainedIds().has('复制UUID')).toBe(true);
    history.record(undo, edit(undo, '分支')); expect(history.retainedIds().has('复制UUID')).toBe(false);
  });
});

describe('网格历史快捷键路由', () => {
  it.each([{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }])('Ctrl/Cmd撤销与两种重做：%j', modifiers => {
    const event = { ...modifiers, key: 'z', shiftKey: false, altKey: false };
    expect(draftHistoryKey(event, true)).toBe('undo'); expect(draftHistoryKey({ ...event, shiftKey: true }, true)).toBe('redo'); expect(draftHistoryKey({ ...event, key: 'Y' }, true)).toBe('redo');
    expect(draftHistoryKey(event, false)).toBeNull(); expect(draftHistoryKey({ ...event, altKey: true }, true)).toBeNull();
  });
});
