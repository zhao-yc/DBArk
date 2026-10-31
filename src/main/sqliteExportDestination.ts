import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ConnectionProfile } from '../shared/contracts';

/** 已失效的其它连接路径仍按字面保护；源目录暂不存在不能使现存导出全部失效。 */
async function canonical(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (reason) {
    if (!['ENOENT', 'ENOTDIR'].includes((reason as NodeJS.ErrnoException).code ?? '')) throw reason;
    try { return join(await realpath(dirname(absolute)), basename(absolute)); }
    catch (parent) { if (['ENOENT', 'ENOTDIR'].includes((parent as NodeJS.ErrnoException).code ?? '')) return absolute; throw parent; }
  }
}
/** 文件对象身份用于拦截不同名称的硬链接；不读数据库内容或凭据。 */
async function identity(path: string): Promise<string | undefined> {
  try { const value = await stat(path, { bigint: true }); return value.isFile() ? `${value.dev}:${value.ino}` : undefined; }
  catch (reason) { if (['ENOENT', 'ENOTDIR'].includes((reason as NodeJS.ErrnoException).code ?? '')) return undefined; throw reason; }
}
/** 文件令牌只授权指定目标，不能让表导出销毁任一已保存SQLite库或其日志文件。 */
export async function assertSqliteExportDestination(target: string, profiles: readonly ConnectionProfile[]): Promise<void> {
  if (!target || target.includes('\0')) throw Error('SQLite导出目标无效，请重新选择文件');
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const targetName = normalize(await canonical(target)), targetIdentity = await identity(target);
  for (const profile of profiles) {
    if (profile.dialect !== 'sqlite' || !profile.sqlite.filePath) continue;
    const source = profile.sqlite.filePath, actual = await canonical(source);
    // 同时保护用户路径与真实文件名对应的sidecar，避免目录或文件链接绕过。
    for (const path of new Set([source, actual].flatMap(name => [name, name + '-wal', name + '-shm', name + '-journal']))) {
      if (normalize(await canonical(path)) === targetName || targetIdentity !== undefined && await identity(path) === targetIdentity) throw Error('导出目标属于已保存的SQLite数据库或日志文件，请选择其他文件');
    }
  }
}
