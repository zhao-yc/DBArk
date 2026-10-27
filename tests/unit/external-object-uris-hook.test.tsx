import { act, StrictMode, useLayoutEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument } from '../fixtures/memory-dom';
import { ExternalObjectUris } from '../../src/main/externalObjectUris';
import { externalObjectUriEmptySchema, externalObjectUriIdSchema } from '../../src/shared/externalObjectUris';
import { objectUri, type WorkbenchTarget } from '../../src/shared/workbench';
import type { ConnectionProfile } from '../../src/shared/contracts';

const port = vi.hoisted(() => ({ invoke: vi.fn(), uid: vi.fn() }));
// 仅替换IPC和随机编号，hook、consumer、统一导航及Zustand工作区均运行真实实现。
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke, uid: () => port.uid() }));

type WorkspaceModule = typeof import('../../src/renderer/store');
type ProbeProps = { ready?: boolean; blocked?: boolean; dialog?: boolean };
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const profile: ConnectionProfile = { id: '合成连接', name: '仅内存连接', group: '', color: '#336699', dialect: 'mysql', host: 'dbark-hook.invalid', port: 3306, user: 'offline' };
const target = (name = '系统目标表'): WorkbenchTarget => ({ connectionId: profile.id, database: '目标库', kind: 'table', name });
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
let workspace: WorkspaceModule, initialWorkspace: ReturnType<WorkspaceModule['useWorkspace']['getState']>;
let useExternalObjectUris: typeof import('../../src/renderer/useExternalObjectUris').useExternalObjectUris;
let createNavigation: typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation;
let navigation: ReturnType<typeof createNavigation>, queue: ExternalObjectUris<symbol>;
let listeners: Set<() => void>, reads: Array<{ target: WorkbenchTarget; complete(value: WorkbenchTarget): void }>;
let activeReads = 0, maximumReads = 0, strict = false;
const definitions = vi.fn();

/** 每个可控Promise代表一次真实Main状态机持有的原操作，不把取消当成完成。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** 按App的顺序激活导航，再运行真实hook及其effect清理。 */
function Probe({ ready = true, blocked = false, dialog = false }: ProbeProps) {
  useLayoutEffect(() => { navigation.activate(); return () => navigation.dispose(); }, []);
  useExternalObjectUris(ready, navigation.open, blocked);
  return <main>{dialog && <section role="dialog">已有表单</section>}系统链接测试工作区</main>;
}

beforeAll(async () => {
  document = memoryDocument();
  ({ createRoot } = await import('react-dom/client'));
  workspace = await import('../../src/renderer/store');
  ({ useExternalObjectUris } = await import('../../src/renderer/useExternalObjectUris'));
  ({ createWorkbenchNavigation: createNavigation } = await import('../../src/renderer/workbenchNavigation'));
  initialWorkspace = workspace.useWorkspace.getState();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  activeReads = 0; maximumReads = 0; strict = false; listeners = new Set(); reads = [];
  definitions.mockReset();
  let tabSequence = 0, requestSequence = 0;
  port.uid.mockReset().mockImplementation(() => `系统标签-${++tabSequence}`);
  workspace.useWorkspace.setState({
    ...initialWorkspace,
    notice: undefined,
    ready: true,
    settings: { ...initialWorkspace.settings, activeTabId: 'a', tabs: [
      { id: 'a', kind: 'query', title: '已有草稿A', connectionId: profile.id, database: '原库', sql: 'SELECT 1' },
      { id: 'b', kind: 'query', title: '已有任务B', connectionId: profile.id, database: '原库', sql: 'SELECT 2' },
    ] },
    connections: [profile], selection: { connectionId: profile.id, database: '原库' },
    dirtyTabs: { a: true }, activeJobs: { b: true },
  });
  navigation = createNavigation(definitions);
  const owner = Symbol('同一真实文档的多次IPC');
  queue = new ExternalObjectUris<symbol>({
    revision: () => 1,
    assertOwner: value => { if (value !== owner) throw Error('错误文档'); },
    sameOwner: (left, right) => left === right,
    uid: () => `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, '0')}`,
    notify: () => { for (const listener of [...listeners]) listener(); },
    resolve: async (value, assertCurrent) => {
      activeReads++; maximumReads = Math.max(maximumReads, activeReads);
      const read = deferred<WorkbenchTarget>();
      reads.push({ target: value, complete: read.resolve });
      try { const result = await read.promise; assertCurrent(); return result; }
      finally { activeReads--; }
    },
  });
  Object.defineProperty(window, 'dbark', { configurable: true, value: {
    onObjectUri: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } });
  port.invoke.mockReset().mockImplementation(async (command: string, input: unknown) => {
    switch (command) {
      case 'workbench.protocolReady': externalObjectUriEmptySchema.parse(input); return queue.ready(owner);
      case 'workbench.protocolTake': externalObjectUriEmptySchema.parse(input); return queue.take(owner);
      case 'workbench.protocolResolve': return queue.resolve(owner, externalObjectUriIdSchema.parse(input).id);
      case 'workbench.protocolCommit': return queue.commit(owner, externalObjectUriIdSchema.parse(input).id);
      case 'workbench.protocolFinish': return queue.finish(owner, externalObjectUriIdSchema.parse(input).id);
      case 'settings.save': return;
      default: throw Error('本例禁止其它IPC：' + command);
    }
  });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  // 清理仅结束本例RAM端口；不投递新意图，也不涉及数据库或系统窗口。
  await act(async () => { for (const read of reads) read.complete(read.target); });
  queue.close();
  document.body.textContent = '';
  vi.clearAllTimers(); vi.useRealTimers();
});
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** React自身结算effect及微任务，不使用轮询或手动调用hook内部回调。 */
async function render(props: ProbeProps = {}) {
  await act(async () => { root!.render(strict ? <StrictMode><Probe {...props}/></StrictMode> : <Probe {...props}/>); });
}
async function mount(props: ProbeProps = {}, strictMode = false) {
  strict = strictMode;
  const host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host as unknown as HTMLElement);
  await render(props);
}
async function complete(index = 0) {
  const read = reads[index];
  if (!read) throw Error('原元数据核验尚未开始');
  await act(async () => read.complete(read.target));
}
const calls = (command: string) => port.invoke.mock.calls.filter(call => call[0] === command).length;
const openedTables = () => workspace.useWorkspace.getState().settings.tabs.filter(tab => tab.kind === 'table').map(tab => tab.table);

it('冷链接先保留，工作区ready后握手并且仅通过原核验打开一次，已有草稿和任务保留', async () => {
  queue.receiveUrl(objectUri(target()));
  await mount({ ready: false });
  expect(listeners.size).toBe(0); expect(calls('workbench.protocolReady')).toBe(0); expect(reads).toHaveLength(0);
  await render({ ready: true });
  expect(listeners.size).toBe(1); expect(calls('workbench.protocolReady')).toBe(1); expect(calls('workbench.protocolTake')).toBe(1); expect(reads).toHaveLength(1);
  expect(openedTables()).toEqual([]);
  await complete();
  expect(openedTables()).toEqual(['系统目标表']);
  expect(calls('workbench.protocolCommit')).toBe(1); expect(calls('workbench.protocolFinish')).toBe(1);
  const current = workspace.useWorkspace.getState();
  expect(current.selection).toEqual({ connectionId: profile.id, database: '目标库' });
  expect(current.dirtyTabs.a).toBe(true); expect(current.activeJobs.b).toBe(true);
  expect(current.settings.tabs.slice(0, 2).map(tab => tab.sql)).toEqual(['SELECT 1', 'SELECT 2']);
  expect(definitions).not.toHaveBeenCalled();
});

it('手动活动页A→B→A仍使原意图永久失效，不因恢复相同值而投影迟到结果', async () => {
  queue.receiveUrl(objectUri(target())); await mount();
  expect(reads).toHaveLength(1);
  const originalTabs = workspace.useWorkspace.getState().settings.tabs;
  const originalSelection = workspace.useWorkspace.getState().selection;
  await act(async () => {
    workspace.useWorkspace.getState().updateSettings({ activeTabId: 'b' });
    workspace.useWorkspace.getState().updateSettings({ activeTabId: 'a' });
  });
  await complete();
  const current = workspace.useWorkspace.getState();
  expect(current.settings.activeTabId).toBe('a'); expect(current.settings.tabs).toBe(originalTabs); expect(current.selection).toBe(originalSelection);
  expect(openedTables()).toEqual([]); expect(calls('workbench.protocolCommit')).toBe(0); expect(calls('workbench.protocolFinish')).toBe(1);
  expect(current.notice).toBeUndefined(); expect(current.dirtyTabs.a).toBe(true);
});

it('仅notice、任务进度和busy变化不撤销原导航，也不改写已有工作', async () => {
  queue.receiveUrl(objectUri(target())); await mount();
  expect(reads).toHaveLength(1);
  await act(async () => {
    workspace.useWorkspace.getState().notify('已有任务进度提示');
    workspace.useWorkspace.getState().onTask({ taskId: '原任务', status: 'running', progress: 37, message: '已有任务仍在运行' });
    workspace.useWorkspace.getState().setBusy('b', true);
  });
  await complete();
  const current = workspace.useWorkspace.getState();
  expect(openedTables()).toEqual(['系统目标表']); expect(calls('workbench.protocolCommit')).toBe(1);
  expect(current.notice).toEqual({ text: '已有任务进度提示', error: false });
  expect(current.tasks[0]).toMatchObject({ id: '原任务', status: 'running', progress: 37 });
  expect(current.activeJobs.b).toBe(true); expect(current.dirtyTabs.a).toBe(true); expect(maximumReads).toBe(1);
});

it('blocked和实际模态均解除后的真实layout提交只唤醒一次，不轮询元数据', async () => {
  queue.receiveUrl(objectUri(target())); await mount({ blocked: true, dialog: true });
  expect(calls('workbench.protocolReady')).toBe(1); expect(calls('workbench.protocolTake')).toBe(0); expect(reads).toHaveLength(0);
  await render({ blocked: true, dialog: true });
  await render({ blocked: false, dialog: true });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(reads).toHaveLength(0); expect(calls('workbench.protocolTake')).toBe(0);
  // 内存DOM没有原生MutationObserver，本例验证真实React移除模态后的layout wake。
  await render({ blocked: false, dialog: false });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(reads).toHaveLength(1); expect(calls('workbench.protocolTake')).toBe(1);
  await render({ blocked: false }); await render({ blocked: false });
  expect(reads).toHaveLength(1); expect(calls('workbench.protocolReady')).toBe(1);
  await complete();
  expect(openedTables()).toEqual(['系统目标表']); expect(calls('workbench.protocolCommit')).toBe(1); expect(maximumReads).toBe(1);
});

it('dispose后原resolve迟到只完成原编号收尾，不能修改工作区或发布旧通知', async () => {
  queue.receiveUrl(objectUri(target())); await mount();
  expect(reads).toHaveLength(1);
  const current = workspace.useWorkspace.getState(), settings = current.settings, selection = current.selection;
  await act(async () => root!.unmount()); root = undefined;
  expect(listeners.size).toBe(0);
  await complete();
  expect(workspace.useWorkspace.getState().settings).toBe(settings); expect(workspace.useWorkspace.getState().selection).toBe(selection);
  expect(workspace.useWorkspace.getState().notice).toBeUndefined(); expect(openedTables()).toEqual([]);
  expect(calls('workbench.protocolCommit')).toBe(0); expect(calls('workbench.protocolFinish')).toBe(1); expect(activeReads).toBe(0);
});

it('StrictMode重建及ready重新挂接仍等待原Main Promise，旧读取未收尾不并发新核验', async () => {
  queue.receiveUrl(objectUri(target('旧目标'))); await mount({}, true);
  expect(calls('workbench.protocolReady')).toBe(2); expect(listeners.size).toBe(1); expect(reads).toHaveLength(1);
  await render({ ready: false }); expect(listeners.size).toBe(0);
  await render({ ready: true }); expect(listeners.size).toBe(1);
  await act(async () => queue.receiveUrl(objectUri(target('新目标'))));
  expect(reads).toHaveLength(1); expect(activeReads).toBe(1); expect(maximumReads).toBe(1);
  await complete(0);
  expect(reads).toHaveLength(2); expect(activeReads).toBe(1); expect(maximumReads).toBe(1); expect(openedTables()).toEqual([]);
  expect(calls('workbench.protocolCommit')).toBe(0);
  await complete(1);
  expect(openedTables()).toEqual(['新目标']); expect(calls('workbench.protocolCommit')).toBe(1); expect(calls('workbench.protocolFinish')).toBe(2);
  expect(activeReads).toBe(0); expect(maximumReads).toBe(1); expect(listeners.size).toBe(1);
});
