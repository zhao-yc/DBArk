import type { ConnectionProfile } from '../../shared/contracts';
import { editorWordWrapOptions, readEditorWordWrap } from '../../shared/editorWordWrap';
import { editorFontOptions, readEditorFontSize } from '../../shared/editorFont';
import { editorIndentationOptions, readEditorInsertSpaces, readEditorTabSize } from '../../shared/editorIndentation';
import { bindEditorIndentation } from '../editorIndentation';
import { zh } from '../locales/zh-CN';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import { hasExplicitCaseSelection } from '../sqlSelectionCase';
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
import {resolveCompletionContext,completionContextCapabilities,sameCompletionScope,type SqlCompletionScope} from '../completionContext';
import {SessionCompletionDirectory} from '../sessionCompletionDirectory';
import {completionServerFacts} from '../completionServerFacts';
import { currentStatementZh } from '../locales/currentStatement.zh-CN';
import { sqlStatementFoldingProvider } from '../sqlStatementFolding';
import { StatementNavigationWorkerClient } from '../statementNavigationWorkerClient';
import StatementNavigationWorker from '../statementNavigation.worker?worker';
import { editorContentBridge } from '../editorContentBridge';
import { sqlFormattingZh } from '../locales/sqlFormatting.zh-CN';
import { createSqlFieldHoverProvider } from '../sqlFieldHoverProvider';
import SqliteCompletionWorker from '../sqliteCompletion.worker?worker';
import { SqliteCompletionWorkerClient } from '../sqliteCompletionWorkerClient';
import { createSqliteCompletionProvider } from '../sqliteCompletionProvider';
import { createSqlDefinitionProvider } from '../sqlDefinitionProvider';
import { createMysqlDefinitionAnalysis } from '../mysqlDefinitionAnalysis';
import { createSqlSignatureProvider } from '../sqlSignatureProvider';
import SqliteLocalReferencesWorker from '../sqliteLocalReferences.worker?worker';
import { LocalReferencesWorkerClient } from '../localReferencesWorkerClient';
import { createLocalReferencesAnalysis } from '../localReferencesAnalysis';
import { createSqliteLocalReferencesAnalysis } from '../sqliteLocalReferencesAnalysis';
import { createSqlReferencesProvider } from '../sqlReferencesProvider';
import { SqlReferenceCompletionGuard } from '../sqlReferenceCompletionGuard';
import { createLocalRenameAnalysis } from '../localRenameAnalysis';
import { createSqlRenameProvider } from '../sqlRenameProvider';
import { localRenameZh } from '../locales/localRename.zh-CN';
import '../localRename.css';
import { sqliteCompletionTaskPrefix, sqliteCompletionLimits } from '../../shared/sqliteCompletion';
import { matchSnippetPrefix, snippetAtStatementStart, snippetCatalog, snippetPrefix } from '../snippetCompletion';

export type SqlCompletionStatus='idle'|'partial'|'unavailable'|'limited'|'databaseUnknown'|'sessionUnknown'|'startupTimeout'|'analysisTimeout';
export type { SqlCompletionScope } from '../completionContext';
const completionKinds:Record<SqlCompletionItem['kind'],monaco.languages.CompletionItemKind>={database:monaco.languages.CompletionItemKind.Module,table:monaco.languages.CompletionItemKind.Class,view:monaco.languages.CompletionItemKind.Interface,function:monaco.languages.CompletionItemKind.Function,procedure:monaco.languages.CompletionItemKind.Method,column:monaco.languages.CompletionItemKind.Field,alias:monaco.languages.CompletionItemKind.Variable,keyword:monaco.languages.CompletionItemKind.Keyword};

/** Monaco 使用随安装包发布的编辑器和 worker，离线环境也可直接编辑 SQL。 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

/** 每个编辑器只接收自身元数据补全，执行快捷键通过引用调用最新的标签逻辑。 */
export function SqlEditor({ value, onChange, onReady, height = '100%', readOnly = false, dialect, completion, snippetCompletion = false, onCompletionStatus, onSelectionState, onExecute, onExecuteCurrent, onFormat, onToggleComment, onSelectCurrent }: { value: string; onChange?: (value: string) => void; onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void; height?: string | number; readOnly?: boolean; dialect?: ConnectionProfile['dialect']; completion?:SqlCompletionScope;snippetCompletion?:boolean;onCompletionStatus?:(status:SqlCompletionStatus)=>void;onSelectionState?: (caseSelection: boolean, singleSelection: boolean) => void;onExecute?: () => void; onExecuteCurrent?: () => void; onFormat?: () => void; onToggleComment?: () => Promise<void>; onSelectCurrent?: () => void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const fontSize = useWorkspace(state => readEditorFontSize(state.settings.editorFontSize));
  const wordWrap = useWorkspace(state => readEditorWordWrap(state.settings.editorWordWrap));
  const lineNumbers = useWorkspace<'off' | 'on'>(state => state.settings.editorLineNumbers === false ? 'off' : 'on');
  const matchBrackets = useWorkspace<'never' | 'always'>(state => state.settings.editorMatchBrackets === false ? 'never' : 'always');
  const sqlFolding = useWorkspace(state => state.settings.editorSqlFolding === true);
  const tabSize = useWorkspace(state => readEditorTabSize(state.settings.editorTabSize));
  const insertSpaces = useWorkspace(state => readEditorInsertSpaces(state.settings.editorInsertSpaces));
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<ReturnType<typeof editorContentBridge> | null>(null);
  const widgetRef = useRef<{ editor: monaco.editor.IStandaloneCodeEditor; alive: boolean; disposal?: monaco.IDisposable; formatAction?: monaco.IDisposable; formatToken?: object; indentation?: ReturnType<typeof bindEditorIndentation> } | null>(null);
  const propsRef = useRef({ value, onChange, onReady, readOnly, onFormat });
  const completionRef = useRef(completion);
  const dialectRef = useRef(dialect);
  useLayoutEffect(() => { completionRef.current = completion; dialectRef.current = dialect; });
  const aliveRef = useRef(true), [contentReady, setContentReady] = useState(false);
  const queryEditor = !!onExecute;
  useEffect(() => {
    const instance = editorRef.current;
    if (!contentReady || !instance || !queryEditor || !sqlFolding || !dialect) return;
    let active = true;
    const client = new StatementNavigationWorkerClient(() => new StatementNavigationWorker({ name: 'dbark-sql-folding' }));
    const registration = monaco.languages.registerFoldingRangeProvider('sql', sqlStatementFoldingProvider(instance, dialect, client,
      () => active && aliveRef.current && editorRef.current === instance && dialectRef.current === dialect && useWorkspace.getState().settings.editorSqlFolding === true));
    return () => { active = false; registration.dispose(); client.dispose(); };
  }, [contentReady, queryEditor, sqlFolding, dialect]);
  /** 原生菜单只收到可用状态，选区内容留在当前模型内。 */
  useEffect(() => {
    if (!onSelectionState) return;
    const instance = editorRef.current;
    if (!instance || !contentReady || readOnly) { onSelectionState(false, false); return; }
    const sync = () => {
      const nonEmpty = hasExplicitCaseSelection(instance);
      onSelectionState(nonEmpty, nonEmpty && instance.getSelections()?.length === 1);
    };
    const selection = instance.onDidChangeCursorSelection(sync), model = instance.onDidChangeModel(sync);
    const disposal = instance.onDidDispose(() => onSelectionState(false, false));
    sync();
    return () => { selection.dispose(); model.dispose(); disposal.dispose(); onSelectionState(false, false); };
  }, [contentReady, onSelectionState, readOnly]);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  useEffect(() => { setRenameMessage(null); }, [value, readOnly, dialect, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.sessionId]);
  // options引用稳定；库即使迟到应用初始options，也读取同一份最新readonly，不能重新开放失效实例。
  const optionsRef = useRef<monaco.editor.IStandaloneEditorConstructionOptions>({ readOnly: true, wordBasedSuggestions:'off',quickSuggestions:{other:true,comments:false,strings:false},fontFamily: 'Cascadia Code, SFMono-Regular, Consolas, monospace', ...editorFontOptions(fontSize), minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 12 }, ...editorIndentationOptions(tabSize, insertSpaces), ...editorWordWrapOptions(wordWrap), lineNumbers, matchBrackets, renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true, contextmenu: true });
  // 只发布已提交的props；并发渲染被取消时不能把未提交回调交给旧模型。
  useLayoutEffect(() => { propsRef.current = { value, onChange, onReady, readOnly, onFormat }; syncFormatAction(); });
  /** 外部value只能走桥接的受控编辑范围；库不再另行更新value或订阅onChange。 */
  useLayoutEffect(() => { contentRef.current?.sync(); }, [value, readOnly]);
  useLayoutEffect(() => {
    aliveRef.current = true;
    // Suspense重显会恢复layout effect但库不重发onMount；仅恢复仍存活widget的正文桥接。
    const widget = widgetRef.current;
    if (widget?.alive) { attachContent(widget.editor); syncFormatAction(); }
    else if (widget) { optionsRef.current.readOnly = true; setContentReady(false); }
    return () => { aliveRef.current = false; contentRef.current?.dispose(); contentRef.current = null; editorRef.current = null; };
  }, []);
  /** 仅热更新字号/行高；不触及model、正文、撤销栈、选择、readonly或补全生命周期。 */
  useLayoutEffect(() => {
    const options = editorFontOptions(fontSize); Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [fontSize]);
  /** 换行只更新原实例单个选项；顺序在widget恢复之后，隐藏期间的最新值也能提交。 */
  useLayoutEffect(() => {
    const options = editorWordWrapOptions(wordWrap); Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [wordWrap]);
  /** 只更新原编辑器显示选项，行号和括号状态不进入 SQL 模型。 */
  useLayoutEffect(() => {
    const options = { lineNumbers, matchBrackets };
    Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [lineNumbers, matchBrackets]);
  /** 全局偏好更新原widget和当前model；不替换正文，也不因正文已有Tab而重新猜缩进。 */
  useLayoutEffect(() => {
    Object.assign(optionsRef.current, editorIndentationOptions(tabSize, insertSpaces));
    widgetRef.current?.indentation?.sync();
  }, [tabSize, insertSpaces]);
  // 真实卸载释放widget存活监听；单纯布局隐藏保留句柄，不能用已销毁实例恢复桥接。
  useEffect(() => () => { const widget = widgetRef.current; widgetRef.current = null; if (widget) { widget.alive = false; widget.formatToken = undefined; widget.formatAction?.dispose(); widget.indentation?.dispose(); widget.disposal?.dispose(); } }, []);
  const toggleCommentRef = useRef(onToggleComment); toggleCommentRef.current = onToggleComment;
  const runRef = useRef(onExecute); runRef.current = onExecute;
  const currentRunRef = useRef(onExecuteCurrent); currentRunRef.current = onExecuteCurrent;
  const selectCurrentRef = useRef(onSelectCurrent); selectCurrentRef.current = onSelectCurrent;
  const statusRef=useRef(onCompletionStatus);statusRef.current=onCompletionStatus;
  const referenceCompletionGuard = useRef(new SqlReferenceCompletionGuard());
  const suggestionsBlocked = () => referenceCompletionGuard.current.blocked(editorRef.current?.getDomNode() ?? null);
  /** 局部F2重命名独占分析线程；输入框焦点属于本widget，不能借树选择改变目标。 */
  useEffect(() => {
    if (readOnly || !contentReady || !dialect || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!(editorRef.current?.hasTextFocus() || editorRef.current?.hasWidgetFocus()) && !document.querySelector('[role="dialog"], [role="alertdialog"]') && (!completion || sameCompletionScope(completionRef.current, completion));
    const worker = createLocalRenameAnalysis({ dialect: dialect === 'sqlite' ? 'sqlite' : 'mysql', scope: completion, current,
      facts: () => completion ? completionServerFacts.get(completion.connectionId, completion.connectionVersion) : undefined,
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new LocalReferencesWorkerClient(() => dialect === 'sqlite' ? new SqliteLocalReferencesWorker() : new CompletionWorker(), dialect === 'sqlite' ? 'sqlite' : 'mysql'),
    });
    const rename = createSqlRenameProvider({ worker, current, model: () => editorRef.current?.getModel() ?? null, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits,
      begin: signal => referenceCompletionGuard.current.acquire(signal), notify: setRenameMessage,
      prepare: () => { setRenameMessage(null); editorRef.current?.trigger('dbark.localRename', 'hideSuggestWidget', {}); },
    });
    const registration = monaco.languages.registerRenameProvider('sql', rename.provider);
    return () => { registration.dispose(); void rename.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 内置函数参数提示只分析当前模型；模式缓存之外没有数据库入口，与补全／声明线程独立。 */
  useEffect(() => {
    if (readOnly || !contentReady || !dialect || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector('[role="dialog"], [role="alertdialog"]') && (!completion || sameCompletionScope(completionRef.current, completion));
    const signatures = createSqlSignatureProvider({ model: () => editorRef.current?.getModel() ?? null, current, dialect, scope: completion, state: sessionId => invoke('query.completionState', { sessionId }) });
    const registration = monaco.languages.registerSignatureHelpProvider('sql', signatures.provider);
    return () => { registration.dispose(); signatures.dispose(); };
  }, [dialect, readOnly, contentReady, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 本文引用按方言复用声明语义，独占线程；SQLite不读取会话缓存或回退到MySQL解析器。 */
  useEffect(() => {
    if (readOnly || !contentReady || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector('[role="dialog"], [role="alertdialog"]') && (!completion || sameCompletionScope(completionRef.current, completion));
    const worker = dialect === 'sqlite' ? createSqliteLocalReferencesAnalysis({ current, create: () => new LocalReferencesWorkerClient(() => new SqliteLocalReferencesWorker(), 'sqlite') }) : createLocalReferencesAnalysis({ scope: completion!, current,
      facts: () => completionServerFacts.get(completion!.connectionId, completion!.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new LocalReferencesWorkerClient(() => new CompletionWorker()),
    });
    const references = createSqlReferencesProvider({ worker, current, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits, model: () => editorRef.current?.getModel() ?? null,
      begin: signal => referenceCompletionGuard.current.acquire(signal),
      // 走Monaco正式命令收起尚未选择的候选，不改正文；避免候选框覆盖引用列表标题。
      prepare: () => editorRef.current?.trigger('dbark.localReferences', 'hideSuggestWidget', {}),
    });
    const registration = monaco.languages.registerReferenceProvider('sql', references.provider);
    return () => { registration.dispose(); void references.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 声明导航独立于元数据补全；MySQL只读既有会话模式缓存，不为F12建立连接或执行SQL。 */
  useEffect(() => {
    if (readOnly || !contentReady || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector('[role="dialog"], [role="alertdialog"]') && (dialect === 'sqlite' || sameCompletionScope(completionRef.current, completion));
    const worker = dialect === 'sqlite' ? new SqliteCompletionWorkerClient(() => new SqliteCompletionWorker()) : createMysqlDefinitionAnalysis({
      scope: completion!, current, facts: () => completionServerFacts.get(completion!.connectionId, completion!.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new CompletionWorkerClient(() => new CompletionWorker()),
    });
    const navigation = createSqlDefinitionProvider({ worker, model: () => editorRef.current?.getModel() ?? null,
      current, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits,
    });
    const registration = monaco.languages.registerDefinitionProvider('sql', navigation.provider);
    return () => { registration.dispose(); void navigation.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  useEffect(() => {
    if (!snippetCompletion || readOnly || !contentReady || !dialect) return;
    let active = true;
    const registration = monaco.languages.registerCompletionItemProvider('sql', {
      /** 独立的本地片段补全，不请求元数据，也不使用 Monaco 的变量插值。 */
      async provideCompletionItems(model, position, _context, token) {
        const instance = editorRef.current;
        const current = () => active && aliveRef.current && contentRef.current?.ready === true
          && dialectRef.current === dialect && !propsRef.current.readOnly && !token.isCancellationRequested
          && !!instance?.hasTextFocus() && instance.getModel() === model && !model.isDisposed()
          && !suggestionsBlocked() && !document.querySelector('[role="dialog"], [role="alertdialog"]');
        if (!current() || instance?.getSelections()?.length !== 1 || !instance.getSelection()?.isEmpty()) return;
        if (model.getValueLength() > 65_536) return;
        const prefix = snippetPrefix(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
        if (!prefix || !snippetAtStatementStart(model.getValue(), model.getOffsetAt(position), prefix, dialect)) return;
        const version = model.getVersionId(), rows = await snippetCatalog.list();
        const cursor = instance.getPosition();
        if (!rows || !current() || model.getVersionId() !== version || cursor?.lineNumber !== position.lineNumber || cursor.column !== position.column
          || instance.getSelections()?.length !== 1 || !instance.getSelection()?.isEmpty()) return;
        const range = {
          startLineNumber: position.lineNumber, startColumn: position.column - prefix.length,
          endLineNumber: position.lineNumber, endColumn: position.column,
        };
        return { incomplete: true, suggestions: matchSnippetPrefix(rows, prefix, dialect).map((item, index) => ({
          label: { label: item.name, description: item.group || zh.snippets.ungrouped },
          detail: zh.snippets.suggestion,
          documentation: item.description || item.sql.slice(0, 256),
          kind: monaco.languages.CompletionItemKind.Snippet,
          range,
          insertText: item.sql,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
          sortText: '1' + String(index).padStart(2, '0'),
        })) };
      },
    });
    return () => { active = false; registration.dispose(); };
  }, [snippetCompletion, readOnly, contentReady, dialect]);
  useEffect(() => {
    if(readOnly||!completion){statusRef.current?.('idle');return;}
    // SQLite使用自己的词法和目录，不能将其正文、临时对象或标识符预算交给MySQL分析器。
    if (dialect === 'sqlite') {
      const worker = new SqliteCompletionWorkerClient(() => new SqliteCompletionWorker());
      const provider = createSqliteCompletionProvider({ connectionId: completion.connectionId, sessionId: completion.sessionId,
        model: () => editorRef.current?.getModel() ?? null,
        current: () => aliveRef.current && !propsRef.current.readOnly && !suggestionsBlocked() && sameCompletionScope(completionRef.current, completion) && contentRef.current?.ready === true && !document.querySelector('[role="dialog"], [role="alertdialog"]'),
        worker, request: input => invoke('sqlite.completion', input), cancel: taskId => invoke('query.cancel', { taskId }),
        state: sessionId => invoke('query.completionState', { sessionId }), id: () => sqliteCompletionTaskPrefix + uid(), status: status => statusRef.current?.(status),
      });
      const registration = monaco.languages.registerCompletionItemProvider('sql', { triggerCharacters: provider.triggerCharacters,
        provideCompletionItems: async (model, position, context, token) => {
          const result = await provider.provideCompletionItems(model, position, context, token);
          return { ...result, suggestions: result.suggestions.map(item => ({ ...item, kind: completionKinds[item.kind], ...(item.trigger ? { command: { id: 'editor.action.triggerSuggest', title: '' } } : {}) })) };
        },
      });
      const hoverRegistration = monaco.languages.registerHoverProvider('sql', { provideHover: (model, position, token) => provider.provideHover(model, position, token) });
      return () => { hoverRegistration.dispose(); registration.dispose(); void provider.dispose().catch(() => {}); };
    }
    const worker=new CompletionWorkerClient(()=>new CompletionWorker()),directory=new CompletionDirectory(completion.connectionId,completion.connectionVersion,{request:input=>invoke('metadata.completion',input),cancel:taskId=>invoke('query.cancel',{taskId}),id:uid});
    let active:AbortController|undefined,disposed=false;
    let hover: ReturnType<typeof createSqlFieldHoverProvider> | undefined;
    const scopeCurrent = () => aliveRef.current && !propsRef.current.readOnly && sameCompletionScope(completionRef.current, completion);
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters:['.','`'],
      provideCompletionItems: async (model, position,_context,token) => {
        if (disposed||readOnly||suggestionsBlocked()||!scopeCurrent()||editorRef.current?.getModel()!==model||model.isDisposed()||token.isCancellationRequested)return{suggestions:[]};
        hover?.cancel();
        active?.abort();const controller=new AbortController();active=controller;statusRef.current?.('idle');
        if(model.getValueLength()>completionLimits.sourceUnits){statusRef.current?.('limited');return{suggestions:[]};}
        const version=model.getVersionId(),source=model.getValue(),offset=model.getOffsetAt(position),cancel=token.onCancellationRequested(()=>controller.abort()),change=model.onDidChangeContent(()=>controller.abort());
        // 无会话草稿复用既有连接检查的事实；不为能力判断新增SQL或主动建立查询会话。
        const openedFacts=completion.sessionId?undefined:completionServerFacts.get(completion.connectionId,completion.connectionVersion);
        /** 每次await后核对模型与版本，标签切换、连接修订和编辑取消都不能交付旧建议。 */
        const current=()=>!disposed&&!suggestionsBlocked()&&scopeCurrent()&&!controller.signal.aborted&&!model.isDisposed()&&editorRef.current?.getModel()===model&&model.getVersionId()===version&&active===controller&&(!!completion.sessionId||completionServerFacts.get(completion.connectionId,completion.connectionVersion)===openedFacts);
        try{
          const cached=completion.sessionId?await invoke('query.completionState',{sessionId:completion.sessionId}):undefined;if(!current())return{suggestions:[]};
          const cachedDialect=cached?.dialect;if(cachedDialect==='sqlite')return{suggestions:[]};
          const scope=resolveCompletionContext(completion.database,cached,completion.databaseUnknown);if(!scope.available){statusRef.current?.(scope.reason==='broken'?'unavailable':'idle');return{suggestions:[]};}
          const capabilities=completionContextCapabilities(cached,openedFacts);
          const analysis=await worker.analyze(source,offset,scope.mode,controller.signal,capabilities);if(!current())return{suggestions:[]};
          if(analysis.status==='blocked'){statusRef.current?.(analysis.reason==='startup-timeout'?'startupTimeout':analysis.reason==='timeout'?'analysisTimeout':analysis.reason==='budget'?'limited':analysis.reason==='worker'?'unavailable':'idle');return{suggestions:[]};}
          const sourceDirectory=completion.sessionId?new SessionCompletionDirectory(directory,query=>{
            if(query.kind==='databases'||query.kind==='objects'&&query.objectKind!=='relation')throw new Error('会话目录目标无效');
            return invoke('query.temporaryCompletion',query.kind==='columns'?{sessionId:completion.sessionId!,kind:'columns',database:query.database,table:query.table,prefix:query.prefix,...(query.details?{details:true}:{})}:{sessionId:completion.sessionId!,kind:'objects',database:query.database,prefix:query.prefix});
          },cached?.objectsRevision??0):directory;
          const result=await completionSuggestions(analysis,scope.database,sourceDirectory,controller.signal,cachedDialect);if(!current())return{suggestions:[]};
          if(completion.sessionId){const latest=await invoke('query.completionState',{sessionId:completion.sessionId});if(!current()||latest.busy||latest.broken||latest.objectsRevision!==cached?.objectsRevision||latest.databaseKnown!==cached?.databaseKnown||latest.database!==cached?.database||latest.dialect!==cached?.dialect||latest.serverVersion!==cached?.serverVersion)return{suggestions:[]};}
          const start=model.getPositionAt(analysis.target.start),end=model.getPositionAt(analysis.target.end);if(start.lineNumber!==end.lineNumber)return{suggestions:[]};
          const range={startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column};
          statusRef.current?.(result.unavailable?'unavailable':result.sessionUncertain?'sessionUnknown':scope.databaseUnknown?'databaseUnknown':result.incomplete?'partial':'idle');
          return{incomplete:result.incomplete,suggestions:result.items.map((item,index)=>({label:item.label,kind:completionKinds[item.kind],insertText:item.insertText,detail:item.detail,range,filterText:analysis.target.quoted?source[analysis.target.start]+item.label:item.label,sortText:(item.kind==='keyword'?'9':'0')+String(index).padStart(4,'0'),...(item.trigger?{command:{id:'editor.action.triggerSuggest',title:''}}:{})}))};
        }catch{if(current())statusRef.current?.('unavailable');return{suggestions:[]};}
        finally{cancel.dispose();change.dispose();if(active===controller)active=undefined;}
      }
    });
    hover = createSqlFieldHoverProvider({
      scope: completion, model: () => editorRef.current?.getModel() ?? null,
      current: () => !disposed && scopeCurrent() && contentRef.current?.ready === true,
      completionBusy: () => !!active,
      facts: () => completionServerFacts.get(completion.connectionId, completion.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), directory,
      analyze: (source, offset, mode, signal, capabilities) => worker.analyze(source, offset, mode, signal, capabilities, 'hover'),
      temporary: (sessionId, query) => {
        if (query.kind !== 'columns') throw Error('字段悬停只读取单字段目录');
        return invoke('query.temporaryCompletion', { sessionId, kind: 'columns', database: query.database, table: query.table, prefix: query.prefix, ...(query.details ? { details: true } : {}) });
      }
    });
    const hoverRegistration = monaco.languages.registerHoverProvider('sql', hover.provider);
    return()=>{disposed=true;active?.abort();hoverRegistration.dispose();hover?.dispose();provider.dispose();worker.dispose();directory.dispose();};
  },[readOnly,dialect,completion?.connectionId,completion?.connectionVersion,completion?.database,completion?.databaseUnknown,completion?.sessionId]);
  /** 字号与正文桥接可随布局恢复；执行动作及父层onReady不在这里重复发布。 */
  function attachContent(editor: monaco.editor.IStandaloneCodeEditor) {
    contentRef.current?.dispose(); editorRef.current = editor;
    // 布局恢复可能保留原model；显式选项先于正文桥接恢复，readonly仍交原桥接管理。
    widgetRef.current?.indentation?.sync();
    // 迟到挂载/布局恢复只应用最新已提交字号，readonly仍完全由原正文桥接管理。
    editor.updateOptions({ fontSize: optionsRef.current.fontSize, lineHeight: optionsRef.current.lineHeight });
    // 迟到挂载/恢复只取稳定optionsRef中最后提交的换行值，不动模型或readonly。
    editor.updateOptions({ wordWrap: optionsRef.current.wordWrap });
    const bridge = editorContentBridge(editor, () => propsRef.current, ready => {
      optionsRef.current.readOnly = !ready || propsRef.current.readOnly;
      if (aliveRef.current) setContentReady(ready);
    });
    contentRef.current = bridge;
    return bridge;
  }
  /** 只给显式可编辑入口注册格式化；布局隐藏保留同一动作，迟到回调须核当前widget与桥接。 */
  function syncFormatAction() {
    const widget = widgetRef.current;
    if (!aliveRef.current || !widget?.alive) return;
    if (propsRef.current.readOnly || !propsRef.current.onFormat) {
      widget.formatToken = undefined; widget.formatAction?.dispose(); widget.formatAction = undefined; return;
    }
    if (widget.formatAction) return;
    const token = {}; widget.formatToken = token;
    widget.formatAction = widget.editor.addAction({
      id: 'dbark-format-sql', label: sqlFormattingZh.action,
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      precondition: 'editorTextFocus && !editorReadonly',
      run: () => {
        // 回调只取最新已提交props；失效、只读、隐藏或尚未桥接的实例不能操作当前查询。
        if (!aliveRef.current || widgetRef.current !== widget || !widget.alive || widget.formatToken !== token || editorRef.current !== widget.editor || !contentRef.current?.ready || propsRef.current.readOnly || widget.editor.getRawOptions().readOnly) return;
        propsRef.current.onFormat?.();
      },
    });
  }
  /** 挂载时注册一次执行动作，编辑器销毁后 Monaco 自动释放该实例动作。 */
  const mounted: OnMount = editor => {
    // 已卸载组件的迟到挂载通知不得重新开放输入或调用父层。
    if (!aliveRef.current) { if (editor.getModel()) editor.updateOptions({ readOnly: true }); return; }
    widgetRef.current?.formatAction?.dispose(); widgetRef.current?.indentation?.dispose(); widgetRef.current?.disposal?.dispose();
    const widget: NonNullable<typeof widgetRef.current> = { editor, alive: true }; widgetRef.current = widget;
    widget.indentation = bindEditorIndentation(editor, () => editorIndentationOptions(optionsRef.current.tabSize, optionsRef.current.insertSpaces), () => aliveRef.current && widget.alive && widgetRef.current === widget);
    widget.disposal = editor.onDidDispose(() => { widget.alive = false; widget.formatToken = undefined; widget.formatAction?.dispose(); widget.indentation?.dispose(); if (editorRef.current === editor) editorRef.current = null; });
    const bridge = attachContent(editor);
    editor.addAction({ id: 'dbark-run', label: zh.editor.text001, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current?.() });
    // 与原动作分开注册；按钮和快捷键最终进入同一个忙碌/模态守卫。
    if (currentRunRef.current) editor.addAction({ id: 'dbark-run-current', label: currentStatementZh.action, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter], run: () => currentRunRef.current?.() });
    // 仅编辑区接收快捷键，结果网格、筛选输入和其它页面保留原按键语义。
    if (selectCurrentRef.current) editor.addAction({ id: 'dbark-select-current-statement', label: uiCommandLabels['select-current-statement'], precondition: '!editorReadonly && !editorHasMultipleSelections', keybindingContext: 'editorTextFocus', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE], run: () => selectCurrentRef.current?.() });
    // 编辑器快捷键和原生菜单走同一个方言检查，避免绕过 MySQL 双负号保护。
    if (toggleCommentRef.current) editor.addAction({ id: 'dbark-toggle-sql-comment', label: uiCommandLabels['sql-toggle-comment'], precondition: '!editorReadonly', keybindingContext: 'editorTextFocus', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash], run: () => toggleCommentRef.current?.() });
    if (propsRef.current.onFormat) syncFormatAction();
    // 正文订阅、受控同步与readonly解除均已完成，父层才可取得可交互实例。
    if (bridge.ready) propsRef.current.onReady?.(editor);
  };
  return <div style={{ height, position: 'relative' }} aria-busy={!contentReady} onKeyDown={event => { if (event.key === 'Escape') setRenameMessage(null); }}><div aria-hidden={!contentReady} inert={!contentReady} style={{ height: '100%', visibility: contentReady ? 'visible' : 'hidden' }}><Editor language="sql" theme={theme === 'dark' ? 'vs-dark' : 'light'} defaultValue={value} onMount={mounted} height="100%" loading={<div className="editor-loading">{zh.editor.text002}</div>} options={optionsRef.current}/></div>{!contentReady && <div className="editor-loading" style={{ position: 'absolute', inset: 0 }}>{zh.editor.text002}</div>}{contentReady && renameMessage && <div className="sql-rename-message" role="status"><span>{renameMessage}</span><button aria-label={localRenameZh.dismiss} onClick={() => { setRenameMessage(null); editorRef.current?.focus(); }}>×</button></div>}</div>;
}
