import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { SqliteTableEditOwners } from '../../src/main/sqliteTableEditOwners';
import { SqliteWriteRecords } from '../../src/main/sqliteWriteRecords';
import { sqliteTableEditMessages, type SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import { sqliteWriteFactMessage } from '../../src/shared/sqliteWriteFact';

const profile = { id: 'trusted', dialect: 'sqlite', name: '仅测试', sqlite: { filePath: '不打开真实文件', readOnly: false, busyTimeoutMs: 0 } };
const target = { connectionId: profile.id, database: 'main' as const, table: 'subject' };
const pageInput = { ...target, taskId: 'read', limit: 10, offset: 0, mode: 'and', filters: [], sort: [], editing: true };
const change = { kind: 'update', row: 0, values: [{ column: 'value', value: { kind: 'text', value: '本例秘密原值不是任务概要' } }] };
/** 实走原Main IPC/dispatch和文档能力，只有数据库进程与持久化OS边界替换为可控端口。 */
function fixture() {
  const f = mainColumnsHarness(), save = vi.fn((_task: unknown) => {}), epochs = new Map<string, object>();
  Object.assign(f.context, { structuredClone, sqliteTableEditMessages, sqliteWriteFactMessage, tableValueOptionsConnectionOwners: epochs, tableValueOptionsClosing: new Map() });
  Object.assign(f.context.store, { connections: () => [profile], saveTask: save, addHistory: () => { throw Error('编辑不能进入用户SQL历史'); }, resolveConnection: () => { throw Error('编辑不读取网络凭据'); } });
  const owners = new SqliteTableEditOwners({ assert: owner => f.capabilities.assertCapturedOwner(owner), same: (a, b) => f.capabilities.sharesDocumentOwner(a, b), revision: () => f.context.store.connectionRevision(), epoch: id => { let value = epochs.get(id); if (!value) { value = {}; epochs.set(id, value); } return value; }, available: id => f.context.connectionConfig.assertAvailable(id), closing: () => f.context.shuttingDown, release: async input => { await f.request('sqlite.tableEdit.release', input); }, stop: async taskId => { const pending = f.context.preparingTasks.get(taskId); if (pending) { pending.cancelled = true; return; } await f.request('query.cancel', { taskId }); } });
  const records = new SqliteWriteRecords({ task: id => f.tasks.get(id), replace: value => f.tasks.set(value.id, value), save: value => f.context.store.saveTask(value) });
  Object.assign(f.context, { sqliteEdits: owners, sqliteWrites: records });
  const page = { target: { ...target, kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'value', declaredType: 'TEXT' }], result: { columns: [{ key: 'c0', name: 'value', type: 'SQLITE' }], rows: [{ c0: '旧值' }], truncated: false, statement: '', elapsedMs: 0 }, limit: 10, offset: 0, hasMore: false, edit: { kind: 'editable', snapshotId: 's', expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), columns: [{ name: 'value', declaredType: 'TEXT', generated: false, nullable: true, hasDefault: false }], rows: [[{ kind: 'text', value: '旧值' }]], locator: { kind: 'rowid', columns: [] } } };
  const preview = { previewId: 'p', snapshotId: 's', target, schemaKey: page.schemaKey, confirmation: 'main.subject', expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), sql: ['UPDATE 仅界面预览'], counts: { insert: 0, update: 1, delete: 0 } };
  const fact = (input: any, phase: SqliteWriteFact['phase']): SqliteWriteFact => ({ operationId: input.operationId, target, phase, requestedRows: 1, appliedRows: phase === 'committed' || phase === 'rolled-back' ? 1 : 0, commitMayHaveBeenSent: phase === 'committed' || phase === 'commit-pending' || phase === 'unknown', commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' });
  f.request.mockImplementation(async (command, input) => {
    if (command === 'sqlite.tablePage') return page;
    if (command === 'sqlite.tableEdit.preview') return preview;
    if (command === 'sqlite.tableEdit.release' || command === 'query.cancel') return;
    if (command === 'sqlite.tableEdit.apply') { input.assertCurrent(); input.recordWriteFact(fact(input, 'writing')); input.recordWriteFact(fact(input, 'commit-pending')); input.recordWriteFact(fact(input, 'committed')); return { operationId: input.operationId, target, outcome: 'committed', counts: preview.counts, fact: fact(input, 'committed'), message: sqliteTableEditMessages.committed }; }
    throw Error('未知数据库命令');
  });
  const prepare = async () => { await f.run('sqlite.tablePage', pageInput); return f.run('sqlite.tableEdit.preview', { snapshotId: 's', taskId: 'preview', changes: [change] }); };
  const apply = (taskId = 'apply') => f.run('sqlite.tableEdit.apply', { previewId: 'p', taskId, confirmation: 'main.subject' });
  return { ...f, owners, records, epochs, save, page, preview, fact, prepare, apply };
}
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
describe('SQLite编辑真实Main边界', () => {
  it('原页签发能力，预览只传typed差异，Main注入随机操作与同步持久回调，已确认提交撤旧页', async () => {
    const f = fixture(); await f.prepare(); const result = await f.apply();
    expect(result.outcome).toBe('committed'); expect(f.tasks.get('apply')?.sqliteWrite).toEqual(result.fact); expect(f.tasks.get('apply')?.status).toBe('completed');
    expect(f.request.mock.calls.find(([command]) => command === 'sqlite.tableEdit.preview')?.[1]).toEqual({ snapshotId: 's', taskId: 'preview', changes: [change] });
    const sent = f.request.mock.calls.find(([command]) => command === 'sqlite.tableEdit.apply')?.[1]; expect(sent.operationId).toMatch(/^[a-f0-9-]{36}$/); expect(typeof sent.assertCurrent).toBe('function'); expect(typeof sent.recordWriteFact).toBe('function'); expect(sent).not.toHaveProperty('profile');
    expect(() => f.owners.snapshot(f.capabilities.capture(f.event()), 's')).toThrow(); expect(JSON.stringify(result.fact)).not.toContain(change.values[0].value.value);
  });
  it('重复task编号、外文档及未知token拒绝在投递前；重复编号不消费原可用预览', async () => {
    const f = fixture(); await f.prepare(); await expect(f.apply('read')).rejects.toThrow('任务编号'); expect(() => f.owners.lookup(f.capabilities.capture(f.event()), 'p')).not.toThrow();
    await expect(f.run('sqlite.tableEdit.preview', { snapshotId: 'unknown', taskId: 'new', changes: [change] })).rejects.toThrow();
    f.context.window.webContents.emit('did-navigate'); await expect(f.apply()).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableEdit.apply')).toBe(false);
  });
  it('私有回调和操作ID不能从renderer注入，未保存的错误方言不能签编辑页', async () => {
    const f = fixture(); await expect(f.run('sqlite.tableEdit.apply', { previewId: 'p', taskId: 'a', confirmation: 'main.subject', recordWriteFact: () => {} })).rejects.toThrow();
    f.context.store.connections = () => [{ ...profile, dialect: 'mysql' }]; await expect(f.run('sqlite.tablePage', pageInput)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
  });
  it('页读取或预览等待时换配置，迟到新能力准确释放，不交付新来源', async () => {
    const f = fixture(), pending = deferred(); f.request.mockImplementation(async command => command === 'sqlite.tablePage' ? pending.promise : undefined);
    const reading = f.run('sqlite.tablePage', pageInput), refused = expect(reading).rejects.toThrow(); f.setRevision(8); pending.resolve(f.page); await refused;
    expect(f.request).toHaveBeenCalledWith('sqlite.tableEdit.release', { snapshotId: 's' });
  });
  it('已确认回滚保留草稿来源，但一次预览不能重复使用，下一次必须明确重新预览', async () => {
    const f = fixture(); await f.prepare(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableEdit.apply') return original(command, input); input.recordWriteFact(f.fact(input, 'writing')); input.recordWriteFact(f.fact(input, 'rolled-back')); return { operationId: input.operationId, target, outcome: 'rolled-back', counts: f.preview.counts, fact: f.fact(input, 'rolled-back'), message: '整批回滚' }; });
    expect((await f.apply()).outcome).toBe('rolled-back'); expect(f.tasks.get('apply')?.status).toBe('failed'); expect(() => f.owners.snapshot(f.capabilities.capture(f.event()), 's')).not.toThrow(); await expect(f.apply('again')).rejects.toThrow();
  });
  it('ACK后broker或本地记录后续失败仍交付committed与警告，不让用户重放', async () => {
    const f = fixture(); await f.prepare(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableEdit.apply') return original(command, input); input.recordWriteFact(f.fact(input, 'commit-pending')); input.recordWriteFact(f.fact(input, 'committed')); throw Error('ACK后通道异常'); });
    const result = await f.apply(); expect(result).toMatchObject({ outcome: 'committed', cleanupWarning: true }); expect(f.tasks.get('apply')?.status).toBe('completed');
  });
  it('终态展示通道反复失败不能把已确认提交回包改成IPC拒绝或未知', async () => {
    const f = fixture(); await f.prepare(); const originalEvent = f.context.taskEvent;
    f.context.taskEvent = (event: any) => { originalEvent(event); if (event.taskId === 'apply' && event.status === 'completed') throw Error('原窗口展示端口已关闭'); };
    await expect(f.apply()).resolves.toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } });
    expect(f.tasks.get('apply')?.status).toBe('completed'); expect(f.tasks.get('apply')?.sqliteWrite?.commitAcknowledged).toBe(true);
    expect(() => f.owners.snapshot(f.capabilities.capture(f.event()), 's')).toThrow();
  });
  it('发送后无确定终态变unknown并撤旧来源，取消ACK不提前结算原任务', async () => {
    const f = fixture(); await f.prepare(); const pending = deferred(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableEdit.apply') return original(command, input); input.recordWriteFact(f.fact(input, 'commit-pending')); return pending.promise; });
    let done = false; const running = f.apply().then(result => { done = true; return result; }); await flush(); await f.run('query.cancel', { taskId: 'apply' }); expect(done).toBe(false);
    pending.reject(Error('未收到COMMIT终态')); const result = await running; expect(result.outcome).toBe('unknown'); expect(result.fact.commitAcknowledged).toBe(false); expect(f.tasks.get('apply')?.sqliteWrite?.phase).toBe('unknown'); expect(() => f.owners.snapshot(f.capabilities.capture(f.event()), 's')).toThrow();
  });
});
