import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AtomicFile, nativeAtomicFileIO, type AtomicFileIO } from '../engine/atomicFile';
import { binaryCellFileBytes, binaryCellFileLimits as limits, binaryCellFileText as text, binaryCellFileSaveSchema, binaryCellFileOpenOutputSchema, binaryCellFileSaveOutputSchema, type BinaryCellFileOpenOutput, type BinaryCellFileSaveInput, type BinaryCellFileSaveOutput } from '../shared/binaryCellFiles';

export interface BinaryCellFileReader {
  stat(): Promise<BigIntStats>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface BinaryCellFileReadIO {
  lstat(path: string): Promise<BigIntStats>; realpath(path: string): Promise<string>; open(path: string): Promise<BinaryCellFileReader>;
}
export const nativeBinaryCellFileReadIO: BinaryCellFileReadIO = {
  lstat: path => lstat(path, { bigint: true }), realpath,
  /** 能用NOFOLLOW的平台在open时再拒绝叶链接；其他平台仍核原句柄及命名身份。 */
  async open(path) { const handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0)); return { stat: () => handle.stat({ bigint: true }), read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position), close: () => handle.close() }; },
};

/** 大小、inode和纳秒修改代次均属于版本，不能只比较同长度或路径字符串。 */
function identity(value: BigIntStats): string {
  if (!value.isFile() || value.isSymbolicLink() || value.ino <= 0n || value.size < 0n) throw Error(text.ordinary);
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
}
function canonicalKey(path: string): string { return process.platform === 'win32' ? path.toLowerCase() : path; }
/** 只将原生IO错误换成固定中文，不把系统错误中的绝对路径回传给renderer。 */
function safeFailure(error: unknown, fallback: string): unknown { return error instanceof AggregateError ? new Error(`${fallback}；临时文件关闭或清理尚未确认`, { cause: error }) : error && typeof error === 'object' && 'code' in error ? new Error(fallback, { cause: error }) : error; }

/** 仅载入原生对话框授权的普通文件；有界读取并重核路径/句柄，所有字节保持原样。 */
export async function readBinaryCellFile(path: string, guard: () => void, io: BinaryCellFileReadIO = nativeBinaryCellFileReadIO): Promise<NonNullable<BinaryCellFileOpenOutput>> {
  let handle: BinaryCellFileReader | undefined, result: NonNullable<BinaryCellFileOpenOutput> | undefined, failure: unknown;
  try {
    guard(); const before = await io.lstat(path); guard(); const first = identity(before);
    if (before.size > BigInt(limits.openBytes)) throw Error(text.openLimit);
    guard(); const canonical = await io.realpath(path); guard();
    guard(); handle = await io.open(canonical);
    guard(); const start = await handle.stat(); guard(); if (identity(start) !== first) throw Error(text.changed);
    const chunks: Buffer[] = []; let length = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limits.openBytes + 1 - length));
      guard(); const { bytesRead } = await handle.read(chunk, 0, chunk.length, null); guard();
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > chunk.length) throw Error(text.readFailed);
      if (!bytesRead) break; length += bytesRead;
      if (length > limits.openBytes) throw Error(text.openLimit);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    guard(); const end = await handle.stat(); guard();
    guard(); const named = await io.lstat(canonical); guard();
    guard(); const original = await io.lstat(path); guard();
    guard(); const resolved = await io.realpath(path); guard();
    if (canonicalKey(canonical) !== canonicalKey(resolved) || identity(end) !== first || identity(named) !== first || identity(original) !== first || BigInt(length) !== before.size) throw Error(text.changed);
    result = { base64: Buffer.concat(chunks, length).toString('base64'), bytes: length, name: basename(path) };
    binaryCellFileOpenOutputSchema.parse(result);
  } catch (error) { failure = safeFailure(error, text.readFailed); }
  finally {
    // 归属失效也必须关闭原handle；guard错误不能跳过实际close，close失败也不能发布字节。
    try { guard(); } catch (error) { failure ??= error; }
    try { await handle?.close(); } catch (error) { failure ??= safeFailure(error, text.readFailed); }
    try { guard(); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure; guard(); return result!;
}

/** 已选目标不存在与权限/类型错误分开，不能把无法读取的原文件当新文件覆盖。 */
async function targetIdentity(path: string, guard: () => void): Promise<string | undefined> {
  guard();
  try { const value = await lstat(path, { bigint: true }); guard(); return identity(value); }
  catch (error) { guard(); if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
/** 目录身份不含mtime（自己的临时文件也会改变mtime），但必须是同一真实目录。 */
async function parentIdentity(path: string, guard: () => void): Promise<string> {
  guard(); const value = await lstat(path, { bigint: true }); guard();
  if (!value.isDirectory() || value.isSymbolicLink() || value.ino <= 0n) throw Error(text.targetChanged);
  return [value.dev, value.ino].join(':');
}

/** 原值先完整校验，同目录独占暂存/同步/关闭后才替换；替换成功后不再以迟到撤权抹掉事实。 */
export async function writeBinaryCellFile(path: string, raw: BinaryCellFileSaveInput, guard: () => void, io: AtomicFileIO = nativeAtomicFileIO): Promise<NonNullable<BinaryCellFileSaveOutput>> {
  const input = binaryCellFileSaveSchema.parse(raw), count = binaryCellFileBytes(input.base64), result = { bytes: count, name: basename(path) };
  binaryCellFileSaveOutputSchema.parse(result); guard();
  const bytes = Buffer.from(input.base64, 'base64');
  let writer: AtomicFile | undefined, committed = false, failure: unknown;
  try {
    guard(); const parent = await realpath(dirname(resolve(path))); guard();
    const target = join(parent, basename(path));
    guard(); const parentVersion = await parentIdentity(parent, guard); guard();
    guard(); const previous = await targetIdentity(target, guard); guard();
    let expectedTemporaryIdentity: string | undefined;
    const checkedIO: AtomicFileIO = {
      ...io,
      /** 预备阶段的版本只能取自原open句柄，不能重新认领被换到同一路径的外来文件。 */
      async open(temporary) {
        guard(); const file = await io.open(temporary);
        // 取得删除能力前不能因迟到撤权丢掉句柄；create随后会绑定原清理能力并检查guard。
        return {
          write: (buffer, offset, length) => file.write(buffer, offset, length), sync: () => file.sync(), close: () => file.close(),
          ...(file.protectOwnership ? { protectOwnership: () => file.protectOwnership!() } : {}),
          async identity() { guard(); if (!file.identity) throw Error(text.targetChanged); const version = await file.identity(); guard(); expectedTemporaryIdentity = version; return version; },
        };
      },
      /** 紧贴实际rename前重核目标、目录和原temp；rename ACK之后不能再抛归属失效。 */
      async rename(source, destination) {
        guard(); const finalParent = await realpath(dirname(resolve(path))); guard();
        guard(); const currentParent = await parentIdentity(parent, guard); guard();
        guard(); const currentTarget = await targetIdentity(target, guard); guard();
        guard(); const temporaryIdentity = await io.identity!(source); guard();
        if (canonicalKey(finalParent) !== canonicalKey(parent) || currentParent !== parentVersion || currentTarget !== previous || !expectedTemporaryIdentity || temporaryIdentity !== expectedTemporaryIdentity) throw Error(text.targetChanged);
        guard(); await io.rename(source, destination);
      },
    };
    guard(); writer = await AtomicFile.create(target, 'utf8', guard, guard, checkedIO, limits.saveBytes, undefined, true); guard();
    guard(); await writer.writeBytes(bytes); guard();
    guard(); await writer.prepare(true); guard();
    guard(); const finalParent = await realpath(dirname(resolve(path))); guard();
    guard(); const currentParent = await parentIdentity(parent, guard); guard();
    guard(); const currentTarget = await targetIdentity(target, guard); guard();
    if (canonicalKey(finalParent) !== canonicalKey(parent) || currentParent !== parentVersion || currentTarget !== previous) throw Error(text.targetChanged);
    // commit内部的最后身份await后再次执行guard；rename ACK之后不再检查旧文档。
    guard(); await writer.commit(); committed = true;
  } catch (error) { failure = safeFailure(error, text.writeFailed); }
  finally {
    // 清理使用原handle绑定的精确删除能力，归属失效不能阻止清理，也不能删被替换的外来temp。
    try { await writer?.dispose(); } catch (error) { if (!committed) failure = new AggregateError([failure, error], text.writeFailed, { cause: failure }); }
  }
  if (committed) return result;
  throw failure ?? Error(text.writeFailed);
}
