import { DatabaseBackupArchiveWriter, databaseBackupArchiveLimits } from '../../src/engine/databaseBackupArchive';

/** 生成具有产品 ZIP64 布局的合成夹具，不伪造数据库锁或可恢复性结论。 */
export async function makeDatabaseBackupArchive(sql: Buffer, family: 'mysql' | 'mariadb' = 'mysql', database = '归档夹具'): Promise<Buffer> {
  const chunks: Buffer[] = [], version = family === 'mysql' ? '8.4.11' : '11.4.13';
  const writer = new DatabaseBackupArchiveWriter({ async writeBytes(bytes) { chunks.push(Buffer.from(bytes)); } });
  await writer.startDump();
  for (let at = 0; at < sql.length; at += databaseBackupArchiveLimits.blockBytes)
    await writer.writeDump(sql.subarray(at, at + databaseBackupArchiveLimits.blockBytes));
  await writer.finish({
    format: 'dbark-backup-zip-store-v1', schemaVersion: 1,
    family, serverVersion: version, toolVersion: version, toolSuiteSha256: 'a'.repeat(64), toolRegistryRevision: 'test',
    database, objects: [
      { kind: 'database', name: database, definitionSha256: 'b'.repeat(64) },
      { kind: 'table', name: 'ledger', definitionSha256: 'c'.repeat(64), engine: 'InnoDB' },
      ...(database === 'tabrelio_archive_fixture' ? [{ kind: 'view' as const, name: 'ledger_view', definitionSha256: 'd'.repeat(64) }] : [])
    ],
    consistency: { profileId: 'test', acquiredAt: '2026-11-06T11:00:00Z', completedAt: '2026-11-06T11:01:00Z', allObjectsFrozen: false },
    externalDependencies: [], resourcesConfirmed: false, restoreVerified: false
  });
  return Buffer.concat(chunks);
}
