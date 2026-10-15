import { afterEach, describe, expect, it } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { tablePreferenceBytes, tablePreferencesLimits, tablePreferenceTargetChanged, type TablePreferences } from '../../src/shared/tablePreferences';
import type { ConnectionProfile } from '../../src/shared/contracts';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString() };
const directories: string[] = [];
const profile: ConnectionProfile = { id: '连接', name: '离线', group: '', color: '#abcdef', host: '127.0.0.1', port: 1, user: 'offline', dialect: 'mysql', password: '只在凭据保护器中保存', rememberPassword: true };
const target = { connectionId: profile.id, database: '库', table: '表' };
const preferences: TablePreferences = { version: 1, columns: [{ name: '__proto__', hidden: false, width: 200 }, { name: 'constructor', hidden: true }, { name: '主键', hidden: true, width: 64 }] };
/** 每例只使用自己创建的配置库，完全离线，不打开业务数据库。 */
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-table-preferences-')); directories.push(directory);
  const file = join(directory, 'local.sqlite'); const store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile);
  return { file, store };
}
/** 直接准备历史或满额 SQLite 文件，避免数百次无意义重复写盘。 */
async function editDatabase(file: string, action: (db: initSqlJs.Database) => void) {
  const SQL = await initSqlJs({ locateFile: () => wasm }); const db = new SQL.Database(readFileSync(file));
  try { action(db); writeFileSync(file, db.export()); } finally { db.close(); }
}
/** Windows 路径比较忽略大小写，真实路径核验仍拒绝本例目录被链接替换。 */
function samePath(left: string, right: string): boolean { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right; }
/** 递归删除前同时核验词法路径和真实父目录，且只接受本例创建的普通目录。 */
function verifyTemporaryDirectory(directory: string): string {
  const absolute = resolve(directory), temporaryRoot = realpathSync(tmpdir());
  if (!directories.includes(directory) || !/^dbark-table-preferences-[a-zA-Z0-9]+$/.test(basename(absolute)) || !samePath(dirname(absolute), resolve(tmpdir()))) throw new Error('拒绝清理非本例临时目录');
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(realpathSync(dirname(absolute)), temporaryRoot) || !samePath(dirname(realpathSync(absolute)), temporaryRoot)) throw new Error('拒绝清理链接或临时父目录以外的路径');
  return absolute;
}
/** 故障阻挡目录必须是本例 local.sqlite.tmp；空目录使用非递归删除。 */
function removeWriteBlocker(file: string): void {
  const directory = verifyTemporaryDirectory(dirname(file));
  const expected = join(directory, 'local.sqlite.tmp'), blocker = resolve(`${file}.tmp`);
  if (!samePath(resolve(file), join(directory, 'local.sqlite')) || !samePath(blocker, expected)) throw new Error('拒绝清理非本例写盘阻挡目录');
  const info = lstatSync(blocker);
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(realpathSync(blocker), join(realpathSync(directory), 'local.sqlite.tmp'))) throw new Error('拒绝清理被链接替换的写盘阻挡目录');
  rmdirSync(blocker);
}
afterEach(() => { for (const directory of directories) rmSync(verifyTemporaryDirectory(directory), { recursive: true, force: true }); directories.length = 0; });

describe('表布局本地持久化', () => {
  it('精确复合身份和原型列名跨重启保持，工作区快照不能覆盖布局', async () => {
    const { file, store } = await setup(); store.saveConnection({ ...profile, id: '另一连接' });
    const targets = [target, { ...target, connectionId: '另一连接' }, { ...target, database: '库.a', table: 'b' }, { ...target, database: '库', table: 'a.b' }, { ...target, table: 'Case' }, { ...target, table: 'case' }, { ...target, database: 'x\0y', table: "表');DELETE FROM connections;--" }];
    const settings = store.settings();
    targets.forEach((value, index) => store.saveTablePreferences({ ...value, preferences: { ...preferences, columns: [...preferences.columns, { name: `位置${index}`, hidden: false }] } }));
    store.saveSettings({ ...settings, theme: 'light' }); expect(store.settings()).not.toHaveProperty('tablePreferences'); store.close();
    const restored = await LocalStore.open(file, wasm, protector);
    targets.forEach((value, index) => expect(restored.tablePreferences(value)?.columns.at(-1)?.name).toBe(`位置${index}`));
    expect(restored.tablePreferences(target)?.columns.slice(0, 3)).toEqual(preferences.columns); expect(restored.connections()).toHaveLength(2);
    expect(restored.settings().theme).toBe('light'); expect(restored.history()).toEqual([]); expect(restored.tasks()).toEqual([]);
    restored.resetTablePreferences(target); expect(restored.tablePreferences(target)).toBeNull(); expect(restored.tablePreferences(targets[1])).not.toBeNull(); restored.close();
  });
  it('未知连接的读取、保存和重置都拒绝，既有连接空表可幂等重置', async () => {
    const { store } = await setup(); const missing = { ...target, connectionId: '不存在' };
    expect(() => store.tablePreferences(missing)).toThrow('连接不存在'); expect(() => store.saveTablePreferences({ ...missing, preferences })).toThrow('连接不存在'); expect(() => store.resetTablePreferences(missing)).toThrow('连接不存在');
    expect(store.tablePreferences(target)).toBeNull(); store.resetTablePreferences(target); store.resetTablePreferences(target); store.close();
  });
  it('IPC 和直接存储均拒绝数据字段、重复列、非法宽度和序列化单条超限', async () => {
    const { store } = await setup(); expect(publicCommands['table.preferences.save']).toBe(true);
    expect(validateCommand('table.preferences.save', { ...target, preferences })).toEqual({ ...target, preferences });
    const invalid = [
      { ...preferences, filters: [{ value: '不要保存的筛选值' }] },
      { ...preferences, columns: [{ name: '值', hidden: false, value: '不要保存的行值' }] },
      { ...preferences, columns: [{ name: '值', hidden: false }, { name: '值', hidden: true }] },
      ...[63, 2001, 80.5, Infinity, NaN].map(width => ({ ...preferences, columns: [{ name: '值', hidden: false, width }] })),
      { ...preferences, columns: Array.from({ length: 4097 }, (_, index) => ({ name: String(index), hidden: false })) },
      { ...preferences, columns: Array.from({ length: 4096 }, (_, index) => ({ name: '中'.repeat(100) + index, hidden: false })) },
    ];
    for (const value of invalid) {
      const input = { ...target, preferences: value };
      expect(() => validateCommand('table.preferences.save', input)).toThrow();
      expect(() => store.saveTablePreferences(input)).toThrow();
    }
    expect(() => validateCommand('table.preferences.save', { ...target, preferences, sql: '不该执行' })).toThrow();
    expect(store.tablePreferences(target)).toBeNull(); store.close();
  });
  it('500 条 SQLite 满额按目标更新，新增被拒绝且不修改磁盘', async () => {
    const { file, store } = await setup(); store.close();
    await editDatabase(file, db => { for (let index = 0; index < 500; index++) db.run('INSERT INTO table_preferences VALUES (?,?,?,?)', [profile.id, target.database, String(index), JSON.stringify(preferences)]); });
    const full = await LocalStore.open(file, wasm, protector), before = readFileSync(file);
    expect(() => full.saveTablePreferences({ ...target, preferences })).toThrow('500'); expect(readFileSync(file).equals(before)).toBe(true);
    full.saveTablePreferences({ ...target, table: '0', preferences: { version: 1, columns: [] } }); expect(full.tablePreferences({ ...target, table: '0' })?.columns).toEqual([]);
    full.resetTablePreferences({ ...target, table: '1' }); full.saveTablePreferences({ ...target, preferences }); full.close();
  });
  it('真实 SQLite 聚合按 UTF-8 字节限总量，缩小旧记录后可保存新记录', async () => {
    const { file, store } = await setup(); store.close();
    const large: TablePreferences = { version: 1, columns: Array.from({ length: 2000 }, (_, index) => ({ name: '中'.repeat(60) + index, hidden: false, width: 200 })) };
    const one = tablePreferenceBytes(target, large); expect(one).toBeLessThan(tablePreferencesLimits.entryBytes);
    await editDatabase(file, db => { let total = 0; for (let index = 0; ; index++) { const item = { ...target, table: String(index) }; const size = tablePreferenceBytes(item, large); if (total + size > tablePreferencesLimits.totalBytes) break; db.run('INSERT INTO table_preferences VALUES (?,?,?,?)', [item.connectionId, item.database, item.table, JSON.stringify(large)]); total += size; } });
    const full = await LocalStore.open(file, wasm, protector), before = readFileSync(file);
    expect(() => full.saveTablePreferences({ ...target, preferences: large })).toThrow('8 MiB'); expect(readFileSync(file).equals(before)).toBe(true);
    full.saveTablePreferences({ ...target, table: '0', preferences }); full.saveTablePreferences({ ...target, preferences: large }); expect(full.tablePreferences(target)).toEqual(large); full.close();
  });
  it('布局保存、重置、连接删除和目标更换失败均恢复原磁盘、原凭据及原布局', async () => {
    const { file, store } = await setup(); store.saveTablePreferences({ ...target, preferences }); const before = readFileSync(file); mkdirSync(`${file}.tmp`);
    expect(() => store.saveTablePreferences({ ...target, preferences: { version: 1, columns: [] } })).toThrow('修改未保存');
    expect(() => store.resetTablePreferences(target)).toThrow('修改未保存'); expect(() => store.deleteConnection(profile.id)).toThrow('修改未保存');
    expect(() => store.saveConnection({ ...profile, host: '新目标', password: '未保存的秘密' })).toThrow('修改未保存');
    expect(store.tablePreferences(target)).toEqual(preferences); expect(store.resolveConnection(profile.id).password).toBe(profile.password); expect(readFileSync(file).equals(before)).toBe(true);
    removeWriteBlocker(file); store.saveSettings({ ...store.settings(), theme: 'light' }); store.close();
    const restored = await LocalStore.open(file, wasm, protector); expect(restored.tablePreferences(target)).toEqual(preferences); expect(restored.connections()[0].host).toBe(profile.host); restored.close();
  });
  it('目标变化清理当前连接全部布局，认证和外观变化保留，新 ID 不继承', async () => {
    const { store } = await setup(); store.saveTablePreferences({ ...target, preferences }); store.saveTablePreferences({ ...target, table: '第二表', preferences });
    store.saveConnection({ ...profile, name: '重命名', group: '新组', color: '#123456', database: '默认库', password: '轮换密码', tls: { enabled: true, rejectUnauthorized: true, caPath: '新证书路径' } });
    expect(store.tablePreferences(target)).toEqual(preferences);
    store.saveConnection({ ...profile, id: '复制连接' }); expect(store.tablePreferences({ ...target, connectionId: '复制连接' })).toBeNull();
    store.saveTablePreferences({ ...target, connectionId: '复制连接', preferences });
    store.saveConnection({ ...profile, host: '另一台服务器' }); expect(store.tablePreferences(target)).toBeNull(); expect(store.tablePreferences({ ...target, table: '第二表' })).toBeNull();
    expect(store.tablePreferences({ ...target, connectionId: '复制连接' })).toEqual(preferences);
    store.deleteConnection('复制连接'); store.saveConnection({ ...profile, id: '复制连接' }); expect(store.tablePreferences({ ...target, connectionId: '复制连接' })).toBeNull(); store.close();
  });
  it('目标比较涵盖端口、账号、驱动、SSH 目标和主机身份，忽略禁用 SSH 的残留字段', () => {
    for (const change of [{ host: '不同主机' }, { port: 2 }, { user: '另一账号' }, { dialect: 'mariadb' as const }]) expect(tablePreferenceTargetChanged(profile, { ...profile, ...change })).toBe(true);
    const tunneled: ConnectionProfile = { ...profile, ssh: { enabled: true, host: 'jump', port: 22, user: 'ssh-user', privateKeyPath: '旧路径', hostFingerprint: 'SHA256:旧身份' } };
    expect(tablePreferenceTargetChanged(profile, tunneled)).toBe(true);
    for (const change of [{ host: '另一个跳板' }, { port: 2222 }, { user: '另一SSH账号' }, { hostFingerprint: 'SHA256:另一身份' }]) expect(tablePreferenceTargetChanged(tunneled, { ...tunneled, ssh: { ...tunneled.ssh!, ...change } })).toBe(true);
    expect(tablePreferenceTargetChanged(tunneled, { ...tunneled, ssh: { ...tunneled.ssh!, password: '新密码', passphrase: '新短语', privateKeyPath: '新路径' } })).toBe(false);
    expect(tablePreferenceTargetChanged(profile, { ...tunneled, ssh: { ...tunneled.ssh!, enabled: false } })).toBe(false);
  });
  it('schema2 迁移原样保留配置、凭据、查询、片段和设置，失败后原文件仍可重试', async () => {
    const { file, store } = await setup(); store.saveQuery({ id: '查询', name: '查询', sql: 'SELECT 7', updatedAt: '' }); store.saveSnippet({ id: '片段', name: '片段', group: '', description: '', sql: 'SELECT 8', updatedAt: '' }); store.saveSettings({ ...store.settings(), theme: 'light' });
    store.addHistory({ id: '历史', connectionId: profile.id, sql: 'SELECT 9', startedAt: '2026-10-14', elapsedMs: 3, success: true }); store.saveTask({ id: '任务', kind: 'query.execute', status: 'completed', progress: 100, message: '已完成', startedAt: '2026-10-14' }); store.close();
    await editDatabase(file, db => db.run('DROP TABLE table_preferences; PRAGMA user_version=2'));
    const SQL = await initSqlJs({ locateFile: () => wasm });
    /** 比较实际旧表中的全部字段，不能只凭某几个 UI 字段推断迁移无损。 */
    const snapshot = () => { const database = new SQL.Database(readFileSync(file)); try { return ['connections', 'secrets', 'queries', 'sql_snippets', 'history', 'tasks', 'settings'].map(table => database.exec(`SELECT * FROM ${table} ORDER BY rowid`)); } finally { database.close(); } };
    const oldRows = snapshot();
    const before = readFileSync(file); mkdirSync(`${file}.tmp`);
    await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow('修改未保存'); expect(readFileSync(file).equals(before)).toBe(true); removeWriteBlocker(file);
    const restored = await LocalStore.open(file, wasm, protector); expect(restored.resolveConnection(profile.id).password).toBe(profile.password); expect(restored.queries()[0].sql).toBe('SELECT 7'); expect(restored.snippets()[0].sql).toBe('SELECT 8'); expect(restored.settings().theme).toBe('light'); expect(restored.tablePreferences(target)).toBeNull(); restored.close();
    expect(snapshot()).toEqual(oldRows);
    const db = new SQL.Database(readFileSync(file)); expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(5); db.close();
  });
});
