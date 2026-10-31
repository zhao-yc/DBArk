import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import type { NetworkConnectionProfile, SqliteConnectionProfile } from '../../src/shared/contracts';
import { exportConnectionProfile } from '../../src/shared/connectionTransfer';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const profile: SqliteConnectionProfile = { id: 'sqlite-file', name: '文件连接', group: '本机', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\资料\\本地.sqlite', fileName: '本地.sqlite', fileToken: '只能使用本次的令牌', readOnly: true, busyTimeoutMs: 1000 } };
const network: NetworkConnectionProfile = { id: 'mysql', name: '旧网络连接', group: '', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'user', password: '测试秘密', rememberPassword: true };
const protector = { available: vi.fn(() => true), encrypt: vi.fn((value: string) => Buffer.from(value).toString('base64')), decrypt: vi.fn((value: string) => Buffer.from(value, 'base64').toString()) };
let folder: string, path: string, store: LocalStore;

/** 每例独占真实配置库，数据库目标路径只作配置文本，绝不打开用户文件。 */
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dbark-sqlite-profile-')); path = join(folder, 'config.sqlite');
  store = await LocalStore.open(path, wasm, protector); vi.clearAllMocks();
});

/** 验证唯一临时目录归属后清理，拒绝链接或父目录被替换。 */
afterEach(() => {
  store.close(); const resolved = resolve(folder), stat = lstatSync(resolved);
  if (dirname(resolved) !== resolve(tmpdir()) || !/^dbark-sqlite-profile-[a-zA-Z0-9]+$/.test(basename(resolved)) || stat.isSymbolicLink() || !stat.isDirectory() || dirname(realpathSync(resolved)) !== realpathSync(tmpdir())) throw new Error('拒绝清理非本例临时目录');
  rmSync(resolved, { recursive: true, force: true });
});

describe('SQLite连接配置持久化', () => {
  it('与网络连接保存在原connections表，SQLite不触碰凭据且永久剥除令牌', async () => {
    store.saveConnection(network); vi.clearAllMocks();
    const saved = store.saveConnection(profile);
    expect(saved).toEqual({ ...profile, sqlite: { filePath: profile.sqlite.filePath, fileName: '本地.sqlite', readOnly: true, busyTimeoutMs: 1000 } });
    expect(saved).not.toHaveProperty('hasPassword'); expect(saved).not.toHaveProperty('ssh'); expect(saved).not.toHaveProperty('tls');
    expect(store.resolveConnection(profile.id)).toEqual(saved);
    expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled();
    expect(profile.sqlite.fileToken).toBe('只能使用本次的令牌');
    const SQL = await initSqlJs({ locateFile: () => wasm }), database = new SQL.Database(readFileSync(path));
    try {
      const persisted = database.exec("SELECT data FROM connections WHERE id='sqlite-file'")[0].values[0][0];
      expect(String(persisted)).not.toContain('fileToken');
      expect(database.exec("SELECT count(*) FROM secrets WHERE connection_id='sqlite-file'")[0].values[0][0]).toBe(0);
      expect(database.exec('PRAGMA user_version')[0].values[0][0]).toBe(9);
    } finally { database.close(); }
    store.close(); store = await LocalStore.open(path, wasm, protector);
    expect(store.resolveConnection(profile.id)).toEqual(saved);
    expect(protector.decrypt).not.toHaveBeenCalled();
    const restored = store.resolveConnection(network.id);
    expect(restored.dialect).toBe('mysql');
    if (restored.dialect === 'sqlite') throw new Error('旧连接方言被改写');
    expect(restored.password).toBe(network.password);
  });

  it('导入只暂存文件提示，重新启动仍不得带入生效路径或令牌', async () => {
    const exported = exportConnectionProfile(profile);
    expect(() => store.importConnections([exported], false)).toThrow('明确确认暂存');
    const [imported] = store.importConnections([exported], true);
    expect(imported).toMatchObject({ dialect: 'sqlite', sqlite: { fileName: '本地.sqlite', readOnly: true, busyTimeoutMs: 1000 }, pendingFiles: ['sqliteDatabase'] });
    expect(imported).not.toHaveProperty('sqlite.filePath'); expect(imported).not.toHaveProperty('sqlite.fileToken');
    store.close(); store = await LocalStore.open(path, wasm, protector);
    expect(store.resolveConnection(imported.id)).toEqual(imported);
    expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled();
  });

  it('拒绝SQLite与网络同ID切换，保留MySQL和MariaDB之间原支持范围', () => {
    store.saveConnection(profile);
    expect(() => store.saveConnection({ ...network, id: profile.id })).toThrow('另建连接');
    store.saveConnection(network);
    expect(() => store.saveConnection({ ...profile, id: network.id })).toThrow('另建连接');
    expect(store.saveConnection({ ...network, dialect: 'mariadb' }).dialect).toBe('mariadb');
  });
});
