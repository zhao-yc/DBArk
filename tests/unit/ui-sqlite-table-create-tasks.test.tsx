import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteTableCreateFact } from '../../src/shared/sqliteTableCreate';
import { sqliteCreateFactMessage } from '../../src/shared/sqliteTableCreateFact';
import { sqliteTableCreateZh as text } from '../../src/renderer/locales/sqliteTableCreate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, type MemoryNode } from '../fixtures/memory-dom';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request }));
// 任务面板的其它资料页不参与此回执专项；真实任务面板、store、摘要和取消hook保持运行。
vi.mock('../../src/renderer/components/SavedQueriesDialog', () => ({ SavedQueriesDialog: () => null }));
vi.mock('../../src/renderer/components/HistoryPagesDialog', () => ({ HistoryPagesDialog: () => null }));
vi.mock('../../src/renderer/components/TableApplyReceiptsDialog', () => ({ TableApplyReceiptsDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>;
let Summary: typeof import('../../src/renderer/components/SqliteTableCreateFactSummary')['SqliteTableCreateFactSummary'], Tasks: typeof import('../../src/renderer/components/ActivityDialog')['TasksDialog'];
const listeners = new Set<(event: TaskEvent) => void>();
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask(listener: (event: TaskEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } } });
  ({ useWorkspace } = await import('../../src/renderer/store')); baseline = useWorkspace.getState();
  ({ createRoot } = await import('react-dom/client')); ({ SqliteTableCreateFactSummary: Summary } = await import('../../src/renderer/components/SqliteTableCreateFactSummary')); ({ TasksDialog: Tasks } = await import('../../src/renderer/components/ActivityDialog'));
});
beforeEach(() => { useWorkspace.setState({ tasks: [], queryFileTasks: {} }); request.mockImplementation(async (command, input) => { if (command === 'tasks.cancelState') return input.taskIds.map((taskId: string) => ({ taskId, state: 'allowed' })); if (command === 'query.cancel') return; throw Error('专项不允许其它IPC'); }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(baseline, true); request.mockReset(); listeners.clear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 合成最小事务事实，不包含DDL、设计、值或本机路径。 */
function fact(phase: SqliteTableCreateFact['phase'], patch: Partial<SqliteTableCreateFact> = {}): SqliteTableCreateFact {
  return { operationId: 'random-operation-original', target: { connectionId: 'sqlite-c', database: 'main', table: '原表🚢' }, phase, requestedStatements: 3, completedStatements: phase === 'not-sent' ? 0 : phase === 'writing' ? 1 : 3, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back', ...patch };
}
function event(value?: SqliteTableCreateFact, patch: Partial<TaskEvent> = {}): TaskEvent { return { taskId: 'create', status: 'running', progress: 10, message: 'E2E_PRIVATE_DEFAULT_不得存储 CREATE TABLE /private/path.sqlite', sqliteCreateOperation: 'apply', ...(value ? { sqliteCreate: value } : {}), ...patch }; }
const task = () => useWorkspace.getState().tasks.find(value => value.id === 'create')!;
async function mount() { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Tasks onClose={() => {}}/>)); }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件端口'); return (node as any)[key]; }

it('真实store按Main固定类别分类预览/提交，预览消息不泄漏SQL/default/path，原network种类保持', () => {
  useWorkspace.getState().onTask(event(undefined, { taskId: 'preview', sqliteCreateOperation: 'preview', status: 'completed' }));
  expect(useWorkspace.getState().tasks[0]).toMatchObject({ kind: 'sqlite.tableCreate.preview', message: text.previewTaskMessages.completed });
  useWorkspace.getState().onTask(event()); expect(task().kind).toBe('sqlite.tableCreate.apply');
  const network: TaskRecord = { id: 'network', kind: 'query.execute', startedAt: '2026-11-01T00:00:00Z', status: 'running', progress: 0, message: '' }; useWorkspace.setState({ tasks: [...useWorkspace.getState().tasks, network] }); useWorkspace.getState().onTask({ taskId: 'network', status: 'completed', progress: 100, message: '原网络消息' });
  expect(useWorkspace.getState().tasks.find(value => value.id === 'network')).toMatchObject({ kind: 'query.execute', message: '原网络消息' }); expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('E2E_PRIVATE_DEFAULT'); expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('/private/path.sqlite');
});

it('真实store保留有序DDL计数与随机operation，COMMIT ACK后晚failed/无fact不能降为失败', () => {
  for (const phase of ['not-sent', 'writing', 'commit-pending', 'committed'] as const) useWorkspace.getState().onTask(event(fact(phase)));
  expect(task()).toMatchObject({ kind: 'sqlite.tableCreate.apply', status: 'completed', progress: 100, sqliteCreate: fact('committed'), message: sqliteCreateFactMessage(fact('committed')) });
  useWorkspace.getState().onTask(event(undefined, { sqliteCreateOperation: undefined, status: 'failed', progress: 0 })); expect(task()).toMatchObject({ status: 'completed', progress: 100, sqliteCreate: fact('committed') });
  expect(task()).not.toHaveProperty('rows'); expect(task()).not.toHaveProperty('sql'); expect(task()).not.toHaveProperty('default');
});

it.each(['operation', 'target', 'count', 'ack', 'extra'] as const)('同task %s坏回执整条事件被拒绝，不能替换原receipt或状态', kind => {
  useWorkspace.getState().onTask(event(fact('writing'))); const original = task();
  const value = kind === 'operation' ? fact('committed', { operationId: 'different-operation' }) : kind === 'target' ? fact('committed', { target: { ...fact('writing').target, table: '另一表' } }) : kind === 'count' ? fact('writing', { completedStatements: 0 }) : kind === 'ack' ? fact('committed', { commitAcknowledged: false }) : { ...fact('committed'), sql: '禁止进入任务' };
  useWorkspace.getState().onTask(event(value, { status: 'completed', progress: 100 })); expect(task()).toBe(original);
});

it('未知可被同operation真实ACK收束，但旧计数/类别和另一个操作不得冒领', () => {
  useWorkspace.getState().onTask(event(fact('unknown'))); expect(task().status).toBe('failed'); useWorkspace.getState().onTask(event(fact('committed'))); expect(task().status).toBe('completed'); const original = task();
  useWorkspace.getState().onTask(event(fact('writing'))); useWorkspace.getState().onTask(event(undefined, { sqliteCreateOperation: 'preview' })); expect(task()).toBe(original);
});

it.each(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown'] as const)('真实摘要展示%s阶段与DDL语句数，不能把数量称为行数', phase => {
  const value = fact(phase), html = renderToStaticMarkup(<Summary fact={value}/>);
  expect(html).toContain(text.factTitle); expect(html).toContain(text.factPhases[phase]); expect(html).toContain(value.operationId); expect(html).toContain('sqlite-c / main / 原表🚢'); expect(html).toContain(text.factRequested); expect(html).toContain(text.factCompleted); expect(html).not.toContain('行数'); expect(html).not.toContain('requestedRows'); expect(html).not.toContain('E2E_PRIVATE_DEFAULT');
});

it('坏事实不生成可误读的摘要，实际任务面板只给两种新kind中文名', async () => {
  expect(renderToStaticMarkup(<Summary fact={{ ...fact('writing'), sql: '坏字段' } as SqliteTableCreateFact}/>)).toBe('');
  useWorkspace.getState().onTask(event(fact('committed'))); useWorkspace.getState().onTask(event(undefined, { taskId: 'preview', sqliteCreateOperation: 'preview', status: 'completed' })); await mount();
  expect(document.body.textContent).toContain(text.applyTask); expect(document.body.textContent).toContain(text.previewTask); expect(document.body.textContent).toContain(text.factRequested); expect(document.body.textContent).toContain(text.factCompleted); expect(document.body.textContent).not.toContain('E2E_PRIVATE_DEFAULT');
});

it('真实任务面板旧取消闭包在store先收到COMMIT后也拒执行，不依赖hook事件晚到', async () => {
  useWorkspace.getState().onTask(event(fact('writing'))); await mount(); const cancel = document.querySelectorAll('button').find(node => node.textContent === zh.activity.text018); expect(cancel).toBeDefined(); const oldClick = props(cancel!).onClick;
  await act(async () => useWorkspace.getState().onTask(event(fact('commit-pending')))); await act(async () => oldClick());
  expect(request.mock.calls.some(call => call[0] === 'query.cancel')).toBe(false); expect(document.querySelectorAll('button').some(node => node.textContent === zh.activity.text018)).toBe(false); expect(document.body.textContent).toContain(text.cancelCommit);
  await act(async () => { for (const listener of listeners) listener(event(fact('commit-pending'))); }); expect(request.mock.calls.some(call => call[0] === 'query.cancel')).toBe(false);
});

it('挂载前已知unknown或commitMay也隐藏取消，即使可信读取迟到返回allowed', async () => {
  useWorkspace.setState({ tasks: [{ id: 'create', kind: 'sqlite.tableCreate.apply', status: 'running', progress: 0, message: '', startedAt: '2026-11-01T00:00:00Z', sqliteCreate: fact('unknown', { commitMayHaveBeenSent: false }) }] }); await mount(); expect(document.querySelectorAll('button').some(node => node.textContent === zh.activity.text018)).toBe(false); expect(document.body.textContent).toContain(text.cancelUnknown);
});
