import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { QueryFileSources } from '../../src/main/queryFileSources';
import { rememberQueryFile } from '../../src/main/queryFileRecents';

const io = vi.hoisted(() => ({ snapshot: null as any, reads: 0, writes: 0 }));
/** 仅替换文件字节IO；解码、编码、冲突/来源提交、SQLite事务都执行原实现。 */
vi.mock('../../src/main/queryFileSourceFiles', async () => {
  const original: any = await vi.importActual('../../src/main/queryFileSourceFiles');
  return { ...original,
    async readQueryFileSnapshot(path: string, check: () => void) { check(); io.reads++; if (path !== io.snapshot.path) throw new original.QueryFileSourceFailure('missing', 'RAM文件不存在'); return { ...io.snapshot, bytes: Buffer.from(io.snapshot.bytes) }; },
    async writeBoundQueryFile(path: string, bytes: Buffer, _expected: unknown, check: () => void, mark: (value: string) => void) { check(); io.writes++; mark('yes'); io.snapshot = { ...io.snapshot, path, bytes: Buffer.from(bytes), digest: original.queryFileBytesDigest(bytes), identity: { ...io.snapshot.identity, ino: String(Number(io.snapshot.identity.ino) + 1), size: bytes.length } }; return io.snapshot; },
  };
});
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const stores: LocalStore[] = [];
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') }); });
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
/** 私有构造器只用于注入真实内存SQLite和RAM落盘端口，禁止调用LocalStore.open或真实FS。 */
function storeFrom(bytes?: Uint8Array) {
  const store: LocalStore = new (LocalStore as any)(new SQL.Database(bytes), resolve('RAM-config.sqlite'), { available: () => false }, (data: Uint8Array) => new SQL.Database(data));
  const flush = vi.fn(); (store as any).flush = flush; (store as any).migrate(); stores.push(store); return { store, flush };
}
function fixture() {
  const f = storeFrom();
  f.store.saveSettings({ ...defaultSettings, tabs: [{ id: 'one', kind: 'query', connectionId: 'ram', title: '原草稿', sql: '' }] }); f.flush.mockClear();
  const bytes = Buffer.from("SELECT '中文😀';\r\n"); io.reads = 0; io.writes = 0;
  io.snapshot = { path: resolve('RAM-合成.sql'), bytes, digest: createHash('sha256').update(bytes).digest('hex'), mode: 0o600, identity: { dev: '1', ino: '100', size: bytes.length, mtime: '1', ctime: '1' } };
  const choose = vi.fn(async () => io.snapshot.path), events: any[] = [];
  const service = new QueryFileSources({ store: f.store, choose, reserve: async () => () => {}, report: event => events.push(event) });
  const scope = { document: {}, assertCurrent() {} };
  return { ...f, service, scope, choose, events, open: () => service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, scope), corrupt: () => (f.store as any).db.run('INSERT INTO query_file_recents VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', ['{"损坏的可选缓存":true}']) };
}

describe('最近SQL可选缓存的独立功能窄核（RAM）', () => {
  it('健康打开/保存后仅列出不读取字节；重启仍保留相同ID及精确SQL', async () => {
    const f = fixture(), opened = await f.open(); expect(opened.state).toBe('opened'); if (opened.state !== 'opened') throw Error('健康打开失败');
    const saved = await f.service.save({ tabId: 'one', taskId: randomUUID(), source: opened.binding.ref, sql: "SELECT '精确新值';\r\n" }, f.scope); expect(saved.state).toBe('saved');
    const before = io.reads, entry = f.service.recent({ tabId: 'one' }, f.scope)[0]; expect(io.reads).toBe(before); expect(f.service.recent({ tabId: 'one' }, f.scope)).toHaveLength(1); expect(f.choose).toHaveBeenCalledTimes(1);
    const reopened = storeFrom((f.store as any).db.export()).store; expect(reopened.queryRecentFiles()[0].id).toBe(entry.id); expect(reopened.settings().tabs[0].sql).toBe("SELECT '中文😀';\r\n");
  });
  it('坏可选缓存不能阻断普通文件打开的来源提交', async () => {
    const f = fixture(); f.corrupt(); const result = await f.open(); expect(io.reads).toBe(1); expect(io.writes).toBe(0);
    expect(result, '普通打开应独立于可选历史：' + JSON.stringify(result)).toMatchObject({ state: 'opened' });
  });
  it('坏可选缓存不能把已完成字节写入的普通保存改报来源存储失败', async () => {
    const f = fixture(), opened = await f.open(); expect(opened.state).toBe('opened'); if (opened.state !== 'opened') throw Error('健康打开失败');
    f.corrupt(); const result = await f.service.save({ tabId: 'one', taskId: randomUUID(), source: opened.binding.ref, sql: 'SELECT 已写新值;' }, f.scope);
    expect(io.snapshot.bytes.toString('utf8')).toBe('SELECT 已写新值;'); expect(io.writes).toBe(1);
    expect(result, '字节已写成功，来源仍为' + JSON.stringify(f.store.queryFileSource('one')?.ref) + '；实际回包' + JSON.stringify(result)).toMatchObject({ state: 'saved' });
  });
  it('首次列出确实写配置并依赖落盘，已有缓存后再列出则无写入', () => {
    const f = fixture(); expect(f.store.queryRecentFiles()).toEqual([]); expect(f.flush).toHaveBeenCalledTimes(1); f.flush.mockClear();
    expect(f.store.queryRecentFiles()).toEqual([]); expect(f.flush).not.toHaveBeenCalled();
    (f.store as any).db.run('DELETE FROM query_file_recents'); f.flush.mockImplementation(() => { throw Error('RAM配置不可写'); });
    expect(() => f.store.queryRecentFiles()).toThrow('最近SQL文件记录不可读取'); expect(io.reads).toBe(0); expect(io.writes).toBe(0);
  });
  it('同路径重复使用保持ID并置顶，最多20项，不需要访问文件', () => {
    let entries: any[] = []; for (let i = 0; i < 24; i++) entries = rememberQueryFile(entries, { path: resolve('RAM-' + i + '.sql'), encoding: 'utf8' });
    const chosen = entries[10]; entries = rememberQueryFile(entries, { path: chosen.path, encoding: 'utf16le' }); expect(entries).toHaveLength(20); expect(entries[0]).toMatchObject({ id: chosen.id, path: chosen.path, encoding: 'utf16le' });
  });
});
