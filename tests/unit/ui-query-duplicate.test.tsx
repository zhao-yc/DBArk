import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
let restoreNavigationMenuPort: () => void = () => {};
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { queryDuplicateZh as text } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
const io = vi.hoisted(() => ({ entries: [] as { editor: ContentEditorPort; model: ContentModelPort }[] }));
/** 只替换Monaco widget端口；真实QueryTab、正文桥、控制器、store与ReactDOM保留。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { useEffect, useLayoutEffect, useRef, createElement } = await import('react');
  const { ContentEditorPort, ContentModelPort } = await import('./editor-content-test-ports');
  const { editorContentBridge } = await import('../../src/renderer/editorContentBridge');
  return { SqlEditor(props: any) {
    const latest = useRef(props); useLayoutEffect(() => { latest.current = props; });
    useEffect(() => {
      const model = new ContentModelPort(props.value), editor = Object.assign(new ContentEditorPort(model), { getSelection: () => null }); io.entries.push({ editor, model });
      const bridge = editorContentBridge(editor as any, () => latest.current, () => {}); if (bridge.ready) props.onReady?.(editor);
      return () => { bridge.dispose(); editor.dispose(); };
    }, []); return createElement('div', { 'aria-label': '内存SQL编辑器' });
  } };
});
let document: ReturnType<typeof memoryDocument>, root: ReturnType<typeof import('react-dom/client')['createRoot']> | undefined, createRoot: typeof import('react-dom/client')['createRoot'];
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
let commands: { command: string; input: any }[], hook: undefined | ((command: string, input: any) => Promise<any> | undefined);
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => { document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store')); });
afterEach(async () => { hook = undefined; if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); document.body.textContent = ''; });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 全部外界调用为RAM回执，复制阶段只允许普通settings.save及原会话协议缓存读取。 */
async function mount(context: any = { state: 'known', database: 'sales' }) {
  commands = []; io.entries = []; hook = undefined; let session = 0;
  (window as any).dbark = { onMenu: () => () => {}, onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push({ command, input }); const waited = hook?.(command, input); if (waited) return waited;
    if (command === 'settings.save' || command === 'sessions.close') return;
    if (command === 'connections.open') return {};
    if (command === 'sessions.open') return { sessionId: `independent-${++session}` };
    if (command === 'query.execute') return { results: [], elapsedMs: 1, transactionOpen: true };
    if (command === 'query.completionState') return { databaseKnown: true, database: 'runtime_db', broken: false, busy: false };
    throw Error('复制测试禁止额外外界调用：' + command);
  } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'source', tabs: [{ id: 'source', kind: 'query', title: '已保存源', connectionId: 'c', database: 'stale_legacy', databaseContext: context, sql: 'SELECT 旧缓存;', sourceBinding: { id: 'saved-query', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: 'sales' } } }] }, connections: [{ id: 'c', name: 'RAM连接', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql', database: 'profile_default', color: '', group: '' }], activeJobs: {}, dirtyTabs: {}, connectionVersions: {}, tasks: [], notice: undefined });
  function View() { const settings = useWorkspace(state => state.settings); return <>{settings.tabs.map(tab => <section key={tab.id} data-copy-tab={tab.id} hidden={settings.activeTabId !== tab.id}><QueryTab tab={tab} onHistory={() => {}}/></section>)}</>; }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<View/>));
}
function button(tabId: string, action: string = text.action) { const section = document.body.querySelector(`[data-copy-tab="${tabId}"]`)!; return (navigationMenuRamButton(section, action) ?? section.querySelectorAll('button').find(node => action === text.action ? node.getAttribute('aria-label') === action : node.textContent.startsWith(action)))!; }
async function click(tabId: string, action: string = text.action) { const node = button(tabId, action); expect(node).toBeDefined(); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('真实查询标签复制入口（RAM组件）', () => {
  it('按钮从正文桥flush最新未交付输入；已保存源不变，新标签只有独立未保存草稿字段', async () => {
    await mount(); const source = useWorkspace.getState().settings.tabs[0], binding = source.sourceBinding, entry = io.entries[0]; entry.model.deferred = true; entry.editor.nativeInput('SELECT 刚输入的全文;'); const version = entry.model.version;
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 旧缓存;'); await click('source'); const state = useWorkspace.getState(), target = state.settings.tabs[1];
    expect(target).toMatchObject({ kind: 'query', title: '已保存源（副本）', connectionId: 'c', sql: 'SELECT 刚输入的全文;', database: 'sales', databaseContext: { state: 'known', database: 'sales' } }); expect(target.id).not.toBe(source.id); expect(target.sourceBinding).toBeUndefined(); expect(Object.keys(target).sort()).toEqual(['connectionId', 'database', 'databaseContext', 'id', 'kind', 'sql', 'title']);
    expect(state.settings.tabs[0].sourceBinding).toBe(binding); expect(state.settings.tabs[0].title).toBe(source.title); expect(entry.model.version).toBe(version); expect(entry.model.controlledEdits).toBe(0); expect(entry.editor.undoStops).toBe(0); expect(state.settings.activeTabId).toBe(target.id); expect(state.dirtyTabs).toEqual({}); expect(commands.every(item => item.command === 'settings.save')).toBe(true);
  });
  it('明确无库不能落回连接默认库，未知上下文拒绝另开', async () => {
    await mount({ state: 'known', database: null }); await click('source'); expect(useWorkspace.getState().settings.tabs[1].databaseContext).toEqual({ state: 'known', database: null }); expect(useWorkspace.getState().settings.tabs[1].database).toBeUndefined();
  });
  it('未知上下文保留原查询并提示，不创建目标或执行SQL', async () => { await mount({ state: 'unknown' }); await click('source'); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(document.body.textContent).toContain(text.contextUnknown); expect(commands.every(item => item.command === 'settings.save')).toBe(true); });
  it('已运行源只读原session协议缓存；复制不继承事务/任务，新标签首次执行另开session', async () => {
    await mount(); await click('source', zh.query.text010); expect(useWorkspace.getState().dirtyTabs.source).toBe(true); const binding = useWorkspace.getState().settings.tabs[0].sourceBinding, before = commands.length; await click('source'); const target = useWorkspace.getState().settings.tabs[1];
    expect(target.databaseContext).toEqual({ state: 'known', database: 'runtime_db' }); expect(target.sourceBinding).toBeUndefined(); expect(useWorkspace.getState().dirtyTabs[target.id]).toBeUndefined(); expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBe(binding); expect(useWorkspace.getState().dirtyTabs.source).toBe(true); expect(commands.slice(before).every(item => ['settings.save', 'query.completionState'].includes(item.command))).toBe(true);
    expect(commands.filter(item => item.command === 'sessions.open')).toHaveLength(1); await click(target.id, zh.query.text010); expect(commands.filter(item => item.command === 'sessions.open')).toHaveLength(2); expect(commands.filter(item => item.command === 'query.execute').map(item => item.input.sessionId)).toEqual(['independent-1', 'independent-2']);
  });
  it.each(['关闭', '换连', '修订ABA', '删连接', '新编辑'] as const)('协议缓存等待时%s拒绝迟到复制，不复活源或新建目标', async kind => {
    await mount(); await click('source', zh.query.text010); const wait = deferred<any>(); hook = command => command === 'query.completionState' ? wait.promise : undefined;
    await click('source'); expect(button('source').getAttribute('disabled')).not.toBeNull(); await act(async () => {
      const state = useWorkspace.getState(); if (kind === '关闭') state.closeTab('source'); if (kind === '换连') state.updateTab('source', { connectionId: 'other' }); if (kind === '修订ABA') { state.invalidateConnection('c'); useWorkspace.setState({ connectionVersions: {} }); } if (kind === '删连接') state.setConnections([]); if (kind === '新编辑') io.entries[0].editor.nativeInput('SELECT 新文本;');
    });
    await act(async () => wait.resolve({ databaseKnown: true, database: 'runtime_db', broken: false, busy: false })); expect(useWorkspace.getState().settings.tabs).toHaveLength(kind === '关闭' ? 0 : 1); expect(commands.filter(item => item.command === 'sessions.open')).toHaveLength(1);
  });
  it('重复点击等待中的复制只读一次上下文；修订变化后的旧视图禁用入口', async () => {
    await mount(); await click('source', zh.query.text010); const wait = deferred<any>(); hook = command => command === 'query.completionState' ? wait.promise : undefined; const before = commands.length;
    await click('source'); await click('source'); expect(commands.slice(before).filter(item => item.command === 'query.completionState')).toHaveLength(1); await act(async () => wait.resolve({ databaseKnown: true, database: 'runtime_db', broken: false, busy: false })); expect(useWorkspace.getState().settings.tabs).toHaveLength(2);
    await act(async () => { useWorkspace.getState().invalidateConnection('c'); useWorkspace.getState().updateSettings({ activeTabId: 'source' }); }); expect(button('source').getAttribute('disabled')).not.toBeNull();
  });
});
