import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import { sqliteImportFactMessage } from '../../src/shared/sqliteTableImportFact';
import { TaskCancelStates } from '../../src/renderer/taskCancelStates';
import { memoryDocument, type MemoryNode } from '../fixtures/memory-dom';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request }));
vi.mock('../../src/renderer/components/SavedQueriesDialog', () => ({ SavedQueriesDialog: () => null }));
vi.mock('../../src/renderer/components/HistoryPagesDialog', () => ({ HistoryPagesDialog: () => null }));
vi.mock('../../src/renderer/components/TableApplyReceiptsDialog', () => ({ TableApplyReceiptsDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const listeners = new Set<(event: TaskEvent) => void>();
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>;
let Summary: typeof import('../../src/renderer/components/SqliteWriteFactSummary')['SqliteWriteFactSummary'], Tasks: typeof import('../../src/renderer/components/ActivityDialog')['TasksDialog'];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask(listener: (event: TaskEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } } });
  ({ useWorkspace } = await import('../../src/renderer/store')); baseline = useWorkspace.getState();
  ({ createRoot } = await import('react-dom/client')); ({ SqliteWriteFactSummary: Summary } = await import('../../src/renderer/components/SqliteWriteFactSummary')); ({ TasksDialog: Tasks } = await import('../../src/renderer/components/ActivityDialog'));
});
beforeEach(() => { useWorkspace.setState({ tasks: [], queryFileTasks: {} }); request.mockImplementation(async (command, input) => { if (command === 'tasks.cancelState') return input.taskIds.map((taskId: string) => ({ taskId, state: 'allowed' })); if (command === 'query.cancel') return; throw Error('专项不允许其它IPC'); }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(baseline, true); request.mockReset(); listeners.clear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 超过表格编辑500条预算，原导入回执必须走自己的严格合同。 */
function fact(phase: SqliteWriteFact['phase'], patch: Partial<SqliteWriteFact> = {}): SqliteWriteFact {
  return { operationId: 'c3cd02c8-c5c1-4e41-851b-358cc753d714', target: { connectionId: 'sqlite-import-c', database: 'main', table: '原导入表🚢' }, phase, requestedRows: 1001, appliedRows: phase === 'not-sent' ? 0 : phase === 'writing' ? 128 : 1001, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch };
}
function event(value?: SqliteWriteFact, patch: Partial<TaskEvent> = {}): TaskEvent { return { taskId: 'import-task', status: 'running', progress: 20, message: 'PRIVATE_IMPORT_SOURCE_7821 D:/private/source.csv INSERT OR REPLACE secret', sqliteImportOperation: 'apply', ...(value ? { sqliteWrite: value } : {}), ...patch }; }
const task = () => useWorkspace.getState().tasks.find(value => value.id === 'import-task')!;
async function mount(): Promise<void> { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Tasks onClose={() => {}}/>)); }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }

it('真实store沿Main三阶段分类，不把导入回执误改成表格编辑，消息不包含源数据', () => {
  for (const kind of ['inspect', 'preview'] as const) useWorkspace.getState().onTask(event(undefined, { taskId: kind, sqliteImportOperation: kind, status: 'completed' }));
  for (const kind of ['inspect', 'preview']) expect(useWorkspace.getState().tasks.find(value => value.id === kind)?.kind).toBe('sqlite.tableImport.' + kind);
  useWorkspace.getState().onTask(event(fact('not-sent'))); useWorkspace.getState().onTask(event(fact('writing')));
  expect(task()).toMatchObject({ kind: 'sqlite.tableImport.apply', sqliteWrite: fact('writing') });
  expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('PRIVATE_IMPORT_SOURCE'); expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('source.csv');
});
it('真实store保留原提交ACK，迟到failed或无事实的事件不能退回失败', () => {
  for (const phase of ['not-sent', 'writing', 'commit-pending', 'committed'] as const) useWorkspace.getState().onTask(event(fact(phase)));
  useWorkspace.getState().onTask(event(undefined, { status: 'failed', progress: 0 }));
  expect(task()).toMatchObject({ status: 'completed', progress: 100, sqliteWrite: fact('committed'), message: sqliteImportFactMessage(fact('committed')) });
});
it.each(['operation', 'target', 'count', 'ack', 'extra', 'phase'] as const)('同task的%s坏事实整条拒绝，不能替换原导入数量或状态', kind => {
  useWorkspace.getState().onTask(event(fact('writing'))); const original = task();
  const value = kind === 'operation' ? fact('committed', { operationId: 'e51667d7-f094-4095-955a-95f0d6d129cb' }) : kind === 'target' ? fact('committed', { target: { ...fact('writing').target, table: '另一对象' } }) : kind === 'count' ? fact('writing', { appliedRows: 127 }) : kind === 'ack' ? fact('committed', { commitAcknowledged: false }) : kind === 'extra' ? { ...fact('committed'), filePath: 'D:/private/source.csv' } : fact('not-sent');
  useWorkspace.getState().onTask(event(value, { status: 'completed', progress: 100 })); expect(task()).toBe(original);
});
it('未知只能由同operation真实ACK收束，预检类别或原network任务不被导入接管', () => {
  useWorkspace.getState().onTask(event(fact('unknown'))); expect(task().status).toBe('failed'); useWorkspace.getState().onTask(event(fact('committed'))); expect(task().status).toBe('completed'); const original = task();
  useWorkspace.getState().onTask(event(undefined, { sqliteImportOperation: 'preview' })); expect(task()).toBe(original);
  const network: TaskRecord = { id: 'network', kind: 'query.execute', status: 'running', progress: 0, message: '', startedAt: '2026-11-01T00:00:00Z' }; useWorkspace.setState({ tasks: [network] }); useWorkspace.getState().onTask(event(fact('committed'), { taskId: 'network' })); expect(useWorkspace.getState().tasks[0]).toBe(network);
});
it.each(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown'] as const)('真实导入摘要展示1001条请求和%s的已处理数量，旧编辑合同保持500限制', phase => {
  const value = fact(phase), html = renderToStaticMarkup(<Summary fact={value} importing/>); expect(html).toContain('1001'); expect(html).toContain(value.operationId); expect(html).toContain('原导入表'); expect(html).not.toContain('source.csv'); expect(renderToStaticMarkup(<Summary fact={value}/>)).toBe('');
});
it('真实任务面板显示导入阶段及原回执，旧取消闭包不能跨COMMIT边界投递取消', async () => {
  useWorkspace.getState().onTask(event(fact('writing'))); await mount(); expect(document.body.textContent).toContain('SQLite整文件导入'); expect(document.body.textContent).toContain('1001');
  const stop = document.body.querySelectorAll('button').find(node => (node.textContent ?? '').includes('取消')); expect(stop).toBeDefined(); const old = props(stop!).onClick;
  await act(async () => useWorkspace.getState().onTask(event(fact('commit-pending'))));
  await act(async () => old()); expect(request.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(0);
});
it('真实取消控制器以1001条原导入commit/unknown事件锁定，迟到allowed不能解锁', async () => {
  let listener!: (event: TaskEvent) => void, resolve!: (value: unknown) => void; let current: ReadonlyMap<string, string> = new Map();
  const controller = new TaskCancelStates({ subscribe(value) { listener = value; return () => {}; }, read: () => new Promise(yes => { resolve = yes; }), changed: value => { current = value; } });
  controller.start(['import-task']); await Promise.resolve(); listener(event(fact('commit-pending'))); resolve([{ taskId: 'import-task', state: 'allowed' }]); await Promise.resolve(); await Promise.resolve(); expect(current.get('import-task')).toBe('confirming'); expect(controller.canCancel('import-task')).toBe(false); controller.stop();
});
