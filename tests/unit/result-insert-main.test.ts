import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { ResultInsertOwners } from '../../src/main/resultInsertOwners';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { ResultInsertPreviewInput, ResultInsertPreviewOutput, ResultInsertApplyInput } from '../../src/shared/resultInsert';

/** 控制原Promise而非定时器，分别证明取消ACK与原任务终态。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let revision = 7, closing = false, locked = false, now = Date.parse('2026-10-24T00:00:00.000Z');
  const frame = { url: 'dbark:renderer', processId: 1, frameToken: 'main', detached: false };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  const window = { webContents: contents, isDestroyed: () => false };
  const available = () => { if (locked) throw Error('配置正在保存'); };
  const capabilities = new ColumnsMainCapabilities(new Map(), { rendererURL: frame.url, currentWindow: () => window as any, connectionRevision: () => revision, assertAvailable: available, shuttingDown: () => closing, release: async () => {} }); capabilities.trackWindow(window as any);
  const capture = () => capabilities.capture({ sender: contents, senderFrame: frame } as any), owner = capture();
  const input: ResultInsertPreviewInput = { connectionId: 'target', database: '库', table: '已有表', taskId: randomUUID(), data: { columns: [{ key: 'k', name: '金额' }], rows: [{ k: '9007199254740993.00000001' }], truncated: false }, mapping: [{ source: 'k', target: '金额' }], timeZone: '+00:00' };
  const output = (patch: Partial<ResultInsertPreviewOutput> = {}): ResultInsertPreviewOutput => ({ previewToken: randomUUID(), target: { connectionId: input.connectionId, database: input.database, table: input.table }, rows: 1, mapping: input.mapping, shownRows: 1, sql: 'INSERT INTO `库`.`已有表` (`金额`) VALUES (9007199254740993.00000001)', expiresAt: new Date(now + 120000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: false, timeZone: '+00:00', warnings: [], ...patch });
  const run = vi.fn(async (_command: string, _input: unknown, _revision: number): Promise<unknown> => output()), release = vi.fn(async (_input: unknown): Promise<unknown> => undefined), stop = vi.fn(async (_taskId: string): Promise<unknown> => undefined);
  const owners = new ResultInsertOwners({ assert: value => capabilities.assertCapturedOwner(value), same: (left, right) => capabilities.sharesDocumentOwner(left, right), revision: () => revision, closing: () => closing, available, run, release, stop }, () => now);
  const apply = (preview: ResultInsertPreviewOutput): ResultInsertApplyInput => ({ connectionId: 'target', taskId: randomUUID(), previewToken: preview.previewToken, confirmation: '库.已有表', acknowledged: true });
  return { owners, owner, capture, input, output, apply, run, release, stop, contents,
    revise() { revision++; owners.observe(); }, disconnect() { owners.invalidateConnection('target'); }, lock() { locked = true; },
    closing() { closing = true; owners.observe(); }, advance(ms: number) { now += ms; }, navigate() { contents.emit('did-navigate'); owners.observe(); },
  };
}

describe('结果写入Main能力与原任务归属', () => {
  it('三命令均在preload白名单；不能注入SQL、配置、修订、路径或apply数据', () => {
    const f = fixture();
    expect(publicCommands['result.insertPreview']).toBe(true); expect(publicCommands['result.insertApply']).toBe(true); expect(publicCommands['result.insertRelease']).toBe(true);
    expect(validateCommand('result.insertPreview', f.input)).toEqual(f.input);
    for (const patch of [{ sql: 'DROP TABLE t' }, { profile: {} }, { connectionRevision: 7 }, { filePath: 'x' }, { data: { ...f.input.data, rows: [] } }, { taskId: 'reused' }]) expect(() => validateCommand('result.insertPreview', { ...f.input, ...patch })).toThrow();
    const value = f.apply(f.output()); expect(() => validateCommand('result.insertApply', { ...value, data: f.input.data })).toThrow();
    expect(() => validateCommand('result.insertApply', { ...value, acknowledged: false })).toThrow();
  });
  it('getter源未调用，映射目标重复、非法时区及孤立Unicode均被拒', () => {
    const f = fixture(), getter = vi.fn(() => 'secret'); const row = {}; Object.defineProperty(row, 'k', { get: getter, enumerable: true });
    expect(() => validateCommand('result.insertPreview', { ...f.input, data: { ...f.input.data, rows: [row] } })).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const patch of [{ mapping: [{ source: 'k', target: '金额' }, { source: 'other', target: '金额' }] }, { timeZone: '+14:01' }, { table: '\ud800' }]) expect(() => validateCommand('result.insertPreview', { ...f.input, ...patch })).toThrow();
  });
  it('同文档新IPC能够消费；准确目标与可信修订透传，双击只能一次', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); f.owners.assertPublication(preview, f.capture());
    const wait = deferred<unknown>(); f.run.mockImplementationOnce(() => wait.promise);
    const request = f.apply(preview), pending = f.owners.apply(request, f.capture());
    await expect(f.owners.apply({ ...request, taskId: randomUUID() }, f.capture())).rejects.toThrow();
    expect(f.run).toHaveBeenLastCalledWith('result.insertApply', request, 7);
    wait.resolve({ target: preview.target, rows: 1, outcome: 'committed', commitAcknowledged: true });
    await expect(pending).resolves.toMatchObject({ outcome: 'committed' });
    expect(f.release).toHaveBeenCalledWith({ connectionId: 'target', previewToken: preview.previewToken });
  });
  it.each(['revision', 'disconnect', 'expiry', 'navigation', 'closing'] as const)('%s使原token失效且不能复活', async reason => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner);
    if (reason === 'revision') f.revise(); if (reason === 'disconnect') f.disconnect(); if (reason === 'expiry') f.advance(120000); if (reason === 'navigation') f.navigate(); if (reason === 'closing') f.closing();
    await expect(f.owners.apply(f.apply(preview), reason === 'navigation' ? f.capture() : f.owner)).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(1);
    await f.owners.drain();
    expect(f.release).toHaveBeenCalledWith({ connectionId: 'target', previewToken: preview.previewToken });
  });
  it('伪造同形状来源不是实际IPC；确认文字错误不会消费原token', async () => {
    const f = fixture(); await expect(f.owners.preview(f.input, { ...f.owner })).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled();
    const preview = await f.owners.preview(f.input, f.owner);
    await expect(f.owners.apply({ ...f.apply(preview), confirmation: '库.另一表' }, f.owner)).rejects.toThrow();
    f.owners.assertPublication(preview, f.owner);
  });
  it.each([{ rows: 2 }, { timeZone: '+01:00' }, { mapping: [{ source: 'k', target: '别列' }] }, { shownRows: 2 }, { sourceTruncated: true }, { target: { connectionId: 'target', database: '其它库', table: '已有表' } }])('引擎输出不属于原输入则回收精确token %j', async patch => {
    const f = fixture(), bad = f.output(patch); f.run.mockResolvedValueOnce(bad);
    await expect(f.owners.preview(f.input, f.owner)).rejects.toThrow(); expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'target', previewToken: bad.previewToken });
  });
  it('迟到旧预览只释放自己的token，不清同一文档的新token', async () => {
    const f = fixture(), wait = deferred<unknown>(); f.run.mockImplementationOnce(() => wait.promise);
    const original = f.owners.preview(f.input, f.owner), late = f.output(); f.revise();
    const fresh = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.capture());
    wait.resolve(late); await expect(original).rejects.toThrow();
    f.owners.assertPublication(fresh, f.capture()); expect(f.release).toHaveBeenCalledWith({ connectionId: 'target', previewToken: late.previewToken }); expect(f.release).not.toHaveBeenCalledWith({ connectionId: 'target', previewToken: fresh.previewToken });
  });
  it('响应返回到最终IPC发布间导航，仍可回收旧私有调用token', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); f.contents.emit('did-navigate');
    expect(() => f.owners.assertPublication(preview, f.owner)).toThrow(); await f.owners.rejectPublication(preview, f.owner);
    expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'target', previewToken: preview.previewToken });
  });
  it('取消ACK不等于原任务终态；取消一次且等待原Promise', async () => {
    const f = fixture(), wait = deferred<unknown>(); f.run.mockImplementationOnce(() => wait.promise);
    const pending = f.owners.preview(f.input, f.owner); const outcome = pending.catch(error => error);
    let cancelled = false; const cancel = f.owners.cancel(f.input.taskId, f.capture()).then(() => { cancelled = true; });
    await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(false); expect(f.stop).toHaveBeenCalledTimes(1);
    wait.resolve(f.output()); await outcome; await cancel; expect(cancelled).toBe(true); expect(f.owners.has(f.input.taskId)).toBe(false);
  });
  it('已知提交不被晚导航、取消或release失败改写为未写入', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), wait = deferred<unknown>(); f.run.mockImplementationOnce(() => wait.promise);
    const pending = f.owners.apply(f.apply(preview), f.owner); f.navigate(); f.release.mockRejectedValueOnce(Error('原release失败'));
    wait.resolve({ target: preview.target, rows: 1, outcome: 'committed', commitAcknowledged: true });
    await expect(pending).resolves.toMatchObject({ commitAcknowledged: true }); await expect(f.owners.drain()).rejects.toThrow('原release失败');
  });
  it('失败应用也一次消费，不自动重试或复活原预览', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), input = f.apply(preview); f.run.mockRejectedValueOnce(Error('提交响应丢失'));
    await expect(f.owners.apply(input, f.owner)).rejects.toThrow('提交响应丢失');
    await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(2);
  });
  it('8个在途预览先占预算，第9个在网络前拒绝', async () => {
    const f = fixture(), waits = Array.from({ length: 8 }, () => deferred<unknown>()); waits.forEach(wait => f.run.mockImplementationOnce(() => wait.promise));
    const pending = waits.map(() => f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner));
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(8);
    waits.forEach(wait => wait.resolve(f.output())); const results = await Promise.all(pending); for (const value of results) await f.owners.release({ connectionId: 'target', previewToken: value.previewToken }, f.owner);
  });
  it('重复引擎token不能回收其它已交付能力', async () => {
    const f = fixture(), first = await f.owners.preview(f.input, f.owner); f.run.mockResolvedValueOnce(first);
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow();
    expect(f.release).not.toHaveBeenCalled(); f.owners.assertPublication(first, f.owner);
  });
  it('持久化概要不保留值、映射SQL或驱动错误原文', () => {
    for (const status of ['running', 'failed', 'cancelled', 'completed'] as const) for (const command of ['result.insertPreview', 'result.insertApply']) {
      const value = persistedTaskMessage(command, { taskId: 'x', status, progress: 0, message: '私密字段9007199254740993' }); expect(value).not.toContain('9007199254740993'); expect(value).not.toContain('私密字段');
    }
  });
});
