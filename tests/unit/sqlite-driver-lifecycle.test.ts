import { afterEach, expect, it, vi } from 'vitest';
import { SqliteDriverSession } from '../../src/engine/sqlite/session';
import { sqliteDriverLimits as limits, type SqliteProcessExit, type SqliteProcessTransport, type SqliteWorkerRequest, type SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';

afterEach(() => vi.useRealTimers());
/** 这里只验证父端的失败证明，不以RAM消息替代真实SQLite取消测试。 */
function fixture() {
  let receive: (message: SqliteWorkerResponse) => void = () => {}, finish!: (value: SqliteProcessExit) => void;
  const exited = new Promise<SqliteProcessExit>(resolve => { finish = resolve; });
  const sent: SqliteWorkerRequest[] = [], terminate = vi.fn(() => true); let closeFails = false;
  const transport: SqliteProcessTransport = {
    exited, terminate,
    onMessage(listener) { receive = listener; queueMicrotask(() => listener({ kind: 'ready' })); return () => { receive = () => {}; }; },
    send(message) { sent.push(message); if (message.kind === 'open') receive({ kind: 'opened', id: message.id, version: 'RAM协议', transaction: false, readOnly: false }); if (message.kind === 'close' && closeFails) throw Error('本例投递失败'); },
  };
  return { transport, sent, terminate, emit: (message: SqliteWorkerResponse) => receive(message), exit: () => finish({ code: 0, signal: null }), closeFails: () => { closeFails = true; } };
}
const options = { path: '/仅用于RAM协议/不访问文件.sqlite', readOnly: false, busyTimeoutMs: 0 };

it('取消缺少真实exit时拒绝资源已确认；原句柄仍可在后续实际退出后收尾', async () => {
  vi.useFakeTimers(); const f = fixture(), session = await SqliteDriverSession.open(() => f.transport, options);
  const execution = session.execute('SELECT 1').catch(error => error), cancellation = session.cancel().catch(error => error);
  await vi.advanceTimersByTimeAsync(limits.cancelGraceMs + limits.exitTimeoutMs);
  expect(f.terminate).toHaveBeenCalledOnce(); expect(await cancellation).toMatchObject({ code: 'SQLITE_EXIT_UNCONFIRMED', sessionClosed: false }); expect(await execution).toMatchObject({ code: 'SQLITE_EXIT_UNCONFIRMED' });
  expect(session.isClosed).toBe(false); f.exit(); await f.transport.exited; await Promise.resolve(); await session.close(); expect(session.isClosed).toBe(true);
});
it('无活动任务但协议已失效时，idle取消不能绕过未确认的进程资源', async () => {
  vi.useFakeTimers(); const f = fixture(), session = await SqliteDriverSession.open(() => f.transport, options);
  f.emit({ kind: 'ready' }); const result = session.cancel().catch(error => error);
  await vi.advanceTimersByTimeAsync(limits.exitTimeoutMs); expect(await result).toMatchObject({ code: 'SQLITE_EXIT_UNCONFIRMED' }); expect(session.isClosed).toBe(false);
  f.exit(); await f.transport.exited; await session.close();
});
it('关闭投递同步失败不留下未处理的ACK拒绝，后续exit仍被准确记录', async () => {
  const f = fixture(), session = await SqliteDriverSession.open(() => f.transport, options); f.closeFails();
  await expect(session.close()).rejects.toThrow('本例投递失败'); f.exit(); await f.transport.exited; await Promise.resolve(); await session.close(); expect(session.isClosed).toBe(true);
});
it.each(['missing-header', 'missing-statement-end'] as const)('拒绝%s乱序，不发布不属于已确认语句的结果', async kind => {
  const f = fixture(), session = await SqliteDriverSession.open(() => f.transport, options), consumer = vi.fn();
  const execution = session.execute('SELECT 1; SELECT 2', { onStatement: consumer, onBatch: consumer }).catch(error => error), command = f.sent.find(message => message.kind === 'execute')!;
  if (kind === 'missing-header') f.emit({ kind: 'batch', id: command.id, frame: 1, index: -1, rows: [[null]] });
  else { f.emit({ kind: 'statement', id: command.id, frame: 1, index: 0, sql: 'SELECT 1', columns: [] }); f.emit({ kind: 'statement', id: command.id, frame: 2, index: 1, sql: 'SELECT 2', columns: [] }); }
  expect(f.terminate).toHaveBeenCalledOnce(); f.exit(); await f.transport.exited;
  expect(await execution).toMatchObject({ code: 'SQLITE_PROTOCOL_ERROR', sessionClosed: true }); expect(consumer).not.toHaveBeenCalled(); await session.close();
});
