import { z } from 'zod';

/** B01 私有契约；只有 Root 后续接入共享 IPC，渲染侧始终只提交不透明令牌和标识。 */
const token = z.string().min(1).max(200).refine(value => !value.includes('\0'), '令牌不能包含空字符');
const database = z.string().min(1).refine(value => [...value].length <= 64 && !value.includes('\0'), '数据库名无效');
export const databaseBackupInspectSchema = z.object({ connectionId: token, database, toolId: token, taskId: token }).strict();
export const databaseBackupPrepareSchema = z.object({ inspectionToken: token, fileToken: token, acknowledgeGlobalWriteBlock: z.literal(true), taskId: token }).strict();
export type DatabaseBackupInspectInput = z.infer<typeof databaseBackupInspectSchema>;
export type DatabaseBackupPrepareInput = z.infer<typeof databaseBackupPrepareSchema>;
export const databaseBackupKinds = ['database', 'table', 'view', 'trigger', 'procedure', 'function', 'event'] as const;
export type DatabaseBackupKind = typeof databaseBackupKinds[number];
export type DatabaseBackupProof = 'proven' | 'denied' | 'unknown';
export interface DatabaseBackupObject { kind: DatabaseBackupKind; name: string; definitionSha256: string | null; engine?: string; }
export interface DatabaseBackupToolSummary { id: string; label: string; family: 'mysql' | 'mariadb'; version: string; }
export interface DatabaseBackupBlocker { code: string; message: string; }
export interface DatabaseBackupInspection {
  inspectionToken: string; expiresAt: number; connectionId: string; database: string;
  serverFamily: 'mysql' | 'mariadb'; serverVersion: string;
  tool: DatabaseBackupToolSummary | null;
  scope: { counts: Record<DatabaseBackupKind, number>; objects: readonly DatabaseBackupObject[]; complete: boolean; phase: 'preflight' };
  lock: { profileId: string; phase: 'capability-only'; actualLockHeld: false; affectsWholeInstance: true; maxWaitMs: number; maxHoldMs: number };
  blockers: readonly DatabaseBackupBlocker[];
  backupExecuted: false;
}
export interface DatabaseBackupPlan {
  planToken: string; inspectionToken: string; expiresAt: number; connectionId: string; database: string;
  serverVersion: string; tool: DatabaseBackupToolSummary; counts: Record<DatabaseBackupKind, number>;
  outputName: string; format: 'dbark-backup-zip-store-v1'; maxBytes: number;
  lock: DatabaseBackupInspection['lock'];
  /** 执行时必须在同一受控锁租约内重新核权限、工具、身份与完整对象清单，准备页不持锁。 */
  mustRevalidateUnderLock: true; backupExecuted: false;
}
export interface DatabaseBackupPreparationServices {
  inspect(input: DatabaseBackupInspectInput): Promise<DatabaseBackupInspection>;
  chooseFile(): Promise<{ fileToken: string; displayName: string } | null>;
  prepare(input: DatabaseBackupPrepareInput): Promise<DatabaseBackupPlan>;
  cancel(taskId: string): Promise<{ state: 'confirmed' | 'unknown' }>;
}
/** 后续执行接口与准备接口分开，不因存在计划令牌就开放任意进程或 SQL 入口。 */
export interface DatabaseBackupExecutionServices {
  run(input: { planToken: string; taskId: string }): Promise<DatabaseBackupRunResult>;
  inspectArchive(input: { fileToken: string; taskId: string }): Promise<{
    integrity: 'valid' | 'invalid' | 'unknown'; compatibility: 'supported' | 'unsupported' | 'unknown';
    manifest: DatabaseBackupManifest | null; restoreVerified: false; blockers: readonly DatabaseBackupBlocker[];
  }>;
  prepareRestore(input: { fileToken: string; targetConnectionId: string; taskId: string }): Promise<{ restorePlanToken: string; blockers: readonly DatabaseBackupBlocker[] }>;
  runRestore(input: { restorePlanToken: string; taskId: string }): Promise<{ state: 'verified' | 'partial' | 'retained-unknown'; reportToken: string }>;
}
/** 成功必须同时具有归档提交与资源终态证明；取消/失败不能携带成功提交的假状态。 */
export type DatabaseBackupRunResult =
  | { state: 'completed'; artifactToken: string; bytes: string; sha256: string; fileCommitted: true; resources: 'confirmed'; restoreVerified: false }
  | { state: 'cancelled' | 'failed'; fileCommitted: false; resources: 'confirmed'; restoreVerified: false }
  | { state: 'retained-unknown'; artifactToken?: string; bytes?: string; sha256?: string; fileCommitted: boolean; resources: 'unknown'; restoreVerified: false };
export interface DatabaseBackupManifest {
  format: 'dbark-backup-zip-store-v1'; schemaVersion: 1;
  family: 'mysql' | 'mariadb'; serverVersion: string; toolVersion: string; toolSuiteSha256: string; toolRegistryRevision: string;
  database: string; objects: readonly DatabaseBackupObject[];
  dump: { entry: 'dump.sql'; bytes: string; sha256: string };
  consistency: { profileId: string; acquiredAt: string; completedAt: string; allObjectsFrozen: boolean };
  externalDependencies: readonly string[]; resourcesConfirmed: boolean; restoreVerified: false;
}
