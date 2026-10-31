import { afterEach, expect, it, vi } from 'vitest';
import { sqliteDriverLimits, type SqliteProcessExit, type SqliteProcessTransport } from '../../src/engine/sqlite/protocol';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('RAM账本测试不能启动Electron'); } } }));
import { SqliteProcessRegistry } from '../../src/main/sqliteProcess';
afterEach(() => vi.useRealTimers());

/** 独立句柄的exit由本例显式完成，不拿kill()返回值充当真实资源终态。 */
function transport() {
  let finish!: (value: SqliteProcessExit) => void; const exited = new Promise<SqliteProcessExit>(resolve => { finish = resolve; });
  const value: SqliteProcessTransport = { send() {}, onMessage: () => () => {}, terminate: vi.fn(() => true), exited };
  return { value, exit: () => finish({ code: 0, signal: null }) };
}
it('每个创建句柄直到真实exit才从账本移除，调用者丢弃引用不影响资源归属', async () => {
  const first = transport(), second = transport(), queue = [first.value, second.value], registry = new SqliteProcessRegistry(() => queue.shift()!);
  registry.create(); registry.create(); expect(registry.pending).toBe(2); first.exit(); await first.value.exited; expect(registry.pending).toBe(1); second.exit(); await second.value.exited; expect(registry.pending).toBe(0);
});
it('终止超时保留原句柄并阻止新建；晚到exit后明确重试才能恢复创建', async () => {
  vi.useFakeTimers(); const f = transport(), registry = new SqliteProcessRegistry(() => f.value); registry.create();
  const result = registry.terminateAll().catch(error => error); await vi.advanceTimersByTimeAsync(sqliteDriverLimits.exitTimeoutMs);
  expect(await result).toBeInstanceOf(Error); expect(registry.pending).toBe(1); expect(() => registry.create()).toThrow('不能新建会话');
  f.exit(); await f.value.exited; expect(registry.pending).toBe(0); await registry.terminateAll();
});
it('一个终止调用抛错也尝试其它准确句柄，只凭全部实际exit完成关闭', async () => {
  const first = transport(), second = transport(); vi.mocked(first.value.terminate).mockImplementation(() => { throw Error('本例第一句柄失败'); });
  const queue = [first.value, second.value], registry = new SqliteProcessRegistry(() => queue.shift()!); registry.create(); registry.create();
  const work = registry.terminateAll(); expect(registry.terminateAll()).toBe(work); await Promise.resolve(); expect(second.value.terminate).toHaveBeenCalledOnce(); expect(registry.pending).toBe(2);
  first.exit(); second.exit(); await work; expect(registry.pending).toBe(0);
});
