import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';

const ports = vi.hoisted(() => ({ connect: vi.fn(), prepare: vi.fn() }));
/** 只替换物理连接与文件暂存端口；真实Engine.handle/编号/严格收尾/取消/终态不替换。 */
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: ports.connect }));
vi.mock('../../src/engine/tableFilteredExport', async () => ({ ...await vi.importActual('../../src/engine/tableFilteredExport'), prepareTableFilteredExport: ports.prepare }));
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'filtered-memory', name: '过滤导出RAM', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'synthetic', color: '#123456', group: '' };
/** 原可控句柄定位close、rename、dispose边界，不通过sleep推测资源已经结束。 */
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
let engine: Engine, events: TaskEvent[], trace: string[], closeGate: ReturnType<typeof deferred> | undefined, beforeCommit: ReturnType<typeof deferred> | undefined, renameGate: ReturnType<typeof deferred> | undefined, disposeGate: ReturnType<typeof deferred> | undefined, closeFailure: boolean, disposeFailure: boolean, committed: boolean, closes: { strict: boolean }[], taskMode: boolean;
const request = () => engine.handle('table.exportFiltered', { connectionId: profile.id, database: 'db', table: 'subject', taskId: 'filtered-task', fileToken: 'private-token', filePath: 'private-target', metadataKey: 'bound-metadata', filters: [], sort: [], format: 'json', encoding: 'utf8' });
beforeEach(async () => {
  events = []; trace = []; closes = []; closeGate = beforeCommit = renameGate = disposeGate = undefined; closeFailure = disposeFailure = committed = taskMode = false;
  ports.connect.mockReset().mockImplementation(async () => ({ profile, status: { version: '8.4.11', dialect: 'mysql' }, broken: false, connection: { threadId: 42 }, async close(options?: { strict?: boolean }) { closes.push({ strict: options?.strict === true }); trace.push('close-start'); if (taskMode) await closeGate?.promise; if (taskMode && closeFailure) throw Error('原严格close失败'); trace.push('close-return'); } } as unknown as ManagedConnection));
  ports.prepare.mockReset().mockImplementation(async (context, _input, control) => {
    trace.push('prepared');
    return { rows: 1234, get fileCommitted() { return committed; }, async commit() { context.checkCancelled(); trace.push('commit-check'); await beforeCommit?.promise; control.onCommitStart(); trace.push('rename-start'); await renameGate?.promise; committed = true; trace.push('rename-return'); return { rows: 1234, fileCommitted: true }; }, async dispose() { trace.push('dispose-start'); await disposeGate?.promise; if (disposeFailure) throw Error('合成文件清理报告失败'); trace.push('dispose-return'); } };
  });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile }); taskMode = true; trace = []; closes = [];
});

describe('完整筛选导出真实Engine文件完成边界（RAM）', () => {
  it('原数据库strictclose返回之后才允许rename，dispose完成之后才完成任务', async () => {
    closeGate = deferred(); disposeGate = deferred(); let settled = false;
    const pending = request().finally(() => { settled = true; }); await vi.waitFor(() => expect(trace).toContain('close-start'));
    expect(trace).not.toContain('rename-start'); expect(settled).toBe(false); expect(closes).toEqual([{ strict: true }]); closeGate.resolve();
    await vi.waitFor(() => expect(trace).toContain('dispose-start')); expect(committed).toBe(true); expect(settled).toBe(false); expect(events.some(event => event.status === 'completed')).toBe(false);
    disposeGate.resolve(); expect(await pending).toEqual({ rows: 1234, fileCommitted: true }); expect(trace).toEqual(['prepared', 'close-start', 'close-return', 'commit-check', 'rename-start', 'rename-return', 'dispose-start', 'dispose-return']); expect(events.at(-1)?.status).toBe('completed'); await engine.closeAll();
  });
  it('数据库strictclose失败不能替换文件，仍dispose暂存且保留独立资源未知', async () => {
    closeFailure = true; await expect(request()).rejects.toThrow('连接关闭失败'); expect(trace).not.toContain('rename-start'); expect(trace).toContain('dispose-return'); expect(committed).toBe(false); expect(events.at(-1)?.status).toBe('failed');
    await expect(engine.closeAll()).rejects.toThrow('资源未确认释放');
  });
  it('建连尚未返回时取消也占用原任务号并等待原connect拒绝，不留下文件或重连', async () => {
    let entered = false;
    ports.connect.mockImplementationOnce(async (_profile, _database, signal: AbortSignal) => { entered = true; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('原建连已取消')), { once: true })); });
    const pending = request(), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(entered).toBe(true)); await engine.handle('query.cancel', { taskId: 'filtered-task' }); await rejected;
    expect(ports.prepare).not.toHaveBeenCalled(); expect(trace).not.toContain('rename-start'); expect(ports.connect).toHaveBeenCalledTimes(2); expect(events.at(-1)?.status).toBe('cancelled'); await engine.closeAll();
  });
  it('数据库关闭期间取消只标记并等待原close，禁止迟到KILL/文件替换', async () => {
    closeGate = deferred(); let cancelled = false; const pending = request(), rejected = expect(pending).rejects.toThrow('取消');
    await vi.waitFor(() => expect(trace).toContain('close-start')); const cancellation = engine.handle('query.cancel', { taskId: 'filtered-task' }).then(() => { cancelled = true; }); await Promise.resolve(); expect(cancelled).toBe(false); expect(ports.connect).toHaveBeenCalledTimes(2);
    closeGate.resolve(); await cancellation; await rejected; expect(trace).not.toContain('rename-start'); expect(trace).toContain('dispose-return'); expect(events.at(-1)?.status).toBe('cancelled'); await engine.closeAll();
  });
  it('prepare身份读取等异步发布前置阶段仍可取消，onCommitStart必须再次核验', async () => {
    beforeCommit = deferred(); const pending = request(), rejected = expect(pending).rejects.toThrow('取消');
    await vi.waitFor(() => expect(trace).toContain('commit-check')); const cancellation = engine.handle('query.cancel', { taskId: 'filtered-task' }); beforeCommit.resolve(); await cancellation; await rejected;
    expect(trace).not.toContain('rename-start'); expect(committed).toBe(false); expect(events.at(-1)?.status).toBe('cancelled'); await engine.closeAll();
  });
  it('rename已进入不可取消边界，迟到取消等待原终态且保存fileCommitted事实', async () => {
    renameGate = deferred(); let cancellationReturned = false; const pending = request(); await vi.waitFor(() => expect(trace).toContain('rename-start'));
    const cancellation = engine.handle('query.cancel', { taskId: 'filtered-task' }).then(() => { cancellationReturned = true; }); await Promise.resolve(); expect(cancellationReturned).toBe(false); renameGate.resolve();
    expect(await pending).toEqual({ rows: 1234, fileCommitted: true }); await cancellation; expect(events.at(-1)?.status).toBe('completed'); expect(events.some(event => event.status === 'cancelled')).toBe(false); await engine.closeAll();
  });
  it('文件收尾仍保留编号和配置锁，不能在DBclose后抢占任务号或替换认证', async () => {
    disposeGate = deferred(); const pending = request(); await vi.waitFor(() => expect(trace).toContain('dispose-start'));
    await expect(request()).rejects.toThrow('任务已在执行'); await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'other.invalid' }, transportChanged: true })).rejects.toThrow('正在执行');
    disposeGate.resolve(); await pending; await engine.closeAll();
  });
  it('退出也等待文件commit原终态，不遗留替换仍后台进行', async () => {
    renameGate = deferred(); let returned = false; const pending = request(); await vi.waitFor(() => expect(trace).toContain('rename-start'));
    const exiting = engine.closeAll().then(() => { returned = true; }); await Promise.resolve(); expect(returned).toBe(false); renameGate.resolve(); await pending; await exiting; expect(trace).toContain('dispose-return');
  });
  it('完成通知回调异常不把已替换文件假报为未导出', async () => {
    engine = new Engine(event => { events.push(event); if (event.status === 'completed') throw Error('合成通知失败'); }); taskMode = false; await engine.handle('connections.open', { id: profile.id, profile }); taskMode = true;
    expect(await request()).toEqual({ rows: 1234, fileCommitted: true }); expect(committed).toBe(true); await engine.closeAll();
  });
  it('原文件已提交后的清理报告异常仍保留已保存事实，不转换为取消或建议自动重试', async () => {
    disposeFailure = true; expect(await request()).toEqual({ rows: 1234, fileCommitted: true }); expect(committed).toBe(true); expect(events.some(event => event.message.includes('文件已保存'))).toBe(true); expect(events.at(-1)?.status).toBe('completed'); await engine.closeAll();
  });
});
