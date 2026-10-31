import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Database } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { historyDeleteByteTotal, historyDeleteReferences } from '../../src/main/historyDeleteStorage';
import { historyDeleteLimits, type HistoryDeleteReference } from '../../src/shared/historyDelete';
import type { NetworkConnectionProfile as ConnectionProfile, HistoryEntry } from '../../src/shared/contracts';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>();
const profile: ConnectionProfile = { id: 'source', name: '离线连接', group: '', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'offline', password: '仅本例秘密', rememberPassword: true };
const entry = (id: string): HistoryEntry => ({ id, connectionId: profile.id, sql: `SELECT '${id}' -- 原文🚢`, startedAt: '2026-10-23T00:00:00.000Z', elapsedMs: 12, success: true });
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** 每例使用独立真实SQLite文件；加密替身仅验证存储回退，不代表系统safeStorage验收。 */
async function fixture(available = true) {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-history-delete-storage-')); directories.push(directory);
  const file = join(directory, 'local.sqlite');
  const protector = { available: vi.fn(() => available), encrypt: vi.fn((value: string) => Buffer.from(value).toString('base64')), decrypt: vi.fn((value: string) => Buffer.from(value, 'base64').toString()) };
  const open = async () => { const store = await LocalStore.open(file, wasm, protector); stores.add(store); return store; };
  const store = await open(); store.saveConnection(profile); store.addHistory(entry('a')); store.addHistory(entry('b')); store.addHistory(entry('A'));
  const close = (value: LocalStore) => { value.close(); stores.delete(value); };
  return { directory, file, store, protector, open, close };
}
/** 仅测试夹具直接访问SQLite，以制造真实损坏和触发器失败。 */
function database(store: LocalStore): Database { return (store as unknown as { db: Database }).db; }
/** 摘要来自存储原文，不重新序列化记录后猜测字节。 */
function references(store: LocalStore, ids = ['a', 'b']): HistoryDeleteReference[] { return ids.map(id => ({ id, digest: digest(store.historyRaw(id)!) })); }
/** 所有非历史表逐行计算摘要，覆盖秘密、草稿、查询、片段、设置、任务及回执。 */
function unrelated(store: LocalStore): string {
  const db = database(store), names = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name<>'history' ORDER BY name")[0].values.map(row => String(row[0]));
  return digest(JSON.stringify(names.map(name => [name, db.exec(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)])));
}
afterEach(() => {
  vi.restoreAllMocks(); for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-history-delete-storage-')) throw Error('临时清理目标越界');
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('执行历史精确删除的纯数据和预算门槛', () => {
  it('拒绝空批、重复、越界数量、未知字段、隐藏字段、访问器和非规范摘要', () => {
    const ref = { id: 'a', digest: 'a'.repeat(64) }, getter = vi.fn(() => 'a');
    const accessor = Object.defineProperty({ digest: ref.digest }, 'id', { enumerable: true, get: getter });
    for (const input of [[], [ref, ref], Array.from({ length: 1001 }, (_, index) => ({ ...ref, id: String(index) })), [{ ...ref, extra: true }], [{ ...ref, digest: 'A'.repeat(64) }], [Object.defineProperty({ ...ref }, 'hidden', { value: true })], [accessor], [, ref]]) expect(() => historyDeleteReferences(input as HistoryDeleteReference[])).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const original = [ref], copied = historyDeleteReferences(original); ref.id = 'changed'; original.length = 0;
    expect(copied).toEqual([{ id: 'a', digest: 'a'.repeat(64) }]);
  });
  it('使用硬编码128MiB真预算，恰好到界有效，单条和累计越界均拒绝', () => {
    const limit = historyDeleteLimits.rawBytes; expect(limit).toBe(128 * 1024 * 1024);
    expect(historyDeleteByteTotal(0, limit)).toBe(limit); expect(historyDeleteByteTotal(limit - 1, 1)).toBe(limit);
    for (const [total, bytes] of [[0, limit + 1], [limit, 1], [limit - 1, 2], [-1, 1], [0, NaN], [0, Infinity], [0, Number.MAX_SAFE_INTEGER], [1.1, 0]]) expect(() => historyDeleteByteTotal(total, bytes)).toThrow('预算');
  });
});

describe('真实SQLite的历史删除与持久化', () => {
  it('逐条返回原索引、原文，精确区分大小写；成功只增一次修订且保留所有其它表', async () => {
    const f = await fixture(), { store } = f;
    store.saveQuery({ id: 'saved', name: '已保存查询', sql: 'SELECT 保留', updatedAt: entry('a').startedAt, connectionId: profile.id });
    store.saveSnippet({ id: 'snippet', name: '片段', group: '', description: '', sql: 'SELECT 片段', updatedAt: entry('a').startedAt });
    store.saveTask({ id: 'task', kind: 'query.execute', status: 'completed', progress: 100, message: '本地概要', startedAt: entry('a').startedAt });
    store.saveSettings({ ...store.settings(), tabs: [{ id: 'draft', kind: 'query', title: '未保存草稿', connectionId: profile.id, sql: 'SELECT 草稿' }] });
    store.saveWorkbench({ ...store.workbench(), document: { ...store.workbench().document, focusMode: true } });
    const revision = store.historyPageRevision(), other = unrelated(store), refs = references(store);
    expect(store.historyDeleteRecord('a')).toEqual({ id: 'a', startedAt: entry('a').startedAt, connectionId: profile.id, raw: store.historyRaw('a') });
    expect(store.historyDeleteRecord('absent')).toBeUndefined();
    f.protector.available.mockClear(); f.protector.encrypt.mockClear(); f.protector.decrypt.mockClear();
    expect(store.deleteHistorySnapshot(revision, refs, () => {})).toBe(2);
    expect(store.historyPageRevision()).toBe(`${Number(revision.split(':')[0]) + 1}:${revision.split(':')[1]}`);
    expect(store.history().map(row => row.id)).toEqual(['A']); expect(unrelated(store)).toBe(other);
    expect(f.protector.available).not.toHaveBeenCalled(); expect(f.protector.encrypt).not.toHaveBeenCalled(); expect(f.protector.decrypt).not.toHaveBeenCalled();
    expect(() => store.deleteHistorySnapshot(revision, refs, () => {})).toThrow();
    f.close(store); const reopened = await f.open(); expect(reopened.history().map(row => row.id)).toEqual(['A']); expect(unrelated(reopened)).toBe(other);
  });
  it.each(['history', 'connection'] as const)('预览后%s发生变化，旧范围全批拒绝且不写盘', async kind => {
    const f = await fixture(), refs = references(f.store), revision = f.store.historyPageRevision();
    if (kind === 'history') f.store.addHistory(entry('new')); else f.store.saveConnection({ ...profile, name: '外部改名' });
    const before = readFileSync(f.file), changed = f.store.historyPageRevision();
    expect(() => f.store.deleteHistorySnapshot(revision, refs, () => {})).toThrow('已变化');
    expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(changed); expect(f.store.historyRaw('a')).toBeDefined(); expect(f.store.historyRaw('b')).toBeDefined();
  });
  it.each(['digest', 'missing', 'json', 'shape', 'id', 'time', 'connection', 'blob'] as const)('第二项%s无效时第一项也保留，索引与原文独立核验', async fault => {
    const f = await fixture(), refs = references(f.store), db = database(f.store);
    if (fault === 'digest') refs[1].digest = '0'.repeat(64);
    if (fault === 'missing') db.run('DELETE FROM history WHERE id=?', ['b']);
    if (fault === 'json') db.run('UPDATE history SET data=? WHERE id=?', ['{损坏', 'b']);
    if (fault === 'shape') db.run('UPDATE history SET data=? WHERE id=?', [JSON.stringify({ ...entry('b'), success: 'true' }), 'b']);
    if (fault === 'id') db.run('UPDATE history SET data=? WHERE id=?', [JSON.stringify(entry('other')), 'b']);
    if (fault === 'time') db.run('UPDATE history SET started_at=? WHERE id=?', ['伪时间索引', 'b']);
    if (fault === 'connection') db.run('UPDATE history SET connection_id=? WHERE id=?', ['伪连接索引', 'b']);
    if (fault === 'blob') db.run('UPDATE history SET data=? WHERE id=?', [new Uint8Array([1, 2, 3]), 'b']);
    // 保存坏夹具后再快照，断言删除过程没有修复或隐瞒原始损坏。
    f.store.saveSettings(f.store.settings()); const before = readFileSync(f.file), revision = f.store.historyPageRevision(), raw = f.store.historyRaw('a');
    expect(() => f.store.deleteHistorySnapshot(revision, refs, () => {})).toThrow();
    expect(f.store.historyRaw('a')).toBe(raw); expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(revision);
  });
  it('即便摘要对应坏索引原文也拒绝，遗留无连接原文只允许空连接索引', async () => {
    const f = await fixture(), db = database(f.store), legacy = { ...entry('legacy'), connectionId: undefined };
    db.run('INSERT INTO history VALUES(?,?,?,?)', ['legacy', '', JSON.stringify(legacy), legacy.startedAt]); f.store.saveSettings(f.store.settings());
    expect(f.store.deleteHistorySnapshot(f.store.historyPageRevision(), references(f.store, ['legacy']), () => {})).toBe(1);
    db.run('UPDATE history SET data=? WHERE id=?', [JSON.stringify({ ...entry('b'), startedAt: '另一个原文时间' }), 'b']); f.store.saveSettings(f.store.settings());
    const revision = f.store.historyPageRevision(), before = readFileSync(f.file);
    expect(() => f.store.deleteHistorySnapshot(revision, references(f.store), () => {})).toThrow('索引'); expect(readFileSync(f.file)).toEqual(before);
  });
  it('第二条真实SQLite触发器失败回滚第一条删除，后续保存不能夹带部分结果', async () => {
    const f = await fixture(); database(f.store).run("CREATE TRIGGER fail_history_delete BEFORE DELETE ON history WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'本例第二项拒绝'); END");
    f.store.saveSettings(f.store.settings()); const before = readFileSync(f.file), revision = f.store.historyPageRevision();
    expect(() => f.store.deleteHistorySnapshot(revision, references(f.store), () => {})).toThrow('修改未保存');
    expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(revision); expect(f.store.history()).toHaveLength(3);
    f.store.saveSettings(f.store.settings()); f.close(f.store); const reopened = await f.open(); expect(reopened.history()).toHaveLength(3);
  });
  it.each([true, false])('真实写盘失败恢复内存、磁盘、修订和秘密，系统保护可用=%s', async available => {
    const f = await fixture(available), before = readFileSync(f.file), revision = f.store.historyPageRevision(), other = unrelated(f.store);
    mkdirSync(f.file + '.tmp');
    expect(() => f.store.deleteHistorySnapshot(revision, references(f.store), () => {})).toThrow('修改未保存');
    expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(revision); expect(f.store.history()).toHaveLength(3); expect(unrelated(f.store)).toBe(other);
    expect(assertNetworkProfile(f.store.resolveConnection(profile.id)).password === profile.password).toBe(true);
    rmdirSync(f.file + '.tmp'); f.store.saveSettings(f.store.settings()); f.close(f.store); const reopened = await f.open(); expect(reopened.history()).toHaveLength(3);
    if (available) expect(assertNetworkProfile(reopened.resolveConnection(profile.id)).password === profile.password).toBe(true);
  });
  it.each([1, 2, 3, 4, 5, 6, 7])('归属或期限在第%s次检查失效时没有发布，rename前失败也回退已COMMIT内存', async failAt => {
    const f = await fixture(), refs = references(f.store), before = readFileSync(f.file), revision = f.store.historyPageRevision(); let checks = 0;
    expect(() => f.store.deleteHistorySnapshot(revision, refs, () => { if (++checks === failAt) throw Error('原文档或期限失效'); })).toThrow('失效');
    expect(checks).toBe(failAt); expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(revision); expect(f.store.history()).toHaveLength(3); expect(existsSync(f.file + '.tmp')).toBe(false);
    f.store.saveSettings(f.store.settings()); f.close(f.store); expect((await f.open()).history()).toHaveLength(3);
  });
  it('事务回调不能重入另一次保存，也不能事后替换已复制的授权ID', async () => {
    const f = await fixture(), refs = references(f.store), revision = f.store.historyPageRevision(), before = readFileSync(f.file); let checks = 0;
    expect(() => f.store.deleteHistorySnapshot(revision, refs, () => { if (++checks === 2) f.store.addHistory(entry('nested')); })).toThrow('正在提交');
    expect(readFileSync(f.file)).toEqual(before); expect(f.store.historyPageRevision()).toBe(revision); expect(f.store.historyRaw('nested')).toBeUndefined();
    expect(f.store.deleteHistorySnapshot(revision, refs, () => { refs[0].id = 'A'; refs.length = 1; })).toBe(2); expect(f.store.history().map(row => row.id)).toEqual(['A']);
  });
  it('真正1000个精确ID完整删除，无500条显示上限截断，修订末值不会溢出', async () => {
    const f = await fixture(), db = database(f.store); db.run('DELETE FROM history'); const statement = db.prepare('INSERT INTO history VALUES(?,?,?,?)');
    try { db.run('BEGIN'); for (let index = 0; index < 1000; index++) { const row = entry(String(index)); statement.run([row.id, row.connectionId, JSON.stringify(row), row.startedAt]); } db.run('COMMIT'); } finally { statement.free(); }
    f.store.saveSettings(f.store.settings()); const refs = references(f.store, Array.from({ length: 1000 }, (_, index) => String(index)));
    (f.store as unknown as { historyRevisionValue: number }).historyRevisionValue = Number.MAX_SAFE_INTEGER - 1;
    expect(f.store.deleteHistorySnapshot(f.store.historyPageRevision(), refs, () => {})).toBe(1000); expect(f.store.history()).toEqual([]);
    const before = readFileSync(f.file); expect(() => f.store.deleteHistorySnapshot(f.store.historyPageRevision(), refs, () => {})).toThrow(); expect(readFileSync(f.file)).toEqual(before);
  });
});
