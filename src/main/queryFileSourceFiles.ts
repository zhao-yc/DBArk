import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, rm } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { QueryFileEncoding } from '../shared/contracts';
import { queryFileSourceLimits, queryFileSourceDigestPayload, type QueryFileBom, type QueryFileEol, type QueryFileEolPolicy, type QueryFileSourceReason } from '../shared/queryFileSources';
import { decodeQueryFile, encodeQueryFile } from './queryFiles';
import type { PrivateQueryFileSource } from './queryFileSourceRecords';

export class QueryFileSourceFailure extends Error {
  /** 固定原因与中文消息，不把系统路径、SQL或原始IO异常透传至IPC。 */
  constructor(readonly reason: QueryFileSourceReason, message: string) { super(message); }
}
export interface QueryFileSnapshot { path: string; bytes: Buffer; identity: PrivateQueryFileSource['identity']; mode: number; digest: string; parent?: { path: string; dev: string; ino: string }; }
export type QueryFileIoProgress = (phase: 'reading' | 'checking' | 'staging' | 'replacing' | 'verifying', bytes: number, total: number) => void;
/** SQL基线以点击时完整正文计算，不经过Number、JSON解析或换行归一化。 */
export function queryFileSqlDigest(sql: string): string { return createHash('sha256').update(queryFileSourceDigestPayload(sql)).digest('hex'); }
/** 字节摘要与正文摘要分开，BOM和换行原字节进入外改检测。 */
export function queryFileBytesDigest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
/** 统计三类真实行尾；混合格式不自动选择多数风格。 */
export function queryFileEol(sql: string): QueryFileEol {
  let found: QueryFileEol = 'none';
  // 最多单遍扫描正文，不为两千万个换行分配正则匹配数组。
  for (let index = 0; index < sql.length; index++) {
    const code = sql.charCodeAt(index); if (code !== 10 && code !== 13) continue;
    const current = code === 10 ? 'lf' : sql.charCodeAt(index + 1) === 10 ? 'crlf' : 'cr';
    if (current === 'crlf') index++;
    if (found !== 'none' && found !== current) return 'mixed'; found = current;
  }
  return found;
}
/** 读取BOM只用于保留；解码仍沿既有三编码无损与大小门。 */
export function queryFileBom(bytes: Buffer): QueryFileBom {
  return bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 'utf8' : bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? 'utf16le' : 'none';
}
/** 只接受单链接普通文件及可证明inode，拒绝符号链接和无法证明的物理身份。 */
function identity(stat: BigIntStats): PrivateQueryFileSource['identity'] {
  if (!stat.isFile() || stat.nlink !== 1n || stat.ino <= 0n) throw new QueryFileSourceFailure('identity-changed', '文件物理身份不在可证明范围，请另存到普通文件');
  if (stat.size > BigInt(queryFileSourceLimits.bytes)) throw new QueryFileSourceFailure('io', 'SQL文件超过20MiB，未读写文件正文');
  return { dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) };
}
/** 完整版本包含物理身份及修改时钟，不能仅靠路径/长度判定相同文件。 */
export function sameQueryFileVersion(left: QueryFileSnapshot['identity'], right: QueryFileSnapshot['identity']): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtime === right.mtime && left.ctime === right.ctime;
}
/** 有界读取前后核句柄与路径身份；每次await后先核原文档，不跟随迟到授权。 */
export async function readQueryFileSnapshot(path: string, check: () => void, progress?: QueryFileIoProgress): Promise<QueryFileSnapshot> {
  const before = await lstat(path, { bigint: true }); check(); const first = identity(before);
  progress?.('reading', 0, first.size); check();
  const canonical = await realpath(path); check();
  const handle = await open(canonical, 'r');
  let result: QueryFileSnapshot;
  try {
    check(); const start = await handle.stat({ bigint: true }); check();
    if (!sameQueryFileVersion(first, identity(start))) throw new QueryFileSourceFailure('identity-changed', '读取时文件身份已变化，请重新选择');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, queryFileSourceLimits.bytes + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null); check();
      if (!bytesRead) break; size += bytesRead;
      if (size > queryFileSourceLimits.bytes) throw new QueryFileSourceFailure('io', '读取时SQL文件超过20MiB');
      chunks.push(chunk.subarray(0, bytesRead));
      progress?.('reading', size, first.size); check();
    }
    const end = await handle.stat({ bigint: true }); check();
    const named = await lstat(canonical, { bigint: true }); check();
    const resolved = await realpath(path); check();
    if (canonical !== resolved || !sameQueryFileVersion(first, identity(end)) || !sameQueryFileVersion(first, identity(named)) || size !== first.size) throw new QueryFileSourceFailure('external-change', '读取时文件已变化，请重新读取');
    const bytes = Buffer.concat(chunks, size); result = { path: canonical, bytes, identity: first, mode: Number(before.mode & 0o777n), digest: queryFileBytesDigest(bytes) };
  } finally { await handle.close(); }
  check(); return result;
}
/** 现有来源必须与原字节摘要和物理版本同时相同；不同标签的旧基线不能覆盖新写入。 */
export function assertQueryFileVersion(snapshot: QueryFileSnapshot, source: PrivateQueryFileSource): void {
  if (snapshot.path !== source.path || snapshot.identity.dev !== source.identity.dev || snapshot.identity.ino !== source.identity.ino) throw new QueryFileSourceFailure('identity-changed', '原文件已被替换，请重读、另存或取消');
  if (!sameQueryFileVersion(snapshot.identity, source.identity) || snapshot.digest !== source.fileDigest) throw new QueryFileSourceFailure('external-change', '原文件已被外部修改，请重读、另存或取消');
}
/** 统一换行保持原风格，混合格式编辑必须显式决定；编码和BOM分别保留。 */
export function encodeBoundQueryFile(sql: string, encoding: QueryFileEncoding, bom: QueryFileBom, previousEol: QueryFileEol, policy: QueryFileEolPolicy): Buffer {
  if (policy === 'preserve' && (previousEol === 'mixed' || previousEol === 'none' && queryFileEol(sql) === 'mixed')) throw new QueryFileSourceFailure('mixed-eol', '混合换行已编辑，请明确选择LF、CRLF或CR后保存');
  const chosen = policy === 'preserve' ? previousEol === 'none' ? queryFileEol(sql) : previousEol : policy;
  const normalized = chosen === 'none' ? sql : sql.replace(/\r\n|\r|\n/g, chosen === 'crlf' ? '\r\n' : chosen === 'cr' ? '\r' : '\n');
  let bytes: Buffer;
  try { bytes = encodeQueryFile(normalized, encoding); }
  catch { throw new QueryFileSourceFailure('encoding', 'SQL正文无法按当前编码无损保存或超过文件预算'); }
  if (encoding === 'utf16le') bytes = bytes.subarray(2);
  if (bom !== 'none') bytes = Buffer.concat([bom === 'utf8' ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.from([0xff, 0xfe]), bytes]);
  if (bytes.length > queryFileSourceLimits.bytes) throw new QueryFileSourceFailure('encoding', '含BOM的SQL文件超过20MiB，未写入');
  return bytes;
}
/** 文件缺失与其他IO故障明确区分，调用者不能将权限不足当作可创建的新目标。 */
export function queryFileIsMissing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
/** 另存目标不存在时只证明精确路径缺失，不猜测父目录权限。 */
export async function queryFileTargetAbsent(path: string, check: () => void): Promise<boolean> {
  try { await lstat(path); check(); return false; } catch (error) { check(); if (queryFileIsMissing(error)) return true; throw error; }
}
/** 暂存同步后最终重验；rename没有跨进程CAS，最后核对与替换之间的外部竞态仍须披露。 */
export async function writeBoundQueryFile(path: string, bytes: Buffer, expected: QueryFileSnapshot | undefined, check: () => void, markWrite: (state: 'yes' | 'unknown') => void, progress?: QueryFileIoProgress): Promise<QueryFileSnapshot> {
  const temporary = `${path}.dbark-${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', expected?.mode ?? 0o600);
  let closed = false;
  try {
    check(); progress?.('staging', 0, bytes.length); check(); let offset = 0;
    while (offset < bytes.length) { const result = await handle.write(bytes, offset, Math.min(64 * 1024, bytes.length - offset)); check(); if (!result.bytesWritten) throw new QueryFileSourceFailure('io', '临时文件写入未取得进展，原文件未替换'); offset += result.bytesWritten; progress?.('staging', offset, bytes.length); check(); }
    // open的mode会被umask过滤；所有写入后显式恢复已有文件普通权限，再同步并读回证明。
    if (expected) { await handle.chmod(expected.mode); check(); }
    await handle.sync(); check();
    if (expected) {
      const staged = await handle.stat({ bigint: true }); check();
      if (!staged.isFile() || Number(staged.mode & 0o777n) !== expected.mode) throw new QueryFileSourceFailure('io', '暂存文件普通权限未恢复，原文件未替换');
    }
    await handle.close(); closed = true; check();
    if (expected) {
      const current = await readQueryFileSnapshot(path, check, (_phase, processed, total) => progress?.('checking', processed, total)); check();
      if (current.path !== expected.path || current.digest !== expected.digest || !sameQueryFileVersion(current.identity, expected.identity)) throw new QueryFileSourceFailure('external-change', '保存前文件已变化，原文件未替换');
    } else if (!await queryFileTargetAbsent(path, check)) throw new QueryFileSourceFailure('external-change', '另存目标已出现，请重新选择');
    progress?.('replacing', bytes.length, bytes.length); check(); markWrite('unknown'); await rename(temporary, path); markWrite('yes'); check();
    const written = await readQueryFileSnapshot(path, check, (_phase, processed, total) => progress?.('verifying', processed, total)); check();
    if (written.digest !== queryFileBytesDigest(bytes)) throw new QueryFileSourceFailure('uncertain', '文件替换后读回不一致，请核对文件，不能自动重试');
    return written;
  } finally {
    if (!closed) await handle.close();
    await rm(temporary, { force: true });
  }
}

/** 解码保留原始SQL字面量，失败使用固定消息且不泄露文件内容。 */
export function decodeSourceSnapshot(snapshot: QueryFileSnapshot, encoding: QueryFileEncoding) {
  try { return decodeQueryFile(snapshot.bytes, encoding); }
  catch { throw new QueryFileSourceFailure('encoding', '文件编码无法无损读取或内容不适合SQL编辑'); }
}
