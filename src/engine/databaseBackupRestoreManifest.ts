import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/i);
const name = z.string().min(1).refine(value => [...value].length <= 64 && !value.includes('\0'));
const timestamp = z.string().min(1).max(64).refine(value => Number.isFinite(Date.parse(value)));
/** 归档声明属于不可信文件；先验证真实字段类型和预算，不能只靠 TypeScript 或 truthy 布尔值。 */
export const databaseBackupRestoreManifestSchema = z.object({
  format: z.literal('dbark-backup-zip-store-v1'), schemaVersion: z.literal(1),
  family: z.enum(['mysql', 'mariadb']), serverVersion: z.string().min(1).max(32), toolVersion: z.string().min(1).max(32),
  toolSuiteSha256: sha, toolRegistryRevision: z.string().min(1).max(200), database: name,
  objects: z.array(z.object({ kind: z.enum(['database', 'table', 'view', 'trigger', 'procedure', 'function', 'event']), name, definitionSha256: sha.nullable(), engine: z.string().min(1).max(64).optional() }).strict()).max(10_000),
  dump: z.object({ entry: z.literal('dump.sql'), bytes: z.string().regex(/^[1-9]\d{0,19}$/).refine(value => BigInt(value) <= 10n * 1024n ** 3n), sha256: sha }).strict(),
  consistency: z.object({ profileId: z.string().min(1).max(200), acquiredAt: timestamp, completedAt: timestamp, allObjectsFrozen: z.boolean() }).strict(),
  externalDependencies: z.array(z.string().min(1).max(200)).max(256), resourcesConfirmed: z.boolean(), restoreVerified: z.literal(false),
}).strict().refine(value => Date.parse(value.consistency.completedAt) >= Date.parse(value.consistency.acquiredAt));
