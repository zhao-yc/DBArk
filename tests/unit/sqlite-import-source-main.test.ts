import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteTableImportMain } from '../../src/main/sqliteTableImportMain';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import type { SelectedFile } from '../../src/main/fileTokens';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteImportSourceInspectOutput } from '../../src/shared/sqliteImportSource';
import { buildSqliteTableImportInsert, type SqliteTableImportInspectOutput, type SqliteTableImportOutcome, type SqliteTableImportPreviewOutput } from '../../src/shared/sqliteTableImport';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

afterEach(() => vi.useRealTimers());
const mapping = [{ source: '内容', target: 'note', kind: 'text' as const }];
const clone = <T,>(value: T): T => structuredClone(value);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** Main单元只替换端口，不读真实数据库或伪造COMMIT ACK；原字节和提交证据由backend实盘用例负责。 */
function fixture() {
  let document = {}, revision = 1, epoch = {}, closing = false, serial = 0;
  const contents = new EventEmitter(), owner = { owner: { document, contents } } as ColumnsInvocation;
  const profile: SqliteConnectionProfile = { id: 'source-connection', name: '合成来源', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/database.sqlite', readOnly: false, busyTimeoutMs: 0 } };
  let file: SelectedFile = { path: 'D:/synthetic/PRIVATE_SOURCE_FILE.csv', purpose: 'import', format: 'csv' };
  const source = { sha256: 'a'.repeat(64), bytes: 200 }, tasks = new Map<string, TaskRecord>(), saved = new Map<string, TaskRecord>(), events: TaskEvent[] = [], outputs = new Map<string, SqliteTableImportInspectOutput>();
  const sourceOutput = (): SqliteImportSourceInspectOutput => ({ sourceId: 'source-' + ++serial, connectionId: profile.id, database: 'main', source: clone(source), sourceColumns: ['内容'], sample: [{ 内容: 'PRIVATE_SOURCE_SAMPLE_9231' }], records: 777, sampleOmitted: true, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
  const targetOutput = (table = '新表🚢'): SqliteTableImportInspectOutput => ({ inspectionId: 'inspection-' + ++serial, target: { connectionId: profile.id, database: 'main', table }, source: clone(source), sourceColumns: ['内容'], sample: [{ 内容: 'PRIVATE_SOURCE_SAMPLE_9231' }], records: 777, sampleOmitted: true, columns: [{ name: 'note', declaredType: 'TEXT', affinity: 'text', nullable: true, hasDefault: false, generated: false }], strict: false, readOnly: profile.sqlite.readOnly, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  const request = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'sqlite.importSource.inspect') { input.assertCurrent(); return sourceOutput(); }
    if (command === 'sqlite.tableImport.inspect') { input.assertCurrent(); const output = targetOutput(input.table); outputs.set(output.inspectionId, output); return output; }
    if (command === 'sqlite.tableImport.preview') {
      input.assertCurrent(); const inspected = outputs.get(input.inspectionId)!;
      return { ok: true, inspectionId: input.inspectionId, previewId: 'preview-' + ++serial, target: clone(inspected.target), source: clone(source), records: 777, report: { checkedRecords: 777, validRecords: 777, invalidRecords: 0, issueCount: 0, issues: [], complete: true, truncated: false }, warnings: [], sql: buildSqliteTableImportInsert(inspected.target.table, input.mapping.map((value: typeof mapping[number]) => value.target)), confirmation: 'main.' + inspected.target.table, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    }
    if (command === 'sqlite.tableImport.apply') { input.assertCurrent(); throw Error('合成传输中断；没有提供任何数据库写入或提交回执'); }
  });
  const save = vi.fn((task: TaskRecord) => { saved.set(task.id, clone(task)); });
  const main = new SqliteTableImportMain({
    assert(value) { if (value.owner.document !== document) throw Error('原文档已变化'); }, same: (left, right) => left.owner.document === right.owner.document,
    revision: () => revision, epoch: () => epoch, available: () => {}, closing: () => closing, profile: id => id === profile.id ? profile : undefined,
    file(token, format) { if (token !== 'selected-file' || file.purpose !== 'import' || file.format !== format) throw Error('准确来源未授权'); return file; },
    request, task: id => tasks.get(id), replace: task => { tasks.set(task.id, task); }, save,
    event(event) { events.push(clone(event)); const task = tasks.get(event.taskId); if (task) { const next: TaskRecord = { ...task, status: event.status, progress: event.progress, message: persistedTaskMessage(task.kind as any, event) }; tasks.set(task.id, next); saved.set(task.id, clone(next)); } },
  });
  const input = (taskId = 'source-task') => ({ connectionId: profile.id, database: 'main', fileToken: 'selected-file', format: 'csv', encoding: 'utf8', taskId });
  const inspect = (taskId = 'source-task') => main.request(owner, 'sqlite.importSource.inspect', input(taskId)) as Promise<SqliteImportSourceInspectOutput>;
  const targetInput = (sourceId: string, taskId = 'target-task', table = '新表🚢') => ({ ...input(taskId), sourceId, table });
  const target = (sourceId: string, taskId = 'target-task', table = '新表🚢') => main.request(owner, 'sqlite.tableImport.inspect', targetInput(sourceId, taskId, table)) as Promise<SqliteTableImportInspectOutput>;
  const preview = (inspectionId: string, taskId = 'preview-task') => main.request(owner, 'sqlite.tableImport.preview', { inspectionId, mapping: clone(mapping), taskId }) as Promise<SqliteTableImportPreviewOutput>;
  const apply = (value: Extract<SqliteTableImportPreviewOutput, { ok: true }>, taskId = 'apply-task') => main.request(owner, 'sqlite.tableImport.apply', { previewId: value.previewId, confirmation: value.confirmation, taskId }) as Promise<SqliteTableImportOutcome>;
  const foreign = () => ({ owner: { document: {}, contents: new EventEmitter() } }) as ColumnsInvocation;
  return { main, owner, contents, profile, source, tasks, saved, events, request, save, sourceOutput, targetOutput, input, inspect, targetInput, target, preview, apply, foreign, file: () => file, replaceFile(value = { ...file }) { file = value; }, revise() { revision++; }, disconnect() { epoch = {}; }, rotate() { document = {}; }, close() { closing = true; } };
}

it('来源Main只注入原选择文件和私有guard，无虚构表名，概要不保存路径/样本/摘要', async () => {
  const f = fixture(), source = await f.inspect(); f.main.assertPublication(f.owner, source, 'sqlite.importSource.inspect');
  const sent = f.request.mock.calls.find(([command]) => command === 'sqlite.importSource.inspect')![1]; expect(sent.filePath).toBe(f.file().path); expect(sent.assertCurrent).toBeTypeOf('function'); expect(sent).not.toHaveProperty('table'); expect(source).not.toHaveProperty('target'); expect(f.tasks.get('source-task')?.kind).toBe('sqlite.importSource.inspect');
  const saved = JSON.stringify([...f.saved.values()]); for (const marker of ['PRIVATE_SOURCE', f.source.sha256, 'filePath', 'sourceColumns', 'mapping']) expect(saved).not.toContain(marker); expect(() => f.main.assertPublication(f.owner, source, 'sqlite.importSource.inspect')).toThrow();
});

it.each(['filePath', 'assertCurrent', 'profile', 'source', 'expectedSource'])('公开source inspect不能夹带%s或绕过Main原文件选择', async property => {
  const f = fixture(); await expect(f.main.request(f.owner, 'sqlite.importSource.inspect', { ...f.input(), [property]: '/untrusted' })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});

it.each(['connection', 'expires', 'shape'] as const)('原runtime来源回包%s不符合Main捕获身份/TTL/严格合同，准确回收sourceId', async change => {
  const f = fixture(), received = f.sourceOutput(), original = f.request.getMockImplementation()!;
  if (change === 'connection') received.connectionId = 'foreign-connection'; else if (change === 'expires') received.expiresAt = new Date(Date.now() + 31 * 60 * 1000).toISOString();
  const output = change === 'shape' ? { ...received, table: '不允许的虚构表' } : received;
  f.request.mockImplementation(async (command, input) => command === 'sqlite.importSource.inspect' ? output : original(command, input)); await expect(f.inspect()).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.importSource.release' && input.sourceId === received.sourceId)).toBe(true); expect(f.tasks.get('source-task')?.status).toBe('failed');
});

it.each(['source', 'target'] as const)('最终%s发布前文档换代拒迟到回包并回收准确原能力', async stage => {
  const f = fixture(), source = await f.inspect(), value = stage === 'source' ? source : await f.target(source.sourceId); f.rotate(); expect(() => f.main.assertPublication(f.owner, value, stage === 'source' ? 'sqlite.importSource.inspect' : 'sqlite.tableImport.inspect')).toThrow();
  expect(f.request.mock.calls.some(([command, input]) => stage === 'source' ? command === 'sqlite.importSource.release' && input.sourceId === source.sourceId : command === 'sqlite.tableImport.release' && input.inspectionId === (value as SqliteTableImportInspectOutput).inspectionId)).toBe(true);
});

it.each(['revise', 'disconnect', 'rotate', 'replaceFile'] as const)('来源检查后%s永久撤原能力，恢复相同路径文字也不能借旧sourceId', async change => {
  const f = fixture(), source = await f.inspect(); f[change](); f.main.observe(); await expect(f.target(source.sourceId)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.inspect')).toHaveLength(0);
});

it('选中文件原对象原地改路径后再还原的可观察ABA也不能复活原来源', async () => {
  const f = fixture(), source = await f.inspect(), original = f.file().path; f.file().path += '.changed'; f.main.observe(); f.file().path = original; await expect(f.target(source.sourceId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command]) => command === 'sqlite.importSource.release')).toBe(true);
});

it('其它文档不能领取/发布/释放原来源，也不能取消原source操作', async () => {
  const f = fixture(), source = await f.inspect(), foreign = f.foreign(); await expect(f.main.request(foreign, 'sqlite.tableImport.inspect', f.targetInput(source.sourceId, 'foreign-target'))).rejects.toThrow(); await expect(f.main.request(foreign, 'sqlite.importSource.release', { sourceId: source.sourceId })).rejects.toThrow(); expect(() => f.main.assertPublication(foreign, source, 'sqlite.importSource.inspect')).toThrow(); f.main.assertPublication(f.owner, source, 'sqlite.importSource.inspect'); expect((await f.target(source.sourceId)).records).toBe(777);
  const gate = deferred<SqliteImportSourceInspectOutput>(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => command === 'sqlite.importSource.inspect' ? gate.promise : original(command, input)); const pending = f.inspect('held-source'); await expect(f.main.cancel(foreign, 'held-source')).rejects.toThrow(); gate.resolve(f.sourceOutput()); await pending;
});

it('同表可显式重检，首次成功后不许换表；同刻只允许一次source领取', async () => {
  const f = fixture(), source = await f.inspect(), first = await f.target(source.sourceId), second = await f.target(source.sourceId, 'target-again'); expect(second.inspectionId).not.toBe(first.inspectionId); await expect(f.target(source.sourceId, 'other-table', '另一张表')).rejects.toThrow();
  const gate = deferred<SqliteTableImportInspectOutput>(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.inspect' ? gate.promise : original(command, input)); const pending = f.target(source.sourceId, 'held-target'); await expect(f.target(source.sourceId, 'concurrent-target')).rejects.toThrow(); gate.resolve(f.targetOutput()); await pending;
});

it('CSV有效默认值可等价，令牌/编码/格式/标题解释变化拒绝且不消耗原source', async () => {
  const f = fixture(), source = await f.inspect();
  for (const patch of [{ fileToken: 'foreign' }, { encoding: 'utf16le' }, { format: 'json' }, { csvHasHeader: false }, { csvDelimiter: ';' }]) await expect(f.main.request(f.owner, 'sqlite.tableImport.inspect', { ...f.targetInput(source.sourceId, 'bad-' + JSON.stringify(patch)), ...patch })).rejects.toThrow();
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.inspect')).toHaveLength(0); expect((await f.main.request(f.owner, 'sqlite.tableImport.inspect', { ...f.targetInput(source.sourceId), csvDelimiter: ',', csvHasHeader: true }) as SqliteTableImportInspectOutput).records).toBe(777);
});

it.each(['sha256', 'bytes', 'records', 'columns'] as const)('最终target回包%s变化不能冒充原来源；拒绝且准确释放回包能力后仍可重检', async property => {
  const f = fixture(), source = await f.inspect(), original = f.request.getMockImplementation()!; let received: SqliteTableImportInspectOutput | undefined;
  f.request.mockImplementation(async (command, input) => { const value = await original(command, input); if (command === 'sqlite.tableImport.inspect') { received = value; if (property === 'sha256') value.source.sha256 = 'b'.repeat(64); else if (property === 'bytes') value.source.bytes++; else if (property === 'records') value.records++; else { value.sourceColumns = ['其它']; value.sample = [{ 其它: '合成目录变化' }]; } } return value; });
  await expect(f.target(source.sourceId)).rejects.toThrow(); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.inspectionId === received?.inspectionId)).toBe(true); f.request.mockImplementation(original); expect((await f.target(source.sourceId, 'target-retry')).records).toBe(777);
});

it('来源自然TTL不撤独立期限的新检查/预览，expired parent仍按children owner拦跨文档释放', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), source = await f.inspect(); vi.setSystemTime(Date.now() + 29 * 60 * 1000); const inspected = await f.target(source.sourceId); vi.setSystemTime(Date.now() + 60 * 1000 + 1); f.main.observe(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.importSource.release')).toHaveLength(0); const checked = await f.preview(inspected.inspectionId); expect(checked.ok).toBe(true);
  await expect(f.main.request(f.foreign(), 'sqlite.importSource.release', { sourceId: source.sourceId })).rejects.toThrow(); await f.main.request(f.owner, 'sqlite.importSource.release', { sourceId: source.sourceId }); if (!checked.ok) throw Error('夹具预检未通过'); await expect(f.apply(checked)).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0);
});

it('显式释放source同步撤所有未领取children，仍可单独释放不相关来源', async () => {
  const f = fixture(), one = await f.inspect(), two = await f.inspect('second-source'), first = await f.target(one.sourceId), second = await f.target(two.sourceId, 'second-target'), firstPreview = await f.preview(first.inspectionId), secondPreview = await f.preview(second.inspectionId, 'second-preview');
  await f.main.request(f.owner, 'sqlite.importSource.release', { sourceId: one.sourceId }); if (!firstPreview.ok || !secondPreview.ok) throw Error('夹具预检未通过'); await expect(f.apply(firstPreview)).rejects.toThrow(); expect((await f.preview(second.inspectionId, 'unrelated-preview')).ok).toBe(true); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.importSource.release' && input.sourceId === two.sourceId)).toBe(false);
});

it('source release撤正在claim的target并取消准确原任务，迟到回包不重建能力', async () => {
  const f = fixture(), source = await f.inspect(), gate = deferred<SqliteTableImportInspectOutput>(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.inspect' ? gate.promise : original(command, input)); const pending = f.target(source.sourceId), rejected = expect(pending).rejects.toThrow(); await f.main.request(f.owner, 'sqlite.importSource.release', { sourceId: source.sourceId });
  expect(f.request.mock.calls.filter(([command, input]) => command === 'query.cancel' && input.taskId === 'target-task')).toHaveLength(1); const late = f.targetOutput(); gate.resolve(late); await rejected; expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.inspectionId === late.inspectionId)).toBe(true); await expect(f.target(source.sourceId, 'cannot-revive')).rejects.toThrow();
});

it('source检查取消和退出都等待原请求settle，取消ACK不能提前解除Main占用', async () => {
  const f = fixture(), gate = deferred<SqliteImportSourceInspectOutput>(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => command === 'sqlite.importSource.inspect' ? gate.promise : original(command, input)); const pending = f.inspect(), rejected = expect(pending).rejects.toThrow(); await f.main.cancel(f.owner, 'source-task'); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('source-task')).toBe(true); gate.resolve(f.sourceOutput()); await rejected; await draining; expect(f.main.owns('source-task')).toBe(false); expect(f.tasks.get('source-task')?.status).toBe('cancelled'); expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
});

it('target原检查退出取消等待其settle，不因source retire先完成就绕过全局Main等待', async () => {
  const f = fixture(), source = await f.inspect(), gate = deferred<SqliteTableImportInspectOutput>(), original = f.request.getMockImplementation()!; f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.inspect' ? gate.promise : original(command, input)); const pending = f.target(source.sourceId), rejected = expect(pending).rejects.toThrow(); f.close(); let drained = false; const draining = f.main.drain().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false); expect(f.main.owns('target-task')).toBe(true); gate.resolve(f.targetOutput()); await rejected; await draining; expect(f.main.owns('target-task')).toBe(false); expect(f.tasks.get('target-task')?.status).toBe('cancelled');
});

it('已claim writer不因metadata source release伪造取消；原guard仍有效且等待真实端口settle', async () => {
  const f = fixture(), source = await f.inspect(), inspected = await f.target(source.sourceId), checked = await f.preview(inspected.inspectionId); if (!checked.ok) throw Error('夹具预检未通过'); const gate = deferred<never>(), original = f.request.getMockImplementation()!; let sent: any;
  f.request.mockImplementation(async (command, input) => { if (command === 'sqlite.tableImport.apply') { sent = input; input.assertCurrent(); return gate.promise; } return original(command, input); }); const pending = f.apply(checked); await f.main.request(f.owner, 'sqlite.importSource.release', { sourceId: source.sourceId }); expect(sent).toBeDefined(); expect(() => sent.assertCurrent()).not.toThrow(); expect(f.main.owns('apply-task')).toBe(true); expect(f.request.mock.calls.filter(([command, input]) => command === 'query.cancel' && input.taskId === 'apply-task')).toHaveLength(0);
  // Main纯协议测试不补造COMMIT ACK：以真实端口拒绝结束，结果只能保守未知。
  gate.reject(Error('合成端口结束，无任何提交ACK')); const result = await pending; expect(result).toMatchObject({ outcome: 'unknown', fact: { commitAcknowledged: false } }); expect(f.main.owns('apply-task')).toBe(false);
});

it('已发送却无写回执的未知结果撤source和兄弟预览，不能把回包当提交ACK或自动重放', async () => {
  const f = fixture(), source = await f.inspect(), first = await f.target(source.sourceId), second = await f.target(source.sourceId, 'second-target'), one = await f.preview(first.inspectionId), two = await f.preview(second.inspectionId, 'second-preview'); if (!one.ok || !two.ok) throw Error('夹具预检未通过');
  const result = await f.apply(one); expect(result).toMatchObject({ outcome: 'unknown', fact: { commitAcknowledged: false, appliedRows: 0 } }); expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.importSource.release' && input.sourceId === source.sourceId)).toBe(true); await expect(f.apply(two, 'cannot-repeat')).rejects.toThrow(); await expect(f.target(source.sourceId, 'cannot-reinspect')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(1); expect(f.tasks.has('cannot-repeat')).toBe(false);
});

it('首个source任务持久化失败时零runtime投递，不能留下running假任务', async () => {
  const f = fixture(); f.save.mockImplementationOnce(() => { throw Error('合成持久化失败'); }); await expect(f.inspect()).rejects.toThrow('持久化'); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.get('source-task')?.status).toBe('failed');
});

it('只读来源检查仍是纯读能力；DDL和apply写权限由各自原入口检查', async () => {
  const f = fixture(); f.profile.sqlite.readOnly = true; expect((await f.inspect()).records).toBe(777); expect(f.request.mock.calls.map(([command]) => command)).toEqual(['sqlite.importSource.inspect']);
});


it('source及目标检查自然TTL移表后原source release仍撤在途preview，晚回不能复活写入能力', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), source = await f.inspect(), original = f.request.getMockImplementation()!;
  // 先在来源30分钟TTL内领取目标检查，再让其5分钟TTL结束；两层自然回收均不能伪装显式释放。
  vi.setSystemTime(Date.now() + 29 * 60 * 1000); const inspected = await f.target(source.sourceId);
  vi.setSystemTime(Date.now() + 299999); const gate = deferred<SqliteTableImportPreviewOutput>();
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? gate.promise : original(command, input));
  const pending = f.preview(inspected.inspectionId, 'source-ttl-held-preview'), rejected = expect(pending).rejects.toThrow();
  vi.setSystemTime(Date.now() + 2); f.main.observe(); expect(f.main.owns('source-ttl-held-preview')).toBe(true);
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.importSource.release' || command === 'sqlite.tableImport.release')).toHaveLength(0);
  await f.main.request(f.owner, 'sqlite.importSource.release', { sourceId: source.sourceId });
  const late: SqliteTableImportPreviewOutput = await original('sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping: clone(mapping), assertCurrent() {} });
  if (!late.ok) throw Error('夹具必须给出有界成功预检回包以验证source释放后的Main拒绝'); gate.resolve(late); await rejected;
  expect(() => f.main.assertPublication(f.owner, late, 'sqlite.tableImport.preview')).toThrow();
  await expect(f.apply(late, 'source-ttl-released-cannot-apply')).rejects.toThrow(); expect(f.tasks.has('source-ttl-released-cannot-apply')).toBe(false);
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.importSource.release' && input.sourceId === source.sourceId)).toBe(true);
  expect(f.request.mock.calls.some(([command, input]) => command === 'sqlite.tableImport.release' && input.previewId === late.previewId)).toBe(true);
  expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0); expect(f.main.owns('source-ttl-held-preview')).toBe(false);
});

it('source及目标检查自然TTL移表后其它文档不能撤在途parent，原owner晚预检仍能准确发布', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(), source = await f.inspect(), original = f.request.getMockImplementation()!;
  vi.setSystemTime(Date.now() + 29 * 60 * 1000); const inspected = await f.target(source.sourceId);
  vi.setSystemTime(Date.now() + 299999); const gate = deferred<SqliteTableImportPreviewOutput>();
  f.request.mockImplementation(async (command, input) => command === 'sqlite.tableImport.preview' ? gate.promise : original(command, input));
  const pending = f.preview(inspected.inspectionId, 'source-ttl-owner-preview'); vi.setSystemTime(Date.now() + 2); f.main.observe();
  await expect(f.main.request(f.foreign(), 'sqlite.importSource.release', { sourceId: source.sourceId })).rejects.toThrow();
  expect(f.main.owns('source-ttl-owner-preview')).toBe(true); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.importSource.release' || command === 'sqlite.tableImport.release' || command === 'query.cancel')).toHaveLength(0);
  const late: SqliteTableImportPreviewOutput = await original('sqlite.tableImport.preview', { inspectionId: inspected.inspectionId, mapping: clone(mapping), assertCurrent() {} });
  if (!late.ok) throw Error('夹具预检必须成功'); gate.resolve(late); const output = await pending; if (!output.ok) throw Error('其它文档不能撤原owner在途预检');
  f.main.assertPublication(f.owner, output, 'sqlite.tableImport.preview'); expect(output.target).toEqual(inspected.target); expect(output.source).toEqual(source.source); expect(output.records).toBe(source.records);
  // 此用例不伪造数据库ACK；明确释放原owner新能力后，仍须阻止其被误当成待发送写入。
  await f.main.request(f.owner, 'sqlite.tableImport.release', { previewId: output.previewId }); await expect(f.apply(output, 'source-ttl-owner-released-apply')).rejects.toThrow(); expect(f.request.mock.calls.filter(([command]) => command === 'sqlite.tableImport.apply')).toHaveLength(0);
});
