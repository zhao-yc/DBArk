import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import type { SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import { sqliteImportTaskMessage } from '../../src/shared/sqliteTableImportFact';
import { sqliteImportTaskTitles } from '../../src/renderer/locales/sqliteWriteFact.zh-CN';
import { memoryDocument } from '../fixtures/memory-dom';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request }));
vi.mock('../../src/renderer/components/SavedQueriesDialog', () => ({ SavedQueriesDialog: () => null }));
vi.mock('../../src/renderer/components/HistoryPagesDialog', () => ({ HistoryPagesDialog: () => null }));
vi.mock('../../src/renderer/components/TableApplyReceiptsDialog', () => ({ TableApplyReceiptsDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), listeners = new Set<(event: TaskEvent) => void>();
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>, Tasks: typeof import('../../src/renderer/components/ActivityDialog')['TasksDialog'];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask(listener: (event: TaskEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } } });
  ({ useWorkspace } = await import('../../src/renderer/store')); baseline = useWorkspace.getState(); ({ createRoot } = await import('react-dom/client')); ({ TasksDialog: Tasks } = await import('../../src/renderer/components/ActivityDialog'));
});
beforeEach(() => { useWorkspace.setState({ tasks: [], queryFileTasks: {} }); request.mockImplementation(async (command: string, input: { taskIds?: string[] }) => { if (command === 'tasks.cancelState') return input.taskIds?.map(taskId => ({ taskId, state: 'allowed' })); throw Error('专项不允许额外IPC'); }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(baseline, true); request.mockReset(); listeners.clear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
const secret = 'PRIVATE_SOURCE_UI_913 D:/private/source.csv SELECT secret sha256';
/** 伪造写回执只用于确认来源检查无法借进度变成写任务，不发送任何原生SQL。 */
function fact(): SqliteWriteFact { return { operationId: '11111111-1111-4111-8111-111111111111', target: { connectionId: 'owned', database: 'main', table: '不属于来源检查' }, phase: 'committed', requestedRows: 1, appliedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }; }
function event(patch: Partial<TaskEvent> = {}): TaskEvent { return { taskId: 'source-task', status: 'running', progress: 20, message: secret, sqliteImportOperation: 'source', ...patch }; }

it.each(['running', 'completed', 'failed', 'cancelled'] as const)('真实store将source %s分类为只读来源概要，忽略事件内源值和写ACK', status => {
  const input = { ...event({ status, sqliteWrite: fact() }), sample: [{ value: secret }], source: { sha256: 'a'.repeat(64), bytes: 20 }, filePath: secret }; useWorkspace.getState().onTask(input);
  expect(useWorkspace.getState().tasks).toEqual([{ id: 'source-task', kind: 'sqlite.importSource.inspect', status, progress: 20, startedAt: expect.any(String), message: sqliteImportTaskMessage('sqlite.importSource.inspect', status) }]); expect(JSON.stringify(useWorkspace.getState().tasks)).not.toContain('PRIVATE_SOURCE_UI'); expect(useWorkspace.getState().queryFileTasks).toEqual({});
});

it('原source任务即使旧store夹带errors/源摘要/写ACK，后续事件仍只保最小只读概要', () => {
  const previous = { id: 'source-task', kind: 'sqlite.importSource.inspect', status: 'running' as const, progress: 5, startedAt: '2026-11-01T00:00:00Z', message: secret, errors: [secret], source: { sha256: 'a'.repeat(64), bytes: 20 }, sample: [{ value: secret }], sqliteWrite: fact() }; useWorkspace.setState({ tasks: [previous] });
  useWorkspace.getState().onTask(event({ sqliteImportOperation: undefined, status: 'completed', progress: 100 })); expect(useWorkspace.getState().tasks[0]).toEqual({ id: previous.id, kind: previous.kind, startedAt: previous.startedAt, status: 'completed', progress: 100, message: sqliteImportTaskMessage(previous.kind, 'completed') });
});

it('source事件不能接管原网络任务，也不能把同id的来源检查改成数据预检或写入', () => {
  const network: TaskRecord = { id: 'source-task', kind: 'query.execute', status: 'running', progress: 0, startedAt: '2026-11-01T00:00:00Z', message: '原网络任务' }; useWorkspace.setState({ tasks: [network] }); useWorkspace.getState().onTask(event()); expect(useWorkspace.getState().tasks[0]).toBe(network);
  useWorkspace.setState({ tasks: [] }); useWorkspace.getState().onTask(event()); const source = useWorkspace.getState().tasks[0];
  for (const stage of ['inspect', 'preview', 'apply'] as const) { useWorkspace.getState().onTask(event({ sqliteImportOperation: stage, sqliteWrite: fact() })); expect(useWorkspace.getState().tasks[0]).toBe(source); }
});

it('真实任务中心使用新来源中文标题，不展示路径/摘要/写回执或错误原文', async () => {
  useWorkspace.getState().onTask(event({ status: 'completed', progress: 100, sqliteWrite: fact() })); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<Tasks onClose={() => {}}/>));
  expect(document.body.textContent).toContain(sqliteImportTaskTitles.source); expect(document.body.textContent).toContain('尚未创建表或写入'); expect(document.body.textContent).not.toContain('PRIVATE_SOURCE_UI'); expect(document.body.textContent).not.toContain('SQLite 提交事实'); expect(document.body.textContent).not.toContain('sqlite.importSource.inspect');
});
