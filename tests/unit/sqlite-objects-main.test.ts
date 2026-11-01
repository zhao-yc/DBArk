import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteObjectsMain } from '../../src/main/sqliteObjectsMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { buildSqliteObjectsPlan, getSqliteObjectsAcknowledgements, type SqliteObjectsAction, type SqliteObjectsKind, type SqliteObjectsFact, type SqliteObjectsInspectOutput, type SqliteObjectsPreviewOutput, type SqliteObjectsOutcome } from '../../src/shared/sqliteObjects';
import { sqliteObjectsFactMessage } from '../../src/shared/sqliteObjectsFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const copy = <T,>(value: T): T => structuredClone(value);
/** Main纯协议端口验证；事务ACK由合成端口回调注入，不冒称真实数据库提交。 */
function fixture(readOnly = false, kind: SqliteObjectsKind = 'view', action: SqliteObjectsAction = 'create', attachedTriggers: { name: string; sql: string }[] = []) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/PRIVATE_OBJECTS_FILE.sqlite', readOnly, busyTimeoutMs: 0 } };
  const target = { connectionId: profile.id, database: 'main' as const, kind, name: '对象"🚢' }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const sql = action === 'drop' ? undefined : kind === 'view' ? 'CREATE VIEW "对象""🚢" AS SELECT \'PRIVATE_OBJECTS_LITERAL\' AS note' : 'CREATE TRIGGER "对象""🚢" AFTER INSERT ON subject BEGIN SELECT \'PRIVATE_OBJECTS_LITERAL\'; END';
  const catalogue = (): SqliteObjectsInspectOutput => ({ catalogueId: 'catalogue-' + ++next, target, action, exists: action !== 'create', sourceSql: action === 'create' ? null : kind === 'view' ? 'CREATE VIEW "对象""🚢" AS SELECT 1' : 'CREATE TRIGGER "对象""🚢" AFTER INSERT ON subject BEGIN SELECT 1; END', relatedObjects: [], attachedTriggers, eligibleRelations: [{ name: 'subject', kind: 'table' }], readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.objects.inspect') { input.assertCurrent(); return catalogue(); }
    if (command === 'sqlite.objects.preview') { input.assertCurrent(); return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, action, ...buildSqliteObjectsPlan(target, action, input.sql, attachedTriggers), confirmation: 'main.' + target.name, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.objects.apply') return acknowledged(input);
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, copy(task)); });
  const main = new SqliteObjectsMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(copy(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteObjects ? sqliteObjectsFactMessage(task.sqliteObjects) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, copy(next)); } },
  });
  /** 注入准确原operationId的协议事实；实际磁盘/utility证据由backend和native专项提供。 */
  function acknowledged(input: any): SqliteObjectsOutcome {
    input.assertCurrent(); let fact: SqliteObjectsFact = { operationId: input.operationId, target, action, phase: 'not-sent', requestedStatements: buildSqliteObjectsPlan(target, action, sql, attachedTriggers).sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', completedStatements: fact.requestedStatements }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteObjectsFact>[]) { fact = { ...fact, ...patch }; input.recordObjectsFact(fact); }
    return { operationId: input.operationId, target, action, outcome: 'committed', fact, definitionVerified: true, message: '准确协议提交确认' };
  }
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.objects.inspect', { ...target, action, taskId }) as Promise<SqliteObjectsInspectOutput>;
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.objects.preview', { catalogueId, sql, taskId }) as Promise<SqliteObjectsPreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.name, acknowledgements = getSqliteObjectsAcknowledgements(target, action, attachedTriggers.length)) => main.request(owner, 'sqlite.objects.apply', { previewId, taskId, confirmation, acknowledgements }) as Promise<SqliteObjectsOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, action, kind, sql, attachedTriggers, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('目录/SQL只交原文档，路径/对象定义默认值与SQL不进入持久任务', async () => {
  const f = fixture(), catalogue = await f.inspect(); f.main.assertPublication(f.owner, catalogue, 'sqlite.objects.inspect'); const preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.objects.preview'); const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(1); expect(result.fact.commitAcknowledged).toBe(true);
  const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_OBJECTS', 'filePath', 'DEFAULT', 'defaultSql', 'ALTER TABLE']) expect(bytes).not.toContain(marker); expect(f.saved.get('apply-task')?.sqliteObjects).toEqual(result.fact);
});
it.each(['filePath', 'profile', 'assertCurrent', 'operationId', 'recordObjectsFact'])('公开输入拒绝私有能力%s，零runtime投递', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.objects.inspect', { ...f.target, action: f.action, taskId: 'bad', [key]: '不允许' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代拒迟到回包并释放准确能力', async stage => {
  const f = fixture(), catalogue = await f.inspect(), output = stage === 'inspect' ? catalogue : await f.preview(catalogue.catalogueId); f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.objects.' + stage)).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.objects.release' && input[stage === 'inspect' ? 'catalogueId' : 'previewId'] === ('catalogueId' in output && stage === 'inspect' ? output.catalogueId : (output as SqliteObjectsPreviewOutput).previewId))).toBe(true);
});
it.each(['rotate', 'revise', 'disconnect'] as const)('原来源%s后即使名称相同也不能重领目录预览', async change => {
  const f = fixture(), catalogue = await f.inspect(); f[change](); f.main.observe(); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.objects.preview')).toBe(false);
});
it('另一文档不能预览/释放原目录；释放双编号必须整组核归属', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.objects.release', { catalogueId: catalogue.catalogueId })).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.objects.preview', { catalogueId: catalogue.catalogueId, sql: f.sql, taskId: 'foreign' })).rejects.toThrow(); expect((await f.preview(catalogue.catalogueId)).target).toEqual(f.target);
});
it.each([false, true])('错误确认/只读在投递前阻止对象DDL且单次消费预览（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.其它表'); expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.objects.apply')).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('runtime预览SQL替换为另一对象DDL即拒绝并释放，不能用回包扩大对象定义权限', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.objects.preview' ? { ...output, sql: ['DROP TABLE main.control'] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.objects.release' && input.previewId)).toBe(true);
});
it('目录自然到期只阻新领取，不撤已签新预览或已领取长writer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(); vi.setSystemTime(Date.now() + 299999); const preview = await f.preview(catalogue.catalogueId); vi.setSystemTime(Date.now() + 2); f.main.observe(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.objects.apply') vi.setSystemTime(Date.now() + 300001); return original(command, input); }); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('目录跨TTL后明确释放仍撤在途preview，晚回不能重签提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; vi.setSystemTime(Date.now() + 299999); let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.objects.preview' ? gate : original(command, input)); const pending = f.preview(catalogue.catalogueId), rejected = expect(pending).rejects.toThrow(); const output = await original('sqlite.objects.preview', { catalogueId: catalogue.catalogueId, sql: f.sql, assertCurrent() {} }); vi.setSystemTime(Date.now() + 2); f.main.observe(); await f.main.request(f.owner, 'sqlite.objects.release', { catalogueId: catalogue.catalogueId }); resolve(output); await rejected; await expect(f.apply(output.previewId)).rejects.toThrow();
});
it('已claim writer不因目录释放假取消，原guard保持且无ACK只能记未知', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; let reject!: (reason: unknown) => void, sent: any; const gate = new Promise<never>((_, no) => { reject = no; });
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.objects.apply') { sent = input; return gate; } return original(command, input); }); const pending = f.apply(preview.previewId); await f.main.request(f.owner, 'sqlite.objects.release', { catalogueId: preview.catalogueId }); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toBe(false); reject(Error('没有提交ACK')); expect((await pending).outcome).toBe('unknown');
});
it('未知结果撤目录和兄弟预览，不把未确认回包视为成功或重放', async () => {
  const f = fixture(), one = await f.ready(), two = await f.preview(one.catalogueId, 'second-preview'), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.objects.apply') throw Error('传输中断'); return original(command, input); }); expect((await f.apply(one.previewId)).outcome).toBe('unknown'); await expect(f.apply(two.previewId, 'no-replay')).rejects.toThrow(); await expect(f.preview(one.catalogueId, 'no-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.objects.apply')).toHaveLength(1);
});
it('取消ACK不能提前释放Main占用，退出等待准确原请求settle', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; }); f.request.mockImplementation(async (command, input) => command === 'sqlite.objects.inspect' ? gate : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'inspect-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true); resolve(f.catalogue()); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});
it('首份任务持久化失败时零读取/对象DDL，不留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('写盘拒绝'); }); await expect(f.inspect()).rejects.toThrow('写盘拒绝'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('Main取消快照区分对象DDL已确认、提交中和未知，不按旧running状态放行', async () => {
  const f = fixture(), preview = await f.ready(), outcome = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  for (const [phase, expected] of [['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished']] as const) {
    const fact: SqliteObjectsFact = { ...outcome.fact, phase, commitAcknowledged: phase === 'committed' }; f.tasks.set(task.id, { ...task, status: 'running', sqliteObjects: fact }); expect(taskCancelSnapshot([task.id], f.tasks, () => { throw Error('对象定义不能借用网络表格写取消状态'); })).toEqual([{ taskId: task.id, state: expected }]);
  }
});
it.each(['view', 'trigger'] as const)('%s的create/replace/drop用途分别固定目录和SQL计划，不能用任务接管其它用途', async kind => {
  for (const action of ['create', 'replace', 'drop'] as const) { const f = fixture(false, kind, action), preview = await f.ready(), result = await f.apply(preview.previewId); expect(result.action).toBe(action); expect(result.target.kind).toBe(kind); expect(result.fact.requestedStatements).toBe(action === 'replace' ? 2 : 1); expect(result.outcome).toBe('committed'); }
});
it('view替换只重建原目录的准确附属trigger定义，Main摘要绑定且不保存原文', async () => {
  const attached = [{ name: 'owned_trigger', sql: 'CREATE TRIGGER owned_trigger INSTEAD OF INSERT ON "对象""🚢" BEGIN SELECT NEW.note; END' }], f = fixture(false, 'view', 'replace', attached), preview = await f.ready(); expect(preview.attachedTriggerCount).toBe(1); expect(preview.sql).toHaveLength(3); expect(preview.sql[2]).toBe(attached[0].sql); expect(preview.requiredAcknowledgements).toContain('attached-view-triggers');
  const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(3); const bytes = JSON.stringify([...f.saved.values()]);
  for (const task of f.saved.values()) for (const key of ['sql', 'relatedObjects', 'attachedTriggers', 'catalogueId', 'previewId', 'acknowledgements']) expect(task).not.toHaveProperty(key);
  for (const marker of ['"sql":', attached[0].sql, 'owned_trigger', 'NEW.note', 'PRIVATE_OBJECTS_LITERAL']) expect(bytes).not.toContain(marker);
});
it('drop view明确确认附属trigger会被删除，语句仍恰好一条原生DROP', async () => {
  const f = fixture(false, 'view', 'drop', [{ name: 'owned_trigger', sql: 'CREATE TRIGGER owned_trigger INSTEAD OF INSERT ON "对象""🚢" BEGIN SELECT 1; END' }]), preview = await f.ready(); expect(preview.sql).toHaveLength(1); expect(preview.attachedTriggerCount).toBe(1); expect(preview.requiredAcknowledgements).toContain('attached-view-triggers'); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('同名trigger回包若正文被换写，即使header相同也不能替代原view附属定义', async () => {
  const f = fixture(false, 'view', 'replace', [{ name: 'owned_trigger', sql: 'CREATE TRIGGER owned_trigger INSTEAD OF INSERT ON "对象""🚢" BEGIN SELECT 1; END' }]), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.objects.preview' ? { ...output, sql: [...output.sql.slice(0, 2), output.sql[2].replace('SELECT 1', 'SELECT 2')] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.objects.release' && input.previewId)).toBe(true);
});
it('create header不能偷换种类或准确名称，drop不接受任意SQL，均零runtime预览投递', async () => {
  for (const [action, sql] of [['create', 'CREATE TRIGGER "对象""🚢" AFTER INSERT ON subject BEGIN SELECT 1; END'], ['create', 'CREATE VIEW different AS SELECT 1'], ['drop', 'DROP VIEW "对象""🚢"']] as const) { const f = fixture(false, 'view', action), catalogue = await f.inspect(); await expect(f.main.request(f.owner, 'sqlite.objects.preview', { catalogueId: catalogue.catalogueId, sql, taskId: 'invalid' })).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.objects.preview')).toBe(false); }
});
it('缺少风险确认时单次消费预览并保not-sent，未知/重复确认不能恢复写能力', async () => {
  const f = fixture(), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', preview.confirmation, preview.requiredAcknowledgements.slice(0, -1)); expect(result.outcome).toBe('not-sent'); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.objects.apply')).toBe(false); await expect(f.apply(preview.previewId, 'no-replay')).rejects.toThrow();
  const next = fixture(), accepted = await next.ready(); for (const acknowledgements of [['definition-effects', 'definition-effects'], ['definition-effects', 'unknown']]) await expect(next.apply(accepted.previewId, 'invalid', accepted.confirmation, acknowledgements as any)).rejects.toThrow(); expect(next.request.mock.calls.some(([command]) => command === 'sqlite.objects.apply')).toBe(false);
});
