import { randomUUID } from 'node:crypto';
import { linkSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { assertSqliteBackupFile, sqliteBackupFileIdentity } from '../engine/sqlite/backup';
import { sqliteDriverLimits, type SqliteFileIdentity, type SqliteProcessTransport } from '../engine/sqlite/protocol';
import { createSqliteProcess } from './sqliteProcess';
import { sqliteDatabaseCopyZh } from '../shared/sqliteDatabaseBackup';

const seedName = 'snapshot.sqlite';
const logs = ['-journal', '-wal', '-shm'];
const timeoutMs = 5 * 60_000;
const timeout = () => Error('SQLite 整库复制超时，目标文件未发布');
const cancelled = () => Error(sqliteDatabaseCopyZh.cancelled);
const processes = new Set<SqliteProcessTransport>();

interface BackupOptions {
  assertOwner(): void;
  signal: AbortSignal;
  createTransport?: () => SqliteProcessTransport;
}

function assertAbsent(path: string): void {
  for (const name of [path, ...logs.map(suffix => path + suffix)]) {
    try { lstatSync(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw Error('目标文件或 SQLite 日志已存在，请选择新文件名');
  }
}

/** 校验目标目录仍为保存时选中的目录，临时文件与目标同卷，才能独占原子发布。 */
function directoryGuard(path: string): () => void {
  const initial = lstatSync(path, { bigint: true });
  return () => {
    const current = lstatSync(path, { bigint: true });
    if (!current.isDirectory() || current.dev !== initial.dev || current.ino !== initial.ino)
      throw Error('SQLite 目标目录已变化');
  };
}

/** 只清理本次私有目录中的 SQLite 文件。遇到未知文件或身份变化时保留现场。 */
function clearStaging(directory: string, guard: () => void, staging?: SqliteFileIdentity): void {
  guard();
  const entries = readdirSync(directory);
  if (entries.some(name => name !== seedName && !logs.some(suffix => name === seedName + suffix)))
    throw Error('SQLite 暂存目录中有未知文件');
  for (const name of entries) {
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw Error('SQLite 暂存文件身份无效');
    if (name === seedName) {
      if (!staging) throw Error('SQLite 暂存文件身份未确认');
      assertSqliteBackupFile(staging);
    }
  }
  for (const name of entries) { guard(); unlinkSync(join(directory, name)); }
  guard(); rmdirSync(directory);
}

/** 仅正常退出且收到完整性回执才允许发布。取消和超时只终止本次独立进程。 */
async function runBackup(transport: SqliteProcessTransport, source: SqliteFileIdentity, staging: SqliteFileIdentity, signal: AbortSignal): Promise<void> {
  const id = randomUUID();
  let sent = false, verified = false, remove = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      timer = setTimeout(() => reject(timeout()), timeoutMs);
      timer.unref();
      remove = transport.onMessage(message => {
        try {
          if (!sent && message.kind === 'ready' && !signal.aborted) {
            sent = true; transport.send({ kind: 'backupFile', id, source, staging });
          } else if (sent && message.kind === 'backupFileFinished' && message.id === id) {
            verified = message.verified === true; transport.send({ kind: 'closeAck', id });
          }
        } catch { reject(Error('SQLite 整库复制进程通信失败')); }
      });
    });
    const exit = await Promise.race([transport.exited, interrupted]);
    if (exit.code !== 0 || exit.signal !== null || !verified) throw Error('SQLite 整库复制或完整性检查失败，目标文件未发布');
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', onAbort); remove();
  }
}

/** 等待准确进程句柄退出，超过收尾时限时仍保留该进程的归属。 */
async function stopBackup(transport: SqliteProcessTransport): Promise<void> {
  try { transport.terminate(); } catch { /* 等待原进程退出。 */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([transport.exited, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('SQLite 整库复制进程退出未确认')), sqliteDriverLimits.exitTimeoutMs);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

/** 正常和强制退出均只重试仍未退出的原复制进程。 */
export async function closeSqliteDatabaseCopies(): Promise<void> {
  await Promise.all([...processes].map(stopBackup));
}

/** 完整副本经 fsync 后才用硬链接发布；目标出现并发文件时，原子失败且保留对方文件。 */
export async function publishSqliteDatabaseCopy(source: SqliteFileIdentity, destination: string, options: BackupOptions): Promise<{ name: string; cleanupPending: boolean }> {
  const assertCurrent = () => { if (options.signal.aborted) throw cancelled(); options.assertOwner(); };
  assertCurrent();
  if (processes.size) throw Error('上一次 SQLite 整库复制进程尚未退出');
  assertSqliteBackupFile(source);
  if (!isAbsolute(destination) || destination.includes('\0') || /-(?:wal|shm|journal)$/i.test(destination)) throw Error('请选择有效的 SQLite 主库文件名');
  const parent = realpathSync(dirname(destination)), target = join(parent, basename(destination));
  const assertDirectory = directoryGuard(parent);
  assertAbsent(target);
  const directory = mkdtempSync(join(parent, '.dbark-sqlite-copy-')), assertStaging = directoryGuard(directory);
  let staging: SqliteFileIdentity | undefined, transport: SqliteProcessTransport | undefined, exited = false;
  let failure: unknown, cleanupPending = false, published = false;
  try {
    const seed = await open(join(directory, seedName), 'wx', 0o600);
    try {
      assertStaging();
      const stat = await seed.stat({ bigint: true });
      staging = sqliteBackupFileIdentity(join(directory, seedName));
      if (stat.dev.toString() !== staging.device || stat.ino.toString() !== staging.inode) {
        staging = undefined;
        throw Error('SQLite 暂存文件已被替换');
      }
    } finally { await seed.close(); }
    assertCurrent();
    transport = (options.createTransport ?? createSqliteProcess)();
    const owned = transport; processes.add(owned);
    void owned.exited.then(() => { exited = true; processes.delete(owned); });
    await runBackup(transport, source, staging, options.signal);
    const file = await open(staging.path, 'r+');
    try {
      const stat = await file.stat({ bigint: true });
      if (stat.dev.toString() !== staging.device || stat.ino.toString() !== staging.inode || stat.size < 512n) throw Error('SQLite 暂存副本身份或大小无效');
      await file.sync();
    } finally { await file.close(); }
    assertCurrent(); assertDirectory(); assertStaging();
    if (realpathSync(dirname(destination)) !== parent || readdirSync(directory).some(name => name !== seedName))
      throw Error('SQLite 暂存副本或目标目录已变化');
    assertSqliteBackupFile(source); assertSqliteBackupFile(staging);
    assertAbsent(target);
    linkSync(staging.path, target);
    published = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    failure = code === 'EEXIST' ? Error('目标文件已存在，请选择新文件名') :
      code ? Error('SQLite 文件操作失败，目标文件未发布。请核对目录权限、可用空间及文件系统的硬链接支持') : error;
  } finally {
    if (transport && !exited) {
      try { await stopBackup(transport); } catch { /* 保留未确认退出的进程与暂存文件。 */ }
    }
    const clear = () => clearStaging(directory, assertStaging, staging);
    if (!transport || exited) {
      try { clear(); } catch { cleanupPending = true; }
    } else {
      cleanupPending = true;
      void transport.exited.then(clear).catch(() => {});
    }
  }
  if (cleanupPending && !published) throw Error('SQLite 目标文件未发布，部分暂存资源的清理未确认');
  if (!published) throw failure ?? Error(sqliteDatabaseCopyZh.failed);
  return { name: basename(target), cleanupPending };
}
