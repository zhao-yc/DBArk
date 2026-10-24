import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';
import { mergeTableFilteredUpdateProgress } from '../../src/main/tableFilteredUpdateProgress';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { tableFilteredUpdateConfirmation } from '../../src/shared/tableFilteredUpdate';
import type { TableFilteredUpdatePreviewInput, TableFilteredUpdatePreviewOutput, TableFilteredUpdateApplyInput, TableFilteredUpdateProgress } from '../../src/shared/tableFilteredUpdate';
import { mainColumnsHarness } from './main-columns-owner-harness';

/** 精确控制原异步边界，不用定时器或新Promise追认原数据库/磁盘任务。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let revision = 7, closing = false, locked = false, now = Date.parse('2026-10-24T00:00:00.000Z');
  const frame = { url: 'dbark:renderer', processId: 1, frameToken: 'main', detached: false }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false };
  const available = () => { if (locked) throw Error('配置正在保存'); };
  const cap = new ColumnsMainCapabilities(new Map(), { rendererURL: frame.url, currentWindow: () => window as any, connectionRevision: () => revision, assertAvailable: available, shuttingDown: () => closing, release: async () => {} }); cap.trackWindow(window as any);
  const capture = () => cap.capture({ sender: contents, senderFrame: frame } as any), owner = capture();
  const input: TableFilteredUpdatePreviewInput = { connectionId: 'c', database: '库', table: 'subject', taskId: randomUUID(), metadataKey: '原完整目录', filters: [], sort: [{ column: 'id', direction: 'ASC' }], column: 'note', value: '合成私密赋值9007199254740993' };
  const output = (patch: Partial<TableFilteredUpdatePreviewOutput> = {}): TableFilteredUpdatePreviewOutput => ({ previewToken: randomUUID(), target: { connectionId: 'c', database: input.database, table: input.table }, column: input.column, rows: 61, shownRows: 10, sql: 'UPDATE `库`.`subject` SET `note` = ? WHERE 原唯一键及完整旧值;', sampleOmitted: true, expiresAt: new Date(now + 600000).toISOString(), definitionDigest: 'a'.repeat(64), assignmentDigest: createHash('sha256').update(JSON.stringify([input.column, input.value])).digest('hex'), timeZone: 'SYSTEM', warnings: [], ...patch });
  const run = vi.fn(async (_command: string, _input: unknown, _revision: number): Promise<unknown> => output()), release = vi.fn(async (_input: unknown): Promise<unknown> => undefined), stop = vi.fn(async (_taskId: string): Promise<unknown> => undefined);
  const owners = new TableFilteredUpdateOwners({ assert: value => cap.assertCapturedOwner(value), same: (left, right) => cap.sharesDocumentOwner(left, right), revision: () => revision, closing: () => closing, available, run, release, stop }, () => now);
  const apply = (preview: TableFilteredUpdatePreviewOutput): TableFilteredUpdateApplyInput => ({ connectionId: input.connectionId, taskId: randomUUID(), previewToken: preview.previewToken, confirmation: tableFilteredUpdateConfirmation(preview), acknowledged: true });
  return { owner, capture, owners, input, output, apply, run, release, stop, contents, revise() { revision++; owners.observe(); }, disconnect() { owners.invalidateConnection('c'); }, lock() { locked = true; }, unlock() { locked = false; }, close() { closing = true; owners.observe(); }, expire() { now += 600001; }, navigate() { contents.emit('did-navigate'); owners.observe(); } };
}
const progress = (patch: Partial<TableFilteredUpdateProgress> = {}): TableFilteredUpdateProgress => ({ phase: 'preparing', rows: 0, totalRows: 61, snapshotBytes: 0, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent', ...patch });

describe('全部筛选行填充Main一次性能力', () => {
  it('三命令公开但参数不能夹带SQL/凭据/路径/快照或apply值', () => {
    const f = fixture();
    for (const command of ['table.filteredUpdate.preview', 'table.filteredUpdate.apply', 'table.filteredUpdate.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('table.filteredUpdate.preview', f.input)).toEqual(f.input);
    for (const extra of [{ sql: 'UPDATE other' }, { profile: {} }, { connectionRevision: 7 }, { path: '本用途不能读路径' }, { rows: [{ note: '不得夹带原行' }] }]) expect(() => validateCommand('table.filteredUpdate.preview', { ...f.input, ...extra })).toThrow();
    expect(() => validateCommand('table.filteredUpdate.apply', { ...f.apply(f.output()), value: '不同赋值' })).toThrow();
    const getter = vi.fn(() => '未授权'); expect(() => validateCommand('table.filteredUpdate.preview', Object.defineProperty({ ...f.input }, 'value', { enumerable: true, get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('同文档新IPC消费准确对象/字段/全部行数；重复应用只有一次数据库发送', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); f.owners.assertPublication(preview, f.capture());
    const wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); const input = f.apply(preview), pending = f.owners.apply(input, f.capture());
    await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow();
    expect(f.run).toHaveBeenLastCalledWith('table.filteredUpdate.apply', input, 7);
    wait.resolve({ target: preview.target, column: preview.column, rows: 61, outcome: 'committed', commitAcknowledged: true }); await expect(pending).resolves.toMatchObject({ commitAcknowledged: true });
    expect(f.release).toHaveBeenCalledWith({ connectionId: 'c', previewToken: preview.previewToken });
  });
  it.each(['revision', 'disconnect', 'expiry', 'navigation', 'closing'] as const)('%s撤销原能力，恢复原值不能复活', async reason => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner);
    if (reason === 'revision') f.revise(); if (reason === 'disconnect') f.disconnect(); if (reason === 'expiry') f.expire(); if (reason === 'navigation') f.navigate(); if (reason === 'closing') f.close();
    await expect(f.owners.apply(f.apply(preview), f.capture())).rejects.toThrow(); f.owners.observe(); await f.owners.drain(); expect(f.release).toHaveBeenCalledWith({ connectionId: 'c', previewToken: preview.previewToken }); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('错误确认不消费、空范围不能应用；伪造私有owner不打开引擎', async () => {
    const f = fixture(); await expect(f.owners.preview(f.input, { ...f.owner })).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled();
    const preview = await f.owners.preview(f.input, f.owner); await expect(f.owners.apply({ ...f.apply(preview), confirmation: '库.subject / note / 60' }, f.owner)).rejects.toThrow(); f.owners.assertPublication(preview, f.owner);
    await f.owners.release({ connectionId: 'c', previewToken: preview.previewToken }, f.owner); f.run.mockResolvedValueOnce(f.output({ rows: 0, shownRows: 0, sampleOmitted: false })); const empty = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner); await expect(f.owners.apply(f.apply(empty), f.owner)).rejects.toThrow();
  });
  it.each([{ column: 'other' }, { assignmentDigest: 'b'.repeat(64) }, { sampleOmitted: false }, { shownRows: 62 }, { rows: 9 }, { target: { connectionId: 'c', database: '另一库', table: 'subject' } }])('错误回执精确释放自己的token：%j', async patch => {
    const f = fixture(), output = f.output(patch); f.run.mockResolvedValueOnce(output); await expect(f.owners.preview(f.input, f.owner)).rejects.toThrow(); expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'c', previewToken: output.previewToken });
  });
  it('两个在途先占全局预算，第三个不调用引擎；重复token不能释放另一预览', async () => {
    const f = fixture(), waits = [deferred<unknown>(), deferred<unknown>()]; waits.forEach(wait => f.run.mockReturnValueOnce(wait.promise)); const pending = waits.map(() => f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner));
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); waits.forEach(wait => wait.resolve(f.output())); const previews = await Promise.all(pending);
    await f.owners.release({ connectionId: 'c', previewToken: previews[1].previewToken }, f.owner); f.release.mockClear(); f.run.mockResolvedValueOnce(previews[0]); await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); expect(f.release).not.toHaveBeenCalled(); f.owners.assertPublication(previews[0], f.owner);
  });
  it('取消ACK及原运行返回仍不足，必须等待原磁盘release结算', async () => {
    const f = fixture(), database = deferred<unknown>(), disk = deferred<unknown>(); f.run.mockReturnValueOnce(database.promise); f.release.mockReturnValueOnce(disk.promise);
    const pending = f.owners.preview(f.input, f.owner).catch(error => error); let cancelled = false; const cancel = f.owners.cancel(f.input.taskId, f.capture()).then(() => { cancelled = true; });
    await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(false); database.resolve(f.output()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(false); expect(f.owners.has(f.input.taskId)).toBe(true);
    disk.resolve(undefined); await pending; await cancel; expect(cancelled).toBe(true); expect(f.stop).toHaveBeenCalledTimes(1); expect(f.owners.has(f.input.taskId)).toBe(false);
  });
  it('IPC最终发布间失效释放原快照；失败apply不复活、不自动重试', async () => {
    const f = fixture(), original = await f.owners.preview(f.input, f.owner); f.navigate(); expect(() => f.owners.assertPublication(original, f.owner)).toThrow(); await f.owners.rejectPublication(original, f.owner); await f.owners.drain();
    const fresh = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.capture()), input = f.apply(fresh); f.run.mockRejectedValueOnce(Error('原提交回应未知')); await expect(f.owners.apply(input, f.capture())).rejects.toThrow(); await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(3);
  });
  it('真实提交优先于晚导航/清理失败，drain仍保留原清理失败', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); f.release.mockRejectedValueOnce(Error('原磁盘清理失败')); const pending = f.owners.apply(f.apply(preview), f.owner); f.navigate();
    wait.resolve({ target: preview.target, column: preview.column, rows: 61, outcome: 'committed', commitAcknowledged: true }); await expect(pending).resolves.toMatchObject({ commitAcknowledged: true }); await expect(f.owners.drain()).rejects.toThrow('原磁盘清理失败');
  });
  it('临时配置准入锁及原进度不取消现有写入；新请求仍拒绝且原token不被消费', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise);
    const pending = f.owners.apply(f.apply(preview), f.owner); f.lock(); f.owners.observe(); f.owners.observe(); expect(f.stop).not.toHaveBeenCalled();
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow('配置正在保存'); expect(f.run).toHaveBeenCalledTimes(2);
    f.unlock(); wait.resolve({ target: preview.target, column: preview.column, rows: 61, outcome: 'committed', commitAcknowledged: true }); await expect(pending).resolves.toMatchObject({ commitAcknowledged: true }); expect(f.stop).not.toHaveBeenCalled();
    const next = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner); f.lock(); await expect(f.owners.apply(f.apply(next), f.owner)).rejects.toThrow('配置正在保存'); f.unlock(); f.owners.assertPublication(next, f.owner);
  });
  it('ACK单向累积与脱敏任务概要不泄露赋值、SQL、路径或驱动回显', () => {
    const committed = progress({ phase: 'finished', rows: 61, snapshotBytes: 4096, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' });
    expect(mergeTableFilteredUpdateProgress(committed, progress())).toMatchObject({ rows: 61, totalRows: 61, snapshotBytes: 4096, commitAcknowledged: true, outcome: 'committed' });
    expect(mergeTableFilteredUpdateProgress(progress({ outcome: 'unknown' }), progress()).outcome).toBe('unknown'); expect(mergeTableFilteredUpdateProgress(undefined, progress({ rollbackAcknowledged: true, transactionProtected: true })).outcome).toBe('rolled-back');
    for (const command of ['table.filteredUpdate.preview', 'table.filteredUpdate.apply']) for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) expect(persistedTaskMessage(command, { taskId: 'x', status, progress: 0, message: '合成私密赋值9007199254740993 /private/快照.sql' })).not.toMatch(/9007199254740993|private|快照\.sql/);
  });
});

describe('实际Main IPC及任务注册', () => {
  it('实际生产分派按可信连接修订注入profile，原条件/值不进入持久任务概要', async () => {
    const main = mainColumnsHarness(), f = fixture(), expected = f.output({ expiresAt: new Date(Date.now() + 600000).toISOString() }), secret = { id: 'c', password: '只在RAM中解密' }, saved = vi.fn(), resolve = vi.fn(() => secret);
    main.context.store = { saveTask: saved, connectionRevision: () => 7, resolveConnection: resolve };
    main.request.mockImplementation(async command => command === 'table.filteredUpdate.preview' ? expected : undefined);
    expect(await main.run('table.filteredUpdate.preview', f.input)).toEqual(expected); expect(resolve).toHaveBeenCalledExactlyOnceWith('c'); expect(main.request).toHaveBeenCalledExactlyOnceWith('table.filteredUpdate.preview', { ...f.input, profile: secret, connectionRevision: 7 });
    expect(JSON.stringify(saved.mock.calls)).not.toContain(String(f.input.value)); expect(JSON.stringify(saved.mock.calls)).not.toContain(secret.password); expect(main.tasks.get(f.input.taskId)?.status).toBe('completed');
    await main.run('table.filteredUpdate.release', { connectionId: 'c', previewToken: expected.previewToken });
  });
  it('概要保存失败、无效参数或伪框架不能解密或触达引擎', async () => {
    const main = mainColumnsHarness(), f = fixture(), resolve = vi.fn(() => { throw Error('不应解密'); }); main.context.store = { saveTask: vi.fn(() => { throw Error('本地概要失败'); }), connectionRevision: () => 7, resolveConnection: resolve };
    await expect(main.run('table.filteredUpdate.preview', f.input)).rejects.toThrow('本地概要失败'); expect(resolve).not.toHaveBeenCalled(); expect(main.request).not.toHaveBeenCalled();
    const child = main.event(); child.senderFrame = { ...child.senderFrame }; expect((await main.invoke('table.filteredUpdate.preview', f.input, child)).ok).toBe(false); expect((await main.invoke('table.filteredUpdate.preview', { ...f.input, sql: '未授权' })).ok).toBe(false); expect(resolve).not.toHaveBeenCalled(); expect(main.request).not.toHaveBeenCalled();
  });
});
