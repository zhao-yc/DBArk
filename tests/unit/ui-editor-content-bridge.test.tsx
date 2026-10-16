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
  io.monaco = { KeyMod: { CtrlCmd: 2048, Shift: 1024 }, KeyCode: { Enter: 3 }, Uri: { parse: (value: string) => ({ path: value }) }, languages: { CompletionItemKind: Object.fromEntries(['Module', 'Class', 'Interface', 'Function', 'Method', 'Field', 'Variable', 'Keyword'].map((name, i) => [name, i])) }, editor: {
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
});
