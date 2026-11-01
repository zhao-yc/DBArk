import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { assertSqliteTableRenameFactTransition, sqliteTableRenameFactSchema, sqliteTableRenameOutcomeSchema, type SqliteTableRenameFact } from '../../src/shared/sqliteTableRename';
import { recoverSqliteTableRenameTask, sqliteTableRenameFactMessage, sqliteTableRenameTaskMessage } from '../../src/shared/sqliteTableRenameFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
const target = { connectionId: 'owned', database: 'main' as const, table: '原表🚢' };
/** 合成最小DDL事实，不把表达式或SQL塞入事务证明。 */
function fact(phase: SqliteTableRenameFact['phase'] = 'not-sent', patch: Partial<SqliteTableRenameFact> = {}): SqliteTableRenameFact { return { operationId: 'owned-operation', target, phase, requestedStatements: 1, completedStatements: phase === 'not-sent' ? 0 : phase === 'writing' ? 0 : 1, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch }; }
describe('SQLite表重命名DDL独立提交事实', () => {
  it('合法阶段与真实回滚ACK可收束COMMIT前持久化失败，不从DDL计数补造提交', () => {
    const phases = ['not-sent', 'writing', 'commit-pending', 'committed'] as const; for (let index = 1; index < phases.length; index++) expect(() => assertSqliteTableRenameFactTransition(fact(phases[index - 1]), fact(phases[index]))).not.toThrow();
    expect(() => assertSqliteTableRenameFactTransition(fact('commit-pending'), fact('rolled-back', { commitMayHaveBeenSent: false }))).not.toThrow();
    expect(sqliteTableRenameFactMessage(fact('writing', { completedStatements: 1 }))).not.toContain('已确认提交'); expect(sqliteTableRenameOutcomeSchema.safeParse({ operationId: 'owned-operation', target, newName: '新表', navigationIdentity: 'a'.repeat(64), outcome: 'committed', fact: fact('writing', { completedStatements: 1 }), message: '伪成功', definitionVerified: true }).success).toBe(false);
  });
  it('身份/目标/数量/ACK倒退及矛盾组合拒绝，unknown只能由原操作后续ACK收束', () => {
    for (const patch of [{ commitAcknowledged: true }, { rollbackAcknowledged: true }, { completedStatements: 2 }, { completedStatements: 1, commitMayHaveBeenSent: true }, { sql: 'PRIVATE_SQL' }]) expect(sqliteTableRenameFactSchema.safeParse({ ...fact(), ...patch }).success).toBe(false);
    for (const next of [fact('writing'), fact('committed', { operationId: '另一个操作' }), fact('committed', { target: { ...target, table: '另一张表' } }), fact('committed', { requestedStatements: 2, completedStatements: 2 })]) expect(() => assertSqliteTableRenameFactTransition(fact('committed'), next)).toThrow();
    expect(() => assertSqliteTableRenameFactTransition(fact('unknown'), fact('committed'))).not.toThrow(); expect(() => assertSqliteTableRenameFactTransition(fact('unknown'), fact('writing'))).toThrow();
    expect(sqliteTableRenameOutcomeSchema.safeParse({ operationId: 'owned-operation', target, newName: '新表', outcome: 'rolled-back', fact: fact('rolled-back'), message: '原回滚', definitionVerified: true }).success).toBe(false);
  });
  it.each(['inspect', 'preview', 'apply'] as const)('%s概要四状态均固定脱敏，不持久表达式/路径/原错误', stage => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const command = 'sqlite.tableRename.' + stage, message = persistedTaskMessage(command, { taskId: 'task', status, progress: 20, message: 'PRIVATE_RENAMES_915 D:/private/file.sqlite CREATE INDEX PRIVATE_DEFAULT' });
      expect(message).toBe(sqliteTableRenameTaskMessage(command, status)); expect(message).not.toContain('PRIVATE_RENAMES'); expect(message).not.toContain('PRIVATE_DEFAULT'); expect(message).not.toContain('file.sqlite');
    }
  });
  it.each(['committed', 'rolled-back', 'not-sent', 'writing', 'commit-pending', 'unknown'] as const)('恢复%s只保最小DDL事实，原ACK单向保持，在途转未知且不重放', phase => {
    const task: TaskRecord & Record<string, unknown> = { id: 'task', kind: 'sqlite.tableRename.apply', status: 'running', progress: 30, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE_RENAMES', errors: ['PRIVATE_RENAMES'], expression: 'PRIVATE_DEFAULT', sql: 'CREATE INDEX secret', filePath: 'PRIVATE_RENAMES.sqlite', navigationIdentity: 'a'.repeat(64), catalogueId: 'old-capability', newName: 'PRIVATE_NEW_NAME', sqliteTableRename: fact(phase) }, restored = recoverSqliteTableRenameTask(task);
    expect(restored.sqliteTableRename?.phase).toBe(['writing', 'commit-pending'].includes(phase) ? 'unknown' : phase); expect(restored.status).toBe(phase === 'committed' ? 'completed' : 'failed'); if (phase === 'committed') expect(restored.progress).toBe(100);
    for (const key of ['errors', 'expression', 'sql', 'filePath', 'navigationIdentity', 'catalogueId', 'newName']) expect(restored).not.toHaveProperty(key); expect(JSON.stringify(restored)).not.toContain('PRIVATE_RENAMES'); expect(recoverSqliteTableRenameTask(restored)).toEqual(restored);
  });
  it('只读目录/预览恢复不接受嫁接写事实，缺失或矛盾apply事实不能假装成功', () => {
    for (const kind of ['sqlite.tableRename.inspect', 'sqlite.tableRename.preview']) { const task: TaskRecord = { id: 't', kind, status: 'running', progress: 10, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE', errors: ['PRIVATE'], sqliteTableRename: fact('committed') }, restored = recoverSqliteTableRenameTask(task); expect(restored.status).toBe('failed'); expect(restored.sqliteTableRename).toBeUndefined(); expect(restored.errors).toBeUndefined(); expect(restored.message).toBe(sqliteTableRenameTaskMessage(kind, 'failed')); }
    expect(recoverSqliteTableRenameTask({ id: 't', kind: 'sqlite.tableRename.apply', status: 'completed', progress: 100, startedAt: '2026-11-01T00:00:00Z', message: 'PRIVATE' })).toMatchObject({ status: 'failed', message: expect.stringContaining('无法核验') });
  });
});
