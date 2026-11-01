import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteIndexesMain } from '../../src/main/sqliteIndexesMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { buildSqliteIndexesPlan, type SqliteIndexesAction, type SqliteIndexesFact, type SqliteIndexesInspectOutput, type SqliteIndexesPreviewOutput, type SqliteIndexesOutcome } from '../../src/shared/sqliteIndexes';
import { sqliteIndexesFactMessage } from '../../src/shared/sqliteIndexesFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const copy = <T,>(value: T): T => structuredClone(value);
const actions: SqliteIndexesAction[] = [{ kind: 'create', design: { name: '索引"🚢', unique: false, keys: [{ kind: 'expression', expression: "length(note || 'PRIVATE_INDEX_LITERAL')", order: 'desc', collation: 'BINARY' }], where: 'id > 0' } }];
/** Main纯协议端口验证；事务ACK由合成端口回调注入，不冒称真实数据库提交。 */
function fixture(readOnly = false) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/PRIVATE_INDEX_FILE.sqlite', readOnly, busyTimeoutMs: 0 } };
  const target = { connectionId: profile.id, database: 'main' as const, table: '对象"🚢' }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const catalogue = (): SqliteIndexesInspectOutput => ({ catalogueId: 'catalogue-' + ++next, target, columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }], indexes: [], collations: ['BINARY', 'NOCASE', 'RTRIM'], readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.indexes.inspect') { input.assertCurrent(); return catalogue(); }
    if (command === 'sqlite.indexes.preview') { input.assertCurrent(); return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, sql: buildSqliteIndexesPlan(target, input.actions).sql, added: input.actions.filter((action: SqliteIndexesAction) => action.kind === 'create').length, removed: input.actions.filter((action: SqliteIndexesAction) => action.kind === 'drop').length, confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.indexes.apply') return acknowledged(input);
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, copy(task)); });
  const main = new SqliteIndexesMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(copy(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteIndexes ? sqliteIndexesFactMessage(task.sqliteIndexes) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, copy(next)); } },
  });
  /** 注入准确原operationId的协议事实；实际磁盘/utility证据由backend和native专项提供。 */
  function acknowledged(input: any): SqliteIndexesOutcome {
    input.assertCurrent(); let fact: SqliteIndexesFact = { operationId: input.operationId, target, phase: 'not-sent', requestedStatements: 1, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', completedStatements: 1 }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteIndexesFact>[]) { fact = { ...fact, ...patch }; input.recordIndexesFact(fact); }
    return { operationId: input.operationId, target, outcome: 'committed', fact, definitionVerified: true, message: '准确协议提交确认' };
  }
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.indexes.inspect', { ...target, taskId }) as Promise<SqliteIndexesInspectOutput>;
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.indexes.preview', { catalogueId, actions: copy(actions), taskId }) as Promise<SqliteIndexesPreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table) => main.request(owner, 'sqlite.indexes.apply', { previewId, taskId, confirmation }) as Promise<SqliteIndexesOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('目录/SQL只交原文档，路径/表达式/WHERE与SQL不进入持久任务', async () => {
  const f = fixture(), catalogue = await f.inspect(); f.main.assertPublication(f.owner, catalogue, 'sqlite.indexes.inspect'); const preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.indexes.preview'); const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(1); expect(result.fact.commitAcknowledged).toBe(true);
  const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_INDEX', 'filePath', 'length(', 'id > 0', 'CREATE INDEX']) expect(bytes).not.toContain(marker); expect(f.saved.get('apply-task')?.sqliteIndexes).toEqual(result.fact);
});
it.each(['filePath', 'profile', 'assertCurrent', 'operationId', 'recordIndexesFact'])('公开输入拒绝私有能力%s，零runtime投递', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.indexes.inspect', { ...f.target, taskId: 'bad', [key]: '不允许' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代拒迟到回包并释放准确能力', async stage => {
  const f = fixture(), catalogue = await f.inspect(), output = stage === 'inspect' ? catalogue : await f.preview(catalogue.catalogueId); f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.indexes.' + stage)).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.indexes.release' && input[stage === 'inspect' ? 'catalogueId' : 'previewId'] === ('catalogueId' in output && stage === 'inspect' ? output.catalogueId : (output as SqliteIndexesPreviewOutput).previewId))).toBe(true);
});
it.each(['rotate', 'revise', 'disconnect'] as const)('原来源%s后即使名称相同也不能重领目录预览', async change => {
  const f = fixture(), catalogue = await f.inspect(); f[change](); f.main.observe(); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.indexes.preview')).toBe(false);
});
it('另一文档不能预览/释放原目录；释放双编号必须整组核归属', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.indexes.release', { catalogueId: catalogue.catalogueId })).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.indexes.preview', { catalogueId: catalogue.catalogueId, actions, taskId: 'foreign' })).rejects.toThrow(); expect((await f.preview(catalogue.catalogueId)).target).toEqual(f.target);
});
it.each([false, true])('错误确认/只读在投递前阻止DDL且单次消费预览（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.其它表'); expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.indexes.apply')).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('runtime预览SQL替换为另一DDL即拒绝并释放，不能用回包扩大索引权限', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.indexes.preview' ? { ...output, sql: ['DROP TABLE main.control'] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.indexes.release' && input.previewId)).toBe(true);
});
it('目录自然到期只阻新领取，不撤已签新预览或已领取长writer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(); vi.setSystemTime(Date.now() + 299999); const preview = await f.preview(catalogue.catalogueId); vi.setSystemTime(Date.now() + 2); f.main.observe(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.indexes.apply') vi.setSystemTime(Date.now() + 300001); return original(command, input); }); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('目录跨TTL后明确释放仍撤在途preview，晚回不能重签提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; vi.setSystemTime(Date.now() + 299999); let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.indexes.preview' ? gate : original(command, input)); const pending = f.preview(catalogue.catalogueId), rejected = expect(pending).rejects.toThrow(); const output = await original('sqlite.indexes.preview', { catalogueId: catalogue.catalogueId, actions, assertCurrent() {} }); vi.setSystemTime(Date.now() + 2); f.main.observe(); await f.main.request(f.owner, 'sqlite.indexes.release', { catalogueId: catalogue.catalogueId }); resolve(output); await rejected; await expect(f.apply(output.previewId)).rejects.toThrow();
});
it('已claim writer不因目录释放假取消，原guard保持且无ACK只能记未知', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; let reject!: (reason: unknown) => void, sent: any; const gate = new Promise<never>((_, no) => { reject = no; });
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.indexes.apply') { sent = input; return gate; } return original(command, input); }); const pending = f.apply(preview.previewId); await f.main.request(f.owner, 'sqlite.indexes.release', { catalogueId: preview.catalogueId }); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toBe(false); reject(Error('没有提交ACK')); expect((await pending).outcome).toBe('unknown');
});
it('未知结果撤目录和兄弟预览，不把未确认回包视为成功或重放', async () => {
  const f = fixture(), one = await f.ready(), two = await f.preview(one.catalogueId, 'second-preview'), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.indexes.apply') throw Error('传输中断'); return original(command, input); }); expect((await f.apply(one.previewId)).outcome).toBe('unknown'); await expect(f.apply(two.previewId, 'no-replay')).rejects.toThrow(); await expect(f.preview(one.catalogueId, 'no-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.indexes.apply')).toHaveLength(1);
});
it('取消ACK不能提前释放Main占用，退出等待准确原请求settle', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; }); f.request.mockImplementation(async (command, input) => command === 'sqlite.indexes.inspect' ? gate : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'inspect-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true); resolve(f.catalogue()); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});
it('首份任务持久化失败时零读取/DDL，不留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('写盘拒绝'); }); await expect(f.inspect()).rejects.toThrow('写盘拒绝'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('Main取消快照区分DDL已确认、提交中和未知，不按旧running状态放行', async () => {
  const f = fixture(), preview = await f.ready(), outcome = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  for (const [phase, expected] of [['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished']] as const) {
    const fact: SqliteIndexesFact = { ...outcome.fact, phase, commitAcknowledged: phase === 'committed' }; f.tasks.set(task.id, { ...task, status: 'running', sqliteIndexes: fact }); expect(taskCancelSnapshot([task.id], f.tasks, () => { throw Error('索引不能借用网络表格写取消状态'); })).toEqual([{ taskId: task.id, state: expected }]);
  }
});
