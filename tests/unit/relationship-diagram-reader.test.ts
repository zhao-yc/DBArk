import { describe, expect, it, vi } from 'vitest';
import { RelationshipDiagramReader } from '../../src/renderer/relationshipDiagramReader';
import { relationshipFixture } from '../helpers/relationshipDiagramFixture';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const tables = relationshipFixture(), services = { objects: vi.fn(async () => tables.map(table => ({ name: table.name, kind: 'table' as const }))), table: vi.fn(async (target: { table: string; taskId: string }) => tables.find(table => table.name === target.table)!), cancel: vi.fn(async (_id: string) => {}) }, guard = vi.fn(() => true), reader = new RelationshipDiagramReader({ connectionId: 'c', database: 'diagram_db' }, services, guard);
  return { tables, services, guard, reader };
}
describe('关系图串行元数据读取', () => {
  it('构造零请求；目录不读表，明确选择才按准确范围顺序读取，任务编号逐个独立', async () => {
    const f = fixture(); expect(f.services.objects).not.toHaveBeenCalled(); expect(f.services.table).not.toHaveBeenCalled();
    expect(await f.reader.catalog()).toEqual(['child', 'parent', 'unlinked']); expect(f.services.table).not.toHaveBeenCalled();
    const progress = vi.fn(), graph = await f.reader.read(['child', 'parent'], progress);
    expect(graph.tables.map(table => table.name)).toEqual(['child', 'parent']); expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(f.services.table.mock.calls.map(([target]) => target.table)).toEqual(['child', 'parent']); const requests = f.services.table.mock.calls.map(([target]) => target);
    expect(requests.every(target => 'connectionId' in target && target.connectionId === 'c' && 'database' in target && target.database === 'diagram_db')).toBe(true); expect(new Set(requests.map(target => target.taskId)).size).toBe(2); expect(f.services.cancel).not.toHaveBeenCalled(); expect(f.reader.busy).toBe(false);
  });
  it('不能并行或半途替换选择，目录停止仍等待原请求终态', async () => {
    const f = fixture(), wait = deferred<Awaited<ReturnType<typeof f.services.objects>>>(); f.services.objects.mockImplementationOnce(() => wait.promise);
    const reading = f.reader.catalog(); await Promise.resolve(); expect(f.reader.busy).toBe(true); await expect(f.reader.catalog()).rejects.toThrow();
    const stopping = f.reader.stop(); let stopped = false; void stopping.then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false); expect(f.services.cancel).not.toHaveBeenCalled();
    wait.resolve([]); await expect(reading).rejects.toThrow('停止'); await stopping; expect(f.reader.busy).toBe(false);
  });
  it('停止仅取消准确当前任务一次，原读取完成后仍等待取消ACK，不继续下一张表', async () => {
    const f = fixture(), table = deferred<typeof f.tables[0]>(), ack = deferred<void>(); f.services.table.mockImplementationOnce(() => table.promise); f.services.cancel.mockImplementationOnce(() => ack.promise);
    const reading = f.reader.read(['child', 'parent'], vi.fn()); await Promise.resolve(); await Promise.resolve(); const id = f.services.table.mock.calls[0][0].taskId;
    const stop1 = f.reader.stop(), stop2 = f.reader.stop(); await Promise.resolve(); expect(f.services.cancel.mock.calls).toEqual([[id]]);
    table.resolve(f.tables[0]); await Promise.resolve(); await Promise.resolve(); expect(f.reader.busy).toBe(true); ack.resolve();
    await expect(reading).rejects.toThrow('停止'); await Promise.all([stop1, stop2]); expect(f.services.table).toHaveBeenCalledTimes(1); expect(f.reader.busy).toBe(false);
  });
  it('权限失败、目标错配和取消失败均不产生可发布的部分关系图', async () => {
    const f = fixture(); f.services.table.mockResolvedValueOnce(f.tables[0]).mockRejectedValueOnce(Error('无父表目录权限')); await expect(f.reader.read(['child', 'parent'], vi.fn())).rejects.toThrow('目录权限');
    f.services.table.mockResolvedValueOnce(f.tables[1]); await expect(f.reader.read(['child'], vi.fn())).rejects.toThrow('结构');
    const table = deferred<typeof f.tables[0]>(); f.services.table.mockImplementationOnce(() => table.promise); f.services.cancel.mockRejectedValueOnce(Error('取消失败'));
    const reading = f.reader.read(['child'], vi.fn()); await Promise.resolve(); const stopping = f.reader.stop(); table.resolve(f.tables[0]); await expect(reading).rejects.toThrow('停止'); await expect(stopping).rejects.toThrow('取消失败'); expect(f.reader.busy).toBe(false);
  });
  it('作用域ABA、同步重入、原选择改写均不能重定向旧读取', async () => {
    const f = fixture(), wait = deferred<typeof f.tables[0]>(); f.services.table.mockImplementationOnce(() => wait.promise);
    const names = ['child', 'parent'], reading = f.reader.read(names, vi.fn()); names[1] = 'unlinked'; await Promise.resolve(); f.guard.mockReturnValue(false); expect(f.reader.current()).toBe(false); f.guard.mockReturnValue(true); wait.resolve(f.tables[0]); await expect(reading).rejects.toThrow('已变化'); await expect(f.reader.catalog()).rejects.toThrow('已变化');
    const another = fixture(); let nested: Promise<string[]> | undefined; another.guard.mockImplementationOnce(() => { nested = another.reader.catalog(); return true; }); await another.reader.catalog(); await expect(nested).rejects.toThrow('上一轮'); expect(another.services.objects).toHaveBeenCalledTimes(1);
  });
  it('空选择、重复表及超量选择不发请求，目录不接受重复或超量表名', async () => {
    const f = fixture(); for (const names of [[], ['child', 'child'], Array.from({ length: 41 }, (_, i) => 't' + i)]) await expect(f.reader.read(names, vi.fn())).rejects.toThrow(); expect(f.services.table).not.toHaveBeenCalled();
    f.services.objects.mockResolvedValueOnce([{ name: 'x', kind: 'table' }, { name: 'x', kind: 'table' }]); await expect(f.reader.catalog()).rejects.toThrow();
  });
});
