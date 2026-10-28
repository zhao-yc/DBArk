import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { MetadataQuery } from '../../src/engine/metadata';
const io = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), metadata: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: io.connect, execute: io.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: io.metadata }));
import { Engine } from '../../src/engine';
import { ConnectionResourceOwner } from '../../src/engine/connectionResourceState';

const profile: ConnectionProfile = { id: 'preflight-offline', name: '离线预检', dialect: 'mysql', host: 'never.invalid', port: 1, user: 'none', group: '', color: '#123456' };
const target = { connectionId: profile.id, database: 'isolated', table: 'target' };
const info: TableInfo = { database: target.database, name: target.table, objectKind: 'table', engine: 'InnoDB', columns: [
  { name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '', defaultValue: null, comment: '' },
  { name: 'amount', type: 'decimal(30,12)', nullable: true, generated: false, extra: '', defaultValue: null, comment: '' }
], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
let engine: Engine, folder: string, events: TaskEvent[], connections: any[], hook: ((event: TaskEvent) => void) | undefined;
/** 用可明确释放的Promise代替时间等待，精确观察连接关闭与任务编号占用。 */
function latch() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

/** 只替换网络和目录边界；真实Engine、文件读取、核心扫描和资源账本保持执行。 */
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dbark-preflight-engine-')); events = []; connections = []; hook = undefined;
  io.connect.mockReset().mockImplementation(async (_profile, _database, signal?: AbortSignal, capture?: (value: unknown) => void) => {
    const stream = Object.assign(new EventEmitter(), { closed: false, destroy(this: EventEmitter & { closed: boolean }) { if (!this.closed) { this.closed = true; this.emit('close'); } } });
    const connection = Object.assign(new EventEmitter(), { threadId: 100 + connections.length, stream, destroy: () => stream.destroy() });
    const owner = new ConnectionResourceOwner(() => stream, () => stream.destroy()); owner.captureTransport(true); owner.seal(); capture?.(owner.recovery);
    const managed: any = { profile, connection, signal, resources: owner.recovery, broken: false, sqlMode: '', serverStatus: 2, transactionStateKnown: true, status: { dialect: 'mysql', version: '8.4.11' }, close: vi.fn(async () => stream.destroy()) };
    Object.assign(connection, { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
      void io.execute(managed, sql).then((result: { rows: unknown; fields: unknown[] }) => callback(null, result.rows, result.fields), (error: Error) => callback(error));
    } });
    connections.push(managed); return managed;
  });
  io.execute.mockReset().mockResolvedValue({ rows: [], fields: [] });
  io.metadata.mockReset().mockImplementation(async (_managed, _database, _table, query: MetadataQuery) => {
    // 目录替身仍穿过正式structureTaskQuery，证明SQL沿独立连接而非直接绕过命令账本。
    await query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [target.database, target.table]);
    return structuredClone(info);
  });
  engine = new Engine(event => { events.push(event); hook?.(event); });
  await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { hook = undefined; await engine.closeAll(); await rm(folder, { recursive: true, force: true }); });
/** 真实文件作为Main已授权路径传入Engine；本层不替代Main的token验证。 */
async function input(taskId = 'preflight', source = 'id,amount\n1,2\n') {
  const filePath = join(folder, 'source.csv'); await writeFile(filePath, source);
  return { ...target, taskId, filePath, fileToken: 'main-authorized', format: 'csv', encoding: 'utf8', mapping: { id: 'id', amount: 'amount' } };
}
/** 预检和取消控制均不能发写入/事务命令，也不能读取目标记录。 */
function assertReadOnly() {
  expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE|DELETE|REPLACE|START|BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))).toBe(false);
  expect(io.execute.mock.calls.every(([, sql]) => /^SELECT COLUMN_NAME FROM information_schema\.COLUMNS\b|^KILL CONNECTION \d+$/.test(sql))).toBe(true);
}

describe('整文件预检真实Engine入口', () => {
  it('第21条后仍检查多字段，全部计数且零DML或事务命令', async () => {
    const result = await engine.handle('files.preflight', await input('count', 'id,amount\n' + '1,2\n'.repeat(21) + '坏,错\n'.repeat(205)));
    expect(result).toMatchObject({ checkedRecords: 226, validRecords: 21, invalidRecords: 205, issueCount: 410, truncated: true, complete: true });
    expect(result.issues).toHaveLength(200); expect(result.issues[0].record).toBe(22);
    expect(io.metadata).toHaveBeenCalledTimes(2); assertReadOnly();
    expect(events.at(-1)).toMatchObject({ taskId: 'count', status: 'completed', rows: 226 });
    expect(connections.at(-1).close).toHaveBeenCalledWith({ strict: true });
    expect(connections.at(-1).connection.stream.closed).toBe(true);
    expect((engine as any).independentTasks.size).toBe(0); expect((engine as any).independentResources.owns('count')).toBe(false);
  });
  it('预检使用新连接，保留原查询会话事务、模式及诊断缓存', async () => {
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id });
    const session = connections.at(-1); session.serverStatus = 3; session.sqlMode = 'ANSI_QUOTES'; session.diagnosticMarker = '原诊断';
    const before = await engine.handle('query.sessionState', { sessionId }); io.execute.mockClear();
    await engine.handle('files.preflight', await input('independent'));
    expect(io.metadata.mock.calls.every(([managed]) => managed !== session)).toBe(true);
    expect(io.execute.mock.calls.every(([managed]) => managed !== session)).toBe(true);
    expect(connections.at(-1)).not.toBe(session);
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual(before);
    expect(session).toMatchObject({ serverStatus: 3, sqlMode: 'ANSI_QUOTES', diagnosticMarker: '原诊断', transactionStateKnown: true, broken: false });
    expect(session.close).not.toHaveBeenCalled(); expect(session.connection.stream.closed).toBe(false); assertReadOnly();
  });
  it('扫描结束后仍等物理关闭，拒绝重复编号，收尾后同编号可复用', async () => {
    const factory = io.connect.getMockImplementation()!, gate = latch(), closing = latch(); let managed: any;
    io.connect.mockImplementationOnce(async (...args: any[]) => {
      managed = await factory(...args); const close = managed.close.getMockImplementation();
      managed.close.mockImplementation(async (...values: any[]) => { closing.resolve(); await gate.promise; return close(...values); }); return managed;
    });
    const request = await input('closing'), pending = engine.handle('files.preflight', request); let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await closing.promise; expect(settled).toBe(false); expect(managed.connection.stream.closed).toBe(false); expect((engine as any).independentResources.owns(request.taskId)).toBe(true);
      await expect(engine.handle('files.preflight', request)).rejects.toThrow('编号');
    } finally { gate.resolve(); await pending; }
    expect(managed.connection.stream.closed).toBe(true); expect((engine as any).independentTasks.size).toBe(0); expect((engine as any).independentResources.owns(request.taskId)).toBe(false);
    expect(await engine.handle('files.preflight', request)).toMatchObject({ complete: true, checkedRecords: 1 }); assertReadOnly();
  });
  it('建连期取消保留任务编号直到迟到原连接真实关闭，之后可复用', async () => {
    const factory = io.connect.getMockImplementation()!, connecting = latch(), connectGate = latch(), closing = latch(), closeGate = latch(); let managed: any, signal: AbortSignal | undefined;
    io.connect.mockImplementationOnce(async (...args: any[]) => {
      signal = args[2]; connecting.resolve(); await connectGate.promise; managed = await factory(...args);
      const close = managed.close.getMockImplementation(); managed.close.mockImplementation(async (...values: any[]) => { closing.resolve(); await closeGate.promise; return close(...values); }); return managed;
    });
    const request = await input('cancel-connect'), pending = engine.handle('files.preflight', request), rejected = expect(pending).rejects.toThrow('取消');
    await connecting.promise; let cancelled = false;
    const cancellation = engine.handle('query.cancel', { taskId: request.taskId }).then(() => { cancelled = true; });
    expect(signal?.aborted).toBe(true);
    try {
      await expect(engine.handle('files.preflight', request)).rejects.toThrow('编号'); connectGate.resolve(); await closing.promise;
      expect(cancelled).toBe(false); expect(managed.connection.stream.closed).toBe(false); expect(io.metadata).not.toHaveBeenCalled();
    } finally { connectGate.resolve(); closeGate.resolve(); await rejected; await cancellation; }
    expect(managed.connection.stream.closed).toBe(true); expect((engine as any).independentTasks.size).toBe(0); expect((engine as any).independentResources.owns(request.taskId)).toBe(false);
    expect(await engine.handle('files.preflight', request)).toMatchObject({ complete: true }); assertReadOnly();
  });
  it('扫描时取消等待原连接严格关闭和资源归还，不借用原查询会话', async () => {
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id }); const session = connections.at(-1);
    session.serverStatus = 3; const before = await engine.handle('query.sessionState', { sessionId });
    const factory = io.connect.getMockImplementation()!, closing = latch(), closeGate = latch(); let managed: any;
    io.connect.mockImplementationOnce(async (...args: any[]) => {
      managed = await factory(...args); const close = managed.close.getMockImplementation();
      managed.close.mockImplementation(async (...values: any[]) => { closing.resolve(); await closeGate.promise; return close(...values); }); return managed;
    });
    const request = await input('cancel-scan', 'id,amount\n' + '1,2\n'.repeat(20000));
    let cancellation: Promise<void> | undefined, cancelled = false;
    hook = event => { if (event.taskId === request.taskId && (event.rows ?? 0) >= 128 && !cancellation) cancellation = engine.handle('query.cancel', { taskId: request.taskId }).then(() => { cancelled = true; }); };
    const pending = engine.handle('files.preflight', request), rejected = expect(pending).rejects.toThrow('取消');
    try {
      await closing.promise; expect(cancellation).toBeDefined(); expect(cancelled).toBe(false); expect(managed.connection.stream.closed).toBe(false);
      await expect(engine.handle('files.preflight', request)).rejects.toThrow('编号');
    } finally { closeGate.resolve(); await rejected; await cancellation; hook = undefined; }
    expect(managed.close).toHaveBeenCalledWith({ strict: true }); expect(managed.connection.stream.closed).toBe(true);
    expect((engine as any).independentTasks.size).toBe(0); expect((engine as any).tasks.size).toBe(0); expect((engine as any).independentResources.owns(request.taskId)).toBe(false);
    expect(await engine.handle('query.sessionState', { sessionId })).toEqual(before); expect(session.close).not.toHaveBeenCalled();
    expect(io.execute.mock.calls.every(([connection]) => connection !== session)).toBe(true);
    expect(await engine.handle('files.preflight', request)).toMatchObject({ complete: true, checkedRecords: 20000 }); assertReadOnly();
  });
});
