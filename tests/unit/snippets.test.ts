import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { SNIPPET_LIMITS, validateSnippetBudget } from '../../src/shared/snippets';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { snippetEdit } from '../../src/renderer/snippetInsertion';
import type { SqlSnippet } from '../../src/shared/contracts';

const require = createRequire(import.meta.url); const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value };
const dirs: string[] = [];
const sample: SqlSnippet = { id: '片段一', name: 'JSON 查询', group: '常用', description: '保留普通 SQL 原文', sql: "-- $1 ${name}\nSELECT JSON_OBJECT('a', '$&'), '${1:值}', '🚢';\n", updatedAt: '' };
/** 临时库仅供本测试使用，不触碰开发数据库或用户配置。 */
function path() { const dir = mkdtempSync(join(tmpdir(), 'dbark-snippets-')); dirs.push(dir); return join(dir, 'local.sqlite'); }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('独立 SQL 片段库', () => {
  it('保存、同名复制、更新目标 ID、删除和重启保留正文', async () => {
    const file = path(); let store = await LocalStore.open(file, wasm, protector);
    store.saveSnippet(sample); store.saveSnippet({ ...sample, id: '片段二' });
    store.saveSnippet({ ...sample, description: '新的说明' });
    expect(store.snippets().find(item => item.id === '片段二')?.description).toBe(sample.description);
    expect(store.settings()).not.toHaveProperty('snippets'); expect(store.queries()).toEqual([]);
    store.close(); store = await LocalStore.open(file, wasm, protector);
    expect(store.snippets().map(item => item.sql)).toEqual([sample.sql, sample.sql]);
    store.deleteSnippet(sample.id); expect(store.snippets().map(item => item.id)).toEqual(['片段二']); store.close();
  });
  it('旧 v1 库迁移保留查询和设置，未来版本不允许静默回退', async () => {
    const file = path(); const SQL = await initSqlJs({ locateFile: () => wasm }); const db = new SQL.Database();
    db.run('CREATE TABLE queries(id TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=1;');
    db.run('INSERT INTO queries VALUES (?,?,?)', ['旧查询', JSON.stringify({ id: '旧查询', name: '旧查询', sql: 'SELECT 7', updatedAt: '' }), '']);
    db.run('INSERT INTO settings VALUES (1,?)', [JSON.stringify({ theme: 'light', tabs: [] })]); writeFileSync(file, db.export()); db.close();
    const store = await LocalStore.open(file, wasm, protector); expect(store.queries()[0].sql).toBe('SELECT 7'); expect(store.settings().theme).toBe('light'); expect(store.snippets()).toEqual([]); store.close();
    const migrated = new SQL.Database(readFileSync(file)); expect(migrated.exec('PRAGMA user_version')[0].values[0][0]).toBe(7); migrated.close();
    // 0.2 使用 schema1，0.3～0.5 使用 schema2，0.6 使用 schema3；本轮 schema7 回退必须恢复升级前备份，不能重置配置库。
    const future = new SQL.Database(readFileSync(file)); future.run('PRAGMA user_version=8'); writeFileSync(file, future.export()); future.close(); const before = readFileSync(file);
    await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow('更新版本'); expect(readFileSync(file).equals(before)).toBe(true);
  });
  it('迁移写盘失败完整保留旧配置，修复后可重新迁移', async () => {
    const file = path(); const SQL = await initSqlJs({ locateFile: () => wasm }); const db = new SQL.Database(); db.run('PRAGMA user_version=1'); writeFileSync(file, db.export()); db.close(); const before = readFileSync(file);
    mkdirSync(`${file}.tmp`); await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow('修改未保存'); expect(readFileSync(file).equals(before)).toBe(true);
    rmSync(`${file}.tmp`, { recursive: true }); const store = await LocalStore.open(file, wasm, protector); expect(store.snippets()).toEqual([]); store.close();
  });
  it('保存和删除写盘失败回退，不在之后的设置保存中偷偷提交', async () => {
    const file = path(); const store = await LocalStore.open(file, wasm, protector); store.saveSnippet(sample); mkdirSync(`${file}.tmp`);
    expect(() => store.saveSnippet({ ...sample, sql: '失败的修改' })).toThrow('修改未保存'); expect(() => store.deleteSnippet(sample.id)).toThrow('修改未保存'); expect(store.snippets()[0].sql).toBe(sample.sql);
    rmSync(`${file}.tmp`, { recursive: true }); store.saveSettings({ ...store.settings(), theme: 'light' }); store.close();
    const restored = await LocalStore.open(file, wasm, protector); expect(restored.snippets()[0].sql).toBe(sample.sql); restored.close();
  });
  it('IPC 与存储边界同时校验字段，拒绝额外连接或执行字段', async () => {
    expect(publicCommands['snippets.save']).toBe(true); expect(validateCommand('snippets.save', sample)).toEqual(sample);
    for (const invalid of [{ ...sample, sql: '   ' }, { ...sample, name: 'a'.repeat(101) }, { ...sample, group: 'a'.repeat(101) }, { ...sample, description: 'a'.repeat(2001) }, { ...sample, sql: 'a'.repeat(65_537) }, { ...sample, connectionId: '业务库' }]) expect(() => validateCommand('snippets.save', invalid)).toThrow();
    const store = await LocalStore.open(path(), wasm, protector); expect(() => store.saveSnippet({ ...sample, name: '' })).toThrow(); expect(store.snippets()).toEqual([]); store.close();
  });
  it('数量和 UTF-8 总预算拒绝超限，达上限仍允许原 ID 更新', () => {
    const full = Array.from({ length: SNIPPET_LIMITS.count }, (_, index) => ({ ...sample, id: String(index) }));
    expect(() => validateSnippetBudget(full, sample)).toThrow('500'); expect(validateSnippetBudget(full, { ...sample, id: '0' }).id).toBe('0');
    const large = Array.from({ length: 32 }, (_, index) => ({ ...sample, id: String(index), sql: '中'.repeat(43_690) }));
    expect(() => validateSnippetBudget(large, { ...sample, sql: '中'.repeat(10_000) })).toThrow('UTF-8'); expect(validateSnippetBudget(large, { ...sample, id: '0', sql: 'SELECT 1' }).sql).toBe('SELECT 1');
  });
  it('实际 SQLite 满额库在保存前拒绝超预算，失败不改变磁盘', async () => {
    const file = path(); const initial = await LocalStore.open(file, wasm, protector); initial.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }); const db = new SQL.Database(readFileSync(file));
    const rows = Array.from({ length: 32 }, (_, index) => ({ ...sample, id: String(index), sql: '中'.repeat(43_690) }));
    for (const item of rows) db.run('INSERT INTO sql_snippets VALUES (?,?,?)', [item.id, JSON.stringify(item), '']);
    writeFileSync(file, db.export()); db.close(); const store = await LocalStore.open(file, wasm, protector); const before = readFileSync(file);
    expect(() => store.saveSnippet({ ...sample, sql: '中文'.repeat(1000) })).toThrow('UTF-8'); expect(readFileSync(file).equals(before)).toBe(true); expect(store.snippets()).toHaveLength(32);
    store.saveSnippet({ ...sample, id: '0', sql: 'SELECT 1;' }); store.saveSnippet(sample); expect(store.snippets()).toHaveLength(33); store.close();
  });
  it('纯文本插入编辑保留范围与正文，无任何插值转义', () => {
    const range = { startLineNumber: 3, startColumn: 2, endLineNumber: 4, endColumn: 8 }; const edit = snippetEdit(range, sample.sql);
    expect(edit.range).toBe(range); expect(edit.text).toBe(sample.sql); expect(edit.forceMoveMarkers).toBe(true);
  });
});
