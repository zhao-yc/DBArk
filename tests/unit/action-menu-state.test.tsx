import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { installNavigationMenuRamPort, navigationMenuRamButton, navigationMenuRamInput } from '../helpers/navigationMenuRamPort';
import type { QueryResultSnapshotOperation } from '../../src/renderer/components/QueryResultSnapshotActions';
import { queryResultSnapshotUiZh as text } from '../../src/renderer/locales/queryResultSnapshot.zh-CN';
let ActionMenu: typeof import('../../src/renderer/components/ActionMenu')['ActionMenu'], ActionMenuSection: typeof import('../../src/renderer/components/ActionMenu')['ActionMenuSection'];
let QueryResultSnapshotActions: typeof import('../../src/renderer/components/QueryResultSnapshotActions')['QueryResultSnapshotActions'];
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, restore: () => void;
let createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let originalSettings: ReturnType<typeof import('../../src/renderer/store')['useWorkspace']['getState']>['settings'];
beforeAll(async () => { document = memoryDocument(); restore = installNavigationMenuRamPort(document); ({ createRoot } = await import('react-dom/client')); ({ ActionMenu, ActionMenuSection } = await import('../../src/renderer/components/ActionMenu')); ({ QueryResultSnapshotActions } = await import('../../src/renderer/components/QueryResultSnapshotActions')); ({ useWorkspace } = await import('../../src/renderer/store')); originalSettings = useWorkspace.getState().settings; });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; useWorkspace.setState({ settings: originalSettings }); });
afterAll(() => { restore(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mount(node: React.ReactNode) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(node)); }
function button(label: string): MemoryNode { const node = navigationMenuRamButton(document.body, label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }

it('菜单关闭不渲染旧操作，真实更多及子菜单只调用一次原动作', async () => {
  const execute = vi.fn(); await mount(<ActionMenu label="更多"><ActionMenuSection label="分组"><button onClick={execute}>执行原操作</button></ActionMenuSection></ActionMenu>);
  expect(document.body.querySelectorAll('button').map(node => node.textContent)).toEqual(['更多']);
  await click('执行原操作'); expect(execute).toHaveBeenCalledOnce(); expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.body.querySelectorAll('button').map(node => node.textContent)).toEqual(['更多']);
});

it('原目标换代并恢复相同文字后，捕获的旧菜单回调永久失效', async () => {
  const execute = vi.fn(); let change!: (value: string) => void;
  function View() { const [context, setContext] = React.useState('A'); change = setContext; return <ActionMenu label="更多" contextKey={context}><button onClick={execute}>原动作</button></ActionMenu>; }
  await mount(<View/>); const original = button('原动作');
  const key = Object.keys(original).find(key => key.startsWith('__reactProps$'))!;
  const stale = (original as any)[key].onClick;
  await act(async () => { change('B'); }); await act(async () => { change('A'); stale(new MemoryEvent('click')); });
  expect(execute).not.toHaveBeenCalled(); await click('原动作'); expect(execute).toHaveBeenCalledOnce();
});

it('同一批次活动scope A到B再回A，未提交中间渲染也永久撤销旧菜单及旧回调', async () => {
  const execute = vi.fn(), rendered: string[] = [];
  useWorkspace.setState({ settings: { ...originalSettings, activeTabId: 'A' } });
  function View() { const active = useWorkspace(state => state.settings.activeTabId ?? ''); rendered.push(active); return <ActionMenu label="更多" contextKey={active} isCurrent={() => useWorkspace.getState().settings.activeTabId === 'A'}><button onClick={execute}>原动作</button></ActionMenu>; }
  await mount(<View/>); const original = button('原动作'), key = Object.keys(original).find(key => key.startsWith('__reactProps$'))!;
  const stale = (original as any)[key].onClick;
  await act(async () => {
    useWorkspace.setState(state => ({ settings: { ...state.settings, activeTabId: 'B' } }));
    useWorkspace.setState(state => ({ settings: { ...state.settings, activeTabId: 'A' } }));
    stale(new MemoryEvent('click'));
  });
  expect(rendered).not.toContain('B'); expect(execute).not.toHaveBeenCalled(); expect(document.body.querySelector('[role="menu"]')).toBeNull();
  await click('原动作'); expect(execute).toHaveBeenCalledOnce();
});

it('同scope结果上限变化保持菜单和受控输入，不能因普通偏好通知关闭菜单', async () => {
  useWorkspace.setState({ settings: { ...originalSettings, activeTabId: 'A', resultLimit: 1000 } });
  function View() { const settings = useWorkspace(state => state.settings); return <ActionMenu label="更多" contextKey={settings.activeTabId} isCurrent={() => useWorkspace.getState().settings.activeTabId === 'A'}><label>合成上限<input aria-label="合成上限" type="number" value={settings.resultLimit} onChange={event => useWorkspace.setState(state => ({ settings: { ...state.settings, resultLimit: Number(event.target.value) } }))}/></label></ActionMenu>; }
  await mount(<View/>); const input = navigationMenuRamInput(document.body, '合成上限'); expect(input).toBeDefined();
  const key = Object.keys(input!).find(key => key.startsWith('__reactProps$'))!, change = (input as any)[key].onChange;
  await act(async () => change({ target: { value: '2' } }));
  expect(storeLimit()).toBe(2); expect(Number(input!.value)).toBe(2); expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  function storeLimit() { return useWorkspace.getState().settings.resultLimit; }
});

it('快照动作移入按需菜单后，菜单关闭仍保留原IO占用及正常收尾', async () => {
  let finish!: (value: { name: string }) => void; const waiting = new Promise<{ name: string }>(resolve => { finish = resolve; });
  const owner: QueryResultSnapshotOperation = { result: { statement: 'SELECT 仅来源', columns: [{ key: 'id', name: 'id', type: 'BIGINT' }], rows: [{ id: '9007199254740993' }], truncated: false, elapsedMs: 1 }, current: () => true, invalidate: vi.fn(), finish: vi.fn(), adopt: vi.fn(), uncertain: vi.fn(), reportError: vi.fn() };
  const save = vi.fn(() => waiting), begin = vi.fn(() => owner);
  await mount(<QueryResultSnapshotActions result={owner.result} disabled={false} begin={begin} services={{ open: vi.fn(async () => null), save }} renderActions={actions => <ActionMenu label="更多"><ActionMenuSection label="快照">{actions}</ActionMenuSection></ActionMenu>}/>);
  await click(text.save); expect(save).toHaveBeenCalledOnce(); expect(document.body.querySelector('[role="menu"]')).toBeNull(); expect(owner.invalidate).not.toHaveBeenCalled(); expect(owner.finish).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(text.working); expect(button(text.cancel)).toBeDefined();
  await act(async () => finish({ name: '仅RAM.json' })); expect(owner.finish).toHaveBeenCalledOnce(); expect(owner.uncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.saved);
});
