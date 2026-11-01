import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { assertSqliteIndexesFactTransition, sqliteIndexesFactSchema, sqliteIndexesOutcomeSchema, type SqliteIndexesFact } from '../../src/shared/sqliteIndexes';
import { recoverSqliteIndexesTask, sqliteIndexesFactMessage, sqliteIndexesTaskMessage } from '../../src/shared/sqliteIndexesFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
const target = { connectionId: 'owned', database: 'main' as const, table: '原表🚢' };
/** 合成最小DDL事实，不把表达式或SQL塞入事务证明。 */
function fact(phase: SqliteIndexesFact['phase'] = 'not-sent', patch: Partial<SqliteIndexesFact> = {}): SqliteIndexesFact { return { operationId: 'owned-operation', target, phase, requestedStatements: 2, completedStatements: phase === 'not-sent' ? 0 : phase === 'writing' ? 1 : 2, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch }; }
describe('SQLite索引DDL独立提交事实', () => {
  it('合法阶段与真实回滚ACK可收束COMMIT前持久化失败，不从DDL计数补造提交', () => {
    const phases = ['not-sent', 'writing', 'commit-pending', 'committed'] as const; for (let index = 1; index < phases.length; index++) expect(() => assertSqliteIndexesFactTransition(fact(phases[index - 1]), fact(phases[index]))).not.toThrow();
    expect(() => assertSqliteIndexesFactTransition(fact('commit-pending'), fact('rolled-back', { commitMayHaveBeenSent: false }))).not.toThrow();
    expect(sqliteIndexesFactMessage(fact('writing', { completedStatements: 2 }))).not.toContain('已确认提交'); expect(sqliteIndexesOutcomeSchema.safeParse({ operationId: 'owned-operation', target, outcome: 'committed', fact: fact('writing', { completedStatements: 2 }), message: '伪成功', definitionVerified: true }).success).toBe(false);
  });
  it('身份/目标/数量/ACK倒退及矛盾组合拒绝，unknown只能由原操作后续ACK收束', () => {
    for (const patch of [{ commitAcknowledged: true }, { rollbackAcknowledged: true }, { completedStatements: 3 }, { completedStatements: 1, commitMayHaveBeenSent: true }, { sql: 'PRIVATE_SQL' }]) expect(sqliteIndexesFactSchema.safeParse({ ...fact(), ...patch }).success).toBe(false);
    for (const next of [fact('writing'), fact('committed', { operationId: '另一个操作' }), fact('committed', { target: { ...target, table: '另一张表' } }), fact('committed', { requestedStatements: 3, completedStatements: 3 })]) expect(() => assertSqliteIndexesFactTransition(fact('committed'), next)).toThrow();
    expect(() => assertSqliteIndexesFactTransition(fact('unknown'), fact('committed'))).not.toThrow(); expect(() => assertSqliteIndexesFactTransition(fact('unknown'), fact('writing'))).toThrow();
    expect(sqliteIndexesOutcomeSchema.safeParse({ operationId: 'owned-operation', target, outcome: 'rolled-back', fact: fact('rolled-back'), message: '原回滚', definitionVerified: true }).success).toBe(false);
  });
  it.each(['inspect', 'preview', 'apply'] as const)('%s概要四状态均固定脱敏，不持久表达式/路径/原错误', stage => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const command = 'sqlite.indexes.' + stage, message = persistedTaskMessage(command, { taskId: 'task', status, progress: 20, message: 'PRIVATE_INDEXES_915 D:/private/file.sqlite CREATE INDEX lower(secret)' });
      expect(message).toBe(sqliteIndexesTaskMessage(command, status)); expect(message).not.toContain('PRIVATE_INDEXES'); expect(message).not.toContain('lower(secret)'); expect(message).not.toContain('file.sqlite');
    }
  });
  it.each(['committed', 'rolled-back', 'not-sent', 'writing', 'commit-pending', 'unknown'] as const)('恢复%s只保最小DDL事实，原ACK单向保持，在途转未知且不重放', phase => {
    const task: TaskRecord & Record<string, unknown> = { id: 'task', kind: 'sqlite.indexes.apply', status: 'running', progress: 30, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE_INDEXES', errors: ['PRIVATE_INDEXES'], expression: 'lower(secret)', sql: 'CREATE INDEX secret', filePath: 'PRIVATE_INDEXES.sqlite', sqliteIndexes: fact(phase) }, restored = recoverSqliteIndexesTask(task);
    expect(restored.sqliteIndexes?.phase).toBe(['writing', 'commit-pending'].includes(phase) ? 'unknown' : phase); expect(restored.status).toBe(phase === 'committed' ? 'completed' : 'failed'); if (phase === 'committed') expect(restored.progress).toBe(100);
    for (const key of ['errors', 'expression', 'sql', 'filePath']) expect(restored).not.toHaveProperty(key); expect(JSON.stringify(restored)).not.toContain('PRIVATE_INDEXES'); expect(recoverSqliteIndexesTask(restored)).toEqual(restored);
  });
  it('只读目录/预览恢复不接受嫁接写事实，缺失或矛盾apply事实不能假装成功', () => {
    for (const kind of ['sqlite.indexes.inspect', 'sqlite.indexes.preview']) { const task: TaskRecord = { id: 't', kind, status: 'running', progress: 10, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE', errors: ['PRIVATE'], sqliteIndexes: fact('committed') }, restored = recoverSqliteIndexesTask(task); expect(restored.status).toBe('failed'); expect(restored.sqliteIndexes).toBeUndefined(); expect(restored.errors).toBeUndefined(); expect(restored.message).toBe(sqliteIndexesTaskMessage(kind, 'failed')); }
    expect(recoverSqliteIndexesTask({ id: 't', kind: 'sqlite.indexes.apply', status: 'completed', progress: 100, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE' })).toMatchObject({ status: 'failed', message: expect.stringContaining('无法核验') });
  });
});
