import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../../src/main/storage';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { connectionOrganizationApplySchema, connectionOrganizationDefaultColor, connectionOrganizationGetSchema, connectionOrganizationLimits, type ConnectionOrganizationApply } from '../../src/shared/connectionOrganization';
import { connectionOrganizationZh as text } from '../../src/shared/connectionOrganization.zh-CN';
import { validateCommand } from '../../src/shared/validation';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), folders: string[] = [], stores = new Set<LocalStore>();
const profile: ConnectionProfile = { id: 'a', name: '同名连接', group: '原组', color: '#123456', dialect: 'mysql', host: 'db.invalid', port: 3306, user: '原用户', database: '原库', rememberPassword: true,
  password: '仅测试数据库秘密', pendingFiles: ['tlsCa'], ssh: { enabled: false, host: 'jump.invalid', port: 22, user: '原跳板用户', privateKeyPath: '/原认证文件/key', hostFingerprint: 'SHA256:原指纹', password: '仅测试SSH秘密', passphrase: '仅测试SSH口令' },
  tls: { enabled: true, rejectUnauthorized: true, caPath: '/原认证文件/ca', certPath: '/原认证文件/cert', keyPath: '/原认证文件/tls', passphrase: '仅测试TLS口令' } };

/** 真实SQLite与进程内临时AES，仅验证本地存储，不冒充Electron系统加密或数据库连接验收。 */
async function fixture(available = true) {
  const base = join(process.cwd(), '.cache/connection-organization'); mkdirSync(base, { recursive: true }); const folder = mkdtempSync(join(base, 'case-')); folders.push(folder);
  const path = join(folder, 'config.sqlite'), key = randomBytes(32); let enabled = available;
  const protector = { available: vi.fn(() => enabled), encrypt: vi.fn((value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); }),
    decrypt: vi.fn((value: string) => { const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'); }) };
  const reopen = async () => { const store = await LocalStore.open(path, wasm, protector); stores.add(store); return store; };
  const close = (store: LocalStore) => { store.close(); stores.delete(store); };
  const store = await reopen(); store.saveConnection(profile); store.saveConnection({ ...profile, id: 'b', color: '#abcdef', group: '另一组', dialect: 'mariadb' });
  const clear = () => { protector.available.mockClear(); protector.encrypt.mockClear(); protector.decrypt.mockClear(); };
  clear();
  return { store, path, protector, reopen, close, clear, available(value: boolean) { enabled = value; } };
}
/** 独立SQL实例读真实落盘结果；只比较秘密行摘要，不将密文或测试秘密输出日志。 */
async function persisted(path: string) {
  const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(path));
  try {
    const profiles = db.exec('SELECT id,data FROM connections ORDER BY rowid')[0]?.values.map(row => ({ id: String(row[0]), value: assertNetworkProfile(JSON.parse(String(row[1]))) })) ?? [];
    const secrets = db.exec('SELECT connection_id,name,value FROM secrets ORDER BY connection_id,name')[0]?.values ?? [];
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name<>'connections' ORDER BY name")[0]?.values.flat().map(String) ?? [];
    const untouched = tables.map(name => [name, db.exec(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)]);
    return { profiles, secretCount: secrets.length, secretDigest: createHash('sha256').update(JSON.stringify(secrets)).digest('hex'), untouchedDigest: createHash('sha256').update(JSON.stringify(untouched)).digest('hex') };
  } finally { db.close(); }
}
/** 原事务中注入SQLite触发器故障，验证先更新的目标也真正回滚，不模拟mutate成功。 */
function database(store: LocalStore): Database { return (store as unknown as { db: Database }).db; }
function input(store: LocalStore, changes: ConnectionOrganizationApply['changes'] = { group: '新组', color: '#AABBCC' }, ids = ['a', 'b']): ConnectionOrganizationApply { return { expectedRevision: store.connectionRevision(), ids, changes }; }
function noCrypto(f: Awaited<ReturnType<typeof fixture>>) { expect(f.protector.available).not.toHaveBeenCalled(); expect(f.protector.encrypt).not.toHaveBeenCalled(); expect(f.protector.decrypt).not.toHaveBeenCalled(); }
/** 仅删除各测试自身生成的文件与空目录，不递归处理工作区外路径。 */
afterEach(() => { vi.restoreAllMocks(); for (const store of stores) store.close(); stores.clear(); for (const folder of folders.splice(0)) { for (const name of readdirSync(folder)) { const path = join(folder, name); if (name.endsWith('.tmp') && readdirSync(folder).includes(name)) { try { rmdirSync(path); continue; } catch { /* 非空目录不能被本清理器递归删除。 */ } } unlinkSync(path); } rmdirSync(folder); } });

describe('连接批量整理的严格白名单与预算', () => {
  it('仅接纳两个实际IPC命令，Get空输入和Apply不包含连接全量配置', () => {
    expect(validateCommand('connections.organizationGet', {})).toEqual({});
    const request = { expectedRevision: 0, ids: ['legacy-id', '__proto__'], changes: { group: '', color: null } };
    expect(validateCommand('connections.organizationApply', request)).toEqual(request);
    for (const extra of [{ sql: 'SELECT 1' }, { filePath: 'C:/secret' }, { password: '不能传入' }, { host: '不能改变' }, { profile }]) expect(() => validateCommand('connections.organizationApply', { ...request, ...extra })).toThrow();
    for (const changes of [{}, { group: undefined, color: undefined }, { name: '不能改名' }, { host: '不能改目标' }, { password: '不能传秘密' }, { ssh: {} }, { tls: {} }, { group: '组', color: '#abcdef', database: '不能改库' }]) expect(() => connectionOrganizationApplySchema.parse({ ...request, changes })).toThrow();
    expect(() => connectionOrganizationGetSchema.parse({ ids: ['a'] })).toThrow();
  });
  it('保留分组合法Unicode/前后空格和空串，不合并字面未分组', () => {
    for (const group of ['', '未分组', '  保留空格  ', '开发/中文😀', 'x'.repeat(100)]) expect(connectionOrganizationApplySchema.parse({ expectedRevision: 0, ids: ['a'], changes: { group } }).changes.group).toBe(group);
    expect(text.groupDisplay('')).toBe('（空分组）'); expect(text.groupDisplay('未分组')).toBe('"未分组"'); expect(text.groupDisplay('  组  ')).toBe('"  组  "');
    for (const group of ['x'.repeat(101), '\u0000', '\n', '\t', '\u007f', '\u0085', '\ud800', '\udfff']) expect(() => connectionOrganizationApplySchema.parse({ expectedRevision: 0, ids: ['a'], changes: { group } })).toThrow();
  });
  it('颜色只接受完整#RRGGBB或null，原大小写不静默归一', () => {
    for (const color of ['#ABCDEF', '#abcdef', '#012345', null]) expect(connectionOrganizationApplySchema.parse({ expectedRevision: 0, ids: ['a'], changes: { color } }).changes.color).toBe(color);
    for (const color of ['', '#fff', '#12345678', 'red', ' #123456', '#GGHHII', 123, false]) expect(() => connectionOrganizationApplySchema.parse({ expectedRevision: 0, ids: ['a'], changes: { color } })).toThrow();
    expect(connectionOrganizationDefaultColor).toBe('#52c5a2');
  });
  it('1至1000唯一ID与安全修订边界完整校验，不按名称去重或截断', () => {
    const ids = Array.from({ length: 1000 }, (_, index) => 'k' + index); expect(connectionOrganizationApplySchema.parse({ expectedRevision: Number.MAX_SAFE_INTEGER - 1, ids, changes: { group: '' } }).ids).toEqual(ids);
    for (const invalid of [[], ['a', 'a'], [''], ['x'.repeat(201)], [...ids, '超限']]) expect(() => connectionOrganizationApplySchema.parse({ expectedRevision: 0, ids: invalid, changes: { color: null } })).toThrow();
    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER, Infinity, NaN]) expect(() => connectionOrganizationApplySchema.parse({ expectedRevision, ids: ['a'], changes: { group: '组' } })).toThrow();
    expect(connectionOrganizationLimits.ids).toBe(1000);
  });
  it('getter/隐藏额外字段/原型字段/稀疏ID都在Zod读取前拒绝且零执行getter', () => {
    const getter = vi.fn(() => '不能读'), base = { expectedRevision: 0, ids: ['a'], changes: { group: '组' } };
    for (const target of ['root', 'changes', 'ids']) {
      const request = structuredClone(base);
      if (target === 'root') Object.defineProperty(request, 'expectedRevision', { get: getter }); else if (target === 'changes') Object.defineProperty(request.changes, 'group', { get: getter }); else Object.defineProperty(request.ids, '0', { get: getter });
      expect(() => connectionOrganizationApplySchema.parse(request)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled(); const hidden = structuredClone(base); Object.defineProperty(hidden.changes, 'password', { value: '隐藏', enumerable: false }); expect(() => connectionOrganizationApplySchema.parse(hidden)).toThrow();
    expect(() => connectionOrganizationApplySchema.parse({ ...base, changes: Object.create({ group: '继承' }) })).toThrow(); expect(() => connectionOrganizationApplySchema.parse({ ...base, ids: new Array(1) })).toThrow();
  });
});

describe('真实SQLite元数据事务、凭据保持与重启', () => {
  it('整批只改原JSON的group/color，一次revision++；密文/transport/其它表字节摘要不变', async () => {
    const f = await fixture(), before = await persisted(f.path), revision = f.store.connectionRevision(), save = vi.spyOn(f.store, 'saveConnection'), resolve = vi.spyOn(f.store, 'resolveConnection');
    const result = f.store.applyConnectionOrganization(input(f.store, { group: '  新分组😀  ', color: '#AABBCC' })), after = await persisted(f.path);
    expect(result.revision).toBe(revision + 1); expect(f.store.connectionRevision()).toBe(revision + 1); expect(result.connections.map(assertNetworkProfile).map(item => [item.id, item.group, item.color])).toEqual([['a', '  新分组😀  ', '#AABBCC'], ['b', '  新分组😀  ', '#AABBCC']]);
    expect(after.secretCount).toBe(8); expect(after.secretDigest).toBe(before.secretDigest); expect(after.untouchedDigest).toBe(before.untouchedDigest);
    for (let index = 0; index < before.profiles.length; index++) { const { group: _group, color: _color, ...previous } = before.profiles[index].value, { group: _nextGroup, color: _nextColor, ...next } = after.profiles[index].value; expect(next).toEqual(previous); }
    expect(save).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); noCrypto(f);
    const publicText = JSON.stringify(result); for (const secret of [profile.password!, profile.ssh!.password!, profile.ssh!.passphrase!, profile.tls!.passphrase!]) { expect(publicText.includes(secret)).toBe(false); expect(readFileSync(f.path).includes(Buffer.from(secret))).toBe(false); }
    expect(result.connections.map(assertNetworkProfile).every(item => item.password === undefined && item.ssh?.password === undefined && item.ssh?.passphrase === undefined && item.tls?.passphrase === undefined)).toBe(true); expect(result.connections.map(assertNetworkProfile).every(item => item.hasPassword && item.ssh?.hasPassword && item.ssh.hasPassphrase && item.tls?.hasPassphrase)).toBe(true);
  });
  it('真实关闭重开后分组/重置颜色保持，原四类凭据仍能解密，概要不回传秘密', async () => {
    const f = await fixture(), before = await persisted(f.path); f.store.applyConnectionOrganization(input(f.store, { group: '', color: null })); f.close(f.store);
    const store = await f.reopen(), snapshot = store.connectionOrganization(), disk = await persisted(f.path);
    expect(snapshot.connections.map(assertNetworkProfile).map(item => [item.group, item.color])).toEqual([['', connectionOrganizationDefaultColor], ['', connectionOrganizationDefaultColor]]); expect(disk.secretDigest).toBe(before.secretDigest);
    const resolved = assertNetworkProfile(store.resolveConnection('a')); expect(resolved.password === profile.password).toBe(true); expect(resolved.ssh?.password === profile.ssh?.password).toBe(true); expect(resolved.ssh?.passphrase === profile.ssh?.passphrase).toBe(true); expect(resolved.tls?.passphrase === profile.tls?.passphrase).toBe(true);
    expect(snapshot.connections.map(assertNetworkProfile)[0].password).toBeUndefined();
  });
  it('系统加密不可用或解密函数会抛错时仍能整理，连available都不调用', async () => {
    const f = await fixture(), before = await persisted(f.path); f.available(false); f.protector.decrypt.mockImplementation(() => { throw Error('禁止解密'); });
    const result = f.store.applyConnectionOrganization(input(f.store, { group: '离线整理' })); expect(result.connections.map(assertNetworkProfile).every(item => item.group === '离线整理' && item.hasPassword)).toBe(true); noCrypto(f); expect((await persisted(f.path)).secretDigest).toBe(before.secretDigest);
  });
  it('未记住的会话秘密原样保留，整理不让秘密意外落盘，重启后仍不恢复会话秘密', async () => {
    const f = await fixture(false); f.store.applyConnectionOrganization(input(f.store, { color: null })); noCrypto(f); const disk = await persisted(f.path); expect(disk.secretCount).toBe(0);
    const resolved = assertNetworkProfile(f.store.resolveConnection('a')); expect(resolved.password === profile.password).toBe(true); expect(resolved.tls?.passphrase === profile.tls?.passphrase).toBe(true); f.close(f.store);
    const restored = await f.reopen(); expect(restored.connectionOrganization().connections.map(assertNetworkProfile).every(item => !item.hasPassword)).toBe(true); expect(assertNetworkProfile(restored.resolveConnection('a')).password).toBeUndefined();
  });
  it('只改颜色不覆盖原分组，只改空分组不覆盖颜色；请求原值也只推进一次修订', async () => {
    const f = await fixture(), current = f.store.connectionRevision();
    const colored = f.store.applyConnectionOrganization(input(f.store, { color: '#123456' }, ['a'])); expect(colored.revision).toBe(current + 1); expect(colored.connections.map(assertNetworkProfile)[0].group).toBe('原组'); expect(colored.connections.map(assertNetworkProfile)[1].color).toBe('#abcdef');
    const grouped = f.store.applyConnectionOrganization(input(f.store, { group: '' }, ['b'])); expect(grouped.revision).toBe(current + 2); expect(grouped.connections.map(assertNetworkProfile)[1].group).toBe(''); expect(grouped.connections.map(assertNetworkProfile)[1].color).toBe('#abcdef'); noCrypto(f);
  });
  it('相同显示名称仍按精确ID整理，原型同名ID也不被当成对象属性', async () => {
    const f = await fixture(); f.store.saveConnection({ ...profile, id: '__proto__', name: '同名连接' }); f.store.saveConnection({ ...profile, id: 'constructor', name: '同名连接' }); f.clear();
    const result = f.store.applyConnectionOrganization(input(f.store, { group: '特殊ID组' }, ['__proto__', 'constructor'])); expect(result.connections.map(assertNetworkProfile).filter(item => item.group === '特殊ID组').map(item => item.id)).toEqual(['__proto__', 'constructor']); expect(result.connections.map(assertNetworkProfile).find(item => item.id === 'a')?.group).toBe('原组'); noCrypto(f);
  });
});

describe('CAS、未知目标和真实失败原子性', () => {
  it('分组ABA回到原字面也不能复活旧CAS，单项连接保存/凭据修改同样撤销旧修订', async () => {
    const f = await fixture(), old = input(f.store); f.store.applyConnectionOrganization(input(f.store, { group: '中间组' })); f.store.applyConnectionOrganization(input(f.store, { group: '原组' }));
    expect(() => f.store.applyConnectionOrganization(old)).toThrow(text.stale); const second = input(f.store); f.store.saveConnection({ ...f.store.connections().map(assertNetworkProfile)[0], password: '只用于撤销CAS的新测试密码' }); expect(() => f.store.applyConnectionOrganization(second)).toThrow(text.stale);
  });
  it('删除/重建同ID不会复活旧CAS，当前修订含未知ID则整批已知目标也不动', async () => {
    const f = await fixture(), old = input(f.store); f.store.deleteConnection('b'); expect(() => f.store.applyConnectionOrganization(old)).toThrow(text.stale);
    const before = readFileSync(f.path), revision = f.store.connectionRevision(); expect(() => f.store.applyConnectionOrganization(input(f.store, { group: '不能部分保存' }, ['a', 'b']))).toThrow(text.missing); expect(readFileSync(f.path)).toEqual(before); expect(f.store.connectionRevision()).toBe(revision); expect(f.store.connections().map(assertNetworkProfile)[0].group).toBe('原组');
    f.store.saveConnection({ ...profile, id: 'b' }); expect(() => f.store.applyConnectionOrganization(old)).toThrow(text.stale);
  });
  it('实际SQLite第二行触发器失败，第一行更新也回滚，磁盘与修订不推进', async () => {
    const f = await fixture(), before = readFileSync(f.path), original = f.store.connectionOrganization(), disk = await persisted(f.path);
    database(f.store).run("CREATE TRIGGER fail_second_organization BEFORE UPDATE ON connections WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'注入第二行失败'); END");
    expect(() => f.store.applyConnectionOrganization(input(f.store))).toThrow('修改未保存'); expect(f.store.connectionOrganization()).toEqual(original); expect(readFileSync(f.path)).toEqual(before); expect((await persisted(f.path)).secretDigest).toBe(disk.secretDigest); noCrypto(f);
    database(f.store).run('DROP TRIGGER fail_second_organization'); expect(f.store.applyConnectionOrganization(input(f.store)).revision).toBe(original.revision + 1);
  });
  it('真实写盘失败后内存/磁盘/修订/密文和会话秘密全恢复，后续保存不能夹带失败结果', async () => {
    for (const available of [true, false]) {
      const f = await fixture(available), before = readFileSync(f.path), original = f.store.connectionOrganization(), disk = await persisted(f.path); mkdirSync(f.path + '.tmp');
      expect(() => f.store.applyConnectionOrganization(input(f.store, { group: '不得保存', color: null }))).toThrow('修改未保存'); expect(f.store.connectionOrganization()).toEqual(original); expect(readFileSync(f.path)).toEqual(before); noCrypto(f); expect((await persisted(f.path)).secretDigest).toBe(disk.secretDigest);
      rmdirSync(f.path + '.tmp'); f.store.saveSettings(f.store.settings()); const resolved = assertNetworkProfile(f.store.resolveConnection('a')); expect(resolved.password === profile.password).toBe(true); expect(resolved.tls?.passphrase === profile.tls?.passphrase).toBe(true);
      f.close(f.store); const restored = await f.reopen(); expect(restored.connections().map(assertNetworkProfile).map(item => item.group)).toEqual(['原组', '另一组']); expect(restored.connectionOrganization().connections.map(assertNetworkProfile).map(item => item.color)).toEqual(['#123456', '#abcdef']);
    }
  });
  it('真实1000目标一次事务完整保存，Get不截断总连接，第1001个未选中项不变', async () => {
    const f = await fixture(), db = database(f.store); db.run('BEGIN'); const insert = db.prepare('INSERT INTO connections VALUES (?,?)');
    try { for (let index = 0; index < 1001; index++) { const item = { id: `批量${index}`, name: '同名', group: '原组', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '' }; insert.run([item.id, JSON.stringify(item)]); } db.run('COMMIT'); } finally { insert.free(); }
    f.store.saveSettings(f.store.settings()); const ids = Array.from({ length: 1000 }, (_, index) => `批量${index}`), revision = f.store.connectionRevision();
    const result = f.store.applyConnectionOrganization(input(f.store, { group: '千项组' }, ids)); expect(result.revision).toBe(revision + 1); expect(result.connections).toHaveLength(1003); expect(result.connections.map(assertNetworkProfile).filter(item => item.group === '千项组')).toHaveLength(1000); expect(result.connections.map(assertNetworkProfile).find(item => item.id === '批量1000')?.group).toBe('原组');
    const before = readFileSync(f.path); expect(() => f.store.applyConnectionOrganization(input(f.store, { group: '越界' }, [...ids, '批量1000']))).toThrow(); expect(readFileSync(f.path)).toEqual(before); expect(f.store.connectionRevision()).toBe(revision + 1); noCrypto(f);
  });
  it('最后安全修订成功一次后不能再写成不安全整数', async () => {
    const f = await fixture(); (f.store as unknown as { connectionRevisionValue: number }).connectionRevisionValue = Number.MAX_SAFE_INTEGER - 1;
    expect(f.store.applyConnectionOrganization(input(f.store, { group: '最后安全修订' })).revision).toBe(Number.MAX_SAFE_INTEGER); const before = readFileSync(f.path);
    expect(() => f.store.applyConnectionOrganization(input(f.store, { group: '不能越界' }))).toThrow(); expect(readFileSync(f.path)).toEqual(before); expect(f.store.connectionRevision()).toBe(Number.MAX_SAFE_INTEGER);
  });
});
