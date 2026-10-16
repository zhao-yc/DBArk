import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TableApplyReceipts } from '../../src/main/tableApplyReceipts';
import { emptyTableApplyEvidence, mergeTableApplyProgress, parseTableApplyReceipt, type TableApplyReceipt } from '../../src/shared/tableApplyReceipt';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
const target = { connectionId: 'connection', connectionRevision: 1, database: 'db', table: 'subject' };
const changes = [{ kind: 'insert' as const, values: { value: '合成敏感字面量' } }];
const plan = { sql: '仅RAM预览', statements: [{ sql: 'INSERT 合成敏感字面量', params: ['合成敏感字面量'] }], warnings: [] };
function fixture() { const saved: TableApplyReceipt[] = [], store = { saveTableApplyReceipt: vi.fn((r: TableApplyReceipt) => { saved.push(structuredClone(r)); }) }, warning = vi.fn(), service = new TableApplyReceipts(store, warning); return { saved, store, warning, service }; }
describe('预览到派发的持久化栅栏与隐私', () => {
  it.each([1, 2])('第%d次初始保存失败时不生成可派发绑定，预览仍已消费', n => {
    const f = fixture(), { previewId } = f.service.preview(target, changes, plan); let calls = 0;
    f.store.saveTableApplyReceipt.mockImplementation(() => { if (++calls === n) throw Error('合成磁盘故障'); });
    expect(() => f.service.prepare('task', previewId, target, changes)).toThrow('合成磁盘故障');
    expect(() => f.service.prepare('task', previewId, target, changes)).toThrow('预览');
  });
  it.each(['revision', 'changes', 'target', 'missing'] as const)('%s变化不能沿用旧预览', kind => {
    const f = fixture(), p = f.service.preview(target, changes, plan);
    expect(() => f.service.prepare('t', kind === 'missing' ? undefined : p.previewId, { ...target, ...(kind === 'revision' ? { connectionRevision: 2 } : {}), ...(kind === 'target' ? { table: 'other' } : {}) }, kind === 'changes' ? [] : changes)).toThrow('预览');
    expect(f.saved).toHaveLength(0);
  });
  it('正确预览单次消费；回执、通用任务及最终本地记录不含SQL/值/摘要', () => {
    const f = fixture(), p = f.service.preview(target, changes, plan), binding = f.service.prepare('t', p.previewId, target, changes);
    expect(binding.plan).toEqual(plan.statements); expect(() => f.service.prepare('t', p.previewId, target, changes)).toThrow();
    f.service.receive('t', { operationId: binding.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } });
    expect(f.service.finish('t')).toMatchObject({ receiptId: binding.operationId, receiptSaved: true });
    expect(f.saved.at(-1)?.outcome).toBe('committed');
    const raw = JSON.stringify(f.saved); expect(raw).not.toContain('合成敏感字面量'); expect(raw).not.toContain('INSERT'); expect(raw).not.toContain('sha256');
    for (const status of ['failed', 'cancelled', 'running', 'completed'] as const) expect(persistedTaskMessage('table.apply', { taskId: 't', status, progress: 0, message: '合成敏感字面量' })).not.toContain('合成敏感字面量');
  });
  it('最终持久化失败不能改成DB失败或要求重写；磁盘原dispatching保守恢复未知', () => {
    const f = fixture(), p = f.service.preview(target, changes, plan), b = f.service.prepare('t', p.previewId, target, changes);
    f.store.saveTableApplyReceipt.mockImplementation(() => { throw Error('合成磁盘故障'); });
    f.service.receive('t', { operationId: b.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } });
    expect(f.service.finish('t')).toEqual({ receiptId: b.operationId, receiptSaved: false }); expect(f.warning).toHaveBeenCalled(); expect(f.saved.at(-1)?.phase).toBe('dispatching');
  });
  it('无可信事件时RPC收尾只生成unknown，不以响应成功伪造COMMIT', () => {
    const f = fixture(), p = f.service.preview(target, changes, plan); f.service.prepare('t', p.previewId, target, changes); f.service.finish('t'); expect(f.saved.at(-1)?.outcome).toBe('unknown');
  });
  it('错操作ID及迟到降级不能撤销终态，带额外敏感字段的记录被拒绝', () => {
    const f = fixture(), p = f.service.preview(target, changes, plan), b = f.service.prepare('t', p.previewId, target, changes), r = f.saved.at(-1)!;
    expect(mergeTableApplyProgress(r, { operationId: randomUUID(), sequence: 1, phase: 'terminal', reason: 'none', evidence: emptyTableApplyEvidence() })).toBe(r);
    expect(() => parseTableApplyReceipt({ ...r, sql: '秘密' })).toThrow();
    expect(() => mergeTableApplyProgress(r, { operationId: b.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), commitAcknowledged: true } })).toThrow();
  });
  it('renderer既不能注入内部绑定，也不能通过只读接口提交确认标签', () => {
    const { connectionRevision: _revision, ...publicTarget } = target;
    expect(validateCommand('table.apply', { ...publicTarget, changes, taskId: 't' })).toMatchObject({ taskId: 't' });
    expect(() => validateCommand('table.apply', { ...publicTarget, changes, taskId: 't', tableApplyBinding: {} })).toThrow();
    expect(() => validateCommand('table.applyReceipt.detail', { operationId: randomUUID(), outcome: 'committed' })).toThrow();
  });
  it('阶段倒退、数量不足的ACK和迟到终态都不能伪造成功', () => {
    const f = fixture(), p = f.service.preview(target, changes, plan), b = f.service.prepare('t', p.previewId, target, changes), r = f.saved.at(-1)!;
    expect(() => mergeTableApplyProgress(r, { operationId: b.operationId, sequence: 1, phase: 'prepared', reason: 'none', evidence: emptyTableApplyEvidence() })).toThrow('阶段');
    expect(() => mergeTableApplyProgress(r, { operationId: b.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } })).toThrow('计划');
    const done = mergeTableApplyProgress(r, { operationId: b.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } });
    expect(mergeTableApplyProgress(done, { operationId: b.operationId, sequence: 2, phase: 'terminal', reason: 'cancelled', evidence: emptyTableApplyEvidence() })).toBe(done);
  });
  it('短期缓存过期或引擎中断后令牌不复活', () => {
    let now = Date.now(); const saveTableApplyReceipt = vi.fn(), service = new TableApplyReceipts({ saveTableApplyReceipt }, () => {}, () => now);
    const p = service.preview(target, changes, plan); now += 300001;
    expect(() => service.prepare('t', p.previewId, target, changes)).toThrow('预览');
    const p2 = service.preview(target, changes, plan); service.interrupt(); expect(() => service.prepare('t', p2.previewId, target, changes)).toThrow('预览'); expect(saveTableApplyReceipt).not.toHaveBeenCalled();
  });
});
