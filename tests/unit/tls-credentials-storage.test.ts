import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../../src/main/storage';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import type { ConnectionProfile } from '../../src/shared/contracts';

const require = createRequire(import.meta.url), folders: string[] = [], stores = new Set<LocalStore>();
const profile: ConnectionProfile = { id: 'tls', name: '独立口令槽', group: '', color: '#123456', host: 'db.invalid', port: 3306, user: 'test', dialect: 'mysql', rememberPassword: true, password: '数据库测试秘密', ssh: { enabled: false, host: '', port: 22, user: '', passphrase: 'SSH独立测试口令' }, tls: { enabled: true, rejectUnauthorized: true } };

/** 真实SQLite配合进程内临时AES保护器；不冒充Electron系统凭据加密验收。 */
async function fixture(available = true) {
  const folder = mkdtempSync(join(tmpdir(), 'dbark-tls-credential-')); folders.push(folder); const path = join(folder, 'test.sqlite'), key = randomBytes(32);
  const protector = { available: () => available,
    encrypt(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); },
    decrypt(value: string) { const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'); }
  };
  const reopen = async () => { const store = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector); stores.add(store); return store; };
  const close = (store: LocalStore) => { store.close(); stores.delete(store); };
  return { store: await reopen(), path, protector, reopen, close };
}
/** 直接读取真实SQLite行，区分profile概要与秘密槽；不将秘密或密钥写日志。 */
async function persisted(path: string) {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }), db = new SQL.Database(readFileSync(path));
  try { return { data: db.exec('SELECT data FROM connections')[0]?.values.map(row => String(row[0])) ?? [], names: db.exec('SELECT name FROM secrets')[0]?.values.flat().map(String) ?? [] }; }
  finally { db.close(); }
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe('TLS私钥口令独立槽与兼容保存', () => {
  it('密文与概要分离，TLS与SSH口令独立，重启仅恢复系统保护器可读秘密', async () => {
    const f = await fixture(), phrase = '  中文TLS测试口令  ';
    const saved = f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: phrase, hasPassphrase: false } });
    expect(saved.tls?.hasPassphrase).toBe(true); expect(saved.tls?.passphrase).toBeUndefined();
    expect(f.store.resolveConnection(profile.id).tls?.passphrase === phrase).toBe(true); expect(f.store.resolveConnection(profile.id).ssh?.passphrase).toBe(profile.ssh?.passphrase);
    const disk = await persisted(f.path); expect(disk.names.sort()).toEqual(['password', 'sshPassphrase', 'tlsPassphrase']);
    expect(disk.data.some(value => value.includes(phrase) || value.includes('hasPassphrase') || value.includes('passphrase'))).toBe(false); expect(readFileSync(f.path).includes(Buffer.from(phrase))).toBe(false);
    expect(f.store.history()).toEqual([]); expect(f.store.tasks()).toEqual([]); f.close(f.store);
    const restored = await f.reopen(); expect(restored.resolveConnection(profile.id).tls?.passphrase === phrase).toBe(true);
  });
  it('旧TLS配置不增加伪已存标记，缺省保留与显式空值清除不影响其它秘密', async () => {
    const f = await fixture(); const legacy = f.store.saveConnection(profile); expect(legacy.tls).toEqual(profile.tls);
    const saved = f.store.saveConnection({ ...legacy, tls: { ...legacy.tls!, passphrase: 'TLS仅此槽' } });
    f.store.saveConnection({ ...saved, name: '只改名称', tls: { ...saved.tls!, hasPassphrase: false } }); expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBe('TLS仅此槽');
    const cleared = f.store.saveConnection({ ...f.store.connections()[0], tls: { ...profile.tls!, passphrase: '' } });
    expect(cleared.tls?.hasPassphrase ?? false).toBe(false); expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBeUndefined();
    expect(f.store.resolveConnection(profile.id).password).toBe(profile.password); expect(f.store.resolveConnection(profile.id).ssh?.passphrase).toBe(profile.ssh?.passphrase);
    f.close(f.store); expect((await f.reopen()).resolveConnection(profile.id).tls?.passphrase).toBeUndefined();
  });
  it.each([false, true])('系统加密可用=%s时关闭记住或不可用只保留会话内TLS口令', async available => {
    const f = await fixture(available), saved = f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: '会话TLS测试口令' } });
    if (available) f.store.saveConnection({ ...saved, rememberPassword: false });
    expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBe('会话TLS测试口令'); expect((await persisted(f.path)).names).not.toContain('tlsPassphrase');
    f.close(f.store); const restored = await f.reopen(); expect(restored.resolveConnection(profile.id).tls?.passphrase).toBeUndefined(); expect(restored.connections()[0].tls?.hasPassphrase ?? false).toBe(false);
  });
  it('磁盘写入失败回滚TLS槽，后续保存及重启不夹带失败口令', async () => {
    const f = await fixture(), original = '原TLS测试口令'; const saved = f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: original } });
    mkdirSync(f.path + '.tmp'); expect(() => f.store.saveConnection({ ...saved, tls: { ...saved.tls!, passphrase: '不得夹带的新口令' } })).toThrow('修改未保存');
    expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBe(original); rmSync(f.path + '.tmp', { recursive: true });
    f.store.saveSettings(f.store.settings()); f.close(f.store); expect((await f.reopen()).resolveConnection(profile.id).tls?.passphrase).toBe(original);
  });
  it('保护器异常不回显TLS口令，也不把失败值落入profile或已有槽', async () => {
    const f = await fixture(); f.store.saveConnection(profile); const secret = '不得出现在错误的TLS测试值'; const original = f.protector.encrypt;
    f.protector.encrypt = value => { if (value === secret) throw new Error(secret); return original(value); };
    let message = ''; try { f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: secret } }); } catch (error) { message = String(error); }
    expect(message).toContain('TLS 私钥口令加密保存失败'); expect(message.includes(secret)).toBe(false); expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBeUndefined();
  });
  it('TLS口令重填和清除经过原引擎保存保护，拒绝时保留旧值，缺省显示修改不重连', async () => {
    const f = await fixture(); f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: '原TLS测试值' } });
    const request = vi.fn(async (_command: string, _input?: unknown) => undefined), manager = new ConnectionConfigManager(f.store, { request });
    await manager.save({ ...f.store.connections()[0], name: '展示名称' }); expect(request).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(Error('仍有原会话')); await expect(manager.save({ ...f.store.connections()[0], tls: { ...profile.tls!, passphrase: '新TLS测试值' } })).rejects.toThrow('仍有原会话');
    expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBe('原TLS测试值');
    await manager.save({ ...f.store.connections()[0], tls: { ...profile.tls!, passphrase: '' } }); expect(request.mock.calls.map(call => call[0])).toEqual(['__connections.prepareSave', '__connections.prepareSave']); expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBeUndefined();
  });
  it('删除连接清除独立TLS槽；直接存储入口同样拒绝越界秘密且保持旧配置', async () => {
    const f = await fixture(); const saved = f.store.saveConnection({ ...profile, tls: { ...profile.tls!, passphrase: '待删除TLS测试值' } });
    expect(() => f.store.saveConnection({ ...saved, tls: { ...saved.tls!, passphrase: 'x'.repeat(1025) } })).toThrow('不能超过');
    expect(f.store.resolveConnection(profile.id).tls?.passphrase).toBe('待删除TLS测试值');
    f.store.deleteConnection(profile.id); expect(f.store.connections()).toEqual([]); expect((await persisted(f.path)).names).toEqual([]);
  });
});
