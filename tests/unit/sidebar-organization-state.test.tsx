import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { completionServerFacts } from '../../src/renderer/completionServerFacts';
import { zh } from '../../src/renderer/locales/zh-CN';
import { importNewTableZh } from '../../src/renderer/locales/importNewTable.zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Sidebar: typeof import('../../src/renderer/components/Sidebar')['Sidebar'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], useWorkbench: typeof import('../../src/renderer/workbench')['useWorkbench'];
let SidebarTreeProvider: typeof import('../../src/renderer/components/SidebarContextMenu')['SidebarTreeProvider'];
let useSidebarSelection: typeof import('../../src/renderer/components/SidebarContextMenu')['useSidebarSelection'];
let selectedTarget: import('../../src/renderer/components/SidebarContextMenu').SidebarNodeTarget | undefined;
let currentTarget: ReturnType<typeof useSidebarSelection>['current'];

/** 只旁观Provider公开的选择合同，不读取React内部状态或替代原菜单事件。 */
function SelectionProbe() { const selection = useSidebarSelection(); selectedTarget = selection.target; currentTarget = selection.current; return null; }
type Node = ReturnType<typeof memoryDocument>['body'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'MutationObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const connectedDescriptor = Object.getOwnPropertyDescriptor(MemoryNode.prototype, 'isConnected');
beforeAll(async () => {
  document = memoryDocument();
  // 本文件只核真实React事件、菜单目标和请求；布局/原生焦点与MutationObserver时序由专项和E2E覆盖。
  Object.defineProperty(MemoryNode.prototype, 'isConnected', { configurable: true, get() { return this.getRootNode() === document; } });
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} takeRecords() { return []; } } });
  ({ createRoot } = await import('react-dom/client')); ({ useWorkspace } = await import('../../src/renderer/store')); ({ useWorkbench } = await import('../../src/renderer/workbench')); ({ Sidebar } = await import('../../src/renderer/components/Sidebar'));
  ({ SidebarTreeProvider, useSidebarSelection } = await import('../../src/renderer/components/SidebarContextMenu'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; delete (window as any).dbark; completionServerFacts.clear('a'); completionServerFacts.clear('b'); vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); if (connectedDescriptor) Object.defineProperty(MemoryNode.prototype, 'isConnected', connectedDescriptor); else Reflect.deleteProperty(MemoryNode.prototype, 'isConnected'); });

/** 使用真实Sidebar/子节点及Zustand，仅把IPC替换为明确可结算的RAM端口。 */
async function mount(onImportNewTable?: (connectionId: string, database: string) => void) {
  const profiles: ConnectionProfile[] = ['a', 'b'].map(id => ({ id, name: `连接${id}`, group: id === 'a' ? '原组' : '目标组', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'ram' }));
  useWorkspace.setState({ connections: profiles, connectionVersions: {}, selection: undefined, activeJobs: {}, settings: { ...useWorkspace.getState().settings, tabs: [], activeTabId: undefined } });
  useWorkbench.setState({ ready: true, busy: false, snapshot: { revision: 0, document: { ...useWorkbench.getState().snapshot.document, groups: [], favorites: [{ id: '本例收藏', label: '收藏库', groupId: null, target: { connectionId: 'a', kind: 'database', database: '收藏库' } }] } } });
  const calls: { command: string; input: unknown; resolve(value: unknown): void }[] = [];
  const invoke = vi.fn((command: string, input: unknown) => {
    if (!['connections.open', 'metadata.databases', 'metadata.objects'].includes(command)) throw Error('禁止其它IPC：' + command);
    return new Promise(resolve => calls.push({ command, input, resolve }));
  });
  (window as any).dbark = { invoke };
  const noop = () => {}, props = { onNewConnection: noop, onEditConnection: noop, onCopyConnection: noop, onImportNewTable, onDesign: noop, onColumnPatches: noop, onIndexPatches: noop, onForeignKeyPatches: noop, onTableRename: noop, onTableAutoIncrement: noop, onTableComment: noop, onTableDefaultEncoding: noop, onDdl: noop, onOpenWorkbench: async () => true };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = async (refreshVersion = 0) => { await act(async () => root!.render(<SidebarTreeProvider><Sidebar {...props} refreshVersion={refreshVersion}/><SelectionProbe/></SidebarTreeProvider>)); };
  await render();
  return { calls, invoke, render, async settle(index: number, value: unknown) { await act(async () => calls[index].resolve(value)); }, async move(group: string, color = '#123456') { await act(async () => useWorkspace.getState().setConnections(useWorkspace.getState().connections.map(profile => profile.id === 'a' ? { ...profile, group, color } : profile))); } };
}
/** 所有交互投递给真实ReactDOM事件委派，不调用节点内部函数或写其状态。 */
async function click(node: Node) { await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 通过真实React右键事件和Portal菜单查找动作，不读取actions属性或组件内部回调。 */
async function menuAction(label: Node, name: string) {
  await act(async () => { const event = new MemoryEvent('contextmenu'); event.button = 2; label.dispatchEvent(event); });
  const menu = document.querySelector('[role="menu"]'); expect(menu).not.toBeNull();
  const entry = menu!.querySelectorAll('button').find(node => node.getAttribute('role') === 'menuitem' && node.getAttribute('aria-label') === name); expect(entry).toBeDefined(); return entry!;
}
function connection() { const button = document.querySelectorAll('button').find(node => node.getAttribute('aria-expanded') !== null && node.textContent === '连接a'); expect(button).toBeDefined(); return button!; }
function connected(button: Node) { return button.querySelectorAll('span').some(node => (node.getAttribute('class') ?? '').split(' ').includes('connection-dot')); }
function busy(button: Node) { return button.getAttribute('aria-busy'); }
function status() { return { connectionId: 101, dialect: 'mysql', version: '8.4.11' }; }
function commands(f: Awaited<ReturnType<typeof mount>>) { return f.calls.map(call => call.command); }

it('数据库级从文件导入新表入口传递准确原目标，点击不创建表或查询记录', async () => {
  const open = vi.fn(), f = await mount(open); await click(connection()); await f.settle(0, status()); await f.settle(1, ['原数据库']);
  const database = document.querySelectorAll('button').find(node => node.textContent === '原数据库')!;
  const entry = await menuAction(database, `${importNewTableZh.title} 原数据库`);
  await click(entry!); expect(open).toHaveBeenCalledExactlyOnceWith('a', '原数据库'); expect(commands(f)).toEqual(['connections.open', 'metadata.databases']);
});

it('共享选择区分同名表视图，右键不接管另一连接的查询或发送请求，配置ABA不复活旧对象', async () => {
  const f = await mount(); await click(connection()); await f.settle(0, status()); await f.settle(1, ['原数据库']);
  const database = document.querySelectorAll('button').find(node => node.textContent === '原数据库')!;
  await click(database); await f.settle(2, [{ name: '同名对象', kind: 'table' }, { name: '同名对象', kind: 'view' }]);
  const query = { id: '原查询', kind: 'query' as const, title: '保留原编辑区', connectionId: 'b', database: '另一数据库', sql: 'SELECT 1;' };
  await act(async () => useWorkspace.setState({ settings: { ...useWorkspace.getState().settings, tabs: [query], activeTabId: query.id } }));
  const before = f.calls.length;
  for (const [kind, title] of [['table', '表'], ['view', '视图']] as const) {
    const row = document.querySelectorAll('button').find(node => node.getAttribute('title') === `${title} · 同名对象`)!;
    expect(row).toBeDefined();
    await act(async () => { const event = new MemoryEvent('contextmenu'); event.button = 2; row.dispatchEvent(event); });
    expect(selectedTarget).toEqual({ connectionId: 'a', database: '原数据库', kind, name: '同名对象' });
    expect(currentTarget()).toBe(selectedTarget);
    expect(useWorkspace.getState().selection).toEqual({ connectionId: 'a', database: '原数据库' });
    expect(useWorkspace.getState().settings.activeTabId).toBe(query.id);
    expect(useWorkspace.getState().settings.tabs[0]).toBe(query);
    expect(f.calls).toHaveLength(before);
  }
  const oldTarget = currentTarget(), original = useWorkspace.getState().connections.find(item => item.id === 'a')!;
  await f.move('目标组');
  expect(currentTarget()).toEqual({ kind: 'database', connectionId: 'a', database: '原数据库' });
  await act(async () => useWorkspace.getState().setConnections(useWorkspace.getState().connections.map(item => item.id === 'a' ? original : item)));
  expect(currentTarget()).not.toBe(oldTarget); expect(currentTarget()?.kind).toBe('database');
  expect(useWorkspace.getState().settings.tabs[0]).toBe(query); expect(f.calls).toHaveLength(before);
});

it('已展开且已连接的节点换组或改色保留原DOM、数据库对象树和收藏Shelf，不重连', async () => {
  const f = await mount(), original = connection(), shelf = document.querySelectorAll('section').find(node => node.getAttribute('class') === 'workbench-shelf');
  await click(original); await f.settle(0, status()); await f.settle(1, ['原数据库']);
  const database = document.querySelectorAll('button').find(node => node.textContent === '原数据库')!; await click(database); await f.settle(2, [{ name: '原数据表', kind: 'table' }]);
  expect(connected(original)).toBe(true); expect(original.getAttribute('aria-expanded')).toBe('true'); expect(document.body.textContent).toContain('原数据表');
  await f.move('目标组');
  expect(connection() === original).toBe(true); expect(connected(connection())).toBe(true); expect(connection().getAttribute('aria-expanded')).toBe('true'); expect(document.body.textContent).toContain('原数据表');
  await f.move('目标组', '#abcdef');
  expect(connection() === original).toBe(true); expect(connected(connection())).toBe(true); expect(document.body.textContent).toContain('原数据表');
  expect(original.querySelectorAll('svg').some(node => (node.style as unknown as { color?: string }).color === '#abcdef')).toBe(true);
  expect(document.querySelectorAll('section').find(node => node.getAttribute('class') === 'workbench-shelf') === shelf).toBe(true);
  expect(commands(f)).toEqual(['connections.open', 'metadata.databases', 'metadata.objects']);
});

it.each(['connections.open', 'metadata.databases'])('%s在途跨组及分组ABA后保留busy和原owner，正常回包仍展开且不重复请求', async stage => {
  const f = await mount(), original = connection(); await click(original);
  if (stage === 'metadata.databases') await f.settle(0, status());
  expect(busy(original)).toBe('true');
  for (const group of ['目标组', '原组', '目标组']) { await f.move(group); expect(connection() === original).toBe(true); expect(busy(connection())).toBe('true'); }
  if (stage === 'connections.open') await f.settle(0, status());
  await f.settle(1, ['完成数据库']);
  expect(connection() === original).toBe(true); expect(busy(connection())).toBe('false'); expect(connected(connection())).toBe(true); expect(connection().getAttribute('aria-expanded')).toBe('true'); expect(document.body.textContent).toContain('完成数据库');
  expect(commands(f)).toEqual(['connections.open', 'metadata.databases']);
});

it.each(['connections.open', 'metadata.databases'])('真实connectionVersion换代仍重挂并撤销旧%s回包，旧finally不清新busy', async stage => {
  const f = await mount(), original = connection(); await click(original); if (stage === 'metadata.databases') await f.settle(0, status());
  const oldPending = stage === 'connections.open' ? 0 : 1, nextOpen = f.calls.length;
  await act(async () => useWorkspace.getState().invalidateConnection('a'));
  const replacement = connection(); expect(replacement).not.toBe(original); expect(busy(replacement)).toBe('false'); await click(replacement);
  await f.settle(oldPending, stage === 'connections.open' ? status() : ['旧数据库']);
  expect(connection() === replacement).toBe(true); expect(busy(replacement)).toBe('true'); expect(f.calls).toHaveLength(nextOpen + 1); expect(document.body.textContent).not.toContain('旧数据库');
  await f.settle(nextOpen, status()); await f.settle(nextOpen + 1, ['新数据库']);
  expect(busy(replacement)).toBe('false'); expect(document.body.textContent).toContain('新数据库'); expect(commands(f).filter(command => command === 'connections.close')).toHaveLength(0);
});

it('主动连接刷新仍真实请求，外部refreshVersion换代仍撤销旧owner', async () => {
  const f = await mount(), original = connection(); await click(original); await f.settle(0, status()); await f.settle(1, ['原数据库']);
  const refresh = await menuAction(original, zh.sidebar.text011);
  await click(refresh); expect(commands(f)).toEqual(['connections.open', 'metadata.databases', 'connections.open']); expect(busy(original)).toBe('true');
  await f.render(1); const replacement = connection(); expect(replacement).not.toBe(original); await f.settle(2, status()); expect(f.calls).toHaveLength(3); expect(busy(replacement)).toBe('false'); expect(replacement.getAttribute('aria-expanded')).toBe('false');
  await click(replacement); await f.settle(3, status()); await f.settle(4, ['刷新数据库']); expect(document.body.textContent).toContain('刷新数据库'); expect(commands(f).includes('connections.close')).toBe(false);
});
