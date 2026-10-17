import { vi } from 'vitest';
import { databaseBackupKinds, type DatabaseBackupInspectInput, type DatabaseBackupPreparationServices } from '../../src/shared/databaseBackup';
import { DatabaseBackupPlanner, type DatabaseBackupPlanPorts, type DatabaseBackupRegisteredTool, type DatabaseBackupSourceEvidence } from '../../src/engine/databaseBackupPlan';

/** 合成证据只存在 RAM；工具摘要是测试占位值，不能用于实际注册或执行。 */
export function databaseBackupFixture() {
  let clock = Date.now(), sequence = 0;
  const cancelled = new Set<string>(), proven = Object.fromEntries(databaseBackupKinds.map(kind => [kind, 'proven'])) as DatabaseBackupSourceEvidence['visibility'];
  const source: DatabaseBackupSourceEvidence = {
    connectionId: 'connection', database: 'shop', connectionRevision: 'connection-v1', sourceLease: '仅RAM源租约', family: 'mysql', version: '8.4.11', endpoint: 'direct-pinned',
    visibility: { ...proven }, lockCapability: { profileId: 'mysql-8.4-global-read-lock-v1', versionValidated: '8.4.11', ddlCoverage: { ...proven } },
    permissions: { data: 'proven', definitions: 'proven', routines: 'proven', events: 'proven', globalReadLock: 'proven', tablespaces: 'proven' }, externalDependencies: [],
    objects: databaseBackupKinds.map(kind => ({ kind, name: kind === 'database' ? 'shop' : `${kind}_1`, definitionSha256: 'a'.repeat(64), ...(kind === 'table' ? { engine: 'InnoDB' } : {}) })),
  };
  const tool: DatabaseBackupRegisteredTool = { id: 'mysql-tool', label: '管理员配置的 MySQL 工具', family: 'mysql', version: '8.4.11', registration: 'root-controlled', registryRevision: 'registry-v1', toolLease: '仅RAM工具租约', expectedSuiteSha256: 'b'.repeat(64), observedSuiteSha256: 'b'.repeat(64) };
  const ports = {
    now: () => clock, token: () => `backup-token-${++sequence}`,
    inspectSource: vi.fn(async (_input: DatabaseBackupInspectInput) => structuredClone(source)), resolveTool: vi.fn(async (_id: string) => structuredClone(tool) as DatabaseBackupRegisteredTool | null),
    inspectTarget: vi.fn(async (fileToken: string) => ({ fileToken, outputLease: '仅RAM输出租约', revision: 'output-v1', displayName: 'shop.dbark-backup.zip', writable: true, format: 'dbark-backup-zip' as const })),
    cancelled: (taskId: string) => cancelled.has(taskId),
  } satisfies DatabaseBackupPlanPorts;
  const policy = { lockProfileApproved: true, maria11413Validated: false }, planner = new DatabaseBackupPlanner(ports, policy);
  const input: DatabaseBackupInspectInput = { connectionId: 'connection', database: 'shop', toolId: tool.id, taskId: 'inspect-task' };
  const services: DatabaseBackupPreparationServices = {
    inspect: vi.fn(value => planner.inspect(value)), prepare: vi.fn(value => planner.prepare(value)),
    chooseFile: vi.fn(async () => ({ fileToken: 'output', displayName: 'shop.dbark-backup.zip' })), cancel: vi.fn(async taskId => { cancelled.add(taskId); return { state: 'confirmed' as const }; }),
  };
  return { source, tool, ports, policy, planner, input, cancelled, services, advance: (ms: number) => { clock += ms; } };
}
