import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import type { AppSettings } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => '', decrypt: (value: string) => value };
let directory: string, file: string, store: LocalStore;

/** 真实SQLite只落在本例临时目录；不创建连接秘密，也不接触实际环境或系统密钥。 */
beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), 'dbark-d08-pref-')); file = join(directory, 'local.sqlite'); store = await LocalStore.open(file, wasm, protector); });
/** 删除前核对实际父目录、唯一前缀和非链接身份。 */
afterEach(() => { store?.close(); const actual = resolve(directory), stat = lstatSync(actual); if (stat.isSymbolicLink() || !stat.isDirectory() || dirname(actual) !== resolve(tmpdir()) || !/^dbark-d08-pref-[a-zA-Z0-9]+$/.test(basename(actual)) || dirname(realpathSync(actual)) !== realpathSync(tmpdir())) throw Error('拒绝清理非本例目录'); rmSync(actual, { recursive: true, force: true }); });

describe('D08既有本地偏好兼容', () => {
  it('新配置默认关闭；旧schema5缺字段仍关闭且不迁移历史/查询或数据库结构', async () => {
    expect(defaultSettings.dataTypeColors).toBe(false); expect(store.settings().dataTypeColors).toBe(false);
    store.saveQuery({ id: 'saved', name: '保留查询', sql: 'SELECT 1', updatedAt: '2026-10-16' });
    store.addHistory({ id: 'history', connectionId: 'synthetic', sql: 'SELECT 2', startedAt: '2026-10-16', elapsedMs: 1, success: true });
    const legacy = { ...store.settings(), theme: 'light' as const }; delete legacy.dataTypeColors; store.saveSettings(legacy); const queries = store.queries(), history = store.history(); store.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }), before = new SQL.Database(readFileSync(file)), schema = before.exec("SELECT type,name,sql FROM sqlite_master ORDER BY name"); expect(JSON.parse(String(before.exec('SELECT data FROM settings')[0].values[0][0]))).not.toHaveProperty('dataTypeColors'); before.close();
    store = await LocalStore.open(file, wasm, protector); expect(store.settings()).toEqual({ ...legacy, dataTypeColors: false }); expect(store.queries()).toEqual(queries); expect(store.history()).toEqual(history);
    const after = new SQL.Database(readFileSync(file)); expect(after.exec('PRAGMA user_version')[0].values[0][0]).toBe(7); expect(after.exec("SELECT type,name,sql FROM sqlite_master ORDER BY name")).toEqual(schema); after.close();
  });
  it('显式开启后重开恢复，单项重置恢复false，其他布局与已有SQL不新增记录', async () => {
    const settings = { ...store.settings(), theme: 'light' as const, sidebarWidth: 333, tabs: [{ id: 'tab', kind: 'query' as const, title: '原布局', connectionId: 'synthetic', sql: '原先已存在的布局正文' }] };
    store.saveSettings({ ...settings, dataTypeColors: true }); expect(store.history()).toEqual([]); expect(store.tasks()).toEqual([]); store.close();
    store = await LocalStore.open(file, wasm, protector); expect(store.settings()).toEqual({ ...settings, dataTypeColors: true }); store.saveSettings({ ...store.settings(), dataTypeColors: false }); store.close();
    store = await LocalStore.open(file, wasm, protector); expect(store.settings()).toEqual({ ...settings, dataTypeColors: false }); expect(store.history()).toEqual([]); expect(store.tasks()).toEqual([]); expect(store.queries()).toEqual([]);
  });
  it.each(['true', 'false', 1, 0, null, {}, [], new Boolean(true)])('非布尔偏好%s在IPC和真实存储入口均拒绝，原文件不变', value => {
    const settings = store.settings(), before = readFileSync(file);
    expect(() => validateCommand('settings.save', { ...settings, dataTypeColors: value })).toThrow(); expect(() => store.saveSettings({ ...settings, dataTypeColors: value } as AppSettings)).toThrow('布尔'); expect(readFileSync(file)).toEqual(before); expect(store.settings().dataTypeColors).toBe(false);
  });
  it('旧IPC可缺字段，新增未知字段和历史开关拒绝，不扩大设置白名单', () => {
    const legacy = { ...store.settings() }; delete legacy.dataTypeColors;
    expect(validateCommand('settings.save', legacy)).toEqual(legacy); expect(validateCommand('settings.save', { ...legacy, dataTypeColors: true })).toMatchObject({ dataTypeColors: true }); expect(() => validateCommand('settings.save', { ...legacy, dataTypeColorHistory: true })).toThrow();
  });
  it('写盘失败恢复原偏好与内存，后续保存不夹带未保存的开启', () => {
    const before = readFileSync(file); mkdirSync(file + '.tmp'); expect(() => store.saveSettings({ ...store.settings(), dataTypeColors: true })).toThrow('修改未保存'); expect(readFileSync(file)).toEqual(before); expect(store.settings().dataTypeColors).toBe(false);
    rmdirSync(file + '.tmp'); store.saveSettings(store.settings()); expect(store.settings().dataTypeColors).toBe(false);
  });
  it('旧文件的损坏真值不被强转，读取只规范为关闭，不写新的数据或历史', async () => {
    store.saveSettings(store.settings()); store.close(); const SQL = await initSqlJs({ locateFile: () => wasm }), database = new SQL.Database(readFileSync(file)); database.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ ...defaultSettings, dataTypeColors: 'yes' })]); writeFileSync(file, database.export()); database.close();
    store = await LocalStore.open(file, wasm, protector); const before = readFileSync(file); expect(store.settings().dataTypeColors).toBe(false); expect(readFileSync(file)).toEqual(before); expect(store.history()).toEqual([]); expect(store.queries()).toEqual([]);
  });
});
