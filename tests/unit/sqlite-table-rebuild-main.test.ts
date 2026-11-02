import { buildSqliteTableRebuildPlan } from '../../src/shared/sqliteTableRebuildExecutionPlan';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableRebuildMain } from '../../src/main/sqliteTableRebuildMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { type SqliteTableRebuildChange, type SqliteTableRebuildFact, type SqliteTableRebuildInspectOutput, type SqliteTableRebuildPreviewOutput, type SqliteTableRebuildOutcome } from '../../src/shared/sqliteTableRebuild';
import { sqliteTableRebuildFactMessage } from '../../src/shared/sqliteTableRebuildFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const copy = <T,>(value: T): T => structuredClone(value);
const changes: SqliteTableRebuildChange[] = [{ column: 'note', declaredType: 'TEXT', default: { kind: 'text', value: 'PRIVATE_COLUMN_LITERAL' } }];
/** Main纯协议端口验证；事务ACK由合成端口回调注入，不冒称真实数据库提交。 */
function fixture(readOnly = false) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0, plannedStatements = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/PRIVATE_COLUMN_FILE.sqlite', readOnly, busyTimeoutMs: 0 } };
  const target = { connectionId: profile.id, database: 'main' as const, table: '对象"🚢' }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const catalogue = (): SqliteTableRebuildInspectOutput => ({ catalogueId: 'catalogue-' + ++next, target, columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }, { cid: 1, name: 'note', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }], tableSql: 'CREATE TABLE "对象""🚢"(id INTEGER,note TEXT)', relatedObjects: [], strict: false, withoutRowid: false, rowIdentity: { kind: 'rowid', source: '_rowid_' }, readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.tableRebuild.inspect') { input.assertCurrent(); return catalogue(); }
    if (command === 'sqlite.tableRebuild.preview') { input.assertCurrent(); const plan = buildSqliteTableRebuildPlan(catalogue(), input.changes, input.rebuildNames, input.columnOrder, input.foreignKeyEdits, input.primaryKeyEdit); plannedStatements = plan.sql.length; return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, sql: plan.sql, changedTypes: plan.changedTypes, changedDefaults: plan.changedDefaults, ...(plan.changedPrimaryKey ? { changedPrimaryKey: plan.changedPrimaryKey } : {}), ...(plan.changedForeignKeys ? { changedForeignKeys: plan.changedForeignKeys } : {}), warnings: plan.warnings, confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.tableRebuild.apply') return acknowledged(input);
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, copy(task)); });
  const main = new SqliteTableRebuildMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(copy(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteTableRebuild ? sqliteTableRebuildFactMessage(task.sqliteTableRebuild) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, copy(next)); } },
  });
  /** 注入准确原operationId的协议事实；实际磁盘/utility证据由backend和native专项提供。 */
  function acknowledged(input: any): SqliteTableRebuildOutcome {
    input.assertCurrent(); let fact: SqliteTableRebuildFact = { operationId: input.operationId, target, phase: 'not-sent', requestedStatements: plannedStatements, completedStatements: 0, sourceRows: '0', copiedRows: '0', verifiedRows: '0', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', completedStatements: plannedStatements, sourceRows: '2', copiedRows: '2', verifiedRows: '2' }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteTableRebuildFact>[]) { fact = { ...fact, ...patch }; input.recordRebuildFact(fact); }
    return { operationId: input.operationId, target, outcome: 'committed', fact, definitionVerified: true, message: '准确协议提交确认' };
  }
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.tableRebuild.inspect', { ...target, taskId }) as Promise<SqliteTableRebuildInspectOutput>;
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableRebuild.preview', { catalogueId, changes: copy(changes), taskId }) as Promise<SqliteTableRebuildPreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table) => main.request(owner, 'sqlite.tableRebuild.apply', { previewId, taskId, confirmation }) as Promise<SqliteTableRebuildOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('Main独立重算纯外键预览，传结构化补丁且不把关系名称或SQL写入任务概要', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreignKeyEdits = [{ kind: 'add', definition: { name: 'PRIVATE_FK', columns: ['note'], referencedTable: 'PRIVATE_PARENT', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE', deferral: 'deferred' } }];
  const output = await f.main.request(f.owner, 'sqlite.tableRebuild.preview', { catalogueId: catalogue.catalogueId, changes: [], foreignKeyEdits, taskId: 'fk-preview' }) as SqliteTableRebuildPreviewOutput;
  expect(output).toMatchObject({ changedTypes: 0, changedDefaults: 0, changedForeignKeys: 1 }); expect(output.sql.join('\n')).toContain('CONSTRAINT "PRIVATE_FK"');
  const sent = f.request.mock.calls.find(call => call[0] === 'sqlite.tableRebuild.preview')![1]; expect(sent.foreignKeyEdits).toEqual(foreignKeyEdits); expect(sent.changes).toEqual([]);
  expect((await f.apply(output.previewId)).outcome).toBe('committed'); const tasks = JSON.stringify([...f.saved.values()]); for (const secret of ['PRIVATE_FK', 'PRIVATE_PARENT', 'CONSTRAINT', 'FOREIGN KEY']) expect(tasks).not.toContain(secret);
});
it.each([undefined, false, true])('Main主键变化标记%s必须与完整独立计划相符，异常cap立即释放', async changedPrimaryKey => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  const primaryKeyEdit = { kind: 'add', definition: { name: 'PRIVATE_PK', location: 'table', columns: [{ column: 'id', collation: null, order: null }], conflict: null, autoIncrement: false } };
  f.request.mockImplementation(async (command, input) => { const value = await original(command, input); return command === 'sqlite.tableRebuild.preview' ? { ...value, changedPrimaryKey } : value; });
  const call = f.main.request(f.owner, 'sqlite.tableRebuild.preview', { catalogueId: catalogue.catalogueId, changes: [], primaryKeyEdit, taskId: 'pk-preview' });
  if (changedPrimaryKey === true) { expect(await call).toMatchObject({ changedPrimaryKey: true }); expect(f.request.mock.calls.find(([command]) => command === 'sqlite.tableRebuild.preview')![1].primaryKeyEdit).toEqual(primaryKeyEdit); }
  else { await expect(call).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRebuild.release' && input.previewId)).toBe(true); }
  expect(JSON.stringify([...f.saved.values()])).not.toContain('PRIVATE_PK'); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.apply')).toBe(false);
});
it('Main不接受Runtime删掉外键变化计数的回包，准确新预览必须释放', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => { const result = await original(command, input); if (command === 'sqlite.tableRebuild.preview') { delete result.changedForeignKeys; result.changedTypes = 1; } return result; });
  await expect(f.main.request(f.owner, 'sqlite.tableRebuild.preview', { catalogueId: catalogue.catalogueId, changes: [], foreignKeyEdits: [{ kind: 'add', definition: { name: null, columns: ['note'], referencedTable: 'parent', referencedColumns: [], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deferral: 'not-deferrable' } }], taskId: 'fk-preview' })).rejects.toThrow();
  expect(f.request.mock.calls.some(call => call[0] === 'sqlite.tableRebuild.release' && call[1].previewId)).toBe(true);
});
it('目录/SQL只交原文档，路径/字段默认值与SQL不进入持久任务', async () => {
  const f = fixture(), catalogue = await f.inspect(); f.main.assertPublication(f.owner, catalogue, 'sqlite.tableRebuild.inspect'); const preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.tableRebuild.preview'); const result = await f.apply(preview.previewId); expect(result.fact.requestedStatements).toBe(preview.sql.length); expect(result.fact.commitAcknowledged).toBe(true);
  const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_COLUMN', 'filePath', 'DEFAULT', 'defaultSql', 'CREATE TABLE', 'INSERT OR ABORT', '__dbark_rebuild_', '"sql":', 'rebuildNames']) expect(bytes).not.toContain(marker); expect(f.saved.get('apply-task')?.sqliteTableRebuild).toEqual(result.fact);
});
it.each(['filePath', 'profile', 'assertCurrent', 'operationId', 'recordRebuildFact', 'rebuildNames'])('公开输入拒绝私有能力%s，零runtime投递', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.tableRebuild.inspect', { ...f.target, taskId: 'bad', [key]: '不允许' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代拒迟到回包并释放准确能力', async stage => {
  const f = fixture(), catalogue = await f.inspect(), output = stage === 'inspect' ? catalogue : await f.preview(catalogue.catalogueId); f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.tableRebuild.' + stage)).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRebuild.release' && input[stage === 'inspect' ? 'catalogueId' : 'previewId'] === ('catalogueId' in output && stage === 'inspect' ? output.catalogueId : (output as SqliteTableRebuildPreviewOutput).previewId))).toBe(true);
});
it.each(['rotate', 'revise', 'disconnect'] as const)('原来源%s后即使名称相同也不能重领目录预览', async change => {
  const f = fixture(), catalogue = await f.inspect(); f[change](); f.main.observe(); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.preview')).toBe(false);
});
it('另一文档不能预览/释放原目录；释放双编号必须整组核归属', async () => {
  const f = fixture(), catalogue = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.tableRebuild.release', { catalogueId: catalogue.catalogueId })).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.tableRebuild.preview', { catalogueId: catalogue.catalogueId, changes, taskId: 'foreign' })).rejects.toThrow(); expect((await f.preview(catalogue.catalogueId)).target).toEqual(f.target);
});
it.each([false, true])('错误确认/只读在投递前阻止DDL且单次消费预览（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.其它表'); expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.apply')).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('runtime预览SQL替换为另一DDL即拒绝并释放，不能用回包扩大重建权限', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); return command === 'sqlite.tableRebuild.preview' ? { ...output, sql: ['DROP TABLE main.control'] } : output; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRebuild.release' && input.previewId)).toBe(true);
});
it('目录自然到期只阻新领取，不撤已签新预览或已领取长writer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(); vi.setSystemTime(Date.now() + 299999); const preview = await f.preview(catalogue.catalogueId); vi.setSystemTime(Date.now() + 2); f.main.observe(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRebuild.apply') vi.setSystemTime(Date.now() + 300001); return original(command, input); }); expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('目录跨TTL后明确释放仍撤在途preview，晚回不能重签提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!; vi.setSystemTime(Date.now() + 299999); let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableRebuild.preview' ? gate : original(command, input)); const pending = f.preview(catalogue.catalogueId), rejected = expect(pending).rejects.toThrow(); const sentPreview = f.request.mock.calls.find(([command]) => command === 'sqlite.tableRebuild.preview')![1]; const output = await original('sqlite.tableRebuild.preview', sentPreview); vi.setSystemTime(Date.now() + 2); f.main.observe(); await f.main.request(f.owner, 'sqlite.tableRebuild.release', { catalogueId: catalogue.catalogueId }); resolve(output); await rejected; await expect(f.apply(output.previewId)).rejects.toThrow();
});
it('已claim writer不因目录释放假取消，原guard保持且无ACK只能记未知', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; let reject!: (reason: unknown) => void, sent: any; const gate = new Promise<never>((_, no) => { reject = no; });
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRebuild.apply') { sent = input; return gate; } return original(command, input); }); const pending = f.apply(preview.previewId); await f.main.request(f.owner, 'sqlite.tableRebuild.release', { catalogueId: preview.catalogueId }); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toBe(false); reject(Error('没有提交ACK')); expect((await pending).outcome).toBe('unknown');
});
it('未知结果撤目录和兄弟预览，不把未确认回包视为成功或重放', async () => {
  const f = fixture(), one = await f.ready(), two = await f.preview(one.catalogueId, 'second-preview'), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableRebuild.apply') throw Error('传输中断'); return original(command, input); }); expect((await f.apply(one.previewId)).outcome).toBe('unknown'); await expect(f.apply(two.previewId, 'no-replay')).rejects.toThrow(); await expect(f.preview(one.catalogueId, 'no-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableRebuild.apply')).toHaveLength(1);
});
it('取消ACK不能提前释放Main占用，退出等待准确原请求settle', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; }); f.request.mockImplementation(async (command, input) => command === 'sqlite.tableRebuild.inspect' ? gate : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'inspect-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true); resolve(f.catalogue()); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});
it('首份任务持久化失败时零读取/DDL，不留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('写盘拒绝'); }); await expect(f.inspect()).rejects.toThrow('写盘拒绝'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('Main取消快照区分DDL已确认、提交中和未知，不按旧running状态放行', async () => {
  const f = fixture(), preview = await f.ready(), outcome = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  for (const [phase, expected] of [['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished']] as const) {
    const fact: SqliteTableRebuildFact = { ...outcome.fact, phase, commitAcknowledged: phase === 'committed' }; f.tasks.set(task.id, { ...task, status: 'running', sqliteTableRebuild: fact }); expect(taskCancelSnapshot([task.id], f.tasks, () => { throw Error('字段不能借用网络表格写取消状态'); })).toEqual([{ taskId: task.id, state: expected }]);
  }
});

it('Main签发随机候选及验证表四名字且完整重算SQL，预览不能篡改警告或补丁计数', async () => {
  for (const patch of [{ warnings: ['错误宣称转换总能成功'] }, { changedTypes: 2 }, { changedDefaults: 0 }]) {
    const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { const value = await original(command, input); return command === 'sqlite.tableRebuild.preview' ? { ...value, ...patch } : value; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow();
    const sent = f.request.mock.calls.find(([command]) => command === 'sqlite.tableRebuild.preview')![1]; expect(sent.rebuildNames.candidate).toMatch(/^__dbark_rebuild_[a-f0-9]{32}$/); expect(sent.rebuildNames.verificationCandidate).toMatch(/^__dbark_rebuild_[a-f0-9]{32}$/); expect(sent.rebuildNames.ordinal).toMatch(/^__dbark_rebuild_order_[a-f0-9]{32}$/); expect(new Set(Object.values(sent.rebuildNames)).size).toBe(4); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.apply')).toBe(false);
  }
});
it('原inspection独立副本绑定重建计划；调用方改返回目录不改变Main原目标或保留定义', async () => {
  const f = fixture(), catalogue = await f.inspect(); catalogue.tableSql = 'CREATE TABLE changed(note)'; catalogue.columns[1].name = 'changed'; catalogue.relatedObjects.push({ type: 'trigger', name: 'injected', table: f.target.table, sql: 'CREATE TRIGGER injected AFTER INSERT ON subject BEGIN SELECT 1; END' }); expect((await f.preview(catalogue.catalogueId)).sql.some(sql => sql.includes('injected'))).toBe(false);
});
it('事务回包不能补造未记录ACK，即使携带committed与definitionVerified也只能未知且不重放', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => {
    if (command !== 'sqlite.tableRebuild.apply') return original(command, input); const fact: SqliteTableRebuildFact = { operationId: input.operationId, target: f.target, phase: 'committed', requestedStatements: preview.sql.length, completedStatements: preview.sql.length, sourceRows: '3', copiedRows: '3', verifiedRows: '3', commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }; return { operationId: input.operationId, target: f.target, outcome: 'committed', fact, definitionVerified: true, message: '伪造回包' };
  }); const result = await f.apply(preview.previewId); expect(result.outcome).toBe('unknown'); expect(result.fact.commitAcknowledged).toBe(false); expect(result.definitionVerified).toBe(false); await expect(f.apply(preview.previewId, 'retry')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableRebuild.apply')).toHaveLength(1);
});
it('异目标、语句数或行数矛盾回执在同步记录门拒绝，不升级提交或覆盖原计数', async () => {
  for (const patch of [{ target: { connectionId: 'wrong', database: 'main' as const, table: 'wrong' } }, { requestedStatements: 1 }, { sourceRows: '1', copiedRows: '2' }]) {
    const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableRebuild.apply') return original(command, input); input.recordRebuildFact({ operationId: input.operationId, target: f.target, phase: 'writing', requestedStatements: preview.sql.length, completedStatements: 0, sourceRows: '0', copiedRows: '0', verifiedRows: '0', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, ...patch }); throw Error('不应通过原回执门'); });
    const result = await f.apply(preview.previewId); expect(result.outcome).toBe('unknown'); expect(result.fact.target).toEqual(f.target); expect(result.fact.requestedStatements).toBe(preview.sql.length); expect(result.fact.sourceRows).toBe('0'); expect(result.fact.commitAcknowledged).toBe(false);
  }
});
