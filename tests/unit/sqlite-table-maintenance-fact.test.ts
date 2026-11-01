import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { assertSqliteTableMaintenanceFactTransition, sqliteTableMaintenanceFactSchema, sqliteTableMaintenanceOutcomeSchema, type SqliteTableMaintenanceFact } from '../../src/shared/sqliteTableMaintenance';
import { recoverSqliteTableMaintenanceTask, sqliteTableMaintenanceFactMessage, sqliteTableMaintenanceTaskMessage } from '../../src/shared/sqliteTableMaintenanceFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
const target = { connectionId: 'owned', database: 'main' as const, table: '原表🚢' };
/** 合成最小维护语句事实，不把表达式或SQL塞入事务证明。 */
function fact(phase: SqliteTableMaintenanceFact['phase'] = 'not-sent', patch: Partial<SqliteTableMaintenanceFact> = {}): SqliteTableMaintenanceFact { return { operationId: 'owned-operation', target, action: 'clear', phase, requestedStatements: 1, completedStatements: phase === 'not-sent' ? 0 : phase === 'writing' ? 0 : 1, ...(phase === 'not-sent' ? {} : { actualBeforeRows: '3' }), commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch }; }
describe('SQLite表维护维护语句独立提交事实', () => {
  it('合法阶段与真实回滚ACK可收束COMMIT前持久化失败，不从维护语句计数补造提交', () => {
    const phases = ['not-sent', 'writing', 'commit-pending', 'committed'] as const; for (let index = 1; index < phases.length; index++) expect(() => assertSqliteTableMaintenanceFactTransition(fact(phases[index - 1]), fact(phases[index]))).not.toThrow();
    expect(() => assertSqliteTableMaintenanceFactTransition(fact('commit-pending'), fact('rolled-back', { commitMayHaveBeenSent: false }))).not.toThrow();
    expect(sqliteTableMaintenanceFactMessage(fact('writing', { completedStatements: 1 }))).not.toContain('已确认提交'); expect(sqliteTableMaintenanceOutcomeSchema.safeParse({ operationId: 'owned-operation', target, action: 'clear', resetSequence: false, outcome: 'committed', fact: fact('writing', { completedStatements: 1 }), message: '伪成功', definitionVerified: true }).success).toBe(false);
  });
  it('身份/目标/数量/ACK倒退及矛盾组合拒绝，unknown只能由原操作后续ACK收束', () => {
    for (const patch of [{ commitAcknowledged: true }, { rollbackAcknowledged: true }, { completedStatements: 2 }, { completedStatements: 1, commitMayHaveBeenSent: true }, { sql: 'PRIVATE_SQL' }]) expect(sqliteTableMaintenanceFactSchema.safeParse({ ...fact(), ...patch }).success).toBe(false);
    for (const next of [fact('writing'), fact('committed', { operationId: '另一个操作' }), fact('committed', { target: { ...target, table: '另一张表' } }), fact('committed', { requestedStatements: 2, completedStatements: 2 })]) expect(() => assertSqliteTableMaintenanceFactTransition(fact('committed'), next)).toThrow();
    expect(() => assertSqliteTableMaintenanceFactTransition(fact('unknown'), fact('committed'))).not.toThrow(); expect(() => assertSqliteTableMaintenanceFactTransition(fact('unknown'), fact('writing'))).toThrow();
    expect(sqliteTableMaintenanceOutcomeSchema.safeParse({ operationId: 'owned-operation', target, action: 'clear', resetSequence: false, outcome: 'rolled-back', fact: fact('rolled-back'), message: '原回滚', definitionVerified: true }).success).toBe(false);
  });
  it.each(['inspect', 'preview', 'apply'] as const)('%s概要四状态均固定脱敏，不持久表达式/路径/原错误', stage => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const command = 'sqlite.tableMaintenance.' + stage, message = persistedTaskMessage(command, { taskId: 'task', status, progress: 20, message: 'PRIVATE_MAINTENANCES_915 D:/private/file.sqlite CREATE INDEX PRIVATE_DEFAULT' });
      expect(message).toBe(sqliteTableMaintenanceTaskMessage(command, status)); expect(message).not.toContain('PRIVATE_MAINTENANCES'); expect(message).not.toContain('PRIVATE_DEFAULT'); expect(message).not.toContain('file.sqlite');
    }
  });
  it.each(['committed', 'rolled-back', 'not-sent', 'writing', 'commit-pending', 'unknown'] as const)('恢复%s只保最小维护语句事实，原ACK单向保持，在途转未知且不重放', phase => {
    const task: TaskRecord & Record<string, unknown> = { id: 'task', kind: 'sqlite.tableMaintenance.apply', status: 'running', progress: 30, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE_MAINTENANCES', errors: ['PRIVATE_MAINTENANCES'], expression: 'PRIVATE_DEFAULT', sql: 'CREATE INDEX secret', filePath: 'PRIVATE_MAINTENANCES.sqlite', acknowledgement: 'private-ack', catalogueId: 'private-capability', sqliteTableMaintenance: fact(phase) }, restored = recoverSqliteTableMaintenanceTask(task);
    expect(restored.sqliteTableMaintenance?.phase).toBe(['writing', 'commit-pending'].includes(phase) ? 'unknown' : phase); expect(restored.status).toBe(phase === 'committed' ? 'completed' : 'failed'); if (phase === 'committed') expect(restored.progress).toBe(100);
    for (const key of ['errors', 'expression', 'sql', 'filePath', 'acknowledgement', 'catalogueId']) expect(restored).not.toHaveProperty(key); expect(JSON.stringify(restored)).not.toContain('PRIVATE_MAINTENANCES'); expect(recoverSqliteTableMaintenanceTask(restored)).toEqual(restored);
  });
  it('只读目录/预览恢复不接受嫁接写事实，缺失或矛盾apply事实不能假装成功', () => {
    for (const kind of ['sqlite.tableMaintenance.inspect', 'sqlite.tableMaintenance.preview']) { const task: TaskRecord = { id: 't', kind, status: 'running', progress: 10, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE', errors: ['PRIVATE'], sqliteTableMaintenance: fact('committed') }, restored = recoverSqliteTableMaintenanceTask(task); expect(restored.status).toBe('failed'); expect(restored.sqliteTableMaintenance).toBeUndefined(); expect(restored.errors).toBeUndefined(); expect(restored.message).toBe(sqliteTableMaintenanceTaskMessage(kind, 'failed')); }
    expect(recoverSqliteTableMaintenanceTask({ id: 't', kind: 'sqlite.tableMaintenance.apply', status: 'completed', progress: 100, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE' })).toMatchObject({ status: 'failed', message: expect.stringContaining('无法核验') });
  });
  it('写锁后真实行数只出现一次，保留int64精度，观察值或动作不能偷换持久事实', () => {
    const writing = fact('writing', { actualBeforeRows: '9223372036854775807' }); expect(sqliteTableMaintenanceFactSchema.parse(writing).actualBeforeRows).toBe('9223372036854775807');
    for (const value of ['-1', '01', '1.0', '1e3', '9223372036854775808', 1]) expect(sqliteTableMaintenanceFactSchema.safeParse({ ...writing, actualBeforeRows: value }).success).toBe(false);
    for (const next of [fact('writing', { actualBeforeRows: '4' }), fact('writing', { actualBeforeRows: undefined }), fact('writing', { action: 'drop' })]) expect(() => assertSqliteTableMaintenanceFactTransition(fact('writing'), next)).toThrow();
    expect(sqliteTableMaintenanceFactSchema.safeParse(fact('committed', { actualBeforeRows: undefined })).success).toBe(false); expect(sqliteTableMaintenanceFactSchema.safeParse(fact('not-sent', { actualBeforeRows: '3' })).success).toBe(false); expect(sqliteTableMaintenanceFactSchema.safeParse(fact('committed', { action: 'drop', requestedStatements: 2, completedStatements: 2 })).success).toBe(false);
  });
  it('提交ACK概要不宣称保留依赖有效，也不把drop与clear事实混用', () => {
    expect(sqliteTableMaintenanceFactMessage(fact('committed', { action: 'drop' }))).toContain('不证明保留的视图和外键引用可用'); expect(sqliteTableMaintenanceFactMessage(fact('committed'))).not.toContain('已删除');
    expect(sqliteTableMaintenanceOutcomeSchema.safeParse({ operationId: 'owned-operation', target, action: 'drop', resetSequence: false, outcome: 'committed', fact: fact('committed'), message: '伪删表', definitionVerified: true }).success).toBe(false);
  });
});
