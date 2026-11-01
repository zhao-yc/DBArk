import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { SqliteTableLayoutMain } from '../../src/main/sqliteTableLayoutMain';
import { mainColumnsHarness } from './main-columns-owner-harness';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import type { SqliteLayoutStoredSnapshot } from '../../src/shared/sqliteTableLayout';
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'), target = { connectionId: 'sqlite', database: 'main' as const, table: '表.__proto__' };
const profile: SqliteConnectionProfile = { id: target.connectionId, name: '离线文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '不得读取的不存在文件.sqlite', readOnly: true, busyTimeoutMs: 1000 } };
const preferences = { version: 1 as const, columns: [{ name: '__proto__', hidden: false, width: 64 }, { name: '长列' + '字'.repeat(510), hidden: true }, { name: 'A', hidden: false, width: 2000 }], frozenThrough: '__proto__' };
const protector = { available: () => false, encrypt: vi.fn(() => { throw Error('禁止凭据'); }), decrypt: vi.fn(() => { throw Error('禁止凭据'); }) };
let directory: string, file: string, store: LocalStore;
beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-layout-')); file = join(directory, 'config.sqlite'); store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile); vi.clearAllMocks(); });
/** 只清理成功用例的精确独占目录，失败保留原文件；拒绝链接或越界路径。 */
afterEach(context => { store?.close(); if (context.task.result?.state === 'fail') { console.error('列布局失败目录保留：' + directory); return; } const path = resolve(directory); if (dirname(path) !== resolve(tmpdir()) || !/^dbark-sqlite-layout-[\w-]+$/.test(basename(path)) || lstatSync(path).isSymbolicLink() || dirname(realpathSync(path)) !== realpathSync(tmpdir())) throw Error('拒绝越界清理'); rmSync(path, { recursive: true }); });
const packet = (s: SqliteLayoutStoredSnapshot) => ({ ...s.target, source: s.source, expectedRevision: s.revision, bindingToken: randomUUID() });
it('真实SQLite配置保存、重开、准确目标隔离和重置CAS墓碑，零解密或目标文件IO', async () => {
  const empty = store.sqliteTableLayout(target), saved = store.saveSqliteTableLayout({ ...packet(empty), preferences });
  expect(saved.preferences).toEqual(preferences); expect(store.sqliteTableLayout({ ...target, table: '另表' }).preferences).toBeNull();
  store.close(); store = await LocalStore.open(file, wasm, protector); expect(store.sqliteTableLayout(target).preferences).toEqual(preferences);
  const current = store.sqliteTableLayout(target); expect(store.saveSqliteTableLayout(packet(current), true)).toMatchObject({ revision: 2, preferences: null });
  expect(() => store.saveSqliteTableLayout({ ...packet(empty), preferences })).toThrow('变化'); expect(store.sqliteTableLayout(target).revision).toBe(2); expect(protector.decrypt).not.toHaveBeenCalled();
});
it('并发CAS、路径与读写配置变动、删除连接保护原值及其它连接布局', () => {
  const empty = store.sqliteTableLayout(target), saved = store.saveSqliteTableLayout({ ...packet(empty), preferences });
  expect(() => store.saveSqliteTableLayout(packet(empty), true)).toThrow('变化');
  store.saveConnection({ ...profile, sqlite: { ...profile.sqlite, readOnly: false } }); expect(() => store.saveSqliteTableLayout({ ...packet(saved), preferences })).toThrow('变化');
  const current = store.sqliteTableLayout(target); expect(current.connectionDigest).not.toBe(current.source.connectionDigest);
  const rebound = store.saveSqliteTableLayout({ ...packet(current), preferences }); expect(rebound.connectionDigest).toBe(rebound.source.connectionDigest);
  store.saveConnection({ ...profile, id: 'other' }); const other = { ...target, connectionId: 'other' }; store.saveSqliteTableLayout({ ...packet(store.sqliteTableLayout(other)), preferences }); store.deleteConnection(profile.id);
  expect(() => store.sqliteTableLayout(target)).toThrow('删除'); expect(store.sqliteTableLayout(other).preferences).toEqual(preferences);
  store.saveConnection(profile); expect(store.sqliteTableLayout(target).preferences).toBeNull();
});
it('写盘真实失败与提交门拒绝均恢复内存及原字节，不夹带失败布局', () => {
  const before = store.sqliteTableLayout(target), bytes = readFileSync(file); mkdirSync(file + '.tmp');
  expect(() => store.saveSqliteTableLayout({ ...packet(before), preferences })).toThrow('未保存'); expect(store.sqliteTableLayout(target)).toEqual(before); expect(readFileSync(file)).toEqual(bytes); rmdirSync(file + '.tmp');
  expect(() => store.saveSqliteTableLayout({ ...packet(before), preferences }, false, () => { throw Error('原文档失效'); })).toThrow('失效'); expect(store.sqliteTableLayout(target)).toEqual(before); expect(readFileSync(file)).toEqual(bytes);
});
it('可选旧schema9迁移保留设置/查询，损坏布局在任何写盘前拒绝', async () => {
  store.saveSettings({ ...store.settings(), sidebarWidth: 343 }); store.close(); const SQL = await initSqlJs({ locateFile: () => wasm }); let db = new SQL.Database(readFileSync(file)); db.run('DROP TABLE table_layouts_sqlite'); const original = db.exec('SELECT * FROM settings'); writeFileSync(file, db.export()); db.close();
  store = await LocalStore.open(file, wasm, protector); expect(store.sqliteTableLayout(target).preferences).toBeNull(); store.close(); db = new SQL.Database(readFileSync(file)); expect(db.exec('SELECT * FROM settings')).toEqual(original); db.run('INSERT INTO table_layouts_sqlite VALUES(?,?,?,?)', [target.connectionId, 'main', target.table, '{"version":999}']); const invalid = Buffer.from(db.export()); writeFileSync(file, invalid); db.close();
  await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow(); expect(readFileSync(file)).toEqual(invalid);
});
it('Main真实IPC到配置库闭环，导航撤销来源，保存后晚发布仍报告已保存事实', async () => {
  const f = mainColumnsHarness(); f.context.store = store; f.setRevision(store.connectionRevision());
  const empty = await f.run('sqlite.tableLayout.get', target), saved = await f.run('sqlite.tableLayout.save', { ...packet(empty), bindingToken: empty.bindingToken, preferences }); expect(saved.preferences).toEqual(preferences);
  f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await expect(f.run('sqlite.tableLayout.reset', { ...packet(saved), bindingToken: saved.bindingToken })).rejects.toThrow('来源'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
  const invoke = f.capabilities.capture(f.event()), main = new SqliteTableLayoutMain({ store, assert: value => f.capabilities.assertCapturedOwner(value), same: (a, b) => f.capabilities.sharesDocumentOwner(a, b), available: () => {}, shuttingDown: () => false });
  const source = main.execute('get', target, invoke); source.publish(); const result = main.execute('save', { ...packet(source.value), bindingToken: source.value.bindingToken, preferences }, invoke);
  f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); expect(() => result.publish()).toThrow('已保存'); expect(store.sqliteTableLayout(target).revision).toBe(2);
});
it('原文档、令牌、准确目标和十分钟期限不能由客户端字段替代', () => {
  const f = mainColumnsHarness(), owner = f.capabilities.capture(f.event()); let now = 0;
  const main = new SqliteTableLayoutMain({ store, assert: value => f.capabilities.assertCapturedOwner(value), same: (a, b) => f.capabilities.sharesDocumentOwner(a, b), available: () => {}, shuttingDown: () => false }, () => now);
  const source = main.execute('get', target, owner); source.publish(); const input = { ...packet(source.value), bindingToken: source.value.bindingToken, preferences };
  for (const extra of [{ bindingToken: randomUUID() }, { table: 'another' }, { source: { ...source.value.source, connectionRevision: 123 } }]) expect(() => main.execute('save', { ...input, ...extra }, owner)).toThrow();
  expect(() => main.execute('save', input, { owner: owner.owner } as any)).toThrow(); now = 600000; expect(() => main.execute('save', input, owner)).toThrow('来源'); expect(store.sqliteTableLayout(target).revision).toBe(0);
});
it('500个目标及8MiB原始字节预算，先拒绝超大内容再解析JSON', () => {
  let db = (store as unknown as { db: import('sql.js').Database }).db;
  for (let i = 0; i < 500; i++) { const t = { ...target, table: '目标' + i }; db.run('INSERT INTO table_layouts_sqlite VALUES(?,?,?,?)', [t.connectionId, t.database, t.table, JSON.stringify({ version: 1, target: t, revision: 1, preferences: null })]); }
  expect(() => store.saveSqliteTableLayout({ ...packet(store.sqliteTableLayout(target)), preferences })).toThrow('500');
  db = (store as unknown as { db: import('sql.js').Database }).db; db.run('DELETE FROM table_layouts_sqlite'); db.run('INSERT INTO table_layouts_sqlite VALUES(?,?,?,?)', [target.connectionId, 'main', '大内容', 'x'.repeat(8 * 1024 * 1024)]);
  expect(() => store.saveSqliteTableLayout({ ...packet(store.sqliteTableLayout(target)), preferences })).toThrow('8MiB');
});
