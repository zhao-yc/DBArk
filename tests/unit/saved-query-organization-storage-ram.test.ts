import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import type { SavedQuery } from '../../src/shared/contracts';
import type { SavedQueryOrganizationOperation } from '../../src/shared/savedQueryOrganization';
import { SavedQueryPages } from '../../src/main/savedQueryPages';
import type { SavedQueryPageInput } from '../../src/shared/savedQueryPages';

const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: 0, fail: false }));
const matcher = vi.hoisted(() => ({ calls: [] as string[], hook: undefined as undefined | (() => void), instances: [] as { closed: boolean }[] }));
// 本文件只验证原分页状态机与SQL位置范围；匹配器使用原纯函数，真实worker生命周期由既有专项覆盖。
vi.mock('../../src/main/savedQueryMatcher', async () => {
  const { summarizeSavedQueryRecord } = await import('../../src/main/savedQuerySearchMatch');
  return { SavedQueryMatcher: class { closed = false; constructor() { matcher.instances.push(this); } async summarize(id: string, raw: string, search: string) { matcher.calls.push(id); matcher.hook?.(); return summarizeSavedQueryRecord(id, raw, search); } async close() { this.closed = true; } } };
});
// 原LocalStore、SQLite事务及原子替换均执行；仅配置文件字节使用RAM，不触碰用户配置或真实数据库。
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, existsSync: (path: string) => disk.files.has(path), mkdirSync() {}, readFileSync: (path: string, ...args: unknown[]) => path.startsWith('RAM查询组织') ? Buffer.from(disk.files.get(path) ?? []) : (original.readFileSync as any)(path, ...args),
    writeFileSync(path: string, bytes: Uint8Array) { if (!path.startsWith('RAM查询组织')) throw Error('拒绝配置范围外写入'); disk.writes++; disk.files.set(path, Uint8Array.from(bytes)); },
    renameSync(from: string, to: string) { if (disk.fail) throw Error('合成原子发布失败'); disk.files.set(to, disk.files.get(from)!); disk.files.delete(from); } };
});
let SQL: SqlJsStatic, sequence = 0;
const stores = new Set<LocalStore>(), require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: vi.fn(() => false), encrypt: vi.fn(() => { throw Error('禁止凭据加密'); }), decrypt: vi.fn(() => { throw Error('禁止凭据解密'); }) };
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => { for (const value of matcher.instances) expect(value.closed).toBe(true); matcher.calls.length = 0; matcher.instances.length = 0; matcher.hook = undefined; for (const store of stores) store.close(); stores.clear(); disk.files.clear(); disk.writes = 0; disk.fail = false; vi.restoreAllMocks(); protector.available.mockClear(); protector.encrypt.mockClear(); protector.decrypt.mockClear(); });

/** 每个合成配置拥有独立RAM路径，重开仍使用生产迁移和原字节。 */
async function fixture(path = 'RAM查询组织-' + ++sequence + '.sqlite') { const store = await LocalStore.open(path, wasm, protector); stores.add(store); return { store, path }; }
function close(store: LocalStore) { store.close(); stores.delete(store); }
function database(store: LocalStore): Database { return (store as unknown as { db: Database }).db; }
function query(id: string, patch: Partial<SavedQuery> = {}): SavedQuery { return { id, name: '原查询' + id, sql: "SELECT '中文😀',18446744073709551615;\r\n-- 原尾部", updatedAt: '2026-10-22T00:00:00.000Z', databaseContext: { state: 'unknown' }, ...patch }; }
function apply(store: LocalStore, operation: SavedQueryOrganizationOperation) { return store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation }); }
function group(store: LocalStore, name: string, parentId: string | null = null) { return apply(store, { kind: 'create', name, parentId }).groups.find(value => value.name === name && value.parentId === parentId)!.id; }
function digest(store: LocalStore, id: string) { return createHash('sha256').update(store.querySearchRaw(id)!).digest('hex'); }
function move(store: LocalStore, ids: string[], groupId: string | null) { return apply(store, { kind: 'moveQueries', queries: ids.map(id => ({ id, digest: digest(store, id) })), groupId }); }
/** 独立SQLite实例读取已原子发布的RAM原件，不使用当前store缓存代替落盘证据。 */
function persisted(path: string, action: (db: Database) => unknown) { const db = new SQL.Database(disk.files.get(path)); try { return action(db); } finally { db.close(); } }
function rewrite(path: string, action: (db: Database) => void) { const db = new SQL.Database(disk.files.get(path)); try { action(db); disk.files.set(path, db.export()); } finally { db.close(); } }
function noSecrets() { expect(protector.available).not.toHaveBeenCalled(); expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled(); }

describe('保存查询组织真实SQLite与RAM原子字节', () => {
  it('初始概要只返回组与数量，不读取全量正文、连接或秘密', async () => {
    const { store } = await fixture(); for (const id of ['a', 'b']) store.saveQuery(query(id));
    const all = vi.spyOn(store, 'queries').mockImplementation(() => { throw Error('禁止全量正文'); }), raw = vi.spyOn(store, 'querySearchRaw').mockImplementation(() => { throw Error('禁止正文'); });
    expect(store.queryOrganization()).toEqual({ revision: expect.stringMatching(/^[a-f0-9]{64}$/), groups: [], unfiledCount: 2, totalCount: 2 }); expect(all).not.toHaveBeenCalled(); expect(raw).not.toHaveBeenCalled(); noSecrets();
  });
  it('创建主进程UUID、嵌套改名移动与直接/后代计数跨重开保持', async () => {
    const { store, path } = await fixture(); for (const id of ['a', 'b', 'c']) store.saveQuery(query(id));
    const root = group(store, '根组😀'), child = group(store, '子组', root), other = group(store, '另一组'); expect(root).toMatch(/^[a-f0-9-]{36}$/);
    move(store, ['a'], root); move(store, ['b'], child); apply(store, { kind: 'rename', id: child, name: '改名后' });
    expect(store.queryOrganization()).toMatchObject({ unfiledCount: 1, totalCount: 3, groups: [{ id: root, count: 1, totalCount: 2 }, { id: child, count: 1, totalCount: 1, name: '改名后' }, { id: other, count: 0, totalCount: 0 }] });
    apply(store, { kind: 'moveGroup', id: child, parentId: other }); const before = store.queryOrganization(); close(store);
    const reopened = (await fixture(path)).store; expect(reopened.queryOrganization()).toEqual({ ...before, revision: expect.any(String) }); expect(reopened.queryOrganization().revision).not.toBe(before.revision); noSecrets();
  });
  it('移组不改原JSON/更新时间/上下文/来源摘要，原绑定仍可更新且保留组', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const raw = store.querySearchRaw('a')!, hash = digest(store, 'a'), source = store.bindQuerySource('a', hash), before = persisted(path, db => db.exec('SELECT id,data,updated_at FROM queries'));
    const id = group(store, '目标'); move(store, ['a'], id); expect(store.querySearchRaw('a')).toBe(raw); expect(digest(store, 'a')).toBe(hash); expect(store.bindQuerySource('a', hash)).toEqual(source); expect(persisted(path, db => db.exec('SELECT id,data,updated_at FROM queries'))).toEqual(before);
    store.updateBoundQuery({ source, content: { name: '明确更新', sql: 'SELECT 2', context: { state: 'unknown' } } }); expect(store.queryOrganization().groups[0].count).toBe(1); expect(store.queryPageNext()?.groupId).toBe(id); expect(store.tasks()).toEqual([]); expect(store.history()).toEqual([]); noSecrets();
  });
  it('已保存密文与会话秘密均原样保留，分组不能触发凭据保护器或输出秘密', async () => {
    const { store, path } = await fixture(); store.saveConnection({ id: 'c', name: '离线连接', group: '', color: '#123456', host: 'offline.invalid', port: 3306, user: '合成用户', dialect: 'mysql', password: '仅合成会话秘密', rememberPassword: false });
    database(store).run('INSERT INTO secrets VALUES (?,?,?)', ['c', 'sshPassword', '仅合成不可解密密文']); store.saveQuery(query('a', { connectionId: 'c' })); const before = persisted(path, db => db.exec('SELECT * FROM secrets ORDER BY connection_id,name')); protector.available.mockClear();
    const id = group(store, '离线组'), snapshot = move(store, ['a'], id); expect(persisted(path, db => db.exec('SELECT * FROM secrets ORDER BY connection_id,name'))).toEqual(before); noSecrets(); expect(JSON.stringify(snapshot)).not.toContain('仅合成');
    const secrets = (store as unknown as { volatileSecrets: Map<string, string> }).volatileSecrets; expect(secrets.get('c\0password')).toBe('仅合成会话秘密');
  });
  it('查询保存删除重建与分组ABA均撤销全局CAS，失败不自动重试', async () => {
    const { store } = await fixture(); store.saveQuery(query('a')); const id = group(store, '原名'), initial = store.queryOrganization().revision;
    apply(store, { kind: 'rename', id, name: '中间' }); apply(store, { kind: 'rename', id, name: '原名' }); expect(() => store.applyQueryOrganization({ expectedRevision: initial, operation: { kind: 'rename', id, name: '陈旧' } })).toThrow('已变化');
    for (const change of [() => store.saveQuery(query('a')), () => store.deleteQuery('a'), () => store.saveQuery(query('a'))]) { const expectedRevision = store.queryOrganization().revision; change(); expect(() => store.applyQueryOrganization({ expectedRevision, operation: { kind: 'rename', id, name: '不能写' } })).toThrow('已变化'); }
  });
  it('批次中一条摘要陈旧或不存在时所有原成员和磁盘均不变', async () => {
    const { store, path } = await fixture(); for (const id of ['a', 'b']) store.saveQuery(query(id)); const id = group(store, '组'), before = disk.files.get(path), revision = store.queryOrganization().revision;
    for (const item of [{ id: 'b', digest: '0'.repeat(64) }, { id: 'missing', digest: '0'.repeat(64) }]) expect(() => store.applyQueryOrganization({ expectedRevision: revision, operation: { kind: 'moveQueries', groupId: id, queries: [{ id: 'a', digest: digest(store, 'a') }, item] } })).toThrow();
    expect(disk.files.get(path)).toEqual(before); expect(store.queryOrganization()).toMatchObject({ revision, unfiledCount: 2, groups: [{ count: 0 }] });
  });
  it('解散整棵子树只退回未分组，不删除或重写任何查询', async () => {
    const { store, path } = await fixture(); for (const id of ['a', 'b', 'c']) store.saveQuery(query(id)); const root = group(store, '父'), child = group(store, '子', root), retained = group(store, '保留'); move(store, ['a'], root); move(store, ['b'], child); move(store, ['c'], retained);
    const before = persisted(path, db => db.exec('SELECT * FROM queries ORDER BY id')); apply(store, { kind: 'dissolve', id: root }); expect(store.queryOrganization()).toMatchObject({ unfiledCount: 2, totalCount: 3, groups: [{ id: retained, count: 1 }] }); expect(persisted(path, db => db.exec('SELECT * FROM queries ORDER BY id'))).toEqual(before);
  });
  it('删除与成员清理同一事务，重建同ID不会恢复旧组；普通保存保留组', async () => {
    const { store } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); store.saveQuery(query('a', { sql: 'SELECT 3' })); expect(store.queryPageNext()?.groupId).toBe(id);
    store.deleteQuery('a'); store.saveQuery(query('a')); expect(store.queryPageNext()?.groupId).toBeUndefined(); expect(store.queryOrganization()).toMatchObject({ unfiledCount: 1, groups: [{ count: 0 }] });
  });
  it('第二条真实SQLite触发器失败回滚第一条成员，磁盘和两个修订保持', async () => {
    const { store, path } = await fixture(); for (const id of ['a', 'b']) store.saveQuery(query(id)); const id = group(store, '组'), before = disk.files.get(path), snapshot = store.queryOrganization(), revision = store.querySearchRevision();
    database(store).run("CREATE TRIGGER fail_member BEFORE INSERT ON saved_query_memberships WHEN NEW.query_id='b' BEGIN SELECT RAISE(ABORT,'合成第二成员失败'); END");
    expect(() => move(store, ['a', 'b'], id)).toThrow('修改未保存'); expect(store.queryOrganization()).toEqual(snapshot); expect(store.querySearchRevision()).toBe(revision); expect(disk.files.get(path)).toEqual(before);
  });
  it('原子文件发布失败恢复组织和成员，后续保存不夹带失败结果', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'), before = disk.files.get(path), snapshot = store.queryOrganization(), revision = store.querySearchRevision(); disk.fail = true;
    expect(() => move(store, ['a'], id)).toThrow('修改未保存'); expect(store.queryOrganization()).toEqual(snapshot); expect(store.querySearchRevision()).toBe(revision); expect(disk.files.get(path)).toEqual(before); disk.fail = false;
    store.saveQuery(query('b')); expect(store.queryOrganization()).toMatchObject({ unfiledCount: 2, groups: [{ count: 0 }] }); expect(persisted(path, db => db.exec('SELECT * FROM saved_query_memberships'))).toEqual([]);
  });
  it('删除查询时真实SQL失败同时恢复先删的成员关系', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); const snapshot = store.queryOrganization(), before = disk.files.get(path);
    database(store).run("CREATE TRIGGER fail_query_delete BEFORE DELETE ON queries BEGIN SELECT RAISE(ABORT,'合成查询删除失败'); END"); expect(() => store.deleteQuery('a')).toThrow('修改未保存'); expect(store.queryOrganization()).toEqual(snapshot); expect(store.queryPageNext()?.groupId).toBe(id); expect(disk.files.get(path)).toEqual(before);
  });
});

describe('可选schema9组织迁移的先验证后写入', () => {
  it('旧schema9无组织表安全升级且原query原文不变', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const raw = store.querySearchRaw('a'); close(store); rewrite(path, db => db.run('DROP TABLE saved_query_memberships; DROP TABLE saved_query_organization;'));
    const reopened = (await fixture(path)).store; expect(reopened.querySearchRaw('a')).toBe(raw); expect(reopened.queryOrganization()).toMatchObject({ groups: [], unfiledCount: 1 }); expect(persisted(path, db => db.exec('PRAGMA user_version')[0].values[0][0])).toBe(9);
  });
  it.each(['version', 'cycle', 'missingGroup', 'tableMissing', 'malformed'])('原组织%s损坏在任何迁移写盘前拒绝，保留原件', async kind => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); close(store);
    rewrite(path, db => { if (kind === 'tableMissing') db.run('DROP TABLE saved_query_memberships'); else if (kind === 'missingGroup') db.run("UPDATE saved_query_memberships SET group_id='不存在'"); else db.run('UPDATE saved_query_organization SET data=?', [kind === 'malformed' ? '{' : JSON.stringify({ version: kind === 'version' ? 2 : 1, revision: 1, groups: [{ id, name: '组', parentId: kind === 'cycle' ? id : null }] })]); });
    const before = disk.files.get(path), writes = disk.writes; await expect(fixture(path)).rejects.toThrow(); expect(disk.files.get(path)).toEqual(before); expect(disk.writes).toBe(writes);
  });
  it('完全验证后清除旧客户端删除留下的孤儿，查询同ID重建不复活', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); close(store); rewrite(path, db => db.run("DELETE FROM queries WHERE id='a'"));
    const reopened = (await fixture(path)).store; expect(persisted(path, db => db.exec('SELECT * FROM saved_query_memberships'))).toEqual([]); reopened.saveQuery(query('a')); expect(reopened.queryOrganization()).toMatchObject({ unfiledCount: 1, groups: [{ count: 0 }] });
  });
  it('坏文档即使包含可清理孤儿，也不得先清理或写迁移', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); close(store); rewrite(path, db => { db.run("DELETE FROM queries WHERE id='a'"); db.run('UPDATE saved_query_organization SET data=?', [JSON.stringify({ version: 99, revision: 0, groups: [] })]); }); const before = disk.files.get(path), writes = disk.writes;
    await expect(fixture(path)).rejects.toThrow(); expect(disk.files.get(path)).toEqual(before); expect(disk.writes).toBe(writes);
  });
  it('超1MiB组织原文在SQLite取文和JSON解析前拒绝，不写盘或清理孤儿', async () => {
    const { store, path } = await fixture(); store.saveQuery(query('a')); const id = group(store, '组'); move(store, ['a'], id); close(store);
    rewrite(path, db => { db.run("DELETE FROM queries WHERE id='a'"); db.run('UPDATE saved_query_organization SET data=?', [' '.repeat(1024 * 1024 + 1)]); }); const before = disk.files.get(path), writes = disk.writes;
    await expect(fixture(path)).rejects.toThrow('超过1MiB');
    // 完整SQLite原件逐字节比较交给原生Buffer，避免将逾百万字节展开为测试框架属性；不缩小比较范围。
    const after = disk.files.get(path); expect(before).toBeInstanceOf(Uint8Array); expect(after).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(after!).equals(Buffer.from(before!))).toBe(true);
    expect(disk.writes).toBe(writes); expect(persisted(path, db => db.exec('SELECT COUNT(*) FROM saved_query_memberships')[0].values[0][0])).toBe(1);
  });
});

describe('原分页状态机的真实SQLite分组范围与RAM匹配边界', () => {
  const request = (patch: Partial<SavedQueryPageInput> = {}): SavedQueryPageInput => ({ taskId: randomUUID(), search: '', onError: 'continue', ...patch });
  it('组范围在位置分页前过滤，58条命中分25/25/8且不将其它组传给匹配器', async () => {
    const { store } = await fixture(); for (let index = 0; index < 68; index++) store.saveQuery(query('q' + String(index).padStart(3, '0'))); const id = group(store, '目标'); move(store, Array.from({ length: 58 }, (_, index) => 'q' + String(index).padStart(3, '0')), id);
    const service = new SavedQueryPages(store, '未运行worker'), all = vi.spyOn(store, 'queries').mockImplementation(() => { throw Error('禁止全量库'); });
    try { const pages = [await service.start(request({ group: { kind: 'group', id, includeDescendants: false } }))]; while (pages.at(-1)!.cursor) pages.push(await service.next({ taskId: randomUUID(), cursor: pages.at(-1)!.cursor })); expect(pages.map(page => page.items.length)).toEqual([25, 25, 8]); expect(pages.at(-1)!.scanned).toBe(58); expect(pages.flatMap(page => page.items).map(entry => entry.query.id)).toEqual(Array.from({ length: 58 }, (_, index) => 'q' + String(57 - index).padStart(3, '0'))); expect(pages.flatMap(page => page.items).every(entry => entry.groupId === id)).toBe(true); expect(matcher.calls.every(value => Number(value.slice(1)) < 58)).toBe(true); expect(all).not.toHaveBeenCalled(); for (const page of pages) expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128 * 1024); } finally { await service.close(); }
  });
  it('未传范围保持全部，未分组与直接/后代范围独立且无跨组正文读取', async () => {
    const { store } = await fixture(); for (const id of ['a', 'b', 'c']) store.saveQuery(query(id)); const root = group(store, '父'), child = group(store, '子', root); move(store, ['a'], root); move(store, ['b'], child); const service = new SavedQueryPages(store, '未运行worker');
    try { expect((await service.start(request())).items.map(entry => entry.query.id)).toEqual(['c', 'b', 'a']); expect((await service.start(request({ group: { kind: 'unfiled' } }))).items.map(entry => entry.query.id)).toEqual(['c']); expect((await service.start(request({ group: { kind: 'group', id: root, includeDescendants: false } }))).items.map(entry => entry.query.id)).toEqual(['a']); expect((await service.start(request({ group: { kind: 'group', id: root, includeDescendants: true } }))).items.map(entry => entry.query.id)).toEqual(['b', 'a']); await expect(service.start(request({ group: { kind: 'group', id: 'missing', includeDescendants: true } }))).rejects.toThrow('不存在'); } finally { await service.close(); }
  });
  it('组内全文尾部筛选无命中页仍可继续且原游标只消费一次', async () => {
    const { store } = await fixture(); for (let index = 0; index < 26; index++) store.saveQuery(query('q' + String(index).padStart(2, '0'), { sql: index === 0 ? 'x'.repeat(9000) + '组内尾标' : 'SELECT 1' })); const id = group(store, '目标'); move(store, Array.from({ length: 26 }, (_, index) => 'q' + String(index).padStart(2, '0')), id); const service = new SavedQueryPages(store, '未运行worker');
    try { const first = await service.start(request({ search: '组内尾标', group: { kind: 'group', id, includeDescendants: false } })); expect(first.items).toEqual([]); expect(first.scanned).toBe(25); expect(first.cursor).toBeTruthy(); const last = await service.next({ taskId: randomUUID(), cursor: first.cursor! }); expect(last.items.map(entry => entry.query.id)).toEqual(['q00']); expect(last.items[0].groupId).toBe(id); expect(last.scanned).toBe(26); expect(last.cursor).toBeUndefined(); expect(() => service.next({ taskId: randomUUID(), cursor: first.cursor! })).toThrow('过期'); } finally { await service.close(); }
  });
  it.each(['move', 'rename', 'dissolve'])('组织%s撤销旧页，拒绝继续而不是混入另一组', async kind => {
    const { store } = await fixture(); for (let index = 0; index < 26; index++) store.saveQuery(query(String(index))); const id = group(store, '原组'), service = new SavedQueryPages(store, '未运行worker');
    try { const first = await service.start(request()); expect(first.cursor).toBeTruthy(); if (kind === 'move') move(store, ['0'], id); else if (kind === 'rename') apply(store, { kind: 'rename', id, name: '新名' }); else apply(store, { kind: 'dissolve', id }); await expect(service.next({ taskId: randomUUID(), cursor: first.cursor! })).rejects.toThrow('已变化'); } finally { await service.close(); }
  });
  it('页内组织变化拒绝尚未发布的概要，原查询原文保持', async () => {
    const { store } = await fixture(); store.saveQuery(query('a')); const id = group(store, '目标'), before = store.querySearchRaw('a'), service = new SavedQueryPages(store, '未运行worker'); let changed = false;
    matcher.hook = () => { if (!changed) { changed = true; move(store, ['a'], id); } };
    try { await expect(service.start(request())).rejects.toThrow('已变化'); expect(store.querySearchRaw('a')).toBe(before); } finally { await service.close(); }
  });
});
