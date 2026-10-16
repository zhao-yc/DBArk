import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import { ConnectionTransfer } from '../../src/main/connectionTransfer';
import { confirmConnectionFiles, revokeConnectionFiles, type SelectedFile } from '../../src/main/fileTokens';
import { connectionReplacementAcknowledgements, exportConnectionProfile, importReplacementProfile, type ConnectionImportApply, type ConnectionImportDecision, type ExportedConnectionProfile } from '../../src/shared/connectionTransfer';
import { validateCommand } from '../../src/shared/validation';
import type { ConnectionProfile } from '../../src/shared/contracts';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const original: ConnectionProfile = { id: 'target-a', name: '原目标A', group: '旧分组', color: '#123456', dialect: 'mysql', host: 'old.invalid', port: 3306, user: 'old', rememberPassword: true, password: '合成数据库凭据', ssh: { enabled: true, host: 'old-jump.invalid', port: 22, user: 'old-ssh', password: '合成SSH凭据', passphrase: '合成SSH口令', privateKeyPath: 'C:\\合成路径\\ssh.key', hostFingerprint: 'SHA256:old' }, tls: { enabled: true, rejectUnauthorized: true, caPath: 'C:\\合成路径\\ca.pem', certPath: 'C:\\合成路径\\cert.pem', keyPath: 'C:\\合成路径\\client.key', passphrase: '合成TLS口令' } };
let directory: string, file: string, source: string, store: LocalStore, transfer: ConnectionTransfer, manager: ConnectionConfigManager;
let now: number;
const request = vi.fn(), assertIdle = vi.fn(), decrypt = vi.fn((value: string) => Buffer.from(value, 'base64').toString());
const protector = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt };
let files: Map<string, SelectedFile>;

/** 所有值均为合成字符串，真实SQLite只写唯一临时目录，不读取私钥/证书或系统凭据。 */
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dbark-c03-replace-')); file = join(directory, 'local.sqlite'); source = join(directory, 'source.json'); now = 1000;
  store = await LocalStore.open(file, wasm, protector); store.saveConnection(original); store.saveConnection({ ...original, id: 'target-b', name: '原目标B', host: 'other.invalid', rememberPassword: false });
  request.mockReset().mockResolvedValue(undefined); assertIdle.mockReset(); decrypt.mockClear(); files = new Map([['old-key', { path: original.ssh!.privateKeyPath!, purpose: 'key' }], ['old-ca', { path: original.tls!.caPath!, purpose: 'certificate' }]]);
  manager = new ConnectionConfigManager(store, { request }, { assertIdle, revokeFiles: ids => revokeConnectionFiles(ids, files) });
  transfer = new ConnectionTransfer(store, () => now, undefined, manager);
});
/** 清理只接受本例前缀、实际临时父目录与非链接目录。 */
afterEach(() => {
  store?.close(); const actual = resolve(directory), info = lstatSync(actual);
  if (info.isSymbolicLink() || !info.isDirectory() || dirname(actual) !== resolve(tmpdir()) || !/^dbark-c03-replace-[a-zA-Z0-9]+$/.test(basename(actual)) || dirname(realpathSync(actual)) !== realpathSync(tmpdir())) throw Error('拒绝清理非本例目录');
  rmSync(actual, { recursive: true, force: true });
});
/** 独立构造新目标白名单，不把本机旧路径带进输入文件。 */
function incoming(id = 'source-a'): ExportedConnectionProfile { return { id, name: '新来源', group: '新分组', color: '#abcdef', dialect: 'mariadb', host: 'new.invalid', port: 3307, user: 'new', database: '新库', ssh: { enabled: true, host: 'new-jump.invalid', port: 2222, user: 'new-ssh', hostFingerprint: 'SHA256:new' }, tls: { enabled: true, rejectUnauthorized: true } }; }
async function preview(profiles = [incoming()]) { writeFileSync(source, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: profiles })); return transfer.preview(source); }
function replacement(sourceId = 'source-a', targetId = original.id): ConnectionImportDecision { return { sourceId, action: 'replace', targetId }; }
function reviewInput(previewToken: string, decisions = [replacement()]): ConnectionImportApply {
  const review = transfer.review({ previewToken, decisions }); return { previewToken, decisions, confirmationToken: review.confirmationToken, acknowledgements: [...connectionReplacementAcknowledgements], allowIncomplete: true };
}

describe('C03明确配对与本地原子替换', () => {
  it('明确替换相同端点也强制清秘密和文件授权，不因transport相同保留旧认证', async () => {
    const value = await preview([exportConnectionProfile(original)]), input = reviewInput(value.previewToken, [replacement(original.id)]);
    const result = await transfer.applyBatch(input); expect(result.replaced).toBe(1); expect(result.connections.find(profile => profile.id === original.id)!.host).toBe(original.host);
    expect(store.resolveConnection(original.id).password).toBeUndefined(); expect(store.resolveConnection(original.id).ssh?.password).toBeUndefined(); expect(request.mock.calls[0][1].transportChanged).toBe(true); expect(files.get('old-key')?.revokedConnections?.has(original.id)).toBe(true);
  });

  it('第二目标活动检查失败也不提交第一目标或新增，不自动取消且释放整批锁', async () => {
    const value = await preview([incoming(), incoming('source-b'), incoming('source-add')]), input = reviewInput(value.previewToken, [replacement(), replacement('source-b', 'target-b'), { sourceId: 'source-add', action: 'add' }]);
    const before = readFileSync(file), revision = store.connectionRevision(); request.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('第二目标仍有打开的会话'));
    await expect(transfer.applyBatch(input)).rejects.toThrow('打开的会话'); expect(readFileSync(file)).toEqual(before); expect(store.connectionRevision()).toBe(revision); expect(store.connections()).toHaveLength(2); expect(store.resolveConnection(original.id).password).toBe(original.password);
    expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave', '__connections.prepareSave']); expect(() => manager.assertAvailable('target-a')).not.toThrow(); expect(() => manager.assertAvailable('target-b')).not.toThrow();
  });

  it('混合新增/替换/跳过一次提交，保留目标ID及历史/查询/布局，只删除目标的全部持久和会话秘密', async () => {
    // 补一个未来秘密槽，并把已知槽转入会话；同一目标同时存在持久与会话命名空间。
    store.close(); const SQL = await initSqlJs({ locateFile: () => wasm }), database = new SQL.Database(readFileSync(file));
    database.run('INSERT INTO secrets VALUES (?,?,?)', [original.id, 'future-secret-slot', '合成密文']); writeFileSync(file, database.export()); database.close();
    store = await LocalStore.open(file, wasm, protector); store.saveConnection({ ...store.connections()[0], rememberPassword: false });
    store.saveQuery({ id: 'query', connectionId: original.id, name: '旧查询', sql: 'SELECT 1', updatedAt: '合成时间' });
    store.addHistory({ id: 'history', connectionId: original.id, sql: 'SELECT 2', startedAt: '合成时间', elapsedMs: 1, success: true });
    store.saveTablePreferences({ connectionId: original.id, database: '旧库', table: '旧表', preferences: { version: 1, columns: [{ name: 'x', hidden: true }] } });
    manager = new ConnectionConfigManager(store, { request }, { assertIdle, revokeFiles: ids => revokeConnectionFiles(ids, files) }); transfer = new ConnectionTransfer(store, () => now, undefined, manager);
    const beforeQueries = store.queries(), beforeHistory = store.history(), beforeLayout = store.tablePreferences({ connectionId: original.id, database: '旧库', table: '旧表' });
    const value = await preview([incoming(), incoming('source-add'), incoming('source-skip')]);
    const decisions: ConnectionImportDecision[] = [replacement(), { sourceId: 'source-add', action: 'add' }, { sourceId: 'source-skip', action: 'skip' }];
    const input = reviewInput(value.previewToken, decisions), revision = store.connectionRevision(); decrypt.mockClear();
    const result = await transfer.applyBatch(input); expect(result).toMatchObject({ added: 1, replaced: 1, skipped: 1, replacementIds: [original.id] }); expect(store.connectionRevision()).toBe(revision + 1);
    const replaced = store.resolveConnection(original.id); expect(replaced).toMatchObject({ id: original.id, host: 'new.invalid', rememberPassword: false, pendingFiles: ['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'] });
    expect(replaced.password).toBeUndefined(); expect(replaced.ssh?.password).toBeUndefined(); expect(replaced.ssh?.passphrase).toBeUndefined(); expect(replaced.tls?.passphrase).toBeUndefined();
    expect(replaced.ssh?.privateKeyPath).toBeUndefined(); expect(replaced.tls?.caPath).toBeUndefined(); expect(replaced.tls?.certPath).toBeUndefined(); expect(replaced.tls?.keyPath).toBeUndefined();
    expect(decrypt).not.toHaveBeenCalled(); expect(store.queries()).toEqual(beforeQueries); expect(store.history()).toEqual(beforeHistory); expect(store.tablePreferences({ connectionId: original.id, database: '旧库', table: '旧表' })).toEqual(beforeLayout);
    const persisted = new SQL.Database(readFileSync(file)); expect(persisted.exec("SELECT COUNT(*) FROM secrets WHERE connection_id='target-a'")[0].values[0][0]).toBe(0); persisted.close();
    expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave']);
    expect(request.mock.calls[0][1]).toEqual({ id: original.id, profile: importReplacementProfile(incoming(), exportConnectionProfile(original)), transportChanged: true });
    const pendingInput = { ...result.connections.find(item => item.id === original.id)!, ssh: { ...replaced.ssh!, privateKeyPath: original.ssh!.privateKeyPath }, tls: { ...replaced.tls!, caPath: original.tls!.caPath } };
    expect(confirmConnectionFiles(pendingInput, replaced, files).pendingFiles).toHaveLength(4);
    expect(files.get('old-key')?.revokedConnections?.has('target-b')).not.toBe(true);
    files.set('fresh-key', { path: original.ssh!.privateKeyPath!, purpose: 'key' });
    expect(confirmConnectionFiles(pendingInput, replaced, files).pendingFiles).toEqual(['tlsCa', 'tlsCert', 'tlsKey']);
    await expect(transfer.applyBatch(input)).rejects.toThrow('预览已失效');
  });

  it('源ID/名称/端点相同也只提示，add永不隐式覆盖；审阅过replace再改add不复用旧目标绑定', async () => {
    const value = await preview([exportConnectionProfile(original)]), before = store.resolveConnection(original.id);
    expect(value.entries[0].matches[0].reasons).toEqual(['id', 'name', 'target']);
    transfer.review({ previewToken: value.previewToken, decisions: [replacement(original.id)] });
    const result = await transfer.applyBatch({ previewToken: value.previewToken, decisions: [{ sourceId: original.id, action: 'add' }], allowIncomplete: true });
    expect(result.added).toBe(1); expect(result).not.toHaveProperty('replaced'); expect(result.connections.at(-1)!.id).not.toBe(original.id); expect(store.resolveConnection(original.id)).toEqual(before); expect(request).not.toHaveBeenCalled();
  });

  it('旧概要/返回对象/源文件修改不改变审阅绑定；最终CAS不接受A→B→A', async () => {
    const value = await preview(), input = reviewInput(value.previewToken);
    value.entries[0].profile.host = 'tampered.invalid'; writeFileSync(source, '{}');
    const review = transfer.review({ previewToken: value.previewToken, decisions: [replacement()] }); review.entries[0].profile.host = 'other-tampered.invalid'; review.entries[0].previous!.host = 'wrong-old.invalid';
    const result = await transfer.applyBatch({ ...input, confirmationToken: review.confirmationToken }); expect(result.connections.find(profile => profile.id === original.id)!.host).toBe('new.invalid');
    const next = await preview(), stale = reviewInput(next.previewToken); const saved = store.connections().find(profile => profile.id === original.id)!;
    store.saveConnection({ ...saved, name: '中间变化' }); store.saveConnection(saved);
    await expect(transfer.applyBatch(stale)).rejects.toThrow('配置已变化'); await expect(transfer.applyBatch(stale)).rejects.toThrow('预览已失效');
  });

  it('重复目标、缺源/多源和缺目标拒绝；跨行交换目标即使目标集合相同也不接受', async () => {
    let value = await preview([incoming(), incoming('source-b')]);
    expect(() => transfer.review({ previewToken: value.previewToken, decisions: [replacement(), replacement('source-b')] })).toThrow('同批');
    expect(() => transfer.review({ previewToken: value.previewToken, decisions: [replacement()] })).toThrow('每个源');
    expect(() => transfer.review({ previewToken: value.previewToken, decisions: [replacement('unknown'), replacement('source-b', 'target-b')] })).toThrow('每个源');
    expect(() => transfer.review({ previewToken: value.previewToken, decisions: [replacement('source-a', 'missing'), replacement('source-b', 'target-b')] })).toThrow('不存在');
    value = await preview([incoming(), incoming('source-b')]); const input = reviewInput(value.previewToken, [replacement(), replacement('source-b', 'target-b')]);
    await expect(transfer.applyBatch({ ...input, decisions: [replacement('source-a', 'target-b'), replacement('source-b', 'target-a')] })).rejects.toThrow('选择发生变化'); expect(request).not.toHaveBeenCalled();
    await expect(transfer.applyBatch(input)).rejects.toThrow('预览已失效');
  });

  it.each(connectionReplacementAcknowledgements)('缺少风险%s不执行，重复/未知风险拒绝且失败令牌消费', async missing => {
    const value = await preview(), input = reviewInput(value.previewToken);
    await expect(transfer.applyBatch({ ...input, acknowledgements: input.acknowledgements!.filter(id => id !== missing) })).rejects.toThrow('逐项确认');
    await expect(transfer.applyBatch(input)).rejects.toThrow('预览已失效'); expect(request).not.toHaveBeenCalled();
  });

  it('重新审阅A→B→A、显式撤销和迟到释放不会复活旧确认', async () => {
    let value = await preview(), first = reviewInput(value.previewToken);
    transfer.review({ previewToken: value.previewToken, decisions: [replacement('source-a', 'target-b')] }); const fresh = reviewInput(value.previewToken);
    transfer.releaseReview({ previewToken: value.previewToken, confirmationToken: first.confirmationToken! });
    await expect(transfer.applyBatch(fresh)).resolves.toMatchObject({ replaced: 1 });
    value = await preview(); first = reviewInput(value.previewToken); transfer.releaseReview({ previewToken: value.previewToken, confirmationToken: first.confirmationToken! });
    await expect(transfer.applyBatch(first)).rejects.toThrow('确认已失效');
  });

  it('晚审阅不延长原十分钟期限，同一预览的多次确认不扩大四份快照预算', async () => {
    const value = await preview(); now += 9 * 60 * 1000;
    const review = transfer.review({ previewToken: value.previewToken, decisions: [replacement()] }); expect(review.expiresAt).toBe(value.expiresAt);
    for (let index = 0; index < 8; index++) transfer.review({ previewToken: value.previewToken, decisions: [replacement()] });
    const fresh = reviewInput(value.previewToken); now += 60 * 1000; await expect(transfer.applyBatch(fresh)).rejects.toThrow('预览已失效');
    const first = await preview(), firstInput = reviewInput(first.previewToken); for (let index = 0; index < 4; index++) await preview();
    await expect(transfer.applyBatch(firstInput)).rejects.toThrow('预览已失效'); expect(request).not.toHaveBeenCalled();
  });

  it('磁盘失败整批回滚概要/持久及会话秘密/版本，之后保存不夹带失败新增，旧令牌不可重放', async () => {
    const value = await preview([incoming(), incoming('source-add')]), input = reviewInput(value.previewToken, [replacement(), { sourceId: 'source-add', action: 'add' }]);
    const before = readFileSync(file), publicBefore = store.connections(), revision = store.connectionRevision();
    mkdirSync(file + '.tmp');
    await expect(transfer.applyBatch(input)).rejects.toThrow('修改未保存');
    expect(readFileSync(file)).toEqual(before); expect(store.connections()).toEqual(publicBefore); expect(store.connectionRevision()).toBe(revision); expect(store.resolveConnection(original.id).password).toBe(original.password); expect(store.resolveConnection('target-b').password).toBe(original.password);
    expect(files.get('old-key')?.revokedConnections).toBeUndefined(); expect(() => manager.assertAvailable(original.id)).not.toThrow();
    await expect(transfer.applyBatch(input)).rejects.toThrow('预览已失效');
    rmdirSync(file + '.tmp'); store.saveSettings(store.settings()); expect(store.connections()).toHaveLength(2);
  });

  it('全部目标先占锁；跨进程等待期间同目标保存被拒，其他连接修改令CAS失败而不重试', async () => {
    const value = await preview([incoming(), incoming('source-b')]), input = reviewInput(value.previewToken, [replacement(), replacement('source-b', 'target-b')]);
    let finish!: () => void; request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const applying = transfer.applyBatch(input);
    expect(() => manager.assertAvailable('target-a')).toThrow('正在保存'); expect(() => manager.assertAvailable('target-b')).toThrow('正在保存');
    await expect(manager.save({ ...store.connections()[0], host: 'concurrent.invalid' })).rejects.toThrow('正在保存');
    store.saveConnection({ ...original, id: 'unrelated', host: 'unrelated.invalid', password: '' }); finish();
    await expect(applying).rejects.toThrow('配置已变化'); expect(store.connections().find(profile => profile.id === original.id)!.host).toBe('old.invalid'); expect(request).toHaveBeenCalledOnce();
    expect(() => manager.assertAvailable(original.id)).not.toThrow(); await expect(transfer.applyBatch(input)).rejects.toThrow('预览已失效');
  });

  it('两个已审阅批次并发替换同目标时第二批消费后拒绝，不能释放第一批锁或重复提交', async () => {
    const first = reviewInput((await preview()).previewToken), second = reviewInput((await preview()).previewToken), revision = store.connectionRevision();
    let finish!: () => void; request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })); const pending = transfer.applyBatch(first);
    await expect(transfer.applyBatch(second)).rejects.toThrow('正在保存'); expect(() => manager.assertAvailable(original.id)).toThrow('正在保存');
    finish(); await expect(pending).resolves.toMatchObject({ replaced: 1 }); expect(store.connectionRevision()).toBe(revision + 1); expect(request).toHaveBeenCalledOnce();
    await expect(transfer.applyBatch(second)).rejects.toThrow('预览已失效'); expect(() => manager.assertAvailable(original.id)).not.toThrow();
  });

  it('检查等待期间过期、旧概要不符及缺少替换屏障均不写入', async () => {
    const value = await preview(), input = reviewInput(value.previewToken); let finish!: () => void;
    request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })); const applying = transfer.applyBatch(input); now += 10 * 60 * 1000; finish();
    await expect(applying).rejects.toThrow('确认已失效'); expect(store.connections()[0].host).toBe('old.invalid');
    expect(() => store.importConnections([incoming()], true, { expectedRevision: store.connectionRevision(), replacements: [{ sourceId: 'source-a', targetId: original.id, previous: { ...exportConnectionProfile(original), host: 'stale.invalid' } }] })).toThrow('旧概要');
    transfer = new ConnectionTransfer(store); const plain = await preview(), noGuard = reviewInput(plain.previewToken); await expect(transfer.applyBatch(noGuard)).rejects.toThrow('主进程活动检查');
  });

  it('缺认证文件不静默消失；未知/路径/多余目标/未知风险输入由严格白名单拒绝', async () => {
    const value = await preview(), input = reviewInput(value.previewToken);
    await expect(transfer.applyBatch({ ...input, allowIncomplete: false })).rejects.toThrow('明确确认暂存');
    for (const decision of [{ sourceId: 'x', action: 'replace' }, { sourceId: 'x', action: 'add', targetId: original.id }, { sourceId: 'x', action: 'replace', targetId: original.id + '\0other' }, { sourceId: 'x', action: 'replace', targetId: original.id, profile: incoming() }]) expect(() => validateCommand('connections.importReview', { previewToken: 'x', decisions: [decision] })).toThrow();
    expect(() => validateCommand('connections.importApply', { ...input, acknowledgements: ['unknown'] })).toThrow();
    expect(() => validateCommand('connections.importReviewRelease', { previewToken: 'x', confirmationToken: 'y', path: '不应接受路径' })).toThrow();
  });
});
