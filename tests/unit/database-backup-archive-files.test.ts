import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseBackupArchiveFiles } from '../../src/main/databaseBackupArchiveFiles';
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
  });
});
