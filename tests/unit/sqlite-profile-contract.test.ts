import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, NetworkConnectionProfile, SqliteConnectionProfile } from '../../src/shared/contracts';
import { connectionSchema, validateCommand } from '../../src/shared/validation';
import { assertConnectionReady, copyConnectionProfile, exportedConnectionSchema, exportConnectionProfile, importConnectionProfile, importReplacementProfile } from '../../src/shared/connectionTransfer';
import { connectionTransportChanged } from '../../src/shared/connectionProfile';
import { tablePreferenceTargetChanged } from '../../src/shared/tablePreferences';
import { queryConnectionDigest } from '../../src/main/queryBinding';
import { tableDraftEndpointKey } from '../../src/main/tableDraftBinding';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import { connect } from '../../src/engine/connection';
import { Engine } from '../../src/engine';

const sqlite: SqliteConnectionProfile = { id: 'local-file', name: '本机文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\资料\\样本.sqlite', fileName: '样本.sqlite', fileToken: '本次选择令牌', readOnly: true, busyTimeoutMs: 5000 } };
const network: NetworkConnectionProfile = { id: 'network', name: '网络连接', group: '', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'user' };

describe('SQLite连接合同', () => {
  it('严格区分文件配置和网络配置，跨分支字段及非法超时均拒绝', () => {
    expect(connectionSchema.parse(sqlite)).toEqual(sqlite);
    for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls', 'database']) expect(connectionSchema.safeParse({ ...sqlite, [field]: field === 'port' ? 3306 : '夹带字段' }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...network, sqlite: sqlite.sqlite }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...network, pendingFiles: ['sqliteDatabase'] }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...sqlite, pendingFiles: ['tlsCa'] }).success).toBe(false);
    for (const busyTimeoutMs of [-1, 1.5, 5001, Infinity]) expect(connectionSchema.safeParse({ ...sqlite, sqlite: { ...sqlite.sqlite, busyTimeoutMs } }).success).toBe(false);
    expect(validateCommand('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: sqlite.id })).toEqual({ purpose: 'sqlite-database', sqliteConnectionId: sqlite.id });
  });

  it('交换与复制只保留basename、只读和超时，任何导入都必须重新选择文件', () => {
    const exported = exportConnectionProfile(sqlite);
    expect(exported).toEqual({ id: sqlite.id, name: sqlite.name, group: '', color: sqlite.color, dialect: 'sqlite', sqlite: { fileName: '样本.sqlite', readOnly: true, busyTimeoutMs: 5000 } });
    expect(JSON.stringify(exported)).not.toContain('资料');
    for (const profile of [importConnectionProfile(exported, '新连接'), copyConnectionProfile(sqlite), importReplacementProfile(exported, exported)]) {
      expect(profile).toMatchObject({ dialect: 'sqlite', sqlite: { fileName: '样本.sqlite', readOnly: true, busyTimeoutMs: 5000 }, pendingFiles: ['sqliteDatabase'] });
      expect(profile).not.toHaveProperty('sqlite.filePath'); expect(profile).not.toHaveProperty('sqlite.fileToken');
      expect(() => assertConnectionReady(profile)).toThrow('重新选择');
    }
    for (const invalid of [{ ...exported, host: 'offline.invalid' }, { ...exported, sqlite: { ...exported.sqlite, filePath: sqlite.sqlite.filePath } }, { ...exported, sqlite: { ...exported.sqlite, fileToken: '令牌' } }, { ...exported, sqlite: { ...exported.sqlite, fileName: '../样本.sqlite' } }]) expect(exportedConnectionSchema.safeParse(invalid).success).toBe(false);
    expect(() => importReplacementProfile(exported, exportConnectionProfile(network))).toThrow('另建连接');
  });

  it('文件、模式和超时都改变路由及来源摘要，显示名和临时令牌不改变身份', () => {
    const changed = [
      { ...sqlite, sqlite: { ...sqlite.sqlite, filePath: 'D:\\资料\\另一份.sqlite' } },
      { ...sqlite, sqlite: { ...sqlite.sqlite, readOnly: false } },
      { ...sqlite, sqlite: { ...sqlite.sqlite, busyTimeoutMs: 1000 } },
    ];
    for (const profile of changed) {
      expect(connectionTransportChanged(sqlite, profile)).toBe(true);
      expect(tablePreferenceTargetChanged(sqlite, profile)).toBe(true);
      expect(queryConnectionDigest(profile)).not.toBe(queryConnectionDigest(sqlite));
      expect(tableDraftEndpointKey(profile)).not.toBe(tableDraftEndpointKey(sqlite));
    }
    const renamed = { ...sqlite, name: '另一显示名', sqlite: { ...sqlite.sqlite, fileName: '文件提示', fileToken: '下一次令牌' } };
    expect(connectionTransportChanged(sqlite, renamed)).toBe(false);
    expect(queryConnectionDigest(renamed)).toBe(queryConnectionDigest(sqlite));
    expect(() => assertConnectionReady(sqlite)).not.toThrow();
  });

  it('已有ID不能改方言，SQLite目标变化仍经过执行屏障', async () => {
    const saveConnection = vi.fn((profile: ConnectionProfile) => profile), request = vi.fn();
    const manager = new ConnectionConfigManager({ connections: () => [sqlite], resolveConnection: (_id, overrides) => overrides!, saveConnection, connectionRevision: () => 1, settings: () => ({ theme: 'dark', sidebarWidth: 200, resultLimit: 1000, pageSize: 100, tabs: [] }) }, { request });
    await expect(manager.save({ ...network, id: sqlite.id })).rejects.toThrow('另建连接');
    expect(request).not.toHaveBeenCalled(); expect(saveConnection).not.toHaveBeenCalled();
    const changed = { ...sqlite, sqlite: { ...sqlite.sqlite, readOnly: false } };
    await expect(manager.save(changed)).resolves.toEqual(changed);
    expect(request).toHaveBeenCalledWith('__connections.prepareSave', { id: sqlite.id, profile: changed, transportChanged: true });
  });

  it('网络驱动和网络执行入口都在分配连接前拒绝SQLite', async () => {
    await expect(connect(sqlite)).rejects.toThrow('不能交给MySQL');
    const engine = new Engine();
    await expect(engine.handle('connections.open', { id: sqlite.id, profile: sqlite })).rejects.toThrow('不能交给MySQL');
    // 内部保存屏障只检查与删除旧网络缓存，接受文件身份也不建立网络连接。
    await expect(engine.handle('__connections.prepareSave', { id: sqlite.id, profile: sqlite, transportChanged: true })).resolves.toBeUndefined();
    await expect(engine.handle('sessions.open', { connectionId: sqlite.id })).rejects.toThrow('请先打开数据库连接');
  });

  it('Main授权在执行屏障后失效时不落盘，并释放原保存锁', async () => {
    let current = true;
    const saveConnection = vi.fn((profile: ConnectionProfile) => profile), request = vi.fn().mockImplementation(async () => { current = false; });
    const manager = new ConnectionConfigManager({ connections: () => [sqlite], resolveConnection: (_id, overrides) => overrides!, saveConnection, connectionRevision: () => 1, settings: () => ({ theme: 'dark', sidebarWidth: 200, resultLimit: 1000, pageSize: 100, tabs: [] }) }, { request });
    const assertCurrent = vi.fn(() => { if (!current) throw new Error('文件授权已失效'); });
    await expect(manager.save({ ...sqlite, sqlite: { ...sqlite.sqlite, readOnly: false } }, assertCurrent)).rejects.toThrow('文件授权已失效');
    expect(assertCurrent).toHaveBeenCalledTimes(3); expect(saveConnection).not.toHaveBeenCalled();
    expect(() => manager.assertAvailable(sqlite.id)).not.toThrow();
  });

  it('显示项直接保存仍在落盘前复核Main授权，开始就失效时不读取存储', async () => {
    let current = true;
    const connections = vi.fn(() => { current = false; return [sqlite]; }), saveConnection = vi.fn((profile: ConnectionProfile) => profile), request = vi.fn();
    const manager = new ConnectionConfigManager({ connections, resolveConnection: (_id, overrides) => overrides!, saveConnection, connectionRevision: () => 1, settings: () => ({ theme: 'dark', sidebarWidth: 200, resultLimit: 1000, pageSize: 100, tabs: [] }) }, { request });
    const assertCurrent = () => { if (!current) throw new Error('原文档已失效'); };
    await expect(manager.save({ ...sqlite, name: '新名称' }, assertCurrent)).rejects.toThrow('原文档已失效');
    expect(saveConnection).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    connections.mockClear();
    await expect(manager.save(sqlite, assertCurrent)).rejects.toThrow('原文档已失效');
    expect(connections).not.toHaveBeenCalled();
  });
});
