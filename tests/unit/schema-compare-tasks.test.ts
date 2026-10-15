import { describe, expect, it, vi } from 'vitest';
import { SchemaCompareTasks } from '../../src/engine/schemaCompareTasks';
import type { TaskEvent } from '../../src/shared/contracts';
import { comparisonSnapshot as snapshot } from './schema-compare-fixtures';

const source = snapshot('`id` int, `a` int', 'source'), target = snapshot('`id` int', 'target');
const input = { taskId: 'compare', source: source.target, target: target.target };
function harness() {
  let now = Date.now(); const events: TaskEvent[] = [];
  const host = { read: vi.fn(async (value: typeof source.target, _taskId: string) => value.table === 'source' ? source : target), cancel: vi.fn(async (_id: string) => undefined) };
  const tasks = new SchemaCompareTasks(host, event => events.push(event), () => now);
  return { tasks, host, events, advance: (ms: number) => { now += ms; } };
}
describe('跨连接比较任务与快照生命周期', () => {
  it('串行读取、公共进度与内部任务分离，预览只用可信快照', async () => {
    const h = harness(); const report = await h.tasks.compare(input, 7);
    expect(h.host.read.mock.calls.map(([value]) => value.table)).toEqual(['source', 'target']);
    expect(h.host.read.mock.calls[0][1]).not.toBe(input.taskId);
    expect(h.events.map(event => event.status)).toEqual(['running', 'running', 'completed']);
    expect(h.events.every(event => event.taskId === input.taskId)).toBe(true);
    expect(h.tasks.preview({ snapshotId: report.snapshotId, selections: [{ category: 'columns', name: 'a' }] }, 7).statements).toHaveLength(1);
  });
  it('取消等待实际释放，晚到成功不缓存，也不启动目标读取', async () => {
    const h = harness(); let done!: () => void, release!: () => void;
    h.host.read.mockImplementationOnce(async () => { await new Promise<void>(resolve => { done = resolve; }); return source; });
    h.host.cancel.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); done(); });
    const work = h.tasks.compare(input, 1); const rejected = expect(work).rejects.toThrow('已取消');
    const cancel = h.tasks.cancel(input.taskId); let ended = false; void cancel.then(() => { ended = true; });
    await Promise.resolve(); expect(ended).toBe(false); expect(h.tasks.has(input.taskId)).toBe(true);
    release(); await cancel; await rejected;
    expect(h.host.read).toHaveBeenCalledTimes(1); expect(h.events.at(-1)?.status).toBe('cancelled'); expect(h.tasks.has(input.taskId)).toBe(false);
  });
  it('取消控制失败保持失败状态，不能谎报服务器已取消', async () => {
    const h = harness(); let fail!: (error: Error) => void;
    h.host.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    h.host.cancel.mockImplementationOnce(async () => { fail(new Error('读取中断')); throw new Error('取消控制失败'); });
    const work = h.tasks.compare(input, 1); const failed = expect(work).rejects.toThrow();
    await expect(h.tasks.cancel(input.taskId)).rejects.toThrow('取消控制失败'); await failed;
    expect(h.events.at(-1)?.status).toBe('failed');
  });
  it('读取失败不返回部分比较；快照过期、配置修订或断连必须重新比较', async () => {
    const h = harness(); h.host.read.mockRejectedValueOnce(new Error('权限不足'));
    await expect(h.tasks.compare(input, 1)).rejects.toThrow('权限不足'); expect(h.host.read).toHaveBeenCalledTimes(1);
    const report = await h.tasks.compare(input, 1), request = { snapshotId: report.snapshotId, selections: [{ category: 'columns' as const, name: 'a' }] };
    expect(() => h.tasks.preview(request, 2)).toThrow('配置已变化');
    h.advance(120001); expect(() => h.tasks.preview(request, 1)).toThrow('已过期');
    const newer = await h.tasks.compare(input, 1); await h.tasks.close(target.target.connectionId);
    expect(() => h.tasks.preview({ ...request, snapshotId: newer.snapshotId }, 1)).toThrow('已过期');
  });
  it('快照数量和同时活动任务都有上限，释放后可继续比较', async () => {
    const h = harness(); const reports = [];
    for (let i = 0; i < 8; i++) reports.push(await h.tasks.compare({ ...input, taskId: String(i) }, 1));
    await expect(h.tasks.compare(input, 1)).rejects.toThrow('快照已达上限'); h.tasks.release(reports[0].snapshotId);
    await h.tasks.compare(input, 1);
    await h.tasks.close(); const gates: (() => void)[] = [];
    h.host.read.mockImplementation(async value => { await new Promise<void>(resolve => gates.push(resolve)); return value.table === 'source' ? source : target; });
    const first = h.tasks.compare({ ...input, taskId: '1' }, 1), second = h.tasks.compare({ ...input, taskId: '2' }, 1);
    await expect(h.tasks.compare({ ...input, taskId: '3' }, 1)).rejects.toThrow('繁忙');
    gates.splice(0).forEach(resolve => resolve()); await vi.waitFor(() => expect(gates).toHaveLength(2)); gates.splice(0).forEach(resolve => resolve()); await Promise.all([first, second]);
  });
});
