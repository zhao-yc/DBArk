import React, { act, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { QueryCloseRequest } from '../../src/renderer/queryCloseIntent';
const io = vi.hoisted(() => ({ editor: null as any, edit: null as any, replace: null as any }));
/** 仅替换Monaco外界端口；QueryTab、BindingDialog、Modal、store和ReactDOM均为真实组件。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { useEffect, createElement } = await import('react');
  return { SqlEditor(props: any) {
    useEffect(() => {
      let value = props.value, version = 1;
      const content = new Set<() => void>(), modelChanges = new Set<() => void>(), disposed = new Set<() => void>();
      const model: any = { getValue: () => value, getVersionId: () => version, isDisposed: () => false, onDidChangeContent: (fn: () => void) => { content.add(fn); return { dispose: () => content.delete(fn) }; }, onWillDispose: () => ({ dispose() {} }) };
      const editor = { getModel: () => model, onDidChangeModel: (fn: () => void) => { modelChanges.add(fn); return { dispose: () => modelChanges.delete(fn) }; }, onDidDispose: (fn: () => void) => { disposed.add(fn); return { dispose: () => disposed.delete(fn) }; } };
      io.editor = editor; io.edit = (text: string) => { value = text; version++; for (const fn of content) fn(); props.onChange?.(text); }; io.replace = () => { for (const fn of modelChanges) fn(); };
      props.onReady?.(editor); return () => { for (const fn of disposed) fn(); };
    }, []);
    return createElement('div', { 'aria-label': '内存编辑器端口' });
  } };
});
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
let createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let document: ReturnType<typeof memoryDocument>, commands: string[], records: any[], completion: boolean[], changeRequest: (request?: QueryCloseRequest) => void;
let invokeHook: undefined | ((command: string, input: any) => Promise<any> | undefined);
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
/** 测试终态恢复外界端口，不能把内存DOM带入同worker的其它用例。 */
afterAll(() => { for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
beforeAll(async () => { document = memoryDocument(); ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store')); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); invokeHook = undefined; });
/** 使用真实组件状态及真实store；本地查询写入和settings写入仅作RAM IO。 */
async function mount(bound = false) {
  commands = []; records = []; completion = []; invokeHook = undefined;
  const binding = { id: 'source', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } };
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command); const hooked = invokeHook?.(command, input); if (hooked) return hooked;
    if (command === 'settings.save') return;
    if (command === 'queries.create' || command === 'queries.updateSource') { records.push(input); return { name: '查询', source: { ...binding, id: command === 'queries.create' ? 'new' : 'source', digest: 'b'.repeat(64) } }; }
    throw Error('不允许的外界调用：' + command);
  } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', connectionId: 'c', title: '查询', sql: 'SELECT 合成;', databaseContext: { state: 'known', database: null }, ...(bound ? { sourceBinding: binding as any } : {}) }] }, connections: [{id:'c',name:'连接',group:'',color:'',dialect:'mysql',host:'offline.invalid',port:1,user:'offline'}], activeJobs: {}, dirtyTabs: {}, connectionVersions: {} });
  const failed=vi.fn(),mutate=vi.fn((_before:unknown,_patch:unknown,update:()=>void)=>update());
  function Harness() { const tabs = useWorkspace(state => state.settings.tabs); const [request, setRequest] = useState<QueryCloseRequest | undefined>({ tabId: 't',failed,mutate }); changeRequest = setRequest; return tabs.map(tab => <QueryTab key={tab.id} tab={tab} closeRequest={request} onHistory={() => {}} onCloseRequestFinished={(_request, close) => { completion.push(close); setRequest(undefined); if (close) useWorkspace.getState().closeTab(tab.id); }}/ >); }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<Harness/>));
  return {failed,mutate};
}
function buttons() { return document.body.querySelectorAll('button'); }
async function click(text: string) { const node = buttons().find(button => button.textContent === text); expect(node, '真实组件应渲染按钮：' + text).toBeDefined(); await act(async () => node!.dispatchEvent(new MemoryEvent('click'))); }
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }
const saved = () => ({ name: '查询', source: { id: 'new', digest: 'b'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } });

describe('真实QueryTab、BindingDialog和store的保存后关闭', () => {
  it('队列失败只通知原请求一次，弹窗仍可手动重试；成功同步交接原对象来源', async()=>{const hooks=await mount();invokeHook=command=>command==='queries.create'?Promise.reject(Error('合成保存失败')):undefined;await click('保存后关闭');await click('另存为新查询');expect(hooks.failed).toHaveBeenCalledTimes(1);expect(completion).toEqual([]);expect(document.body.textContent).toContain('合成保存失败');invokeHook=undefined;await click('另存为新查询');expect(completion).toEqual([true]);expect(hooks.mutate).toHaveBeenCalledTimes(1);expect(hooks.mutate.mock.calls[0][0]).toMatchObject({id:'t',sql:'SELECT 合成;'});expect(hooks.mutate.mock.calls[0][1]).toMatchObject({title:'查询',sourceBinding:{id:'new'}});});
  it('迟到旧保存失败不通知新请求，也不改新请求的授权交接', async()=>{const hooks=await mount();let reject!:(reason:Error)=>void;const wait=new Promise((_yes,no)=>{reject=no});invokeHook=command=>command==='queries.create'?wait:undefined;await click('保存后关闭');await click('另存为新查询');const nextFailed=vi.fn(),nextMutate=vi.fn();await act(async()=>changeRequest({tabId:'t',failed:nextFailed,mutate:nextMutate}));await act(async()=>reject(Error('旧保存失败')));expect(hooks.failed).toHaveBeenCalledTimes(1);expect(nextFailed).not.toHaveBeenCalled();expect(nextMutate).not.toHaveBeenCalled();expect(completion).toEqual([]);});
  it('进入保存三选后取消仍完成原请求的否定回执，不写来源或清空SQL', async()=>{const hooks=await mount();await click('保存后关闭');await click('取消');expect(completion).toEqual([false]);expect(hooks.failed).not.toHaveBeenCalled();expect(hooks.mutate).not.toHaveBeenCalled();expect(records).toEqual([]);expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 合成;');});
  it('取消保留草稿，直接关闭零查询写入', async () => { await mount(); await click('取消'); expect(completion).toEqual([false]); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(records).toHaveLength(0); await act(async () => changeRequest({ tabId: 't' })); await click('直接关闭'); expect(completion).toEqual([false, true]); expect(records).toHaveLength(0); });
  it.each([false, true])('未绑定另存/已绑定更新只写一次并在恢复保存后关闭 %s', async bound => { await mount(bound); await click('保存后关闭'); await click(bound ? '保存到原查询' : '另存为新查询'); expect(records).toHaveLength(1); expect(completion).toEqual([true]); expect(useWorkspace.getState().settings.tabs).toHaveLength(0); expect(commands.filter(c => c.startsWith('queries.'))).toEqual([bound ? 'queries.updateSource' : 'queries.create']); });
  it('CAS失败保留名称和草稿，明确另存后才关闭', async () => { await mount(true); invokeHook = command => command === 'queries.updateSource' ? Promise.reject(Error('原查询已修改')) : undefined; await click('保存后关闭'); await click('保存到原查询'); expect(document.body.textContent).toContain('原查询已修改'); expect(completion).toEqual([]); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 合成;'); await click('另存为新查询'); expect(records).toHaveLength(1); expect(completion).toEqual([true]); });
  it('记录成功但恢复写入失败保留标签，不重发create', async () => { await mount(); invokeHook = command => command === 'settings.save' ? Promise.reject(Error('合成写盘失败')) : undefined; await click('保存后关闭'); await click('另存为新查询'); expect(records).toHaveLength(1); expect(completion).toEqual([false]); expect(useWorkspace.getState().settings.tabs[0].sourceBinding?.id).toBe('new'); expect(useWorkspace.getState().notice?.text).toContain('恢复状态保存失败'); invokeHook = undefined; });
  it.each(['新编辑', '待送入模型的外部草稿', '模型替换', '连接修订', '连接删除', '连接概要变化', '库上下文', '作业守卫', '事务守卫'])('写入等待期间%s保留标签，不重发保存', async kind => { await mount(); const wait = deferred(); invokeHook = command => command === 'queries.create' ? wait.promise : undefined; await click('保存后关闭'); await click('另存为新查询'); await act(async () => { if (kind === '新编辑') io.edit('SELECT 新草稿;'); if (kind === '待送入模型的外部草稿') useWorkspace.getState().updateTab('t', { sql: 'SELECT 外部新草稿;' }); if (kind === '模型替换') io.replace(); if (kind === '连接修订') useWorkspace.getState().invalidateConnection('c'); if (kind === '连接删除') useWorkspace.getState().setConnections([]); if (kind === '连接概要变化') useWorkspace.getState().setConnections(useWorkspace.getState().connections.map(profile => ({...profile, host:'changed.invalid'}))); if (kind === '库上下文') useWorkspace.getState().updateTab('t', { databaseContext: { state: 'unknown' } }); if (kind === '作业守卫') useWorkspace.getState().setBusy('t', true); if (kind === '事务守卫') useWorkspace.getState().setDirty('t', true); }); await act(async () => wait.resolve(saved())); expect(completion).toEqual([false]); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(commands.filter(c => c === 'queries.create')).toHaveLength(1); if (kind === '作业守卫') expect(useWorkspace.getState().activeJobs.t).toBe(true); if (kind === '新编辑') expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 新草稿;'); });
  it('取消请求后迟到写入不关闭、不重发、不复活标签', async () => { await mount(); const wait = deferred(); invokeHook = command => command === 'queries.create' ? wait.promise : undefined; await click('保存后关闭'); await click('另存为新查询'); await act(async () => { changeRequest(undefined); useWorkspace.getState().closeTab('t'); }); await act(async () => wait.resolve(saved())); expect(completion).toEqual([]); expect(useWorkspace.getState().settings.tabs).toHaveLength(0); expect(commands.filter(c => c === 'queries.create')).toHaveLength(1); });
  it('等待保存时重复点击不会创建两条记录', async () => { await mount(); const wait = deferred(); invokeHook = command => command === 'queries.create' ? wait.promise : undefined; await click('保存后关闭'); await click('另存为新查询'); await click('另存为新查询'); expect(commands.filter(c => c === 'queries.create')).toHaveLength(1); await act(async () => wait.resolve(saved())); expect(completion).toEqual([true]); });
  it('请求取消后迟到成功保留现标签与草稿', async () => { await mount(); const wait = deferred(); invokeHook = command => command === 'queries.create' ? wait.promise : undefined; await click('保存后关闭'); await click('另存为新查询'); await act(async () => changeRequest(undefined)); await act(async () => wait.resolve(saved())); expect(completion).toEqual([]); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(commands.filter(c => c === 'queries.create')).toHaveLength(1); });
  it('旧视图卸载后迟到返回不得绑定同ID新标签或清除新作业', async () => { await mount(); const wait = deferred(); invokeHook = command => command === 'queries.create' ? wait.promise : undefined; await click('保存后关闭'); await click('另存为新查询'); await act(async () => { changeRequest(undefined); useWorkspace.getState().closeTab('t'); }); await act(async () => { useWorkspace.getState().openTab({ id: 't', kind: 'query', title: '新世代', connectionId: 'c', sql: 'SELECT 新世代;' }); useWorkspace.getState().setBusy('t', true); }); await act(async () => wait.resolve(saved())); expect(completion).toEqual([]); expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBeUndefined(); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 新世代;'); expect(useWorkspace.getState().activeJobs.t).toBe(true); });
  it.each(['activeJobs', 'dirtyTabs'] as const)('保存动作前新出现%s拒绝写入', async field => { await mount(); await click('保存后关闭'); await act(async () => useWorkspace.setState({ [field]: { t: true } })); await click('另存为新查询'); expect(commands.filter(c => c.startsWith('queries.'))).toEqual([]); expect(completion).toEqual([]); expect(document.body.textContent).toContain('已变化'); });

});
