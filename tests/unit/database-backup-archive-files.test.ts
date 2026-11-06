import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseBackupArchiveFiles } from '../../src/main/databaseBackupArchiveFiles';
import { namedBackupArchiveRevision } from '../../src/engine/databaseBackupArchiveFile';
import { withVerifiedMysqlArchiveDump } from '../../src/engine/mysqlBackupArchiveRestore';
import type { DatabaseBackupRestoreTargetAudit } from '../../src/shared/databaseBackupArchiveFiles';
import { validateCommand } from '../../src/shared/validation';
import { makeDatabaseBackupArchive } from '../helpers/databaseBackupArchiveFixture';

let directory: string, source: string, target: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-archive-files-test-'));
  source = join(directory, '归档.dbark-backup.zip'); target = join(directory, '原始.sql');
});
afterEach(async context => {
  if (context.task.result?.state !== 'fail') await rm(directory, { recursive: true, force: true });
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function files(onCheck: (path: string) => Promise<void> = async () => {}) {
  return new DatabaseBackupArchiveFiles({
    assert: (_owner: string) => {},
    same: (left, right) => left === right,
    async choose(_owner, action) { return action === 'open' ? source : target; },
    async reserve() { return () => {}; },
    assertDestination: onCheck,
  });
}

describe('备份归档检查及无覆盖 SQL 导出', () => {
  it.each(['mysql', 'mariadb'] as const)('真实磁盘 %s 归档逐字节导出，摘要与独立计算一致', async family => {
    const sql = Buffer.concat([Buffer.from('INSERT INTO ledger VALUES(18446744073709551615, 0x00FF);\r\nDELIMITER $$\n'), Buffer.from([0, 128, 255]), Buffer.alloc(85000, 0x61)]);
    const bytes = await makeDatabaseBackupArchive(sql, family);
    await writeFile(source, bytes);
    const owner = files(), view = (await owner.open('window', 'inspect'))!;
    expect(view.manifest.family).toBe(family);
    expect(view.manifest.restoreVerified).toBe(false);
    expect(view.archive.sha256).toBe(hash(bytes));
    expect(view.manifest.dump.sha256).toBe(hash(sql));
    expect(await owner.export('window', 'export', view.token)).toEqual({ name: '原始.sql', bytes: String(sql.length), sha256: hash(sql), cleanupPending: false });
    expect(await readFile(target)).toEqual(sql);
    expect(await readFile(source)).toEqual(bytes);
    if (process.platform !== 'win32') expect((await lstat(target)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).sort()).toEqual(['原始.sql', '归档.dbark-backup.zip'].sort());
  });

  it('跨窗口令牌、换包和损坏归档均无法发布 SQL', async () => {
    const initial = await makeDatabaseBackupArchive(Buffer.from('SELECT 1;'));
    await writeFile(source, initial);
    const owner = files(), view = (await owner.open('window', 'inspect'))!;
    await expect(owner.export('another-window', 'foreign', view.token)).rejects.toThrow('已变化');
    await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 2;')));
    await expect(owner.export('window', 'changed', view.token)).rejects.toThrow('已变化');
    const damaged = Buffer.from(initial);
    damaged[60] ^= 1;
    await writeFile(source, damaged);
    await expect(owner.open('window', 'damaged')).rejects.toThrow('CRC');
    expect(await readdir(directory)).toEqual(['归档.dbark-backup.zip']);
  });

  it('完整暂存后的并发占用及取消不会覆盖或发布目标', async () => {
    await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 1;')));
    let checks = 0;
    const collision = files(async path => {
      if (++checks === 2) await writeFile(path, '竞争者内容', { flag: 'wx' });
    });
    const first = (await collision.open('window', 'inspect'))!;
    await expect(collision.export('window', 'collision', first.token)).rejects.toThrow('已存在');
    expect(await readFile(target, 'utf8')).toBe('竞争者内容');
    expect(await readdir(directory)).toHaveLength(2);

    target = join(directory, '取消.sql'); checks = 0;
    const cancelled = files(async () => { if (++checks === 2) cancelled.cancel('window', 'cancelled'); });
    const second = (await cancelled.open('window', 'inspect'))!;
    await expect(cancelled.export('window', 'cancelled', second.token)).rejects.toThrow('已取消');
    expect(await readdir(directory)).toHaveLength(2);
  });

  it('归档桥接仅接收任务号和已核令牌', () => {
    expect(validateCommand('backupArchive.open', { operationId: 'job' })).toEqual({ operationId: 'job' });
    expect(() => validateCommand('backupArchive.open', { operationId: 'job', path: source })).toThrow();
    expect(() => validateCommand('backupArchive.exportSql', { operationId: 'job', token: 'archive', path: target })).toThrow();
    expect(() => validateCommand('backupArchive.inspectSql', { operationId: 'job', token: 'archive', sql: 'SELECT 1' })).toThrow();
    expect(validateCommand('backupArchive.auditTarget', { operationId: 'job', token: 'archive', connectionId: 'saved' }))
      .toEqual({ operationId: 'job', token: 'archive', connectionId: 'saved' });
    expect(() => validateCommand('backupArchive.auditTarget', { operationId: 'job', token: 'archive', connectionId: 'saved', manifest: {} })).toThrow();
    const restore = { operationId: 'job', token: 'archive', connectionId: 'saved', acknowledgeScript: true };
    expect(validateCommand('backupArchive.restore', restore)).toEqual(restore);
    expect(() => validateCommand('backupArchive.restore', { ...restore, acknowledgeScript: false })).toThrow();
    expect(() => validateCommand('backupArchive.restore', { ...restore, source })).toThrow();
  });

  it('恢复授权绑定原窗口、归档和已审核的连接版本，只消费一次，取消收尾错误不覆盖原回执', async () => {
    await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 1;')));
    const owner = files(), view = (await owner.open('window', 'inspect'))!;
    const start = deferred(), finish = deferred(), receipt = { rows: 1, errors: [] };
    const execute = vi.fn<Parameters<DatabaseBackupArchiveFiles<string>['restore']>[4]>(async (input, registerStop) => {
      expect(input).toEqual({ path: source, revision: await namedBackupArchiveRevision(source), sha256: view.archive.sha256, dumpBytes: '9' });
      registerStop(async () => { throw Error('取消控制连接故障'); });
      start.resolve(); await finish.promise;
      return receipt;
    });
    const report: DatabaseBackupRestoreTargetAudit = { family: 'mysql', version: '8.4.11', versionMatches: true, database: view.manifest.database,
      actualDatabase: null, state: 'absent', visible: null, scheduler: 'disabled', blockers: [] };
    await expect(owner.restore('window', 'unchecked', view.token, 'saved:1', execute)).rejects.toThrow('重新检查');
    await owner.auditTarget('window', 'audit', view.token, async () => report, 'saved:1');
    await expect(owner.restore('other', 'foreign', view.token, 'saved:1', execute)).rejects.toThrow('已变化');
    await expect(owner.restore('window', 'changed', view.token, 'saved:2', execute)).rejects.toThrow('重新检查');
    expect(execute).not.toHaveBeenCalled();
    const operation = owner.restore('window', 'restore', view.token, 'saved:1', execute);
    await start.promise;
    await expect(owner.cancel('window', 'restore')).rejects.toThrow('取消控制连接故障');
    finish.resolve();
    await expect(operation).resolves.toEqual(receipt);
    await expect(owner.restore('window', 'again', view.token, 'saved:1', execute)).rejects.toThrow('重新检查');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('复核整个归档后才交付 SQL，执行期间换包则停止交付后续分块', async () => {
    const prefix = '/*M!999999\\- enable the sandbox mode */';
    const sql = Buffer.from(prefix + '\r\nSELECT 1;\n' + ' '.repeat(65536) + 'SELECT 2;');
    const archive = await makeDatabaseBackupArchive(sql, 'mariadb');
    await writeFile(source, archive);
    const ticket = { path: source, revision: await namedBackupArchiveRevision(source), sha256: hash(archive), dumpBytes: String(sql.length) };
    const read = vi.fn<Parameters<typeof withVerifiedMysqlArchiveDump<void>>[2]>(async (_manifest, chunks) => {
      expect((await chunks.next()).value).toMatch(new RegExp('^ {' + prefix.length + '}\\r\\nSELECT 1;'));
      await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 3;')));
      await expect(chunks.next()).rejects.toThrow('已变化');
    });
    await expect(withVerifiedMysqlArchiveDump({ ...ticket, sha256: '0'.repeat(64) }, () => {}, read)).rejects.toThrow('已变化');
    expect(read).not.toHaveBeenCalled();
    await withVerifiedMysqlArchiveDump(ticket, () => {}, read);
    await expect(withVerifiedMysqlArchiveDump(ticket, () => {}, read)).rejects.toThrow('已变化');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('SQL 对象结果只发布给原窗口的原归档，检查不创建新文件', async () => {
    const database = '测试库', bytes = await makeDatabaseBackupArchive(Buffer.from(
      'CREATE DATABASE `测试库`; USE `测试库`; CREATE TABLE ledger(id INT);'), 'mysql', database);
    await writeFile(source, bytes);
    const owner = files(), view = (await owner.open('window', 'inspect'))!;
    await expect(owner.inspectSql('other-window', 'foreign', view.token)).rejects.toThrow('已变化');
    await expect(owner.inspectSql('window', 'sql', view.token)).resolves.toMatchObject({ state: 'matches', definitions: 2 });
    expect(await readFile(source)).toEqual(bytes);
    expect(await readdir(directory)).toEqual(['归档.dbark-backup.zip']);
    await writeFile(source, Buffer.from('已替换'));
    await expect(owner.inspectSql('window', 'stale', view.token)).rejects.toThrow('已变化');
  });

  it('目标检查绑定原窗口和文件代次，取消等待原连接收尾', async () => {
    await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 1;'), 'mysql', '测试库'));
    const owner = files(), view = (await owner.open('window', 'inspect'))!;
    const report: DatabaseBackupRestoreTargetAudit = { family: 'mysql', version: '8.4.11', versionMatches: true, database: '测试库',
      actualDatabase: null, state: 'absent', visible: null, scheduler: 'disabled', blockers: [] };
    const read = vi.fn(async () => report);
    await expect(owner.auditTarget('other-window', 'foreign', view.token, read)).rejects.toThrow('已变化');
    expect(read).not.toHaveBeenCalled();

    const started = deferred(), backend = deferred(), stopping = deferred();
    const stop = vi.fn(() => stopping.promise);
    const running = owner.auditTarget('window', 'audit', view.token, async (manifest, registerStop) => {
      expect(manifest.database).toBe('测试库');
      registerStop(stop); started.resolve();
      await backend.promise;
      return report;
    });
    await started.promise;
    await owner.cancel('other-window', 'audit');
    expect(stop).not.toHaveBeenCalled();
    const cancel = owner.cancel('window', 'audit');
    const repeated = owner.cancel('window', 'audit');
    expect(stop).toHaveBeenCalledTimes(1);
    backend.resolve();
    await expect(owner.open('window', 'overlap')).rejects.toThrow('尚未完成');
    const rejected = expect(running).rejects.toThrow('已取消');
    stopping.resolve();
    await Promise.all([cancel, repeated, rejected]);
    await expect(owner.auditTarget('window', 'replace', view.token, async () => {
      await writeFile(source, await makeDatabaseBackupArchive(Buffer.from('SELECT 2;')));
      return report;
    })).rejects.toThrow('已变化');
  });
});
