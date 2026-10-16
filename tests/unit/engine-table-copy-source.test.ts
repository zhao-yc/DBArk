import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TableInfo, TablePage, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';
import { TableCopySources } from '../../src/engine/tableCopySources';
import { tableCopySourceReadSchema } from '../../src/shared/tableCopySource';

const profile: ConnectionProfile = { id: 'conn', name: '测试', group: '', color: '', dialect: 'mysql', host: 'unconnected.invalid', port: 3306, user: 'test' };
const info: TableInfo = { database: 'db', name: 'records', objectKind: 'table', engine: 'InnoDB', ddl: '', columns: [{ name: 'id', type: 'int', extra: '', nullable: false, generated: false, defaultValue: null, comment: '' }], primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [] };
const input = () => ({ connectionId: 'conn', database: 'db', table: 'records', page: 1, pageSize: 50, filters: [], sort: [] });
const page: TablePage = { columns: [{ key: 'id', name: 'id', type: 'int' }], rows: [{ id: 1 }], page: 1, pageSize: 50, hasMore: false };
let engine: Engine, events: TaskEvent[];
/** 连接仅为事件端口；查询和关闭都可独立延迟，绝不创建真实socket。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(); Object.assign(connection, { threadId: 11, destroy: vi.fn(() => connection.emit('end')) });
  return { profile, connection, signal, status: { version: '受控端口', dialect: 'mysql' }, broken: false, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
}
beforeEach(() => { mocks.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); mocks.execute.mockReset().mockResolvedValue({ rows: [], fields: [] }); mocks.tableInfo.mockReset().mockResolvedValue(structuredClone(info)); events = []; engine = new Engine(event => events.push(event)); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await engine.closeAll(); });

describe('引擎表复制源与原普通表页隔离', () => {
  it('主进程注入的profile只用于建连，公开严格租约输入仍拒绝其他字段', async () => { const read = vi.spyOn(TableCopySources.prototype, 'read').mockImplementation(async (_context, raw) => tableCopySourceReadSchema.parse(raw) as never); const request = { connectionId: 'conn', taskId: randomUUID(), pageRef: randomUUID(), rowRef: randomUUID() }; expect(await engine.handle('table.copySourceRead', { ...request, profile })).toEqual(request); expect(read.mock.calls[0][1]).toEqual(request); await expect(engine.handle('table.copySourceRead', { ...request, taskId: randomUUID(), profile, sql: 'SELECT 1' })).rejects.toThrow(); });
  it.each([undefined, false])('普通copySource=%s仍走原读取，不创建独立事务/来源', async copySource => {
    await engine.handle('connections.open', { id: 'conn', profile }); mocks.connect.mockClear();
    const read = vi.spyOn(engine as unknown as { readPage(...args: unknown[]): Promise<TablePage> }, 'readPage').mockResolvedValue(page), sources = vi.spyOn(TableCopySources.prototype, 'page');
    expect(await engine.handle('table.page', { ...input(), ...(copySource === false ? { copySource } : {}) })).toBe(page);
    expect(read).toHaveBeenCalledWith(expect.anything(), 'SELECT * FROM `db`.`records` ORDER BY `id` ASC LIMIT 51 OFFSET 0', 1, 50, false); expect(sources).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled(); expect(events).toHaveLength(0);
  });
  it('opt-in无缺列继续原值，独立任务安静且等严格关闭，未创建历史事件', async () => {
    const read = vi.spyOn(engine as unknown as { readPage(...args: unknown[]): Promise<TablePage> }, 'readPage').mockResolvedValue(page);
    expect(await engine.handle('table.page', { ...input(), profile, copySource: true, taskId: randomUUID() })).toBe(page);
    expect(read.mock.calls[0].slice(1)).toEqual(['SELECT * FROM `db`.`records` ORDER BY `id` ASC LIMIT 51 OFFSET 0', 1, 50, false, true]); expect(events).toHaveLength(0);
    const target = await mocks.connect.mock.results[0].value as ManagedConnection; expect(target.close).toHaveBeenCalledWith({ strict: true });
  });
  it('只读任务号在连接实际关闭之前保持占用', async () => {
    let finish!: () => void; const target = managed(); vi.mocked(target.close).mockImplementation(() => new Promise(resolve => { finish = resolve; })); mocks.connect.mockResolvedValue(target); vi.spyOn(engine as unknown as { readPage(...args: unknown[]): Promise<TablePage> }, 'readPage').mockResolvedValue(page);
    const taskId = randomUUID(), pending = engine.handle('table.page', { ...input(), profile, copySource: true, taskId }); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(engine.handle('table.page', { ...input(), profile, copySource: true, taskId })).rejects.toThrow('编号'); finish(); await pending; vi.mocked(target.close).mockResolvedValue(undefined); expect(events).toHaveLength(0);
  });
  it('15秒期限请求原取消，仍等命令与严格连接关闭，不提前返回', async () => {
    vi.useFakeTimers(); let commandDone!: () => void, finishRead!: () => void, finishClose!: () => void;
    vi.spyOn(TableCopySources.prototype, 'read').mockImplementation(async context => { commandDone = context.commandStarted(); await new Promise<void>(resolve => { finishRead = resolve; }); context.checkCancelled(); return {} as never; });
    const target = managed(); vi.mocked(target.close).mockImplementation(() => new Promise(resolve => { finishClose = resolve; })); mocks.connect.mockResolvedValueOnce(target).mockResolvedValueOnce(managed());
    const pending = engine.handle('table.copySourceRead', { connectionId: 'conn', profile, taskId: randomUUID(), pageRef: randomUUID(), rowRef: randomUUID() }); let settled = false; const observed = pending.then(() => { settled = true; }, error => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(0); expect(finishRead).toBeTypeOf('function'); await vi.advanceTimersByTimeAsync(15000); expect(mocks.execute).toHaveBeenCalledWith(expect.anything(), 'KILL CONNECTION 11'); expect(settled).toBe(false);
    commandDone(); finishRead(); await vi.advanceTimersByTimeAsync(0); expect(finishClose).toBeTypeOf('function'); expect(settled).toBe(false); finishClose(); expect(await observed).toBeInstanceOf(Error); expect(events).toHaveLength(0); vi.mocked(target.close).mockResolvedValue(undefined);
  });
  it('取消控制失败原错误保留，不宣称服务器任务已经结束', async () => {
    vi.useFakeTimers(); const target = managed(); mocks.connect.mockResolvedValueOnce(target).mockRejectedValueOnce(new Error('受控取消建连失败'));
    vi.spyOn(TableCopySources.prototype, 'read').mockImplementation(async context => { context.commandStarted(); await new Promise<void>((_, reject) => { target.connection.once('end', () => reject(new Error('受控连接终止'))); }); return {} as never; });
    const observed = engine.handle('table.copySourceRead', { connectionId: 'conn', profile, taskId: randomUUID(), pageRef: randomUUID(), rowRef: randomUUID() }).catch(error => error);
    await vi.advanceTimersByTimeAsync(15000); const failure = await observed; expect(failure.message).toContain('无法确认服务器任务已结束'); expect(failure.message).not.toContain('受控取消建连失败'); expect(events).toHaveLength(0);
  });
  it('新增流预算错误等待真实query.end，不以stream.close提前终结', async () => {
    const connection = new EventEmitter(), command = new EventEmitter(), stream = Readable.from([['x'.repeat(256 * 1024 + 1)]]); Object.assign(command, { stream: () => stream }); Object.assign(connection, { query: vi.fn(() => { queueMicrotask(() => command.emit('fields', [{ name: 'note', columnType: 253 }])); return command; }) });
    const target = { ...managed(), connection } as unknown as ManagedConnection;
    const reader = engine as unknown as { readPage(managed: ManagedConnection, sql: string, page: number, pageSize: number, binary: boolean, waitTerminal: boolean): Promise<TablePage> };
    let settled = false; const pending = reader.readPage(target, 'SELECT * FROM `db`.`records` LIMIT 51', 1, 50, false, true).catch(error => { settled = true; return error; });
    await vi.waitFor(() => expect(stream.destroyed).toBe(true)); expect(settled).toBe(false); command.emit('end'); expect((await pending).message).toContain('256 KiB'); expect(connection.listenerCount('end')).toBe(0); expect(command.listenerCount('end')).toBe(0);
  });
});
