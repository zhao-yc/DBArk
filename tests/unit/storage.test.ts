import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import type { ConnectionProfile } from '../../src/shared/contracts';
const require = createRequire(import.meta.url);
const temporary: string[] = [];
const profile: ConnectionProfile = { id: 'test', name: '测试数据库', host: '127.0.0.1', port: 3306, user: 'test', group: '开发', color: '#abcdef', dialect: 'mysql', password: 'never-plaintext-123', rememberPassword: true };
const protector = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value,'base64').toString() };
async function open(available = true) { const dir = mkdtempSync(join(tmpdir(), 'dbark-test-')); temporary.push(dir); const path = join(dir, 'test.sqlite'); return { path, store: await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), { ...protector, available: () => available }) }; }
afterEach(() => { for(const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('配置与凭据持久化', () => {
  it('界面和SQLite均不包含明文密码，重启能恢复加密凭据', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    expect(saved.password).toBeUndefined(); expect(saved.hasPassword).toBe(true);
    expect(store.resolveConnection('test').password).toBe(profile.password);
    store.close(); expect(readFileSync(path).includes(Buffer.from(profile.password!))).toBe(false);
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.resolveConnection('test').password).toBe(profile.password); restored.close();
  });
  it('系统加密不可用时密码只存在当前会话', async () => {
    const { store, path } = await open(false); store.saveConnection(profile);
    expect(store.resolveConnection('test').password).toBe(profile.password); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].hasPassword).toBe(false); expect(restored.resolveConnection('test').password).toBeUndefined(); restored.close();
  });
  it('编辑连接保留未重输密码，关闭记住密码会清除持久密文', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    store.saveConnection({ ...saved, name: '新的名字', rememberPassword: false });
    expect(store.resolveConnection('test').password).toBe(profile.password); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].hasPassword).toBe(false); restored.close();
  });
  it('显式清除数据库和 SSH 凭据后，重启不恢复旧密码', async () => {
    const { store, path } = await open();
    const saved = store.saveConnection({ ...profile, ssh: { enabled: true, host: 'localhost', port: 22, user: 'test', password: 'ssh-test-secret', passphrase: 'key-test-secret' } });
    const cleared = store.saveConnection({ ...saved, password: '', ssh: { ...saved.ssh!, password: '', passphrase: '' } });
    expect(cleared.hasPassword).toBe(false); expect(cleared.ssh?.hasPassword).toBe(false); expect(cleared.ssh?.hasPassphrase).toBe(false);
    store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.resolveConnection('test').password).toBeUndefined(); expect(restored.resolveConnection('test').ssh?.password).toBeUndefined(); expect(restored.resolveConnection('test').ssh?.passphrase).toBeUndefined(); restored.close();
  });
  it('迁移可重复，退出中的任务不自动重放', async () => {
    const { store, path } = await open(); store.saveTask({ id: 'unfinished', kind: 'query.execute', status: 'running', progress: 10, message: '执行中', startedAt: new Date().toISOString() }); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.tasks()[0].status).toBe('failed'); expect(restored.settings().theme).toBe('dark'); restored.close();
  });
  it('磁盘失败后内存及密码回退，后续保存不会偷偷提交失败修改', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    mkdirSync(`${path}.tmp`);
    expect(() => store.saveConnection({ ...saved, name: '失败的名字', password: 'failed-secret-change' })).toThrow('修改未保存');
    expect(store.connections()[0].name).toBe(profile.name); expect(store.resolveConnection(profile.id).password).toBe(profile.password);
    rmSync(`${path}.tmp`, { recursive: true });
    store.saveSettings({ ...store.settings(), theme: 'light' }); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].name).toBe(profile.name); expect(restored.resolveConnection(profile.id).password).toBe(profile.password); restored.close();
  });
});
