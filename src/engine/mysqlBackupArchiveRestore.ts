import { createHash } from 'node:crypto';
import { databaseBackupArchiveZh as text } from '../shared/databaseBackupArchiveFiles';
import { databaseBackupArchiveLimits, inspectDatabaseBackupArchive, readBackupArchiveBlock, type DatabaseBackupArchiveManifest } from './databaseBackupArchive';
import { withBackupArchiveFile } from './databaseBackupArchiveFile';
import { decodeMysqlSql } from './mysqlSqlFile';

export interface MysqlBackupArchiveSource {
  path: string;
  revision: string;
  sha256: string;
  dumpBytes: string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();

/** 写入前完整复验归档，执行时逐块绑定同一批已校验字节。摘要内存随 64 KiB 块数增长，无需解包到磁盘。 */
export async function withVerifiedMysqlArchiveDump<T>(source: MysqlBackupArchiveSource, check: () => void,
  work: (manifest: DatabaseBackupArchiveManifest, sql: AsyncGenerator<string>) => Promise<T>): Promise<T> {
  const { archiveBytes, blockBytes } = databaseBackupArchiveLimits;
  const dumpBytes = Number(source.dumpBytes);
  if (!Number.isSafeInteger(dumpBytes) || dumpBytes < 1 || dumpBytes > Number(archiveBytes)) throw Error(text.stale);
  const hashBytes = 32, hashes = Buffer.alloc(Math.ceil(dumpBytes / blockBytes) * hashBytes);
  return withBackupArchiveFile(source.path, check, source.revision, async (reader, assertCurrent) => {
    let firstOffset = 0n, scanned = 0;
    // 先验证整个载荷可按 UTF-8 解码，避免已知的编码损坏在部分 SQL 提交后才暴露。
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const checked = await inspectDatabaseBackupArchive(reader, check, {
      async writeBytes(bytes, offset) {
        if (scanned === 0) firstOffset = offset;
        if (offset !== firstOffset + BigInt(scanned) || bytes.length !== Math.min(blockBytes, dumpBytes - scanned)) throw Error(text.stale);
        decoder.decode(bytes, { stream: true });
        sha256(bytes).copy(hashes, scanned / blockBytes * hashBytes);
        scanned += bytes.length;
      }
    });
    decoder.decode();
    await assertCurrent();
    if (scanned !== dumpBytes || checked.archive.sha256 !== source.sha256) throw Error(text.stale);
    async function* blocks(): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < dumpBytes; offset += blockBytes) {
        await assertCurrent();
        const block = await readBackupArchiveBlock(reader, reader.size, firstOffset + BigInt(offset), Math.min(blockBytes, dumpBytes - offset), check);
        const hashOffset = offset / blockBytes * hashBytes;
        if (!sha256(block).equals(hashes.subarray(hashOffset, hashOffset + hashBytes))) throw Error(text.stale);
        yield block;
      }
      await assertCurrent();
    }
    return work(checked.manifest, decodeMysqlSql(blocks(), 'utf8', checked.manifest.family));
  });
}
