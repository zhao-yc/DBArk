import { describe, expect, it, vi } from 'vitest';
import { ExcelPreviewTasks } from '../../src/renderer/excelPreviewTasks';

/** 分别控制实际任务和取消 RPC 的终态，避免把取消 ACK 当作资源释放。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
function fixture() { let id = 0; const cancellations = new Map<string, ReturnType<typeof deferred<void>>>(); const cancel = vi.fn((taskId: string) => { const work = deferred<void>(); cancellations.set(taskId, work); return work.promise; }); const reads = new ExcelPreviewTasks(cancel, () => `读取-${++id}`); return { reads, cancel, cancellations }; }

describe('Excel 文件与目标元数据成对收尾', () => {
  it('两个请求持有不同编号，双方均完成才能发布', async () => {
    const f = fixture(), file = deferred<string>(), metadata = deferred<number>(), ids: string[] = [];
    const running = f.reads.pair(id => { ids.push(id); return file.promise; }, id => { ids.push(id); return metadata.promise; }); await flush();
    expect(ids).toEqual(['读取-1', '读取-2']); file.resolve('预览'); await flush(); expect(f.reads.busy).toBe(true);
    metadata.resolve(3); await expect(running).resolves.toEqual(['预览', 3]); expect(f.reads.busy).toBe(false); expect(f.cancel).not.toHaveBeenCalled();
  });
  it.each(['file', 'metadata'])('%s 失败取消另一方并等待实际任务及取消 RPC', async side => {
    const f = fixture(), file = deferred<string>(), metadata = deferred<number>();
    const running = f.reads.pair(() => file.promise, () => metadata.promise); const rejected = expect(running).rejects.toThrow('原始失败'); await flush();
    (side === 'file' ? file : metadata).reject(Error('原始失败')); await flush();
    const other = side === 'file' ? '读取-2' : '读取-1'; expect(f.cancel).toHaveBeenCalledExactlyOnceWith(other);
    f.cancellations.get(other)!.resolve(); await flush(); expect(f.reads.busy).toBe(true);
    (side === 'file' ? metadata : file).reject(Error('另一方取消')); await rejected; expect(f.reads.busy).toBe(false);
  });
  it('用户取消、关闭和上下文切换都取消双方，替代批次等待全部收尾', async () => {
    const f = fixture(), file = deferred<string>(), metadata = deferred<number>();
    const running = f.reads.pair(() => file.promise, () => metadata.promise); const rejected = expect(running).rejects.toThrow('已取消'); await flush();
    const cancelling = f.reads.cancel(); const next = vi.fn(async () => '新上下文'); const replacement = f.reads.single(next); await flush();
    expect(f.cancel.mock.calls.map(call => call[0])).toEqual(['读取-1', '读取-2']); expect(next).not.toHaveBeenCalled();
    file.resolve('迟到文件'); metadata.resolve(9); await flush(); expect(next).not.toHaveBeenCalled();
    f.cancellations.forEach(work => work.resolve()); await cancelling; await rejected; await expect(replacement).resolves.toBe('新上下文');
  });
  it('取消 RPC 拒绝也观察实际任务结束，原任务不会被宣称已释放', async () => {
    const f = fixture(), file = deferred<string>(); const running = f.reads.single(() => file.promise); const rejected = expect(running).rejects.toThrow('取消失败'); await flush();
    const stopping = f.reads.dispose(); const stopRejected = expect(stopping).rejects.toThrow('取消失败'); await flush();
    f.cancellations.get('读取-1')!.reject(Error('取消失败')); await flush(); expect(f.reads.busy).toBe(true);
    file.resolve('真实收尾'); await rejected; await stopRejected; expect(f.reads.busy).toBe(false);
  });
  it('提交前关闭不发无主取消，清单也保留真实收尾等待', async () => {
    const f = fixture(), operation = vi.fn(async () => '不会提交'); const running = f.reads.single(operation); const rejected = expect(running).rejects.toThrow('已取消'); await f.reads.dispose(); await rejected;
    expect(operation).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  });
});
