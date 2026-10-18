import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import type { AppSettings } from '../../src/shared/contracts';
import { editorIndentationOptions, readEditorInsertSpaces, readEditorTabSize } from '../../src/shared/editorIndentation';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => { throw Error('缩进不使用凭据'); }, decrypt: () => { throw Error('缩进不使用凭据'); } };
const directories: string[] = [], stores: LocalStore[] = [];
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
/** 真正sql.js SQLite文件只在本克隆忽略缓存创建，不连接业务库或读取用户配置。 */
async function open() {
  const root = join(process.cwd(), '.cache/editor-indentation-tests'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'settings-')); directories.push(directory); const path = join(directory, 'settings.sqlite');
  const store = await LocalStore.open(path, wasm, protector); stores.push(store); return { path, store };
}
/** 固定只改合成settings行，模拟旧记录及损坏偏好；不调用产品写入口绕过坏值校验。 */
function seed(path: string, settings: unknown) { const db = new SQL.Database(readFileSync(path)); db.run('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(settings)]); writeFileSync(path, db.export()); db.close(); }
function close(store: LocalStore) { store.close(); stores.splice(stores.indexOf(store), 1); }
/** 打开磁盘SQLite核原schema和其它表，缩进不增加表、版本或查询记录。 */
function inspect(path: string, read: (db: Database) => void) { const db = new SQL.Database(readFileSync(path)); try { read(db); } finally { db.close(); } }
const original = () => ({ ...defaultSettings, theme: 'light' as const, sidebarWidth: 333, editorFontSize: 22, editorWordWrap: false, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query' as const, title: '原查询', connectionId: 'synthetic', sql: "select '原文\t🚢';" }] });

describe('缩进偏好的原settings与真实SQLite重启', () => {
  it('旧缺项和损坏值只局部回退2/空格，不写盘、不丢SQL；保持后续schema9', async () => {
    const { path, store } = await open(); close(store); const legacy = original(); delete legacy.editorTabSize; delete legacy.editorInsertSpaces;
    for (const values of [{}, { editorTabSize: '4', editorInsertSpaces: 'false' }, { editorTabSize: 0, editorInsertSpaces: 0 }, { editorTabSize: 9, editorInsertSpaces: null }, { editorTabSize: 1.5, editorInsertSpaces: [] }]) {
      seed(path, { ...legacy, ...values }); const before = readFileSync(path); const loaded = await LocalStore.open(path, wasm, protector); stores.push(loaded); const afterOpen = readFileSync(path);
      expect(loaded.settings()).toEqual({ ...legacy, editorTabSize: 2, editorInsertSpaces: true }); expect(readFileSync(path)).toEqual(afterOpen); close(loaded);
      inspect(path, db => { expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(JSON.parse(String(db.exec('SELECT data FROM settings')[0].values[0][0]))).toEqual({ ...legacy, ...values }); });
      expect(before.length).toBeGreaterThan(0);
    }
  });
  it('1/8与2、Tab/空格经严格IPC及LocalStore保存重开，原其它偏好/SQL/标签逐字保留', async () => {
    const { store, path } = await open();
    for (const editorTabSize of [1, 8, 2]) for (const editorInsertSpaces of [false, true]) {
      const settings = { ...original(), editorTabSize, editorInsertSpaces }; store.saveSettings(validateCommand('settings.save', settings) as AppSettings);
      const reopened = await LocalStore.open(path, wasm, protector); stores.push(reopened); expect(reopened.settings()).toEqual(settings); close(reopened);
      inspect(path, db => { expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(db.exec('SELECT COUNT(*) FROM queries')[0].values[0][0]).toBe(0); });
    }
    expect(editorIndentationOptions(undefined, undefined)).toEqual({ tabSize: 2, indentSize: 2, insertSpaces: true, detectIndentation: false });
  });
  it('显式坏值及undefined在IPC/直接存储均拒绝，未知字段仍被strict拒绝，磁盘和工作区不变', async () => {
    const { store, path } = await open(); store.saveSettings(original()); const before = readFileSync(path);
    for (const editorTabSize of [0, 9, 2.5, NaN, Infinity, '4', null, true, {}, [], undefined]) {
      const settings = { ...original(), editorTabSize }; expect(() => validateCommand('settings.save', settings)).toThrow(); expect(() => store.saveSettings(settings as any)).toThrow('整数'); expect(readEditorTabSize(editorTabSize)).toBe(2);
    }
    for (const editorInsertSpaces of ['true', 'false', 0, 1, null, {}, [], undefined]) {
      const settings = { ...original(), editorInsertSpaces }; expect(() => validateCommand('settings.save', settings)).toThrow(); expect(() => store.saveSettings(settings as any)).toThrow('布尔'); expect(readEditorInsertSpaces(editorInsertSpaces)).toBe(true);
    }
    expect(() => validateCommand('settings.save', { ...original(), editorIndentGuess: true })).toThrow(); expect(readFileSync(path)).toEqual(before); expect(store.settings()).toEqual(original());
    const legacy = original(); delete legacy.editorTabSize; delete legacy.editorInsertSpaces; expect(validateCommand('settings.save', legacy)).toEqual(legacy); store.saveSettings(legacy); expect(store.settings()).toEqual(original());
  });
  it('原子写盘失败仍回退内存，后续保存不会夹带失败缩进', async () => {
    const { store, path } = await open(); store.saveSettings(original()); const before = readFileSync(path); mkdirSync(path + '.tmp');
    expect(() => store.saveSettings({ ...original(), editorTabSize: 8, editorInsertSpaces: false })).toThrow('修改未保存'); expect(store.settings()).toEqual(original()); expect(readFileSync(path)).toEqual(before);
    rmSync(path + '.tmp', { recursive: true }); store.saveSettings({ ...store.settings(), editorWordWrap: true }); close(store);
    const restored = await LocalStore.open(path, wasm, protector); stores.push(restored); expect(restored.settings()).toEqual({ ...original(), editorWordWrap: true });
  });
});
