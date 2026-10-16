import { zh } from '../locales/zh-CN';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CompletionWorker from '../completion.worker?worker';
import { useWorkspace } from '../store';
import {CompletionWorkerClient} from '../completionWorkerClient';
import {CompletionDirectory} from '../completionDirectory';
import {completionSuggestions,type SqlCompletionItem} from '../completionSuggestions';
import {completionLimits} from '../../shared/sqlCompletion';
import {invoke,uid} from '../lib';
import {resolveCompletionContext,completionContextCapabilities} from '../completionContext';
import {SessionCompletionDirectory} from '../sessionCompletionDirectory';
import {completionServerFacts} from '../completionServerFacts';
import { currentStatementZh } from '../locales/currentStatement.zh-CN';
import { editorContentBridge } from '../editorContentBridge';

export type SqlCompletionStatus='idle'|'partial'|'unavailable'|'limited'|'databaseUnknown'|'sessionUnknown'|'startupTimeout'|'analysisTimeout';
export interface SqlCompletionScope{connectionId:string;connectionVersion:number;database?:string;databaseUnknown?:boolean;sessionId?:string}
const completionKinds:Record<SqlCompletionItem['kind'],monaco.languages.CompletionItemKind>={database:monaco.languages.CompletionItemKind.Module,table:monaco.languages.CompletionItemKind.Class,view:monaco.languages.CompletionItemKind.Interface,function:monaco.languages.CompletionItemKind.Function,procedure:monaco.languages.CompletionItemKind.Method,column:monaco.languages.CompletionItemKind.Field,alias:monaco.languages.CompletionItemKind.Variable,keyword:monaco.languages.CompletionItemKind.Keyword};

/** Monaco 使用随安装包发布的编辑器和 worker，离线环境也可直接编辑 SQL。 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

/** 每个编辑器只接收自身元数据补全，执行快捷键通过引用调用最新的标签逻辑。 */
export function SqlEditor({ value, onChange, onReady, height = '100%', readOnly = false, completion, onCompletionStatus, onExecute, onExecuteCurrent }: { value: string; onChange?: (value: string) => void; onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void; height?: string | number; readOnly?: boolean; completion?:SqlCompletionScope;onCompletionStatus?:(status:SqlCompletionStatus)=>void;onExecute?: () => void; onExecuteCurrent?: () => void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<ReturnType<typeof editorContentBridge> | null>(null);
  const widgetRef = useRef<{ editor: monaco.editor.IStandaloneCodeEditor; alive: boolean; disposal?: monaco.IDisposable } | null>(null);
  const propsRef = useRef({ value, onChange, onReady, readOnly });
  const aliveRef = useRef(true), [contentReady, setContentReady] = useState(false);
  // options引用稳定；库即使迟到应用初始options，也读取同一份最新readonly，不能重新开放失效实例。
  const optionsRef = useRef<monaco.editor.IStandaloneEditorConstructionOptions>({ readOnly: true, wordBasedSuggestions:'off',quickSuggestions:{other:true,comments:false,strings:false},fontFamily: 'Cascadia Code, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 23, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 12 }, tabSize: 2, wordWrap: 'on', renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true, contextmenu: true });
  // 只发布已提交的props；并发渲染被取消时不能把未提交回调交给旧模型。
  useLayoutEffect(() => { propsRef.current = { value, onChange, onReady, readOnly }; });
  /** 外部value只能走桥接的受控编辑范围；库不再另行更新value或订阅onChange。 */
  useLayoutEffect(() => { contentRef.current?.sync(); }, [value, readOnly]);
  useLayoutEffect(() => {
    aliveRef.current = true;
    // Suspense重显会恢复layout effect但库不重发onMount；仅恢复仍存活widget的正文桥接。
    const widget = widgetRef.current;
    if (widget?.alive) attachContent(widget.editor);
    else if (widget) { optionsRef.current.readOnly = true; setContentReady(false); }
    return () => { aliveRef.current = false; contentRef.current?.dispose(); contentRef.current = null; editorRef.current = null; };
  }, []);
  // 真实卸载释放widget存活监听；单纯布局隐藏保留句柄，不能用已销毁实例恢复桥接。
  useEffect(() => () => { const widget = widgetRef.current; widgetRef.current = null; if (widget) { widget.alive = false; widget.disposal?.dispose(); } }, []);
  const runRef = useRef(onExecute); runRef.current = onExecute;
  const currentRunRef = useRef(onExecuteCurrent); currentRunRef.current = onExecuteCurrent;
  const statusRef=useRef(onCompletionStatus);statusRef.current=onCompletionStatus;
  useEffect(() => {
    if(readOnly||!completion)return;
    const worker=new CompletionWorkerClient(()=>new CompletionWorker()),directory=new CompletionDirectory(completion.connectionId,completion.connectionVersion,{request:input=>invoke('metadata.completion',input),cancel:taskId=>invoke('query.cancel',{taskId}),id:uid});
    let active:AbortController|undefined,disposed=false;
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters:['.','`'],
      provideCompletionItems: async (model, position,_context,token) => {
        if (disposed||readOnly||editorRef.current?.getModel()!==model||model.isDisposed()||token.isCancellationRequested)return{suggestions:[]};
        active?.abort();const controller=new AbortController();active=controller;statusRef.current?.('idle');
        if(model.getValueLength()>completionLimits.sourceUnits){statusRef.current?.('limited');return{suggestions:[]};}
        const version=model.getVersionId(),source=model.getValue(),offset=model.getOffsetAt(position),cancel=token.onCancellationRequested(()=>controller.abort()),change=model.onDidChangeContent(()=>controller.abort());
        // 无会话草稿复用既有连接检查的事实；不为能力判断新增SQL或主动建立查询会话。
        const openedFacts=completion.sessionId?undefined:completionServerFacts.get(completion.connectionId,completion.connectionVersion);
        /** 每次await后核对模型与版本，标签切换、连接修订和编辑取消都不能交付旧建议。 */
        const current=()=>!disposed&&!controller.signal.aborted&&!model.isDisposed()&&editorRef.current?.getModel()===model&&model.getVersionId()===version&&active===controller&&(!!completion.sessionId||completionServerFacts.get(completion.connectionId,completion.connectionVersion)===openedFacts);
        try{
          const cached=completion.sessionId?await invoke('query.completionState',{sessionId:completion.sessionId}):undefined;if(!current())return{suggestions:[]};
          const scope=resolveCompletionContext(completion.database,cached,completion.databaseUnknown);if(!scope.available){statusRef.current?.(scope.reason==='broken'?'unavailable':'idle');return{suggestions:[]};}
          const capabilities=completionContextCapabilities(cached,openedFacts);
          const analysis=await worker.analyze(source,offset,scope.mode,controller.signal,capabilities);if(!current())return{suggestions:[]};
          if(analysis.status==='blocked'){statusRef.current?.(analysis.reason==='startup-timeout'?'startupTimeout':analysis.reason==='timeout'?'analysisTimeout':analysis.reason==='budget'?'limited':analysis.reason==='worker'?'unavailable':'idle');return{suggestions:[]};}
          const sourceDirectory=completion.sessionId?new SessionCompletionDirectory(directory,query=>{
            if(query.kind==='databases'||query.kind==='objects'&&query.objectKind!=='relation')throw new Error('会话目录目标无效');
            return invoke('query.temporaryCompletion',query.kind==='columns'?{sessionId:completion.sessionId!,kind:'columns',database:query.database,table:query.table,prefix:query.prefix}:{sessionId:completion.sessionId!,kind:'objects',database:query.database,prefix:query.prefix});
          },cached?.objectsRevision??0):directory;
          const result=await completionSuggestions(analysis,scope.database,sourceDirectory,controller.signal,cached?.dialect);if(!current())return{suggestions:[]};
          if(completion.sessionId){const latest=await invoke('query.completionState',{sessionId:completion.sessionId});if(!current()||latest.busy||latest.broken||latest.objectsRevision!==cached?.objectsRevision||latest.databaseKnown!==cached?.databaseKnown||latest.database!==cached?.database||latest.dialect!==cached?.dialect||latest.serverVersion!==cached?.serverVersion)return{suggestions:[]};}
          const start=model.getPositionAt(analysis.target.start),end=model.getPositionAt(analysis.target.end);if(start.lineNumber!==end.lineNumber)return{suggestions:[]};
          const range={startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column};
          statusRef.current?.(result.unavailable?'unavailable':result.sessionUncertain?'sessionUnknown':scope.databaseUnknown?'databaseUnknown':result.incomplete?'partial':'idle');
          return{incomplete:result.incomplete,suggestions:result.items.map((item,index)=>({label:item.label,kind:completionKinds[item.kind],insertText:item.insertText,detail:item.detail,range,filterText:analysis.target.quoted?source[analysis.target.start]+item.label:item.label,sortText:(item.kind==='keyword'?'9':'0')+String(index).padStart(4,'0'),...(item.trigger?{command:{id:'editor.action.triggerSuggest',title:''}}:{})}))};
        }catch{if(current())statusRef.current?.('unavailable');return{suggestions:[]};}
        finally{cancel.dispose();change.dispose();if(active===controller)active=undefined;}
      }
    });
    return()=>{disposed=true;active?.abort();provider.dispose();worker.dispose();directory.dispose();};
  },[readOnly,completion?.connectionId,completion?.connectionVersion,completion?.database,completion?.databaseUnknown,completion?.sessionId]);
  /** 正文桥接可随布局恢复，执行动作及父层onReady不在这里重复发布。 */
  function attachContent(editor: monaco.editor.IStandaloneCodeEditor) {
    contentRef.current?.dispose(); editorRef.current = editor;
    const bridge = editorContentBridge(editor, () => propsRef.current, ready => {
      optionsRef.current.readOnly = !ready || propsRef.current.readOnly;
      if (aliveRef.current) setContentReady(ready);
    });
    contentRef.current = bridge;
    return bridge;
  }
  /** 挂载时注册一次执行动作，编辑器销毁后 Monaco 自动释放该实例动作。 */
  const mounted: OnMount = editor => {
    // 已卸载组件的迟到挂载通知不得重新开放输入或调用父层。
    if (!aliveRef.current) { if (editor.getModel()) editor.updateOptions({ readOnly: true }); return; }
    widgetRef.current?.disposal?.dispose();
    const widget = { editor, alive: true, disposal: undefined as monaco.IDisposable | undefined }; widgetRef.current = widget;
    widget.disposal = editor.onDidDispose(() => { widget.alive = false; if (editorRef.current === editor) editorRef.current = null; });
    const bridge = attachContent(editor);
    editor.addAction({ id: 'dbark-run', label: zh.editor.text001, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current?.() });
    // 与原动作分开注册；按钮和快捷键最终进入同一个忙碌/模态守卫。
    if (currentRunRef.current) editor.addAction({ id: 'dbark-run-current', label: currentStatementZh.action, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter], run: () => currentRunRef.current?.() });
    // 正文订阅、受控同步与readonly解除均已完成，父层才可取得可交互实例。
    if (bridge.ready) propsRef.current.onReady?.(editor);
  };
  return <div style={{ height, position: 'relative' }} aria-busy={!contentReady}><div aria-hidden={!contentReady} inert={!contentReady} style={{ height: '100%', visibility: contentReady ? 'visible' : 'hidden' }}><Editor language="sql" theme={theme === 'dark' ? 'vs-dark' : 'light'} defaultValue={value} onMount={mounted} height="100%" loading={<div className="editor-loading">{zh.editor.text002}</div>} options={optionsRef.current}/></div>{!contentReady && <div className="editor-loading" style={{ position: 'absolute', inset: 0 }}>{zh.editor.text002}</div>}</div>;
}
