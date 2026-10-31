import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteTablePage, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableEditOwners } from '../../src/main/sqliteTableEditOwners';

const input: SqliteTablePageInput = { connectionId: 'c', database: 'main', table: 'subject', taskId: 'page', offset: 0, limit: 10, mode: 'and', filters: [], sort: [], editing: true };
/** 文档/连接代次由测试显式变更，异步取消与释放承诺单独控制。 */
function fixture() {
  let revision = 1, epoch = {}, closing = false, unavailable = false;
  const contents = new EventEmitter(), current = { document: {} }, owner = { owner: { contents, document: current.document } } as unknown as ColumnsInvocation;
  const release = vi.fn(async () => {}), stop = vi.fn(async () => {});
  const owners = new SqliteTableEditOwners({ assert: value => { if (value.owner.document !== current.document) throw Error('原主文档失效'); }, same: (left, right) => left.owner.document === right.owner.document, revision: () => revision, epoch: () => epoch, closing: () => closing, available: () => { if (unavailable) throw Error('保存锁'); }, release, stop });
  const page = (id = 'snapshot'): SqliteTablePage => ({ target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { rows: [{ c0: '1' }], columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], statement: '', elapsedMs: 0, truncated: false }, offset: 0, limit: 10, hasMore: false, edit: { kind: 'editable', snapshotId: id, expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), columns: [{ name: 'id', declaredType: 'INTEGER', generated: false, nullable: false, hasDefault: false }], rows: [[{ kind: 'integer', value: '1' }]], locator: { kind: 'rowid', columns: [] } } });
  const preview = (id = 'preview', snapshotId = 'snapshot') => ({ previewId: id, snapshotId, target: { connectionId: 'c', database: 'main' as const, table: 'subject' }, schemaKey: 'a'.repeat(64), expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), confirmation: 'main.subject', sql: ['UPDATE 仅预览'], counts: { insert: 0, update: 1, delete: 0 } });
  const admit = async (id = 'snapshot') => { const gate = owners.page(owner, input); return gate.accept(page(id)); };
  const prepare = async (id = 'preview', snapshotId = 'snapshot') => { const gate = owners.preview(owner, snapshotId); return gate.accept(preview(id, snapshotId)); };
  return { owners, owner, release, stop, contents, page, preview, admit, prepare, revise() { revision++; owners.observe(); }, closeConnection() { epoch = {}; owners.observe(); }, navigate() { current.document = {}; contents.emit('did-navigate'); }, lock(value: boolean) { unavailable = value; }, shutdown() { closing = true; owners.observe(); } };
}
describe('SQLite编辑来源Main能力', () => {
  it('只签原目标页、原预览及一次claim，回滚可重新预览而已提交撤兄弟能力', async () => {
    const f = fixture(); await f.admit(); await f.prepare('p1'); await f.prepare('p2');
    const claimed = f.owners.claim(f.owner, 'p1'); expect(claimed.target).toEqual({ connectionId: 'c', database: 'main', table: 'subject' }); expect(() => f.owners.claim(f.owner, 'p1')).toThrow();
    claimed.finish('rolled-back'); await f.prepare('p3'); claimed.finish('committed');
    expect(() => f.owners.claim(f.owner, 'p2')).toThrow(); expect(() => f.owners.claim(f.owner, 'p3')).toThrow(); expect(() => f.owners.snapshot(f.owner, 'snapshot')).toThrow(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'snapshot' });
  });
  it.each(['revision', 'connection', 'navigation', 'shutdown'])('%s变化撤销原能力，不能在同名重开或同URL文档恢复', async mode => {
    const f = fixture(); await f.admit(); await f.prepare(); const claimed = f.owners.claim(f.owner, 'preview');
    if (mode === 'revision') f.revise(); else if (mode === 'connection') f.closeConnection(); else if (mode === 'navigation') f.navigate(); else f.shutdown();
    expect(claimed.check).toThrow(); expect(() => f.owners.preview(f.owner, 'snapshot')).toThrow();
  });
  it('迟到页/预览不向新文档或新配置发布，准确释放返回的原能力', async () => {
    const f = fixture(), page = f.owners.page(f.owner, input); f.revise(); await expect(page.accept(f.page())).rejects.toThrow(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'snapshot' });
    await f.admit('next'); const preview = f.owners.preview(f.owner, 'next'); f.revise(); await expect(preview.accept(f.preview('late', 'next'))).rejects.toThrow(); expect(f.release).toHaveBeenCalledWith({ previewId: 'late' });
  });
  it('一次未成功的保存锁不取消已投递写，真实修订变化只精确取消一次', async () => {
    const f = fixture(); await f.admit(); await f.prepare(); const claimed = f.owners.claim(f.owner, 'preview'), lease = f.owners.begin('apply', f.owner, claimed.check); lease.beforeSend();
    f.lock(true); f.owners.observe(); expect(f.stop).not.toHaveBeenCalled(); expect(claimed.check).not.toThrow();
    f.lock(false); f.revise(); f.owners.observe(); await lease.release(); expect(f.stop).toHaveBeenCalledExactlyOnceWith('apply');
  });
  it('取消在Main准备期也登记；取消失败不盖过原写入终态，释放等原取消Promise', async () => {
    const f = fixture(); await f.admit(); await f.prepare(); const claimed = f.owners.claim(f.owner, 'preview'), lease = f.owners.begin('apply', f.owner, claimed.check);
    let reject!: (reason: Error) => void; f.stop.mockImplementation(() => new Promise<void>((_yes, no) => { reject = no; }));
    const cancel = f.owners.cancel('apply', f.owner), failed = expect(cancel).rejects.toThrow('原取消失败'); let done = false; const released = lease.release().then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    reject(Error('原取消失败')); await failed; await released; expect(f.owners.owns('apply')).toBe(false);
  });
  it('未知token不下发到runtime，任一外文档能力都不能部分释放同组其它token', async () => {
    const f = fixture(); await f.admit(); await f.prepare(); await f.owners.release(f.owner, { snapshotId: 'unknown', previewId: 'unknown' }); expect(f.release).not.toHaveBeenCalled();
    const alien = { owner: { document: {} } } as ColumnsInvocation; await expect(f.owners.release(alien, { snapshotId: 'snapshot', previewId: 'preview' })).rejects.toThrow(); expect(f.release).not.toHaveBeenCalled();
    await f.owners.release(f.owner, { previewId: 'preview' }); expect(f.release).toHaveBeenCalledExactlyOnceWith({ previewId: 'preview' }); expect(() => f.owners.snapshot(f.owner, 'snapshot')).not.toThrow();
  });
});
