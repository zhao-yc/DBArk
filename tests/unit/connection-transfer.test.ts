import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { ConnectionTransfer } from '../../src/main/connectionTransfer';
import { LocalStore } from '../../src/main/storage';
import { confirmConnectionFiles, resolveFileToken } from '../../src/main/fileTokens';
import { nativeAtomicFileIO } from '../../src/engine/atomicFile';
import { connect } from '../../src/engine/connection';
import { assertConnectionReady, connectionTransferDocumentSchema, connectionTransferLimits, copyConnectionProfile, exportConnectionProfile, type ConnectionImportPreview } from '../../src/shared/connectionTransfer';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { ConnectionProfile } from '../../src/shared/contracts';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const original: ConnectionProfile = { id: '__proto__', name: '生产只读概要', group: '分组', color: '#123456', host: 'db.example', port: 3306, user: 'user', dialect: 'mysql', database: '资料库', password: '数据库秘密', rememberPassword: true, ssh: { enabled: true, host: 'ssh.example', port: 22, user: 'ssh', password: 'SSH秘密', passphrase: '私钥口令', privateKeyPath: 'C:\\private\\id_ed25519', hostFingerprint: 'SHA256:测试固定指纹' }, tls: { enabled: true, rejectUnauthorized: true, caPath: '/private/ca.pem', certPath: '/private/client.pem', keyPath: '/private/client.key' } };
let directory: string, file: string, source: string, store: LocalStore, transfer: ConnectionTransfer;
const decrypt = vi.fn((value: string) => Buffer.from(value, 'base64').toString());
const protector = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt };
/** 只在新建独立临时目录执行真实 SQLite 和文件 IO，不连接数据库服务。 */
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dbark-connection-transfer-')); file = join(directory, 'local.sqlite'); source = join(directory, 'connections.json');
  store = await LocalStore.open(file, wasm, protector); store.saveConnection(original); decrypt.mockClear(); transfer = new ConnectionTransfer(store);
});
/** 删除前同时验证普通目录、系统临时父目录和本批唯一前缀，拒绝路径或链接替换。 */
function verifiedDirectory(): string {
  const path = resolve(directory), parent = realpathSync(tmpdir()), info = lstatSync(path);
  if (dirname(path) !== resolve(tmpdir()) || !/^dbark-connection-transfer-[a-zA-Z0-9]+$/.test(basename(path)) || info.isSymbolicLink() || !info.isDirectory() || dirname(realpathSync(path)) !== parent) throw new Error('拒绝清理不属于本例的目录');
  return path;
}
afterEach(() => { store.close(); rmSync(verifiedDirectory(), { recursive: true, force: true }); });
/** 使用真实交换文件生成预览，确认动作只提交源 ID 和决策。 */
async function preview(profiles = [exportConnectionProfile(original)]) {
  writeFileSync(source, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: profiles })); return transfer.preview(source);
}
function decisions(value: ConnectionImportPreview) { return value.entries.map(entry => ({ sourceId: entry.sourceId, action: 'add' as const })); }

describe('无秘密连接交换', () => {
  it('概要白名单复制和真实导出均无秘密、存在标记及生效路径，也不调用解密器', async () => {
    const copy = copyConnectionProfile(store.connections()[0]);
    expect(copy).toMatchObject({ id: '', rememberPassword: false, pendingFiles: ['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'], ssh: { enabled: true, hostFingerprint: original.ssh!.hostFingerprint }, tls: { enabled: true, rejectUnauthorized: true } });
    expect(copy.ssh).not.toHaveProperty('privateKeyPath'); expect(copy.tls).not.toHaveProperty('caPath');
    expect(await transfer.exportFile(source, [original.id])).toEqual({ count: 1 });
    const content = readFileSync(source, 'utf8');
    for (const forbidden of ['数据库秘密', 'SSH秘密', '私钥口令', 'hasPassword', 'hasPassphrase', 'rememberPassword', 'privateKeyPath', 'caPath', 'C:', '/private/']) expect(content).not.toContain(forbidden);
    expect(JSON.parse(content).connections[0].ssh.privateKeyFileName).toBe('id_ed25519'); expect(decrypt).not.toHaveBeenCalled();
  });
  it('重复身份只提示，确认新增全新 ID；原连接秘密、表偏好和全局设置均保持', async () => {
    store.saveTablePreferences({ connectionId: original.id, database: '库', table: '表', preferences: { version: 1, columns: [{ name: 'id', hidden: true }] } });
    const settings = store.settings(), before = store.connections(); const value = await preview();
    expect(value.entries[0].matches[0].reasons).toEqual(['id', 'name', 'target']);
    const result = transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true });
    expect(result).toMatchObject({ added: 1, skipped: 0 }); const added = result.connections.at(-1)!; expect(added.id).not.toBe(original.id); expect(added.rememberPassword).toBe(false);
    expect(store.connections()[0]).toEqual(before[0]); expect(store.tablePreferences({ connectionId: added.id, database: '库', table: '表' })).toBeNull(); expect(store.settings()).toEqual(settings);
    expect(store.resolveConnection(added.id).password).toBeUndefined(); expect(store.resolveConnection(added.id).ssh?.password).toBeUndefined(); expect(store.resolveConnection(original.id).password).toBe(original.password);
    expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true })).toThrow('预览已失效');
  });
  it('不可变预览不信任返回对象或再次修改的文件，跳过不会触发写盘', async () => {
    const value = await preview(); value.entries[0].profile.host = 'attacker.example'; writeFileSync(source, '{}');
    const result = transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true }); expect(result.connections.at(-1)!.host).toBe(original.host);
    const next = await preview(), bytes = readFileSync(file), revision = store.connectionRevision();
    expect(transfer.apply({ previewToken: next.previewToken, decisions: [{ sourceId: original.id, action: 'skip' }] })).toEqual({ connections: store.connections(), added: 0, skipped: 1 });
    expect(readFileSync(file)).toEqual(bytes); expect(store.connectionRevision()).toBe(revision);
  });
  it('配置、密码和删除变更使快照失效；失败确认、重复决策和过期令牌不能重放', async () => {
    for (const update of [{ name: '已修改名称' }, { password: '新会话密码' }]) {
      const value = await preview(); store.saveConnection({ ...store.connections()[0], ...update });
      expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true })).toThrow('配置已变化');
      expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value) })).toThrow('预览已失效');
    }
    const invalid = await preview(); expect(() => transfer.apply({ previewToken: invalid.previewToken, decisions: [...decisions(invalid), ...decisions(invalid)] })).toThrow('选择一次');
    const deleted = await preview(); store.deleteConnection(original.id); expect(() => transfer.apply({ previewToken: deleted.previewToken, decisions: decisions(deleted) })).toThrow('配置已变化');
    let now = 100; transfer = new ConnectionTransfer(store, () => now); const expired = await preview(); now += connectionTransferLimits.previewLifetimeMs;
    expect(() => transfer.apply({ previewToken: expired.previewToken, decisions: decisions(expired) })).toThrow('预览已失效');
  });
  it('所有秘密、未知字段、非法 UTF-8、版本、重复源 ID、绝对路径和大小预算真实拒绝', async () => {
    const valid = exportConnectionProfile(original);
    for (const connection of [{ ...valid, password: '不能导入' }, { ...valid, hasPassword: true }, { ...valid, pendingFiles: [] }, { ...valid, ssh: { ...valid.ssh!, passphrase: '不能导入' } }, { ...valid, tls: { ...valid.tls!, caPath: '\\\\server\\secret' } }, { ...valid, tls: { ...valid.tls!, caFileName: '/etc/key' } }]) {
      writeFileSync(source, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: [connection] })); await expect(transfer.preview(source)).rejects.toThrow('格式无效');
    }
    for (const document of [{ format: 'DBArk-connections', version: 2, connections: [valid] }, { format: 'DBArk-connections', version: 1, connections: [valid, valid] }, { format: 'DBArk-connections', version: 1, connections: Array.from({ length: 501 }, (_, i) => ({ ...valid, id: String(i) })) }]) {
      writeFileSync(source, JSON.stringify(document)); await expect(transfer.preview(source)).rejects.toThrow('格式无效');
    }
    writeFileSync(source, Buffer.from([0xff, 0xfe])); await expect(transfer.preview(source)).rejects.toThrow('UTF-8');
    writeFileSync(source, Buffer.alloc(connectionTransferLimits.fileBytes + 1)); await expect(transfer.preview(source)).rejects.toThrow('2 MiB');
    expect(store.connections()).toHaveLength(1);
  });
  it('批次磁盘失败保留内存、原文件、凭据和版本，确认令牌消费且之后保存不夹带失败新增', async () => {
    const value = await preview([exportConnectionProfile(original), { ...exportConnectionProfile(original), id: '第二个' }]), before = readFileSync(file), revision = store.connectionRevision();
    const blocker = join(verifiedDirectory(), 'local.sqlite.tmp'); mkdirSync(blocker);
    expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true })).toThrow('修改未保存');
    expect(store.connections()).toHaveLength(1); expect(readFileSync(file)).toEqual(before); expect(store.connectionRevision()).toBe(revision); expect(store.resolveConnection(original.id).password).toBe(original.password);
    expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true })).toThrow('预览已失效');
    if (lstatSync(blocker).isSymbolicLink() || realpathSync(blocker) !== join(realpathSync(verifiedDirectory()), 'local.sqlite.tmp')) throw new Error('拒绝清理非本例故障目录'); rmdirSync(blocker);
    store.saveSettings(store.settings()); expect(store.connections()).toHaveLength(1);
  });
  it('导出原子替换失败保原件并清临时文件，失败不留下目标锁', async () => {
    writeFileSync(source, '原文件'); const broken = new ConnectionTransfer(store, Date.now, { ...nativeAtomicFileIO, rename: async () => { throw new Error('注入替换失败'); } });
    await expect(broken.exportFile(source, [original.id])).rejects.toThrow('注入替换失败'); expect(readFileSync(source, 'utf8')).toBe('原文件'); expect(readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
    await transfer.exportFile(source, [original.id]); expect(JSON.parse(readFileSync(source, 'utf8')).format).toBe('DBArk-connections');
  });
  it('待认证文件必须显式暂存，重启保留；禁用区域不阻连接但重新开启仍阻止', async () => {
    let value = await preview(); expect(() => transfer.apply({ previewToken: value.previewToken, decisions: decisions(value) })).toThrow('明确确认暂存');
    value = await preview(); const added = transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true }).connections.at(-1)!;
    expect(() => assertConnectionReady(added)).toThrow('重新选择'); await expect(connect(added)).rejects.toThrow('重新选择');
    const disabled = { ...added, ssh: { ...added.ssh!, enabled: false }, tls: { ...added.tls!, enabled: false } }; expect(() => assertConnectionReady(disabled)).not.toThrow(); expect(disabled.pendingFiles).toHaveLength(4);
    store.close(); store = await LocalStore.open(file, wasm, protector); expect(store.connections().find(profile => profile.id === added.id)?.pendingFiles).toEqual(added.pendingFiles);
  });
  it('只有适当用途的本窗口路径授权清除旧缺文件标记，漏传标记和手输 basename 无效', () => {
    const copy = copyConnectionProfile(original), input = { ...copy, pendingFiles: undefined, tls: { ...copy.tls!, caPath: 'ca.pem' } };
    expect(confirmConnectionFiles(input, copy, new Map()).pendingFiles).toHaveLength(4);
    expect(confirmConnectionFiles(input, copy, new Map([['wrong', { path: 'ca.pem', purpose: 'connection-import' }]])).pendingFiles).toHaveLength(4);
    const files = new Map([['selected', { path: 'D:\\selected\\ca.pem', purpose: 'certificate' }]]);
    const saved = confirmConnectionFiles({ ...input, tls: { ...input.tls!, caPath: 'D:\\selected\\ca.pem' } }, copy, files);
    expect(saved.pendingFiles).toEqual(['sshPrivateKey', 'tlsCert', 'tlsKey']);
  });
  it('专用 IPC 与用途授权拒绝任意路径和普通导入令牌混用', () => {
    expect(publicCommands['connections.importApply']).toBe(true);
    expect(validateCommand('connections.export', { connectionIds: ['__proto__'], fileToken: 'token' })).toEqual({ connectionIds: ['__proto__'], fileToken: 'token' });
    expect(() => validateCommand('connections.importPreview', { fileToken: 'token', filePath: 'C:\\secret' })).toThrow();
    expect(() => validateCommand('connections.importApply', { previewToken: 'token', decisions: [{ sourceId: 'x', action: 'replace' }] })).toThrow();
    const files = new Map([['normal', { path: source, purpose: 'import', format: 'json' }], ['special', { path: source, purpose: 'connection-import', format: 'json' }]]);
    expect(() => resolveFileToken(files, 'normal', 'connection-import', 'json')).toThrow('未授权'); expect(resolveFileToken(files, 'special', 'connection-import', 'json')).toBe(source);
    expect(() => resolveFileToken(files, 'special', 'connection-export', 'json')).toThrow('未授权');
  });
  it('已暂存配置再次导出保留认证要求，不能丢标记后误用系统 CA', async () => {
    const value = await preview(); const added = transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true }).connections.at(-1)!;
    await transfer.exportFile(source, [added.id]); const document = connectionTransferDocumentSchema.parse(JSON.parse(readFileSync(source, 'utf8')));
    const cloned = copyConnectionProfile(added); expect(cloned.pendingFiles).toEqual(added.pendingFiles); expect(document.connections[0].tls?.caFileName).toBeTruthy();
  });
  it('schema3 升4保留每张表和凭据；迁移磁盘失败不修改旧文件', async () => {
    store.saveQuery({ id: 'q', name: '查询', sql: 'SELECT 1', updatedAt: '2026-01-01' }); store.saveSnippet({ id: 's', name: '片段', group: '', description: '', sql: 'SELECT 2', updatedAt: '2026-01-01' });
    store.addHistory({ id: 'h', connectionId: original.id, sql: 'SELECT 3', startedAt: '2026-01-01', elapsedMs: 7, success: true }); store.saveTask({ id: 't', kind: 'query.execute', status: 'completed', progress: 100, message: '完成', startedAt: '2026-01-01' });
    store.saveTablePreferences({ connectionId: original.id, database: '库', table: '表', preferences: { version: 1, columns: [{ name: 'x', hidden: true }] } });
    const settings = { ...store.settings(), theme: 'light' as const }; store.saveSettings(settings); store.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }); const legacy = new SQL.Database(readFileSync(file)); legacy.run('PRAGMA user_version=3'); const expected = legacy.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map(([name]) => [String(name), legacy.exec(`SELECT * FROM ${String(name)}`)]); writeFileSync(file, legacy.export()); legacy.close();
    const before = readFileSync(file), blocker = join(verifiedDirectory(), 'local.sqlite.tmp'); mkdirSync(blocker);
    await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow('修改未保存'); expect(readFileSync(file)).toEqual(before);
    if (lstatSync(blocker).isSymbolicLink() || realpathSync(blocker) !== join(realpathSync(verifiedDirectory()), 'local.sqlite.tmp')) throw new Error('拒绝清理非本例故障目录'); rmdirSync(blocker);
    store = await LocalStore.open(file, wasm, protector); const migrated = new SQL.Database(readFileSync(file));
    expect(migrated.exec('PRAGMA user_version')[0].values[0][0]).toBe(8); for (const [name, rows] of expected) expect(migrated.exec(`SELECT * FROM ${name}`)).toEqual(rows); migrated.close(); expect(store.resolveConnection(original.id).password).toBe(original.password);
  });
  it('预算边界允许完整 500 条和恰好 2 MiB 文件，第五份预览淘汰最旧令牌', async () => {
    const profiles = Array.from({ length: 500 }, (_, index) => ({ ...exportConnectionProfile(original), id: String(index) }));
    const value = await preview(profiles); expect(value.entries).toHaveLength(500);
    const result = transfer.apply({ previewToken: value.previewToken, decisions: decisions(value), allowIncomplete: true }); expect(result.added).toBe(500); expect(new Set(result.connections.map(profile => profile.id)).size).toBe(501);
    const content = JSON.stringify({ format: 'DBArk-connections', version: 1, connections: [exportConnectionProfile(original)] }); writeFileSync(source, content + ' '.repeat(connectionTransferLimits.fileBytes - Buffer.byteLength(content)));
    const first = await transfer.preview(source); for (let index = 0; index < 4; index++) await transfer.preview(source);
    expect(() => transfer.apply({ previewToken: first.previewToken, decisions: decisions(first) })).toThrow('预览已失效');
  });
});
