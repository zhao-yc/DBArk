import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readQueryFileSnapshot, QueryFileSourceFailure, type QueryFileSnapshot } from './queryFileSourceFiles';
import { queryFileReloadZh as text } from '../shared/queryFileReload.zh-CN';

export interface QueryFileParentIdentity { path: string; dev: string; ino: string; }
/** 授权目录必须仍是原规范路径上的普通目录；符号链接、未知inode和父目录替换均拒绝。 */
export async function queryFileParent(path: string, check: () => void): Promise<QueryFileParentIdentity> {
  const parent = dirname(path), canonical = await realpath(parent); check();
  const stat = await lstat(parent, { bigint: true }); check();
  if (canonical !== parent || !stat.isDirectory() || stat.isSymbolicLink() || stat.ino <= 0n) throw new QueryFileSourceFailure('identity-changed', text.identity);
  return { path: canonical, dev: String(stat.dev), ino: String(stat.ino) };
}
export function sameQueryFileParent(a: QueryFileParentIdentity, b: QueryFileParentIdentity) { return a.path === b.path && a.dev === b.dev && a.ino === b.ino; }
/** 原读取政策完整复用；目录先后身份与规范文件路径额外绑定，不把文件原子替换误作任意路径权限。 */
export async function readReloadableQueryFile(path: string, check: () => void, progress?: Parameters<typeof readQueryFileSnapshot>[2]): Promise<QueryFileSnapshot & { parent: QueryFileParentIdentity }> {
  const parent = await queryFileParent(path, check), snapshot = await readQueryFileSnapshot(path, check, progress); check();
  const after = await queryFileParent(path, check); check();
  if (!sameQueryFileParent(parent, after) || snapshot.path !== path) throw new QueryFileSourceFailure('identity-changed', text.identity);
  return { ...snapshot, parent };
}
