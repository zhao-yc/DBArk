import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { build } from 'esbuild';
import { LocalStore } from '../../src/main/storage';
import { SavedQueryPages } from '../../src/main/savedQueryPages';
import { SavedQuerySearches } from '../../src/main/savedQuerySearch';
import type { SavedQuery } from '../../src/shared/contracts';
import { savedQueryRenameZh } from '../../src/shared/savedQueryRename';

const publishFault = vi.hoisted(() => ({ path: '', calls: 0 }));
/** Node的ESM命名空间不可spy；只在准确原子发布边界注入故障，其余文件操作透传真实文件系统。 */
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, renameSync: (from: Parameters<typeof original.renameSync>[0], to: Parameters<typeof original.renameSync>[1]) => {
    if (publishFault.path && String(from) === publishFault.path + '.tmp' && String(to) === publishFault.path) { publishFault.calls++; throw Error('本例原子发布故障'); }
    return original.renameSync(from, to);
  } };
});

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>(); let SQL: SqlJsStatic;
const protector = { available: vi.fn(() => false), encrypt: vi.fn(() => { throw Error('不得加密凭据'); }), decrypt: vi.fn(() => { throw Error('不得读取凭据'); }) };
const profile = { id: 'c', name: '离线原连接', group: '', color: '', dialect: 'mysql' as const, host: 'never.invalid', port: 1, user: 'offline', database: 'profile_default' };
const sql = "SELECT '900719925474099312345','0.12345678901234567890','2026-10-15 01:02:03.123456',NULL,X'00FF','🚢';\r\n-- 完整SQL尾部";
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => { publishFault.path = ''; vi.restoreAllMocks(); for (const store of stores) store.close(); stores.clear(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); protector.available.mockClear(); protector.encrypt.mockClear(); protector.decrypt.mockClear(); });

/** 每例真实SQLite与独立临时目录；不会读取用户配置或连接数据库服务器。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-query-rename-')); directories.push(directory); const path = join(directory, 'config.sqlite');
  const store = await LocalStore.open(path, wasm, protector); stores.add(store); store.saveConnection(profile); return { store, path, directory };
}
/** 摘要取当前完整原文，不用查询名称或概要拼造CAS。 */
function reference(store: LocalStore, id: string) { return { id, digest: createHash('sha256').update(store.querySearchRaw(id)!).digest('hex') }; }
function record(id: string, patch: Partial<SavedQuery> = {}): SavedQuery { return { id, name: '原查询', connectionId: 'c', sql, updatedAt: '2026-10-15T00:00:00.000Z', ...patch }; }
/** 独立打开已发布SQLite原件，验证磁盘而不是生产store缓存。 */
function persisted(path: string, statement: string) { const database = new SQL.Database(readFileSync(path)); try { return database.exec(statement); } finally { database.close(); } }
function noSecrets() { expect(protector.available).not.toHaveBeenCalled(); expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled(); }

describe('保存查询直接重命名真实SQLite原子CAS', () => {
  it.each([
    { database: 'db', databaseContext: { state: 'known', database: 'db' } },
    { databaseContext: { state: 'known', database: null } },
    { databaseContext: { state: 'unknown' } },
    {},
    { database: 'legacy_db' }
  ] as const)('五类原默认库语义保持且原文本空白不被修剪：%j', async patch => {
    const { store, path } = await fixture(); store.saveQuery(record('source', patch)); const previous = JSON.parse(store.querySearchRaw('source')!) as SavedQuery;
    protector.available.mockClear(); const now = Date.now(); store.renameQueryChecked({ ...reference(store, 'source'), name: '  新名🚢  ' });
    const next = JSON.parse(store.querySearchRaw('source')!) as SavedQuery;
    expect(next).toEqual({ ...previous, name: '  新名🚢  ', updatedAt: next.updatedAt }); expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(previous.updatedAt)); expect(Date.parse(next.updatedAt)).toBeGreaterThanOrEqual(now);
    expect(persisted(path, 'SELECT updated_at FROM queries WHERE id=\'source\'')[0].values).toEqual([[next.updatedAt]]); noSecrets();
  });

  it('源连接删除仍可本地改名，同名不同ID保持隔离，同名原记录及非法名称零落盘', async () => {
    const { store, path } = await fixture(); store.saveQuery(record('a')); store.saveQuery(record('b', { name: '同名' })); store.deleteConnection('c');
    const other = store.querySearchRaw('b'); protector.available.mockClear(); store.renameQueryChecked({ ...reference(store, 'a'), name: '同名' }); expect(store.querySearchRaw('b')).toBe(other);
    expect(JSON.parse(store.querySearchRaw('a')!).connectionId).toBe('c');
    const before = readFileSync(path), raw = store.querySearchRaw('a'), revision = store.querySearchRevision();
    expect(() => store.renameQueryChecked({ ...reference(store, 'a'), name: '同名' })).toThrow(savedQueryRenameZh.noChange);
    for (const name of ['', '  ', '控制\n字符', '\ud800', 'x'.repeat(257)]) expect(() => store.renameQueryChecked({ ...reference(store, 'a'), name })).toThrow();
    expect(store.querySearchRaw('a')).toBe(raw); expect(store.querySearchRevision()).toBe(revision); expect(readFileSync(path)).toEqual(before); noSecrets();
  });

  it('事务内复核完整原摘要，旧来源绑定覆盖保存拒绝，冻结时钟或回拨后A-B-A不能恢复原摘要', async () => {
    const { store } = await fixture(); const initial = store.createBoundQuery({ name: 'A', connectionId: 'c', context: { state: 'known', database: 'db' }, sql });
    const id = initial.source.id, before = store.querySearchRaw(id)!, old = JSON.parse(before) as SavedQuery, oldTime = Date.parse(old.updatedAt);
    store.saveSettings({ ...store.settings(), tabs: [{ id: 'editor', kind: 'query', connectionId: 'c', title: '已打开草稿', sql: sql + '\n-- 本地草稿', sourceBinding: initial.source }] }); const settings = store.settings();
    const now = vi.spyOn(Date, 'now').mockReturnValue(oldTime); store.renameQueryChecked({ ...reference(store, id), name: 'B' });
    const middle = JSON.parse(store.querySearchRaw(id)!) as SavedQuery; expect(Date.parse(middle.updatedAt)).toBe(oldTime + 1);
    now.mockReturnValue(oldTime - 10000); store.renameQueryChecked({ ...reference(store, id), name: 'A' });
    const final = JSON.parse(store.querySearchRaw(id)!) as SavedQuery; expect(final.name).toBe('A'); expect(Date.parse(final.updatedAt)).toBe(oldTime + 2); expect(store.querySearchRaw(id)).not.toBe(before);
    expect(() => store.renameQueryChecked({ id, digest: initial.source.digest, name: '陈旧名' })).toThrow(savedQueryRenameZh.stale);
    expect(() => store.updateBoundQuery({ source: initial.source, content: { name: '覆盖', connectionId: 'c', context: initial.source.context, sql: 'SELECT 2' } })).toThrow('已修改'); expect(store.settings()).toEqual(settings);
    const current = reference(store, id); store.deleteQuery(id); expect(() => store.renameQueryChecked({ ...current, name: '不复活' })).toThrow(savedQueryRenameZh.missing); expect(store.querySearchRaw(id)).toBeUndefined();
  });

  it('非法旧日期使用当前ISO，未来旧时间严格递增，极端日期溢出保持原件与修订', async () => {
    const { store, path } = await fixture(), now = Date.parse('2026-10-28T00:00:00.000Z'); vi.spyOn(Date, 'now').mockReturnValue(now);
    store.saveQuery(record('invalid', { updatedAt: '遗留非法日期' })); store.renameQueryChecked({ ...reference(store, 'invalid'), name: '新名' }); expect(JSON.parse(store.querySearchRaw('invalid')!).updatedAt).toBe(new Date(now).toISOString());
    const future = now + 86400000; store.saveQuery(record('future', { updatedAt: new Date(future).toISOString() })); store.renameQueryChecked({ ...reference(store, 'future'), name: '新名' }); expect(Date.parse(JSON.parse(store.querySearchRaw('future')!).updatedAt)).toBe(future + 1);
    store.saveQuery(record('overflow', { updatedAt: '+275760-09-13T00:00:00.000Z' })); const bytes = readFileSync(path), raw = store.querySearchRaw('overflow'), revision = store.querySearchRevision();
    expect(() => store.renameQueryChecked({ ...reference(store, 'overflow'), name: '不能写入' })).toThrow(savedQueryRenameZh.timestamp); expect(store.querySearchRaw('overflow')).toBe(raw); expect(store.querySearchRevision()).toBe(revision); expect(readFileSync(path)).toEqual(bytes);
  });

  it('保留真实组织成员，重命名推进搜索和组织版本并撤销旧分页及搜索游标', async () => {
    const { store, directory, path } = await fixture();
    for (let index = 0; index < 26; index++) store.saveQuery(record('q' + String(index).padStart(2, '0'), { name: '查询' + index }));
    let organization = store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'create', name: '原组', parentId: null } }); const groupId = organization.groups[0].id;
    organization = store.applyQueryOrganization({ expectedRevision: organization.revision, operation: { kind: 'moveQueries', groupId, queries: [reference(store, 'q00')] } });
    const membership = persisted(path, 'SELECT query_id,group_id FROM saved_query_memberships ORDER BY query_id'), revision = store.querySearchRevision();
    const workerPath = join(directory, 'worker.cjs'); await build({ entryPoints: ['src/main/savedQuerySearchWorker.ts'], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
    const pages = new SavedQueryPages(store, workerPath), searches = new SavedQuerySearches(store, workerPath);
    try {
      const page = await pages.start({ taskId: randomUUID(), search: '', onError: 'continue' }); expect(page.cursor).toBeTruthy();
      const search = await searches.start({ taskId: randomUUID(), scope: { kind: 'all' }, database: { kind: 'all' }, fields: ['name'], pattern: { text: '查询', mode: 'contains', caseSensitive: false }, maxResults: 1000, onError: 'continue' }); expect(search.cursor).toBeTruthy();
      protector.available.mockClear(); store.renameQueryChecked({ ...reference(store, 'q00'), name: '新名字' });
      expect(store.querySearchRevision()).not.toBe(revision); expect(store.queryOrganization().revision).not.toBe(organization.revision); expect(store.queryOrganization().groups).toEqual(organization.groups); expect(persisted(path, 'SELECT query_id,group_id FROM saved_query_memberships ORDER BY query_id')).toEqual(membership);
      await expect(pages.next({ taskId: randomUUID(), cursor: page.cursor! })).rejects.toThrow('已变化'); await expect(searches.next({ taskId: randomUUID(), cursor: search.cursor! })).rejects.toThrow('已变化');
      expect(() => store.applyQueryOrganization({ expectedRevision: organization.revision, operation: { kind: 'rename', id: groupId, name: '陈旧组名' } })).toThrow('已变化'); noSecrets();
    } finally { await pages.close(); await searches.close(); }
  });

  it('真实SQLite原子发布故障恢复内存和磁盘及版本，后续保存与重启不夹带失败名称', async () => {
    const { store, path } = await fixture(); store.saveQuery(record('source')); const initial = reference(store, 'source'), bytes = readFileSync(path), raw = store.querySearchRaw('source'), revision = store.querySearchRevision(), organization = store.queryOrganization();
    publishFault.path = path; publishFault.calls = 0;
    try { expect(() => store.renameQueryChecked({ ...initial, name: '失败名称' })).toThrow('修改未保存'); expect(publishFault.calls).toBe(1); }
    finally { publishFault.path = ''; }
    expect(readFileSync(path)).toEqual(bytes); expect(store.querySearchRaw('source')).toBe(raw); expect(store.querySearchRevision()).toBe(revision); expect(store.queryOrganization()).toEqual(organization);
    store.saveSettings({ ...store.settings(), editorWordWrap: false }); expect(store.querySearchRaw('source')).toBe(raw);
    store.renameQueryChecked({ ...initial, name: '成功名称' }); const published = store.querySearchRaw('source'); store.close(); stores.delete(store);
    const restored = await LocalStore.open(path, wasm, protector); stores.add(restored); expect(restored.querySearchRaw('source')).toBe(published); expect(restored.querySearchRaw('source')).not.toContain('失败名称'); expect(restored.settings().editorWordWrap).toBe(false); expect(JSON.parse(restored.querySearchRaw('source')!).sql).toBe(sql);
  });
});
