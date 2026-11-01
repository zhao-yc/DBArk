import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableMaintenanceMain } from '../../src/main/sqliteTableMaintenanceMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { buildSqliteTableMaintenancePlan, getSqliteTableMaintenanceAcknowledgements, type SqliteTableMaintenanceAction, type SqliteTableMaintenanceFact, type SqliteTableMaintenanceInspectOutput, type SqliteTableMaintenancePreviewOutput, type SqliteTableMaintenanceOutcome } from '../../src/shared/sqliteTableMaintenance';
import { sqliteTableMaintenanceFactMessage } from '../../src/shared/sqliteTableMaintenanceFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const copy = <T,>(value: T): T => structuredClone(value);
/** Main纯协议端口验证；事务ACK由合成端口回调注入，不冒称真实数据库提交。 */
function fixture(readOnly = false, action: SqliteTableMaintenanceAction = 'clear', resetSequence = false, autoIncrement = true) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/PRIVATE_MAINTENANCE_FILE.sqlite', readOnly, busyTimeoutMs: 0 } };
  const target = { connectionId: profile.id, database: 'main' as const, table: '对象"🚢' }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const catalogue = (): SqliteTableMaintenanceInspectOutput => ({ catalogueId: 'catalogue-' + ++next, target, columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }, { cid: 1, name: 'note', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }], tableSql: 'CREATE TABLE "对象""🚢"(id INTEGER,note TEXT)', relatedObjects: [], strict: false, withoutRowid: false, foreignKeys: [], autoIncrement, rowCount: '3', readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.tableMaintenance.inspect') { input.assertCurrent(); return catalogue(); }
    if (command === 'sqlite.tableMaintenance.preview') { input.assertCurrent(); return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, action: input.action, resetSequence: input.resetSequence, ...buildSqliteTableMaintenancePlan(target, input.action, input.resetSequence), rowCount: '3', confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.tableMaintenance.apply') return acknowledged(input);
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, copy(task)); });
  const main = new SqliteTableMaintenanceMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(copy(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteTableMaintenance ? sqliteTableMaintenanceFactMessage(task.sqliteTableMaintenance) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, copy(next)); } },
  });
  /** 注入准确原operationId的协议事实；实际磁盘/utility证据由backend和native专项提供。 */
  function acknowledged(input: any): SqliteTableMaintenanceOutcome {
    input.assertCurrent(); let fact: SqliteTableMaintenanceFact = { operationId: input.operationId, target, action, phase: 'not-sent', requestedStatements: resetSequence ? 2 : 1, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing', actualBeforeRows: '3' }, { phase: 'writing', completedStatements: resetSequence ? 2 : 1 }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteTableMaintenanceFact>[]) { fact = { ...fact, ...patch }; input.recordMaintenanceFact(fact); }
    return { operationId: input.operationId, target, action, resetSequence, outcome: 'committed', fact, definitionVerified: true, message: '准确协议提交确认' };
  }
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.tableMaintenance.inspect', { ...target, taskId }) as Promise<SqliteTableMaintenanceInspectOutput>;
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableMaintenance.preview', { catalogueId, action, resetSequence, taskId }) as Promise<SqliteTableMaintenancePreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table, acknowledgements = getSqliteTableMaintenanceAcknowledgements(action, resetSequence)) => main.request(owner, 'sqlite.tableMaintenance.apply', { previewId, taskId, confirmation, acknowledgements }) as Promise<SqliteTableMaintenanceOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, action, resetSequence, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('目录/SQL只交原文档，路径/表维护默认值与SQL不进入持久任务', async () => {
  const f = fixture(), catalogue = await f.inspect(); f.main.assertPublication(f.owner, catalogue, 'sqlite.tableMaintenance.inspect'); const preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.tableMaintenance.preview'); const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(1); expect(result.fact.commitAcknowledged).toBe(true);
  const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_MAINTENANCE', 'filePath', 'DEFAULT', 'defaultSql', 'ALTER TABLE']) expect(bytes).not.toContain(marker); expect(f.saved.get('apply-task')?.sqliteTableMaintenance).toEqual(result.fact);
});
it.each(['filePath', 'profile', 'assertCurrent', 'operationId', 'recordMaintenanceFact'])('公开输入拒绝私有能力%s，零runtime投递', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.tableMaintenance.inspect', { ...f.target, taskId: 'bad', [key]: '不允许' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代拒迟到回包并释放准确能力', async stage => {
  const f = fixture(), catalogue = await f.inspect(), output = stage === 'inspect' ? catalogue : await f.preview(catalogue.catalogueId); f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.tableMaintenance.' + stage)).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableMaintenance.release' && input[stage === 'inspect' ? 'catalogueId' : 'previewId'] === ('catalogueId' in output && stage === 'inspect' ? output.catalogueId : (output as SqliteTableMaintenancePreviewOutput).previewId))).toBe(true);
});
it.each(['rotate', 'revise', 'disconnect'] as const)('原来源%s后即使名称相同也不能重领目录预览', async change => {
  const f = fixture(), catalogue = await f.inspect(); f[change](); f.main.observe(); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableMaintenance.preview')).toBe(false);
});
it('另一文档不能预览/释放原目录；释放双编号必须整组核归属', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.tableMaintenance.release', { catalogueId: catalogue.catalogueId })).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.tableMaintenance.preview', { catalogueId: catalogue.catalogueId, action: f.action, resetSequence: f.resetSequence, taskId: 'foreign' })).rejects.toThrow(); expect((await f.preview(catalogue.catalogueId)).target).toEqual(f.target);
});
it.each([false, true])('错误确认/只读在投递前阻止维护语句且单次消费预览（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.其它表'); expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableMaintenance.apply')).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('runtime预览SQL替换为另一维护语句即拒绝并释放，不能用回包扩大表维护权限', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableMaintenance.preview' ? { ...output, sql: ['DROP TABLE main.control'] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableMaintenance.release' && input.previewId)).toBe(true);
});
it('目录自然到期只阻新领取，不撤已签新预览或已领取长writer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(); vi.setSystemTime(Date.now() + 299999); const preview = await f.preview(catalogue.catalogueId); vi.setSystemTime(Date.now() + 2); f.main.observe(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableMaintenance.apply') vi.setSystemTime(Date.now() + 300001); return original(command, input); }); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('目录跨TTL后明确释放仍撤在途preview，晚回不能重签提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; vi.setSystemTime(Date.now() + 299999); let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableMaintenance.preview' ? gate : original(command, input)); const pending = f.preview(catalogue.catalogueId), rejected = expect(pending).rejects.toThrow(); const output = await original('sqlite.tableMaintenance.preview', { catalogueId: catalogue.catalogueId, action: f.action, resetSequence: f.resetSequence, assertCurrent() {} }); vi.setSystemTime(Date.now() + 2); f.main.observe(); await f.main.request(f.owner, 'sqlite.tableMaintenance.release', { catalogueId: catalogue.catalogueId }); resolve(output); await rejected; await expect(f.apply(output.previewId)).rejects.toThrow();
});
it('已claim writer不因目录释放假取消，原guard保持且无ACK只能记未知', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; let reject!: (reason: unknown) => void, sent: any; const gate = new Promise<never>((_, no) => { reject = no; });
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableMaintenance.apply') { sent = input; return gate; } return original(command, input); }); const pending = f.apply(preview.previewId); await f.main.request(f.owner, 'sqlite.tableMaintenance.release', { catalogueId: preview.catalogueId }); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toBe(false); reject(Error('没有提交ACK')); expect((await pending).outcome).toBe('unknown');
});
it('未知结果撤目录和兄弟预览，不把未确认回包视为成功或重放', async () => {
  const f = fixture(), one = await f.ready(), two = await f.preview(one.catalogueId, 'second-preview'), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableMaintenance.apply') throw Error('传输中断'); return original(command, input); }); expect((await f.apply(one.previewId)).outcome).toBe('unknown'); await expect(f.apply(two.previewId, 'no-replay')).rejects.toThrow(); await expect(f.preview(one.catalogueId, 'no-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableMaintenance.apply')).toHaveLength(1);
});
it('取消ACK不能提前释放Main占用，退出等待准确原请求settle', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; }); f.request.mockImplementation(async (command, input) => command === 'sqlite.tableMaintenance.inspect' ? gate : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'inspect-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true); resolve(f.catalogue()); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});
it('首份任务持久化失败时零读取/维护语句，不留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('写盘拒绝'); }); await expect(f.inspect()).rejects.toThrow('写盘拒绝'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('Main取消快照区分维护语句已确认、提交中和未知，不按旧running状态放行', async () => {
  const f = fixture(), preview = await f.ready(), outcome = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  for (const [phase, expected] of [['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished']] as const) {
    const fact: SqliteTableMaintenanceFact = { ...outcome.fact, phase, commitAcknowledged: phase === 'committed' }; f.tasks.set(task.id, { ...task, status: 'running', sqliteTableMaintenance: fact }); expect(taskCancelSnapshot([task.id], f.tasks, () => { throw Error('表维护不能借用网络表格写取消状态'); })).toEqual([{ taskId: task.id, state: expected }]);
  }
});
it.each([['clear', false], ['clear', true], ['drop', false]] as const)('%s/reset=%s准确绑定动作、语句数和完整风险确认，任务只保真实最小事实', async (action, resetSequence) => {
  const f = fixture(false, action, resetSequence), preview = await f.ready(); expect(preview.requiredAcknowledgements).toEqual(getSqliteTableMaintenanceAcknowledgements(action, resetSequence));
  const result = await f.apply(preview.previewId, 'apply-task', preview.confirmation, [...preview.requiredAcknowledgements].reverse()); expect(result.outcome).toBe('committed'); expect(result.action).toBe(action); expect(result.resetSequence).toBe(resetSequence); expect(result.fact.actualBeforeRows).toBe('3'); expect(result.fact.requestedStatements).toBe(resetSequence ? 2 : 1);
  const bytes = JSON.stringify([...f.saved.values()]); for (const forbidden of ['requiredAcknowledgements', 'acknowledgements', 'catalogueId', 'previewId', 'rowCount', 'sqlite_sequence', 'DELETE FROM', 'DROP TABLE']) expect(bytes).not.toContain(forbidden);
});
it.each([['clear', false], ['clear', true], ['drop', false]] as const)('%s/reset=%s遗漏某风险确认时在runtime投递前消费预览并保not-sent事实', async (action, resetSequence) => {
  const f = fixture(false, action, resetSequence), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', preview.confirmation, preview.requiredAcknowledgements.slice(0, -1));
  expect(result.outcome).toBe('not-sent'); expect(result.fact.completedStatements).toBe(0); expect(result.fact.actualBeforeRows).toBeUndefined(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableMaintenance.apply')).toBe(false); await expect(f.apply(preview.previewId, 'no-replay')).rejects.toThrow();
});
it.each([['all-current-data', 'all-current-data'], ['all-current-data', 'unknown-risk']] as const)('重复或未知公开风险数组%s/%s不领取任何写入能力', async (first, second) => {
  const f = fixture(), preview = await f.ready(); await expect(f.apply(preview.previewId, 'invalid', preview.confirmation, [first, second] as any)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableMaintenance.apply')).toBe(false); expect((await f.apply(preview.previewId, 'valid')).outcome).toBe('committed');
});
it('非AUTOINCREMENT表不能仅凭reset勾选扩大为sqlite_sequence写入', async () => {
  const f = fixture(false, 'clear', true, false); await expect(f.ready()).rejects.toThrow('AUTOINCREMENT'); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableMaintenance.preview' || command === 'sqlite.tableMaintenance.apply')).toBe(false);
});
it.each(['action', 'resetSequence'] as const)('runtime偷换%s即使另组SQL和确认项自洽，也不能扩大原预览', async field => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); if (command !== 'sqlite.tableMaintenance.preview') return output; const action = field === 'action' ? 'drop' as const : 'clear' as const, resetSequence = field === 'resetSequence'; return { ...output, action, resetSequence, ...buildSqliteTableMaintenancePlan(f.target, action, resetSequence) }; });
  await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableMaintenance.release' && input.previewId)).toBe(true);
});
it('预览行数是独立新观察，不能当锁定集合或覆盖写锁后的actualBeforeRows', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableMaintenance.preview' ? { ...output, rowCount: '9223372036854775807' } : output; }); const preview = await f.preview(catalogue.catalogueId); expect(preview.rowCount).toBe('9223372036854775807');
  const result = await f.apply(preview.previewId); expect(result.fact.actualBeforeRows).toBe('3'); expect(JSON.stringify([...f.saved.values()])).not.toContain('9223372036854775807');
});
