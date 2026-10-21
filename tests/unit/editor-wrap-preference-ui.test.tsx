import React, { act, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { validateCommand } from '../../src/shared/validation';
import { editorWordWrapZh as text } from '../../src/renderer/locales/editorWordWrap.zh-CN';
const io = vi.hoisted(() => ({ monaco: null as any, editors: [] as any[], initial: [] as any[], providers: [] as any[], loader: undefined as Promise<any> | undefined }));
// 运行真实SqlEditor和锁定React编辑器库；布局/模型与worker为RAM端口，不启动原生组件。
vi.mock('monaco-editor', () => io.monaco);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('../../src/renderer/completion.worker?worker', () => ({ default: class {} }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SqlEditor: typeof import('../../src/renderer/components/SqlEditor')['SqlEditor'], Button: typeof import('../../src/renderer/components/EditorWordWrapButton')['EditorWordWrapButton'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'], Entry: React.ComponentType<{ children: React.ReactNode }>;
let saved: any[], respond: (count: number) => Promise<void> | void, hide: (value: boolean) => void;
const ready = vi.fn(), globals = ['window','document','navigator','self','IS_REACT_ACT_ENVIRONMENT'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
/** 观察Monaco原方法，不实现换行业务，也不模拟原生撤销体验。 */
class EditorPort extends ContentEditorPort {
  options: any; changes: any[] = []; selection = [{ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 4 }]; modelSets = 0;
  constructor(model: ContentModelPort, options: any) { super(model,options); this.options = { ...options }; }
  updateOptions(options: any) { super.updateOptions(options); Object.assign(this.options,options); this.changes.push({ ...options }); }
  getRawOptions() { return { ...this.options, readOnly: this.readOnly }; }
  getSelections(): any { return this.selection; }
  setModel(model: ContentModelPort | null) { this.modelSets++; super.setModel(model); }
}
const legacy = () => ({ theme: 'light' as const, sidebarWidth: 311, resultLimit: 987, pageSize: 500, dataTypeColors: true, editorFontSize: 20, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query' as const, connectionId: 'c', title: '原查询', sql: 'select 已返回原文' }, { id: 'r', kind: 'query' as const, connectionId: 'c', title: '只读预览', sql: 'select 只读原文' }] });
/** 提取正式App命令栏内的准确组件表达式，确保入口不是只存在于测试Harness。 */
function entry() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx',import.meta.url),'utf8'), file = ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); let expression = '';
  const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'EditorWordWrapButton') { expect(ts.isJsxElement(node.parent)).toBe(true); const parent = node.parent as ts.JsxElement; expect(parent.openingElement.attributes.properties.some(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'className' && item.initializer && ts.isStringLiteral(item.initializer) && item.initializer.text === 'app-commandbar')).toBe(true); expression = node.getText(file); } ts.forEachChild(node,visit); };
  visit(file); expect(expression).toBeTruthy(); const context: any = createContext({ exports: {}, EditorWordWrapButton: Button, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App端口'); } });
  runInContext(ts.transpileModule(`function Entry({children}:any){return <>${expression}{children}</>};globalThis.Entry=Entry;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context); return context.Entry;
}
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(globalThis,'self',{configurable:true,value:window});
  io.monaco = { KeyMod:{CtrlCmd:2048,Shift:1024,Alt:512},KeyCode:{Enter:3,KeyF:36},Uri:{parse:(path:string)=>({path})},languages:{CompletionItemKind:Object.fromEntries(['Module','Class','Interface','Function','Method','Field','Variable','Keyword'].map((name,index)=>[name,index])),registerHoverProvider: () => ({ dispose() {} }), registerCompletionItemProvider:(_language:string,provider:any)=>{const record={provider,disposed:false};io.providers.push(record);return{dispose(){record.disposed=true;}};}},editor:{EditorOption:{readOnly:1},getModel:()=>undefined,createModel:(value:string)=>new ContentModelPort(value),setModelLanguage(){},setTheme(){},onDidChangeMarkers:()=>({dispose(){}}),getModelMarkers:()=>[],create:(_node:any,options:any)=>{io.initial.push({...options});const editor=new EditorPort(options.model,options);io.editors.push(editor);return editor;}}};
  ({createRoot}=await import('react-dom/client'));({SqlEditor}=await import('../../src/renderer/components/SqlEditor'));({EditorWordWrapButton:Button}=await import('../../src/renderer/components/EditorWordWrapButton'));({useWorkspace:store,flushSettings:flush}=await import('../../src/renderer/store')); Entry=entry();
  const {loader}=await import('@monaco-editor/react');vi.spyOn(loader,'init').mockImplementation(()=>Object.assign(io.loader??Promise.resolve(io.monaco),{cancel(){}}));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}respond=()=>{};await flush();delete(window as any).dbark;vi.useRealTimers();io.editors=[];io.initial=[];io.providers=[];io.loader=undefined;ready.mockClear();document.body.textContent='';});
afterAll(()=>{vi.restoreAllMocks();for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
/** 原settings命令为RAM，主进程生产schema仍校验；没有DB/GUI/剪贴板/文件IO。 */
function ports() { saved=[];respond=()=>{};(window as any).dbark={invoke(command:string,input:any){if(command==='settings.get')return Promise.resolve(legacy());if(['connections.list','tasks.list'].includes(command))return Promise.resolve([]);if(command!=='settings.save')throw Error('禁止其它外部命令：'+command);saved.push(structuredClone(validateCommand('settings.save',input)));return Promise.resolve(respond(saved.length));}}; }
async function mount() {
  ports();store.setState({ready:true,settings:legacy(),activeJobs:{},dirtyTabs:{},notice:undefined});
  function Editors(){const tabs=store(state=>state.settings.tabs);return tabs.map(tab=><SqlEditor key={tab.id} value={tab.sql??''} readOnly={tab.id==='r'} completion={{connectionId:'c',connectionVersion:1}} onReady={ready} onChange={sql=>store.getState().updateTab(tab.id,{sql})}/>);}
  const never=new Promise(()=>{});function Gate({hidden}:{hidden:boolean}){if(hidden)throw never;return null;}
  function Area(){const[hidden,setHidden]=useState(false);hide=setHidden;return <React.Suspense fallback={<span>等待</span>}><Editors/><Gate hidden={hidden}/></React.Suspense>;}
  const host=document.createElement('div');document.body.appendChild(host);root=createRoot(host as any);await act(async()=>root!.render(<Entry><Area/></Entry>));
}
function button(){const node=document.querySelectorAll('button').find(node=>node.textContent===text.action);expect(node).toBeDefined();return node!;}
async function toggle(){await act(async()=>button().dispatchEvent(new MemoryEvent('click')));}
function snapshot(editor:EditorPort){return{model:editor.model,modelDisposed:editor.model?.isDisposed(),disposed:editor.disposed,value:editor.getValue(),version:editor.model?.getVersionId(),selection:structuredClone(editor.selection),modelSets:editor.modelSets,setValue:editor.setValueCalls,undo:editor.undoStops,stack:editor.model?.stackStops,edits:[...editor.edits],contentEdits:editor.model?.controlledEdits,actions:editor.actions.length,subscriptions:editor.model?.content.size,font:editor.options.fontSize,line:editor.options.lineHeight,family:editor.options.fontFamily};}

it('正式命令栏aria-pressed与所有可写/只读实例热更一致，仅updateOptions单个wordWrap不改字体/model/undo/选区/补全',async()=>{
  await mount();expect(button().getAttribute('aria-pressed')).toBe('true');expect(io.initial.map(options=>options.wordWrap)).toEqual(['on','on']);expect(io.initial.every(options=>options.readOnly===true)).toBe(true);
  const editors=[...io.editors] as EditorPort[],before=editors.map(snapshot),counts=editors.map(editor=>editor.changes.length),providers=[...io.providers];
  await toggle();expect(button().getAttribute('aria-pressed')).toBe('false');expect(saved).toHaveLength(1);expect(saved[0]).toEqual({...legacy(),editorWordWrap:false});expect(editors.map(editor=>editor.options.wordWrap)).toEqual(['off','off']);
  await toggle();expect(button().getAttribute('aria-pressed')).toBe('true');expect(saved.at(-1).editorWordWrap).toBe(true);expect(editors.map(editor=>editor.options.wordWrap)).toEqual(['on','on']);expect(io.editors).toEqual(editors);expect(editors.map(snapshot)).toEqual(before);expect(editors.map(editor=>editor.readOnly)).toEqual([false,true]);expect(ready).toHaveBeenCalledTimes(2);expect(io.providers).toEqual(providers);expect(providers).toHaveLength(1);expect(providers[0].disposed).toBe(false);
  editors.forEach((editor,index)=>expect(editor.changes.slice(counts[index])).toEqual([{wordWrap:'off'},{wordWrap:'on'}]));
});

it('renderer初始化旧缺项只补true，原字号/SQL/标签/活动项与其它偏好不变且不触发保存',async()=>{
  ports();await act(async()=>store.getState().initialize());expect(store.getState().settings).toEqual({...legacy(),editorWordWrap:true,editorTabSize:2,editorInsertSpaces:true});expect(saved).toHaveLength(0);
});

it('迟到loader从稳定optionsRef取最新off，仍由原桥接解除可写实例readonly',async()=>{
  let resolve!:(value:any)=>void;io.loader=new Promise(yes=>{resolve=yes;});await mount();expect(io.editors).toHaveLength(0);await toggle();expect(store.getState().settings.editorWordWrap).toBe(false);await act(async()=>resolve(io.monaco));
  expect(io.initial.map(options=>options.wordWrap)).toEqual(['off','off']);expect(io.initial.every(options=>options.readOnly===true&&options.fontSize===20&&options.lineHeight===35)).toBe(true);expect(io.editors.map(editor=>editor.readOnly)).toEqual([false,true]);expect(ready).toHaveBeenCalledTimes(2);
});

it('Suspense隐藏期间切换，恢复原widget/model只应用最新换行且不重复onReady',async()=>{
  await mount();const editors=[...io.editors] as EditorPort[],before=editors.map(snapshot);await act(async()=>hide(true));expect(editors.every(editor=>editor.readOnly)).toBe(true);await toggle();await act(async()=>hide(false));
  expect(io.editors).toEqual(editors);expect(editors.map(editor=>editor.options.wordWrap)).toEqual(['off','off']);expect(editors.map(snapshot)).toEqual(before);expect(editors.map(editor=>editor.readOnly)).toEqual([false,true]);expect(ready).toHaveBeenCalledTimes(2);
});

it('单字段合并最新工作区，旧按钮闭包基于当前值切换；迟到失败回包不覆盖新SQL/新标签/后续偏好',async()=>{
  await mount();let reject!:(reason:Error)=>void;const pending=new Promise<void>((_resolve,no)=>{reject=no;});respond=count=>count===1?pending:undefined;
  const node=button() as any,key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!,old=node[key].onClick as ()=>void;await toggle();
  await act(async()=>{store.getState().updateTab('q',{sql:'select 后来的SQL'});store.getState().openTab({id:'new',kind:'query',connectionId:'c',title:'新标签',sql:'select 新标签'});old();});
  const latest=store.getState().settings,before=io.editors.map(snapshot);expect(latest.editorWordWrap).toBe(true);expect(latest.editorFontSize).toBe(20);expect(latest.activeTabId).toBe('new');expect(latest.tabs[0].sql).toBe('select 后来的SQL');expect(saved.at(-1)).toEqual(latest);
  await act(async()=>reject(Error('RAM旧保存失败')));expect(store.getState().settings).toBe(latest);expect(io.editors.map(snapshot)).toEqual(before);expect(store.getState().notice?.error).toBe(true);expect(button().getAttribute('aria-pressed')).toBe('true');
});
