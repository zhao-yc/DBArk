import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'c', name: '测试', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const column = { name: 'Id', type: 'int', nullable: false, defaultValue: null, extra: '', comment: '', generated: false };
const parent: TableInfo = { database: 'server_db', name: 'Parent', columns: [column], primaryKey: ['Id'], editableKey: ['Id'], indexes: [{ name: 'PRIMARY', columns: ['Id'], unique: true }], foreignKeys: [], engine: 'InnoDB', ddl: '' };
const child: TableInfo = { ...parent, database: 'source_db', name: 'Child', editableKey: [], foreignKeys: [{ name: 'FK_server', columns: ['id'], referencedColumns: ['id'], referencedDatabase: 'server_db', referencedTable: 'Parent', onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }] };
const input = { connectionId: 'c', database: 'source_db', table: 'Child', foreignKeyName: 'fk_server', page: 1, pageSize: 10, filters: [], sort: [], taskId: 'ref' };
let engine: Engine, events: TaskEvent[], queried: string[], values: unknown[][];
/** 模拟驱动网络和流事件，只验证任务与资源生命周期，不代替真实数据库语义。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const query = vi.fn((options: { sql: string }) => {
    queried.push(options.sql); const emitter = new EventEmitter(); const stream = Readable.from(values);
    Object.assign(emitter, { stream: () => stream });
    queueMicrotask(() => emitter.emit('fields', [{ name: 'Id', columnType: 3 }])); return emitter;
  });
  return { profile, signal, connection: { query, destroy: vi.fn() }, close: vi.fn(async () => undefined), status: { version: '模拟', dialect: 'mysql' }, broken: false } as unknown as ManagedConnection;
}
beforeEach(async () => {
  queried = []; values = [[1]]; events = []; mocks.connect.mockReset().mockImplementation(async (_p, _db, signal) => managed(signal));
  mocks.tableInfo.mockReset().mockImplementation(async (_m, db) => db === 'source_db' ? child : parent);
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: 'c', profile });
});
describe('独立关联查询生命周期', () => {
  it('仅从服务器外键决定目标，readonly源可查看且映射列规范化', async () => {
    const result = await engine.handle('table.referencePage', input); expect(result.foreignKey.columns).toEqual(['Id']); expect(result.foreignKey.referencedColumns).toEqual(['Id']);
    expect(queried[0]).toContain('`server_db`.`Parent`'); expect(mocks.tableInfo.mock.calls.map(([, db, name]) => [db, name])).toEqual([['source_db','Child'],['server_db','Parent']]); expect(events.at(-1)?.status).toBe('completed');
  });
  it('元数据失败不得降级成无筛选父页', async () => { mocks.tableInfo.mockRejectedValueOnce(new Error('权限不足')); await expect(engine.handle('table.referencePage', input)).rejects.toThrow('权限不足'); expect(queried).toEqual([]); expect(events.at(-1)?.status).toBe('failed'); });
  it('大字段不返回残缺可选记录', async () => { values = [['x'.repeat(262145)]]; await expect(engine.handle('table.referencePage', input)).rejects.toThrow('256 KiB'); expect(events.at(-1)?.status).toBe('failed'); });
  it('连接尚未建立时即可取消，并等待迟到连接close才释放编号', async () => {
    let resolve!: (value: ManagedConnection) => void; let signal!: AbortSignal;
    mocks.connect.mockImplementationOnce((_p, _db, value) => { signal = value; return new Promise<ManagedConnection>(done => { resolve = done; }); });
    const running = engine.handle('table.referencePage', input); const rejected = expect(running).rejects.toThrow('取消');
    const cancelling = engine.handle('query.cancel', { taskId: 'ref' }); expect(signal.aborted).toBe(true);
    await expect(engine.handle('table.referencePage', input)).rejects.toThrow('任务');
    await expect(engine.handle('__connections.prepareSave', { id: 'c', profile: { ...profile, host: 'new' }, transportChanged: true })).rejects.toThrow('仍有');
    let release!: () => void; const late = managed(signal); late.close = vi.fn(() => new Promise<void>(done => { release = done; }));
    resolve(late); await vi.waitFor(() => expect(late.close).toHaveBeenCalled()); expect(events.at(-1)?.status).toBe('running');
    release(); await cancelling; await rejected; expect(events.at(-1)?.status).toBe('cancelled'); expect(mocks.tableInfo).not.toHaveBeenCalled();
  });
  it('closeAll取消pending建连，拒绝新操作并等待资源收尾', async () => {
    let resolve!: (value: ManagedConnection) => void; let signal!: AbortSignal;
    mocks.connect.mockImplementationOnce((_p, _db, value) => { signal = value; return new Promise<ManagedConnection>(done => { resolve = done; }); });
    const running = engine.handle('table.referencePage', input); const rejected = expect(running).rejects.toThrow('取消'); const closing = engine.closeAll();
    expect(signal.aborted).toBe(true); await expect(engine.handle('table.referencePage', { ...input, taskId: 'new' })).rejects.toThrow('正在关闭');
    const late = managed(signal); resolve(late); await closing; await rejected; expect(late.close).toHaveBeenCalledOnce();
  });
  it('独立读取期间保留全局任务编号，与文件任务共享命名空间', async () => {
    let release!: () => void; mocks.tableInfo.mockImplementationOnce(() => new Promise<TableInfo>(done => { release = () => done(child); }));
    const running = engine.handle('table.referencePage', input); await vi.waitFor(() => expect(release).toBeDefined());
    await expect(engine.handle('files.exportResult', { taskId: 'ref', filePath: 'unused' })).rejects.toThrow('任务编号'); release(); await running;
  });
  it('服务器取消控制失败也释放本地任务与连接，不伪报服务器已取消', async () => {
    let release!: () => void; const active = managed(); Object.assign(active.connection, { threadId: 123 });
    mocks.connect.mockResolvedValueOnce(active);
    mocks.tableInfo.mockImplementationOnce(() => new Promise<TableInfo>(done => { release = () => done(child); }));
    const running = engine.handle('table.referencePage', input); const failed = expect(running).rejects.toThrow('无法确认服务器'); await vi.waitFor(() => expect(release).toBeDefined());
    mocks.connect.mockRejectedValueOnce(new Error('控制连接不可达'));
    const cancelling = engine.handle('query.cancel', { taskId: input.taskId }); const cancelled = expect(cancelling).rejects.toThrow('无法确认服务器');
    release(); await failed; await cancelled; expect(active.close).toHaveBeenCalledOnce(); expect(events.at(-1)?.status).toBe('failed');
    await expect(engine.handle('table.referencePage', input)).resolves.toBeDefined();
  });
  it('控制连接建立时持有原任务，KILL只针对捕获的专用连接编号', async () => {
    let release!: () => void; const active = managed(); Object.assign(active.connection, { threadId: 123 });
    mocks.connect.mockResolvedValueOnce(active); mocks.execute.mockReset().mockResolvedValue({ rows: [] });
    mocks.tableInfo.mockImplementationOnce(() => new Promise<TableInfo>(done => { release = () => done(child); }));
    const running = engine.handle('table.referencePage', input); const failed = expect(running).rejects.toThrow('取消'); await vi.waitFor(() => expect(release).toBeDefined());
    let connected!: (value: ManagedConnection) => void; mocks.connect.mockImplementationOnce(() => new Promise<ManagedConnection>(resolve => { connected = resolve; }));
    const cancelling = engine.handle('query.cancel', { taskId: input.taskId }); release(); await Promise.resolve(); expect(active.close).not.toHaveBeenCalled();
    connected(managed()); await cancelling; await failed; expect(mocks.execute.mock.calls.map(([, sql]) => sql)).toEqual(['KILL CONNECTION 123']); expect(active.close).toHaveBeenCalledOnce();
  });
});
