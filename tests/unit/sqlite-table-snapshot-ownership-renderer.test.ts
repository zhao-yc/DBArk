import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableBrowser, type SqliteTableScope } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';

/** 页面发布和 React effect 接管之间保持独立可控，不把发布当成已交接。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function page(input: SqliteTablePageInput): SqliteTablePage {
  return { schemaKey: 'a'.repeat(64), target: { connectionId: input.connectionId, database: 'main', table: input.table, kind: 'table' }, columns: [{ name: 'id', declaredType: 'INTEGER' }], offset: input.offset, limit: input.limit, hasMore: true,
    result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: 1 }], statement: '', elapsedMs: 1, truncated: false },
    edit: { kind: 'editable', snapshotId: input.taskId + '-snapshot', expiresAt: new Date(1800000).toISOString(), columns: [{ name: 'id', declaredType: 'INTEGER', generated: false, hasDefault: false, nullable: false }], rows: [[{ kind: 'integer', value: '1' }]], locator: { kind: 'primary-key', columns: ['id'] } } };
}
function fixture() {
  const scope: SqliteTableScope = { tab: {}, profile: {}, connectionId: 'sqlite', database: 'main', table: '表', version: 0, present: true, active: true, sqlite: true, editing: true };
  const reads: { input: SqliteTablePageInput; pending: ReturnType<typeof deferred<SqliteTablePage>> }[] = [], releases = vi.fn(async (_snapshot: string) => {}); let sequence = 0;
  const browser = new SqliteTableBrowser({ scope: () => scope, read: input => { const pending = deferred<SqliteTablePage>(); reads.push({ input, pending }); return pending.promise; }, release: releases, cancel: async () => {}, acquire: () => ({ owns: () => true, release: () => true }), id: () => 'read-' + ++sequence, changed: () => {}, subscribe: () => () => {} }); browser.activate();
  async function publish() { const work = browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 0), received = page(reads.at(-1)!.input); reads.at(-1)!.pending.resolve(received); await work; expect(browser.pageCurrent(received)).toBe(true); return received; }
  /** 编辑器构造保持无外部副作用；只有 parent 的同步 adopt 成功后才安装/使用。 */
  function editor(received: SqliteTablePage) { return new SqliteTableEditor(received, { current: () => true, active: () => scope.active, available: () => true, acquire: () => ({ owns: () => true, release: () => true }), now: () => 0, id: () => 'local', changed: () => {}, dirty: () => {}, preview: async () => { throw Error('本用例不预览'); }, apply: async () => { throw Error('本用例不提交'); }, cancel: async () => {}, release: async input => { if (input.snapshotId) await releases(input.snapshotId); }, committed: () => {} }); }
  return { browser, scope, reads, releases, publish, editor };
}

describe('SQLite 编辑快照从浏览器到编辑器的真实交接', () => {
  it('已发布但未接管页面失活时释放一次，恢复活动不能采用已释放来源', async () => {
    const f = fixture(), received = await f.publish(); f.scope.active = false; f.browser.observe(); f.browser.observe(); expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot'); f.scope.active = true; expect(f.browser.adopt(received)).toBe(false); f.browser.dispose(); expect(f.releases).toHaveBeenCalledTimes(1);
  });
  it('已发布未接管页面在新读取开始时释放，不能等待后继回包才收尾', async () => {
    const f = fixture(), old = await f.publish(); const work = f.browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 10); expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot'); expect(f.browser.adopt(old)).toBe(false); const next = page(f.reads[1].input); f.reads[1].pending.resolve(next); await work; f.browser.dispose(); expect(f.releases.mock.calls.map(call => call[0])).toEqual(['read-1-snapshot', 'read-2-snapshot']);
  });
  it('已发布未接管页面卸载释放，重复卸载不重复release', async () => {
    const f = fixture(); await f.publish(); f.browser.dispose(); f.browser.dispose(); expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot');
  });
  it('准确交接后失活保留本地草稿，browser替换/卸载/旧effect不得释放编辑器来源', async () => {
    const f = fixture(), received = await f.publish(), editor = f.editor(received); expect(f.releases).not.toHaveBeenCalled(); expect(f.browser.adopt(received)).toBe(true); expect(f.browser.adopt(received)).toBe(false);
    editor.remove('original-0'); expect(editor.changes).toEqual([{ kind: 'delete', row: 0 }]); f.scope.active = false; f.browser.observe(); f.browser.releaseUnadopted(received); f.browser.dispose(); expect(f.releases).not.toHaveBeenCalled(); expect(editor.dirty).toBe(true); expect(editor.view.valid).toBe(true); editor.dispose(); editor.dispose(); expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot');
  });
  it('旧回包未发布便精确释放，不能adopt或留到TTL', async () => {
    const f = fixture(), work = f.browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 0); f.scope.active = false; f.browser.observe(); const late = page(f.reads[0].input); f.reads[0].pending.resolve(late); await work; expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot'); expect(f.browser.adopt(late)).toBe(false); f.browser.dispose(); expect(f.releases).toHaveBeenCalledTimes(1);
  });
  it('editor构造失败前归属仍在browser，由真实parent拒绝路径释放且不重复清理', async () => {
    const f = fixture(), received = await f.publish(); if (received.edit?.kind !== 'editable') throw Error('夹具未签发'); received.edit.columns = [];
    expect(() => f.editor(received)).toThrow(); expect(f.releases).not.toHaveBeenCalled(); f.browser.releaseUnadopted(received); expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot'); f.browser.dispose(); expect(f.releases).toHaveBeenCalledTimes(1);
  });
  it('只允许准确page对象且当前来源接管，克隆或非当前页不能偷取snapshot', async () => {
    const f = fixture(), received = await f.publish(); expect(f.browser.adopt(structuredClone(received))).toBe(false); expect(f.browser.adopt(received)).toBe(true); f.browser.releaseUnadopted(received); expect(f.releases).not.toHaveBeenCalled(); f.editor(received).dispose();
  });
  it('发布校验失败的editable回包也释放；readonly页无编辑snapshot释放请求', async () => {
    const f = fixture(), work = f.browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 0), bad = page(f.reads[0].input); bad.schemaKey = '错误'; f.reads[0].pending.resolve(bad); await work; expect(f.releases).toHaveBeenCalledExactlyOnceWith('read-1-snapshot'); f.browser.dispose();
    const g = fixture(), read = g.browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 0), readonly = page(g.reads[0].input); readonly.edit = { kind: 'readonly', reason: '只读视图' }; g.reads[0].pending.resolve(readonly); await read; expect(g.browser.adopt(readonly)).toBe(false); g.scope.active = false; g.browser.observe(); g.browser.dispose(); expect(g.releases).not.toHaveBeenCalled();
  });
});
