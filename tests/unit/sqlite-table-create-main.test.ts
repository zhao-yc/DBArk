import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableCreateMain } from '../../src/main/sqliteTableCreateMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { buildSqliteTableCreate, type SqliteTableCreateDesign, type SqliteTableCreateFact, type SqliteTableCreateOutcome, type SqliteTableCreatePreviewOutput } from '../../src/shared/sqliteTableCreate';
import { recoverSqliteTableCreateTask } from '../../src/shared/sqliteTableCreateFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const design: SqliteTableCreateDesign = { name: '新表🚢', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'note', declaredType: 'TEXT', nullable: true, default: { kind: 'text', value: 'PRIVATE_CREATE_DEFAULT_7328' } }], primaryKey: ['id'], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false };
const clone = <T,>(value: T): T => structuredClone(value);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

/** 仅替换runtime端口，实际Main来源、任务和同步回执逻辑全部执行；不创建数据库或Electron。 */
function fixture(readOnly = false) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'connection', name: '合成连接', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\synthetic\\private.sqlite', readOnly, busyTimeoutMs: 0 } };
  const tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, clone(task)); });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.tableCreate.preview') { input.assertCurrent(); return { previewId: 'preview-' + (++next), target: { connectionId: profile.id, database: 'main', table: input.design.name }, confirmation: 'main.' + input.design.name, expiresAt: new Date(Date.now() + 300000).toISOString(), sql: buildSqliteTableCreate(input.design).sql, warnings: [] }; }
    if (command === 'sqlite.tableCreate.apply') return committed(input);
  });
  const main = new SqliteTableCreateMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档失效'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(clone(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: persistedTaskMessage(task.kind, event) }; tasks.set(task.id, next); save(next); } },
  });
  const preview = (taskId = 'preview-task') => main.request(owner, 'sqlite.tableCreate.preview', { connectionId: profile.id, database: 'main', design: clone(design), taskId }) as Promise<SqliteTableCreatePreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + design.name) => main.request(owner, 'sqlite.tableCreate.apply', { previewId, taskId, confirmation }) as Promise<SqliteTableCreateOutcome>;
  /** 合成runtime只回放固定阶段；真实事务/COMMIT丢失场景由native backend独立验证。 */
  function committed(input: any) {
    const target = { connectionId: profile.id, database: 'main' as const, table: design.name };
    let fact: SqliteTableCreateFact = { operationId: input.operationId, target, phase: 'not-sent', requestedStatements: 1, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', completedStatements: 1 }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteTableCreateFact>[]) { fact = { ...fact, ...patch }; input.recordCreateFact(fact); }
    return { operationId: input.operationId, target, outcome: 'committed', fact, definitionVerified: true, message: '固定事务确认' };
  }
  return { main, owner, profile, tasks, saved, events, save, request, preview, apply, committed, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, closing() { closing = true; } };
}

it('预览只传原Main guard、生成SQL仅在回包内，任务持久值没有默认值/SQL/路径', async () => {
  const f = fixture(), preview = await f.preview(); f.main.assertPublication(f.owner, preview);
  expect(f.request.mock.calls.map(call => call[0])).toEqual(['sqlite.tableCreate.preview']);
  expect(f.request.mock.calls[0][1].assertCurrent).toBeTypeOf('function'); expect(preview.sql.join()).toContain('PRIVATE_CREATE_DEFAULT_7328');
  const records = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_CREATE_DEFAULT_7328', 'CREATE TABLE', 'private.sqlite']) expect(records).not.toContain(marker);
});
it.each(['revision', 'epoch', 'document', 'closing'] as const)('来源%s变化后预览永久撤销，不把旧预览交给新目标', async reason => {
  const f = fixture(), preview = await f.preview();
  if (reason === 'revision') f.revise(); else if (reason === 'epoch') f.disconnect(); else if (reason === 'document') f.rotate(); else f.closing();
  f.main.observe(); await expect(f.apply(preview.previewId)).rejects.toThrow();
  expect(f.request.mock.calls.filter(call => call[0] === 'sqlite.tableCreate.apply')).toHaveLength(0);
  expect(f.request.mock.calls).toContainEqual(['sqlite.tableCreate.release', { previewId: preview.previewId }]);
});
it('最终IPC发布门会拒绝已完成Main请求后才发生的连接变化', async () => {
  const f = fixture(), preview = await f.preview(); f.revise(); expect(() => f.main.assertPublication(f.owner, preview)).toThrow();
  await expect(f.apply(preview.previewId)).rejects.toThrow(); expect(f.request.mock.calls.filter(call => call[0] === 'sqlite.tableCreate.apply')).toHaveLength(0);
});
it('到期回执不能发布或提交，且其他文档无法释放或消费原令牌', async () => {
  vi.useFakeTimers(); const f = fixture(), preview = await f.preview(), foreign = { owner: { document: {}, contents: new EventEmitter() } } as ColumnsInvocation;
  await expect(f.main.request(foreign, 'sqlite.tableCreate.release', { previewId: preview.previewId })).rejects.toThrow();
  vi.advanceTimersByTime(300001); expect(() => f.main.assertPublication(f.owner, preview)).toThrow(); await expect(f.apply(preview.previewId)).rejects.toThrow();
});
it('只读连接可预览，强行apply也在runtime前拒绝，保not-sent回执且单次消费', async () => {
  const f = fixture(true), preview = await f.preview(), result = await f.apply(preview.previewId);
  expect(result.outcome).toBe('not-sent'); expect(result.fact.completedStatements).toBe(0); expect(result.message).toContain('只读');
  expect(f.request.mock.calls.filter(call => call[0] === 'sqlite.tableCreate.apply')).toHaveLength(0); await expect(f.apply(preview.previewId, 'second')).rejects.toThrow();
});
it('创建仅Main随机operation及回调可记真实阶段，提交成功不再消费旧预览或复用任务ID', async () => {
  const f = fixture(), preview = await f.preview(), result = await f.apply(preview.previewId);
  expect(result.outcome).toBe('committed'); expect(result.fact.commitAcknowledged).toBe(true); expect(result.definitionVerified).toBe(true);
  expect(f.saved.get('apply-task')?.sqliteCreate).toEqual(result.fact); expect(f.tasks.get('apply-task')?.status).toBe('completed');
  expect(result.operationId).toMatch(/^[a-f0-9-]{36}$/); await expect(f.apply(preview.previewId, 'retry')).rejects.toThrow();
  await expect(f.preview('apply-task')).rejects.toThrow('编号');
  for (const marker of ['PRIVATE_CREATE_DEFAULT_7328', 'CREATE TABLE', 'private.sqlite']) expect(JSON.stringify([...f.saved.values()])).not.toContain(marker);
});
it('错误确认在分发前单次消费并保准确not-sent，不冒称提交未知或发送runtime apply', async () => {
  const f = fixture(), preview = await f.preview(), result = await f.apply(preview.previewId, 'wrong-confirm', 'main.other');
  expect(result.outcome).toBe('not-sent'); expect(result.fact.phase).toBe('not-sent'); expect(result.fact.completedStatements).toBe(0); expect(result.message).toContain('确认不匹配');
  expect(f.request.mock.calls.filter(call => call[0] === 'sqlite.tableCreate.apply')).toHaveLength(0);
  expect(f.request.mock.calls).toContainEqual(['sqlite.tableCreate.release', { previewId: preview.previewId }]); await expect(f.apply(preview.previewId, 'try-again')).rejects.toThrow();
});
it('最初概要保存失败也结束Main任务占用，不能留running或开始runtime写入', async () => {
  const f = fixture(), preview = await f.preview(); f.save.mockImplementationOnce(() => { throw Error('合成本地概要落盘失败'); });
  await expect(f.apply(preview.previewId)).rejects.toThrow('概要落盘'); expect(f.tasks.get('apply-task')?.status).toBe('failed'); expect(f.main.owns('apply-task')).toBe(false);
  expect(f.request.mock.calls.filter(call => call[0] === 'sqlite.tableCreate.apply')).toHaveLength(0); expect(f.request.mock.calls).toContainEqual(['sqlite.tableCreate.release', { previewId: preview.previewId }]);
});
it('提交ACK后runtime传输失败仍保committed且不伪造定义核验，不把写操作变成可重试失败', async () => {
  const f = fixture(), preview = await f.preview(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableCreate.apply') return original(command, input); f.committed(input); throw Error('ACK后连接关闭原错PRIVATE_CREATE_DEFAULT_7328'); });
  const result = await f.apply(preview.previewId); expect(result.outcome).toBe('committed'); expect(result.definitionVerified).toBe(false); expect(result.cleanupWarning).toBe(true); expect(f.tasks.get('apply-task')?.status).toBe('completed'); expect(JSON.stringify([...f.saved.values()])).not.toContain('PRIVATE_CREATE_DEFAULT_7328');
});
it('伪造其他操作ACK不能补造当前建表成功；原未确认请求保未知且不重放', async () => {
  const f = fixture(), preview = await f.preview(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableCreate.apply') return original(command, input); const value = f.committed(input); return { ...value, operationId: 'foreign-operation' }; });
  const result = await f.apply(preview.previewId); expect(result.outcome).toBe('committed'); expect(result.definitionVerified).toBe(false); // 原Main自身ACK真实存在，伪回包不提升核验。
  const g = fixture(), second = await g.preview(), request = g.request.getMockImplementation()!;
  g.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableCreate.apply') return request(command, input); throw Error('未确认传输'); });
  const unknown = await g.apply(second.previewId); expect(unknown.outcome).toBe('unknown'); expect(unknown.fact.commitAcknowledged).toBe(false); await expect(g.apply(second.previewId, 'repeat')).rejects.toThrow();
});
it('同步COMMIT前持久回调失败会向runtime抛出，真实回滚事实可纠正commit-pending并保设计', async () => {
  const f = fixture(), preview = await f.preview(), original = f.request.getMockImplementation()!, save = f.save.getMockImplementation()!;
  f.save.mockImplementation(task => { if (task.sqliteCreate?.phase === 'commit-pending') throw Error('合成落盘失败'); save(task); });
  f.request.mockImplementation(async (command, input) => {
    if (command !== 'sqlite.tableCreate.apply') return original(command, input);
    try { f.committed(input); throw Error('本例不能走到COMMIT'); } catch (error) { expect((error as Error).message).toBe('合成落盘失败'); }
    const previous = f.tasks.get('apply-task')!.sqliteCreate!, fact: SqliteTableCreateFact = { ...previous, phase: 'rolled-back', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true }; input.recordCreateFact(fact);
    return { operationId: input.operationId, target: fact.target, outcome: 'rolled-back', fact, definitionVerified: false, message: '原事务已回滚' };
  });
  const result = await f.apply(preview.previewId); expect(result.outcome).toBe('rolled-back'); expect(result.fact.rollbackAcknowledged).toBe(true); expect(result.fact.commitMayHaveBeenSent).toBe(false);
});
it('取消只停原文档的在途请求，迟到预览不能越过取消并且原能力会释放', async () => {
  const f = fixture(), gate = deferred<any>(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableCreate.preview' ? gate.promise : original(command, input));
  const pending = f.preview(); const rejected = expect(pending).rejects.toThrow('取消');
  await f.main.cancel(f.owner, 'preview-task'); gate.resolve({ previewId: 'late-preview' }); await rejected;
  expect(f.request.mock.calls).toContainEqual(['query.cancel', { taskId: 'preview-task' }]); expect(f.request.mock.calls).toContainEqual(['sqlite.tableCreate.release', { previewId: 'late-preview' }]); expect(f.main.owns('preview-task')).toBe(false);
});
it('退出drain等待原Main操作settled，不能仅因取消已应答便提前关存储', async () => {
  const f = fixture(), gate = deferred<any>(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableCreate.preview' ? gate.promise : original(command, input));
  const pending = f.preview(); const rejected = expect(pending).rejects.toThrow(); let closed = false; const drain = f.main.drain().then(() => { closed = true; }); await Promise.resolve(); await Promise.resolve(); expect(closed).toBe(false);
  gate.resolve({ previewId: 'quit-late-preview' }); await rejected; await drain; expect(closed).toBe(true); expect(f.main.owns('preview-task')).toBe(false);
});
it('重启清除额外设计/SQL/错误字段，在途变未知，已确认回执优先恢复', async () => {
  const f = fixture(), preview = await f.preview(), result = await f.apply(preview.previewId), original = f.tasks.get('apply-task')!;
  const poisoned = { ...original, status: 'running' as const, errors: ['PRIVATE_CREATE_DEFAULT_7328'], design, sql: 'CREATE TABLE private' };
  const restored = recoverSqliteTableCreateTask(poisoned); expect(restored.status).toBe('completed'); expect(restored.sqliteCreate?.commitAcknowledged).toBe(true); expect(JSON.stringify(restored)).not.toContain('PRIVATE_CREATE_DEFAULT_7328'); expect(restored).not.toHaveProperty('sql'); expect(restored).not.toHaveProperty('design'); expect(restored).not.toHaveProperty('errors');
  const unknown = recoverSqliteTableCreateTask({ ...original, sqliteCreate: { ...result.fact, phase: 'commit-pending', commitAcknowledged: false }, status: 'running' }); expect(unknown.status).toBe('failed'); expect(unknown.sqliteCreate?.phase).toBe('unknown');
});
it.each([['not-sent', 'allowed'], ['writing', 'allowed'], ['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished'], ['rolled-back', 'finished']] as const)('Main根据原建表%s事实给取消状态%s，语句数不当作提交证明', async (phase, state) => {
  const f = fixture(), preview = await f.preview(), result = await f.apply(preview.previewId);
  const receipt: SqliteTableCreateFact = { ...result.fact, phase, completedStatements: phase === 'not-sent' ? 0 : 1, commitMayHaveBeenSent: ['commit-pending', 'unknown', 'committed'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' };
  f.tasks.set('apply-task', { ...f.tasks.get('apply-task')!, status: 'running', sqliteCreate: receipt });
  const unrelated = vi.fn(() => 'allowed' as const); expect(taskCancelSnapshot(['apply-task'], f.tasks, unrelated)).toEqual([{ taskId: 'apply-task', state }]); expect(unrelated).not.toHaveBeenCalled();
});

/** 原生产分派函数整体执行，跨本地/数据库任务编号冲突不能被新快捷路由绕过。 */
function productionDispatch(busy?: string) {
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch'); if (!fn) throw Error('缺少实际Main分派');
  const request = vi.fn(async (_owner: ColumnsInvocation, _command: string, _input: unknown) => undefined), owner = fixture().owner;
  const port = { tasks: new Map(busy === 'tasks' ? [['shared-id', {}]] : []), completionTasks: new Set(busy === 'completion' ? ['shared-id'] : []), savedQueryPages: { owns: (id: string) => busy === 'savedQuery' && id === 'shared-id' }, historyPages: { owns: (id: string) => busy === 'historyPages' && id === 'shared-id' }, historyDelete: { owns: (id: string) => busy === 'historyDelete' && id === 'shared-id' }, sqliteTableCreates: { request }, Error };
  const run = runInNewContext(ts.transpileModule(fn.getText(tree) + '\ndispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port) as (command: string, input: unknown, owner: ColumnsInvocation) => Promise<unknown>;
  return { request, run: (command: string, input: unknown) => run(command, input, owner) };
}
it.each(['tasks', 'completion', 'savedQuery', 'historyPages', 'historyDelete'])('生产Main分派拒绝与%s的原在途编号相撞，零建表协调器/引擎请求', async ledger => {
  const f = productionDispatch(ledger); await expect(f.run('sqlite.tableCreate.preview', { taskId: 'shared-id' })).rejects.toThrow('编号'); await expect(f.run('sqlite.tableCreate.apply', { taskId: 'shared-id' })).rejects.toThrow('编号'); expect(f.request).not.toHaveBeenCalled();
});
it('生产Main新编号只转原协调器一次；纯release没有编号且可越过其它任务占用', async () => {
  const f = productionDispatch('completion'); await f.run('sqlite.tableCreate.preview', { taskId: 'fresh' }); await f.run('sqlite.tableCreate.release', { previewId: 'preview' }); expect(f.request.mock.calls.map(call => call[1])).toEqual(['sqlite.tableCreate.preview', 'sqlite.tableCreate.release']);
});
