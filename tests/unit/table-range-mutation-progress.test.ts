import { describe, expect, it } from 'vitest';
import { mergeTableFilteredDeleteProgress } from '../../src/main/tableFilteredDeleteProgress';
import { mergeTableFilteredUpdateProgress } from '../../src/main/tableFilteredUpdateProgress';
import { resultInsertTriggerVisibility } from '../../src/engine/tableFilteredUpdateProtocol';
import type { TableFilteredDeleteProgress } from '../../src/shared/tableFilteredDelete';
import type { TableFilteredUpdateProgress } from '../../src/shared/tableFilteredUpdate';

type CommonProgress = TableFilteredDeleteProgress & TableFilteredUpdateProgress;
const state = (patch: Partial<CommonProgress> = {}): CommonProgress => ({ phase: 'preparing', rows: 0, totalRows: 61, snapshotBytes: 10, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent', ...patch });
const merges = [
  { name: '删除', merge: (previous: CommonProgress | undefined, next: CommonProgress) => mergeTableFilteredDeleteProgress(previous, next) },
  { name: '填充', merge: (previous: CommonProgress | undefined, next: CommonProgress) => mergeTableFilteredUpdateProgress(previous, next) },
];

describe.each(merges)('Main $name 的原事务事实', ({ merge }) => {
  it('DML后失保护且收到ROLLBACK ACK仍未知；迟到旧true不能恢复', () => {
    const started = state({ dmlMayHaveBeenSent: true, transactionProtected: true, outcome: 'unknown', rows: 30 });
    const lost = merge(started, state({ dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown', rows: 30 }));
    expect(lost).toMatchObject({ transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' });
    expect(merge(lost as CommonProgress, started)).toMatchObject({ transactionProtected: false, outcome: 'unknown' });
    expect(merge(lost as CommonProgress, state())).toMatchObject({ transactionProtected: false, outcome: 'unknown' });
  });
  it('初始或迟到准备不等于失保护，完整受保护回滚仍可确认', () => {
    const started = merge(state(), state({ dmlMayHaveBeenSent: true, transactionProtected: true, outcome: 'unknown' }));
    const late = merge(started as CommonProgress, state());
    expect(late.transactionProtected).toBe(true);
    expect(merge(late as CommonProgress, state({ dmlMayHaveBeenSent: true, transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' })).outcome).toBe('rolled-back');
  });
  it('真实完整COMMIT ACK优先，保护字段仍保留失去的事实', () => {
    const lost = state({ dmlMayHaveBeenSent: true, transactionProtected: false, outcome: 'unknown' });
    const ack = state({ phase: 'finished', rows: 61, dmlMayHaveBeenSent: true, transactionProtected: true, commitMayHaveBeenSent: true, commitAcknowledged: true, outcome: 'committed' });
    const committed = merge(lost, ack);
    expect(committed).toMatchObject({ rows: 61, totalRows: 61, transactionProtected: false, outcome: 'committed', commitAcknowledged: true });
    expect(merge(committed as CommonProgress, lost)).toMatchObject({ rows: 61, totalRows: 61, outcome: 'committed', commitAcknowledged: true });
  });
  it('COMMIT可能已发后不能用ROLLBACK ACK改判，零DML读取保持未发送', () => {
    expect(merge(state({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, transactionProtected: true, outcome: 'unknown' }), state({ dmlMayHaveBeenSent: true, rollbackAcknowledged: true, transactionProtected: true, outcome: 'unknown' })).outcome).toBe('unknown');
    expect(merge(state(), state({ rollbackAcknowledged: true })).outcome).toBe('not-sent');
  });
});

describe('共享触发器可见性授权边界', () => {
  const target = { connectionId: 'c', database: 'db', table: 'subject' }, mode = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
  it.each(['`*`.*', '*.`*`', '`*`.`*`'])('引用星号%s不能冒充目标表全局TRIGGER', scope => {
    expect(resultInsertTriggerVisibility(['GRANT TRIGGER ON ' + scope + ' TO `u`@`%`'], target, mode)).toBe(false);
  });
  it('符号通配符及准确引用目标仍受支持', () => {
    for (const scope of ['*.*', '`db`.*', '`db`.`subject`']) expect(resultInsertTriggerVisibility(['GRANT TRIGGER ON ' + scope + ' TO `u`@`%`'], target, mode)).toBe(true);
    expect(resultInsertTriggerVisibility(['GRANT TRIGGER ON `*`.* TO `u`@`%`'], { ...target, database: '*' }, mode)).toBe(true);
  });
});
