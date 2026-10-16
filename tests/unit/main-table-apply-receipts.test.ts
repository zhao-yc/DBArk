import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { TableApplyReceipts } from '../../src/main/tableApplyReceipts';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { emptyTableApplyEvidence, type TableApplyReceipt } from '../../src/shared/tableApplyReceipt';

/** 执行主进程原dispatch/taskEvent，替换Electron和网络边界，不复制生产派发逻辑。 */
function fixture() {
  const tasks = new Map(), savedTasks: unknown[] = [], receipts: TableApplyReceipt[] = [];
  const store = { connectionRevision: () => 1, saveTask: (r: unknown) => savedTasks.push(r), saveTableApplyReceipt: vi.fn((r: TableApplyReceipt) => { receipts.push(structuredClone(r)); }) };
  const service = new TableApplyReceipts(store), request = vi.fn(async (_command: string, _input: any): Promise<any> => ({ affectedRows: 1 }));
  const context = createContext({ tableApplyReceipts: service, tasks, completionTasks: new Set(), preparingTasks: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), files: new Map(), sessions: new Map(), lastPersist: new Map(), savedQueryPages: undefined, historyPages: undefined, window: undefined,
    store, broker: { request }, connectionConfig: { assertAvailable() {} }, persistAuxiliary: (f: () => void) => f(), persistedTaskMessage, SavedQuerySearchCancelled: class extends Error {}, shuttingDown: false });
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ['taskEvent', 'dispatch'].map(name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast)).join('\n');
  runInContext(ts.transpileModule(functions + '\nglobalThis.entry={dispatch,taskEvent}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const entry = context.entry as { dispatch(command: string, input: any): Promise<any>; taskEvent(event: any): void };
  const changes = [{ kind: 'insert' as const, values: { text: '合成秘密值' } }], target = { connectionId: 'c', connectionRevision: 1, database: 'db', table: 'subject' }, plan = { sql: '合成秘密SQL', statements: [{ sql: '合成秘密SQL', params: ['合成秘密值'] }], warnings: [] };
  const p = service.preview(target, changes, plan), input = { connectionId: 'c', database: 'db', table: 'subject', taskId: 'task', previewId: p.previewId, changes };
  return { tasks, store, service, request, entry, input, receipts, savedTasks };
}
describe('主进程可信绑定与零派发栅栏', () => {
  it('回执初始保存失败时broker零调用', async () => {
    const f = fixture(); f.store.saveTableApplyReceipt.mockImplementation(() => { throw Error('合成磁盘故障'); });
    await expect(f.entry.dispatch('table.apply', f.input)).rejects.toThrow('合成磁盘故障'); expect(f.request).not.toHaveBeenCalled();
  });
  it('关联通用任务的初始保存失败仍零派发，本地回执明确未发送', async () => {
    const f = fixture(), save = f.store.saveTask; let n = 0;
    f.store.saveTask = r => { if (++n === 2) throw Error('合成关联保存故障'); return save(r); };
    await expect(f.entry.dispatch('table.apply', f.input)).rejects.toThrow('合成关联保存故障'); expect(f.request).not.toHaveBeenCalled(); expect(f.receipts.at(-1)?.outcome).toBe('not-sent');
  });
  it('无预览的旧入口明确拒绝，不能绕过回执和单次消费', async () => {
    const f = fixture(); await expect(f.entry.dispatch('table.apply', { ...f.input, previewId: undefined })).rejects.toThrow('预览'); expect(f.request).not.toHaveBeenCalled();
  });
  it('只将main生成的绑定发给Engine；RPC成功缺ACK不伪造成功，错误脱敏', async () => {
    const f = fixture(); await expect(f.entry.dispatch('table.apply', f.input)).rejects.toThrow('结果未知'); const output = { receiptId: f.receipts.at(-1)!.operationId, receiptSaved: true };
    expect(f.request).toHaveBeenCalledOnce(); expect(f.request.mock.calls[0][1].tableApplyBinding.operationId).toBe(output.receiptId); expect(output.receiptSaved).toBe(true); expect(f.receipts.at(-1)?.outcome).toBe('unknown');
    expect(JSON.stringify(f.receipts)).not.toContain('合成秘密'); expect(JSON.stringify(f.savedTasks)).not.toContain('合成秘密');
  });
  it('真实Engine事件在RPC前落盘；之后RPC/关闭异常不降级已确认提交', async () => {
    const f = fixture(); f.request.mockImplementation(async (_c, i) => {
      f.entry.taskEvent({ taskId: i.taskId, status: 'running', progress: 0, message: '合成秘密SQL', tableApply: { operationId: i.tableApplyBinding.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } } });
      throw Error('合成秘密错误');
    });
    expect(await f.entry.dispatch('table.apply', f.input)).toMatchObject({ affectedRows: 1, cleanupWarning: true }); expect(f.receipts.at(-1)?.outcome).toBe('committed'); expect(JSON.stringify(f.savedTasks)).not.toContain('合成秘密');
  });
});
