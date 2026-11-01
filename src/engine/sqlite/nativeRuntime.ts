import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { SqliteRawInvoke } from './rawStatement';

export const sqliteNativeFunction = 'dbark_raw_probe_v1';
const invalid = () => Error('SQLite固定原生资源缺少、损坏或不适用于当前平台');

/** asar内的JS只加载对应unpacked固定目录；不接收环境、连接配置或数据库给出的库路径。 */
export function sqliteNativeDirectory(base = __dirname): string {
  return join(base.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'), 'sqlite-native');
}

/** 清单与内容寻址文件均校验，拒绝链接及目录逃逸；资源验证发生在数据库打开前。 */
export function resolveSqliteNativeResource(directory = sqliteNativeDirectory()): string {
  const root = realpathSync.native(directory), manifestPath = join(root, 'manifest.json');
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink() || lstatSync(manifestPath).size > 16384) throw invalid();
  const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const extension = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : process.platform === 'linux' ? 'so' : undefined;
  if (!extension || value.version !== 1 || value.platform !== process.platform || !Array.isArray(value.architectures) || !value.architectures.includes(process.arch) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || value.file !== 'dbark-sqlite-' + value.sha256 + '.' + extension || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 8 * 1024 * 1024) throw invalid();
  const file = join(root, value.file as string), stat = lstatSync(file), actual = realpathSync.native(file), child = relative(root, actual);
  if (!stat.isFile() || stat.isSymbolicLink() || child.startsWith('..') || isAbsolute(child) || stat.size !== value.bytes || createHash('sha256').update(readFileSync(actual)).digest('hex') !== value.sha256) throw invalid();
  return actual;
}

/** 固定SQL编译阶段单独声明；原用户SQL的prepare发生在该阶段结束之后，不能借内部许可。 */
export function createSqliteNativeInvoke(db: DatabaseSync, preparing: (value: boolean) => void): SqliteRawInvoke {
  return (operation: number, value: SQLInputValue) => {
    let statement;
    try { preparing(true); statement = db.prepare('SELECT ' + sqliteNativeFunction + '(?,?)'); statement.setReturnArrays(true); }
    finally { preparing(false); }
    const row = statement.get(BigInt(operation), value) as unknown;
    if (!Array.isArray(row) || row.length !== 1) throw Error('SQLite固定原生控制回包无效'); return row[0];
  };
}
