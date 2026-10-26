import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableFilteredDeleteOwners } from '../../src/main/tableFilteredDeleteOwners';
import { mergeTableFilteredDeleteProgress } from '../../src/main/tableFilteredDeleteProgress';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { tableFilteredDeleteConfirmation, tableFilteredDeleteScopeIdentity } from '../../src/shared/tableFilteredDelete';
import type { TableFilteredDeletePreviewInput, TableFilteredDeletePreviewOutput, TableFilteredDeleteApplyInput, TableFilteredDeleteProgress } from '../../src/shared/tableFilteredDelete';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';

/** 只控制原物理边界的结算，不以超时、新请求或延迟回放代替原完成事实。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let revision = 7, closing = false, locked = false, now = Date.parse('2026-10-26T00:00:00.000Z');
  const frame = { url: 'dbark:renderer', processId: 1, frameToken: 'main', detached: false }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false };
  const available = () => { if (locked) throw Error('配置正在保存'); };
  const cap = new ColumnsMainCapabilities(new Map(), { rendererURL: frame.url, currentWindow: () => window as any, connectionRevision: () => revision, assertAvailable: available, shuttingDown: () => closing, release: async () => {} }); cap.trackWindow(window as any);
  const capture = () => cap.capture({ sender: contents, senderFrame: frame } as any), owner = capture();
  const input: TableFilteredDeletePreviewInput = { connectionId: 'c', database: '库', table: 'subject', taskId: randomUUID(), metadataKey: '原完整目录', filters: [{ column: 'note', operator: '=', value: '合成条件9007199254740993' }], sort: [{ column: 'id', direction: 'ASC' }] };
  const output = (patch: Partial<TableFilteredDeletePreviewOutput> = {}): TableFilteredDeletePreviewOutput => ({ operation: 'delete', previewToken: randomUUID(), target: { connectionId: 'c', database: input.database, table: input.table }, rows: 61, shownRows: 10, sql: 'DELETE FROM `库`.`subject` WHERE 原唯一键及全部旧值;', sampleOmitted: true, expiresAt: new Date(now + 600000).toISOString(), definitionDigest: 'a'.repeat(64), scopeDigest: createHash('sha256').update(tableFilteredDeleteScopeIdentity(input)).digest('hex'), timeZone: 'SYSTEM', warnings: [], ...patch });
  const run = vi.fn(async (_command: string, _input: unknown, _revision: number): Promise<unknown> => output()), release = vi.fn(async (_input: unknown): Promise<unknown> => undefined), stop = vi.fn(async (_taskId: string): Promise<unknown> => undefined);
  const owners = new TableFilteredDeleteOwners({ assert: value => cap.assertCapturedOwner(value), same: (left, right) => cap.sharesDocumentOwner(left, right), revision: () => revision, closing: () => closing, available, run, release, stop }, () => now);
  const apply = (preview: TableFilteredDeletePreviewOutput): TableFilteredDeleteApplyInput => ({ connectionId: input.connectionId, taskId: randomUUID(), previewToken: preview.previewToken, confirmation: tableFilteredDeleteConfirmation(preview), acknowledged: true });
  const committed = (preview: TableFilteredDeletePreviewOutput) => ({ operation: 'delete' as const, target: preview.target, rows: preview.rows, outcome: 'committed' as const, commitAcknowledged: true as const });
  return { owner, capture, owners, input, output, apply, committed, run, release, stop, contents, revise() { revision++; owners.observe(); }, disconnect() { owners.invalidateConnection('c'); }, lock() { locked = true; }, unlock() { locked = false; }, close() { closing = true; owners.observe(); }, expire() { now += 600001; }, clockInvalid() { now = NaN; }, navigate() { contents.emit('did-navigate'); owners.observe(); } };
}
const progress = (patch: Partial<TableFilteredDeleteProgress> = {}): TableFilteredDeleteProgress => ({ phase: 'preparing', rows: 0, totalRows: 61, snapshotBytes: 0, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent', ...patch });

describe('全部筛选行删除 Main 一次性能力', () => {
  it('三个独立命令拒绝任意SQL、凭据、路径、页数据和填充赋值', () => {
    const f = fixture();
    for (const command of ['table.filteredDelete.preview', 'table.filteredDelete.apply', 'table.filteredDelete.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('table.filteredDelete.preview', f.input)).toEqual(f.input);
    for (const extra of [{ sql: 'DELETE FROM other' }, { profile: {} }, { connectionRevision: 7 }, { path: '不得传递私有快照路径' }, { rows: [{ note: '不得传递页面原行' }] }, { column: 'note', value: '填充参数不属于删除' }]) expect(() => validateCommand('table.filteredDelete.preview', { ...f.input, ...extra })).toThrow();
    expect(() => validateCommand('table.filteredDelete.apply', { ...f.apply(f.output()), value: '不属于删除' })).toThrow();
    const getter = vi.fn(() => '不能执行'); expect(() => validateCommand('table.filteredDelete.preview', Object.defineProperty({ ...f.input }, 'metadataKey', { enumerable: true, get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('同文档的新IPC确认准确删除用途；重复应用只有一次发送', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); f.owners.assertPublication(preview, f.capture());
    const wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); const input = f.apply(preview), pending = f.owners.apply(input, f.capture());
    await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenLastCalledWith('table.filteredDelete.apply', input, 7);
    wait.resolve(f.committed(preview)); await expect(pending).resolves.toEqual(f.committed(preview)); expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'c', previewToken: preview.previewToken });
  });
  it.each(['revision', 'disconnect', 'expiry', 'navigation', 'closing', 'engine'] as const)('%s 单向撤销，不借恢复相同值复活原预览', async reason => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner);
    if (reason === 'revision') f.revise(); if (reason === 'disconnect') f.disconnect(); if (reason === 'expiry') f.expire(); if (reason === 'navigation') f.navigate(); if (reason === 'closing') f.close(); if (reason === 'engine') f.owners.engineExited();
    await expect(f.owners.apply(f.apply(preview), f.capture())).rejects.toThrow(); f.owners.observe(); await f.owners.drain(); expect(f.run).toHaveBeenCalledTimes(1);
    if (reason !== 'engine') expect(f.release).toHaveBeenCalledWith({ connectionId: 'c', previewToken: preview.previewToken });
  });
  it('错误确认不消费；空范围和伪造owner不能删除', async () => {
    const f = fixture(); await expect(f.owners.preview(f.input, { ...f.owner })).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled();
    const preview = await f.owners.preview(f.input, f.owner); await expect(f.owners.apply({ ...f.apply(preview), confirmation: '库.subject / note / 61' }, f.owner)).rejects.toThrow(); f.owners.assertPublication(preview, f.owner);
    await f.owners.release({ connectionId: 'c', previewToken: preview.previewToken }, f.owner); f.run.mockResolvedValueOnce(f.output({ rows: 0, shownRows: 0, sql: '', sampleOmitted: false })); const empty = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner); await expect(f.owners.apply(f.apply(empty), f.owner)).rejects.toThrow();
  });
  it.each([{ operation: 'update' }, { scopeDigest: 'b'.repeat(64) }, { sampleOmitted: false }, { shownRows: 62 }, { rows: 9 }, { target: { connectionId: 'c', database: '另一库', table: 'subject' } }, { rows: 0, shownRows: 0, sampleOmitted: false, sql: 'DELETE FROM other' }, { expiresAt: '2026-10-26T00:10:01.000Z' }])('畸形删除回执只释放本次返回的令牌：%j', async patch => {
    const f = fixture(), output = f.output(patch as Partial<TableFilteredDeletePreviewOutput>); f.run.mockResolvedValueOnce(output); await expect(f.owners.preview(f.input, f.owner)).rejects.toThrow(); expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'c', previewToken: output.previewToken });
  });
  it('回执getter不会执行，不能借畸形值释放别人的令牌', async () => {
    const f = fixture(), getter = vi.fn(() => randomUUID()), value = Object.defineProperty(f.output(), 'previewToken', { enumerable: true, get: getter }); f.run.mockResolvedValueOnce(value);
    await expect(f.owners.preview(f.input, f.owner)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  });
  it('完整条件树、停用项和多列排序参与scope摘要，不只绑定匹配数量', async () => {
    const f = fixture(), source = { ...f.input, filters: [...f.input.filters, { column: 'id', operator: '>=' as const, value: '9007199254740993', enabled: false }], sort: [{ column: 'note', direction: 'ASC' as const }, { column: 'id', direction: 'DESC' as const }] };
    f.run.mockResolvedValueOnce(f.output()); await expect(f.owners.preview(source, f.owner)).rejects.toThrow(); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('相同UUID但被改写的预览不能最终发布，原回执仍可正确使用', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner);
    for (const patch of [{ rows: 60 }, { scopeDigest: 'b'.repeat(64) }, { definitionDigest: 'c'.repeat(64) }, { sql: 'DELETE FROM `另一表`' }, { warnings: ['伪造提示'] }]) expect(() => f.owners.assertPublication({ ...preview, ...patch }, f.capture())).toThrow();
    f.owners.assertPublication(preview, f.capture()); await f.owners.release({ connectionId: 'c', previewToken: preview.previewToken }, f.capture());
  });
  it('两份在途先占预算，第三个不调用Engine；重复token不误释放原预览', async () => {
    const f = fixture(), waits = [deferred<unknown>(), deferred<unknown>()]; waits.forEach(wait => f.run.mockReturnValueOnce(wait.promise)); const pending = waits.map(() => f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner));
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); waits.forEach(wait => wait.resolve(f.output())); const previews = await Promise.all(pending);
    await f.owners.release({ connectionId: 'c', previewToken: previews[1].previewToken }, f.owner); f.release.mockClear(); f.run.mockResolvedValueOnce(previews[0]); await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow(); expect(f.release).not.toHaveBeenCalled(); f.owners.assertPublication(previews[0], f.owner);
  });
  it('未知令牌及填充的未登记token不能调用删除Engine', async () => {
    const f = fixture(), token = randomUUID(); await expect(f.owners.apply({ connectionId: 'c', taskId: randomUUID(), previewToken: token, confirmation: '库.subject / 删除 / 61', acknowledged: true }, f.owner)).rejects.toThrow();
    await f.owners.release({ connectionId: 'c', previewToken: token }, f.owner); expect(f.run).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  });
  it('准确连接和原文档限制release/cancel，另一文档不能取消原删除', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); await expect(f.owners.release({ connectionId: 'other', previewToken: preview.previewToken }, f.capture())).rejects.toThrow(); f.owners.assertPublication(preview, f.owner);
    const wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); const input = f.apply(preview), pending = f.owners.apply(input, f.owner); await expect(f.owners.cancel(input.taskId, { ...f.owner })).rejects.toThrow(); expect(f.stop).not.toHaveBeenCalled();
    wait.resolve(f.committed(preview)); await pending;
  });
  it('取消ACK及原DB返回仍不够，等待原磁盘release结算才结束', async () => {
    const f = fixture(), database = deferred<unknown>(), disk = deferred<unknown>(), releasing = deferred<void>(); f.run.mockReturnValueOnce(database.promise); f.release.mockImplementationOnce(async () => { releasing.resolve(); await disk.promise; });
    const pending = f.owners.preview(f.input, f.owner).catch(error => error); let cancelled = false; const cancel = f.owners.cancel(f.input.taskId, f.capture()).then(() => { cancelled = true; });
    await Promise.resolve(); expect(cancelled).toBe(false); database.resolve(f.output()); await releasing.promise; expect(cancelled).toBe(false); expect(f.owners.has(f.input.taskId)).toBe(true);
    disk.resolve(undefined); await pending; await cancel; expect(cancelled).toBe(true); expect(f.stop).toHaveBeenCalledTimes(1); expect(f.owners.has(f.input.taskId)).toBe(false);
  });
  it('drain也等待正在执行的原请求及清理，不仅等待取消回执', async () => {
    const f = fixture(), wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); const pending = f.owners.preview(f.input, f.owner).catch(error => error); f.close(); let drained = false; const drain = f.owners.drain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false); wait.resolve(f.output()); await pending; await drain; expect(drained).toBe(true); expect(f.owners.has(f.input.taskId)).toBe(false); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('发布前来源失效必须清理；失败apply消费后不复活，不重试', async () => {
    const f = fixture(), original = await f.owners.preview(f.input, f.owner); f.navigate(); expect(() => f.owners.assertPublication(original, f.owner)).toThrow(); await f.owners.rejectPublication(original, f.owner); await f.owners.drain();
    const fresh = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.capture()), input = f.apply(fresh); f.run.mockRejectedValueOnce(Error('原删除结果未知')); await expect(f.owners.apply(input, f.capture())).rejects.toThrow(); await expect(f.owners.apply({ ...input, taskId: randomUUID() }, f.capture())).rejects.toThrow(); expect(f.run).toHaveBeenCalledTimes(3);
  });
  it('真实COMMIT优先于晚导航和清理失败；失败释放在drain中仍报告', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); f.release.mockRejectedValueOnce(Error('原磁盘清理失败')); const pending = f.owners.apply(f.apply(preview), f.owner); f.navigate();
    wait.resolve(f.committed(preview)); await expect(pending).resolves.toEqual(f.committed(preview)); await expect(f.owners.drain()).rejects.toThrow('原磁盘清理失败');
  });
  it('配置保存临时准入锁不取消原事务，但新请求与最终发布仍拒绝', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner), wait = deferred<unknown>(); f.run.mockReturnValueOnce(wait.promise); const pending = f.owners.apply(f.apply(preview), f.owner); f.lock(); f.owners.observe(); expect(f.stop).not.toHaveBeenCalled();
    await expect(f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner)).rejects.toThrow('配置正在保存'); f.unlock(); wait.resolve(f.committed(preview)); await pending;
    const next = await f.owners.preview({ ...f.input, taskId: randomUUID() }, f.owner); f.lock(); expect(() => f.owners.assertPublication(next, f.owner)).toThrow('配置正在保存'); await expect(f.owners.apply(f.apply(next), f.owner)).rejects.toThrow('配置正在保存');
    f.unlock(); f.owners.assertPublication(next, f.owner); expect(f.stop).not.toHaveBeenCalled();
  });
  it('非有限时钟不能绕过TTL，真实空夹具不授予新用途', async () => {
    const f = fixture(), preview = await f.owners.preview(f.input, f.owner); f.clockInvalid(); await expect(f.owners.apply(f.apply(preview), f.owner)).rejects.toThrow();
    const empty = emptyTableFilteredDeleteOwners(); expect(empty.has(randomUUID())).toBe(false); await expect(empty.preview(f.input, f.owner)).rejects.toThrow('未授权');
  });
  it('ACK单向累积与用途脱敏概要不泄露筛选、SQL、路径或驱动回显', () => {
    const committed = progress({ phase: 'finished', rows: 61, snapshotBytes: 4096, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' });
    expect(mergeTableFilteredDeleteProgress(committed, progress())).toMatchObject({ rows: 61, totalRows: 61, snapshotBytes: 4096, commitAcknowledged: true, outcome: 'committed' });
    expect(mergeTableFilteredDeleteProgress(progress({ outcome: 'unknown' }), progress()).outcome).toBe('unknown'); expect(mergeTableFilteredDeleteProgress(undefined, progress({ rollbackAcknowledged: true, transactionProtected: true })).outcome).toBe('rolled-back');
    expect(mergeTableFilteredDeleteProgress(progress({ commitMayHaveBeenSent: true, outcome: 'unknown' }), progress({ rollbackAcknowledged: true, transactionProtected: true })).outcome).toBe('unknown');
    for (const command of ['table.filteredDelete.preview', 'table.filteredDelete.apply']) for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) expect(persistedTaskMessage(command, { taskId: 'x', status, progress: 0, message: '合成条件9007199254740993 /private/删除快照.sql' })).not.toMatch(/9007199254740993|private|删除快照\.sql/);
  });
});

describe('实际 Main 删除 IPC 与任务概要注册', () => {
  it('实际分派先保存脱敏概要，再按可信修订解密并注入原profile', async () => {
    const main = mainColumnsHarness(), f = fixture(), expected = f.output({ expiresAt: new Date(Date.now() + 600000).toISOString() }), secret = { id: 'c', password: '只在RAM中解密' }, saved = vi.fn(), resolve = vi.fn(() => secret);
    main.context.store = { saveTask: saved, connectionRevision: () => 7, resolveConnection: resolve }; main.request.mockImplementation(async command => command === 'table.filteredDelete.preview' ? expected : undefined);
    expect(await main.run('table.filteredDelete.preview', f.input)).toEqual(expected); expect(resolve).toHaveBeenCalledExactlyOnceWith('c'); expect(main.request).toHaveBeenCalledExactlyOnceWith('table.filteredDelete.preview', { ...f.input, profile: secret, connectionRevision: 7 });
    expect(JSON.stringify(saved.mock.calls)).not.toContain(String(f.input.filters[0].value)); expect(JSON.stringify(saved.mock.calls)).not.toContain(secret.password); expect(main.tasks.get(f.input.taskId)?.status).toBe('completed');
    await main.run('table.filteredDelete.release', { connectionId: 'c', previewToken: expected.previewToken });
    expect(main.request).toHaveBeenLastCalledWith('table.filteredDelete.release', { connectionId: 'c', previewToken: expected.previewToken });
    expect(main.request.mock.calls.some(([command]) => command === 'table.filteredUpdate.release')).toBe(false);
  });
  it('概要保存失败、无效参数或伪框架不能解密或触达Engine', async () => {
    const main = mainColumnsHarness(), f = fixture(), resolve = vi.fn(() => { throw Error('不应解密'); }); main.context.store = { saveTask: vi.fn(() => { throw Error('本地概要失败'); }), connectionRevision: () => 7, resolveConnection: resolve };
    await expect(main.run('table.filteredDelete.preview', f.input)).rejects.toThrow('本地概要失败'); expect(resolve).not.toHaveBeenCalled(); expect(main.request).not.toHaveBeenCalled();
    const child = main.event(); child.senderFrame = { ...child.senderFrame }; expect((await main.invoke('table.filteredDelete.preview', f.input, child)).ok).toBe(false); expect((await main.invoke('table.filteredDelete.preview', { ...f.input, sql: '未授权' })).ok).toBe(false); expect(resolve).not.toHaveBeenCalled(); expect(main.request).not.toHaveBeenCalled();
  });
});
