import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';
import { tableFilteredUpdateConfirmation, type TableFilteredUpdateApplyInput, type TableFilteredUpdateApplyOutput, type TableFilteredUpdatePreviewInput, type TableFilteredUpdatePreviewOutput } from '../../src/shared/tableFilteredUpdate';

/** 原磁盘承诺用手工边界控制；不创建文件、数据库、桌面或替代清理任务。 */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** 使用真实私有文档能力，第二次capture是同文档的不同IPC，外来窗口也须经过真实捕获。 */
function fixture() {
  let revision = 1, locked = false, now = Date.parse('2026-10-29T00:00:00.000Z');
  const frame = { url: 'dbark:renderer', processId: 1, frameToken: 'main', detached: false };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  const window = { webContents: contents, isDestroyed: () => false };
  let currentWindow = window;
  const available = () => { if (locked) throw Error('保存锁'); };
  const capabilities = new ColumnsMainCapabilities(new Map(), { rendererURL: frame.url, currentWindow: () => currentWindow as any, connectionRevision: () => revision, assertAvailable: available, shuttingDown: () => false, release: async () => undefined });
  capabilities.trackWindow(window as any);
  const capture = () => capabilities.capture({ sender: contents, senderFrame: frame } as any), owner = capture();
  const assignments = [{ column: 'note', value: '完整精确文本' }, { column: 'payload', value: { type: 'binary' as const, base64: 'AP8=' } }];
  const input: TableFilteredUpdatePreviewInput = { connectionId: 'c', database: '库', table: '表', taskId: randomUUID(), metadataKey: '完整结构', filters: [], sort: [], assignments };
  const output = (): TableFilteredUpdatePreviewOutput => ({ previewToken: randomUUID(), target: { connectionId: 'c', database: '库', table: '表' }, columns: ['note', 'payload'], rows: 61, shownRows: 1, sql: 'UPDATE 整组完整样本;', sampleOmitted: true, expiresAt: new Date(now + 600000).toISOString(), definitionDigest: 'a'.repeat(64), assignmentDigest: createHash('sha256').update(JSON.stringify(assignments.map(item => [item.column, item.value]))).digest('hex'), timeZone: 'SYSTEM', warnings: [] });
  const run = vi.fn(async (_command: string, _input: unknown, _revision: number): Promise<unknown> => output());
  const release = vi.fn(async (_input: unknown): Promise<unknown> => undefined), stop = vi.fn(async (_taskId: string): Promise<unknown> => undefined);
  const owners = new TableFilteredUpdateOwners({ assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right), revision: () => revision, closing: () => false, available, run, release, stop }, () => now);
  const fresh = () => ({ ...input, taskId: randomUUID() });
  const request = (preview: TableFilteredUpdatePreviewOutput) => ({ connectionId: input.connectionId, previewToken: preview.previewToken });
  const apply = (preview: TableFilteredUpdatePreviewOutput): TableFilteredUpdateApplyInput => ({ ...request(preview), taskId: randomUUID(), confirmation: tableFilteredUpdateConfirmation(preview), acknowledged: true });
  const committed = (preview: TableFilteredUpdatePreviewOutput): TableFilteredUpdateApplyOutput => ({ target: preview.target, columns: ['note', 'payload'], rows: preview.rows, outcome: 'committed', commitAcknowledged: true });
  return {
    owners, owner, capture, input, fresh, output, run, release, request, apply, committed,
    invalidateScope() { revision++; now += 600001; locked = true; owners.observe(); },
    foreign() {
      const otherFrame = { ...frame, processId: 2, frameToken: 'foreign' }, otherContents = Object.assign(new EventEmitter(), { mainFrame: otherFrame, isDestroyed: () => false });
      currentWindow = { webContents: otherContents, isDestroyed: () => false }; capabilities.trackWindow(currentWindow as any);
      return capabilities.capture({ sender: otherContents, senderFrame: otherFrame } as any);
    },
    restore() { currentWindow = window; },
  };
}

describe('全部筛选行Main原释放失败的精确墓碑与显式重试', () => {
  it('预览drop失败保槽；同文档新IPC共享原pending，实际释放结束才恢复预算与drain', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), disk = deferred<unknown>();
    f.release.mockRejectedValueOnce(Error('原磁盘失败'));
    await expect(f.owners.release(f.request(preview), f.capture())).rejects.toThrow('原磁盘失败');
    f.owners.observe(); await expect(f.owners.drain()).rejects.toThrow('原磁盘失败'); expect(f.release).toHaveBeenCalledTimes(1);
    const second = await f.owners.preview(f.fresh(), f.capture());
    await expect(f.owners.preview(f.fresh(), f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(2);
    f.release.mockReturnValueOnce(disk.promise);
    let completed = false, drained = false;
    const first = f.owners.release(f.request(preview), f.capture()).then(() => { completed = true; });
    const concurrent = f.owners.release(f.request(preview), f.capture());
    const drain = f.owners.drain().then(() => { drained = true; });
    await Promise.resolve(); await Promise.resolve(); expect(f.release).toHaveBeenCalledTimes(2); expect(completed).toBe(false); expect(drained).toBe(false);
    await expect(f.owners.preview(f.fresh(), f.capture())).rejects.toThrow();
    disk.resolve(undefined); await Promise.all([first, concurrent, drain]); expect(completed).toBe(true); expect(drained).toBe(true);
    const third = await f.owners.preview(f.fresh(), f.capture()); expect(f.run).toHaveBeenCalledTimes(3);
    await f.owners.release(f.request(second), f.capture()); await f.owners.release(f.request(third), f.capture()); await expect(f.owners.drain()).resolves.toBeUndefined();
  });

  it('外来真实窗口和错误connection不能重试墓碑；原文档过期/修订/保存锁变化仍能精确回收', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner);
    f.release.mockRejectedValueOnce(Error('原失败')); await expect(f.owners.release(f.request(preview), f.owner)).rejects.toThrow('原失败');
    const foreign = f.foreign(); await expect(f.owners.release(f.request(preview), foreign)).rejects.toThrow(); f.restore();
    await expect(f.owners.release({ ...f.request(preview), connectionId: '其它连接' }, f.capture())).rejects.toThrow(); expect(f.release).toHaveBeenCalledTimes(1);
    f.invalidateScope(); await expect(f.owners.drain()).rejects.toThrow('原失败'); expect(f.release).toHaveBeenCalledTimes(1);
    await expect(f.owners.release(f.request(preview), f.capture())).resolves.toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(2); await expect(f.owners.drain()).resolves.toBeUndefined();
    await expect(f.owners.apply(f.apply(preview), f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('无效预览回执的queueRelease失败同样保原身份与预算，不允许重复token覆盖墓碑', async () => {
    const f = fixture(), invalid = { ...f.output(), columns: ['note'] };
    f.run.mockResolvedValueOnce(invalid); f.release.mockRejectedValueOnce(Error('无效回执的原清理失败'));
    await expect(f.owners.preview(f.input, f.owner)).rejects.toThrow('无效回执的原清理失败'); await expect(f.owners.drain()).rejects.toThrow('无效回执的原清理失败');
    f.run.mockResolvedValueOnce({ ...f.output(), previewToken: invalid.previewToken });
    await expect(f.owners.preview(f.fresh(), f.capture())).rejects.toThrow(); expect(f.release).toHaveBeenCalledTimes(1);
    const second = await f.owners.preview(f.fresh(), f.capture()); await expect(f.owners.preview(f.fresh(), f.capture())).rejects.toThrow();
    await f.owners.release(f.request(invalid), f.capture()); await expect(f.owners.drain()).resolves.toBeUndefined();
    await f.owners.release(f.request(second), f.capture()); expect(f.release).toHaveBeenNthCalledWith(2, f.request(invalid));
  });

  it('已消费apply的整组COMMIT ACK优先于cleanup失败，显式重试只回收且失败历史有界替换', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), input = f.apply(preview), expected = f.committed(preview);
    f.run.mockResolvedValueOnce(expected); f.release.mockRejectedValueOnce(Error('第一次清理失败'));
    await expect(f.owners.apply(input, f.capture())).resolves.toEqual(expected); await expect(f.owners.drain()).rejects.toThrow('第一次清理失败');
    await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(2);
    f.release.mockRejectedValueOnce(Error('第二次清理失败'));
    await expect(f.owners.release(f.request(preview), f.capture())).rejects.toThrow('第二次清理失败'); await expect(f.owners.drain()).rejects.toThrow('第二次清理失败');
    f.owners.observe(); expect(f.release).toHaveBeenCalledTimes(2);
    const disk = deferred<unknown>(); f.release.mockReturnValueOnce(disk.promise);
    const retry = f.owners.release(f.request(preview), f.capture()), duplicate = f.owners.release(f.request(preview), f.capture()); await Promise.resolve(); expect(f.release).toHaveBeenCalledTimes(3);
    disk.resolve(undefined); await Promise.all([retry, duplicate]); await expect(f.owners.drain()).resolves.toBeUndefined(); expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('未确认提交的apply及其清理均失败后，也只能显式回收原token而不能重发apply', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), input = f.apply(preview);
    f.run.mockRejectedValueOnce(Error('提交结果未知')); f.release.mockRejectedValueOnce(Error('未知任务的原清理失败'));
    await expect(f.owners.apply(input, f.capture())).rejects.toThrow('未知任务的原清理失败'); await expect(f.owners.drain()).rejects.toThrow('未知任务的原清理失败');
    await expect(f.owners.release(f.request(preview), f.capture())).resolves.toBeUndefined(); await expect(f.owners.drain()).resolves.toBeUndefined();
    await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('旧引擎失败墓碑和未dispatch的release不投向新broker，也不挡新引擎预算', async () => {
    const f = fixture(), first = await f.owners.preview(f.input, f.owner);
    f.release.mockRejectedValueOnce(Error('旧引擎清理失败')); await expect(f.owners.release(f.request(first), f.capture())).rejects.toThrow();
    f.owners.engineExited(); await expect(f.owners.release(f.request(first), f.capture())).resolves.toBeUndefined(); await expect(f.owners.drain()).resolves.toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(1);
    const second = await f.owners.preview(f.fresh(), f.capture()), queued = f.owners.release(f.request(second), f.capture()); f.owners.engineExited(); await queued; expect(f.release).toHaveBeenCalledTimes(1);
    const previews = await Promise.all([f.owners.preview(f.fresh(), f.capture()), f.owners.preview(f.fresh(), f.capture())]); expect(previews).toHaveLength(2); await expect(f.owners.drain()).resolves.toBeUndefined();
  });

  it('旧引擎在途preview的迟到token不进入新引擎释放或失败账本', async () => {
    const f = fixture(), read = deferred<unknown>(), output = f.output(); f.run.mockReturnValueOnce(read.promise);
    const pending = f.owners.preview(f.input, f.owner); f.owners.engineExited(); read.resolve(output);
    await expect(pending).rejects.toThrow(); expect(f.release).not.toHaveBeenCalled(); await expect(f.owners.drain()).resolves.toBeUndefined();
  });

  it('旧引擎apply的迟到完整ACK保持提交事实，但原finally不能向新broker发release', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), response = deferred<unknown>(), expected = f.committed(preview);
    f.run.mockReturnValueOnce(response.promise); const pending = f.owners.apply(f.apply(preview), f.capture()); f.owners.engineExited(); response.resolve(expected);
    await expect(pending).resolves.toEqual(expected); expect(f.release).not.toHaveBeenCalled(); await expect(f.owners.drain()).resolves.toBeUndefined();
  });
});
