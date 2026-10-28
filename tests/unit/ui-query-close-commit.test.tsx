import React, { act, useEffect, useMemo, useRef, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { QueryCloseRequests } from '../../src/renderer/queryCloseIntent';
import { queryCloseZh as closeWords } from '../../src/renderer/locales/queryClose.zh-CN';
import { queryBindingZh as bindingWords } from '../../src/renderer/locales/queryBinding.zh-CN';
import { appFunctions } from './query-close-app-commit-fixture';

vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const React = await import('react'), { ContentEditorPort, ContentModelPort } = await import('../../tests/unit/editor-content-test-ports');
  return { SqlEditor(props: any) { const latest = React.useRef(props); latest.current = props; React.useEffect(() => { const model = new ContentModelPort(props.value), editor = new ContentEditorPort(model); props.onReady?.(editor); return () => editor.dispose(); }, []); return React.createElement('div', { 'aria-label': '只读独审RAM编辑端口' }); } };
});
let document: ReturnType<typeof memoryDocument>, createRoot: any, root: any, store: any, flushSettings: any, QueryTab: any, world: any;
let hook: ((command: string, input: any) => Promise<any> | undefined) | undefined, calls: { command: string; input: any }[];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => { document = memoryDocument(); ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store, flushSettings } = await import('../../src/renderer/store')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); });
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; hook = undefined; await flushSettings(); document.body.textContent = ''; });
afterAll(() => { for (const [key, value] of globals) if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); });
const saved = { name: '保存后的A', source: { id: 'saved-a', digest: 'b'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } };
async function mount() {
  calls = []; hook = undefined; world = { requests: [] as any[], modalChecks: [] as boolean[] };
  (window as any).confirm = vi.fn(() => false);
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: any) => { calls.push({ command, input }); const wait = hook?.(command, input); if (wait) return wait; if (command === 'settings.save' || command === 'sessions.close') return; if (command === 'queries.create') return saved; throw Error('独审拒绝实际外界调用：' + command); } };
  const make = (id: string) => ({ id, kind: 'query', title: id, connectionId: 'c', sql: 'SELECT ' + id + ';', databaseContext: { state: 'known', database: null } });
  // 混合表页提供真实必需的库表身份，不能绕过正式标签引用校验。
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'keep', tabs: [make('keep'), make('a'), make('b'), { ...make('table'), kind: 'table', database: 'db', table: 'subject' }] }, connections: [{ id: 'c', name: '内存连接', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql', color: '', group: '' }], activeJobs: {}, dirtyTabs: {}, connectionVersions: {}, tasks: [] });
  function Harness() {
    const settings = store((state: any) => state.settings), requests = useMemo(() => new QueryCloseRequests(), []), otherQueryClose = useRef<any>(null);
    const [request, setRequest] = useState<any>(), [closing, setClosing] = useState(false), [commit, setCommit] = useState<any>(), [foreign,setForeign]=useState(false);
    world.showForeign=setForeign;
    const vm = useMemo(() => appFunctions({ otherQueryClose, closeRequests: requests, useWorkspace: store, window,
      document: { querySelector(selector: string) { const modal = document.querySelector(selector); world.modalChecks.push(!!modal); return modal; } },
      setQueryCloseRequest(next: any) { if (next) world.requests.push(next); setRequest(next); }, setClosingOtherQueries: setClosing, setQueryCloseCommit(next:any){if(next)world.onCommitQueued?.();setCommit(next)} }), []);
    world.vm = vm; world.queue = otherQueryClose; vm.layout(commit,request,settings);
    useEffect(() => () => otherQueryClose.current?.dispose(), []);
    return <>{vm.entry(settings, settings.tabs.find((tab: any) => tab.id === settings.activeTabId), closing)}{foreign&&<div role="dialog" aria-label="新的外部模态"/>}{settings.tabs.map((tab: any) => <section data-owner={tab.id} key={tab.id}>{tab.kind === 'query' && <QueryTab tab={tab} onHistory={() => {}} closeRequest={request?.tabId === tab.id ? request : undefined} onCloseRequestFinished={vm.finish}/>}</section>)}</>;
  }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root.render(<Harness/>));
}
async function click(text: string) { const button = document.body.querySelectorAll('button').find(node => node.textContent === text); expect(button, '真实按钮：' + text).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click'))); }
function gate() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('原独审反例的真实App布局提交与Modal对照', () => {
  it.each(['新的外部模态','未来目标变化'])('关闭成功但提交间隙发生%s时停链，后续查询原样保留',async fault=>{
    await mount();await click(closeWords.others);world.onCommitQueued=()=>{if(fault==='新的外部模态')world.showForeign(true);else store.getState().updateTab('b',{sql:'SELECT 外部新正文;'})};
    await click(closeWords.discard);expect(world.requests.map((request:any)=>request.tabId)).toEqual(['a']);expect(world.queue.current.running).toBe(false);
    expect(store.getState().settings.tabs.find((tab:any)=>tab.id==='b').sql).toBe(fault==='新的外部模态'?'SELECT b;':'SELECT 外部新正文;');expect(store.getState().settings.tabs.some((tab:any)=>tab.id==='a')).toBe(false);
  });
  it('B已在真实提交后打开，旧A.failed/mutate只能被拒绝，不停错B（API反例）',async()=>{
    await mount();await click(closeWords.others);const old=world.requests[0];await click(closeWords.discard);
    expect(world.requests.map((request:any)=>request.tabId)).toEqual(['a','b']);old.failed();expect(world.queue.current.running).toBe(true);
    const b=store.getState().settings.tabs.find((tab:any)=>tab.id==='b');expect(()=>old.mutate(b,{title:'旧A不能接管B'},()=>{})).toThrow();expect(world.queue.current.running).toBe(true);
    await click(closeWords.cancel);expect(store.getState().settings.tabs.find((tab:any)=>tab.id==='b').sql).toBe('SELECT b;');
  });
  it.each(['discard', 'save'])('%s成功后应展示第二个原查询关闭请求，不能被仍在DOM的原弹窗截断', async mode => {
    await mount(); await click(closeWords.others); expect(world.requests.map((r: any) => r.tabId)).toEqual(['a']); expect(document.querySelector('[role="dialog"]')).toBeDefined();
    if (mode === 'save') { await click(closeWords.save); await click(bindingWords.create); } else await click(closeWords.discard);
    expect(store.getState().settings.tabs.map((tab: any) => tab.id)).toEqual(['keep', 'b', 'table']);
    expect(world.requests.map((request: any) => request.tabId)).toEqual(['a', 'b']);
  });
  it('首次保存失败粘性停链，真实弹窗可手动重试；重试只关闭当前项并保留后续原SQL', async () => {
    await mount(); await click(closeWords.others); await click(closeWords.save);
    hook = command => command === 'queries.create' ? Promise.reject(Error('合成首次保存失败')) : undefined;
    await click(bindingWords.create); expect(document.body.textContent).toContain('合成首次保存失败'); expect(world.queue.current.running).toBe(false); expect(world.queue.current.pending).toBe(true);
    hook = undefined; await click(bindingWords.create);
    expect(store.getState().settings.tabs.map((tab: any) => [tab.id, tab.sql])).toContainEqual(['b', 'SELECT b;']); expect(world.requests.map((request: any) => request.tabId)).toEqual(['a']);
    expect(calls.filter(call => call.command === 'queries.create')).toHaveLength(2); expect(calls.some(call => /query\.cancel|transaction\.|query\.execute/u.test(call.command))).toBe(false);
  });
  it('新保存挂起时再次点击真实保存按钮不能发第二条保存，旧成功仅一次交接', async () => {
    await mount(); await click(closeWords.others); await click(closeWords.save); const pending = gate(); hook = command => command === 'queries.create' ? pending.promise : undefined;
    await click(bindingWords.create); await click(bindingWords.create); expect(calls.filter(call => call.command === 'queries.create')).toHaveLength(1);
    await act(async () => pending.resolve(saved)); expect(store.getState().settings.tabs.some((tab: any) => tab.id === 'a')).toBe(false);
  });
});

describe('侧关复用真实App关闭与保存握手', () => {
  it('旧顶栏真实JSX接收React点击事件仍按活动查询关闭其他，不误把事件当锚点', async () => {
    await mount(); await click(closeWords.others);
    expect(world.requests.map((item: any) => item.tabId)).toEqual(['a']);
    await click(closeWords.discard); expect(world.requests.map((item: any) => item.tabId)).toEqual(['a', 'b']);
    await click(closeWords.cancel); expect(store.getState().settings.tabs.map((item: any) => item.id)).toEqual(['keep', 'b', 'table']);
    expect(store.getState().settings.activeTabId).toBe('keep');
  });
  it.each(['left', 'right'] as const)('%s以非活动原锚点a选择范围，取消保留原SQL与表标签', async side => {
    await mount(); const ref = store.getState().tabOrderSnapshot().find((item: any) => item.id === 'a');
    await act(async () => world.vm.closeSides(ref, side)); expect(world.requests.map((item: any) => item.tabId)).toEqual([side === 'left' ? 'keep' : 'b']);
    await click(closeWords.cancel); expect(store.getState().settings.tabs.map((item: any) => item.id)).toEqual(['keep', 'a', 'b', 'table']);
    expect(calls.some(call => /query\.execute|table\.apply/u.test(call.command))).toBe(false);
  });
  it.each(['save', 'discard'] as const)('右侧%s完成后保留非活动锚点、当前标签与表页，不发送另一关闭', async mode => {
    await mount(); const ref = store.getState().tabOrderSnapshot().find((item: any) => item.id === 'a'); await act(async () => world.vm.closeSides(ref, 'right'));
    if (mode === 'save') { await click(closeWords.save); await click(bindingWords.create); } else await click(closeWords.discard);
    expect(store.getState().settings.tabs.map((item: any) => item.id)).toEqual(['keep', 'a', 'table']); expect(store.getState().settings.activeTabId).toBe('keep'); expect(world.requests).toHaveLength(1);
  });
  it('右侧正在执行不跳过保护，不关闭后面的查询', async () => {
    await mount(); await act(async () => store.getState().setBusy('a', true)); const ref = store.getState().tabOrderSnapshot().find((item: any) => item.id === 'keep');
    await act(async () => world.vm.closeSides(ref, 'right')); expect(world.requests).toHaveLength(0); expect(store.getState().settings.tabs.map((item: any) => item.id)).toEqual(['keep', 'a', 'b', 'table']);
  });
});
