import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TaskEvent } from '../../src/shared/contracts';
import type { QueryFrameConsumer } from '../../src/engine/queryStreamProtocol';
import type { QueryStreamFileOptions } from '../../src/engine/queryStreamFile';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), frames: vi.fn(), create: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/queryStreamProtocol', () => ({ consumeQueryFrames: mocks.frames }));
vi.mock('../../src/engine/queryStreamFile', () => ({ createQueryStreamFile: mocks.create }));
import { Engine } from '../../src/engine';

let engine: Engine, events: TaskEvent[], sessionId: string, options: QueryStreamFileOptions;
let writer: { rowsWritten: number; bytesWritten: number; fileCommitted: boolean; write: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
const input = () => ({ sessionId, taskId: 'stream', sql: 'SELECT 1', fileToken: 'f', filePath: 'trusted.json', format: 'json', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } });
beforeEach(async () => {
  mocks.connect.mockReset().mockImplementation(async () => ({ connection: { threadId: 41, destroy: vi.fn() }, profile: { id: 'p' }, status: { dialect: 'mysql', version: '8.4' }, sqlMode: '', serverStatus: 3, transactionStateKnown: true, broken: false, close: vi.fn() }));
  mocks.execute.mockReset().mockResolvedValue({ rows: {}, fields: [] });
  mocks.frames.mockReset().mockImplementation(async (_managed: ManagedConnection, _sql: string, _wire: string, consumer: QueryFrameConsumer) => {
    const resultOrdinal = ++consumer.ordinals.results;
    await consumer.consume({ kind: 'rows-start', resultOrdinal, statementOrdinal: consumer.statementOrdinal, rowResultOrdinal: ++consumer.ordinals.rows, columns: [{ position: 1, key: 'c0', name: 'v', exportName: 'v', type: 'LONG' }] });
    for (let index = 0; index < 205; index++) await consumer.consume({ kind: 'row', resultOrdinal, values: [index] });
    await consumer.consume({ kind: 'rows-end', resultOrdinal });
  });
  writer = { rowsWritten: 0, bytesWritten: 0, fileCommitted: false, write: vi.fn(async frame => { options.checkCancelled(); if (frame.kind === 'row') writer.rowsWritten++; }), complete: vi.fn(async () => { options.checkCancelled(); options.onCommitStart(); writer.fileCommitted = true; }), abort: vi.fn(async () => undefined) };
  mocks.create.mockReset().mockImplementation(async (value: QueryStreamFileOptions) => { options = value; return writer; });
  events = []; engine = new Engine(event => events.push(event));
  await engine.handle('connections.open', { id: 'p', profile: { id: 'p' } });
  sessionId = (await engine.handle('sessions.open', { connectionId: 'p' })).sessionId;
});

describe('同会话完整导出生命周期', () => {
  it('脚本只发送一次，预览200行但文件消费全部，事务保持并释放目标文件锁', async () => {
    const output = await engine.handle('query.exportStream', { ...input(), sql: 'SELECT 1;SELECT 2' });
    expect(mocks.frames.mock.calls.map(call => call[1])).toEqual(['SELECT 1', 'SELECT 2']);
    expect(output.results.map((result: { rowsWritten: number }) => result.rowsWritten)).toEqual([205, 205]);
    expect(output.preview.results.map((result: { rows: unknown[]; truncated: boolean }) => [result.rows.length, result.truncated])).toEqual([[200, true], [200, true]]);
    expect(output.transactionOpen).toBe(true); expect(output.transactionKnown).toBe(true); expect(writer.abort).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled(); expect(events.at(-1)?.queryExport?.fileCommitted).toBe(true);
  });
  it('参数缺失在首条写SQL前拒绝，不提交文件且保留结构化准备阶段', async () => {
    await expect(engine.handle('query.exportStream', { ...input(), sql: 'INSERT INTO t VALUES (:v)', parameters: [] })).rejects.toThrow('准备');
    expect(mocks.frames).not.toHaveBeenCalled(); expect(writer.complete).not.toHaveBeenCalled(); expect(writer.abort).toHaveBeenCalledOnce();
    expect(events.at(-1)?.queryExport).toMatchObject({ phase: 'preparing', fileCommitted: false, sqlMayHaveExecuted: false, statementsCompleted: 0 });
  });
  it('创建临时文件期间可取消并保留会话互斥，迟到文件准备不发送SQL', async () => {
    let release!: () => void;
    mocks.create.mockImplementation(async (value: QueryStreamFileOptions) => { options = value; await new Promise<void>(resolve => { release = resolve; }); return writer; });
    const running = engine.handle('query.exportStream', input()); const failed = expect(running).rejects.toThrow('取消');
    await expect(engine.handle('query.transaction', { sessionId, action: 'rollback' })).rejects.toThrow('正在执行');
    await engine.handle('query.cancel', { taskId: 'stream' }); release(); await failed;
    expect(mocks.frames).not.toHaveBeenCalled(); expect(events.at(-1)?.status).toBe('cancelled');
    await engine.handle('query.transaction', { sessionId, action: 'rollback' });
  });
  it('进入原子替换后晚到取消不伪造取消终态，替换失败则明确失败', async () => {
    writer.complete.mockImplementation(async () => { options.onCommitStart(); await engine.handle('query.cancel', { taskId: 'stream' }); writer.fileCommitted = true; });
    expect((await engine.handle('query.exportStream', input())).fileCommitted).toBe(true); expect(events.at(-1)?.status).toBe('completed');
    writer.fileCommitted = false;
    writer.complete.mockImplementation(async () => { options.onCommitStart(); await engine.handle('query.cancel', { taskId: 'stream' }); throw new Error('原子替换失败'); });
    await expect(engine.handle('query.exportStream', input())).rejects.toThrow('文件提交');
    expect(events.at(-1)?.status).toBe('failed'); expect(events.at(-1)?.queryExport).toMatchObject({ phase: 'committing', fileCommitted: false, statementsCompleted: 1, sqlMayHaveExecuted: true });
  });
  it.each([false, true])('SQL ERR 后清理失败仍刷新事务未知、保留执行摘要和参数脱敏（参数模式 %s）', async parameterized => {
    mocks.frames.mockImplementation(async (managed: ManagedConnection, _sql: string, _wire: string, consumer: QueryFrameConsumer) => {
      await consumer.consume({ kind: 'status', resultOrdinal: ++consumer.ordinals.results, statementOrdinal: consumer.statementOrdinal, affectedRows: 0, insertId: '0', warningCount: 0 });
      if (consumer.statementOrdinal === 2) {
        // 模拟真实协议 ERR：状态包后的旧事务位仍保留，但可信性已经失效。
        managed.transactionStateKnown = false; managed.sqlMode = undefined; managed.noBackslashEscapesKnown = false;
        throw new Error('服务器 ERR：参数秘密');
      }
    });
    writer.abort.mockRejectedValue(new Error('删除临时文件失败：清理秘密'));
    const error = await engine.handle('query.exportStream', { ...input(), sql: 'SELECT 1;SELECT 2', ...(parameterized ? { parameters: [] } : {}) }).catch(value => value as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('执行阶段失败；已完成 1 条 SQL'); expect(error.message).toContain('SQL 可能已执行'); expect(error.message).toContain('临时文件清理失败');
    if (parameterized) { expect(error.message).not.toContain('参数秘密'); expect(error.message).not.toContain('清理秘密'); }
    else { expect(error.message).toContain('服务器 ERR：参数秘密'); expect(error.message).toContain('删除临时文件失败：清理秘密'); }
    const final = events.at(-1)!;
    expect(final.status).toBe('failed'); expect(final.message).toBe(error.message);
    expect(final.queryExport).toMatchObject({ phase: 'executing', statementsCompleted: 1, sqlMayHaveExecuted: true, fileCommitted: false, transactionKnown: false });
    expect(final.queryExport?.transactionOpen).toBeUndefined();
    expect(writer.abort).toHaveBeenCalledOnce(); expect(writer.complete).not.toHaveBeenCalled(); expect(mocks.frames).toHaveBeenCalledTimes(2);
    await engine.handle('query.transaction', { sessionId, action: 'rollback' });
  });
});
