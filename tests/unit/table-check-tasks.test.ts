import { describe, expect, it, vi } from 'vitest';
import type { StructureTaskContext, StructureTaskHost, StructureTaskOptions } from '../../src/engine/structureDefinition';
import type { TableCheckRead } from '../../src/engine/tableCheckRead';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCheckDefinition } from '../../src/engine/tableCheckDefinition';
import { TableCheckTasks } from '../../src/engine/tableCheckTasks';
import { tableCheckMessages as text, type TableCheckApplyInput, type TableCheckPreviewOutput } from '../../src/shared/tableChecks';

const port = vi.hoisted(() => ({ queue: [] as unknown[], ddl: [] as string[], failure: undefined as Error | undefined, warning: 0, afterRead: undefined as (() => void) | undefined }));
vi.mock('../../src/engine/tableCheckRead', async original => ({ ...await original<typeof import('../../src/engine/tableCheckRead')>(), readTableChecks: vi.fn(async () => { if (!port.queue.length) throw Error('缺少独立fresh读取夹具'); const value = await port.queue.shift(); port.afterRead?.(); if (value instanceof Error) throw value; return value; }) }));
vi.mock('../../src/engine/structureDefinition', async original => ({ ...await original<typeof import('../../src/engine/structureDefinition')>(), structureTaskQuery: vi.fn(async (_context, sql: string, submitted?: () => void) => { if (sql.startsWith('ALTER TABLE')) { submitted?.(); port.ddl.push(sql); if (port.failure) throw port.failure; return { rows: { affectedRows: 0, warningStatus: port.warning } }; } if (sql === 'SHOW WARNINGS LIMIT 20') return { rows: [{ Code: 999, Message: '合成服务器警告' }] }; throw Error('意外结构SQL'); }) }));
const target = { connectionId: 'c', database: 'fixture', table: 'subject' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
/** 用独立SHOW构造前后快照；真实定义/变更planner/后核验和缓存任务均不替换。 */
function read(hasCheck = true, expression = '(`id` > 0)', enforced = true): TableCheckRead {
  const context = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
  const source = 'CREATE TABLE `subject` (`id` int NOT NULL' + (hasCheck ? ', CONSTRAINT `positive` CHECK (' + expression + ')' + (enforced ? '' : ' /*!80016 NOT ENFORCED */') : '') + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
  const definition = parseTableColumnDefinition(source, context), checkDefinition = readTableCheckDefinition(definition, '8.4.1'), checks: TableCheckRead['checks'] = new Map();
  if (hasCheck) { const checkRef = 'engine-ref', access = () => ({ allowed: true, reasons: [] }); checks.set(checkRef, { parsed: checkDefinition.checks[0], view: { checkRef, name: 'positive', expression, location: 'table', enforced, reasons: [], access: { drop: access(), replace: access(), enforcement: access() } } }); }
  return { source, context, originalMode: '', normalizedMode: '', identity: 'server', serverVersion: '8.4.1', nullability: [['id', false]], encodings: [{ name: 'id', charset: null, collation: null }], tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, definition, checkDefinition, checks, constraintNames: hasCheck ? ['positive'] : [], coverage: 'complete', writable: true, allowsNotEnforced: true, reasons: [], warnings: [], tableId: '101', catalogFingerprint: hasCheck ? 'before' : 'after', engine: 'InnoDB', rowFormat: 'Dynamic', autoIncrement: null, bytes: 4096 };
}
function harness() {
  port.queue = []; port.ddl = []; port.failure = undefined; port.warning = 0; port.afterRead = undefined;
  const state = { now: 100000, close: undefined as ReturnType<typeof deferred<void>> | undefined, closedError: undefined as Error | undefined, actionDone: deferred<void>(), actionResult: undefined as unknown, cancelled: false, calls: [] as { connectionId: string; taskId: string; options: StructureTaskOptions }[], events: [] as Record<string, unknown>[] };
  const host: StructureTaskHost = { async run<T>(connectionId: string, taskId: string, action: (context: StructureTaskContext) => Promise<T>, options: StructureTaskOptions): Promise<T> {
    state.calls.push({ connectionId, taskId, options });
    const context: StructureTaskContext = { managed: {} as StructureTaskContext['managed'], checkCancelled() { if (state.cancelled) throw Error('合成原取消'); }, commandStarted() { return () => {}; }, report() { state.events.push({ ...options.progress }); } };
    const result = await action(context); state.actionResult = result; state.actionDone.resolve(); if (state.close) await state.close.promise; if (state.closedError) throw state.closedError; return result;
  } };
  const tasks = new TableCheckTasks(host, () => state.now);
  const get = async () => { port.queue.push(read()); return tasks.get({ ...target, taskId: 'get' }, 1); };
  const preview = async (snapshotId: string) => { port.queue.push(read()); return tasks.preview({ snapshotId, change: { op: 'drop', checkRef: 'engine-ref' }, taskId: 'preview' }, 1); };
  const input = (preview: TableCheckPreviewOutput): TableCheckApplyInput => ({ previewToken: preview.previewToken, databaseConfirmation: target.database, tableConfirmation: target.table, acknowledgements: [...preview.requiredAcknowledgements], taskId: 'apply' });
  return { state, tasks, get, preview, input };
}

describe('CHECK任务真实缓存和一次性提交生命周期（无数据库）', () => {
  it('get/preview无DDL且输出不暴露私有验证依据，返回view不能改写Engine权限', async () => {
    const f = harness(), get = await f.get(); expect(get.coverage).toBe('complete'); expect(get.checks).toHaveLength(1); get.checks[0].access.drop.allowed = false;
    const preview = await f.preview(get.snapshotId); expect(preview.sql).toContain('DROP CHECK `positive`'); expect(preview).not.toHaveProperty('verification'); expect(preview).not.toHaveProperty('source'); expect(port.ddl).toEqual([]); expect(port.queue).toEqual([]);
  });

  it('一次确认执行一条ALTER，完整后核验且host严格收尾后才授resourcesReleased', async () => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId); port.queue.push(read(), read(false)); f.state.close = deferred<void>(); f.state.actionDone = deferred<void>();
    let settled = false; const operation = f.tasks.apply(f.input(preview), 1).then(value => { settled = true; return value; }); await f.state.actionDone.promise;
    expect(settled).toBe(false); expect(f.state.actionResult).not.toHaveProperty('resourcesReleased'); expect(port.ddl).toEqual([preview.sql]);
    f.state.close.resolve(); const result = await operation; expect(result).toMatchObject({ target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(port.queue).toEqual([]); expect(f.state.calls.at(-1)?.options.executionTarget).toEqual(target);
    await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.stale); expect(port.ddl).toHaveLength(1);
  });

  it('坏二段确认消费父和所有兄弟预览，必须fresh get才能再次修改', async () => {
    const f = harness(), get = await f.get(), first = await f.preview(get.snapshotId), sibling = await f.preview(get.snapshotId);
    await expect(f.tasks.apply({ ...f.input(first), tableConfirmation: 'different' }, 1)).rejects.toThrow(text.confirmation);
    await expect(f.tasks.apply(f.input(sibling), 1)).rejects.toThrow(text.stale);
    await expect(f.tasks.preview({ snapshotId: get.snapshotId, change: { op: 'drop', checkRef: 'engine-ref' }, taskId: 'old-parent' }, 1)).rejects.toThrow(text.stale); expect(port.ddl).toEqual([]);
  });

  it.each(['add', 'replace', 'enforcement'] as const)('%s也走真实planner/单次ALTER及完整后核验，非仅删除入口', async op => {
    const f = harness(), before = read(op !== 'add'); port.queue.push(before); const get = await f.tasks.get({ ...target, taskId: 'get' }, 1);
    const change = op === 'add' ? { op, name: 'positive', expression: '(`id` > 0)', enforced: true } : op === 'replace' ? { op, checkRef: 'engine-ref', name: 'positive', expression: '(`id` >= 0)', enforced: true } : { op, checkRef: 'engine-ref', enforced: false };
    port.queue.push(before); const preview = await f.tasks.preview({ snapshotId: get.snapshotId, change, taskId: 'preview' }, 1);
    port.queue.push(before, op === 'replace' ? read(true, '(`id` >= 0)') : op === 'enforcement' ? read(true, '(`id` > 0)', false) : read());
    const result = await f.tasks.apply(f.input(preview), 1); expect(result.definitionVerified).toBe(true); expect(port.ddl).toEqual([preview.sql]); expect(port.queue).toEqual([]);
  });

  it('get资源关闭未确认就不发布任何可继续预览的快照', async () => {
    const f = harness(); f.state.closedError = Error(text.cleanup); await expect(f.get()).rejects.toThrow(text.cleanup); expect(port.ddl).toEqual([]);
  });

  it('preview fresh读取晚回且父已释放时不发布孤儿令牌或执行DDL', async () => {
    const f = harness(), get = await f.get(), pending = deferred<TableCheckRead>(); port.queue.push(pending.promise);
    const operation = f.tasks.preview({ snapshotId: get.snapshotId, change: { op: 'drop', checkRef: 'engine-ref' }, taskId: 'late-preview' }, 1);
    f.tasks.releaseTokens({ snapshotId: get.snapshotId }); pending.resolve(read()); await expect(operation).rejects.toThrow(text.stale); expect(port.ddl).toEqual([]);
  });

  it('同步消费使在途apply重复请求不能并行发送第二条DDL', async () => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId), pending = deferred<TableCheckRead>(); port.queue.push(pending.promise, read(false));
    const operation = f.tasks.apply(f.input(preview), 1); await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.stale); expect(port.ddl).toEqual([]); pending.resolve(read()); expect((await operation).definitionVerified).toBe(true); expect(port.ddl).toHaveLength(1);
  });

  it.each(['revision', 'physical', 'expired', 'cancelled'] as const)('%s在DDL前拒绝且旧预览不再复活', async kind => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId); const fresh = read();
    if (kind === 'physical') fresh.tableId = '202'; if (kind === 'expired') port.afterRead = () => { f.state.now += 120001; }; if (kind === 'cancelled') f.state.cancelled = true;
    port.queue.push(fresh); await expect(f.tasks.apply(f.input(preview), kind === 'revision' ? 2 : 1)).rejects.toThrow(); expect(port.ddl).toEqual([]); await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.stale);
  });

  it('已投递但没有ACK只保留unknown进度，不能重试原preview', async () => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId); port.queue.push(read()); port.failure = Error('连接在DDL响应前断开');
    await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow('响应前断开'); expect(f.state.events.some(event => event.ddlSubmitted === true && event.ddlCompleted === false && event.outcome === 'unknown')).toBe(true); await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.stale); expect(port.ddl).toHaveLength(1);
  });

  it.each(['read', 'otherStructure', 'warning'] as const)('DDL收到OK但%s未证明时返回完成/未核验，绝不误报成功保真', async kind => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId); const after = read(false); if (kind === 'otherStructure') after.rowFormat = 'Compact'; if (kind === 'warning') port.warning = 1; port.queue.push(read(), kind === 'read' ? Error('后读失败') : after);
    const result = await f.tasks.apply(f.input(preview), 1); expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, resourcesReleased: true, verificationError: text.verify }); expect(port.ddl).toHaveLength(1);
  });

  it('已OK但strict资源关闭失败仍reject，不提前授resourcesReleased也不重放', async () => {
    const f = harness(), get = await f.get(), preview = await f.preview(get.snapshotId); port.queue.push(read(), read(false)); f.state.closedError = Error(text.cleanup);
    await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.cleanup); expect(f.state.actionResult).not.toHaveProperty('resourcesReleased'); expect(f.state.events.some(event => event.ddlCompleted === true)).toBe(true); await expect(f.tasks.apply(f.input(preview), 1)).rejects.toThrow(text.stale); expect(port.ddl).toHaveLength(1);
  });
});
