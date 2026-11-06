import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SqliteFileIdentity } from './protocol';

/** 只读取普通文件的身份。Worker 与 Main 在处理前后均核对同一个文件。 */
export function sqliteBackupFileIdentity(path: string): SqliteFileIdentity {
  if (!isAbsolute(path) || path.includes('\0')) throw Error('SQLite 文件路径无效');
  const actual = realpathSync(path), stat = lstatSync(actual, { bigint: true });
  if (!stat.isFile()) throw Error('SQLite 来源或暂存文件不可用');
  return { path: actual, device: stat.dev.toString(), inode: stat.ino.toString() };
}

export function assertSqliteBackupFile(expected: SqliteFileIdentity): void {
  const actual = sqliteBackupFileIdentity(expected.path);
  if (actual.path !== expected.path || actual.device !== expected.device || actual.inode !== expected.inode)
    throw Error('SQLite 来源或暂存文件已被替换');
}

/** 固定一个只读事务快照，纳入已提交 WAL 页。备份格式为可独立打开的 SQLite 主库。 */
export async function copySqliteDatabase(source: SqliteFileIdentity, staging: SqliteFileIdentity): Promise<void> {
  const { backup, DatabaseSync } = await import('node:sqlite');
  assertSqliteBackupFile(source);
  assertSqliteBackupFile(staging);
  if (source.device === staging.device && source.inode === staging.inode) throw Error('SQLite 来源与暂存文件相同');
  const reader = new DatabaseSync(source.path, { readOnly: true, timeout: 5000, allowExtension: false });
  try {
    assertSqliteBackupFile(source);
    reader.exec('PRAGMA trusted_schema=OFF; BEGIN');
    reader.prepare('SELECT name FROM main.sqlite_schema LIMIT 1').get();
    if (await backup(reader, staging.path, { rate: 128 }) < 1) throw Error('SQLite 备份未返回完整页');
    assertSqliteBackupFile(source);
  } finally { reader.close(); }

  assertSqliteBackupFile(staging);
  const output = new DatabaseSync(staging.path, { allowExtension: false });
  try {
    output.exec('PRAGMA trusted_schema=OFF');
    const mode = output.prepare('PRAGMA journal_mode=DELETE').get();
    const integrity = output.prepare('PRAGMA integrity_check(1)').get();
    if (mode?.journal_mode !== 'delete' || integrity?.integrity_check !== 'ok') throw Error('SQLite 副本完整性检查未通过');
  } finally { output.close(); }
  assertSqliteBackupFile(staging);
}
