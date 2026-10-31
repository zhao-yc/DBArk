import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { importPresetLimits, type ImportPresetConfiguration, type ImportPresetSnapshot } from '../../src/shared/importPresets';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>();
const protector = { available: () => false, encrypt: vi.fn((): string => { throw Error('不应加密'); }), decrypt: vi.fn((): string => { throw Error('不应解密'); }) };
/** 纯配置夹具，映射含原型同名字段但不包含文件、行数据或真实连接身份。 */
function configuration(): ImportPresetConfiguration { return { format: 'csv', encoding: 'gb18030', csvDelimiter: '\t', csvHasHeader: false, columns: ['__proto__', '第2列', '跨\r\n行'], mapping: Object.fromEntries([['__proto__', '编号'], ['第2列', ''], ['跨\r\n行', '正文']]) }; }
function packet(snapshot: ImportPresetSnapshot) { return { generation: snapshot.generation, revision: snapshot.revision }; }
/** 每次均使用真实sql.js和独立临时文件，不访问任何数据库服务器或桌面窗口。 */
async function open(file: string): Promise<LocalStore> { const store = await LocalStore.open(file, wasm, protector); stores.add(store); return store; }
function close(store: LocalStore): void { store.close(); stores.delete(store); }
async function fixture() { const directory = mkdtempSync(join(tmpdir(), 'dbark-import-presets-')); directories.push(directory); const file = join(directory, 'local.sqlite'); return { file, store: await open(file) }; }
/** 离线改写仅用于合成坏文档和旧库；调用前原store必须关闭。 */
async function rewrite(file: string, action: (db: Database) => void): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
  try { action(db); writeFileSync(file, db.export()); } finally { db.close(); }
}
/** 原表以真实SQLite读回核对，排除本轮唯一新增的配置表。 */
async function otherTables(file: string): Promise<unknown> {
  const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
  try { return db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name<>'import_presets' ORDER BY name")[0].values.map(([name]) => [name, db.exec('SELECT * FROM "' + String(name).replaceAll('"', '""') + '"')]); }
  finally { db.close(); }
}
afterEach(() => {
  for (const store of stores) store.close(); stores.clear(); protector.encrypt.mockClear(); protector.decrypt.mockClear();
  // 精确清理本文件登记的合成目录和普通文件，包含用于故障注入的空.tmp目录。
  for (const directory of directories.splice(0)) { for (const item of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, item.name); if (item.isDirectory()) rmdirSync(path); else unlinkSync(path); } rmdirSync(directory); }
});

describe('导入配置真实SQLite、CAS及隔离', () => {
  it('完整配置重启读回，generation每次open更换且旧能力不能跨次复用', async () => {
    const { file, store } = await fixture(), empty = store.importPresets();
    expect(empty.entries).toEqual([]); expect(empty.revision).toBe(0);
    const saved = store.saveImportPreset({ ...packet(empty), name: '财务 CSV 导入', configuration: configuration() });
    expect(saved.revision).toBe(1); expect(saved.entries[0].configuration).toEqual(configuration()); expect(saved.entries[0].createdAt).toBe(saved.entries[0].updatedAt);
    const oldGeneration = saved.generation; close(store); const reopened = await open(file), current = reopened.importPresets();
    expect(current.entries).toEqual(saved.entries); expect(current.revision).toBe(1); expect(current.generation).not.toBe(oldGeneration);
    expect(() => reopened.deleteImportPreset({ ...packet(saved), id: saved.entries[0].id })).toThrow('变化');
    expect(() => reopened.saveImportPreset({ ...packet(saved), name: '旧代次', configuration: configuration() })).toThrow('变化');
    expect(protector.decrypt).not.toHaveBeenCalled(); expect(protector.encrypt).not.toHaveBeenCalled();
  });
  it('省略CSV默认与JSON原样持久化，返回副本不能改动已保存文档', async () => {
    const { store } = await fixture(); const raw: ImportPresetConfiguration = { format: 'csv', encoding: 'utf8', columns: ['源'], mapping: { 源: '目标' } };
    let current = store.saveImportPreset({ ...packet(store.importPresets()), name: '默认', configuration: raw });
    raw.mapping.源 = '外部修改'; current.entries[0].configuration.columns.reverse(); current.entries[0].name = '外部改名';
    expect(store.importPresets().entries[0]).toMatchObject({ name: '默认', configuration: { mapping: { 源: '目标' } } });
    current = store.saveImportPreset({ ...packet(store.importPresets()), name: 'JSON 配置', configuration: { format: 'json', encoding: 'utf16le', columns: ['id'], mapping: { id: 'id' } } });
    expect(Object.hasOwn(current.entries[0].configuration, 'csvHasHeader')).toBe(false); expect(Object.hasOwn(current.entries[1].configuration, 'csvDelimiter')).toBe(false);
    current.entries.splice(0); expect(store.importPresets().entries).toHaveLength(2);
  });
  it('覆盖保留编号/顺序/createdAt，同名精确冲突、旧修订和删空ABA均拒绝', async () => {
    const { store } = await fixture(), empty = store.importPresets(); let current = store.saveImportPreset({ ...packet(empty), name: '甲', configuration: configuration() });
    const first = current.entries[0], stale = packet(current);
    current = store.saveImportPreset({ ...packet(current), name: '乙', configuration: configuration() });
    expect(() => store.saveImportPreset({ ...packet(current), name: '甲', configuration: configuration() })).toThrow('同名');
    expect(() => store.saveImportPreset({ ...packet(current), id: first.id, name: '乙', configuration: configuration() })).toThrow('同名');
    expect(() => store.saveImportPreset({ ...packet(current), id: randomUUID(), name: '不存在覆盖', configuration: configuration() })).toThrow('删除');
    expect(() => store.deleteImportPreset({ ...stale, id: first.id })).toThrow('变化');
    current = store.saveImportPreset({ ...packet(current), id: first.id, name: '改名', configuration: { ...configuration(), encoding: 'utf8', csvHasHeader: true } });
    expect(current.entries[0]).toMatchObject({ id: first.id, createdAt: first.createdAt, name: '改名' }); expect(current.entries.map(item => item.name)).toEqual(['改名', '乙']);
    expect(Date.parse(current.entries[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt));
    current = store.deleteImportPreset({ ...packet(current), id: first.id }); current = store.deleteImportPreset({ ...packet(current), id: current.entries[0].id });
    expect(current.entries).toEqual([]); expect(current.revision).toBe(5);
    expect(() => store.saveImportPreset({ ...packet(empty), name: '旧创建', configuration: configuration() })).toThrow('变化');
    expect(() => store.deleteImportPreset({ ...packet(current), id: first.id })).toThrow('删除');
  });
  it('真实写盘失败恢复原文档/磁盘/修订，之后成功操作不夹带失败项', async () => {
    const { file, store } = await fixture(), current = store.saveImportPreset({ ...packet(store.importPresets()), name: '保留', configuration: configuration() }), before = readFileSync(file), id = current.entries[0].id;
    mkdirSync(file + '.tmp');
    for (const action of [() => store.saveImportPreset({ ...packet(current), name: '失败创建', configuration: configuration() }), () => store.saveImportPreset({ ...packet(current), id, name: '失败覆盖', configuration: configuration() }), () => store.deleteImportPreset({ ...packet(current), id })]) {
      expect(action).toThrow('未保存'); expect(store.importPresets()).toEqual(current); expect(readFileSync(file).equals(before)).toBe(true);
    }
    rmdirSync(file + '.tmp'); const saved = store.saveImportPreset({ ...packet(current), name: '成功', configuration: configuration() });
    expect(saved.revision).toBe(2); expect(saved.entries.map(item => item.name)).toEqual(['保留', '成功']);
  });
  it('归属在事务内及实际替换前复核，任意门失败均不落盘，门内不能重入其它写操作', async () => {
    const { file, store } = await fixture(), current = store.importPresets(), before = readFileSync(file);
    for (const stopAt of [1, 2, 3]) {
      let calls = 0; expect(() => store.saveImportPreset({ ...packet(current), name: '不得发布', configuration: configuration() }, () => { if (++calls === stopAt) throw Error('原文档失效'); })).toThrow('原文档失效');
      expect(calls).toBe(stopAt); expect(store.importPresets()).toEqual(current); expect(readFileSync(file).equals(before)).toBe(true);
    }
    expect(() => store.saveImportPreset({ ...packet(current), name: '重入失败', configuration: configuration() }, () => store.saveSettings(store.settings()))).toThrow('本地数据正在提交');
    expect(store.importPresets()).toEqual(current); expect(readFileSync(file).equals(before)).toBe(true);
    const guard = vi.fn(); expect(store.saveImportPreset({ ...packet(current), name: '通过', configuration: configuration() }, guard).revision).toBe(1); expect(guard).toHaveBeenCalledTimes(3);
  });
  it('配置CRUD不修改连接修订、历史/任务/查询/草稿/片段及其它原始表，也不解密秘密', async () => {
    const { file, store } = await fixture();
    store.saveConnection({ id: 'synthetic', name: '合成连接', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'none', group: '', color: '#123456', password: '仅本例内存', rememberPassword: false });
    store.saveQuery({ id: 'q', name: '保留查询', sql: 'SELECT 1', updatedAt: '2026-10-24T00:00:00.000Z' });
    store.saveSnippet({ id: 's', name: '保留片段', group: '', description: '', sql: 'SELECT 2', updatedAt: '2026-10-24T00:00:00.000Z' });
    store.addHistory({ id: 'h', connectionId: 'synthetic', sql: 'SELECT 3', startedAt: '2026-10-24T00:00:00.000Z', elapsedMs: 1, success: true });
    store.saveTask({ id: 't', kind: 'query.execute', status: 'completed', progress: 100, startedAt: '2026-10-24T00:00:00.000Z', message: '保留任务' });
    store.saveSettings({ ...store.settings(), tabs: [{ id: 'draft', kind: 'query', title: '未保存草稿', connectionId: 'synthetic', sql: 'SELECT 未保存' }] });
    const before = await otherTables(file), revisions = [store.connectionRevision(), store.historyPageRevision(), store.snippetRevision()];
    const saved = store.saveImportPreset({ ...packet(store.importPresets()), name: '仅配置', configuration: configuration() }); store.deleteImportPreset({ ...packet(saved), id: saved.entries[0].id });
    expect(await otherTables(file)).toEqual(before); expect([store.connectionRevision(), store.historyPageRevision(), store.snippetRevision()]).toEqual(revisions); expect(protector.decrypt).not.toHaveBeenCalled();
    expect(assertNetworkProfile(store.resolveConnection('synthetic')).password).toBe('仅本例内存');
  });
});

describe('导入配置迁移、损坏与预算保护', () => {
  it('旧schema9无可选表时只追加元数据表，原有记录保持且原生版本仍为9', async () => {
    const { file, store } = await fixture(); store.saveQuery({ id: 'q', name: '原查询', sql: 'SELECT 1', updatedAt: '2026-10-24T00:00:00.000Z' }); close(store);
    await rewrite(file, db => db.run('DROP TABLE import_presets; PRAGMA user_version=9')); const before = await otherTables(file);
    const migrated = await open(file); expect(migrated.importPresets().entries).toEqual([]); expect(await otherTables(file)).toEqual(before);
    const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
    try { expect(db.exec('PRAGMA user_version')[0].values).toEqual([[9]]); } finally { db.close(); }
  });
  it.each(['version', 'malformed', 'budget', 'configuration', 'rows', 'wrong-id'] as const)('损坏%s在任何迁移写盘前拒绝，原文件逐字节不变', async kind => {
    const { file, store } = await fixture(); close(store);
    await rewrite(file, db => {
      if (kind === 'wrong-id') { db.run('DROP TABLE import_presets; CREATE TABLE import_presets(id INTEGER,data TEXT)'); db.run('INSERT INTO import_presets VALUES(2,?)', [JSON.stringify({ version: 1, revision: 0, entries: [] })]); return; }
      const entry = { id: randomUUID(), name: '合成', configuration: configuration(), createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' };
      const document = { version: kind === 'version' ? 2 : 1, revision: 0, entries: kind === 'configuration' ? [{ ...entry, configuration: { ...configuration(), fileToken: '禁止' } }] : kind === 'rows' ? [{ ...entry, rows: ['禁止'] }] : [] };
      const raw = kind === 'malformed' ? '{' : JSON.stringify(document) + (kind === 'budget' ? ' '.repeat(importPresetLimits.documentBytes) : '');
      db.run('INSERT INTO import_presets VALUES(1,?)', [raw]);
    });
    const before = readFileSync(file); await expect(open(file)).rejects.toThrow(); expect(readFileSync(file).equals(before)).toBe(true);
  });
  it('第101项或文档总量越界拒绝，修订与原文件均不变', async () => {
    const { file, store } = await fixture(); close(store);
    const entries = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), name: '配置' + i, configuration: configuration(), createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' }));
    await rewrite(file, db => db.run('INSERT INTO import_presets VALUES(1,?)', [JSON.stringify({ version: 1, revision: 100, entries })]));
    const reopened = await open(file), current = reopened.importPresets(), before = readFileSync(file);
    expect(() => reopened.saveImportPreset({ ...packet(current), name: '第101项', configuration: configuration() })).toThrow(); expect(reopened.importPresets()).toEqual(current); expect(readFileSync(file).equals(before)).toBe(true);
  });
  it('完整文档写入超过4MiB时拒绝新增，既有大配置和原修订完整保留', async () => {
    const { file, store } = await fixture(); close(store);
    const columns = Array.from({ length: 16 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(3998));
    const large: ImportPresetConfiguration = { format: 'json', encoding: 'utf8', columns, mapping: Object.fromEntries(columns.map((column, i) => [column, 'c' + i])) };
    const entries = Array.from({ length: 32 }, (_, i) => ({ id: randomUUID(), name: '大配置' + i, configuration: large, createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' }));
    const raw = JSON.stringify({ version: 1, revision: 32, entries }); expect(Buffer.byteLength(raw)).toBeLessThan(importPresetLimits.documentBytes);
    await rewrite(file, db => db.run('INSERT INTO import_presets VALUES(1,?)', [raw]));
    const reopened = await open(file), current = reopened.importPresets(), before = readFileSync(file);
    expect(() => reopened.saveImportPreset({ ...packet(current), name: '越界新增', configuration: large })).toThrow('4 MiB');
    expect(reopened.importPresets()).toEqual(current); expect(readFileSync(file).equals(before)).toBe(true);
  });
});
