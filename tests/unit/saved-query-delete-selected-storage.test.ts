import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { build } from 'esbuild';
import { LocalStore } from '../../src/main/storage';
import { SavedQueryPages } from '../../src/main/savedQueryPages';
import { SavedQuerySearches } from '../../src/main/savedQuerySearch';
import type { SavedQuery } from '../../src/shared/contracts';
import { savedQueryDeleteSelectedZh } from '../../src/shared/savedQueryDeleteSelected';

const publishFault = vi.hoisted(() => ({ path: '', calls: 0 }));
/** Node ESM命名空间不可spy；只拦截准确tmp到配置原件的发布，其余IO执行真实文件系统。 */
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
const profile = { id: 'c', name: '离线原连接', group: '', color: '', dialect: 'mysql' as const, host: 'never.invalid', port: 1, user: 'offline' };
const sql = "SELECT '18446744073709551615','9007199254740993.123456789012',NULL,X'00FF','🚢';\r\n-- 完整尾部";
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => { publishFault.path = ''; publishFault.calls = 0; vi.restoreAllMocks(); for (const store of stores) store.close(); stores.clear(); for (const path of directories.splice(0)) { if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith('dbark-query-delete-selected-')) throw Error('拒绝清理非本例临时目录'); rmSync(path, { recursive: true, force: true }); } protector.available.mockClear(); protector.encrypt.mockClear(); protector.decrypt.mockClear(); });

/** 每例真实SQLite、独立目录和合成离线连接，不读取用户配置或接入数据库服务器。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-query-delete-selected-')); directories.push(directory); const path = join(directory, 'config.sqlite');
  const store = await LocalStore.open(path, wasm, protector); stores.add(store); store.saveConnection(profile); return { store, path, directory };
}
/** 摘要来自完整原记录，而非可截断的名称或SQL概要。 */
function reference(store: LocalStore, id: string) { return { id, digest: createHash('sha256').update(store.querySearchRaw(id)!).digest('hex') }; }
/** 同名ID用于证明删除以准确身份而非名称匹配。 */
function record(id: string, patch: Partial<SavedQuery> = {}): SavedQuery { return { id, name: '同名查询', connectionId: 'c', sql, updatedAt: '2026-10-15T00:00:00.000Z', ...patch }; }
/** 独立打开已发布原件，避免用生产内存对象冒充磁盘证据。 */
function persisted(path: string, statement: string) { const database = new SQL.Database(readFileSync(path)); try { return database.exec(statement); } finally { database.close(); } }
/** 仅故障用例访问本例内存SQLite，不替换查询、事务或发布实现。 */
function database(store: LocalStore): Database { return (store as unknown as { db: Database }).db; }
/** 组织写入使用原修订和成员摘要CAS。 */
function group(store: LocalStore, name: string) { return store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'create', name, parentId: null } }).groups.find(item => item.name === name)!.id; }
/** 未分组记录不构造虚假成员，跨组移动仍执行原SQLite逻辑。 */
function move(store: LocalStore, ids: string[], groupId: string) { store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'moveQueries', queries: ids.map(id => reference(store, id)), groupId } }); }
/** 凭据保护器的每个方法均应保持零调用。 */
function noSecrets() { expect(protector.available).not.toHaveBeenCalled(); expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled(); }

describe('保存查询批量删除所选真实SQLite原子性', () => {
  it('100条跨组/未分组同名记录单次发布，仅删准确ID，保留其它资料/草稿及SQL文件并重启', async () => {
    const { store, path, directory } = await fixture(); const selected = Array.from({ length: 100 }, (_, index) => 'q' + String(index).padStart(3, '0'));
    for (const id of selected) store.saveQuery(record(id));
    store.saveQuery(record('keep_known', { database: '原库', databaseContext: { state: 'known', database: '原库' } })); store.saveQuery(record('keep_legacy', { database: '遗留库' }));
    const left = group(store, '甲组'), right = group(store, '乙组'); group(store, '空组'); move(store, selected.slice(0, 40), left); move(store, selected.slice(40, 80), right); move(store, ['keep_known'], left);
    const source = store.bindQuerySource(selected[0], reference(store, selected[0]).digest);
    store.saveSettings({ ...store.settings(), tabs: [{ id: 'open-editor', kind: 'query', title: '原草稿', connectionId: 'c', sql: sql + '\n-- 未保存草稿', sourceBinding: source }] });
    const settings = store.settings(), keepKnown = store.querySearchRaw('keep_known'), keepLegacy = store.querySearchRaw('keep_legacy'), organization = persisted(path, 'SELECT data FROM saved_query_organization'), revision = store.querySearchRevision();
    const diskSql = join(directory, 'untouched.sql'); writeFileSync(diskSql, sql, 'utf8'); protector.available.mockClear();
    expect(store.deleteQueriesChecked({ queries: selected.map(id => reference(store, id)) })).toEqual({ deleted: 100 });
    expect(Number(store.querySearchRevision().split(':')[0])).toBe(Number(revision.split(':')[0]) + 1);
    for (const id of selected) expect(store.querySearchRaw(id)).toBeUndefined(); expect(store.querySearchRaw('keep_known')).toBe(keepKnown); expect(store.querySearchRaw('keep_legacy')).toBe(keepLegacy);
    expect(persisted(path, 'SELECT data FROM saved_query_organization')).toEqual(organization); expect(persisted(path, 'SELECT query_id,group_id FROM saved_query_memberships ORDER BY query_id')[0].values).toEqual([['keep_known', left]]);
    expect(store.settings()).toEqual(settings); expect(readFileSync(diskSql, 'utf8')).toBe(sql); noSecrets();
    expect(() => store.updateBoundQuery({ source, content: { name: '不得复活', connectionId: 'c', context: source.context, sql: 'SELECT 2' } })).toThrow('已删除'); expect(store.settings()).toEqual(settings);
    store.close(); stores.delete(store); const restored = await LocalStore.open(path, wasm, protector); stores.add(restored);
    for (const id of selected) expect(restored.querySearchRaw(id)).toBeUndefined(); expect(restored.querySearchRaw('keep_known')).toBe(keepKnown); expect(restored.querySearchRaw('keep_legacy')).toBe(keepLegacy); expect(restored.settings()).toEqual(settings); expect(readFileSync(diskSql, 'utf8')).toBe(sql);
  });

  it.each(['stale', 'missing', 'corrupt'] as const)('末条%s时整批零DELETE，原文件/成员/修订保持', async failure => {
    const { store, path } = await fixture(); for (const id of ['first', 'middle', 'last', 'keep']) store.saveQuery(record(id));
    const groupId = group(store, '原组'); move(store, ['first', 'middle', 'last', 'keep'], groupId);
    const queries = ['first', 'middle', 'last'].map(id => reference(store, id));
    if (failure === 'stale') store.renameQueryChecked({ ...reference(store, 'last'), name: '后来新名称' });
    if (failure === 'missing') store.deleteQuery('last');
    if (failure === 'corrupt') { store.saveQuery({ ...record('last'), sql: 42 } as unknown as SavedQuery); queries[2] = reference(store, 'last'); }
    const bytes = readFileSync(path), revision = store.querySearchRevision(), membership = persisted(path, 'SELECT * FROM saved_query_memberships ORDER BY query_id'), first = store.querySearchRaw('first'), middle = store.querySearchRaw('middle');
    const originalDatabase = database(store), run = vi.spyOn(originalDatabase, 'run'); protector.available.mockClear();
    try { expect(() => store.deleteQueriesChecked({ queries })).toThrow(failure === 'stale' ? savedQueryDeleteSelectedZh.stale : failure === 'missing' ? savedQueryDeleteSelectedZh.missing : '记录结构无效'); expect(run.mock.calls.some(([statement]) => /^DELETE\b/i.test(statement))).toBe(false); }
    finally { run.mockRestore(); }
    expect(readFileSync(path)).toEqual(bytes); expect(store.querySearchRevision()).toBe(revision); expect(store.querySearchRaw('first')).toBe(first); expect(store.querySearchRaw('middle')).toBe(middle); expect(persisted(path, 'SELECT * FROM saved_query_memberships ORDER BY query_id')).toEqual(membership); noSecrets();
  });

  it('真实SQLite末条DELETE被忽略时核影响数并整批恢复，不能把少删冒充全删', async () => {
    const { store, path } = await fixture(); for (const id of ['first', 'last']) store.saveQuery(record(id)); const groupId = group(store, '原组'); move(store, ['first', 'last'], groupId);
    database(store).run("CREATE TRIGGER local_ignore_last BEFORE DELETE ON queries WHEN OLD.id='last' BEGIN SELECT RAISE(IGNORE); END"); store.saveSettings(store.settings());
    const bytes = readFileSync(path), revision = store.querySearchRevision(), membership = persisted(path, 'SELECT * FROM saved_query_memberships ORDER BY query_id'), queries = ['first', 'last'].map(id => reference(store, id));
    expect(() => store.deleteQueriesChecked({ queries })).toThrow(savedQueryDeleteSelectedZh.failed); expect(readFileSync(path)).toEqual(bytes); expect(store.querySearchRevision()).toBe(revision);
    for (const item of queries) expect(reference(store, item.id)).toEqual(item); expect(persisted(path, 'SELECT * FROM saved_query_memberships ORDER BY query_id')).toEqual(membership);
  });

  it('准确原子发布故障后内存/磁盘/修订恢复，后续设置保存和重启不夹带失败删除', async () => {
    const { store, path } = await fixture(); for (const id of ['first', 'last', 'keep']) store.saveQuery(record(id)); const groupId = group(store, '原组'); move(store, ['first', 'last'], groupId);
    const queries = ['first', 'last'].map(id => reference(store, id)), bytes = readFileSync(path), revision = store.querySearchRevision(), organization = store.queryOrganization();
    publishFault.path = path; publishFault.calls = 0;
    try { expect(() => store.deleteQueriesChecked({ queries })).toThrow('修改未保存'); expect(publishFault.calls).toBe(1); } finally { publishFault.path = ''; }
    expect(readFileSync(path)).toEqual(bytes); expect(store.querySearchRevision()).toBe(revision); expect(store.queryOrganization()).toEqual(organization); for (const item of queries) expect(reference(store, item.id)).toEqual(item);
    store.saveSettings({ ...store.settings(), editorWordWrap: false }); expect(persisted(path, 'SELECT id FROM queries ORDER BY id')[0].values).toEqual([['first'], ['keep'], ['last']]);
    store.close(); stores.delete(store); const restored = await LocalStore.open(path, wasm, protector); stores.add(restored); for (const item of queries) expect(reference(restored, item.id)).toEqual(item); expect(restored.settings().editorWordWrap).toBe(false); expect(restored.queryOrganization().groups).toEqual(organization.groups);
  });

  it('成功后搜索页/列表页和组织旧版本失效，分组定义保持，未选同名查询仍可读取', async () => {
    const { store, directory, path } = await fixture(); for (let index = 0; index < 26; index++) store.saveQuery(record('q' + String(index).padStart(2, '0')));
    const groupId = group(store, '原组'); move(store, ['q00', 'q01'], groupId); const organization = store.queryOrganization(), definitions = persisted(path, 'SELECT data FROM saved_query_organization'), revision = store.querySearchRevision(), keep = store.querySearchRaw('q25');
    const workerPath = join(directory, 'worker.cjs'); await build({ entryPoints: ['src/main/savedQuerySearchWorker.ts'], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
    const pages = new SavedQueryPages(store, workerPath), searches = new SavedQuerySearches(store, workerPath);
    try {
      const page = await pages.start({ taskId: randomUUID(), search: '', onError: 'continue' }), search = await searches.start({ taskId: randomUUID(), scope: { kind: 'all' }, database: { kind: 'all' }, fields: ['name'], pattern: { text: '同名', mode: 'contains', caseSensitive: false }, maxResults: 1000, onError: 'continue' }); expect(page.cursor).toBeTruthy(); expect(search.cursor).toBeTruthy();
      protector.available.mockClear(); expect(store.deleteQueriesChecked({ queries: ['q00', 'q01'].map(id => reference(store, id)) })).toEqual({ deleted: 2 }); expect(store.querySearchRevision()).not.toBe(revision); expect(store.queryOrganization().revision).not.toBe(organization.revision);
      await expect(pages.next({ taskId: randomUUID(), cursor: page.cursor! })).rejects.toThrow('已变化'); await expect(searches.next({ taskId: randomUUID(), cursor: search.cursor! })).rejects.toThrow('已变化'); expect(() => store.applyQueryOrganization({ expectedRevision: organization.revision, operation: { kind: 'rename', id: groupId, name: '不能使用旧版本' } })).toThrow('已变化');
      expect(persisted(path, 'SELECT data FROM saved_query_organization')).toEqual(definitions); expect(store.querySearchRaw('q25')).toBe(keep); noSecrets();
    } finally { await pages.close(); await searches.close(); }
  });
});
