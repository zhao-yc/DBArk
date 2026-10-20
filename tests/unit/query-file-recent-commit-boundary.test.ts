import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { QueryFileSources } from '../../src/main/queryFileSources';
import { rememberQueryFile } from '../../src/main/queryFileRecents';

const io = vi.hoisted(() => ({ snapshot: null as any, reads: 0, writes: 0 }));
/** 新目录读取端口同样只认已登记RAM目标，不将可选历史专项变成真实文件访问。 */
vi.mock('node:fs/promises', () => ({
  realpath: async (path: string) => { if (path !== io.snapshot?.path && path !== dirname(io.snapshot?.path ?? '')) throw Error('未知RAM路径'); return path; },
  lstat: async (path: string) => { if (path !== dirname(io.snapshot?.path ?? '')) throw Error('未知RAM目录'); return { isDirectory: () => true, isSymbolicLink: () => false, ino: 900n, dev: 1n }; },
  open: async () => { throw Error('本例不能打开真实文件'); }, rename: async () => { throw Error('本例不能重命名真实文件'); }, rm: async () => { throw Error('本例不能删除真实文件'); },
}));
/** 文件字节为RAM；实际编码、来源提交、SQL.js事务及恢复快照均执行生产实现。 */
vi.mock('../../src/main/queryFileSourceFiles', async () => {
  const original: any = await vi.importActual('../../src/main/queryFileSourceFiles');
  return { ...original,
    async readQueryFileSnapshot(path: string, check: () => void) { check(); io.reads++; if (path !== io.snapshot.path) throw Error('未登记RAM文件'); return { ...io.snapshot, bytes: Buffer.from(io.snapshot.bytes) }; },
    async writeBoundQueryFile(path: string, bytes: Buffer, _expected: unknown, check: () => void, mark: (value: string) => void) { check(); io.writes++; mark('yes'); io.snapshot = { ...io.snapshot, path, bytes: Buffer.from(bytes), digest: original.queryFileBytesDigest(bytes), identity: { ...io.snapshot.identity, ino: String(Number(io.snapshot.identity.ino) + 1), size: bytes.length } }; return io.snapshot; },
  };
});
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const stores: LocalStore[] = [];
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') }); });
afterEach(() => { stores.splice(0).forEach(store => store.close()); });

/** 私有构造器只注入真实内存SQLite和RAM落盘端口；不调用open、文件系统或实库连接。 */
function fixture() {
  let durable!: Uint8Array;
  const make = (bytes?: Uint8Array) => { const store: LocalStore = new (LocalStore as any)(new SQL.Database(bytes), resolve('RAM-commit-boundary.sqlite'), { available: () => false }, (data: Uint8Array) => new SQL.Database(data)); stores.push(store); return store; };
  const store = make(), persist = () => { durable = (store as any).db.export(); }, flush = vi.fn(persist); (store as any).flush = flush; (store as any).migrate();
  store.saveSettings({ ...defaultSettings, tabs: [{ id: 'one', kind: 'query', connectionId: 'ram', title: '原草稿', sql: '' }] }); flush.mockClear();
  const bytes = Buffer.from("SELECT '原基线';\r\n"); io.reads = 0; io.writes = 0;
  io.snapshot = { path: resolve('RAM-boundary.sql'), bytes, digest: createHash('sha256').update(bytes).digest('hex'), mode: 0o600, identity: { dev: '1', ino: '100', size: bytes.length, mtime: '1', ctime: '1' } };
  const events: any[] = [], service = new QueryFileSources({ store, choose: async () => io.snapshot.path, reserve: async () => () => {}, report: event => events.push(event) });
  const scope = { document: {}, assertCurrent() {} };
  return {
    store, flush, persist, service, events, scope,
    open: () => service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, scope),
    save: () => service.save({ tabId: 'one', taskId: randomUUID(), source: store.queryFileSource('one')!.ref, sql: 'SELECT 新保存值;' }, scope),
    rawCache: () => (store as any).db.exec('SELECT data FROM query_file_recents WHERE id=1')[0]?.values[0][0],
    reopened: () => make(durable),
    failSql(prefix: string) { const db = (store as any).db, run = db.run.bind(db); db.run = (sql: string, ...args: unknown[]) => { if (sql.startsWith(prefix)) throw Error('RAM指定持久化语句失败'); return run(sql, ...args); }; },
    corrupt() { (store as any).db.run('UPDATE query_file_recents SET data=? WHERE id=1', ['{"损坏的可选缓存":true}']); persist(); },
  };
}

it('坏缓存保存仍提交新来源/settings及可重建基线，坏缓存原字节保留，不自动重放文件', async () => {
  const f = fixture(); await f.open(); const before = f.store.queryFileSource('one')!; f.corrupt(); const cache = f.rawCache();
  const result = await f.save(); expect(result).toMatchObject({ state: 'saved', binding: { ref: { id: before.ref.id, revision: 2 } } });
  expect(f.store.queryFileSource('one')?.savedSqlDigest).toBe(createHash('sha256').update('SELECT 新保存值;').digest('hex')); expect(f.store.settings().tabs[0].fileSourceBinding?.revision).toBe(2); expect(f.reopened().queryFileSource('one')?.ref.revision).toBe(2);
  expect(f.rawCache()).toBe(cache); expect(() => f.store.queryRecentFiles()).toThrow('最近SQL文件记录不可读取'); expect(io.writes).toBe(1); expect(f.events.at(-1)).toMatchObject({ status: 'completed', queryFileSource: { wrote: 'yes' } });
});
it('可选历史第二次落盘失败只回退历史事务，已持久化来源/settings和新字节保持成功', async () => {
  const f = fixture(); await f.open();
  const entries = rememberQueryFile(f.store.queryRecentFiles(), { path: resolve('RAM-另一个最近.sql'), encoding: 'utf8' });
  (f.store as any).db.run('UPDATE query_file_recents SET data=? WHERE id=1', [JSON.stringify(entries)]); f.persist(); const cache = f.rawCache();
  f.flush.mockClear(); f.flush.mockImplementationOnce(f.persist).mockImplementationOnce(() => { throw Error('RAM可选历史落盘失败'); });
  expect(await f.save()).toMatchObject({ state: 'saved' }); expect(f.flush).toHaveBeenCalledTimes(2); expect(f.store.queryFileSource('one')?.ref.revision).toBe(2); expect(f.reopened().settings().tabs[0].fileSourceBinding?.revision).toBe(2); expect(f.rawCache()).toBe(cache); expect(io.writes).toBe(1);
});
it('可选历史SQL维护失败不改变已完成的权威来源提交', async () => {
  const f = fixture(); await f.open();
  const entries = rememberQueryFile(f.store.queryRecentFiles(), { path: resolve('RAM-另一个最近.sql'), encoding: 'utf8' }); (f.store as any).db.run('UPDATE query_file_recents SET data=? WHERE id=1', [JSON.stringify(entries)]); f.persist();
  const cache = f.rawCache(); f.flush.mockClear(); f.failSql('INSERT INTO query_file_recents');
  expect(await f.save()).toMatchObject({ state: 'saved' }); expect(f.flush).toHaveBeenCalledTimes(1); expect(f.store.queryFileSource('one')?.ref.revision).toBe(2); expect(f.reopened().queryFileSource('one')?.ref.revision).toBe(2); expect(f.rawCache()).toBe(cache); expect(io.writes).toBe(1);
});
it('健康历史顺序及编码未变化时仅执行必需落盘，不为普通保存新增第二次配置写入', async () => {
  const f = fixture(); await f.open(); const cache = f.rawCache(); f.flush.mockClear(); expect(await f.save()).toMatchObject({ state: 'saved' }); expect(f.flush).toHaveBeenCalledTimes(1); expect(f.rawCache()).toBe(cache); expect(io.writes).toBe(1);
});
it.each(['INSERT INTO query_file_sources', 'INSERT INTO settings'])('必需%s失败仍报告storage/wrote=yes并保留旧基线', async prefix => {
  const f = fixture(); await f.open(); const before = f.store.queryFileSource('one')!, cache = f.rawCache(); f.flush.mockClear(); f.failSql(prefix);
  expect(await f.save()).toMatchObject({ state: 'blocked', reason: 'storage', wrote: 'yes' }); expect(f.flush).not.toHaveBeenCalled(); expect(f.store.queryFileSource('one')).toEqual(before); expect(f.reopened().settings().tabs[0].fileSourceBinding).toEqual(before.ref); expect(f.rawCache()).toBe(cache); expect(io.snapshot.bytes.toString()).toBe('SELECT 新保存值;'); expect(io.writes).toBe(1); expect(f.events.at(-1)).toMatchObject({ status: 'failed', queryFileSource: { wrote: 'yes' } });
});
it('必需配置第一次落盘失败不被降级，已写事实和来源旧基线按原合同保留', async () => {
  const f = fixture(); await f.open(); const before = f.store.queryFileSource('one')!; f.flush.mockClear(); f.flush.mockImplementationOnce(() => { throw Error('RAM权威配置落盘失败'); });
  expect(await f.save()).toMatchObject({ state: 'blocked', reason: 'storage', wrote: 'yes' }); expect(f.flush).toHaveBeenCalledTimes(1); expect(f.store.queryFileSource('one')).toEqual(before); expect(f.reopened().queryFileSource('one')).toEqual(before); expect(io.writes).toBe(1);
});
it('普通打开的必需来源落盘失败仍报告未写，不能伪报opened', async () => {
  const f = fixture(); f.flush.mockImplementationOnce(() => { throw Error('RAM打开来源落盘失败'); });
  expect(await f.open()).toMatchObject({ state: 'blocked', reason: 'storage', wrote: 'no' }); expect(f.store.queryFileSource('one')).toBeUndefined(); expect(f.store.settings().tabs[0].sql).toBe(''); expect(io.reads).toBe(1); expect(io.writes).toBe(0);
});
it('首次列表初始化失败不交付临时ID，显式重试成功后ID稳定且未读取文件正文', async () => {
  const f = fixture(); await f.open(); (f.store as any).db.run('DELETE FROM query_file_recents'); f.persist(); f.flush.mockClear(); const reads = io.reads;
  f.flush.mockImplementationOnce(() => { throw Error('RAM首次列表不可写'); }); expect(() => f.store.queryRecentFiles()).toThrow('最近SQL文件记录不可读取'); expect(f.rawCache()).toBeUndefined();
  const entries = f.store.queryRecentFiles(); expect(entries).toHaveLength(1); expect(f.store.queryRecentFiles()).toEqual(entries); expect(f.reopened().queryRecentFiles()).toEqual(entries); expect(f.flush).toHaveBeenCalledTimes(2); expect(io.reads).toBe(reads); expect(io.writes).toBe(0);
});
