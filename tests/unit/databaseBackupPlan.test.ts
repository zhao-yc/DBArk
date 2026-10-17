import { describe, expect, it, vi } from 'vitest';
import { databaseBackupKinds, type DatabaseBackupInspectInput } from '../../src/shared/databaseBackup';
import { DatabaseBackupPlanner, databaseBackupLimits } from '../../src/engine/databaseBackupPlan';
import { databaseBackupFixture } from './databaseBackupFixtures';

describe('B01 有界准备计划器（注入 RAM 证据）', () => {
  it('整库清单及可信套件生成尚未执行的计划，准备本身没有持锁事实', async () => {
    const f = databaseBackupFixture(), inspected = await f.planner.inspect(f.input);
    expect(inspected.blockers).toEqual([]); expect(inspected.scope.objects).toHaveLength(7); expect(inspected.lock.actualLockHeld).toBe(false);
    expect(databaseBackupKinds.every(kind => inspected.scope.counts[kind] === 1)).toBe(true);
    const plan = await f.planner.prepare({ inspectionToken: inspected.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: 'prepare' });
    expect(plan.backupExecuted).toBe(false); expect(plan.mustRevalidateUnderLock).toBe(true); expect(plan.format).toBe('dbark-backup-zip-store-v1');
    expect(f.planner.bindings(plan.planToken).tool.toolLease).toBe('仅RAM工具租约'); expect(JSON.stringify(plan)).not.toContain('仅RAM工具租约');
    inspected.scope.counts.table = 99; plan.counts.table = 88; expect(f.planner.bindings(plan.planToken).plan.counts.table).toBe(1);
  });
  it.each(['tool', 'hash', 'visibility', 'definition', 'ddl', 'permission', 'dependency', 'version'])('证据缺口 %s 必须阻断，不跳过对象或降低备份范围', async defect => {
    const f = databaseBackupFixture();
    if (defect === 'tool') f.ports.resolveTool.mockResolvedValue(null);
    if (defect === 'hash') f.tool.observedSuiteSha256 = 'c'.repeat(64);
    if (defect === 'visibility') f.source.visibility.event = 'unknown';
    if (defect === 'definition') f.source.objects[1].definitionSha256 = null;
    if (defect === 'ddl') f.source.lockCapability.ddlCoverage.function = 'unknown';
    if (defect === 'permission') f.source.permissions.routines = 'denied';
    if (defect === 'dependency') f.source.externalDependencies = ['another_db.table'];
    if (defect === 'version') f.source.version = '8.0.45';
    const result = await f.planner.inspect(f.input); expect(result.blockers.length).toBeGreaterThan(0); expect(result.scope.objects).toHaveLength(7);
    await expect(f.planner.prepare({ inspectionToken: result.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: 'prepare' })).rejects.toThrow('阻断');
    expect(f.ports.inspectTarget).not.toHaveBeenCalled();
  });
  it('MariaDB 11.4.13 单独声明待验证，不能混用 MySQL 工具或锁配置', async () => {
    const f = databaseBackupFixture(); f.source.family = 'mariadb'; f.source.version = '11.4.13';
    const pending = await f.planner.inspect(f.input); expect(pending.blockers.map(item => item.code)).toEqual(expect.arrayContaining(['mariadb-validation-pending', 'tool-untrusted', 'lock-capability-mismatch']));
    f.tool.family = 'mariadb'; f.tool.version = '11.4.13'; f.source.lockCapability = { ...f.source.lockCapability, profileId: 'mariadb-11.4-global-read-lock-v1', versionValidated: '11.4.13' };
    const enabled = new DatabaseBackupPlanner(f.ports, { lockProfileApproved: true, maria11413Validated: true });
    expect((await enabled.inspect(f.input)).blockers).toEqual([]);
  });
  it('拒绝任意可执行路径、SQL、凭据及未经确认的 prepare 输入', async () => {
    const f = databaseBackupFixture();
    await expect(f.planner.inspect({ ...f.input, executablePath: '任意程序', password: 'RAM占位', sql: '任意语句' } as DatabaseBackupInspectInput)).rejects.toThrow();
    const result = await f.planner.inspect(f.input);
    await expect(f.planner.prepare({ inspectionToken: result.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: false, taskId: 'prepare' } as never)).rejects.toThrow();
    expect(f.ports.inspectTarget).not.toHaveBeenCalled();
  });
  it('缺失/重复数据库定义及未知对象类型不能伪装为完整空库', async () => {
    const f = databaseBackupFixture(); f.source.objects = [];
    expect((await f.planner.inspect(f.input)).blockers.some(item => item.code === 'database-definition')).toBe(true);
    f.source.objects = [{ kind: 'database', name: 'shop', definitionSha256: 'a'.repeat(64) }, { kind: 'database', name: 'shop', definitionSha256: 'a'.repeat(64) }];
    await expect(f.planner.inspect(f.input)).rejects.toThrow('重复身份');
  });
  it('过量对象拒绝整批，不截断；私有定义额外字段不透传 renderer', async () => {
    const f = databaseBackupFixture(); Object.assign(f.source.objects[1], { rawSql: '仅内部定义，不透传', path: '内部路径' });
    expect(JSON.stringify(await f.planner.inspect(f.input))).not.toContain('不透传');
    f.source.objects = Array.from({ length: databaseBackupLimits.objects + 1 }, () => f.source.objects[0]); await expect(f.planner.inspect(f.input)).rejects.toThrow('预算');
  });
  it('异步检查先占容量，取消晚到结果不能生成令牌', async () => {
    const f = databaseBackupFixture(); let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; });
    f.ports.inspectSource.mockImplementation(async () => { await wait; return f.source; });
    const a = f.planner.inspect({ ...f.input, taskId: 'a' }), b = f.planner.inspect({ ...f.input, taskId: 'b' });
    await expect(f.planner.inspect({ ...f.input, taskId: 'c' })).rejects.toThrow('已满'); f.cancelled.add('a'); finish();
    await expect(a).rejects.toThrow('取消'); await expect(b).resolves.toHaveProperty('backupExecuted', false);
  });
  it('文件检查跨 await 过期后不生成计划；令牌及格式必须由私有端口验证', async () => {
    const f = databaseBackupFixture(), result = await f.planner.inspect(f.input);
    const inspectTarget = f.ports.inspectTarget.getMockImplementation()!;
    f.ports.inspectTarget.mockImplementation(async token => { const target = await inspectTarget(token); f.advance(databaseBackupLimits.ttlMs); return target; });
    await expect(f.planner.prepare({ inspectionToken: result.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: 'prepare' })).rejects.toThrow('过期');
    const fresh = await f.planner.inspect(f.input); f.ports.inspectTarget.mockResolvedValue({ fileToken: '另一个令牌', outputLease: 'lease', revision: 'v1', displayName: 'plain.sql', writable: true, format: 'dbark-backup-zip' });
    await expect(f.planner.prepare({ inspectionToken: fresh.inspectionToken, fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: 'prepare-again' })).rejects.toThrow('授权无效');
  });
  it('有效检查数量和令牌碰撞均有边界，过期后可重新准备', async () => {
    const f = databaseBackupFixture();
    for (let i = 0; i < databaseBackupLimits.inspections; i++) await f.planner.inspect({ ...f.input, taskId: `task-${i}` });
    await expect(f.planner.inspect(f.input)).rejects.toThrow('已满'); f.advance(databaseBackupLimits.ttlMs);
    const result = await f.planner.inspect(f.input); f.ports.token = vi.fn(() => result.inspectionToken);
    await expect(f.planner.inspect({ ...f.input, taskId: 'collision' })).rejects.toThrow('重复');
  });
});
