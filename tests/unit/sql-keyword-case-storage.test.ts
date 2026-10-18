import { afterEach, beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import { readSqlKeywordCase } from '../../src/shared/sqlKeywordCase';
import type { AppSettings } from '../../src/shared/contracts';
const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const root = resolve('.cache/sql-keyword-case-storage'), directories: string[] = [], stores: LocalStore[] = [];
const protector = { available: () => false, encrypt() { throw Error('偏好不使用凭据'); }, decrypt() { throw Error('偏好不使用凭据'); } };
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) { if (dirname(path) !== realpathSync(root) || realpathSync(path) !== path) throw Error('仅清理本任务实际创建的目录'); rmSync(path, { recursive: true, force: false }); }
});
/** 真正SQLite文件只写本clone缓存；不读取用户数据、连接数据库或凭据。 */
async function open(path?: string) {
  if (!path) { mkdirSync(root, { recursive: true }); const directory = mkdtempSync(join(realpathSync(root), 'owned-')); directories.push(directory); path = join(directory, 'settings.sqlite'); }
  const store = await LocalStore.open(path, wasm, protector); stores.push(store); return { path, store };
}
function close(store: LocalStore) { store.close(); stores.splice(stores.indexOf(store), 1); }
/** 仅为旧/坏存量对照注入合成settings，不绕过产品保存路径验证。 */
function seed(path: string, settings: unknown) { const db = new SQL.Database(readFileSync(path)); try { db.run('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(settings)]); writeFileSync(path, db.export()); } finally { db.close(); } }
const legacy = (): AppSettings => ({ ...defaultSettings, theme: 'light', sidebarWidth: 333, editorTabSize: 8, editorInsertSpaces: false, tabs: [{ id: 'q', kind: 'query', title: '原查询', connectionId: '合成', sql: "select MiXeD,'🚢';\r\n-- 保持正文" }], activeTabId: 'q' });

it('旧缺项保持默认原样，坏存量只局部读取回退，不写盘或改SQL', async () => {
  const f = await open(); close(f.store);
  for (const patch of [{}, { sqlKeywordCase: 'lower' }, { sqlKeywordCase: null }, { sqlKeywordCase: 1 }]) {
    seed(f.path, { ...legacy(), ...patch }); const loaded = await open(f.path), before = readFileSync(f.path);
    const settings = loaded.store.settings(); expect(readSqlKeywordCase(settings.sqlKeywordCase)).toBe('preserve'); expect(settings.tabs).toEqual(legacy().tabs);
    expect(Object.hasOwn(settings, 'sqlKeywordCase')).toBe(Object.hasOwn(patch, 'sqlKeywordCase')); expect(readFileSync(f.path)).toEqual(before); close(loaded.store);
    const db = new SQL.Database(readFileSync(f.path)); try { expect(JSON.parse(String(db.exec('SELECT data FROM settings')[0].values[0][0]))).toEqual({ ...legacy(), ...patch }); } finally { db.close(); }
  }
});

it('两种值经过正式IPC/LocalStore保存并真实重开，schema/其它偏好/SQL逐字保留', async () => {
  const f = await open();
  for (const sqlKeywordCase of ['upper', 'preserve'] as const) {
    const settings = { ...legacy(), sqlKeywordCase }; f.store.saveSettings(validateCommand('settings.save', settings) as AppSettings);
    const next = await open(f.path); expect(next.store.settings()).toEqual(settings); close(next.store);
    const db = new SQL.Database(readFileSync(f.path)); try { expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(db.exec('SELECT COUNT(*) FROM queries')[0].values[0][0]).toBe(0); } finally { db.close(); }
  }
});

it('显式undefined/坏值两入口拒绝，未知字段仍strict拒绝，磁盘和配置不变', async () => {
  const f = await open(); f.store.saveSettings(legacy()); const before = readFileSync(f.path);
  for (const value of [undefined, null, 'lower', 'UPPER', '', true, 1, {}, []]) {
    const input = { ...legacy(), sqlKeywordCase: value };
    expect(() => validateCommand('settings.save', input)).toThrow(); expect(() => f.store.saveSettings(input as any)).toThrow('大小写偏好');
  }
  expect(() => validateCommand('settings.save', { ...legacy(), keywordCase: 'upper' })).toThrow(); expect(readFileSync(f.path)).toEqual(before); expect(f.store.settings()).toEqual(legacy());
});

it('原子落盘失败回退内存，后续保存不会夹带失败的大写偏好', async () => {
  const f = await open(), before = { ...legacy(), sqlKeywordCase: 'preserve' as const }; f.store.saveSettings(before); const bytes = readFileSync(f.path);
  mkdirSync(f.path + '.tmp'); expect(() => f.store.saveSettings({ ...before, sqlKeywordCase: 'upper' })).toThrow('修改未保存'); expect(f.store.settings()).toEqual(before); expect(readFileSync(f.path)).toEqual(bytes);
  rmdirSync(f.path + '.tmp'); f.store.saveSettings({ ...f.store.settings(), sidebarWidth: 345 }); close(f.store);
  const next = await open(f.path); expect(next.store.settings()).toEqual({ ...before, sidebarWidth: 345 });
});
