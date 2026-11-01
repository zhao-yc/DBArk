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
    if (command === 'sqlite.tableRebuild.preview') { input.assertCurrent(); const plan = buildSqliteTableRebuildPlan(catalogue(), input.changes, input.rebuildNames, input.columnOrder); plannedStatements = plan.sql.length; return { previewId: 'preview-' + ++next, catalogueId: input.catalogueId, target, sql: plan.sql, changedTypes: plan.changedTypes, changedDefaults: plan.changedDefaults, ...(plan.changedOrder ? { changedOrder: true } : {}), warnings: plan.warnings, confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
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
  const preview = (catalogueId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableRebuild.preview', { catalogueId, changes: [], columnOrder: ['note', 'id'], taskId }) as Promise<SqliteTableRebuildPreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table) => main.request(owner, 'sqlite.tableRebuild.apply', { previewId, taskId, confirmation }) as Promise<SqliteTableRebuildOutcome>;
  const ready = async () => preview((await inspect()).catalogueId);
  return { main, owner, profile, target, tasks, saved, events, request, save, inspect, preview, apply, ready, catalogue, acknowledged, foreign: () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('Main接受纯列重排并独立完整重算SQL/警告/标志，实际任务只保存原目标及ACK计数', async () => {
  const f = fixture(), catalogue = await f.inspect(), preview = await f.preview(catalogue.catalogueId); f.main.assertPublication(f.owner, preview, 'sqlite.tableRebuild.preview');
  expect(preview).toMatchObject({ changedOrder: true, changedTypes: 0, changedDefaults: 0 }); expect(preview.warnings.join(' ')).toContain('SELECT *');
  const sent = f.request.mock.calls.find(([command]) => command === 'sqlite.tableRebuild.preview')![1]; expect(sent.changes).toEqual([]); expect(sent.columnOrder).toEqual(['note', 'id']); expect(preview.sql).toEqual(buildSqliteTableRebuildPlan(catalogue, [], sent.rebuildNames, ['note', 'id']).sql);
  expect((await f.apply(preview.previewId)).fact).toMatchObject({ phase: 'committed', requestedStatements: preview.sql.length }); const bytes = JSON.stringify([...f.saved.values()]); for (const marker of ['columnOrder', 'changedOrder', 'SELECT *', 'CREATE TABLE', '__dbark_rebuild_', 'PRIVATE_COLUMN_FILE', 'rebuildNames', '"sql":']) expect(bytes).not.toContain(marker);
});

it.each(['sql', 'warnings', 'changedOrder', 'changedTypes', 'changedDefaults'] as const)('Main拒runtime伪造重排%s并准确释放预览，不扩大执行权限', async field => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); if (command !== 'sqlite.tableRebuild.preview') return output; return { ...output, [field]: field === 'sql' ? ['DROP TABLE main.unrelated'] : field === 'warnings' ? ['不应信任的告知'] : field === 'changedOrder' ? undefined : 1 }; });
  await expect(f.preview(catalogue.catalogueId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableRebuild.release' && input.previewId)).toBe(true); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.apply')).toBe(false);
});

it('runtime若使用另一准确排列重算的SQL仍被Main拒绝，不从回包提取目标序', async () => {
  const f = fixture(), catalogue = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { const output = await original(command, input); if (command !== 'sqlite.tableRebuild.preview') return output; const plan = buildSqliteTableRebuildPlan(catalogue, [{ column: 'note', default: { kind: 'null' } }], input.rebuildNames); return { ...output, sql: plan.sql }; }); await expect(f.preview(catalogue.catalogueId)).rejects.toThrow();
});

it.each(['rotate', 'revise', 'disconnect'] as const)('纯重排目录原来源%s换代后拒旧预览且零DDL', async change => {
  const f = fixture(), preview = await f.ready(); f[change](); f.main.observe(); await expect(f.apply(preview.previewId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.apply')).toBe(false);
});

it('纯重排preview一经提交消费不能再次执行，旧publication也不能跨文档冒用', async () => {
  const f = fixture(), preview = await f.ready(); expect(() => f.main.assertPublication(f.foreign(), preview, 'sqlite.tableRebuild.preview')).toThrow();
  const fresh = await f.preview((await f.inspect('second-inspect-task')).catalogueId, 'second-preview-task'); expect((await f.apply(fresh.previewId)).outcome).toBe('committed'); await expect(f.apply(fresh.previewId, '第二次提交')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableRebuild.apply')).toHaveLength(1);
});

it('纯重排拒同序/缺列/重复列，Main独立校验发生在runtime投递前', async () => {
  const f = fixture(), catalogue = await f.inspect();
  for (const columnOrder of [['id', 'note'], ['note'], ['note', 'note'], ['note', 'Id']]) await expect(f.main.request(f.owner, 'sqlite.tableRebuild.preview', { catalogueId: catalogue.catalogueId, changes: [], columnOrder, taskId: '无效序' + columnOrder.join('-') })).rejects.toThrow();
  expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableRebuild.preview')).toBe(false);
});
