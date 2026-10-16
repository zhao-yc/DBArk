import { describe, expect, it, vi } from 'vitest';
import { TableApplyReceipts } from '../../src/main/tableApplyReceipts';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';
import type { TaskRecord } from '../../src/shared/contracts';
import { emptyTableApplyEvidence, type TableApplyReceipt } from '../../src/shared/tableApplyReceipt';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const target = { connectionId: 'c', connectionRevision: 1, database: 'db', table: 'subject' };
const changes = [{ kind: 'insert' as const, values: { value: '仅RAM' } }];
const plan = { sql: '仅RAM', statements: [{ sql: '仅RAM', params: ['仅RAM'] }], warnings: [] };
function record(id: string, kind = 'table.apply', status: TaskRecord['status'] = 'running'): TaskRecord { return { id, kind, status, progress: 0, message: '文案不作为依据', startedAt: '2026-10-17T00:00:00.000Z' }; }

describe('主进程只读取消快照', () => {
  it('仅当前任务可授权；磁盘旧任务、结束任务、普通查询分别明确处理', () => {
    const table = vi.fn(() => 'confirming' as const), t = { ...record('t'), tableApplyReceiptId: 'current' };
    expect(taskCancelSnapshot(['t', 'q', 'done', 'missing', 't'], new Map([['t', t], ['q', record('q', 'query.execute')], ['done', record('done', 'table.apply', 'failed')]]), table)).toEqual([
      { taskId: 't', state: 'confirming' }, { taskId: 'q', state: 'allowed' }, { taskId: 'done', state: 'finished' }, { taskId: 'missing', state: 'checking' }
    ]);
    expect(table).toHaveBeenCalledExactlyOnceWith('t', 'current');
  });
  it('提交状态来自当前RAM绑定，即使COMMIT辅助写盘失败也不能读旧executing恢复取消', () => {
    const disk: TableApplyReceipt[] = [], save = vi.fn((r: TableApplyReceipt) => { disk.push(structuredClone(r)); }), service = new TableApplyReceipts({ saveTableApplyReceipt: save });
    const preview = service.preview(target, changes, plan), binding = service.prepare('t', preview.previewId, target, changes);
    const read = () => service.cancelState('t', binding.operationId);
    expect(read()).toBe('checking'); expect(service.cancelState('t', undefined)).toBe('checking'); expect(service.cancelState('t', 'old')).toBe('checking');
    const evidence = { ...emptyTableApplyEvidence(), transactionProtected: true, transactionKnown: true, transactionOpen: true };
    service.receive('t', { operationId: binding.operationId, sequence: 1, phase: 'executing', reason: 'none', evidence }); expect(read()).toBe('allowed');
    save.mockImplementation(() => { throw Error('模拟辅助写盘失败'); });
    service.receive('t', { operationId: binding.operationId, sequence: 2, phase: 'committing', reason: 'none', evidence: { ...evidence, dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true } });
    const writes = save.mock.calls.length;
    expect(disk.at(-1)?.phase).toBe('executing'); expect(read()).toBe('confirming'); expect(save).toHaveBeenCalledTimes(writes);
    service.finish('t'); expect(read()).toBe('finished'); service.interrupt();
  });
  it('无事务保护与回滚阶段不开放取消，事件绑定或序号错误不改变可信状态', () => {
    const service = new TableApplyReceipts({ saveTableApplyReceipt() {} });
    const p = service.preview(target, changes, plan), b = service.prepare('t', p.previewId, target, changes);
    const read = () => service.cancelState('t', b.operationId);
    service.receive('t', { operationId: b.operationId, sequence: 1, phase: 'executing', reason: 'none', evidence: emptyTableApplyEvidence() }); expect(read()).toBe('checking');
    service.receive('t', { operationId: b.operationId, sequence: 2, phase: 'rolling-back', reason: 'conflict', evidence: { ...emptyTableApplyEvidence(), transactionProtected: true, transactionKnown: true, transactionOpen: true } }); expect(read()).toBe('checking');
    service.receive('t', { operationId: b.operationId, sequence: 1, phase: 'executing', reason: 'none', evidence: emptyTableApplyEvidence() }); expect(read()).toBe('checking'); service.interrupt();
  });
  it('公开只读输入严格有界，不能注入状态证据', () => {
    expect(publicCommands['tasks.cancelState']).toBe(true); expect(validateCommand('tasks.cancelState', { taskIds: ['t'] })).toEqual({ taskIds: ['t'] });
    for (const input of [{ taskIds: ['t'], state: 'allowed' }, { taskIds: Array(201).fill('t') }, { taskIds: [''] }, { taskIds: ['x'.repeat(201)] }]) expect(() => validateCommand('tasks.cancelState', input)).toThrow();
  });
});
