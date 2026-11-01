import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import type { SqliteTablePresetStoredSnapshot, SqliteTablePresetQuery } from '../../src/shared/sqliteTablePresets';
import { mainColumnsHarness } from './main-columns-owner-harness';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const profile: SqliteConnectionProfile = { id: 'sqlite', name: '本机', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '不存在且不得读取.sqlite', readOnly: true, busyTimeoutMs: 1000 } };
const protector = { available: () => true, encrypt: vi.fn((value: string) => value), decrypt: vi.fn((value: string) => value) };
const target = { connectionId: profile.id, database: 'main' as const, table: '__proto__.表🚢' };
const query: SqliteTablePresetQuery = { limit: 7, mode: 'or', filters: [{ column: 'id', operator: 'in', values: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '-9223372036854775808' }], enabled: false }, { column: 'memo', operator: 'between', value: { kind: 'text', value: '' }, secondValue: { kind: 'text', value: '\0\r\n🚢' } }], sort: [{ column: 'id', direction: 'desc' }] };
const packet = (s: SqliteTablePresetStoredSnapshot) => ({ ...s.target, source: s.source, expectedRevision: s.revision, bindingToken: randomUUID() });
let folder: string, file: string, store: LocalStore, success: boolean;
beforeEach(async () => { success = false; folder = mkdtempSync(join(tmpdir(), 'dbark-sqlite-preset-')); file = join(folder, 'config.sqlite'); store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile); vi.clearAllMocks(); });
/** 失败保留文件；只清理本例核对后的准确目录，拒绝链接或父目录变化。 */
afterEach(context => {
  store?.close(); if (context.task.result?.state === 'fail' || !success) { console.error('保留SQLite方案测试现场：' + folder); return; }
  const path = resolve(folder); if (dirname(path) !== resolve(tmpdir()) || !/^dbark-sqlite-preset-[\w-]+$/.test(basename(path)) || lstatSync(path).isSymbolicLink() || dirname(realpathSync(path)) !== realpathSync(tmpdir())) throw Error('拒绝越界清理');
  rmSync(path, { recursive: true });
});
it('真实配置SQLite保存、重开及精确目标隔离，不解密或打开目标文件', async () => {
  const first = store.saveSqliteTablePreset({ ...packet(store.sqliteTablePresets(target)), name: '精准列表', query });
  expect(store.selectedSqliteTablePreset({ ...packet(first), id: first.entries[0].id })).toEqual(query);
  store.saveConnection({ ...profile, id: 'other' });
  for (const key of [{ ...target, table: '__proto__.表🚢x' }, { ...target, connectionId: 'other' }]) expect(store.sqliteTablePresets(key).entries).toEqual([]);
  store.close(); store = await LocalStore.open(file, wasm, protector); const reopened = store.sqliteTablePresets(target);
  expect(reopened.entries).toEqual(first.entries); expect(store.selectedSqliteTablePreset({ ...packet(reopened), id: first.entries[0].id })).toEqual(query);
  expect(protector.decrypt).not.toHaveBeenCalled(); success = true;
});
it('真实Main IPC注册、校验、分发、发布与配置SQLite闭环，导航撤销来源且零worker请求', async () => {
  const f = mainColumnsHarness(); f.context.store = store; f.setRevision(store.connectionRevision()); f.request.mockImplementation(async () => { throw Error('本机方案禁止worker'); });
  const empty = await f.run('sqlite.tablePresets.list', target);
  const saved = await f.run('sqlite.tablePresets.save', { ...packet(empty), bindingToken: empty.bindingToken, name: '原IPC', query });
  const selected = { ...packet(saved), bindingToken: saved.bindingToken, id: saved.entries[0].id };
  expect(await f.run('sqlite.tablePresets.read', selected)).toEqual(query);
  const bytes = readFileSync(file); f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await expect(f.run('sqlite.tablePresets.delete', selected)).rejects.toThrow('来源'); expect(readFileSync(file)).toEqual(bytes);
  const current = await f.run('sqlite.tablePresets.list', target); expect((await f.run('sqlite.tablePresets.delete', { ...packet(current), bindingToken: current.bindingToken, id: saved.entries[0].id })).entries).toEqual([]);
  expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0); success = true;
});
it('同名明确覆盖、双读CAS、错误替换及删除墓碑在重启后仍保护', async () => {
  const empty = store.sqliteTablePresets(target); let s = store.saveSqliteTablePreset({ ...packet(empty), name: '常用', query }); const id = s.entries[0].id;
  expect(() => store.saveSqliteTablePreset({ ...packet(empty), name: '并发', query })).toThrow('变化');
  expect(() => store.saveSqliteTablePreset({ ...packet(s), name: '常用', query })).toThrow('同名');
  expect(() => store.saveSqliteTablePreset({ ...packet(s), name: '改名', replaceId: id, query })).toThrow();
  expect(() => store.saveSqliteTablePreset({ ...packet(s), name: '常用', replaceId: randomUUID(), query })).toThrow();
  s = store.saveSqliteTablePreset({ ...packet(s), name: '常用', replaceId: id, query: { ...query, limit: 9 } }); expect(s.entries[0].id).toBe(id);
  const removed = store.deleteSqliteTablePreset({ ...packet(s), id }); expect(removed).toMatchObject({ revision: 3, entries: [] });
  store.close(); store = await LocalStore.open(file, wasm, protector);
  expect(store.sqliteTablePresets(target).revision).toBe(3); expect(() => store.saveSqliteTablePreset({ ...packet(empty), name: '常用', query })).toThrow('变化'); success = true;
});
it('连接配置变化拒绝旧CAS和旧摘要载入，明确覆盖才能重新绑定', () => {
  const s = store.saveSqliteTablePreset({ ...packet(store.sqliteTablePresets(target)), name: '常用', query }); const id = s.entries[0].id;
  store.saveConnection({ ...profile, sqlite: { ...profile.sqlite, readOnly: false } });
  expect(() => store.selectedSqliteTablePreset({ ...packet(s), id })).toThrow('变化');
  const current = store.sqliteTablePresets(target); expect(() => store.selectedSqliteTablePreset({ ...packet(current), id })).toThrow('来源');
  const fixed = store.saveSqliteTablePreset({ ...packet(current), name: '常用', replaceId: id, query }); expect(store.selectedSqliteTablePreset({ ...packet(fixed), id })).toEqual(query);
  store.deleteConnection(profile.id); expect(() => store.sqliteTablePresets(target)).toThrow('删除');
  store.saveConnection(profile); expect(store.sqliteTablePresets(target).entries).toEqual([]); success = true;
});
it('真实写盘失败回滚内存及原文件，之后保存不夹带失败项', () => {
  const empty = store.sqliteTablePresets(target), bytes = readFileSync(file); mkdirSync(file + '.tmp');
  expect(() => store.saveSqliteTablePreset({ ...packet(empty), name: '失败', query })).toThrow('未保存');
  expect(store.sqliteTablePresets(target)).toEqual(empty); expect(readFileSync(file)).toEqual(bytes);
  // 精确空目录，由本例上方创建；没有递归删除或猜测路径。
  rmdirSync(file + '.tmp');
  expect(store.saveSqliteTablePreset({ ...packet(empty), name: '成功', query }).entries.map(e => e.name)).toEqual(['成功']); success = true;
});
it('事务提交门失败还原磁盘、内存与CAS，重入不能夹带变更', () => {
  const empty = store.sqliteTablePresets(target), bytes = readFileSync(file);
  expect(() => store.saveSqliteTablePreset({ ...packet(empty), name: '拒绝', query }, () => { throw Error('原窗口失效'); })).toThrow('失效');
  expect(readFileSync(file)).toEqual(bytes); expect(store.sqliteTablePresets(target)).toEqual(empty); success = true;
});
it('旧schema9可选表迁移保留其它原记录，损坏方案不覆盖原文件', async () => {
  store.saveSettings({ ...store.settings(), sidebarWidth: 345 }); store.saveQuery({ id: 'q', name: '旧查询', sql: 'SELECT 1', updatedAt: '2026-11-01T00:00:00Z' }); store.close();
  const SQL = await initSqlJs({ locateFile: () => wasm }); let db = new SQL.Database(readFileSync(file)); db.run('DROP TABLE table_presets_sqlite'); const before = ['connections', 'settings', 'queries'].map(name => db.exec('SELECT * FROM ' + name)); writeFileSync(file, db.export()); db.close();
  store = await LocalStore.open(file, wasm, protector); expect(store.sqliteTablePresets(target).entries).toEqual([]); store.close();
  db = new SQL.Database(readFileSync(file)); expect(['connections', 'settings', 'queries'].map(name => db.exec('SELECT * FROM ' + name))).toEqual(before);
  db.run('INSERT INTO table_presets_sqlite VALUES(?,?,?,?)', [target.connectionId, target.database, target.table, '{"version":99}']); const bad = Buffer.from(db.export()); writeFileSync(file, bad); db.close();
  await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow(); expect(readFileSync(file)).toEqual(bad); success = true;
});
it('20项/目标预算、500个目标和8MiB原始字节在JSON解析之前拒绝', () => {
  let current = store.sqliteTablePresets(target);
  for (let i = 0; i < 20; i++) current = store.saveSqliteTablePreset({ ...packet(current), name: '方案' + i, query });
  expect(() => store.saveSqliteTablePreset({ ...packet(current), name: '第21项', query })).toThrow(); expect(store.sqliteTablePresets(target).entries).toHaveLength(20);
  let db = (store as unknown as { db: import('sql.js').Database }).db;
  db.run('DELETE FROM table_presets_sqlite');
  for (let i = 0; i < 500; i++) { const t = { ...target, table: 't' + i }; db.run('INSERT INTO table_presets_sqlite VALUES(?,?,?,?)', [t.connectionId, t.database, t.table, JSON.stringify({ version: 1, target: t, revision: 0, entries: [] })]); }
  expect(() => store.saveSqliteTablePreset({ ...packet(store.sqliteTablePresets(target)), name: '越界', query })).toThrow('500');
  db = (store as unknown as { db: import('sql.js').Database }).db;
  db.run('DELETE FROM table_presets_sqlite'); db.run('INSERT INTO table_presets_sqlite VALUES(?,?,?,?)', [target.connectionId, 'main', 'large', 'x'.repeat(8 * 1024 * 1024)]);
  expect(() => store.saveSqliteTablePreset({ ...packet(store.sqliteTablePresets(target)), name: '越界', query })).toThrow('8MiB'); success = true;
});
