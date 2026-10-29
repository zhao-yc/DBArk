import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
import { workspaceToolCommandSource } from '../helpers/workspaceToolCommandSource';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';
import { readEditorWordWrap } from '../../src/shared/editorWordWrap';
let errorMessage: typeof import('../../src/renderer/lib')['errorMessage'];
let restoreNavigationMenuPort: () => void = () => {};
let ActionMenu: typeof import('../../src/renderer/components/ActionMenu')['ActionMenu'], ActionMenuSection: typeof import('../../src/renderer/components/ActionMenu')['ActionMenuSection'];
import React, { act, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { validateCommand } from '../../src/shared/validation';
import { editorIndentationZh as text } from '../../src/renderer/locales/editorIndentation.zh-CN';
const io = vi.hoisted(() => ({ monaco: null as any, editors: [] as EditorPort[], initial: [] as any[], loader: undefined as Promise<any> | undefined }));
vi.mock('monaco-editor', () => io.monaco);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('../../src/renderer/completion.worker?worker', () => ({ default: class {} }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SqlEditor: typeof import('../../src/renderer/components/SqlEditor')['SqlEditor'], Preferences: typeof import('../../src/renderer/components/EditorIndentPreferences')['EditorIndentPreferencesDialog'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'], Entry: React.ComponentType<{ children?: React.ReactNode }>;
let saved: any[], respond: (count: number) => Promise<void> | void, hide: (value: boolean) => void;
const ready = vi.fn(), invalidate = vi.fn(), globals = ['window', 'document', 'navigator', 'self', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
/** 原模型故意保留正文猜出的8列Tab；产品必须通过公开选项端口覆盖，端口不实现缩进策略。 */
class ModelPort extends ContentModelPort { constructor(value: string) { super(value); this.options = { tabSize: 8, indentSize: 8, insertSpaces: false }; } }
class EditorPort extends ContentEditorPort {
  options: any; changes: any[] = []; selection = [{ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 }]; scroll = { top: 55, left: 17 }; modelSets = 0;
  constructor(model: ContentModelPort, options: any) { super(model, options); this.options = { ...options }; }
  updateOptions(options: any) { super.updateOptions(options); Object.assign(this.options, options); this.changes.push({ ...options }); }
  getRawOptions() { return { ...this.options, readOnly: this.readOnly }; } getSelections(): any { return this.selection; }
  setModel(model: ContentModelPort | null) { this.modelSets++; super.setModel(model); }
}
const legacy = () => ({ theme: 'light' as const, sidebarWidth: 311, resultLimit: 987, pageSize: 500, dataTypeColors: true, editorFontSize: 20, editorWordWrap: false, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query' as const, connectionId: 'c', title: '原查询', sql: 'select\n\t原文;' }, { id: 'r', kind: 'query' as const, connectionId: 'c', title: '只读预览', sql: 'select 只读原文;' }] });
/** 正式App命令栏的准确组件表达式与导航回调，入口不能只存在于测试里。 */
function entry() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  let declaration = '', modal = ''; const methods: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(file) === '[editorIndentPreferences, setEditorIndentPreferences]')) declaration = node.getText(file);
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'editorIndentPreferences' && ts.isJsxSelfClosingElement(node.right)) modal = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(app); expect([declaration, modal].every(Boolean)).toBe(true); expect(methods).toHaveLength(0);
  const menu = workspaceToolCommandSource(source, readFileSync(new URL('../../src/renderer/components/NavigationToolbar.tsx', import.meta.url), 'utf8'), 'editor-indent');
  const context: any = createContext({ exports: {}, useState, document, useWorkspace: store, flushSettings: flush, errorMessage, readEditorWordWrap, ActionMenu, ActionMenuSection, uiCommandLabels, navigationZh, EditorIndentPreferencesDialog: Preferences, workbenchNavigation: { invalidate: invalidate }, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry({children}:any){${declaration}
${methods.join('\n')}
${menu}return <><ActionMenu label={navigationZh.tools}>{toolActions}</ActionMenu>${modal ? '{' + modal + '}' : ''}{children}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.Entry as React.ComponentType<{ children?: React.ReactNode }>;
}

beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); ({ ActionMenu, ActionMenuSection } = await import('../../src/renderer/components/ActionMenu')); ({ errorMessage } = await import('../../src/renderer/lib')); (document as any).oninput = null; Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
  // 只补充ReactDOM依赖的原生input/select属性，不实现产品保存或缩进逻辑。
  const create = document.createElement.bind(document); document.createElement = name => { const node = create(name); if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); } if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.childNodes }); if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) }); const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  io.monaco = { KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 }, KeyCode: { Enter: 3, KeyF: 36 }, Uri: { parse: (path: string) => ({ path }) }, languages: { CompletionItemKind: Object.fromEntries(['Module', 'Class', 'Interface', 'Function', 'Method', 'Field', 'Variable', 'Keyword'].map((name, index) => [name, index])) }, editor: { EditorOption: { readOnly: 1 }, getModel: () => undefined, createModel: (value: string) => new ModelPort(value), setModelLanguage() {}, setTheme() {}, onDidChangeMarkers: () => ({ dispose() {} }), getModelMarkers: () => [], create: (_node: any, options: any) => { io.initial.push({ ...options }); const editor = new EditorPort(options.model, options); io.editors.push(editor); return editor; } } };
  ({ createRoot } = await import('react-dom/client')); ({ SqlEditor } = await import('../../src/renderer/components/SqlEditor')); ({ EditorIndentPreferencesDialog: Preferences } = await import('../../src/renderer/components/EditorIndentPreferences')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store')); Entry = entry();
  const { loader } = await import('@monaco-editor/react'); vi.spyOn(loader, 'init').mockImplementation(() => Object.assign(io.loader ?? Promise.resolve(io.monaco), { cancel() {} }));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } respond = () => {}; await flush(); delete (window as any).dbark; io.editors = []; io.initial = []; io.loader = undefined; ready.mockClear(); invalidate.mockClear(); document.body.textContent = ''; });
afterAll(() => { restoreNavigationMenuPort(); vi.restoreAllMocks(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 仅settings原IPC在RAM响应，严格生产schema真实执行；拒绝所有业务外部命令。 */
function ports(settings: any = legacy()) { saved = []; respond = () => {}; (window as any).dbark = { invoke(command: string, input: any) { if (command === 'settings.get') return Promise.resolve(settings); if (['connections.list', 'tasks.list'].includes(command)) return Promise.resolve([]); if (command !== 'settings.save') throw Error('禁止其它命令：' + command); saved.push(structuredClone(validateCommand('settings.save', input))); return Promise.resolve(respond(saved.length)); } }; }
async function mount() {
  ports(); store.setState({ ready: true, settings: legacy(), activeJobs: {}, dirtyTabs: {}, notice: undefined });
  function Editors() { const tabs = store(state => state.settings.tabs); return tabs.map(tab => <SqlEditor key={tab.id} value={tab.sql ?? ''} readOnly={tab.id === 'r'} onReady={ready} onChange={sql => store.getState().updateTab(tab.id, { sql })}/>); }
  const never = new Promise(() => {}); function Gate({ hidden }: { hidden: boolean }) { if (hidden) throw never; return null; }
  function Area() { const [hidden, setHidden] = useState(false); hide = setHidden; return <React.Suspense fallback={<span>等待</span>}><Editors/><Gate hidden={hidden}/></React.Suspense>; }
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Entry><Area/></Entry>));
}
function button(label: string) { const node = navigationMenuRamButton(document, label) ?? document.querySelectorAll('button').find(node => node.textContent === label); expect(node, '缺少正式按钮：' + label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function draft(width: string, style = 'tabs') { const input = document.querySelector(`input[aria-label="${text.width}"]`)!, select = document.querySelector(`select[aria-label="${text.style}"]`)!; await act(async () => { input.value = width; input.dispatchEvent(new MemoryEvent('input')); select.value = style; select.dispatchEvent(new MemoryEvent('change')); }); }
function snapshot(editor: EditorPort) { return { model: editor.model, value: editor.getValue(), version: editor.model?.getVersionId(), selection: structuredClone(editor.selection), scroll: structuredClone(editor.scroll), modelSets: editor.modelSets, setValue: editor.setValueCalls, undo: editor.undoStops, stack: editor.model?.stackStops, edits: [...editor.edits], controlledEdits: editor.model?.controlledEdits, actions: editor.actions.length, subscriptions: editor.model?.content.size, readOnly: editor.readOnly, font: editor.options.fontSize, wrap: editor.options.wordWrap }; }
const options = (width: number, spaces: boolean) => ({ tabSize: width, indentSize: width, insertSpaces: spaces });

it('正式可访问入口默认2/空格并关闭自动检测，热更新所有实例/模型且不改SQL、Undo、选区、滚动和只读', async () => {
  await mount(); expect(io.initial.every(value => value.tabSize === 2 && value.insertSpaces === true && value.detectIndentation === false && value.readOnly === true)).toBe(true); expect(io.editors.map(editor => editor.model!.getOptions())).toEqual([options(2, true), options(2, true)]);
  const editors = [...io.editors], before = editors.map(snapshot); await click(uiCommandLabels['editor-indent']); expect(invalidate).toHaveBeenCalledOnce(); await draft('8'); expect(editors.map(snapshot)).toEqual(before); await click(text.save);
  expect(saved).toHaveLength(1); expect(saved[0]).toEqual({ ...legacy(), editorTabSize: 8, editorInsertSpaces: false }); expect(io.editors).toEqual(editors); expect(editors.map(snapshot)).toEqual(before); expect(ready).toHaveBeenCalledTimes(2);
  expect(editors.map(editor => editor.model!.getOptions())).toEqual([options(8, false), options(8, false)]); expect(editors.every(editor => editor.options.detectIndentation === false)).toBe(true); expect(invalidate).toHaveBeenCalledTimes(2);
});
it('无效草稿/未知方式不能保存，取消和恢复默认只影响草稿，明确保存才更新', async () => {
  await mount(); await click(uiCommandLabels['editor-indent']); for (const value of ['0', '9', '1.5', '']) { await draft(value); await click(text.save); expect(document.body.textContent).toContain(text.invalid); } await draft('4', 'unknown'); await click(text.save); expect(saved).toHaveLength(0); await click(text.cancel); expect(store.getState().settings).toEqual(legacy());
  await act(async () => store.getState().updateSettings({ editorTabSize: 5, editorInsertSpaces: false })); await flush(); saved = []; await click(uiCommandLabels['editor-indent']); await click(text.reset); expect(io.editors[0].model!.getOptions()).toEqual(options(5, false)); await click(text.save); expect(io.editors[0].model!.getOptions()).toEqual(options(2, true)); expect(saved).toHaveLength(1);
});
it('切换既有模型/null/新模型均重新应用明确偏好，随后新标签也使用最新值', async () => {
  await mount(); await click(uiCommandLabels['editor-indent']); await draft('3', 'spaces'); await click(text.save); const editor = io.editors[0], model = new ModelPort(editor.getValue()), version = model.getVersionId();
  await act(async () => { editor.setModel(null); editor.setModel(model); }); expect(model.getOptions()).toEqual(options(3, true)); expect(model.getVersionId()).toBe(version); expect(model.controlledEdits).toBe(0); expect(editor.readOnly).toBe(false); expect(ready).toHaveBeenCalledTimes(2);
  await act(async () => store.getState().openTab({ id: 'new', kind: 'query', connectionId: 'c', title: '新标签', sql: 'select\n\t新正文;' })); expect(io.editors).toHaveLength(3); expect(io.editors[2].model!.getOptions()).toEqual(options(3, true)); expect(io.editors[2].getValue()).toBe('select\n\t新正文;');
});
it('迟到loader应用最新偏好，Suspense恢复原widget/model保持正文及Undo不变', async () => {
  let resolve!: (value: any) => void; io.loader = new Promise(yes => { resolve = yes; }); await mount(); expect(io.editors).toHaveLength(0); await click(uiCommandLabels['editor-indent']); await draft('6'); await click(text.save); await act(async () => resolve(io.monaco)); expect(io.editors.map(editor => editor.model!.getOptions())).toEqual([options(6, false), options(6, false)]);
  const editors = [...io.editors], before = editors.map(snapshot); await act(async () => hide(true)); await click(uiCommandLabels['editor-indent']); await draft('1', 'spaces'); await click(text.save); await act(async () => hide(false)); expect(io.editors).toEqual(editors); expect(editors.map(snapshot)).toEqual(before); expect(editors.map(editor => editor.model!.getOptions())).toEqual([options(1, true), options(1, true)]); expect(ready).toHaveBeenCalledTimes(2);
});
it.each([false, true])('保存晚回包fail=%s不覆盖后来的SQL/标签/偏好，也不能关闭新弹窗', async fail => {
  await mount(); let yes!: () => void, no!: (error: Error) => void; const pending = new Promise<void>((resolve, reject) => { yes = resolve; no = reject; }); respond = count => count === 1 ? pending : undefined;
  await click(uiCommandLabels['editor-indent']); await draft('8'); await click(text.save); await click(text.cancel); await click(uiCommandLabels['editor-indent']); await draft('7', 'spaces');
  await act(async () => { store.getState().updateTab('q', { sql: 'select 后来的SQL;' }); store.getState().openTab({ id: 'new', kind: 'query', connectionId: 'c', title: '后来标签', sql: 'select 新标签;' }); store.getState().updateSettings({ editorTabSize: 4, editorInsertSpaces: true }); });
  const latest = store.getState().settings, before = io.editors.map(snapshot); await act(async () => { if (fail) no(Error('合成旧保存失败')); else yes(); }); expect(store.getState().settings).toBe(latest); expect(io.editors.map(snapshot)).toEqual(before); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(document.querySelector(`input[aria-label="${text.width}"]`)!.value).toBe('7'); expect(latest.tabs[0].sql).toBe('select 后来的SQL;'); expect(latest.activeTabId).toBe('new'); expect(io.editors.every(editor => editor.model!.getOptions().tabSize === 4)).toBe(true); await click(text.cancel);
});
it('初始化损坏旧缩进只局部回退，不丢原SQL；后续原保存链路只带当前工作区', async () => {
  ports({ ...legacy(), editorTabSize: '4', editorInsertSpaces: 'false' }); await act(async () => store.getState().initialize()); expect(store.getState().settings).toEqual({ ...legacy(), editorTabSize: 2, editorInsertSpaces: true }); expect(saved).toHaveLength(0);
  store.getState().updateSettings({ editorWordWrap: true }); await flush(); expect(saved.at(-1)).toEqual({ ...legacy(), editorWordWrap: true, editorTabSize: 2, editorInsertSpaces: true });
});
it('失败保留已应用偏好并可重试，卸载释放模型订阅', async () => {
  await mount(); respond = () => Promise.reject(Error('合成保存失败')); await click(uiCommandLabels['editor-indent']); await draft('4'); await click(text.save); expect(document.body.textContent).toContain(text.failed); expect(io.editors[0].model!.getOptions()).toEqual(options(4, false)); respond = () => {}; await click(text.save); expect(document.querySelector('[role="dialog"]')).toBeNull();
  const editor = io.editors[0]; expect(editor.modelChanges.size).toBeGreaterThan(0); await act(async () => root!.unmount()); root = undefined; expect(editor.modelChanges.size).toBe(0);
});
