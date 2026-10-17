import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupRestorePreflight, type DatabaseBackupRestoreArchive, type DatabaseBackupRestorePorts, type DatabaseBackupRestoreSqlEvidence, type DatabaseBackupRestoreTarget } from '../../src/engine/databaseBackupRestorePreflight';
import { databaseBackupFixture } from './databaseBackupFixtures';
import type { DatabaseBackupManifest } from '../../src/shared/databaseBackup';

/** 严格容器读取及 SQL 分析由 Root/归档模块另验；此处只注入 RAM 证据验证恢复决策。 */
function fixture() {
  const f = databaseBackupFixture(); let clock = Date.now(), sequence = 0; const cancelled = new Set<string>();
  const manifest: DatabaseBackupManifest = { format: 'dbark-backup-zip-store-v1', schemaVersion: 1, family: 'mysql', serverVersion: '8.4.11', toolVersion: '8.4.11', toolSuiteSha256: 'b'.repeat(64), toolRegistryRevision: 'registry', database: 'shop', objects: structuredClone(f.source.objects), dump: { entry: 'dump.sql', bytes: '1234', sha256: 'c'.repeat(64) }, consistency: { profileId: 'mysql-8.4-global-read-lock-v1', acquiredAt: new Date(clock).toISOString(), completedAt: new Date(clock).toISOString(), allObjectsFrozen: true }, externalDependencies: [], resourcesConfirmed: true, restoreVerified: false };
  const archive: Omit<DatabaseBackupRestoreArchive, 'owner'> = { integrity: 'valid', compatibility: 'supported', archiveIdentity: 'archive-byte-sha-and-token', fileRevision: 'file-v1', manifest, restoreVerified: false };
  const sql: Omit<DatabaseBackupRestoreSqlEvidence, 'owner'> = { archiveIdentity: archive.archiveIdentity, fileRevision: archive.fileRevision, rawUnchanged: true, completeAnalysis: 'proven', objectsMatchManifest: 'proven', databaseNames: ['shop'], definers: ['backup@localhost'], externalDependencies: [] };
  const target: Omit<DatabaseBackupRestoreTarget, 'owner'> = { targetLease: 'isolated-target-lease', targetRevision: 'target-v1', family: 'mysql', version: '8.4.11', database: 'shop', databaseState: 'absent', isolated: 'proven', sourceInstanceExcluded: 'proven', statementPrivileges: 'proven', availableDefiners: ['backup@localhost'], clientSuite: { registration: 'root-controlled', toolId: 'mysql-client', family: 'mysql', version: '8.4.11', suiteSha256: 'd'.repeat(64), registryRevision: 'registry-v1', clientLease: 'client-lease' }, eventScheduler: 'disabled' };
  const ports = { now: () => clock, token: () => `restore-${++sequence}`, cancelled: (id: string) => cancelled.has(id),
    inspectArchive: vi.fn(async owner => ({ ...structuredClone(archive), owner })), inspectSql: vi.fn(async owner => ({ ...structuredClone(sql), owner })), inspectTarget: vi.fn(async owner => ({ ...structuredClone(target), owner })) } satisfies DatabaseBackupRestorePorts;
  const preflight = new DatabaseBackupRestorePreflight(ports, 50), input = { fileToken: 'archive-file', targetConnectionId: 'isolated-connection', taskId: 'restore-check' };
  return { archive, manifest, sql, target, ports, preflight, input, cancelled, advance: (ms: number) => { clock += ms; } };
}

describe('B01 恢复预检（零写库）', () => {
  it('严格容器、原 SQL 范围/DEFINER 与同名隔离目标都通过才生成可用预检绑定', async () => {
    const f = fixture(), result = await f.preflight.prepareRestore(f.input); expect(result.blockers).toEqual([]);
    const binding = f.preflight.bindings(result.restorePlanToken); expect(binding.restoreVerified).toBe(false); expect(binding.target?.databaseState).toBe('absent'); expect(binding.sql?.rawUnchanged).toBe(true);
    expect(f.ports.inspectArchive).toHaveBeenCalledTimes(1); expect(f.ports.inspectSql).toHaveBeenCalledTimes(1); expect(f.ports.inspectTarget).toHaveBeenCalledTimes(1);
    f.advance(120_000); expect(() => f.preflight.bindings(result.restorePlanToken)).toThrow('过期');
  });
  it.each(['integrity', 'definition', 'database', 'analysis', 'family', 'client', 'nonempty', 'origin', 'definer', 'events', 'boolean-type'])('缺口 %s 必须阻断，不改写 SQL 或跳过对象', async defect => {
    const f = fixture();
    if (defect === 'integrity') f.archive.integrity = 'invalid';
    if (defect === 'definition') f.manifest.objects[1].definitionSha256 = null;
    if (defect === 'database') f.sql.databaseNames = ['shop', 'another_database'];
    if (defect === 'analysis') f.sql.objectsMatchManifest = 'unknown';
    if (defect === 'family') f.target.family = 'mariadb';
    if (defect === 'client') f.target.clientSuite.version = '8.0.45';
    if (defect === 'nonempty') f.target.databaseState = 'nonempty';
    if (defect === 'origin') f.target.sourceInstanceExcluded = 'unknown';
    if (defect === 'definer') f.target.availableDefiners = [];
    if (defect === 'events') f.target.eventScheduler = 'enabled';
    if (defect === 'boolean-type') Object.assign(f.manifest.consistency, { allObjectsFrozen: 'false' });
    const result = await f.preflight.prepareRestore(f.input); expect(result.blockers.length).toBeGreaterThan(0); expect(() => f.preflight.bindings(result.restorePlanToken)).toThrow('阻断');
    if (['integrity', 'definition', 'boolean-type'].includes(defect)) expect(f.ports.inspectSql).not.toHaveBeenCalled();
    expect(f.sql.rawUnchanged).toBe(true); expect(f.manifest.restoreVerified).toBe(false);
  });
  it('拒绝额外 SQL/路径参数，拒绝同字串的外来 owner 证据', async () => {
    const f = fixture(); await expect(f.preflight.prepareRestore({ ...f.input, sql: '任意SQL', path: '任意路径' } as never)).rejects.toThrow('只接受');
    f.ports.inspectArchive.mockImplementation(async owner => ({ ...f.archive, owner: { ...owner } })); await expect(f.preflight.prepareRestore(f.input)).rejects.toThrow('owner'); expect(f.ports.inspectTarget).not.toHaveBeenCalled();
  });
  it('超时未决检查仍占容量，晚到结果不会产生可用计划', async () => {
    const f = fixture(), pending: (() => void)[] = [];
    f.ports.inspectArchive.mockImplementation(owner => new Promise(resolve => { pending.push(() => resolve({ ...f.archive, owner })); }));
    const a = f.preflight.prepareRestore({ ...f.input, taskId: 'a' }), b = f.preflight.prepareRestore({ ...f.input, taskId: 'b' });
    await expect(a).rejects.toThrow('预算'); await expect(b).rejects.toThrow('预算'); await expect(f.preflight.prepareRestore({ ...f.input, taskId: 'c' })).rejects.toThrow('容量');
    pending.forEach(finish => finish()); await Promise.resolve(); await Promise.resolve();
    f.ports.inspectArchive.mockImplementation(async owner => ({ ...f.archive, owner })); expect((await f.preflight.prepareRestore({ ...f.input, taskId: 'c' })).blockers).toEqual([]);
  });
});
