import { constants, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { databaseBackupArchiveZh as text } from '../shared/databaseBackupArchiveFiles';
import { databaseBackupArchiveLimits, type DatabaseBackupArchiveReader } from './databaseBackupArchive';

export function backupArchiveRevision(stat: BigIntStats): string {
  if (!stat.isFile() || stat.size > databaseBackupArchiveLimits.archiveBytes) throw Error(text.stale);
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export async function namedBackupArchiveRevision(path: string): Promise<string> {
  return backupArchiveRevision(await lstat(path, { bigint: true }).catch(() => { throw Error(text.stale); }));
}

/** 固定只读句柄，核验路径和句柄仍指向同一代普通文件。POSIX 禁止跟随链接或阻塞设备。 */
export async function withBackupArchiveFile<T>(path: string, check: () => void, expectedRevision: string | undefined,
  work: (reader: DatabaseBackupArchiveReader, assertCurrent: () => Promise<void>, revision: string) => Promise<T>): Promise<T> {
  check();
  if (!isAbsolute(path) || path.includes('\0')) throw Error('请选择有效的普通归档文件或新的 SQL 文件名');
  const initial = await lstat(path, { bigint: true }).catch(() => { throw Error(text.stale); });
  const revision = backupArchiveRevision(initial);
  check();
  if (expectedRevision !== undefined && expectedRevision !== revision) throw Error(text.stale);
  const flags = process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(path, flags);
  try {
    const assertCurrent = async () => {
      check();
      if (backupArchiveRevision(await handle.stat({ bigint: true })) !== revision ||
        await namedBackupArchiveRevision(path) !== revision) throw Error(text.stale);
      check();
    };
    await assertCurrent();
    return await work({
      size: initial.size,
      async read(offset, length) {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, Number(offset));
        return buffer.subarray(0, bytesRead);
      }
    }, assertCurrent, revision);
  } finally { await handle.close(); }
}
