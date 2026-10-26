import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { TableFilteredDeleteProgress } from '../../src/shared/tableFilteredDelete';
import { TableFilteredDeleteIntent, tableFilteredDeleteAvailable, checkTableFilteredDeleteApplied, checkTableFilteredDeletePreview, mergeTableFilteredDeleteProgress } from '../../src/renderer/tableFilteredDeleteUi';

/** 合成表保留超安全整数及小数原文，不向数据库或系统输入请求数据。 */
function source(): TableInfo { return { database: '库`名', name: '表.名', objectKind: 'table', engine: 'InnoDB', columns: ['id', 'note', 'amount'].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,12)' : 'TEXT', nullable: name !== 'id', generated: false, defaultValue: null, extra: '', comment: '' })), primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], ddl: '完整结构' }; }
function intent(guard = () => true) { const info = source(); return new TableFilteredDeleteIntent({ connectionId: 'c', database: info.database, table: info.name }, info, { filters: [{ column: 'note', operator: '=', value: 'A' }, { column: 'note', operator: '=', value: 'B' }, { column: 'amount', operator: '>=', value: '9007199254740993.123456789012', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] }, sort: [{ column: 'amount', direction: 'DESC' }, { column: 'id', direction: 'ASC' }] }, ['page2'], guard); }
function progress(overrides: Partial<TableFilteredDeleteProgress> = {}): TableFilteredDeleteProgress { return { phase: 'deleting', rows: 0, totalRows: 512, snapshotBytes: 100, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'not-sent', ...overrides }; }

describe('服务器全部筛选行删除的独立范围与回执', () => {
  it('完整OR、停用位和多列排序原样冻结，无页码/行值/任意SQL或赋值', () => {
    const lease = intent(), input = lease.input(randomUUID());
    expect(Object.keys(input).sort()).toEqual(['connectionId', 'database', 'filterGroup', 'filterMode', 'filters', 'metadataKey', 'sort', 'table', 'taskId']);
    expect(input.filterGroup).toEqual(lease.scope.filterGroup); expect(input.filters[2]).toMatchObject({ enabled: false, value: '9007199254740993.123456789012' }); expect(input.sort).toEqual(lease.scope.sort);
    expect(Object.isFrozen(lease.scope.filters[0])).toBe(true); input.filters[0].value = '外部修改'; expect(lease.scope.filters[0].value).toBe('A');
  });
  it('无条件完整范围也可预览；来源、对象和元数据资格不合时拒绝入口', () => {
    const info = source(), empty = new TableFilteredDeleteIntent({ connectionId: 'c', database: info.database, table: info.name }, info, { filters: [], filterMode: 'all', sort: [] }, [], () => true);
    expect(empty.input(randomUUID()).filters).toEqual([]);
    for (const changed of [{ ...info, objectKind: 'view' as const }, { ...info, engine: 'MyISAM' }, { ...info, editableKey: [] }, { ...info, editableKey: ['missing'] }, { ...info, editableKey: ['id', 'id'] }, { ...info, editableKey: ['note'] }]) expect(tableFilteredDeleteAvailable(changed)).toBe(false);
    expect(() => new TableFilteredDeleteIntent({ connectionId: 'c', database: '其它库', table: info.name }, info, { filters: [], filterMode: 'all', sort: [] }, [], () => true)).toThrow();
  });
  it('A→B→A、guard异常和一次观察失效均永久撤销原删除预览', () => {
    const lease = intent(); lease.observe(['page3']); lease.observe(['page2']); expect(lease.current()).toBe(false); expect(() => lease.input(randomUUID())).toThrow();
    let okay = true; const another = intent(() => okay); okay = false; expect(another.current()).toBe(false); okay = true; expect(another.current()).toBe(false); expect(intent(() => { throw Error('来源失效'); }).current()).toBe(false);
  });
  it('预览与提交只接受删除用途、准确目标、准确总数及省略关系', () => {
    const lease = intent(), input = lease.input(randomUUID()), preview = { operation: 'delete' as const, previewToken: randomUUID(), target: lease.target, rows: 512, shownRows: 1, sql: 'DELETE FROM sample WHERE old_value;', sampleOmitted: true, expiresAt: new Date(Date.now() + 60000).toISOString(), definitionDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64), timeZone: 'SYSTEM', warnings: [] };
    expect(checkTableFilteredDeletePreview(preview, input)).toEqual(preview);
    for (const changed of [{ ...preview, operation: 'update' }, { ...preview, target: { ...lease.target, table: '其它' } }, { ...preview, sampleOmitted: false }, { ...preview, rows: 0 }]) expect(() => checkTableFilteredDeletePreview(changed, input)).toThrow();
    const output = { operation: 'delete', target: lease.target, rows: 512, outcome: 'committed', commitAcknowledged: true };
    expect(checkTableFilteredDeleteApplied(output, preview)).toEqual(output);
    for (const changed of [{ ...output, operation: 'update' }, { ...output, rows: 1 }, { ...output, commitAcknowledged: false }]) expect(() => checkTableFilteredDeleteApplied(changed, preview)).toThrow();
  });
  it('COMMIT发送及准确全量ACK单调保持，不能用更新phase或坏ACK伪造删除成功', () => {
    const sent = mergeTableFilteredDeleteProgress(undefined, progress({ phase: 'committing', rows: 512, commitMayHaveBeenSent: true, dmlMayHaveBeenSent: true, outcome: 'unknown' }), 512)!;
    const old = mergeTableFilteredDeleteProgress(sent, progress(), 512)!; expect(old.commitMayHaveBeenSent).toBe(true); expect(old.outcome).toBe('unknown');
    expect(mergeTableFilteredDeleteProgress(old, progress({ commitAcknowledged: true, commitMayHaveBeenSent: true, rows: 1, outcome: 'committed' }), 512)).toBe(old);
    expect(mergeTableFilteredDeleteProgress(old, { ...progress(), phase: 'updating' }, 512)).toBe(old);
    const ack = mergeTableFilteredDeleteProgress(old, progress({ phase: 'finished', rows: 512, commitMayHaveBeenSent: true, commitAcknowledged: true, outcome: 'committed' }), 512)!;
    const late = mergeTableFilteredDeleteProgress(ack, progress(), 512)!; expect(late.outcome).toBe('committed'); expect(late.rows).toBe(512);
    expect(mergeTableFilteredDeleteProgress(undefined, progress({ rollbackAcknowledged: true, transactionProtected: true, outcome: 'rolled-back' }), 512)!.outcome).toBe('rolled-back');
  });
  it('真实删除后失保护永久保持unknown，回滚ACK及迟到旧true不能追认已回滚', () => {
    const active = mergeTableFilteredDeleteProgress(undefined, progress({ dmlMayHaveBeenSent: true, outcome: 'unknown' }), 512)!;
    const lost = mergeTableFilteredDeleteProgress(active, progress({ phase: 'rolling-back', dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    expect(lost.transactionProtected).toBe(false); expect(lost.rollbackAcknowledged).toBe(true); expect(lost.outcome).toBe('unknown');
    const late = mergeTableFilteredDeleteProgress(lost, progress({ dmlMayHaveBeenSent: true, transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }), 512)!;
    expect(late.transactionProtected).toBe(false); expect(late.outcome).toBe('unknown');
    const prepare = mergeTableFilteredDeleteProgress(late, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false, outcome: 'not-sent' }), 512)!;
    expect(prepare.transactionProtected).toBe(false); expect(prepare.dmlMayHaveBeenSent).toBe(true); expect(prepare.outcome).toBe('unknown');
  });
  it('初始及迟到prepare未发送DML的false不抹真实保护，正常受保护回滚仍可确认', () => {
    const initial = mergeTableFilteredDeleteProgress(undefined, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false }), 512)!;
    expect(initial.transactionProtected).toBe(false);
    const active = mergeTableFilteredDeleteProgress(initial, progress({ dmlMayHaveBeenSent: true, transactionProtected: true, outcome: 'unknown' }), 512)!;
    const late = mergeTableFilteredDeleteProgress(active, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false, outcome: 'not-sent' }), 512)!;
    expect(late.transactionProtected).toBe(true); expect(late.dmlMayHaveBeenSent).toBe(true); expect(late.outcome).toBe('unknown');
    const rollback = mergeTableFilteredDeleteProgress(late, progress({ phase: 'finished', dmlMayHaveBeenSent: true, transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }), 512)!;
    expect(rollback.transactionProtected).toBe(true); expect(rollback.outcome).toBe('rolled-back');
  });
  it('Main形状真实完整COMMIT ACK优先于失保护及迟到失败，不恢复失保护标志', () => {
    const lost = mergeTableFilteredDeleteProgress(undefined, progress({ dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    const committed = mergeTableFilteredDeleteProgress(lost, progress({ phase: 'finished', rows: 512, dmlMayHaveBeenSent: true, transactionProtected: false, commitMayHaveBeenSent: true, commitAcknowledged: true, outcome: 'committed' }), 512)!;
    expect(committed.commitAcknowledged).toBe(true); expect(committed.outcome).toBe('committed'); expect(committed.transactionProtected).toBe(false);
    const late = mergeTableFilteredDeleteProgress(committed, progress({ rows: 0, dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    expect(late.commitAcknowledged).toBe(true); expect(late.outcome).toBe('committed'); expect(late.rows).toBe(512); expect(late.totalRows).toBe(512); expect(late.transactionProtected).toBe(false);
  });
});
