import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';

const require = createRequire(import.meta.url);
const profile: ConnectionProfile = { id: 'guarded', name: '原连接', group: '', color: '#abcdef', dialect: 'mysql', host: 'old.example', port: 3306, user: 'user', password: '数据库秘密', ssh: { enabled: true, host: 'jump.example', port: 22, user: 'ssh', password: 'SSH秘密', passphrase: '私钥口令' } };
let folder: string, path: string, store: LocalStore, manager: ConnectionConfigManager;
const request = vi.fn();

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dbark-config-')); path = join(folder, 'config.sqlite');
  store = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: () => '', decrypt: value => value });
  store.saveConnection(profile); request.mockReset().mockResolvedValue(undefined);
  manager = new ConnectionConfigManager(store, { request });
});
afterEach(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });

describe('连接配置保存的进程与磁盘边界', () => {
  it('显示项直接保存，未重填的数据库和SSH秘密保持，现有任务不受打扰', async () => {
    await manager.save({ ...store.connections().map(assertNetworkProfile)[0], name: '新名称', rememberPassword: false });
    expect(request).not.toHaveBeenCalled(); expect(assertNetworkProfile(store.resolveConnection(profile.id)).password).toBe(profile.password);
    expect(assertNetworkProfile(store.resolveConnection(profile.id)).ssh?.password).toBe(profile.ssh?.password); expect(assertNetworkProfile(store.resolveConnection(profile.id)).ssh?.passphrase).toBe(profile.ssh?.passphrase);
  });
  it('引擎拒绝敏感保存时磁盘及凭据保持原样，不发送取消或关闭命令', async () => {
    request.mockRejectedValueOnce(new Error('仍有打开会话'));
    await expect(manager.save({ ...store.connections().map(assertNetworkProfile)[0], host: 'new.example', password: '不能落盘' })).rejects.toThrow('仍有打开会话');
    expect(assertNetworkProfile(store.resolveConnection(profile.id))).toMatchObject({ host: profile.host, password: profile.password });
    expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave']); expect(() => manager.assertAvailable(profile.id)).not.toThrow();
  });
  it('跨进程检查等待期间阻止新请求和同连接二次保存，之后才提交新配置', async () => {
    let finish!: () => void; request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const input = { ...store.connections().map(assertNetworkProfile)[0], host: 'new.example' }, saving = manager.save(input);
    expect(assertNetworkProfile(store.resolveConnection(profile.id)).host).toBe('old.example'); expect(() => manager.assertAvailable(profile.id)).toThrow('正在保存');
    expect(() => manager.assertAvailable('another')).not.toThrow(); await expect(manager.save(input)).rejects.toThrow('正在保存');
    finish(); await saving;
    expect(assertNetworkProfile(store.resolveConnection(profile.id)).host).toBe('new.example'); expect(() => manager.assertAvailable(profile.id)).not.toThrow();
  });
  it('磁盘提交失败恢复旧配置和秘密并释放保存锁，可用旧配置重新打开', async () => {
    mkdirSync(`${path}.tmp`);
    await expect(manager.save({ ...store.connections().map(assertNetworkProfile)[0], host: 'new.example', password: '不能落盘' })).rejects.toThrow('修改未保存');
    expect(request).toHaveBeenCalledOnce(); expect(assertNetworkProfile(store.resolveConnection(profile.id))).toMatchObject({ host: 'old.example', password: profile.password });
    expect(() => manager.assertAvailable(profile.id)).not.toThrow();
  });
  it('显式清除三种秘密先通过引擎检查再保存，没有把空串误当保留', async () => {
    const saved = store.connections().map(assertNetworkProfile)[0];
    await manager.save({ ...saved, password: '', ssh: { ...saved.ssh!, password: '', passphrase: '' } });
    expect(request.mock.calls[0][1].profile).toMatchObject({ password: '', ssh: { password: '', passphrase: '' } });
    const resolved = assertNetworkProfile(store.resolveConnection(profile.id));
    expect(resolved.password).toBeUndefined(); expect(resolved.ssh?.password).toBeUndefined(); expect(resolved.ssh?.passphrase).toBeUndefined();
  });
  it('迁移系统后旧密文无法解密，仍能显式填写新密码修复连接', async () => {
    store.close();
    const oldCipher = Buffer.from(profile.password!).toString('base64');
    store = await LocalStore.open(`${path}.repair`, require.resolve('sql.js/dist/sql-wasm.wasm'), {
      available: () => true, encrypt: value => Buffer.from(value).toString('base64'),
      decrypt: value => { if (value === oldCipher) throw new Error('旧系统密文不可解密'); return Buffer.from(value, 'base64').toString(); },
    });
    store.saveConnection({ ...profile, ssh: undefined, rememberPassword: true });
    expect(() => assertNetworkProfile(store.resolveConnection(profile.id))).toThrow('无法解密');
    manager = new ConnectionConfigManager(store, { request });
    await manager.save({ ...store.connections().map(assertNetworkProfile)[0], password: '新系统的新密码' });
    expect(assertNetworkProfile(store.resolveConnection(profile.id)).password).toBe('新系统的新密码');
    expect(request.mock.calls[0][1].profile.password).toBe('新系统的新密码');
  });
});
