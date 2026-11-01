import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableRenameMain } from '../../src/main/sqliteTableRenameMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { buildSqliteTableRenamePlan, type SqliteTableRenameFact, type SqliteTableRenameInspectOutput, type SqliteTableRenamePreviewOutput, type SqliteTableRenameOutcome } from '../../src/shared/sqliteTableRename';
import { sqliteTableRenameFactMessage } from '../../src/shared/sqliteTableRenameFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const copy = <T,>(value: T): T => structuredClone(value);
const navigationIdentity = 'a'.repeat(64);
const newName = '新对象"🚢';
/** Main纯协议端口验证；事务ACK由合成端口回调注入，不冒称真实数据库提交。 */
function fixture(readOnly = false) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/PRIVATE_RENAME_FILE.sqlite', readOnly, busyTimeoutMs: 0 } };
  const target = { connectionId: profile.id, database: 'main' as const, table: '对象"🚢' }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const catalogue = (): SqliteTableRenameInspectOutput => ({ catalogueId: 'catalogue-' + ++next, navigationIdentity, target, columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }, { cid: 1, name: 'note', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }], tableSql: 'CREATE TABLE "对象""🚢"(id INTEGER,note TEXT)', relatedObjects: [], strict: false, withoutRowid: false, readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.tableRename.inspect') { input.assertCurrent(); return catalogue(); }
    if (command === 'sqlite.tableRename.preview') { input.assertCurrent(); return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, sql: buildSqliteTableRenamePlan(target, input.newName).sql, newName: input.newName, navigationIdentity, confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.tableRename.apply') return acknowledged(input);
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, copy(task)); });
  const main = new SqliteTableRenameMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(copy(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteTableRename ? sqliteTableRenameFactMessage(task.sqliteTableRename) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, copy(next)); } },
  });
  /** 注入准确原operationId的协议事实；实际磁盘/utility证据由backend和native专项提供。 */
  function acknowledged(input: any): SqliteTableRenameOutcome {
    input.assertCurrent(); let fact: SqliteTableRenameFact = { operationId: input.operationId, target, phase: 'not-sent', requestedStatements: 1, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', completedStatements: 1 }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteTableRenameFact>[]) { fact = { ...fact, ...patch }; input.recordTableRenameFact(fact); }
    return { operationId: input.operationId, target, newName, navigationIdentity, outcome: 'committed', fact, definitionVerified: true, message: '准确协议提交确认' };
  }
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.tableRename.inspect', { ...target, taskId }) as Promise<SqliteTableRenameInspectOutput>;
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableRename.preview', { catalogueId, newName, taskId }) as Promise<SqliteTableRenamePreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table) => main.request(owner, 'sqlite.tableRename.apply', { previewId, taskId, confirmation }) as Promise<SqliteTableRenameOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('目录/SQL只交原文档，路径/表重命名默认值与SQL不进入持久任务', async () => {
  const f = fixture(), catalogue = await f.inspect(); f.main.assertPublication(f.owner, catalogue, 'sqlite.tableRename.inspect'); const preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.tableRename.preview'); const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(1); expect(result.fact.commitAcknowledged).toBe(true);
  const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_RENAME', 'filePath', 'DEFAULT', 'defaultSql', 'ALTER TABLE']) expect(bytes).not.toContain(marker); expect(f.saved.get('apply-task')?.sqliteTableRename).toEqual(result.fact);
});
it.each(['filePath', 'profile', 'assertCurrent', 'operationId', 'recordTableRenameFact'])('公开输入拒绝私有能力%s，零runtime投递', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.tableRename.inspect', { ...f.target, taskId: 'bad', [key]: '不允许' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代拒迟到回包并释放准确能力', async stage => {
  const f = fixture(), catalogue = await f.inspect(), output = stage === 'inspect' ? catalogue : await f.preview(catalogue.catalogueId); f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.tableRename.' + stage)).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRename.release' && input[stage === 'inspect' ? 'catalogueId' : 'previewId'] === ('catalogueId' in output && stage === 'inspect' ? output.catalogueId : (output as SqliteTableRenamePreviewOutput).previewId))).toBe(true);
});
it.each(['rotate', 'revise', 'disconnect'] as const)('原来源%s后即使名称相同也不能重领目录预览', async change => {
  const f = fixture(), catalogue = await f.inspect(); f[change](); f.main.observe(); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRename.preview')).toBe(false);
});
it('另一文档不能预览/释放原目录；释放双编号必须整组核归属', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.tableRename.release', { catalogueId: catalogue.catalogueId })).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.tableRename.preview', { catalogueId: catalogue.catalogueId, newName, taskId: 'foreign' })).rejects.toThrow(); expect((await f.preview(catalogue.catalogueId)).target).toEqual(f.target);
});
it.each([false, true])('错误确认/只读在投递前阻止DDL且单次消费预览（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.其它表'); expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRename.apply')).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('runtime预览SQL替换为另一DDL即拒绝并释放，不能用回包扩大表重命名权限', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRename.preview' ? { ...output, sql: ['DROP TABLE main.control'] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRename.release' && input.previewId)).toBe(true);
});
it('目录自然到期只阻新领取，不撤已签新预览或已领取长writer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(); vi.setSystemTime(Date.now() + 299999); const preview = await f.preview(catalogue.catalogueId); vi.setSystemTime(Date.now() + 2); f.main.observe(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRename.apply') vi.setSystemTime(Date.now() + 300001); return original(command, input); }); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('目录跨TTL后明确释放仍撤在途preview，晚回不能重签提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; vi.setSystemTime(Date.now() + 299999); let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableRename.preview' ? gate : original(command, input)); const pending = f.preview(catalogue.catalogueId), rejected = expect(pending).rejects.toThrow(); const output = await original('sqlite.tableRename.preview', { catalogueId: catalogue.catalogueId, newName, assertCurrent() {} }); vi.setSystemTime(Date.now() + 2); f.main.observe(); await f.main.request(f.owner, 'sqlite.tableRename.release', { catalogueId: catalogue.catalogueId }); resolve(output); await rejected; await expect(f.apply(output.previewId)).rejects.toThrow();
});
it('已claim writer不因目录释放假取消，原guard保持且无ACK只能记未知', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; let reject!: (reason: unknown) => void, sent: any; const gate = new Promise<never>((_, no) => { reject = no; });
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRename.apply') { sent = input; return gate; } return original(command, input); }); const pending = f.apply(preview.previewId); await f.main.request(f.owner, 'sqlite.tableRename.release', { catalogueId: preview.catalogueId }); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toBe(false); reject(Error('没有提交ACK')); expect((await pending).outcome).toBe('unknown');
});
it('未知结果撤目录和兄弟预览，不把未确认回包视为成功或重放', async () => {
  const f = fixture(), one = await f.ready(), two = await f.preview(one.catalogueId, 'second-preview'), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRename.apply') throw Error('传输中断'); return original(command, input); }); expect((await f.apply(one.previewId)).outcome).toBe('unknown'); await expect(f.apply(two.previewId, 'no-replay')).rejects.toThrow(); await expect(f.preview(one.catalogueId, 'no-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableRename.apply')).toHaveLength(1);
});
it('取消ACK不能提前释放Main占用，退出等待准确原请求settle', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; }); f.request.mockImplementation(async (command, input) => command === 'sqlite.tableRename.inspect' ? gate : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'inspect-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true); resolve(f.catalogue()); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});
it('首份任务持久化失败时零读取/DDL，不留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('写盘拒绝'); }); await expect(f.inspect()).rejects.toThrow('写盘拒绝'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('Main取消快照区分DDL已确认、提交中和未知，不按旧running状态放行', async () => {
  const f = fixture(), preview = await f.ready(), outcome = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  for (const [phase, expected] of [['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished']] as const) {
    const fact: SqliteTableRenameFact = { ...outcome.fact, phase, commitAcknowledged: phase === 'committed' }; f.tasks.set(task.id, { ...task, status: 'running', sqliteTableRename: fact }); expect(taskCancelSnapshot([task.id], f.tasks, () => { throw Error('表重命名不能借用网络表格写取消状态'); })).toEqual([{ taskId: task.id, state: expected }]);
  }
});

it('预览新名及最终回包新名均绑定原Main能力，不能偷换到第三张表', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRename.preview' ? { ...output, newName: '偷换预览' } : output; });
  await expect(f.preview(catalogue.catalogueId)).rejects.toThrow();
  f.request.mockImplementation(original); const preview = await f.preview(catalogue.catalogueId, 'second-preview');
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRename.apply' ? { ...output, newName: '偷换提交' } : output; });
  const outcome = await f.apply(preview.previewId); expect(outcome.newName).toBe(newName); expect(outcome.outcome).toBe('committed'); expect(outcome.cleanupWarning).toBe(true); expect(outcome.definitionVerified).toBe(false);
});
it('未知回包保留原预览新名，供界面准确失效两个名字且不污染持久事实', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRename.apply') throw Error('传输未知'); return original(command, input); });
  const output = await f.apply(preview.previewId); expect(output.newName).toBe(newName); expect(output.outcome).toBe('unknown'); expect(JSON.stringify([...f.saved.values()])).not.toContain(newName);
});
it('预览导航身份必须与原目录相等，最终回包也不能换成另一条lineage', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRename.preview' ? { ...output, navigationIdentity: 'b'.repeat(64) } : output; });
  await expect(f.preview(catalogue.catalogueId)).rejects.toThrow();
  f.request.mockImplementation(original); const preview = await f.preview(catalogue.catalogueId, 'second-preview');
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRename.apply' ? { ...output, navigationIdentity: 'b'.repeat(64) } : output; });
  const output = await f.apply(preview.previewId); expect(output.navigationIdentity).toBe(navigationIdentity); expect(output.outcome).toBe('committed'); expect(output.definitionVerified).toBe(false); expect(output.cleanupWarning).toBe(true); expect(JSON.stringify([...f.saved.values()])).not.toContain(navigationIdentity);
});
