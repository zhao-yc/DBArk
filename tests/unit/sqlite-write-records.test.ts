import { describe, expect, it, vi } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { SqliteWriteRecords } from '../../src/main/sqliteWriteRecords';
import { recoverSqliteWriteTask, sqliteWriteFactSchema } from '../../src/shared/sqliteWriteFact';
import { validateCommand } from '../../src/shared/validation';

const target = { connectionId: 'sqlite', database: 'main' as const, table: 'subject' };
function fixture() {
  let task: TaskRecord = { id: 'write', kind: 'sqlite.tableEdit.apply', status: 'running', progress: 0, message: '', startedAt: '2026-11-01T00:00:00Z' };
  const save = vi.fn((_value: TaskRecord) => {}), records = new SqliteWriteRecords({ task: () => task, replace: value => { task = value; }, save });
  const operation = records.begin('write', target, 2); return { records, operation, save, task: () => task, fact: () => structuredClone(task.sqliteWrite!) };
}
describe('SQLite写入最小事实与恢复', () => {
  it('COMMIT前同步保存抛错会拒绝继续，内存保留已投递边界；ACK后保存失败不抹成功', () => {
    const f = fixture(); f.save.mockImplementation(() => { throw Error('本地磁盘失败'); });
    expect(() => f.operation.record({ ...f.fact(), phase: 'commit-pending', commitMayHaveBeenSent: true })).toThrow('本地磁盘失败'); expect(f.records.committed('write')).toBeUndefined();
    expect(() => f.operation.record({ ...f.fact(), phase: 'committed', appliedRows: 2, commitAcknowledged: true })).toThrow('本地磁盘失败'); expect(f.records.committed('write')).toMatchObject({ phase: 'committed', commitAcknowledged: true }); expect(f.task().status).toBe('completed');
    expect(() => f.operation.record({ ...f.fact(), phase: 'unknown', commitAcknowledged: false })).toThrow('不能倒退');
  });
  it('拒绝另操作、另目标、伪造ACK和夹带原值SQL；真实事务内处理数不冒充持久写数', () => {
    const f = fixture();
    for (const patch of [{ operationId: '00000000-0000-4000-8000-000000000001' }, { target: { ...target, table: 'other' } }, { requestedRows: 3 }, { commitAcknowledged: true }, { rollbackAcknowledged: true }, { sql: '私有SQL' }, { filePath: '私有路径' }]) expect(() => f.operation.record({ ...f.fact(), ...patch })).toThrow();
    f.operation.record({ ...f.fact(), phase: 'writing', appliedRows: 1 }); f.operation.record({ ...f.fact(), phase: 'rolled-back', rollbackAcknowledged: true });
    expect(f.fact()).toMatchObject({ phase: 'rolled-back', appliedRows: 1, rollbackAcknowledged: true, commitAcknowledged: false });
  });
  it('重启在途写入和COMMIT变未知，已确认commit/rollback仍保持，绝不执行或补造ACK', () => {
    const f = fixture();
    for (const phase of ['writing', 'commit-pending'] as const) { const restored = recoverSqliteWriteTask({ ...f.task(), sqliteWrite: { ...f.fact(), phase, commitMayHaveBeenSent: phase === 'commit-pending' } }); expect(restored.sqliteWrite?.phase).toBe('unknown'); expect(restored.status).toBe('failed'); expect(restored.message).toContain('未知'); }
    const committed = recoverSqliteWriteTask({ ...f.task(), sqliteWrite: { ...f.fact(), phase: 'committed', appliedRows: 2, commitMayHaveBeenSent: true, commitAcknowledged: true } }); expect(committed.status).toBe('completed');
    const rollback = recoverSqliteWriteTask({ ...f.task(), status: 'cancelled', sqliteWrite: { ...f.fact(), phase: 'rolled-back', rollbackAcknowledged: true } }); expect(rollback.status).toBe('cancelled'); expect(rollback.message).toContain('回滚');
    const corrupt = recoverSqliteWriteTask({ ...f.task(), sqliteWrite: { ...f.fact(), sql: '秘密' } as any, errors: ['秘密'] }); expect(corrupt).not.toHaveProperty('errors'); expect(corrupt).not.toHaveProperty('sqliteWrite'); expect(corrupt.message).not.toContain('秘密');
  });
  it('write outcome不能用completed事件或不同事实伪造，原操作ACK才可信', () => {
    const f = fixture(), result = () => ({ operationId: f.fact().operationId, target, counts: { insert: 0, update: 2, delete: 0 }, outcome: 'committed', fact: f.fact(), message: '完成' });
    expect(() => f.records.outcome('write', result())).toThrow();
    f.operation.record({ ...f.fact(), phase: 'committed', appliedRows: 2, commitMayHaveBeenSent: true, commitAcknowledged: true }); expect(f.records.outcome('write', result()).outcome).toBe('committed');
    expect(() => f.records.outcome('write', { ...result(), fact: { ...f.fact(), appliedRows: 1 } })).toThrow();
  });
});
describe('SQLite编辑严格IPC与整批预算', () => {
  const base = { snapshotId: 's', taskId: 'preview', changes: [{ kind: 'update', row: 0, values: [{ column: 'x', value: { kind: 'integer', value: '9223372036854775807' } }] }] };
  it('只接快照编号/行号/typed修改，不接受SQL路径旧值，重复行/列或非法精度拒绝', () => {
    expect(validateCommand('sqlite.tableEdit.preview', base)).toEqual(base);
    for (const patch of [{ sql: 'UPDATE anything' }, { filePath: '外部文件' }, { oldRows: [] }, { changes: [...base.changes, ...base.changes] }, { changes: [{ ...base.changes[0], values: [...base.changes[0].values, ...base.changes[0].values] }] }, { changes: [{ ...base.changes[0], values: [{ column: 'x', value: { kind: 'integer', value: '9223372036854775808' } }] }] }]) expect(() => validateCommand('sqlite.tableEdit.preview', { ...base, ...patch })).toThrow();
    expect(() => validateCommand('sqlite.tableEdit.apply', { previewId: 'p', taskId: 'a', confirmation: 'main.subject', operationId: 'caller' })).toThrow();
    expect(sqliteWriteFactSchema.safeParse({ sql: 'not-a-receipt' }).success).toBe(false);
  });
  it('必超字段总预算时不访问值内容，避免解析复制整组过大文本', () => {
    const field = { column: 'x', get value(): never { throw Error('不应读取字段值'); } };
    const changes = Array.from({ length: 11 }, () => ({ kind: 'insert', values: Array(1024).fill(field) }));
    // 提前的全组计数必须先于任何内容读取；失败只能是预算拒绝。
    expect(() => validateCommand('sqlite.tableEdit.preview', { snapshotId: 's', taskId: 't', changes })).toThrow('字段预算');
  });
});
