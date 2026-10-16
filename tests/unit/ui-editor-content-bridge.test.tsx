import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

const io = vi.hoisted(() => ({ monaco: null as any, editors: [] as any[], earlyInput: undefined as string | undefined, earlyAccepted: [] as boolean[], initialStates: [] as any[] }));
// 保留锁定@monaco-editor/react的真实组件/effect/value路径；只替换loader、worker和Monaco原生端口。
vi.mock('@monaco-editor/loader', () => ({ default: { config() {}, init: () => Object.assign(Promise.resolve(io.monaco), { cancel() {} }) } }));
vi.mock('monaco-editor', () => io.monaco);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('../../src/renderer/completion.worker?worker', () => ({ default: class {} }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SqlEditor: typeof import('../../src/renderer/components/SqlEditor')['SqlEditor'], LibraryEditor: typeof import('@monaco-editor/react')['default'];
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'self', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let commands: string[];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
  io.monaco = { KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 }, KeyCode: { Enter: 3, KeyF: 36 }, Uri: { parse: (value: string) => ({ path: value }) }, languages: { CompletionItemKind: Object.fromEntries(['Module', 'Class', 'Interface', 'Function', 'Method', 'Field', 'Variable', 'Keyword'].map((name, i) => [name, i])) }, editor: {
    EditorOption: { readOnly: 1 }, getModel: () => undefined, createModel: (value: string) => new ContentModelPort(value), setModelLanguage() {}, setTheme() {}, onDidChangeMarkers: () => ({ dispose() {} }), getModelMarkers: () => [],
    create: (node: any, options: any) => {
      const state = { busy: false, ariaHidden: false, inert: false, visibilityHidden: false, readOnly: options.readOnly === true };
      // 只读真实ReactDOM祖先属性，不模拟无障碍树或用理想标志替代产品就绪状态。
      for (let parent = node; parent; parent = parent.parentNode) { state.busy ||= parent.getAttribute?.('aria-busy') === 'true'; state.ariaHidden ||= parent.getAttribute?.('aria-hidden') === 'true'; state.inert ||= parent.getAttribute?.('inert') !== null && parent.getAttribute?.('inert') !== undefined; state.visibilityHidden ||= parent.style?.visibility === 'hidden'; }
      io.initialStates.push(state); const editor = new ContentEditorPort(options.model, options); io.editors.push(editor); if (io.earlyInput !== undefined) io.earlyAccepted.push(editor.nativeInput(io.earlyInput)); return editor;
    },
  } };
  ({ createRoot } = await import('react-dom/client')); ({ default: LibraryEditor } = await import('@monaco-editor/react')); ({ SqlEditor } = await import('../../src/renderer/components/SqlEditor')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); vi.useRealTimers(); io.editors = []; io.earlyInput = undefined; io.earlyAccepted = []; io.initialStates = []; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 真实ReactDOM与库只在RAM工作；任何非settings.save命令都失败，不使用磁盘或Main。 */
async function render(view: React.ReactNode) {
  commands ??= []; (window as any).dbark = { invoke: async (command: string) => { commands.push(command); if (command !== 'settings.save') throw Error('禁止编辑器桥接新增外界命令'); } };
  if (!root) { const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); }
  await act(async () => root!.render(view));
}
describe('真实锁定库、SqlEditor与模型端口的就绪合同（不是GUI）', () => {
  it('旧路径反例：库晚订阅之前交付的正文不被补发', async () => {
    const change = vi.fn(), atMount: number[] = []; io.earlyInput = '合成早输入';
    await render(<LibraryEditor value="" onChange={change} onMount={editor => atMount.push((editor as any).libraryChanges.size)} options={{ readOnly: false }}/>);
    expect(io.earlyAccepted).toEqual([true]); expect(io.editors[0].getValue()).toBe('合成早输入'); expect(atMount).toEqual([0]); expect(change).not.toHaveBeenCalled();
  });
  it('新路径早输入被readonly拒绝，onReady时真实桥接已绑定且只交付随后一次编辑', async () => {
    const change = vi.fn(), ready = vi.fn((editor: any) => { expect(editor.readOnly).toBe(false); expect(editor.model.content.size).toBe(2); expect(editor.libraryChanges.size).toBe(0); });
    io.earlyInput = '不应交付'; await render(<SqlEditor value="" onChange={change} onReady={ready}/>);
    expect(io.initialStates).toEqual([{ busy: true, ariaHidden: true, inert: true, visibilityHidden: true, readOnly: true }]);
    expect(io.earlyAccepted).toEqual([false]); expect(ready).toHaveBeenCalledTimes(1); expect(io.editors[0].getValue()).toBe(''); expect(change).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll('[aria-busy]').at(-1)?.getAttribute('aria-busy')).toBe('false');
    expect(document.body.querySelectorAll('[aria-hidden]').at(-1)?.getAttribute('aria-hidden')).toBe('false'); expect(document.body.querySelectorAll('[inert]')).toHaveLength(0);
    await act(async () => { io.editors[0].nativeInput('用户真实事件'); }); expect(change).toHaveBeenCalledExactlyOnceWith('用户真实事件');
  });
  it('外部value及readonly更新只走产品受控事务，库不setValue也不产生回声', async () => {
    const change = vi.fn(); await render(<SqlEditor value="初始" onChange={change}/>); const editor = io.editors[0];
    await render(<SqlEditor value="外部更新" readOnly onChange={change}/>);
    expect(editor.getValue()).toBe('外部更新'); expect(editor.readOnly).toBe(true); expect(editor.setValueCalls).toBe(0); expect(editor.edits).toEqual([]); expect(editor.model.controlledEdits).toBe(1); expect(change).not.toHaveBeenCalled();
    await render(<SqlEditor value="再次更新" onChange={change}/>); expect(editor.readOnly).toBe(false); expect(editor.libraryChanges.size).toBe(0); expect(change).not.toHaveBeenCalled();
  });
  it('最新已提交回调生效，旧回调不串入下一次正文事件', async () => {
    const old = vi.fn(), latest = vi.fn(); await render(<SqlEditor value="" onChange={old}/>); const editor = io.editors[0], count = editor.model.content.size;
    await render(<SqlEditor value="" onChange={latest}/>); expect(editor.model.content.size).toBe(count);
    await act(async () => { editor.nativeInput('新回调'); }); expect(old).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledExactlyOnceWith('新回调');
  });
  it('两个真实SqlEditor分别更新真实store标签，原防抖只保存一次且不自动执行', async () => {
    commands = []; useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'b', tabs: [{ id: 'a', kind: 'query', connectionId: 'c', title: '甲', sql: '甲原文' }, { id: 'b', kind: 'query', connectionId: 'c', title: '乙', sql: '' }] } });
    function View() { const tabs = useWorkspace(state => state.settings.tabs); return <>{tabs.map(tab => <SqlEditor key={tab.id} value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })}/>)}</>; }
    await render(<View/>); vi.useFakeTimers(); await act(async () => { io.editors[1].nativeInput('乙用户输入'); });
    expect(useWorkspace.getState().settings.tabs.map(tab => tab.sql)).toEqual(['甲原文', '乙用户输入']); await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(commands).toEqual(['settings.save']); expect(io.editors.every(editor => editor.libraryChanges.size === 0)).toBe(true);
  });
  it('卸载释放真实组件桥接，已排队的模型事件不再写入', async () => {
    const change = vi.fn(); await render(<SqlEditor value="" onChange={change}/>); const editor = io.editors[0], model = editor.model;
    model.deferred = true; editor.nativeInput('迟到事件'); await act(async () => root!.unmount()); root = undefined; model.flush();
    expect(change).not.toHaveBeenCalled(); expect(model.content.size).toBe(0); expect(model.ending.size).toBe(0); expect(editor.ending.size).toBe(0);
  });
  it('StrictMode加载后模型换代和卸载仍释放旧事件', async () => {
    const old = vi.fn(), next = vi.fn(); await render(<React.StrictMode><SqlEditor value="初文" onChange={old}/></React.StrictMode>);
    const editor = io.editors.find(editor => !editor.disposed)!, previous = editor.model; previous.deferred = true; editor.nativeInput('旧队列');
    await render(<React.StrictMode><SqlEditor value="新props" onChange={next}/></React.StrictMode>);
    const model = new ContentModelPort('其它正文'); await act(async () => { editor.setModel(model); previous.flush(); });
    expect(old).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled(); expect(previous.content.size).toBe(0); expect(model.getValue()).toBe('新props');
    await act(async () => { editor.nativeInput('新用户正文'); }); expect(next).toHaveBeenCalledExactlyOnceWith('新用户正文');
  });
  it('取消的并发渲染不发布未提交props，旧可见编辑器继续使用原回调', async () => {
    const committed = vi.fn(), speculative = vi.fn(), never = new Promise(() => {});
    function Gate({ pending }: { pending: boolean }) { if (pending) throw never; return null; }
    function View({ pending = false }: { pending?: boolean }) { return <React.Suspense fallback={<span>等待</span>}><SqlEditor value={pending ? '未提交正文' : '原文'} readOnly={pending} onChange={pending ? speculative : committed}/><Gate pending={pending}/></React.Suspense>; }
    await render(<View/>); const editor = io.editors.find(editor => !editor.disposed)!;
    await act(async () => { React.startTransition(() => root!.render(<View pending/>)); }); expect(editor.getValue()).toBe('原文'); expect(editor.readOnly).toBe(false);
    await act(async () => { editor.nativeInput('仍可见输入'); }); expect(committed).toHaveBeenCalledExactlyOnceWith('仍可见输入'); expect(speculative).not.toHaveBeenCalled();
    await render(<View/>); expect(editor.readOnly).toBe(false);
  });
  it.each([false, true])('布局effect隐藏/恢复只重建存活widget桥接，不重复动作或onReady；隐藏期间销毁=%s', async destroyed => {
    const change = vi.fn(), ready = vi.fn(), format = vi.fn(), never = new Promise(() => {});
    function Gate({ pending }: { pending: boolean }) { if (pending) throw never; return null; }
    function View({ pending = false }: { pending?: boolean }) { return <React.Suspense fallback={<span>等待</span>}><SqlEditor value="原文" onChange={change} onReady={ready} onFormat={format}/><Gate pending={pending}/></React.Suspense>; }
    await render(<View/>); const editor = io.editors.find(editor => !editor.disposed)!, actions = editor.actions.length, model = editor.model;
    const action = editor.actions.find((action: any) => action.id === 'dbark-format-sql'); expect(action).toBeDefined();
    model.deferred = true; editor.nativeInput('隐藏前排队'); await render(<View pending/>); expect(editor.readOnly).toBe(true); action.run(); expect(format).not.toHaveBeenCalled();
    if (destroyed) editor.dispose(); await render(<View/>); model.flush(); expect(ready).toHaveBeenCalledTimes(1); expect(editor.actions).toHaveLength(actions); expect(change).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll('[aria-busy]').at(-1)?.getAttribute('aria-busy')).toBe(destroyed ? 'true' : 'false');
    if (destroyed) { action.run(); expect(format).not.toHaveBeenCalled(); expect(editor.activeActions.has(action)).toBe(false); expect(editor.readOnly).toBe(true); expect(editor.nativeInput('不可复活')).toBe(false); expect(model.content.size).toBe(0); }
    else { action.run(); expect(format).toHaveBeenCalledTimes(1); expect(editor.activeActions.has(action)).toBe(true); expect(editor.disposed).toBe(false); expect(editor.readOnly).toBe(false); expect(editor.getValue()).toBe('原文'); model.deferred = false; await act(async () => { editor.nativeInput('恢复后的输入'); }); expect(change).toHaveBeenCalledExactlyOnceWith('恢复后的输入'); }
  });
});

/** 使用真实SqlEditor/ReactDOM和锁定库，键注册与回调生命周期只经RAM端口观察。 */
describe('编辑器格式化快捷键的显式注册与世代', () => {
  it('Alt+Shift+F只绑定一次且只读最新已提交回调，CtrlCmd执行键不变', async () => {
    const old=vi.fn(),latest=vi.fn(); await render(<SqlEditor value="select 1;" onFormat={old}/>);const editor=io.editors[0];
    const action=editor.actions.find((action:any)=>action.id==='dbark-format-sql');
    expect(action).toMatchObject({keybindings:[1572],precondition:'editorTextFocus && !editorReadonly',label:'格式化 SQL'});
    expect(editor.actions.find((action:any)=>action.id==='dbark-run').keybindings).toEqual([2051]);
    await render(<SqlEditor value="select 1;" onFormat={latest}/>); action.run(); expect(latest).toHaveBeenCalledTimes(1);expect(old).not.toHaveBeenCalled();
    expect(editor.actions.filter((action:any)=>action.id==='dbark-format-sql')).toHaveLength(1);
    await render(<SqlEditor value="select 1;" readOnly onFormat={latest}/>);action.run();expect(latest).toHaveBeenCalledTimes(1);expect(editor.activeActions.has(action)).toBe(false);
    await render(<SqlEditor value="select 1;" onFormat={latest}/>);const active=[...editor.activeActions].filter((action:any)=>action.id==='dbark-format-sql');expect(active).toHaveLength(1);
    action.run();expect(latest).toHaveBeenCalledTimes(1);(active[0] as any).run();expect(latest).toHaveBeenCalledTimes(2);
    await act(async()=>root!.unmount());root=undefined;(active[0] as any).run();expect(latest).toHaveBeenCalledTimes(2);expect(editor.activeActions.has(active[0])).toBe(false);
  });
  it('未传onFormat及只读实例均不注册，后续移除回调即释放旧动作', async () => {
    const format=vi.fn();await render(<SqlEditor value="只读" readOnly onFormat={format}/>);const editor=io.editors[0];expect(editor.actions.some((action:any)=>action.id==='dbark-format-sql')).toBe(false);
    await render(<SqlEditor value="原文"/>);expect(editor.actions.some((action:any)=>action.id==='dbark-format-sql')).toBe(false);
    await render(<SqlEditor value="原文" onFormat={format}/>);const action=editor.actions.find((action:any)=>action.id==='dbark-format-sql');expect(action).toBeDefined();
    await render(<SqlEditor value="原文"/>);action.run();expect(format).not.toHaveBeenCalled();expect(editor.activeActions.has(action)).toBe(false);
  });
  it('被取消的并发渲染不能发布未提交格式化回调', async () => {
    const old=vi.fn(),speculative=vi.fn(),never=new Promise(()=>{});function Gate({pending}:{pending:boolean}){if(pending)throw never;return null;}
    function View({pending=false}:{pending?:boolean}){return <React.Suspense fallback={<span>等待</span>}><SqlEditor value="原文" onFormat={pending?speculative:old}/><Gate pending={pending}/></React.Suspense>;}
    await render(<View/>);const editor=io.editors.find(editor=>!editor.disposed)!,action=editor.actions.find((action:any)=>action.id==='dbark-format-sql');
    await act(async()=>{React.startTransition(()=>root!.render(<View pending/>));});action.run();expect(old).toHaveBeenCalledTimes(1);expect(speculative).not.toHaveBeenCalled();
  });
});
