import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableEditOutcome, SqliteTableEditPreview } from '../../src/shared/sqliteTableEdit';
import { SqliteTableEditor, sqliteDraftChanges } from '../../src/renderer/sqliteTableEditor';

/** 原请求与取消确认分别控制，不能用 ACK 猜测写入已结束。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function page(): SqliteTablePage {
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'mixed', declaredType: '' }, { name: 'generated', declaredType: 'TEXT', generated: true }];
  return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '真实表', kind: 'table' }, columns, offset: 0, limit: 10, hasMore: false,
    result: { columns: columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows: [{ c0: '9223372036854775807', c1: '2', c2: '生成' }], elapsedMs: 1, statement: '', truncated: false },
    edit: { kind: 'editable', snapshotId: 'snapshot-original', expiresAt: new Date(1800000).toISOString(), columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: true })), rows: [[{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '2' }, { kind: 'text', value: '生成' }]], locator: { kind: 'primary-key', columns: ['id'] } } };
}
function fixture() {
  let now = 0, source = true, active = true, busy = false, owner = 0, sequence = 0, releases = 0;
  const original = page(), previewPending = deferred<SqliteTableEditPreview>(), applyPending = deferred<SqliteTableEditOutcome>(), cancelPending = deferred<void>();
  const preview = vi.fn((_input: { snapshotId: string; taskId: string; changes: unknown[] }) => previewPending.promise), apply = vi.fn((_input: { previewId: string; taskId: string; confirmation: string }) => applyPending.promise), release = vi.fn(async (_input: { snapshotId?: string; previewId?: string }) => {}), cancel = vi.fn((_taskId: string) => cancelPending.promise), dirty = vi.fn(), committed = vi.fn();
  const editor: SqliteTableEditor = new SqliteTableEditor(original, {
    current: () => source, active: () => active, available: () => !busy, now: () => now, id: () => 'task-' + ++sequence,
    acquire: () => { if (busy) throw Error('他人作业'); busy = true; const lease = ++owner; editor.observe(); const owns = () => busy && owner === lease; return { owns, release: () => { if (!owns()) return false; releases++; busy = false; editor.observe(); return true; } }; },
    preview, apply, release, cancel, changed: () => {}, dirty, committed,
  });
  const previewResult: SqliteTableEditPreview = { previewId: 'preview', snapshotId: 'snapshot-original', target: original.target, schemaKey: original.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.真实表', sql: ['UPDATE "真实表" SET "mixed" = ?'], counts: { insert: 0, update: 1, delete: 0 } };
  /** 每次调用真实控制器，服务端只回可信结构，不模拟隐藏按钮或客户端写入。 */
  async function ready() { editor.save('original-0', [original.edit!.kind === 'editable' ? original.edit!.rows[0][0] : undefined, { kind: 'integer', value: '2' }, { kind: 'text', value: '生成' }]); const work = editor.preview(); previewPending.resolve(previewResult); await work; }
  function outcome(value: SqliteTableEditOutcome['outcome']): SqliteTableEditOutcome { return { operationId: 'operation', target: original.target, outcome: value, counts: previewResult.counts, message: value, fact: { operationId: 'operation', target: original.target, phase: value === 'not-sent' ? 'not-sent' : value, requestedRows: 1, appliedRows: value === 'committed' ? 1 : 0, commitMayHaveBeenSent: value === 'committed' || value === 'unknown', commitAcknowledged: value === 'committed', rollbackAcknowledged: value === 'rolled-back' } }; }
  return { editor, original, preview, apply, release, cancel, dirty, committed, previewPending, applyPending, cancelPending, previewResult, ready, outcome, get busy() { return busy; }, get releases() { return releases; }, setSource(value: boolean) { source = value; editor.observe(); }, setActive(value: boolean) { active = value; editor.observe(); }, expire() { now = 1800000; editor.observe(); }, takeover() { owner++; editor.observe(); } };
}

describe('SQLite 专属 typed 本地草稿', () => {
  it('文本2改整数2产生准确差异；64位原值和生成列不被重写，尚无写请求', () => {
    const f = fixture(); f.editor.save('original-0', [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '2' }, { kind: 'text', value: '试改生成' }]);
    expect(f.editor.changes).toEqual([{ kind: 'update', row: 0, values: [{ column: 'mixed', value: { kind: 'integer', value: '2' } }] }]); expect(f.apply).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.editor.view.rows[0].values[0]).toEqual({ kind: 'integer', value: '9223372036854775807' });
  });
  it('新增未选字段就是省略，显式NULL和空BLOB保持区别，生成列始终剔除', () => {
    const f = fixture(), id = f.editor.add()!; expect(f.editor.changes).toEqual([{ kind: 'insert', values: [] }]);
    f.editor.save(id, [{ kind: 'null' }, { kind: 'blob', value: '' }, { kind: 'text', value: '不写' }]); expect(f.editor.changes).toEqual([{ kind: 'insert', values: [{ column: 'id', value: { kind: 'null' } }, { column: 'mixed', value: { kind: 'blob', value: '' } }] }]);
  });
  it('单元及整行草稿支持撤销重做，删除原行只发送row编号', () => {
    const f = fixture(); f.editor.remove('original-0'); expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }]); f.editor.undo(); expect(f.editor.changes).toEqual([]); f.editor.redo(); expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }]); f.editor.discard(); expect(f.editor.dirty).toBe(false); expect(f.editor.view.redo).toBe(false);
  });
  it.each([{ kind: 'integer', value: '9223372036854775808' }, { kind: 'real', value: 'Infinity' }, { kind: 'blob', value: 'f' }])('拒绝非法新typed值 %j，草稿和原值不变', value => {
    const f = fixture(); expect(() => f.editor.save('original-0', [{ kind: 'integer', value: '9223372036854775807' }, value as any, { kind: 'text', value: '生成' }])).toThrow(); expect(f.editor.changes).toEqual([]);
  });
  it('原非有限REAL保持展示，修改其它字段不强迫重写原REAL', () => {
    const source = page(); if (source.edit?.kind !== 'editable') throw Error('夹具无编辑能力'); source.edit.rows[0][0] = { kind: 'real', value: 'Infinity' };
    expect(sqliteDraftChanges(source, [{ id: 'r', index: 0, deleted: false, values: [{ kind: 'real', value: 'Infinity' }, { kind: 'null' }, { kind: 'text', value: '生成' }] }])).toEqual([{ kind: 'update', row: 0, values: [{ column: 'mixed', value: { kind: 'null' } }] }]);
  });
  it('离开活动标签可保留草稿和来源；真实来源ABA永久撤权并保留草稿', () => {
    const f = fixture(); f.editor.remove('original-0'); f.setActive(false); expect(f.editor.view.valid).toBe(true); expect(f.editor.canEdit()).toBe(false); f.setActive(true); expect(f.editor.canEdit()).toBe(true); f.setSource(false); f.setSource(true); expect(f.editor.view.valid).toBe(false); expect(f.editor.changes).toEqual([{ kind: 'delete', row: 0 }]);
  });
  it('到期保留草稿但禁止预览，未保存字段输入也同步dirty', async () => {
    const f = fixture(); f.editor.inputOpen(true); expect(f.dirty).toHaveBeenLastCalledWith(true); f.editor.inputOpen(false); expect(f.dirty).toHaveBeenLastCalledWith(false); f.editor.remove('original-0'); f.expire(); await f.editor.preview(); expect(f.preview).not.toHaveBeenCalled(); expect(f.editor.dirty).toBe(true); expect(f.editor.view.message).toContain('30 分钟');
  });
});

describe('SQLite 集中预览与真实提交结算', () => {
  it('预览只发snapshot和typed差异，关闭只释放预览、保留草稿且零apply', async () => {
    const f = fixture(); await f.ready(); expect(f.preview.mock.calls[0][0]).toEqual({ snapshotId: 'snapshot-original', taskId: expect.any(String), changes: [{ kind: 'update', row: 0, values: [{ column: 'mixed', value: { kind: 'integer', value: '2' } }] }] }); expect(f.editor.view.preview).toBe(f.previewResult); f.editor.closePreview(); expect(f.release).toHaveBeenCalledWith({ previewId: 'preview' }); expect(f.editor.dirty).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it('本地修改废弃旧preview并release；迟到预览遇来源失效也释放', async () => {
    const f = fixture(); await f.ready(); f.editor.remove('original-0'); expect(f.editor.view.preview).toBeUndefined(); expect(f.release).toHaveBeenCalledWith({ previewId: 'preview' });
    const g = fixture(); g.editor.remove('original-0'); const pending = g.editor.preview(); g.setSource(false); g.previewPending.resolve(g.previewResult); g.cancelPending.resolve(); await pending; expect(g.editor.view.preview).toBeUndefined(); expect(g.release).toHaveBeenCalledWith({ previewId: 'preview' }); expect(g.editor.dirty).toBe(true);
  });
  it.each(['rolled-back', 'not-sent', 'unknown'] as const)('%s保留原草稿；unknown永久锁定且不自动重放', async kind => {
    const f = fixture(); await f.ready(); const pending = f.editor.apply(); f.applyPending.resolve(f.outcome(kind)); await pending; expect(f.editor.changes).toHaveLength(1); expect(f.editor.dirty).toBe(true); expect(f.editor.view.preview).toBeUndefined(); expect(f.editor.view.unknown).toBe(kind === 'unknown'); expect(f.committed).not.toHaveBeenCalled(); await f.editor.apply(); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('真实commit后晚来源失效不改成功，准确草稿清空且刷新回调异常不变unknown', async () => {
    const f = fixture(); await f.ready(); f.committed.mockImplementation(() => { throw Error('刷新失败'); }); const pending = f.editor.apply(); f.setSource(false); f.applyPending.resolve(f.outcome('committed')); f.cancelPending.resolve(); await pending; expect(f.editor.dirty).toBe(false); expect(f.editor.view.unknown).toBe(false); expect(f.editor.view.message).toBe('committed'); expect(f.committed).toHaveBeenCalledOnce();
  });
  it('提交断包按unknown锁定，保留原草稿和核对提示', async () => {
    const f = fixture(); await f.ready(); const pending = f.editor.apply(); f.applyPending.reject(Error('IPC断开')); await pending; expect(f.editor.view.unknown).toBe(true); expect(f.editor.changes).toHaveLength(1); expect(f.editor.canEdit()).toBe(false); expect(f.editor.view.message).toContain('禁止重复提交');
  });
  it('cancel ACK先到不释放原busy，原Promise先到也必须等待ACK，自有租约不自失效', async () => {
    for (const ackFirst of [true, false]) {
      const f = fixture(); await f.ready(); expect(f.editor.view.valid).toBe(true); const releasesBefore = f.releases, pending = f.editor.apply(); f.editor.stop(); f.editor.stop(); expect(f.cancel).toHaveBeenCalledOnce();
      if (ackFirst) f.cancelPending.resolve(); else f.applyPending.resolve(f.outcome('rolled-back'));
      for (let i = 0; i < 8; i++) await Promise.resolve(); expect(f.busy).toBe(true); expect(f.releases).toBe(releasesBefore);
      if (ackFirst) f.applyPending.resolve(f.outcome('rolled-back')); else f.cancelPending.resolve(); await pending; expect(f.busy).toBe(false); expect(f.releases).toBe(releasesBefore + 1);
    }
  });
  it('其他任务接管后旧finally不清他人busy，也不能发布旧预览', async () => {
    const f = fixture(); f.editor.remove('original-0'); const pending = f.editor.preview(); f.takeover(); f.previewPending.resolve(f.previewResult); f.cancelPending.resolve(); await pending; expect(f.busy).toBe(true); expect(f.releases).toBe(0); expect(f.editor.view.valid).toBe(false); expect(f.editor.view.preview).toBeUndefined();
  });
  it('运行中不能放弃、修改、重复发送或通过dispose提前释放写任务', async () => {
    const f = fixture(); await f.ready(); const pending = f.editor.apply(); f.editor.discard(); f.editor.remove('original-0'); f.editor.dispose(); expect(f.busy).toBe(true); expect(f.apply).toHaveBeenCalledOnce(); f.applyPending.resolve(f.outcome('committed')); await pending; expect(f.busy).toBe(false); expect(f.committed).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'snapshot-original' });
  });
});
