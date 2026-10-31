import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableImportMain } from '../../src/main/sqliteTableImportMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SelectedFile } from '../../src/main/fileTokens';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import { buildSqliteTableImportInsert, sqliteTableImportIssue, type SqliteTableImportInspectOutput, type SqliteTableImportPreviewOutput, type SqliteTableImportOutcome } from '../../src/shared/sqliteTableImport';
import { recoverSqliteImportTask, sqliteImportFactMessage } from '../../src/shared/sqliteTableImportFact';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { taskCancelSnapshot } from '../../src/main/taskCancelState';

afterEach(() => vi.useRealTimers());
const clone = <T,>(value: T): T => structuredClone(value);
const mapping = [{ source: '内容', target: 'note', kind: 'text' as const }];
/** 私有端口保留真实Main来源/回执逻辑；实际文件和事务另由backend/native覆盖。 */
function fixture(readOnly = false, records = 777) {
  let document = {}, revision = 1, epoch = {}, closing = false, next = 0;
  const owner = { owner: { document, contents: new EventEmitter() } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '合成SQLite', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/target.sqlite', readOnly, busyTimeoutMs: 0 } };
  let file: SelectedFile = { path: 'D:/synthetic/PRIVATE_IMPORT_FILE.csv', purpose: 'import', format: 'csv' };
  const target = { connectionId: profile.id, database: 'main' as const, table: '对象🚢' }, source = { sha256: 'a'.repeat(64), bytes: 200 };
  const tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [];
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, clone(task)); });
  const inspection = (): SqliteTableImportInspectOutput => ({ inspectionId: 'inspection-' + ++next, target, source, records, sourceColumns: ['内容'], sample: records ? [{ 内容: 'PRIVATE_IMPORT_SOURCE_7821' }] : [], sampleOmitted: records > 1, columns: [{ name: 'note', declaredType: 'TEXT', nullable: true, hasDefault: false, generated: false, affinity: 'text' }], strict: false, readOnly, expiresAt: new Date(Date.now() + 300000).toISOString() });
  const report = { checkedRecords: records, validRecords: records, invalidRecords: 0, issueCount: 0, issues: [], truncated: false, complete: true };
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.tableImport.inspect') { input.assertCurrent(); return inspection(); }
    if (command === 'sqlite.tableImport.preview') { input.assertCurrent(); return { ok: true, inspectionId: input.inspectionId, previewId: 'preview-' + ++next, target, source, records, report, warnings: [], sql: buildSqliteTableImportInsert(target.table, input.mapping.map((item: typeof mapping[number]) => item.target)), confirmation: 'main.' + target.table, expiresAt: new Date(Date.now() + 300000).toISOString() }; }
    if (command === 'sqlite.tableImport.apply') return committed(input);
  });
  const main = new SqliteTableImportMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    file(token, format) { if (token !== 'selected-source' || file.purpose !== 'import' || file.format !== format) throw Error('来源文件未授权'); return file; },
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(clone(event)); const task = tasks.get(event.taskId); if (task) { const next = { ...task, status: event.status, progress: event.progress, message: task.sqliteWrite ? sqliteImportFactMessage(task.sqliteWrite) : persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, clone(next)); } },
  });
  const inspect = (taskId = 'inspect-task') => main.request(owner, 'sqlite.tableImport.inspect', { ...target, fileToken: 'selected-source', format: 'csv', encoding: 'utf8', taskId }) as Promise<SqliteTableImportInspectOutput>;
  const preview = (inspectionId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableImport.preview', { inspectionId, mapping: clone(mapping), taskId }) as Promise<SqliteTableImportPreviewOutput>;
  const apply = (previewId: string, taskId = 'apply-task', confirmation = 'main.' + target.table) => main.request(owner, 'sqlite.tableImport.apply', { previewId, taskId, confirmation }) as Promise<SqliteTableImportOutcome>;
  /** 模拟原runtime阶段回调；不会用回包补造Main尚未记录的提交ACK。 */
  function committed(input: any): SqliteTableImportOutcome {
    input.assertCurrent(); let fact: SqliteWriteFact = { operationId: input.operationId, target, phase: 'not-sent', requestedRows: records, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const patch of [{}, { phase: 'writing' }, { phase: 'writing', appliedRows: records }, { phase: 'commit-pending', commitMayHaveBeenSent: true }, { phase: 'committed', commitAcknowledged: true }] as Partial<SqliteWriteFact>[]) { fact = { ...fact, ...patch }; input.recordWriteFact(fact); }
    return { operationId: input.operationId, target, outcome: 'committed', counts: { insert: records, update: 0, delete: 0 }, fact, message: '确认提交' };
  }
  const ready = async () => { const inspected = await inspect(), result = await preview(inspected.inspectionId); if (!result.ok) throw Error('夹具预检未通过'); return result; };
  return { main, owner, profile, target, source, tasks, saved, events, save, request, inspection, inspect, preview, apply, ready, committed, report, file: () => file, replaceFile(value = { ...file }) { file = value; }, rotate() { document = {}; }, revise() { revision++; }, disconnect() { epoch = {}; }, close() { closing = true; } };
}

it('文件路径只由Main注入；有界检查回包与样本不进入任务持久记录', async () => {
  const f = fixture(), inspected = await f.inspect(); f.main.assertPublication(f.owner, inspected, 'sqlite.tableImport.inspect');
  expect(f.request.mock.calls[0][1].filePath).toBe(f.file().path); expect(f.request.mock.calls[0][1].assertCurrent).toBeTypeOf('function');
  const disk = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_IMPORT_FILE', 'PRIVATE_IMPORT_SOURCE', f.source.sha256, 'filePath', 'mapping']) expect(disk).not.toContain(marker);
});
it.each(['inspect', 'preview'] as const)('最终%s发布前连接换代，拒绝回包并回收准确原能力', async stage => {
  const f = fixture(), inspected = await f.inspect(), output = stage === 'inspect' ? inspected : await f.preview(inspected.inspectionId);
  f.revise(); expect(() => f.main.assertPublication(f.owner, output, 'sqlite.tableImport.' + stage)).toThrow();
  const id = stage === 'inspect' ? inspected.inspectionId : 'previewId' in output ? output.previewId : undefined;
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input[stage === 'inspect' ? 'inspectionId' : 'previewId'] === id)).toBe(true);
});
it.each(['filePath', 'profile', 'operationId', 'recordWriteFact', 'assertCurrent'])('公开inspect拒绝夹带私有字段%s，零runtime请求', async key => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.tableImport.inspect', { ...f.target, fileToken: 'selected-source', format: 'csv', encoding: 'utf8', taskId: 'bad', [key]: '/untrusted' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it('来源用途不匹配和来源就是目标库/日志在开始读取前拒绝', async () => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) { const f = fixture(); f.replaceFile({ ...f.file(), path: f.profile.sqlite.filePath! + suffix }); await expect(f.inspect()).rejects.toThrow('来源不能'); expect(f.request).not.toHaveBeenCalled(); }
  const f = fixture(); f.replaceFile({ ...f.file(), purpose: 'export' }); await expect(f.inspect()).rejects.toThrow('未授权'); expect(f.request).not.toHaveBeenCalled();
});
it.each(['revise', 'disconnect', 'rotate', 'replaceFile'] as const)('检查后%s使旧能力失效，即使同一路径/连接文字不变也不能领新预览', async change => {
  const f = fixture(), inspected = await f.inspect(); f[change](); await expect(f.preview(inspected.inspectionId)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.preview')).toHaveLength(0);
});
it('文件选择对象即使原地改路径也不能继承旧检查能力', async () => {
  const f = fixture(), inspected = await f.inspect(); f.file().path = 'D:/synthetic/another.csv'; await expect(f.preview(inspected.inspectionId)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.preview')).toHaveLength(0);
});
it('另一文档不能预检、释放或取消原检查；所有能力先整组核归属', async () => {
  const f = fixture(), inspected = await f.inspect(), foreign = { owner: { document: {}, contents: new EventEmitter() } } as ColumnsInvocation;
  await expect(f.main.request(foreign, 'sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping, taskId: 'foreign' })).rejects.toThrow();
  await expect(f.main.request(foreign, 'sqlite.tableImport.release', { inspectionId: inspected.inspectionId })).rejects.toThrow();
  const result = await f.preview(inspected.inspectionId); expect(result.ok).toBe(true);
});
it('超过500行的导入事实走独立预算，原精度/文件内容不入任务概要', async () => {
  const f = fixture(false, 1001), preview = await f.ready(), result = await f.apply(preview.previewId);
  expect(result.fact).toMatchObject({ phase: 'committed', requestedRows: 1001, appliedRows: 1001, commitAcknowledged: true }); expect(f.saved.get('apply-task')?.sqliteWrite).toEqual(result.fact);
  expect(JSON.stringify([...f.saved.values()])).not.toContain('PRIVATE_IMPORT');
  const persisted = f.save.mock.calls.filter(([task]) => task.id === 'apply-task').map(([task]) => task.sqliteWrite?.phase);
  expect(persisted).toContain('not-sent'); expect(persisted).toContain('commit-pending'); expect(persisted).toContain('committed'); expect(persisted.filter(phase => phase === 'writing')).toHaveLength(1);
});
it.each([false, true])('错误确认或只读在Main发写前准确记录not-sent，且原预览单次消费（只读=%s）', async readOnly => {
  const f = fixture(readOnly), preview = await f.ready(), result = await f.apply(preview.previewId, 'apply-task', readOnly ? preview.confirmation : 'main.错误对象');
  expect(result.outcome).toBe('not-sent'); expect(result.fact.commitMayHaveBeenSent).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0);
  await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('完整预检返回有界失败报告时没有apply能力，最终发布仍核原连接', async () => {
  const f = fixture(), inspected = await f.inspect(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? { ok: false, inspectionId: inspected.inspectionId, target: f.target, source: f.source, records: 777, warnings: [], report: { checkedRecords: 777, validRecords: 776, invalidRecords: 1, issueCount: 1, issues: [sqliteTableImportIssue('invalid-value', { record: 777 })], truncated: false, complete: true } } : original(command, input));
  const result = await f.preview(inspected.inspectionId); expect(result.ok).toBe(false); f.revise(); await expect(() => f.main.assertPublication(f.owner, result, 'sqlite.tableImport.preview')).toThrow();
  await expect(f.apply('made-up')).rejects.toThrow();
});
it('预览只能发布原source摘要、数量和固定INSERT OR ABORT模板', async () => {
  for (const property of ['source', 'records', 'sql'] as const) {
    const f = fixture(), inspected = await f.inspect(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (command, input) => { const value = await original(command, input); if (command === 'sqlite.tableImport.preview') value[property] = property === 'source' ? { ...f.source, sha256: 'b'.repeat(64) } : property === 'records' ? 778 : 'INSERT OR REPLACE INTO evil VALUES (?)'; return value; });
    await expect(f.preview(inspected.inspectionId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.tableImport.release')).toBe(true);
  }
});
it('apply领取前TTL过期拒绝，已领取的长事务不因5分钟预览期限被取消', async () => {
  vi.useFakeTimers(); const f = fixture(), preview = await f.ready(); vi.advanceTimersByTime(300001); await expect(f.apply(preview.previewId)).rejects.toThrow();
  const fresh = fixture(), current = await fresh.ready(), original = fresh.request.getMockImplementation()!;
  fresh.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableImport.apply') { vi.advanceTimersByTime(300001); input.assertCurrent(); } return original(command, input); });
  expect((await fresh.apply(current.previewId)).outcome).toBe('committed');
});
it('父检查自然过期只回收自己的领取资格，不级联撤销独立期限内的新预览', async () => {
  vi.useFakeTimers(); const f = fixture(), inspected = await f.inspect(); vi.advanceTimersByTime(299999); const preview = await f.preview(inspected.inspectionId); if (!preview.ok) throw Error('夹具预检未通过');
  vi.advanceTimersByTime(2); f.main.observe(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.release')).toHaveLength(0);
  expect((await f.apply(preview.previewId)).outcome).toBe('committed');
});
it('显式释放父检查同步撤子预览，不能把失效runtime能力误当成待发送写入', async () => {
  const f = fixture(), preview = await f.ready(); await f.main.request(f.owner, 'sqlite.tableImport.release', { inspectionId: preview.inspectionId });
  await expect(f.apply(preview.previewId)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0);
});
it('父检查已自然过期后仍可明确释放自己独立期限内的子预览', async () => {
  vi.useFakeTimers(); const f = fixture(), inspected = await f.inspect(); vi.advanceTimersByTime(299999); const preview = await f.preview(inspected.inspectionId); if (!preview.ok) throw Error('夹具预检未通过');
  vi.advanceTimersByTime(2); f.main.observe(); await f.main.request(f.owner, 'sqlite.tableImport.release', { inspectionId: inspected.inspectionId });
  await expect(f.apply(preview.previewId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.previewId === preview.previewId)).toBe(true);
});
it('预检运行期间释放检查立即撤原来源，晚回不能重新签发子预览', async () => {
  const f = fixture(), inspected = await f.inspect(), original = f.request.getMockImplementation()!; let resume!: (value: unknown) => void;
  const delayed = new Promise<unknown>(resolve => { resume = resolve; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? delayed : original(command, input));
  const pending = f.preview(inspected.inspectionId), rejected = expect(pending).rejects.toThrow(); const output = await original('sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping, assertCurrent() {} });
  await f.main.request(f.owner, 'sqlite.tableImport.release', { inspectionId: inspected.inspectionId }); resume(output); await rejected;
  await expect(f.apply(output.previewId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.previewId === output.previewId)).toBe(true);
});
it('检查晚回遇到原文档导航，释放准确检查能力而不发布样本', async () => {
  const f = fixture(); let resume!: (value: SqliteTableImportInspectOutput) => void;
  const delayed = new Promise<SqliteTableImportInspectOutput>(resolve => { resume = resolve; });
  f.request.mockImplementation(async command => command === 'sqlite.tableImport.inspect' ? delayed : undefined);
  const pending = f.inspect(), output = f.inspection(); f.rotate(); resume(output); await expect(pending).rejects.toThrow();
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.release').map(([, input]) => input)).toEqual([{ inspectionId: output.inspectionId }]);
});
it('取消和退出等待原检查真正settle，不因取消ACK先到就释放Main生命周期', async () => {
  const f = fixture(); let resume!: (value: SqliteTableImportInspectOutput) => void;
  const delayed = new Promise<SqliteTableImportInspectOutput>(resolve => { resume = resolve; });
  f.request.mockImplementation(async command => command === 'sqlite.tableImport.inspect' ? delayed : undefined);
  const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(), output = f.inspection(); await f.main.cancel(f.owner, 'inspect-task');
  let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('inspect-task')).toBe(true);
  resume(output); await rejected; await draining; expect(f.main.owns('inspect-task')).toBe(false); expect(f.tasks.get('inspect-task')?.status).toBe('cancelled');
});
it('首次任务持久化失败不发起runtime工作，也不留下运行中假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('合成存储拒绝'); }); await expect(f.inspect()).rejects.toThrow('存储'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('inspect-task')?.status).toBe('failed');
});
it('最终传输或保存后异常不能撤回已由Main记录的真实提交ACK', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableImport.apply') { f.committed(input); throw Error('PRIVATE_IMPORT_TRANSPORT'); } return original(command, input); });
  const result = await f.apply(preview.previewId); expect(result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); expect(f.tasks.get('apply-task')?.status).toBe('completed'); expect(JSON.stringify([...f.saved.values()])).not.toContain('PRIVATE_IMPORT');
});
it('没有Main原提交回调的伪造成功回包不能证明提交，准确操作保未知且不重放', async () => {
  const f = fixture(), preview = await f.ready(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (command, input) => { if (command !== 'sqlite.tableImport.apply') return original(command, input); const quiet = { ...input, recordWriteFact() {} }; return f.committed(quiet); });
  const result = await f.apply(preview.previewId); expect(result.outcome).toBe('unknown'); expect(result.fact.commitAcknowledged).toBe(false); await expect(f.apply(preview.previewId, 'again')).rejects.toThrow();
});
it('已提交后Main与runtime同步撤原检查及未领取的其它预览，旧来源不能伪成新unknown写任务', async () => {
  const f = fixture(), inspected = await f.inspect(), first = await f.preview(inspected.inspectionId), second = await f.preview(inspected.inspectionId, 'second-preview');
  if (!first.ok || !second.ok) throw Error('夹具预检未通过'); expect((await f.apply(first.previewId)).outcome).toBe('committed');
  await expect(f.apply(second.previewId, 'second-apply')).rejects.toThrow(); await expect(f.preview(inspected.inspectionId, 'again-preview')).rejects.toThrow();
  expect(f.tasks.has('second-apply')).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(1);
});
it('重启恢复超过500行的真实回执，未知不重放；多余SQL及值字段被剔除', async () => {
  const f = fixture(false, 1001), preview = await f.ready(), result = await f.apply(preview.previewId), task = f.tasks.get('apply-task')!;
  const restored = recoverSqliteImportTask({ ...task, errors: ['PRIVATE_IMPORT_ERROR'], extra: 'PRIVATE_IMPORT_SOURCE' } as TaskRecord); expect(restored.sqliteWrite).toEqual(result.fact); expect(restored.status).toBe('completed'); expect(JSON.stringify(restored)).not.toContain('PRIVATE_IMPORT');
  const interrupted = recoverSqliteImportTask({ ...task, status: 'running', sqliteWrite: { ...result.fact, phase: 'commit-pending', commitAcknowledged: false } }); expect(interrupted.status).toBe('failed'); expect(interrupted.sqliteWrite?.phase).toBe('unknown');
});
it.each([['not-sent', 'allowed'], ['writing', 'allowed'], ['commit-pending', 'confirming'], ['unknown', 'confirming'], ['committed', 'finished'], ['rolled-back', 'finished']] as const)('原Main导入%s事实取消状态为%s，不以处理条数授权', async (phase, state) => {
  const f = fixture(), preview = await f.ready(), result = await f.apply(preview.previewId);
  f.tasks.set('apply-task', { ...f.tasks.get('apply-task')!, status: 'running', sqliteWrite: { ...result.fact, phase, appliedRows: phase === 'not-sent' ? 0 : 777, commitMayHaveBeenSent: ['commit-pending', 'unknown', 'committed'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' } });
  expect(taskCancelSnapshot(['apply-task'], f.tasks, () => 'allowed')).toEqual([{ taskId: 'apply-task', state }]);
});

/** 执行完整生产Main分派，不通过复制门逻辑来证明新命令编号隔离。 */
function productionDispatch(busy?: string) {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch'); if (!fn) throw Error('缺少生产Main分派');
  const request = vi.fn(async (_owner: ColumnsInvocation, _command: string, _input: unknown) => undefined), owner = fixture().owner;
  const ports = { tasks: new Map(busy === 'tasks' ? [['shared-id', {}]] : []), completionTasks: new Set(busy === 'completion' ? ['shared-id'] : []), savedQueryPages: { owns: (id: string) => busy === 'savedQuery' && id === 'shared-id' }, historyPages: { owns: (id: string) => busy === 'historyPages' && id === 'shared-id' }, historyDelete: { owns: (id: string) => busy === 'historyDelete' && id === 'shared-id' }, sqliteTableImports: { request }, Error };
  const run = runInNewContext(ts.transpileModule(fn.getText(tree) + '\ndispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ports) as (command: string, input: unknown, owner: ColumnsInvocation) => Promise<unknown>;
  return { request, run: (command: string, input: unknown) => run(command, input, owner) };
}
it.each(['tasks', 'completion', 'savedQuery', 'historyPages', 'historyDelete'])('生产分派拒绝导入与%s的任务编号相撞', async busy => {
  const f = productionDispatch(busy); await expect(f.run('sqlite.tableImport.inspect', { taskId: 'shared-id' })).rejects.toThrow('编号'); await expect(f.run('sqlite.tableImport.apply', { taskId: 'shared-id' })).rejects.toThrow('编号'); expect(f.request).not.toHaveBeenCalled();
});
it('生产分派对新导入编号只调用原协调器，release无需编号且不受他任务占用', async () => {
  const f = productionDispatch('completion'); await f.run('sqlite.tableImport.inspect', { taskId: 'fresh' }); await f.run('sqlite.tableImport.release', { inspectionId: 'owned' }); expect(f.request.mock.calls.map(call => call[1])).toEqual(['sqlite.tableImport.inspect', 'sqlite.tableImport.release']);
});


it('父检查自然TTL移表后显式release仍撤在途预检，晚回不能重新签发可提交能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), inspected = await f.inspect(), original = f.request.getMockImplementation()!;
  vi.setSystemTime(Date.now() + 299999); let resume!: (value: SqliteTableImportPreviewOutput) => void;
  const delayed = new Promise<SqliteTableImportPreviewOutput>(resolve => { resume = resolve; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? delayed : original(command, input));
  const pending = f.preview(inspected.inspectionId, 'ttl-held-preview'), rejected = expect(pending).rejects.toThrow();
  vi.setSystemTime(Date.now() + 2); f.main.observe(); expect(f.main.owns('ttl-held-preview')).toBe(true);
  // 独立自然TTL不提前中断原扫描，但显式释放必须撤销仍被该扫描强引用的父检查。
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.release')).toHaveLength(0);
  await f.main.request(f.owner, 'sqlite.tableImport.release', { inspectionId: inspected.inspectionId });
  const late: SqliteTableImportPreviewOutput = await original('sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping: clone(mapping), assertCurrent() {} });
  if (!late.ok) throw Error('夹具必须给出有界成功预检回包以验证Main拒绝晚发布'); resume(late); await rejected;
  expect(() => f.main.assertPublication(f.owner, late, 'sqlite.tableImport.preview')).toThrow();
  await expect(f.apply(late.previewId, 'ttl-released-cannot-apply')).rejects.toThrow(); expect(f.tasks.has('ttl-released-cannot-apply')).toBe(false);
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.previewId === late.previewId)).toBe(true);
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0); expect(f.main.owns('ttl-held-preview')).toBe(false);
});

it('父检查自然TTL移表后其它文档不能释放在途预检，原owner仍可正常发布及明确提交', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), inspected = await f.inspect(), original = f.request.getMockImplementation()!;
  vi.setSystemTime(Date.now() + 299999); let resume!: (value: SqliteTableImportPreviewOutput) => void;
  const delayed = new Promise<SqliteTableImportPreviewOutput>(resolve => { resume = resolve; });
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? delayed : original(command, input));
  const pending = f.preview(inspected.inspectionId, 'ttl-owner-held-preview'); vi.setSystemTime(Date.now() + 2); f.main.observe();
  const foreign = { owner: { document: {}, contents: new EventEmitter() } } as ColumnsInvocation;
  await expect(f.main.request(foreign, 'sqlite.tableImport.release', { inspectionId: inspected.inspectionId })).rejects.toThrow();
  expect(f.main.owns('ttl-owner-held-preview')).toBe(true); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.release' || command === 'query.cancel')).toHaveLength(0);
  const late: SqliteTableImportPreviewOutput = await original('sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping: clone(mapping), assertCurrent() {} });
  if (!late.ok) throw Error('夹具预检必须成功'); resume(late); const output = await pending; if (!output.ok) throw Error('其它文档释放不能撤原owner预检');
  f.main.assertPublication(f.owner, output, 'sqlite.tableImport.preview'); expect((await f.apply(output.previewId, 'ttl-original-owner-apply')).outcome).toBe('committed');
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(1);
});
