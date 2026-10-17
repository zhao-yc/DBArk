import { describe, expect, it, vi } from 'vitest';
import { EditorIndentNativeRun, type IndentNativeOwner, type IndentNativePort } from '../e2e/editor-indentation-native-owner';
/** 专属run真实执行，端口仅RAM，不导入Electron、文件、Socket或真实PID探测。 */
function fixture() {
  let next = 0; const calls: string[] = [];
  const port: IndentNativePort = {
    assertCurrent: vi.fn(), preflight: vi.fn(async () => { calls.push('原socket预检完成'); }), directory: vi.fn(async () => { calls.push('目录'); return '/tmp/dbark-indent-RAM'; }), assertDirectory: vi.fn(async () => {}),
    launch: vi.fn(async () => { calls.push('启动'); return { application: { id: ++next }, page: { id: next }, ids: new Set(), ready: false, closed: false, confirmed: false, errors: [], quitReady: Promise.resolve() } as unknown as IndentNativeOwner; }), prepare: vi.fn(async () => {}), record: vi.fn(async () => [101 + next, 201 + next]),
    quit: vi.fn(async owner => { calls.push('正常退出'); owner.ready = true; owner.closed = true; }), absent: vi.fn(async () => { calls.push('所属PID不存在'); }), remove: vi.fn(async () => { calls.push('删除目录'); }),
  }; return { port, run: new EditorIndentNativeRun(port), calls };
}
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('缩进两次独立启动的专属owner合同（RAM）', () => {
  it('拒连/原close预检未完成时零目录零启动；完成后仅启动一次', async () => {
    const f = fixture(), gate = deferred(); vi.mocked(f.port.preflight).mockReturnValue(gate.promise); const pending = f.run.launch(); await Promise.resolve(); expect(f.port.directory).not.toHaveBeenCalled(); expect(f.port.launch).not.toHaveBeenCalled(); gate.resolve(); const owner = await pending; expect(f.run.owners).toEqual([owner]); expect(f.port.launch).toHaveBeenCalledTimes(1);
  });
  it('两次预检、两个独立owner各自正常退出和PID证明完成后才读盘/删除', async () => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first); const read = vi.fn(async () => '原SQLite'); expect(await f.run.stopped(read)).toBe('原SQLite'); const second = await f.run.launch(); expect(second).not.toBe(first); await f.run.close(second); await f.run.finish();
    expect(f.port.preflight).toHaveBeenCalledTimes(2); expect(f.port.directory).toHaveBeenCalledTimes(1); expect(f.port.quit).toHaveBeenCalledTimes(2); expect(f.port.absent).toHaveBeenCalledTimes(2); expect(f.run.owners.every(owner => owner.confirmed)).toBe(true); expect(f.run.removed).toBe(true); expect(f.calls.at(-1)).toBe('删除目录');
  });
  it('预检失败无目录/启动且永久停链，不在finally强停或重试', async () => {
    const f = fixture(); vi.mocked(f.port.preflight).mockRejectedValue(Error('原socket未close')); await expect(f.run.launch()).rejects.toThrow('原socket未close'); await expect(f.run.launch()).rejects.toThrow('owner已失效'); expect(f.port.preflight).toHaveBeenCalledTimes(1); expect(f.port.directory).not.toHaveBeenCalled(); expect(f.port.quit).not.toHaveBeenCalled(); expect(f.port.remove).not.toHaveBeenCalled();
  });
  it('准备失败仍保留已捕获的原应用及PID，不漏掉已启动owner', async () => {
    const f = fixture(); vi.mocked(f.port.prepare).mockRejectedValue(Error('窗口准备失败')); await expect(f.run.launch()).rejects.toThrow('窗口准备失败'); expect(f.run.owners).toHaveLength(1); expect([...f.run.owners[0].ids]).toEqual([102, 202]); expect(f.run.retained).toBe(true); expect(f.port.quit).not.toHaveBeenCalled(); expect(f.port.remove).not.toHaveBeenCalled();
  });
  it.each(['无握手', '无close', '页面错误', 'PID权限错误', '无PID'] as const)('%s不能确认正常退出、重启、读盘或删除', async condition => {
    const f = fixture(), owner = await f.run.launch();
    if (condition === '无握手') vi.mocked(f.port.quit).mockImplementation(async value => { value.closed = true; });
    if (condition === '无close') vi.mocked(f.port.quit).mockImplementation(async value => { value.ready = true; });
    if (condition === '页面错误') owner.errors.push('合成错误');
    if (condition === 'PID权限错误') vi.mocked(f.port.absent).mockRejectedValue(Error('EPERM'));
    if (condition === '无PID') vi.mocked(f.port.record).mockResolvedValue([]);
    await expect(f.run.close(owner)).rejects.toThrow(); expect(owner.confirmed).toBe(false); const read = vi.fn(async () => '禁止读盘'); await expect(f.run.stopped(read)).rejects.toThrow(); await expect(f.run.launch()).rejects.toThrow(); expect(read).not.toHaveBeenCalled(); expect(f.port.launch).toHaveBeenCalledTimes(1); expect(f.port.remove).not.toHaveBeenCalled();
  });
  it('首owner未确认就请求下一实例会停链，不分配或强关原实例', async () => {
    const f = fixture(); await f.run.launch(); await expect(f.run.launch()).rejects.toThrow('前次owner未正常退出'); expect(f.port.launch).toHaveBeenCalledTimes(1); expect(f.port.quit).not.toHaveBeenCalled(); expect(f.port.remove).not.toHaveBeenCalled();
  });
  it('旧owner不能操作第二实例，跨await失效也不能消费旧结果', async () => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first); await f.run.launch(); const action = vi.fn(async () => {}); await expect(f.run.step(first, action)).rejects.toThrow(); expect(action).not.toHaveBeenCalled(); expect(f.port.quit).toHaveBeenCalledTimes(1);
    const g = fixture(), owner = await g.run.launch(), pending = deferred<string>(), result = g.run.step(owner, () => pending.promise); g.run.retained = true; pending.resolve('旧结果'); await expect(result).rejects.toThrow(); expect(g.port.remove).not.toHaveBeenCalled();
  });
  it('SQLite读取期间拒绝并发重启，错误或目录清理不完整不会标记removed', async () => {
    const f = fixture(), owner = await f.run.launch(); await f.run.close(owner); const read = deferred<string>(), running = f.run.stopped(() => read.promise); await Promise.resolve(); await expect(f.run.launch()).rejects.toThrow(); read.resolve('旧读盘结果'); await expect(running).rejects.toThrow(); expect(f.port.launch).toHaveBeenCalledTimes(1);
    const g = fixture(), a = await g.run.launch(); await g.run.close(a); const b = await g.run.launch(); await g.run.close(b); vi.mocked(g.port.remove).mockRejectedValue(Error('目录仍存在')); await expect(g.run.finish()).rejects.toThrow('目录仍存在'); expect(g.run.removed).toBe(false); expect(g.run.retained).toBe(true); expect(g.port.remove).toHaveBeenCalledTimes(1);
  });
  it('原UI动作尚未返回时不能并发退出应用或把旧结果继续消费', async () => {
    const f = fixture(), owner = await f.run.launch(), action = deferred<string>(), pending = f.run.step(owner, () => action.promise);
    await expect(f.run.close(owner)).rejects.toThrow('正在处理所属资源'); expect(f.port.quit).not.toHaveBeenCalled(); action.resolve('迟到旧动作'); await expect(pending).rejects.toThrow(); expect(f.port.remove).not.toHaveBeenCalled();
  });
});
