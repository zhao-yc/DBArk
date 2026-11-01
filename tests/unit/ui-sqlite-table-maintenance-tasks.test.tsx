import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteTableMaintenanceFact } from '../../src/shared/sqliteTableMaintenance';
import { sqliteTableMaintenanceFactMessage, sqliteTableMaintenanceTaskMessage } from '../../src/shared/sqliteTableMaintenanceFact';
import { sqliteTableMaintenanceCancelLocked, TaskCancelStates } from '../../src/renderer/taskCancelStates';
import { sqliteTableMaintenanceTaskTitles } from '../../src/renderer/locales/sqliteTableMaintenanceFact.zh-CN';
import { sqliteTableMaintenanceFactZh } from '../../src/renderer/locales/sqliteTableMaintenanceFact.zh-CN';
import { SqliteTableMaintenanceFactSummary } from '../../src/renderer/components/SqliteTableMaintenanceFactSummary';
import { memoryDocument, type MemoryNode } from '../fixtures/memory-dom';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request }));
vi.mock('../../src/renderer/components/SavedQueriesDialog', () => ({ SavedQueriesDialog: () => null }));
vi.mock('../../src/renderer/components/HistoryPagesDialog', () => ({ HistoryPagesDialog: () => null }));
vi.mock('../../src/renderer/components/TableApplyReceiptsDialog', () => ({ TableApplyReceiptsDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), listeners = new Set<(event: TaskEvent) => void>();
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>, Tasks: typeof import('../../src/renderer/components/ActivityDialog')['TasksDialog'];
beforeAll(async () => { document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask(listener: (event: TaskEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } } }); ({ useWorkspace } = await import('../../src/renderer/store')); baseline = useWorkspace.getState(); ({ createRoot } = await import('react-dom/client')); ({ TasksDialog: Tasks } = await import('../../src/renderer/components/ActivityDialog')); });
beforeEach(() => { useWorkspace.setState({ tasks: [], queryFileTasks: {} }); request.mockImplementation(async (command: string, input: { taskIds?: string[] }) => { if (command === 'tasks.cancelState') return input.taskIds?.map(taskId => ({ taskId, state: 'allowed' })); if (command === 'query.cancel') return; throw Error('专项不允许额外IPC'); }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(baseline, true); request.mockReset(); listeners.clear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 每次事件含原表达式诱饵，但真实store只领取Main签发的种类及最小事实。 */
function fact(phase: SqliteTableMaintenanceFact['phase'], patch: Partial<SqliteTableMaintenanceFact> = {}): SqliteTableMaintenanceFact { return { operationId: 'owned-operation', target: { connectionId: 'owned', database: 'main', table: '原表🚢' }, phase, action: 'clear', ...(phase==='not-sent'?{}:{actualBeforeRows:'3'}), requestedStatements: 1, completedStatements: ['not-sent','writing'].includes(phase) ? 0 : 1, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch }; }
function event(value?: SqliteTableMaintenanceFact, patch: Partial<TaskEvent> = {}): TaskEvent { return { taskId: 'table-maintenance-task', status: 'running', progress: 20, message: 'PRIVATE_COLUMNS_915 D:/private/file.sqlite CREATE INDEX PRIVATE_DEFAULT', sqliteTableMaintenanceOperation: 'apply', ...(value ? { sqliteTableMaintenance: value } : {}), ...patch }; }
const task = () => useWorkspace.getState().tasks.find(value => value.id === 'table-maintenance-task')!;
async function mount(): Promise<void> { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<Tasks onClose={() => {}}/>)); }
/** 只借React已登记点击端口调用旧真实按钮，不造产品handler或放宽取消判断。 */
function click(node: MemoryNode): () => void { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React原点击端口'); const value = (node as unknown as Record<string, unknown>)[key]; if (!value || typeof value !== 'object' || !('onClick' in value) || typeof value.onClick !== 'function') throw Error('缺少React原点击函数'); return value.onClick as () => void; }

it('真实store分目录/预览/应用种类，固定消息不持久表达式且只读事件不领写ACK', () => {
  for (const stage of ['inspect', 'preview'] as const) { useWorkspace.getState().onTask(event(fact('committed'), { taskId: stage, sqliteTableMaintenanceOperation: stage, status: 'completed' })); const saved = useWorkspace.getState().tasks.find(value => value.id === stage)!; expect(saved.kind).toBe('sqlite.tableMaintenance.' + stage); expect(saved.sqliteTableMaintenance).toBeUndefined(); expect(saved.message).toBe(sqliteTableMaintenanceTaskMessage(saved.kind, saved.status)); }
  useWorkspace.getState().onTask(event(fact('writing'))); expect(task()).toMatchObject({ kind: 'sqlite.tableMaintenance.apply', sqliteTableMaintenance: fact('writing') }); expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('PRIVATE_COLUMNS'); expect(task().sqliteWrite).toBeUndefined(); expect(task().sqliteCreate).toBeUndefined();
});
it('真实ACK不因晚failed/无事实降级，原操作/目标/计数倒退事件整个拒绝', () => {
  for (const phase of ['not-sent', 'writing', 'commit-pending', 'committed'] as const) useWorkspace.getState().onTask(event(fact(phase))); useWorkspace.getState().onTask(event(undefined, { status: 'failed', progress: 0 })); expect(task()).toMatchObject({ status: 'completed', progress: 100, sqliteTableMaintenance: fact('committed'), message: sqliteTableMaintenanceFactMessage(fact('committed')) });
  const original = task(); for (const value of [fact('writing'), fact('committed', { operationId: '其它操作' }), fact('committed', { target: { ...fact('committed').target, table: '其它表' } })]) { useWorkspace.getState().onTask(event(value)); expect(task()).toBe(original); }
});
it('表维护事件不能接管旧网络/导入/建表kind，缺可信事实的completed应用不能显示提交', () => {
  for (const kind of ['query.execute', 'sqlite.tableImport.apply', 'sqlite.tableCreate.apply', 'sqlite.indexes.apply']) { const original: TaskRecord = { id: 'table-maintenance-task', kind, status: 'running', progress: 0, startedAt: '2026-11-01T00:00:00Z', message: '原任务' }; useWorkspace.setState({ tasks: [original] }); useWorkspace.getState().onTask(event(fact('committed'))); expect(task()).toBe(original); }
  useWorkspace.setState({ tasks: [] }); useWorkspace.getState().onTask(event(undefined, { status: 'completed', progress: 100 })); expect(task().status).toBe('failed'); expect(task().sqliteTableMaintenance).toBeUndefined(); expect(task().progress).toBeLessThan(100);
});
it('表维护任务拒绝混合其它Main类别，且列默认值、其它domain事实不能进入任务摘要', () => {
  for (const patch of [{ sqliteTableRenameOperation: 'apply' as const }, { sqliteColumnsOperation: 'apply' as const }, { sqliteIndexesOperation: 'apply' as const }, { sqliteImportOperation: 'apply' as const }, { sqliteCreateOperation: 'apply' as const }]) { useWorkspace.getState().onTask(event(fact('committed'), patch)); expect(useWorkspace.getState().tasks).toHaveLength(0); }
  const { action: _action, actualBeforeRows: _before, ...otherDdl } = fact('committed');
  useWorkspace.getState().onTask(event(fact('writing'), { sqliteTableRename: otherDdl, sqliteIndexes: otherDdl, sqliteCreate: otherDdl, sqliteWrite: { operationId: 'owned-operation', target: fact('committed').target, phase: 'committed', requestedRows: 2, appliedRows: 2, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, queryFileSource: { tabId: 'PRIVATE_FILE_TAB', operation: 'save', phase: 'terminal', bytesProcessed: 12, totalBytes: 12, wrote: 'yes', cancellable: false }, executionSql: 'ALTER TABLE PRIVATE_SQL' }));
  expect(task()).toMatchObject({ kind: 'sqlite.tableMaintenance.apply', status: 'running', progress: 20, sqliteTableMaintenance: fact('writing') }); expect(task().sqliteTableRename).toBeUndefined(); expect(task().sqliteIndexes).toBeUndefined(); expect(task().sqliteCreate).toBeUndefined(); expect(task().sqliteWrite).toBeUndefined(); expect(useWorkspace.getState().queryFileTasks).toEqual({}); expect(JSON.stringify(task())).not.toContain('PRIVATE_COLUMNS'); expect(JSON.stringify(task())).not.toContain('PRIVATE_FILE'); expect(JSON.stringify(task())).not.toContain('PRIVATE_SQL');
});
it('原COMMIT事件先锁取消，晚allowed快照不能重新授予表维护写任务取消', async () => {
  let listener!: (event: TaskEvent) => void, resolve!: (value: unknown) => void; let states: ReadonlyMap<string, string> = new Map(); const control = new TaskCancelStates({ subscribe(value) { listener = value; return () => {}; }, read: () => new Promise(yes => { resolve = yes; }), changed(value) { states = value; } });
  control.start(['table-maintenance-task']); await Promise.resolve(); listener(event(fact('commit-pending'))); resolve([{ taskId: 'table-maintenance-task', state: 'allowed' }]); await Promise.resolve(); await Promise.resolve(); expect(states.get('table-maintenance-task')).toBe('confirming'); expect(control.canCancel('table-maintenance-task')).toBe(false); expect(sqliteTableMaintenanceCancelLocked(fact('unknown'))).toBe(true); control.stop();
});
it('真实任务中心只显示最小DDL事实，旧取消按钮在新COMMIT边界后不发query.cancel', async () => {
  useWorkspace.getState().onTask(event(fact('writing'))); await mount(); expect(document.body.textContent).toContain(sqliteTableMaintenanceTaskTitles.apply); expect(document.querySelectorAll('details').find(node => node.getAttribute('aria-label') === sqliteTableMaintenanceFactZh.title)).toBeDefined(); expect(document.body.textContent).toContain(sqliteTableMaintenanceFactZh.phases.writing); expect(document.querySelectorAll('dd').map(node => node.textContent)).toEqual(['owned-operation', 'owned / main / 原表🚢', sqliteTableMaintenanceFactZh.actions.clear, '1', '0','3']); expect(document.body.textContent).not.toContain('PRIVATE_COLUMNS'); expect(document.body.textContent).not.toContain('PRIVATE_DEFAULT');
  // 取消按钮文案沿项目既有locale，不依赖固定中文猜测。
  const { zh } = await import('../../src/renderer/locales/zh-CN'), cancel = document.querySelectorAll('button').find(node => node.textContent === zh.activity.text018); expect(cancel).toBeDefined(); const oldClick = click(cancel!);
  await act(async () => useWorkspace.getState().onTask(event(fact('commit-pending')))); await act(async () => oldClick()); expect(request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(0);
  expect(document.body.textContent).toContain(sqliteTableMaintenanceFactZh.phases['commit-pending']); expect(document.querySelectorAll('dd').map(node => node.textContent)).toEqual(['owned-operation', 'owned / main / 原表🚢', sqliteTableMaintenanceFactZh.actions.clear,'1','1','3']);
});

it.each(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown'] as const)('独立回执%s严格展示完整目标/原操作/请求及处理数，阶段不把DDL数量冒充ACK', phase => {
  const value = fact(phase), html = renderToStaticMarkup(<SqliteTableMaintenanceFactSummary fact={value}/>);
  expect(html).toContain('<details aria-label="' + sqliteTableMaintenanceFactZh.title + '">'); expect(html).toContain('<summary>' + sqliteTableMaintenanceFactZh.phases[phase] + '</summary>'); expect(html).toContain('<dd>owned-operation</dd>'); expect(html).toContain('<dd>owned / main / 原表🚢</dd>'); expect((html.match(/<dd>/g) ?? []).length).toBe(6); expect(html).toContain('<dt>' + sqliteTableMaintenanceFactZh.requested + '</dt><dd>1</dd>'); expect(html).toContain('<dt>' + sqliteTableMaintenanceFactZh.completed + '</dt><dd>' + value.completedStatements + '</dd>'); expect(html).toContain('<dd>'+sqliteTableMaintenanceFactZh.actions.clear+'</dd>'); expect(html).toContain('<dt>'+sqliteTableMaintenanceFactZh.actualBeforeRows+'</dt><dd>'+(value.actualBeforeRows??sqliteTableMaintenanceFactZh.unknownRows)+'</dd>');
});
it('独立回执拒绝缺失/矛盾/额外表达式的malformed事实，不显示伪提交或原输入', () => {
  expect(renderToStaticMarkup(<SqliteTableMaintenanceFactSummary/>)).toBe('');
  for (const value of [{ ...fact('committed'), commitAcknowledged: false }, { ...fact('writing'), completedStatements: 3 }, { ...fact('committed'), sql: 'PRIVATE_COLUMNS_SQL PRIVATE_DEFAULT' }, { ...fact('committed'), target: { ...fact('committed').target, database: 'temp' } }]) expect(renderToStaticMarkup(<SqliteTableMaintenanceFactSummary fact={value}/>)).toBe('');
});
