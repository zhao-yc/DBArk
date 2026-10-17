import React, { act, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { editorFontZh as text } from '../../src/renderer/locales/editorFont.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
const port = vi.hoisted(() => ({ monaco: null as any, editors: [] as any[], initial: [] as any[], loader: undefined as Promise<any> | undefined }));
// 保留锁定@monaco-editor/react的真实组件/effect；只替换loader、worker与Monaco布局/模型端口。
vi.mock('monaco-editor', () => port.monaco);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('../../src/renderer/completion.worker?worker', () => ({ default: class {} }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SqlEditor: typeof import('../../src/renderer/components/SqlEditor')['SqlEditor'], Dialog: typeof import('../../src/renderer/components/EditorFontPreferencesDialog')['EditorFontPreferencesDialog'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let Entry: React.ComponentType<{ children: React.ReactNode }>, saved: any[], reply: (input: any, count: number) => Promise<void> | void;
const globals = ['window','document','navigator','self','IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const ready = vi.fn(), invalidate = vi.fn();
let hideEditors: (value: boolean) => void;
/** 只扩充观察options与选区的RAM端口；字号更新不能调用正文、model或撤销写入方法。 */
class FontEditor extends ContentEditorPort {
  options: any; optionChanges: any[] = []; selection = [{ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 }]; modelSets = 0;
  constructor(model: ContentModelPort, options: any) { super(model, options); this.options = { ...options }; }
  updateOptions(options: any) { super.updateOptions(options); Object.assign(this.options, options); this.optionChanges.push({ ...options }); }
  getRawOptions() { return { ...this.options, readOnly: this.readOnly }; }
  getSelections(): any { return this.selection; }
  setModel(model: ContentModelPort | null) { this.modelSets++; super.setModel(model); }
}
/** 从正式App提取准确命令栏button、state、开关方法及弹窗表达式；其余工作台入口不模拟。 */
function appEntry() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App')!;
  let button = '', declaration = '', modal = ''; const methods: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(file) === '[editorFontPreferences, setEditorFontPreferences]')) declaration = node.getText(file);
    if (ts.isFunctionDeclaration(node) && ['openEditorFontPreferences','closeEditorFontPreferences'].includes(node.name?.text ?? '')) methods.push(node.getText(file));
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button' && node.children.some(item => ts.isJsxExpression(item) && item.expression?.getText(file) === 'editorFontZh.entry')) button = node.getText(file);
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'editorFontPreferences' && ts.isJsxSelfClosingElement(node.right)) modal = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(app); expect([declaration,button,modal].every(Boolean)).toBe(true); expect(methods).toHaveLength(2);
  const context: any = createContext({ exports: {}, useState, document, EditorFontPreferencesDialog: Dialog, editorFontZh: text, workbenchNavigation: { invalidate }, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry({children}:any){${declaration}\n${methods.join('\n')}\nreturn <>${button}{${modal}}{children}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.Entry as typeof Entry;
}
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
  const create = document.createElement.bind(document); document.createElement = name => { const node = create(name); if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); } const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  port.monaco = { KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 }, KeyCode: { Enter: 3, KeyF: 36 }, Uri: { parse: (path: string) => ({ path }) }, languages: { CompletionItemKind: Object.fromEntries(['Module','Class','Interface','Function','Method','Field','Variable','Keyword'].map((name, index) => [name, index])), registerCompletionItemProvider: vi.fn(() => ({ dispose() {} })) }, editor: { EditorOption: { readOnly: 1 }, getModel: () => undefined, createModel: (value: string) => new ContentModelPort(value), setModelLanguage() {}, setTheme() {}, onDidChangeMarkers: () => ({ dispose() {} }), getModelMarkers: () => [], create: (_node: any, options: any) => { port.initial.push({ fontSize: options.fontSize, lineHeight: options.lineHeight, readOnly: options.readOnly }); const editor = new FontEditor(options.model, options); port.editors.push(editor); return editor; } } };
  ({ createRoot } = await import('react-dom/client')); ({ SqlEditor } = await import('../../src/renderer/components/SqlEditor')); ({ EditorFontPreferencesDialog: Dialog } = await import('../../src/renderer/components/EditorFontPreferencesDialog')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store')); Entry = appEntry();
  // 锁定库CJS内部读取其公开loader；在实际同一端口注入延迟，不能用未被require消费的理想ESM mock。
  const { loader } = await import('@monaco-editor/react');
  vi.spyOn(loader, 'init').mockImplementation(() => Object.assign(port.loader ?? Promise.resolve(port.monaco), { cancel() {} }));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } reply = () => {}; await flush(); delete (window as any).dbark; vi.useRealTimers(); port.editors = []; port.initial = []; port.loader = undefined; ready.mockClear(); invalidate.mockClear(); document.body.textContent = ''; });
afterAll(() => { vi.restoreAllMocks(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function pending() { let yes!: () => void, no!: (error: Error) => void; const promise = new Promise<void>((resolve, reject) => { yes = resolve; no = reject; }); return { promise, yes, no }; }
/** 全部RPC只允许既有settings.save；没有数据库、GUI、剪贴板或实际文件写入。 */
async function mount(size?: number) {
  saved = []; reply = () => {};
  (window as any).dbark = { invoke: async (command: string, input: any) => { if (command !== 'settings.save') throw Error('禁止外部命令：' + command); saved.push(structuredClone(input)); return reply(input, saved.length); } };
  store.setState({ ready: true, settings: { theme: 'dark', sidebarWidth: 270, resultLimit: 1000, pageSize: 200, tabs: [{ id: 'q', kind: 'query', title: '编辑', connectionId: 'c', sql: 'select 原文' }, { id: 'r', kind: 'query', title: '只读预览', connectionId: 'c', sql: 'select 只读' }], activeTabId: 'q', ...(size === undefined ? {} : { editorFontSize: size }) }, activeJobs: {}, dirtyTabs: {} });
  function Editors() { const tabs = store(state => state.settings.tabs); return tabs.map(tab => <SqlEditor key={tab.id} value={tab.sql ?? ''} readOnly={tab.id === 'r'} onReady={ready} onChange={value => store.getState().updateTab(tab.id, { sql: value })}/>); }
  const never = new Promise(() => {});
  function Gate({ hidden }: { hidden: boolean }) { if (hidden) throw never; return null; }
  function WorkArea() { const [hidden, setHidden] = useState(false); hideEditors = setHidden; return <React.Suspense fallback={<span>等待恢复</span>}><Editors/><Gate hidden={hidden}/></React.Suspense>; }
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Entry><WorkArea/></Entry>));
}
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, '缺少正式按钮：' + label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function draft(value: string) { const node = document.querySelector(`input[aria-label="${text.field}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
function editorState(editor: FontEditor) { return { model: editor.model, version: editor.model?.getVersionId(), value: editor.getValue(), selection: editor.selection, modelSets: editor.modelSets, setValue: editor.setValueCalls, undoStops: editor.undoStops, stackStops: editor.model?.stackStops, controlledEdits: editor.model?.controlledEdits, actions: editor.actions.length, changes: editor.model?.content.size }; }

it('实际App字号入口与真实编辑器库热更新所有可写/只读实例，model/撤销/光标/SQL与原就绪门不变', async () => {
  await mount(); expect(port.editors).toHaveLength(2); expect(port.initial).toEqual([{ fontSize: 13, lineHeight: 23, readOnly: true }, { fontSize: 13, lineHeight: 23, readOnly: true }]);
  const editors = [...port.editors] as FontEditor[], before = editors.map(editorState); expect(editors.map(editor => editor.readOnly)).toEqual([false, true]); expect(ready).toHaveBeenCalledTimes(2);
  await click(text.entry); expect(invalidate).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.current(13)); await draft('20'); expect(editors.every(editor => editor.options.fontSize === 13)).toBe(true);
  await click(text.save); expect(saved).toHaveLength(1); expect(saved[0].editorFontSize).toBe(20); expect(port.editors).toEqual(editors); expect(editors.map(editorState)).toEqual(before); expect(ready).toHaveBeenCalledTimes(2); expect(editors.map(editor => editor.options.fontSize)).toEqual([20,20]); expect(editors.map(editor => editor.options.lineHeight)).toEqual([35,35]); expect(editors.map(editor => editor.readOnly)).toEqual([false,true]); expect(editors.every(editor => editor.options.fontFamily === 'Cascadia Code, SFMono-Regular, Consolas, monospace')).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('越界/小数/空草稿不能保存，恢复默认需明确保存，取消不改当前偏好', async () => {
  await mount(24); await click(text.entry);
  for (const value of ['7','33','12.5','']) { await draft(value); await click(text.save); expect(document.body.textContent).toContain(text.invalid); expect(saved).toHaveLength(0); expect(store.getState().settings.editorFontSize).toBe(24); }
  await click(text.reset); expect(document.querySelector(`input[aria-label="${text.field}"]`)!.value).toBe('13'); expect(document.body.textContent).toContain(text.current(24)); await click(text.cancel); expect(store.getState().settings.editorFontSize).toBe(24);
  await click(text.entry); await click(text.reset); await click(text.save); expect(store.getState().settings.editorFontSize).toBe(13); expect(port.editors.every(editor => editor.options.fontSize === 13 && editor.options.lineHeight === 23)).toBe(true); expect(saved).toHaveLength(1);
});

it('保存迟到回包不覆盖期间新SQL/新标签或活动标签，不回写打开弹窗时的settings', async () => {
  await mount(); const gate = pending(); reply = (_input, count) => count === 1 ? gate.promise : undefined;
  await click(text.entry); await draft('18'); await click(text.save); expect(document.body.textContent).toContain(text.saving);
  await act(async () => { store.getState().updateTab('q', { sql: 'select 保存期间新正文' }); store.getState().openTab({ id: 'new', kind: 'query', title: '新标签', connectionId: 'c', sql: 'select 新标签' }); });
  const latest = store.getState().settings, before = port.editors.map(editorState); await act(async () => gate.yes());
  expect(store.getState().settings).toBe(latest); expect(store.getState().settings.activeTabId).toBe('new'); expect(store.getState().settings.tabs[0].sql).toBe('select 保存期间新正文'); expect(port.editors.map(editorState)).toEqual(before); expect(saved.at(-1).activeTabId).toBe('new'); expect(saved.at(-1).tabs[0].sql).toBe('select 保存期间新正文');
});

it('关闭重开的新弹窗不被旧保存回包关闭或重置草稿', async () => {
  await mount(); const gate = pending(); reply = (_input, count) => count === 1 ? gate.promise : undefined;
  await click(text.entry); await draft('18'); await click(text.save); await click(text.cancel); await click(text.entry); await draft('25');
  await act(async () => gate.yes()); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(document.querySelector(`input[aria-label="${text.field}"]`)!.value).toBe('25'); expect(store.getState().settings.editorFontSize).toBe(18); await click(text.cancel);
});

it('保存失败明确保留未持久提示，可重试，失败回包不复原旧工作区', async () => {
  await mount(); reply = () => Promise.reject(Error('RAM保存失败')); await click(text.entry); await draft('22'); await click(text.save);
  expect(document.body.textContent).toContain(text.failed); expect(store.getState().settings.editorFontSize).toBe(22); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); reply = () => {}; await click(text.save); expect(saved).toHaveLength(2); expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('loader迟到挂载只取最新字号，仍先readonly桥接，再发布onReady且不提前创建model', async () => {
  let resolve!: (value: any) => void; port.loader = new Promise(yes => { resolve = yes; }); await mount(); expect(port.editors).toHaveLength(0);
  await act(async () => store.getState().updateSettings({ editorFontSize: 32 })); expect(port.editors).toHaveLength(0); await act(async () => resolve(port.monaco));
  expect(port.initial.every(options => options.fontSize === 32 && options.lineHeight === 57 && options.readOnly === true)).toBe(true); expect(port.editors).toHaveLength(2); expect(port.editors.map(editor => editor.readOnly)).toEqual([false,true]); expect(ready).toHaveBeenCalledTimes(2); expect(store.getState().settings.tabs[0].sql).toBe('select 原文');
});


it('Suspense隐藏期间改字号，恢复原widget时只热更新最新字号且不重建model或重复onReady', async () => {
  await mount(); const editors = [...port.editors] as FontEditor[], before = editors.map(editorState);
  await act(async () => hideEditors(true)); expect(editors.every(editor => editor.readOnly)).toBe(true);
  await act(async () => store.getState().updateSettings({ editorFontSize: 32 }));
  await act(async () => hideEditors(false));
  expect(port.editors).toEqual(editors); expect(editors.map(editor => editor.options.fontSize)).toEqual([32,32]); expect(editors.map(editor => editor.options.lineHeight)).toEqual([57,57]);
  expect(editors.map(editorState)).toEqual(before); expect(editors.map(editor => editor.readOnly)).toEqual([false,true]); expect(ready).toHaveBeenCalledTimes(2);
});


it('关闭同步撤销：取消/标题/Escape/保存成功通知前旧保存均失效，正常重开有新权限', async () => {
  const handler = (node: any) => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))!].onClick as () => void;
  for (const mode of ['cancel','header','escape','saved']) {
    await mount(24); await click(text.entry); await draft('18'); const oldSave = handler(button(text.save));
    const changeAndDeliver = () => { store.getState().updateSettings({ editorFontSize: 28 }); oldSave(); };
    if (mode === 'saved') {
      // 正式App关闭方法先通知导航，再setState；在通知内投递旧保存，覆盖卸载尚未提交的窗口。
      invalidate.mockImplementationOnce(changeAndDeliver); await click(text.save);
    } else await act(async () => {
      if (mode === 'cancel') handler(button(text.cancel))();
      else if (mode === 'header') handler(document.querySelector(`button[aria-label="${zh.dialogs.text001}"]`))();
      else document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }));
      changeAndDeliver();
    });
    expect(store.getState().settings.editorFontSize, mode).toBe(28);
    expect(saved.filter(settings => settings.editorFontSize === 18), mode).toHaveLength(mode === 'saved' ? 1 : 0);
    await click(text.entry); expect(document.querySelector(`input[aria-label="${text.field}"]`)!.value).toBe('28');
    await draft('30'); await click(text.save); expect(store.getState().settings.editorFontSize, mode).toBe(30); expect(saved.at(-1).editorFontSize).toBe(30);
    await act(async () => root!.unmount()); root = undefined; reply = () => {}; await flush(); document.body.textContent = ''; invalidate.mockReset();
  }
});
