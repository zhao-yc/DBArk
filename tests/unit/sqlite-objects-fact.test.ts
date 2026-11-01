import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { assertSqliteObjectsFactTransition, sqliteObjectsFactSchema, sqliteObjectsOutcomeSchema, type SqliteObjectsFact } from '../../src/shared/sqliteObjects';
import { recoverSqliteObjectsTask, sqliteObjectsFactMessage, sqliteObjectsTaskMessage } from '../../src/shared/sqliteObjectsFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
const target = { connectionId: 'owned', database: 'main' as const, kind: 'view' as const, name: '原对象🚢' };
/** 合成最小对象DDL事实，不把表达式或SQL塞入事务证明。 */
function fact(phase: SqliteObjectsFact['phase'] = 'not-sent', patch: Partial<SqliteObjectsFact> = {}): SqliteObjectsFact { return { operationId: 'owned-operation', target, action: 'replace', phase, requestedStatements: 2, completedStatements: phase === 'not-sent' ? 0 : phase === 'writing' ? 1 : 2, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch }; }
describe('SQLite对象定义对象DDL独立提交事实', () => {
  it('合法阶段与真实回滚ACK可收束COMMIT前持久化失败，不从对象DDL计数补造提交', () => {
    const phases = ['not-sent', 'writing', 'commit-pending', 'committed'] as const; for (let index = 1; index < phases.length; index++) expect(() => assertSqliteObjectsFactTransition(fact(phases[index - 1]), fact(phases[index]))).not.toThrow();
    expect(() => assertSqliteObjectsFactTransition(fact('commit-pending'), fact('rolled-back', { commitMayHaveBeenSent: false }))).not.toThrow();
    expect(sqliteObjectsFactMessage(fact('writing', { completedStatements: 2 }))).not.toContain('已确认提交'); expect(sqliteObjectsOutcomeSchema.safeParse({ operationId: 'owned-operation', target, action: 'replace', outcome: 'committed', fact: fact('writing', { completedStatements: 2 }), message: '伪成功', definitionVerified: true }).success).toBe(false);
  });
  it('身份/目标/数量/ACK倒退及矛盾组合拒绝，unknown只能由原操作后续ACK收束', () => {
    for (const patch of [{ commitAcknowledged: true }, { rollbackAcknowledged: true }, { completedStatements: 3 }, { completedStatements: 1, commitMayHaveBeenSent: true }, { sql: 'PRIVATE_SQL' }]) expect(sqliteObjectsFactSchema.safeParse({ ...fact(), ...patch }).success).toBe(false);
    for (const next of [fact('writing'), fact('committed', { operationId: '另一个操作' }), fact('committed', { target: { ...target, name: '另一对象' } }), fact('committed', { requestedStatements: 3, completedStatements: 3 })]) expect(() => assertSqliteObjectsFactTransition(fact('committed'), next)).toThrow();
    expect(() => assertSqliteObjectsFactTransition(fact('unknown'), fact('committed'))).not.toThrow(); expect(() => assertSqliteObjectsFactTransition(fact('unknown'), fact('writing'))).toThrow();
    expect(sqliteObjectsOutcomeSchema.safeParse({ operationId: 'owned-operation', target, action: 'replace', outcome: 'rolled-back', fact: fact('rolled-back'), message: '原回滚', definitionVerified: true }).success).toBe(false);
  });
  it.each(['inspect', 'preview', 'apply'] as const)('%s概要四状态均固定脱敏，不持久表达式/路径/原错误', stage => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const command = 'sqlite.objects.' + stage, message = persistedTaskMessage(command, { taskId: 'task', status, progress: 20, message: 'PRIVATE_OBJECTSS_915 D:/private/file.sqlite CREATE INDEX PRIVATE_DEFAULT' });
      expect(message).toBe(sqliteObjectsTaskMessage(command, status)); expect(message).not.toContain('PRIVATE_OBJECTSS'); expect(message).not.toContain('PRIVATE_DEFAULT'); expect(message).not.toContain('file.sqlite');
    }
  });
  it.each(['committed', 'rolled-back', 'not-sent', 'writing', 'commit-pending', 'unknown'] as const)('恢复%s只保最小对象DDL事实，原ACK单向保持，在途转未知且不重放', phase => {
    const task: TaskRecord & Record<string, unknown> = { id: 'task', kind: 'sqlite.objects.apply', status: 'running', progress: 30, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE_OBJECTSS', errors: ['PRIVATE_OBJECTSS'], expression: 'PRIVATE_DEFAULT', sql: 'CREATE INDEX secret', filePath: 'PRIVATE_OBJECTSS.sqlite', sqliteObjects: fact(phase) }, restored = recoverSqliteObjectsTask(task);
    expect(restored.sqliteObjects?.phase).toBe(['writing', 'commit-pending'].includes(phase) ? 'unknown' : phase); expect(restored.status).toBe(phase === 'committed' ? 'completed' : 'failed'); if (phase === 'committed') expect(restored.progress).toBe(100);
    for (const key of ['errors', 'expression', 'sql', 'filePath']) expect(restored).not.toHaveProperty(key); expect(JSON.stringify(restored)).not.toContain('PRIVATE_OBJECTSS'); expect(recoverSqliteObjectsTask(restored)).toEqual(restored);
  });
  it('只读目录/预览恢复不接受嫁接写事实，缺失或矛盾apply事实不能假装成功', () => {
    for (const kind of ['sqlite.objects.inspect', 'sqlite.objects.preview']) { const task: TaskRecord = { id: 't', kind, status: 'running', progress: 10, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE', errors: ['PRIVATE'], sqliteObjects: fact('committed') }, restored = recoverSqliteObjectsTask(task); expect(restored.status).toBe('failed'); expect(restored.sqliteObjects).toBeUndefined(); expect(restored.errors).toBeUndefined(); expect(restored.message).toBe(sqliteObjectsTaskMessage(kind, 'failed')); }
    expect(recoverSqliteObjectsTask({ id: 't', kind: 'sqlite.objects.apply', status: 'completed', progress: 100, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE' })).toMatchObject({ status: 'failed', message: expect.stringContaining('无法核验') });
  });
});
