import { zh } from '../locales/zh-CN';
import { useEffect, useRef } from 'react';
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

export type SqlCompletionStatus='idle'|'partial'|'unavailable'|'limited';
export interface SqlCompletionScope{connectionId:string;connectionVersion:number;database?:string}
const completionKinds:Record<SqlCompletionItem['kind'],monaco.languages.CompletionItemKind>={database:monaco.languages.CompletionItemKind.Module,table:monaco.languages.CompletionItemKind.Class,view:monaco.languages.CompletionItemKind.Interface,function:monaco.languages.CompletionItemKind.Function,procedure:monaco.languages.CompletionItemKind.Method,column:monaco.languages.CompletionItemKind.Field,alias:monaco.languages.CompletionItemKind.Variable,keyword:monaco.languages.CompletionItemKind.Keyword};

/** Monaco 使用随安装包发布的编辑器和 worker，离线环境也可直接编辑 SQL。 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

/** 每个编辑器只接收自身元数据补全，执行快捷键通过引用调用最新的标签逻辑。 */
export function SqlEditor({ value, onChange, onReady, height = '100%', readOnly = false, completion, onCompletionStatus, onExecute }: { value: string; onChange?: (value: string) => void; onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void; height?: string | number; readOnly?: boolean; completion?:SqlCompletionScope;onCompletionStatus?:(status:SqlCompletionStatus)=>void;onExecute?: () => void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef(onExecute); runRef.current = onExecute;
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
        /** 每次await后核对模型与版本，标签切换、连接修订和编辑取消都不能交付旧建议。 */
        const current=()=>!disposed&&!controller.signal.aborted&&!model.isDisposed()&&editorRef.current?.getModel()===model&&model.getVersionId()===version&&active===controller;
        try{
          const analysis=await worker.analyze(source,offset,{},controller.signal);if(!current())return{suggestions:[]};
          if(analysis.status==='blocked'){statusRef.current?.(['budget','timeout'].includes(analysis.reason)?'limited':analysis.reason==='worker'?'unavailable':'idle');return{suggestions:[]};}
          const result=await completionSuggestions(analysis,completion.database,directory,controller.signal);if(!current())return{suggestions:[]};
          const start=model.getPositionAt(analysis.target.start),end=model.getPositionAt(analysis.target.end);if(start.lineNumber!==end.lineNumber)return{suggestions:[]};
          const range={startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column};
          statusRef.current?.(result.unavailable?'unavailable':result.incomplete?'partial':'idle');
          return{incomplete:result.incomplete,suggestions:result.items.map((item,index)=>({label:item.label,kind:completionKinds[item.kind],insertText:item.insertText,detail:item.detail,range,filterText:analysis.target.quoted?source[analysis.target.start]+item.label:item.label,sortText:(item.kind==='keyword'?'9':'0')+String(index).padStart(4,'0'),...(item.trigger?{command:{id:'editor.action.triggerSuggest',title:''}}:{})}))};
        }catch{if(current())statusRef.current?.('unavailable');return{suggestions:[]};}
        finally{cancel.dispose();change.dispose();if(active===controller)active=undefined;}
      }
    });
    return()=>{disposed=true;active?.abort();provider.dispose();worker.dispose();directory.dispose();};
  },[readOnly,completion?.connectionId,completion?.connectionVersion,completion?.database]);
  /** 挂载时注册一次执行动作，编辑器销毁后 Monaco 自动释放该实例动作。 */
  const mounted: OnMount = editor => {
    editorRef.current = editor; onReady?.(editor);
    editor.addAction({ id: 'dbark-run', label: zh.editor.text001, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current?.() });
  };
  return <Editor language="sql" theme={theme === 'dark' ? 'vs-dark' : 'light'} value={value} onChange={text => onChange?.(text ?? '')} onMount={mounted} height={height} loading={<div className="editor-loading">{zh.editor.text002}</div>} options={{ readOnly, wordBasedSuggestions:'off',quickSuggestions:{other:true,comments:false,strings:false},fontFamily: 'Cascadia Code, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 23, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 12 }, tabSize: 2, wordWrap: 'on', renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true, contextmenu: true }} />;
}
