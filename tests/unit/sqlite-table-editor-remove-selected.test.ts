import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteOriginalValue, SqliteTableEditOutcome, SqliteTableEditPreview } from '../../src/shared/sqliteTableEdit';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as text } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

const cell = (value: string): SqliteOriginalValue => ({ kind: 'text', value });
/** 合成原页只提供真实editor的纯端口；本组不会连接数据库或系统剪贴板。 */
function fixture(count = 3, width = 2) {
  const columns = Array.from({ length: width }, (_, i) => ({ name: 'c' + i, declaredType: 'TEXT' }));
  const values = Array.from({ length: count }, (_, r) => columns.map((_, c) => cell('原' + r + ':' + c)));
  const page: SqliteTablePage = { target: { connectionId: 'sqlite', database: 'main', table: '批量删除', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 1000, hasMore: false, result: { columns: columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows: values.map(() => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot-original', expiresAt: new Date(1800000).toISOString(), columns: columns.map(column => ({ ...column, generated: false, nullable: true, hasDefault: true })), rows: values, locator: { kind: 'rowid', columns: [] } } };
  let serial = 0, now = 0;
  const current = vi.fn(() => true), active = vi.fn(() => true), available = vi.fn(() => true), id = vi.fn(() => 'draft-' + ++serial), changed = vi.fn(), dirty = vi.fn();
  const previewValue: SqliteTableEditPreview = { previewId: 'preview-original', snapshotId: 'snapshot-original', target: page.target, schemaKey: page.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.批量删除', sql: ['原预览'], counts: { insert: 0, update: 1, delete: 0 } };
  const preview = vi.fn(async (_input: unknown) => previewValue), apply = vi.fn(async (_input: unknown): Promise<SqliteTableEditOutcome> => { throw Error('删除草稿不得写库'); }), release = vi.fn(async (_input: { snapshotId?: string; previewId?: string }) => {});
  const editor = new SqliteTableEditor(page, { current, active, available, now: () => now, id, changed, dirty, preview, apply, release, cancel: async () => {}, acquire: () => ({ owns: () => true, release: () => true }), committed: () => {} });
  /** 通过原单行编辑形成已有本地更新，不直接替换被测账本。 */
  const save = (row: number, value: string) => { const next = [...editor.view.rows[row].values]; next[0] = cell(value); editor.save(editor.view.rows[row].id, next); };
  const ready = async () => { save(0, '已修改'); await editor.preview(); expect(editor.view.preview).toBe(previewValue); };
  return { editor, page, current, active, available, id, changed, dirty, preview, apply, release, previewValue, save, ready, expire: () => { now = 1800000; } };
}
/** 只读捕获真实私有账本，失败/noop必须保留其引用、长度、预览及副作用次数。 */
function capture(f: ReturnType<typeof fixture>) {
  const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean };
  return { rows: f.editor.view.rows, past: inner.past, pastLength: inner.past.length, future: inner.future, futureLength: inner.future.length, input: inner.input, preview: f.editor.view.preview, changes: structuredClone(f.editor.changes), ids: f.id.mock.calls.length, releases: f.release.mock.calls.length, previews: f.preview.mock.calls.length, applies: f.apply.mock.calls.length, changed: f.changed.mock.calls.length, dirty: f.dirty.mock.calls.length };
}
/** 所有拒绝路径均不应偷偷删除部分行、清redo或释放原预览。 */
function unchanged(f: ReturnType<typeof fixture>, before: ReturnType<typeof capture>) {
  const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean };
  expect(f.editor.view.rows).toBe(before.rows); expect(inner.past).toBe(before.past); expect(inner.past).toHaveLength(before.pastLength); expect(inner.future).toBe(before.future); expect(inner.future).toHaveLength(before.futureLength); expect(inner.input).toBe(before.input); expect(f.editor.view.preview).toBe(before.preview); expect(f.editor.changes).toEqual(before.changes); expect(f.id).toHaveBeenCalledTimes(before.ids); expect(f.release).toHaveBeenCalledTimes(before.releases); expect(f.preview).toHaveBeenCalledTimes(before.previews); expect(f.apply).toHaveBeenCalledTimes(before.applies); expect(f.changed).toHaveBeenCalledTimes(before.changed); expect(f.dirty).toHaveBeenCalledTimes(before.dirty);
}

describe('SQLite勾选批量删除只形成一个本地撤销步骤', () => {
  it('混合原行/新增行整批删除，未选行引用和typed值保持；undo恢复原更新，redo恢复整组', () => {
    const f = fixture(); f.save(0, '本地更新\0🚢'); const [inserted] = f.editor.appendRows([[cell('新增'), undefined]]), original = f.editor.view.rows, calls = f.changed.mock.calls.length, ids = f.id.mock.calls.length;
    expect(f.editor.removeRows(['original-0', inserted, 'original-2'])).toBe(3);
    const after = f.editor.view.rows; expect(after).toHaveLength(3); expect(after[0].deleted).toBe(true); expect(after[0].values).toBe(original[0].values); expect(after[1]).toBe(original[1]); expect(after[2].deleted).toBe(true); expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }, { kind: 'delete', row: 2 }]); expect(f.changed).toHaveBeenCalledTimes(calls + 1); expect(f.id).toHaveBeenCalledTimes(ids); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
    f.editor.undo(); expect(f.editor.view.rows).toBe(original); expect(f.editor.view.rows[0].values[0]).toEqual(cell('本地更新\0🚢')); expect(f.editor.changes.map(change => change.kind)).toEqual(['update', 'insert']); f.editor.redo(); expect(f.editor.view.rows).toBe(after);
  });

  it('删除最后一条本地新增可返回零changes；仍是一步可撤销的真实删除', () => {
    const f = fixture(0), [id] = f.editor.appendRows([[undefined, undefined]]), before = f.editor.view.rows;
    expect(f.editor.removeRows([id])).toBe(1); expect(f.editor.view.rows).toEqual([]); expect(f.editor.changes).toEqual([]); expect(f.editor.dirty).toBe(false); f.editor.undo(); expect(f.editor.view.rows).toBe(before); f.editor.redo(); expect(f.editor.view.rows).toEqual([]);
  });

  it('空组保留准确preview、undo和副作用次数；重复空组也不产生步骤', async () => {
    const f = fixture(); await f.ready(); const before = capture(f); expect(f.editor.removeRows([])).toBe(0); expect(f.editor.removeRows(Object.freeze([]))).toBe(0); unchanged(f, before);
  });

  it('空组不清已有redo，恢复到当前相同数据也不冒充一次新变化', () => {
    const f = fixture(); f.save(0, '一'); f.save(0, '二'); f.editor.undo(); const before = capture(f); expect(f.editor.removeRows([])).toBe(0); unchanged(f, before); f.editor.redo(); expect(f.editor.view.rows[0].values[0]).toEqual(cell('二'));
  });

  it('只有成功才释放旧preview一次；失败及空组不废弃预览', async () => {
    const f = fixture(); await f.ready(); const before = capture(f); expect(() => f.editor.removeRows(['original-1', '不存在'])).toThrow(); unchanged(f, before); expect(f.editor.removeRows(['original-1'])).toBe(1); expect(f.editor.view.preview).toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(before.releases + 1); expect(f.release).toHaveBeenLastCalledWith({ previewId: 'preview-original' }); expect(f.preview).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled();
  });

  it('500原行删除允许，501整组拒绝且原行无一被标记', () => {
    const f = fixture(501), ids = f.editor.view.rows.map(row => row.id), before = capture(f); expect(() => f.editor.removeRows(ids)).toThrow(text.bulkDeleteLimit); unchanged(f, before); expect(f.editor.removeRows(ids.slice(0, 500))).toBe(500); expect(f.editor.changes).toHaveLength(500); expect(f.editor.view.rows[500].deleted).toBe(false);
  });

  it('已有本地新增计入累计500门；删除选中的新增可释放预算再删除原行', () => {
    const f = fixture(2), ids = f.editor.appendRows(Array.from({ length: 500 }, () => [undefined, undefined])); const before = capture(f);
    expect(() => f.editor.removeRows(['original-0'])).toThrow(text.bulkDeleteLimit); unchanged(f, before); expect(f.editor.removeRows([ids[0], 'original-0'])).toBe(2); expect(f.editor.changes).toHaveLength(500); expect(f.editor.changes.filter(change => change.kind === 'insert')).toHaveLength(499);
  });

  it('最终预算按新状态计算，删除大更新行会改为DELETE而非保留原更新字段', () => {
    const f = fixture(2); f.save(0, 'x'.repeat(65536)); expect(f.editor.removeRows(['original-0'])).toBe(1); expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }]); f.editor.undo(); expect(f.editor.changes[0].kind).toBe('update'); expect(f.editor.view.rows[0].values[0]).toEqual(cell('x'.repeat(65536)));
  });

  it('保留的其它脏修改仍受10000字段累计门保护，不以删除动作绕过输入预算', () => {
    const f = fixture(12, 1000);
    for (let row = 0; row < 11; row++) f.editor.save('original-' + row, Array.from({ length: 1000 }, () => cell('更新')));
    const before = capture(f); expect(() => f.editor.removeRows(['original-11'])).toThrow(text.bulkDeleteLimit); unchanged(f, before);
    expect(f.editor.removeRows(['original-10'])).toBe(1); expect(f.editor.changes).toHaveLength(11); expect(f.editor.changes.filter(change => change.kind === 'update')).toHaveLength(10); f.editor.undo(); expect(f.editor.view.rows).toBe(before.rows); expect(f.editor.changes).toEqual(before.changes);
  });

  it('保留的其它脏修改超过2MiB时拒绝，不能先标记选中的原行', () => {
    const f = fixture(34, 1); for (let row = 0; row < 33; row++) f.save(row, 'x'.repeat(65536)); const before = capture(f); expect(() => f.editor.removeRows(['original-33'])).toThrow(text.bulkDeleteLimit); unchanged(f, before);
  });

  it.each(['duplicate', 'unknown', 'empty-id', 'non-string', 'sparse', 'extra', 'symbol', 'prototype', 'huge', 'over1500'] as const)('目标%s格式失败不产生半批删除或消耗undo/redo', kind => {
    const f = fixture(); f.save(0, '一'); f.save(0, '二'); f.editor.undo(); const before = capture(f); let ids: unknown = ['original-0'];
    if (kind === 'duplicate') ids = ['original-0', 'original-0']; if (kind === 'unknown') ids = ['original-0', 'missing']; if (kind === 'empty-id') ids = ['original-0', '']; if (kind === 'non-string') ids = ['original-0', 1]; if (kind === 'sparse') ids = new Array(2); if (kind === 'extra') Object.defineProperty(ids, 'extra', { value: true }); if (kind === 'symbol') Object.defineProperty(ids, Symbol('其它字段'), { value: true }); if (kind === 'prototype') Object.setPrototypeOf(ids, null); if (kind === 'huge') ids = new Array(4294967295); if (kind === 'over1500') ids = Array.from({ length: 1501 }, () => 'original-0');
    expect(() => f.editor.removeRows(ids as readonly string[])).toThrow(); unchanged(f, before);
  });

  it('目标访问器拒绝且不执行getter；冻结稠密输入允许', () => {
    const f = fixture(), getter = vi.fn(() => 'original-1'), ids = ['original-0', 'original-1']; Object.defineProperty(ids, '1', { enumerable: true, get: getter }); const before = capture(f); expect(() => f.editor.removeRows(ids)).toThrow(); expect(getter).not.toHaveBeenCalled(); unchanged(f, before); expect(f.editor.removeRows(Object.freeze(['original-0', 'original-1']))).toBe(2);
  });

  it('已deleted请求与有效原行混合时整组拒绝，不默默少删或添加noop步骤', () => {
    const f = fixture(); f.editor.remove('original-1'); const before = capture(f); expect(() => f.editor.removeRows(['original-0', 'original-1'])).toThrow(); unchanged(f, before); expect(() => f.editor.removeRows(['original-1'])).toThrow(); unchanged(f, before);
  });

  it.each(['rows', 'metadata', 'snapshot', 'value', 'input'] as const)('同步canEdit重入改变%s时不提交预先计算的删除', kind => {
    const f = fixture(), before = capture(f); let calls = 0;
    f.active.mockImplementation(() => { if (++calls === 2) { if (kind === 'rows') f.editor.save('original-1', [cell('后继草稿'), cell('原1:1')]); if (kind === 'metadata') f.page.columns[0].name = 'later'; if (kind === 'snapshot' && f.page.edit?.kind === 'editable') f.page.edit.snapshotId = 'later'; if (kind === 'value') f.editor.view.rows[1].values[0] = cell('同步改值'); if (kind === 'input') f.editor.inputOpen(true); } return true; });
    expect(() => f.editor.removeRows(['original-0'])).toThrow(); expect(f.editor.view.rows.every(row => !row.deleted)).toBe(true); expect(f.editor.view.rows[0]).toBe(before.rows[0]); expect(f.id).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it('输入开启时连空组也拒绝，保原input、预览与草稿状态', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(() => f.editor.removeRows(['original-0'])).toThrow(); expect(() => f.editor.removeRows([])).toThrow(); unchanged(f, before);
  });

  it.each(['inactive', 'unavailable', 'readonly', 'stale', 'expired', 'disposed'] as const)('%s不具资格时不删除或另发任务', state => {
    const f = fixture(), rows = f.editor.view.rows; if (state === 'inactive') f.active.mockReturnValue(false); if (state === 'unavailable') f.available.mockReturnValue(false); if (state === 'readonly') f.page.edit = { kind: 'readonly', reason: '只读' }; if (state === 'stale') f.current.mockReturnValue(false); if (state === 'expired') f.expire(); if (state === 'disposed') f.editor.dispose();
    expect(() => f.editor.removeRows(['original-0'])).toThrow(); expect(f.editor.view.rows).toBe(rows); expect(rows.every(row => !row.deleted)).toBe(true); expect(f.id).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it('真实preview尚未结束时busy拒绝，不抢任务或释放原租约', async () => {
    const f = fixture(); f.save(0, '待预览'); let resolve!: (value: SqliteTableEditPreview) => void; f.preview.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); const work = f.editor.preview(), before = capture(f); expect(f.editor.busy).toBe(true); expect(() => f.editor.removeRows(['original-0'])).toThrow(); unchanged(f, before); resolve(f.previewValue); await work;
  });

  it('真实unknown结算后仍锁住原批次，不能用删除改写未知状态或自动重放', async () => {
    const f = fixture(); await f.ready(); f.apply.mockResolvedValueOnce({ operationId: 'unknown-operation', target: f.page.target, outcome: 'unknown', counts: { insert: 0, update: 1, delete: 0 }, fact: { operationId: 'unknown-operation', target: f.page.target, phase: 'unknown', requestedRows: 1, appliedRows: 0, commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: false }, message: '未知' }); await f.editor.apply(); const before = capture(f); expect(f.editor.view.unknown).toBe(true); expect(() => f.editor.removeRows(['original-0'])).toThrow(); unchanged(f, before); expect(f.apply).toHaveBeenCalledOnce();
  });
});
