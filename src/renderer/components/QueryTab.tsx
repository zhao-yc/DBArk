import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { queryRowDetailsZh as rowDetailsText } from '../locales/queryRowDetails.zh-CN';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { queryResultColumnKeys, queryResultVisibleColumns, type QueryResultColumnLayout } from '../queryResultColumns';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultSort, queryResultSortSupportsIgnoreCase, type QueryResultSortBinding, type QueryResultSortView, type QueryResultSortRule } from '../queryResultSort';
import { QueryResultFilter, queryResultFilteredSortView, appendQueryResultFilterRule, appendQueryResultFilterNode, type QueryResultFilterBinding, type QueryResultFilterView, type QueryResultFilterGroup } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterRule, type CellFilterOperator } from '../queryResultCellFilter';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture } from '../queryResultSelectedFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { QueryResultHistory, prepareQueryResultOrganization } from '../queryResultHistory';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { captureQueryResultMemory, queryResultMemoryMatches, type QueryResultMemory } from '../queryResultMemory';
import { queryResultMemoryZh as memoryText } from '../locales/queryResultMemory.zh-CN';
import { queryResultPresetValueSchema, type QueryResultPresetValue } from '../../shared/queryResultPresets';
import { QueryResultPresetsDialog } from './QueryResultPresetsDialog';
import { QueryResultStatisticsDialog } from './QueryResultStatisticsDialog';
import { QueryResultComparisonDialog } from './QueryResultComparisonDialog';
import { queryResultComparisonZh as comparisonText } from '../locales/queryResultComparison.zh-CN';
import { captureQueryResultStatistics } from '../queryResultStatistics';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';
import { queryResultPresetsZh as presetsText } from '../locales/queryResultPresets.zh-CN';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import '../queryResultSort.css';
import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QueryCloseDialog } from './QueryCloseDialog';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { queryCloseZh } from '../locales/queryClose.zh-CN';
import type * as monaco from 'monaco-editor';
import { formatSqlEditor } from '../sqlFormatting';
import { DeferredUpperSqlFormatting } from '../sqlFormattingDeferred';
import { readSqlKeywordCase } from '../../shared/sqlKeywordCase';
import { sqlFormattingZh } from '../locales/sqlFormatting.zh-CN';
import { Play, Square, AlignLeft, Save, History, Gauge, ChevronDown, Check, RotateCcw, LockKeyhole, Pin, X, Download, BookOpen, Braces, Copy } from 'lucide-react';
import type { QueryOutcome, QueryResult, ResultColumn, DataRow } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { acquireWorkspaceBusy, flushSettings,useWorkspace, wasQueryFileOpenTarget, type WorkspaceTab, type WorkspaceBusyLease } from '../store';
import { SqlEditor,type SqlCompletionStatus } from './SqlEditor';
import {SavedQueryMatchNavigation} from './SavedQueryMatchNavigation';
import type {SavedQueryNavigationSource} from '../../shared/savedQuerySearch';
import {completionZh} from '../locales/completion.zh-CN';
import type {CompletionSessionState} from '../../shared/sqlCompletion';
import {queryConnectionDatabase,queryDatabaseFromSession,queryDatabasePatch,resolveQueryDatabase,type QueryDatabaseContext} from '../../shared/queryContext';
import {queryContextZh} from '../locales/queryContext.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import { ExplainPlanView } from './ExplainPlanView';
import { QueryPartialOutcomeNotice } from './QueryPartialOutcomeNotice';
import { captureQueryFailureSource, type QueryFailureSourceLease, type QueryFailureSourceScope } from '../queryFailureSource';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import { snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { exportableQueryResult, resultExportData, ResultExportSelection, type ResultSelectionBinding, type ResultGridSelection } from '../resultExport';
import { ResultExportDialog } from './ResultExportDialog';
import { ResultInsertDialog } from './ResultInsertDialog';
import { ResultInsertSourceIntent } from '../resultInsertUi';
import { resultInsertZh } from '../locales/resultInsert.zh-CN';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import { SnippetsDialog } from './SnippetsDialog';
import { snippetEdit } from '../snippetInsertion';
import { QueryParametersDialog } from './QueryParametersDialog';
import { parameterZh } from '../locales/queryParameters.zh-CN';
import type { QueryParameter } from '../../shared/queryParameters';
import '../queryPins.css';
import { QueryStreamExportDialog, type StreamExportOptions } from './QueryStreamExportDialog';
import { queryStreamZh } from '../locales/queryStreamExport.zh-CN';
import {SessionObjectsDialog} from './SessionObjectsDialog';
import {sessionObjectsZh} from '../locales/sessionObjects.zh-CN';
import { QueryBindingDialog } from './QueryBindingDialog';
import { queryBindingZh } from '../locales/queryBinding.zh-CN';
import { savedQueryOriginContext } from '../../shared/queryBinding';
import { CurrentStatementIntent, type CurrentStatementScope } from '../currentStatementIntent';
import { currentStatementZh } from '../locales/currentStatement.zh-CN';
import { QueryDuplicateIntent } from '../queryDuplicateIntent';
import { flushEditorContent } from '../editorContentBridge';
import { captureQueryFileSnapshot } from '../queryFileSnapshot';
import { useQueryFileSource } from '../useQueryFileSource';
import { QuerySourceLease, querySourceTab } from '../querySourceLease';
import { queryFilesZh } from '../locales/queryFiles.zh-CN';
import { queryDuplicateZh } from '../locales/queryDuplicate.zh-CN';
import { QueryLayoutSplitter, queryEditorVisualHeight } from './QueryLayoutSplitter';
import { queryLayoutLimits, readQueryEditorHeight } from '../../shared/queryLayout';
import { beginWorkspaceQueryLayout, queryLayoutActiveTab, queryLayoutTarget } from '../queryLayoutWorkspace';
import { useQueryLayoutMaximum } from '../useQueryLayoutMaximum';
import '../queryLayout.css';
const completionStatusInfo={sessionUnknown:{text:completionZh.sessionUnknown,hint:completionZh.sessionUnknownHint},partial:{text:completionZh.partial,hint:completionZh.partialHint},unavailable:{text:completionZh.unavailable,hint:completionZh.unavailableHint},limited:{text:completionZh.limited,hint:completionZh.limitedHint},databaseUnknown:{text:completionZh.databaseUnknown,hint:completionZh.databaseUnknownHint},startupTimeout:{text:completionZh.startupTimeout,hint:completionZh.startupTimeoutHint},analysisTimeout:{text:completionZh.analysisTimeout,hint:completionZh.analysisTimeoutHint}};

/** 一个标签对应一个固定会话，流式结果和任务事件只接收当前执行编号。 */
export function QueryTab({ tab, onHistory,searchNavigation,closeRequest,onCloseRequestFinished }: { closeRequest?: QueryCloseRequest; onCloseRequestFinished?(request: QueryCloseRequest, close: boolean): void; tab: WorkspaceTab; onHistory: () => void;searchNavigation?:SavedQueryNavigationSource }) {
  const alive = useRef(true), closeRequestRef = useRef(closeRequest); closeRequestRef.current = closeRequest;
  const closeIntent = useRef<QuerySaveCloseIntent | undefined>(undefined);
  const closeBusy = useRef<WorkspaceBusyLease | undefined>(undefined);
  const formatting = useRef<DeferredUpperSqlFormatting | null>(null);
  const duplicateIntent = useRef<QueryDuplicateIntent | null>(null); const [duplicating, setDuplicating] = useState(false);
  const [closePhase, setClosePhase] = useState<'choose' | 'save' | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; failureSource.current?.dispose(); parameterFailureSource.current?.dispose(); formatting.current?.dispose(); formatting.current = null; duplicateIntent.current?.dispose(); if (closeIntent.current) { closeIntent.current.dispose(); closeBusy.current?.release(); } }; }, []);
  useEffect(() => { formatting.current?.dispose(); closeIntent.current?.dispose(); setClosePhase(closeRequest ? 'choose' : null); }, [closeRequest]);
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const [sessionId, setSessionId] = useState(''); const sessionRef = useRef(''); const pendingSession = useRef<Promise<string> | null>(null);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const task = useRef(''); const [transaction, setTransaction] = useState(false);
  const cancelledQuery=useRef('');
  const explainSource = useRef('');
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null); const [stream, setStream] = useState<QueryResult[]>([]); const [resultIndex, setResultIndex] = useState(0);
  const [error, setError] = useState(''); const [save, setSave] = useState(false); const [queryName, setQueryName] = useState('');
  const [completionStatus,setCompletionStatus]=useState<SqlCompletionStatus>('idle');const connectionVersion=useWorkspace(state=>state.connectionVersions[tab.connectionId]??0);
  const layoutRoot=useRef<HTMLDivElement>(null),layoutEditorId=useId();
  // 原子提交后父props可能尚未刷新；仅本文件占位首次挂载需等到当前完整标签，避免瞬间创建旧空模型。
  const firstFileOpen=useRef(wasQueryFileOpenTarget(tab)), fileModelAttached=useRef(false);
  const fileOpening=useWorkspace(state=>state.queryFileOpenings[tab.id]?.target===tab || firstFileOpen.current && !fileModelAttached.current && state.settings.tabs.find(item=>item.id===tab.id)!==tab);
  const layoutMaximum=useQueryLayoutMaximum(layoutRoot,queryLayoutLimits.maxEditorHeight);
  const [editorPreview,setEditorPreview]=useState<number|null>(null);
  const preferredEditorHeight=readQueryEditorHeight(tab.queryEditorHeight);
  const editorHeight=queryEditorVisualHeight(editorPreview??preferredEditorHeight,layoutMaximum);
  const layoutActiveTab=queryLayoutActiveTab(settings),layoutScope=JSON.stringify([queryLayoutTarget(tab,connectionVersion),layoutActiveTab,!!closeRequest]);
  const duplicateOrigin = useRef({ connectionId: tab.connectionId, version: connectionVersion });
  const [completionSession,setCompletionSession]=useState<CompletionSessionState>();
  const [sessionObjects,setSessionObjects]=useState(false);
  const [recovery,setRecovery]=useState(false);const [recoveryDatabase,setRecoveryDatabase]=useState('');
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const failureSource = useRef<QueryFailureSourceLease | undefined>(undefined), parameterFailureSource = useRef<QueryFailureSourceLease | undefined>(undefined);
  const [, refreshFailureSource] = useState(0);
  const fileSource = useQueryFileSource(tab, () => captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)), () => alive.current, value => { busyRef.current = value; setBusy(value); }, { editor: () => editor.current, available: () => !busyRef.current && !pendingSession.current && !closeRequestRef.current && !formatting.current, current: () => !pendingSession.current && !closeRequestRef.current && !formatting.current });
  const activeCurrentIntent = useRef<CurrentStatementIntent | null>(null);
  const [searchEditor,setSearchEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  const [pins, setPins] = useState<PinnedQueryResult[]>([]); const [selectedPin, setSelectedPin] = useState(''); const pinSequence = useRef(0);
  const [showPinSql, setShowPinSql] = useState(false);
  const [exportResult, setExportResult] = useState<QueryResult | null>(null);
  const [exportSelected, setExportSelected] = useState(false);
  const resultSelection = useRef(new ResultExportSelection()).current;
  const [resultInsertSource, setResultInsertSource] = useState<ResultInsertSourceIntent | null>(null), resultInsertRef = useRef<ResultInsertSourceIntent | null>(null);
  const resultInsertActivity = useRef(0), resultInsertBusy = useRef<WorkspaceBusyLease | undefined>(undefined);
  const resultSorterRef = useRef(new QueryResultSort()), resultFilterRef = useRef(new QueryResultFilter());
  const resultSorter = resultSorterRef.current, resultFilter = resultFilterRef.current;
  const resultHistory = useRef(new QueryResultHistory()).current;
  const resultMemoryRef = useRef<QueryResultMemory | undefined>(undefined), resultMemory = resultMemoryRef.current;
  type FilterLease={binding:QueryResultFilterBinding;view:QueryResultFilterView;sortBinding:QueryResultSortBinding;sortView:QueryResultSortView;seed?:QueryResultFilterGroup};
  type SortLease = { binding: QueryResultSortBinding; view: QueryResultSortView; filterBinding: QueryResultFilterBinding; filterView: QueryResultFilterView };
  type PresetLease = SortLease & { owner: string; value: QueryResultPresetValue };
  const [presetLease, setPresetLease] = useState<PresetLease | null>(null), presetLeaseRef = useRef<PresetLease | null>(null);
  type StatisticsLease = SortLease & { owner:string; columns:ResultColumn[]; rows:DataRow[]; column:ResultColumn; indices:ReadonlySet<number>; truncated:boolean; filter:QueryResultFilter; sorter:QueryResultSort };
  const [statisticsLease,setStatisticsLease]=useState<StatisticsLease|null>(null),statisticsLeaseRef=useRef<StatisticsLease|null>(null);
  type ComparisonLease={owner:string;pins:readonly PinnedQueryResult[]};
  const [comparisonLease,setComparisonLease]=useState<ComparisonLease|null>(null),comparisonLeaseRef=useRef<ComparisonLease|null>(null);
  const comparisonPinsRef=useRef(pins);comparisonPinsRef.current=pins;
  const [sortLease, setSortLease] = useState<SortLease | null>(null), sortLeaseRef = useRef<SortLease | null>(null);
  const [filterLease,setFilterLease]=useState<FilterLease|null>(null),filterLeaseRef=useRef<FilterLease|null>(null);
  const rowDetails = useRef(new QueryRowDetails()).current;
  const [rowDetail, setRowDetail] = useState<QueryRowDetailsView | null>(null);
  const [activeDetailRow, setActiveDetailRow] = useState<{ binding: QueryRowDetailsBinding; index: number } | null>(null);
  const [, refreshResultSelection] = useState(0);
  const [columnLayout,setColumnLayout]=useState<{result:QueryResult;context:readonly unknown[];layout:QueryResultColumnLayout}>();
  type ColumnLease={binding:ResultSelectionBinding;owner:string;initial:QueryResultColumnLayout};
  const [columnLease,setColumnLease]=useState<ColumnLease|null>(null), columnLeaseRef=useRef<ColumnLease|null>(null);
  const resultOwner=useRef({tabId:tab.id,connectionId:tab.connectionId,version:connectionVersion});resultOwner.current={tabId:tab.id,connectionId:tab.connectionId,version:connectionVersion};
  /** 直接观察工作区ABA及其它模态，旧管理器／网格事件不能在恢复原值后重领。 */
  useEffect(()=>{
    const revoke=()=>{resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;setComparisonLease(null);statisticsLeaseRef.current=null;setStatisticsLease(null);presetLeaseRef.current=null;setPresetLease(null);sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);resultSelection.invalidate();rowDetails.invalidate();setRowDetail(null);setActiveDetailRow(null);columnLeaseRef.current=null;setColumnLease(null);refreshResultSelection(value=>value+1);};
    const unsubscribe=useWorkspace.subscribe(state=>{const source=resultOwner.current,current=state.settings.tabs.find(item=>item.id===source.tabId);const sourceChanged=current?.kind!=='query'||current.connectionId!==source.connectionId||(state.connectionVersions[source.connectionId]??0)!==source.version;const changed=state.settings.activeTabId!==source.tabId||sourceChanged;if(sourceChanged)resultMemoryRef.current=undefined;if(changed)resultHistory.invalidate();if(changed||state.activeJobs[source.tabId]&&!resultInsertActivity.current)revoke();else resultInsertRef.current?.current();});
    let blocked=false;
    const inspect=(records:MutationRecord[]=[])=>{
      const lease=columnLeaseRef.current, preset=presetLeaseRef.current, statistics=statisticsLeaseRef.current, comparison=comparisonLeaseRef.current, insert=resultInsertRef.current, owned=lease?document.querySelector(`[data-query-columns-owner="${lease.owner}"]`)?.querySelector('[role="dialog"]'):preset?document.querySelector(`[data-query-result-presets-owner="${preset.owner}"]`)?.querySelector('[role="dialog"]'):statistics?document.querySelector(`[data-query-result-statistics-owner="${statistics.owner}"]`)?.querySelector('[role="dialog"]'):comparison?document.querySelector(`[data-query-result-comparison-owner="${comparison.owner}"]`)?.querySelector('[role="dialog"]'):insert?Array.from(document.querySelectorAll('[role="dialog"]')).find(node=>node.querySelector(`[data-result-insert-owner="${insert.owner}"]`)):undefined;
      const foreign=Array.from(document.querySelectorAll('[role="dialog"]')).some(node=>node!==owned);
      const added=records.some(record=>Array.from(record.addedNodes).some(node=>node instanceof Element&&(node.getAttribute('role')==='dialog'&&node!==owned||Array.from(node.querySelectorAll('[role="dialog"]')).some(dialog=>dialog!==owned))));
      if(foreign&&!blocked||added)revoke();else if(blocked&&!foreign)revoke();blocked=foreign;
    };
    const observer=typeof MutationObserver==='undefined'?undefined:new MutationObserver(inspect);observer?.observe(document.body,{childList:true,subtree:true});
    return()=>{unsubscribe();observer?.disconnect();resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;statisticsLeaseRef.current=null;presetLeaseRef.current=null;resultMemoryRef.current=undefined;resultFilterRef.current.invalidate();resultSorterRef.current.invalidate();resultHistory.invalidate();resultSelection.invalidate();rowDetails.invalidate();columnLeaseRef.current=null;sortLeaseRef.current=null;};
  },[tab.id,tab.connectionId,resultSelection]);
  /** 新执行和结果切换先撤销同步绑定，旧事件不能在下一次渲染前导出。 */
  function invalidateResultSelection() { resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;setComparisonLease(null);statisticsLeaseRef.current=null;setStatisticsLease(null);sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);resultSelection.invalidate(); rowDetails.invalidate(); setRowDetail(null); setActiveDetailRow(null); }
  const [showSnippets, setShowSnippets] = useState(false); const snippetSelection = useRef<monaco.Selection | null>(null);
  const snippetModel = useRef<monaco.editor.ITextModel | null>(null);
  const [parameterSource, setParameterSource] = useState<string | null>(null);
  const parameterSession = useRef(''); const [queryRunning, setQueryRunning] = useState(false);
  const [transactionKnown, setTransactionKnown] = useState(true);
  const [streamExportSource, setStreamExportSource] = useState<string | null>(null); const streamParameterSession = useRef(''); const streamCancelled = useRef('');
  /** 打开前保留查询选区，模态内预览编辑器不能改变插入位置。 */
  function openSnippets() { invalidateResultSelection(); snippetSelection.current = editor.current?.getSelection() ?? null; snippetModel.current = editor.current?.getModel() ?? null; setShowSnippets(true); }
  /** 普通文本编辑保留撤销栈，不执行 SQL，也不改变结果或事务。 */
  function insertSnippet(sql: string) {
    const instance = editor.current; const range = snippetSelection.current;
    if (!instance || !range || !instance.getModel() || instance.getModel() !== snippetModel.current || !useWorkspace.getState().settings.tabs.some(item => item.id === tab.id)) throw new Error(zh.snippets.insertUnavailable);
    instance.pushUndoStop(); instance.executeEdits('dbark-sql-snippet', [snippetEdit(range, sql)]); instance.pushUndoStop();
    setShowSnippets(false); window.setTimeout(() => instance.focus(), 0);
  }

  /** 每个查询标签保持独立会话；事务和临时表不会混入其他标签。 */
  async function ensureSession() {
    if (sessionRef.current) return sessionRef.current;
    if (!pendingSession.current){
      const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id)??tab;
      const context=resolveQueryDatabase(current.database,current.databaseContext,workspace.connections.find(item=>item.id===tab.connectionId)?.database);
      if(context.state==='unknown'){setRecoveryDatabase('');setRecovery(true);}
      const database=queryConnectionDatabase(context);
      pendingSession.current = invoke('connections.open', { id: tab.connectionId }).then(() => invoke('sessions.open', { connectionId: tab.connectionId, database })).then(result => { sessionRef.current = result.sessionId; setSessionId(result.sessionId); return result.sessionId; }).finally(() => { pendingSession.current = null; });
    }
    return pendingSession.current;
  }
  /** 仅更新仍存在的查询标签；重复快照不触发SQLite写入，也不复活已经关闭的标签。 */
  function rememberDatabase(context:QueryDatabaseContext, request?:QueryCloseRequest){
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);if(!current)return;
    const patch=queryDatabasePatch(context);if(current.database===patch.database&&JSON.stringify(current.databaseContext)===JSON.stringify(context))return;
    if(request?.mutate)request.mutate(current,patch,()=>workspace.updateTab(tab.id,patch));else workspace.updateTab(tab.id,patch);
  }
  /** 用户SQL发送前等待恢复信息真正落盘，不能把400毫秒防抖窗口当作崩溃安全。 */
  async function prepareExecutionContext(){
    rememberDatabase({state:'unknown'});
    try{await flushSettings();}catch(reason){throw new Error(queryContextZh.snapshotFailed+errorMessage(reason));}
  }
  /** 准备阶段先记取消意图，迟到的建连或配置保存完成后也不能继续投递用户SQL。 */
  async function cancelCurrentQuery(){cancelledQuery.current=task.current;await invoke('query.cancel',{taskId:task.current});}
  /** 明确的结构读取占用原会话，用户SQL保持原文和结果；自动补全不会进入此路径。 */
  async function readTemporaryObject(input:{database:string;table:string;taskId:string}){
    if(busyRef.current)throw new Error(sessionObjectsZh.busy);const current=sessionRef.current;if(!current)throw new Error(sessionObjectsZh.closed);
    busyRef.current=true;setBusy(true);useWorkspace.getState().setBusy(tab.id,true);
    try{return await invoke('query.temporaryRead',{...input,sessionId:current});}catch(reason){await handleQueryError(reason);throw reason;}
    finally{busyRef.current=false;setBusy(false);useWorkspace.getState().setBusy(tab.id,false);}
  }
  useEffect(() => () => { const id = sessionRef.current; if (id) void invoke('sessions.close', { sessionId: id }).catch(() => {}); else void pendingSession.current?.then(sessionId => invoke('sessions.close', { sessionId })).catch(() => {}); }, []);
  useEffect(()=>{
    // 正文执行结束只读协议缓存更新面包屑；期间隐藏旧库，绝不为展示附加SELECT DATABASE()。
    let alive=true;setCompletionSession(undefined);
    if(sessionId&&!busy)void invoke('query.completionState',{sessionId}).then(state=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current){setCompletionSession(state);rememberDatabase(queryDatabaseFromSession(state));}}).catch(()=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current)rememberDatabase({state:'unknown'});});
    return()=>{alive=false;};
  },[sessionId,busy,connectionVersion]);
  useEffect(() => window.dbark?.onTask(event => {
    if (event.taskId !== task.current || event.resultIndex === undefined) return;
    setStream(previous => {
      const updated = previous.slice(); const index = event.resultIndex!;
      const result = updated[index] ?? { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: '' };
      updated[index] = { ...result, columns: event.columns ?? result.columns, rows: [...result.rows, ...(event.batch ?? [])].slice(0, settings.resultLimit) }; return updated;
    });
  }), [settings.resultLimit]);
  useEffect(() => window.dbark?.onMenu(action => {
    if (useWorkspace.getState().settings.activeTabId !== tab.id) return;
    // 原生菜单快捷键也须尊重模态窗口，查看快照 SQL 时不能执行后台编辑器。
    if (document.querySelector('[role="dialog"]')) return;
    if (fileSource.isBusy()) return;
    if (action === 'execute') void execute();
    if (action === 'save-query') saveCurrentSource();
  }));

  /** 捕获点击时的编辑器正文和选区，参数表单打开后不重新读取后台草稿。 */
  function querySource(all = false) {
    const selection = editor.current?.getSelection(); const selected = selection ? editor.current?.getModel()?.getValueInRange(selection) : '';
    return !all && selected?.trim() ? selected : editor.current?.getModel()?.getValue() ?? tab.sql ?? '';
  }
  /** 定位独立于会话与当前语句投递意图；正文、标签和连接修订均读取同步工作区。 */
  function failureSourceScope(): QueryFailureSourceScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, draft: current?.sql, present: alive.current && current?.kind === 'query' && workspace.connections.some(item => item.id === connectionId), active: workspace.settings.activeTabId === tab.id, busy: busyRef.current || !!workspace.activeJobs[tab.id], modal: !!document.querySelector('[role="dialog"]'), closing: !!closeRequestRef.current };
  }
  /** 捕获失败仅使定位不可用，不改变原执行范围、参数模板或发送行为。 */
  function captureFailureSource(source: string, all = false): QueryFailureSourceLease | undefined {
    if (!editor.current) return;
    return captureQueryFailureSource({ editor: editor.current, source, all, scope: failureSourceScope, subscribe: changed => useWorkspace.subscribe(changed), onInvalidated: () => { if (alive.current) refreshFailureSource(value => value + 1); } });
  }
  /** 新执行或新来源释放旧定位；旧按钮回调只能持有已失效的租约。 */
  function clearFailureSource(): void { failureSource.current?.dispose(); failureSource.current = undefined; }
  /** 格式化是当前草稿的普通编辑，不建连、投递SQL或改写会话/来源绑定。 */
  function formatQuery() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    try {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), instance = editor.current;
      const model = instance?.getModel(), eol = model?.getEOL();
      // 与正文桥的受控同步采用同一模型EOL；只比较，不回写或吞掉其它正文差异。
      if (!alive.current || workspace.activeJobs[tab.id] || workspace.settings.activeTabId !== tab.id || current?.kind !== 'query' || !instance || !model || (eol !== '\n' && eol !== '\r\n') || model.getValue() !== (current.sql ?? '').replace(/\r\n|\r|\n/g, eol)) throw new Error(sqlFormattingZh.unavailable);
      const preferences = { tabSize: workspace.settings.editorTabSize, insertSpaces: workspace.settings.editorInsertSpaces, keywordCase: workspace.settings.sqlKeywordCase };
      if (readSqlKeywordCase(preferences.keywordCase) === 'preserve') { formatting.current?.dispose(); formatting.current = null; formatSqlEditor(instance, preferences); return; }
      if (formatting.current || pendingSession.current || closeRequestRef.current || fileSource.isBusy()) throw Error(sqlFormattingZh.unavailable);
      const owner = current, profile = workspace.connections.find(item => item.id === owner.connectionId), version = workspace.connectionVersions[owner.connectionId] ?? 0, session = sessionRef.current;
      let operation: DeferredUpperSqlFormatting | undefined, observer: MutationObserver | undefined, modalSeen = false;
      // 模态窗口即使打开又关闭也留下墓碑；提交前同步取出尚未投递的记录。
      const inspectModals = (records: MutationRecord[]) => { if (records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1 && ((node as Element).getAttribute('role') === 'dialog' || (node as Element).querySelector('[role="dialog"]'))))) modalSeen = true; };
      operation = new DeferredUpperSqlFormatting({
        editor: () => editor.current,
        assertCurrent() {
          if (observer) inspectModals(observer.takeRecords());
          const latest = useWorkspace.getState(), target = latest.settings.tabs.find(item => item.id === tab.id);
          if (!alive.current || operation && formatting.current !== operation || target !== owner || latest.connections.find(item => item.id === owner.connectionId) !== profile || (latest.connectionVersions[owner.connectionId] ?? 0) !== version || sessionRef.current !== session || latest.settings.activeTabId !== tab.id || latest.activeJobs[tab.id] || busyRef.current || pendingSession.current || closeRequestRef.current || fileSource.isBusy() || modalSeen || document.querySelector('[role="dialog"]') || latest.settings.sqlKeywordCase !== preferences.keywordCase || latest.settings.editorTabSize !== preferences.tabSize || latest.settings.editorInsertSpaces !== preferences.insertSpaces) throw Error(sqlFormattingZh.unavailable);
        },
        subscribe(changed) {
          const unsubscribe = useWorkspace.subscribe(changed);
          if (typeof MutationObserver !== 'undefined') { observer = new MutationObserver(records => { inspectModals(records); if (modalSeen) changed(); }); observer.observe(document.body, { childList: true, subtree: true }); }
          return () => { unsubscribe(); observer?.disconnect(); observer = undefined; };
        },
      }, preferences);
      formatting.current = operation; const captured = operation;
      return captured.run().catch(reason => { if (alive.current && formatting.current === captured && useWorkspace.getState().settings.tabs.find(item => item.id === tab.id) === owner) setError(errorMessage(reason)); }).finally(() => { if (formatting.current === captured) formatting.current = null; });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 复制仅占本地意图，不占SQL任务、不清结果；关闭/换连/新作业会永久撤销等待中的复制。 */
  async function duplicateQuery() {
    if (duplicateIntent.current) return;
    let intent: QueryDuplicateIntent | undefined;
    try {
      const scope = () => {
        const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === current?.connectionId), origin = duplicateOrigin.current;
        return { tab: current, connection: profile, connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0, sessionId: sessionRef.current,
          present: alive.current && current?.kind === 'query' && !!profile && current.connectionId === tab.connectionId && current.connectionId === origin.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === origin.version,
          active: workspace.settings.activeTabId === tab.id, blocked: busyRef.current || !!workspace.activeJobs[tab.id] || !!pendingSession.current || !!closeRequestRef.current || !!document.querySelector('[role="dialog"]') };
      };
      intent = new QueryDuplicateIntent({ editor: () => editor.current, scope, flush: flushEditorContent,
        subscribe: changed => {
          const unsubscribe = useWorkspace.subscribe(changed);
          const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(records => {
            if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof Element && (node.getAttribute('role') === 'dialog' || node.querySelector('[role="dialog"]'))))) intent?.dispose();
          });
          observer?.observe(document.body, { childList: true, subtree: true }); return () => { unsubscribe(); observer?.disconnect(); };
        },
        database: async initial => initial.sessionId ? queryDatabaseFromSession(await invoke('query.completionState', { sessionId: initial.sessionId })) : resolveQueryDatabase(initial.tab?.database, initial.tab?.databaseContext, initial.connection?.database),
        open: candidate => { const workspace = useWorkspace.getState(); if (workspace.settings.tabs.length >= 100) throw Error(queryDuplicateZh.tooMany); workspace.openTab(candidate); },
      });
      duplicateIntent.current = intent; setDuplicating(true); await intent.run();
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { intent?.dispose(); if (duplicateIntent.current === intent) { duplicateIntent.current = null; if (alive.current) setDuplicating(false); } }
  }
  /** 选区优先执行；执行计划走专用命令，由引擎拒绝多语句输入。 */
  async function execute(mode: 'selected' | 'all' | 'explain' = 'selected') {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(mode === 'all'), locator = mode === 'explain' ? undefined : captureFailureSource(source, mode === 'all');
    await runQuery(source, mode === 'explain' ? 'explain' : 'execute', undefined, undefined, locator);
  }
  /** 编辑器实例被替换时立即撤销旧意图，旧实例迟到销毁或随后换回也不能复活。 */
  function attachQueryEditor(instance: monaco.editor.IStandaloneCodeEditor) {
    fileModelAttached.current = true;
    if (editor.current !== instance) { clearFailureSource(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; formatting.current?.dispose(); formatting.current = null; activeCurrentIntent.current?.dispose(); duplicateIntent.current?.dispose(); }
    editor.current = instance; setSearchEditor(instance);
  }
  /** 直接读workspace和session同步引用，不等待React重新渲染才能拒绝旧连接或旧草稿。 */
  function currentStatementScope(): CurrentStatementScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, sessionId: sessionRef.current, draft: current?.sql, present: current?.kind === 'query' && workspace.connections.some(item => item.id === connectionId), active: workspace.settings.activeTabId === tab.id, modal: !!document.querySelector('[role="dialog"]') };
  }
  /** 独立入口只捕获当前模型，不读取选区或tab.sql代替正文，也不改原执行快捷键。 */
  async function executeCurrentStatement() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    let intent: CurrentStatementIntent | undefined;
    try {
      if (!editor.current) throw new Error(currentStatementZh.unavailable);
      intent = new CurrentStatementIntent(editor.current, currentStatementScope, changed => useWorkspace.subscribe(changed));
      activeCurrentIntent.current = intent;
      await runQuery(intent.source, 'execute', undefined, intent, captureFailureSource(intent.source, true));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { intent?.dispose(); if (activeCurrentIntent.current === intent) activeCurrentIntent.current = null; }
  }
  /** 参数识别只打开固定会话，不建立任务、不执行用户模板，也不清除已有结果。 */
  function openParameters() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    clearFailureSource(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = captureFailureSource(source);
    invalidateResultSelection(); parameterSession.current = ''; setParameterSource(source);
  }
  /** 捕获不可变选区或全文；打开和选择文件均不执行 SQL。 */
  function openStreamExport() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    invalidateResultSelection(); streamParameterSession.current = ''; setStreamExportSource(source);
  }
  /** 参数识别只读取会话协议缓存，保留旧结果和事务，互斥持续至 IPC 结束。 */
  async function loadStreamParameterNames() {
    if (busyRef.current) throw new Error(queryStreamZh.blocked);
    busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
    try { const session = await ensureSession(); const result = await invoke('query.parameterNames', { sessionId: session, sql: streamExportSource! }); streamParameterSession.current = session; return result; }
    catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 最终确认只执行一次，在原标签会话中产生完整文件和独立有界预览。 */
  async function runStreamExport(options: StreamExportOptions) {
    if (busyRef.current) throw new Error(queryStreamZh.blocked);
    const source = streamExportSource!; clearFailureSource();
    invalidateResultSelection(); busyRef.current = true; streamCancelled.current = ''; setBusy(true); setQueryRunning(true); setError(''); if(options.format!=='sql'){setSelectedPin(''); setShowPinSql(false);setOutcome(null); setStream([]); setResultIndex(0);} task.current = options.taskId;cancelledQuery.current=''; useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      if (streamCancelled.current === options.taskId) throw new Error(queryStreamZh.cancelledBeforeExecution);
      if (options.parameters && streamParameterSession.current !== session) throw new Error(queryStreamZh.sessionChanged);
      await prepareExecutionContext();
      if(streamCancelled.current===options.taskId||cancelledQuery.current===options.taskId)throw new Error(queryContextZh.cancelledBeforeSend);
      const result = await invoke('query.exportStream', { ...options, sql: source, sessionId: session });
      if(options.format!=='sql')setOutcome(result.preview); setTransaction(result.transactionOpen ?? false); setTransactionKnown(result.transactionKnown); useWorkspace.getState().setDirty(tab.id, !result.transactionKnown || !!result.transactionOpen);
      return result;
    } catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 会话尚在建立时取消也必须阻止迟到的执行请求；已登记任务仍由引擎释放资源。 */
  async function cancelStreamExport(taskId: string) { streamCancelled.current = taskId; await invoke('query.cancel', { taskId }); }
  /** 模态关闭仍等待识别请求结束，期间保持标签互斥，不能同时开启另一条查询。 */
  async function loadParameterNames() {
    if (busyRef.current) throw new Error('当前标签仍有操作正在进行，请稍后重试');
    busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      const names = await invoke('query.parameterNames', { sessionId: session, sql: parameterSource! });
      parameterSession.current = session; return names;
    } catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 读取协议缓存更新事务提示；错误后不附加 SQL，不重放任何已经执行的写操作。 */
  async function handleQueryError(reason: unknown) {
    const message = errorMessage(reason); const current = sessionRef.current;
    const state = current ? await invoke('query.sessionState', { sessionId: current }).catch(() => null) : null;
    if (state?.broken || /会话不存在|会话连接已断开|数据库执行进程已退出|PROTOCOL_CONNECTION_LOST|ECONNRESET/.test(message)) {
      rememberDatabase({state:'unknown'});
      sessionRef.current = ''; setSessionId(''); setTransaction(false); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, false);
      if (current) void invoke('sessions.close', { sessionId: current }).catch(() => {});
      setError(formatText(zh.query.text002, message));
    } else {
      if (state) { setTransaction(state.transactionOpen); setTransactionKnown(state.transactionKnown); useWorkspace.getState().setDirty(tab.id, state.transactionOpen || !state.transactionKnown); }
      else if (current) { setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); }
      setError(message);
    }
  }
  /** 所有查询共用流式结果、取消与会话互斥；确认参数后立即取得互斥，无延迟重复执行窗口。 */
  async function runQuery(source: string, mode: 'execute' | 'explain' | 'explain-text' = 'execute', parameters?: QueryParameter[], currentIntent?: CurrentStatementIntent, locator?: QueryFailureSourceLease) {
    if (busyRef.current) { locator?.dispose(); return; }
    if (!source.trim()) { locator?.dispose(); setError(zh.query.text001); return; }
    clearFailureSource(); let retainLocator = false;
    invalidateResultSelection(); busyRef.current = true; setBusy(true); setQueryRunning(true); setError(''); setSelectedPin(''); setShowPinSql(false); setOutcome(null); setStream([]); setResultIndex(0); task.current = uid();cancelledQuery.current=''; useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      currentIntent?.bindSession(session);
      if (parameters && session !== parameterSession.current) throw new Error('参数识别时的会话已失效，请重新打开参数表单');
      // 从发送前到协议终态之间持久化为未知，崩溃恢复不会误把初始库用于下一次写入。
      await prepareExecutionContext();
      if(cancelledQuery.current===task.current)throw new Error(queryContextZh.cancelledBeforeSend);
      currentIntent?.assertCurrent();
      const input = { sessionId: session, sql: source, taskId: task.current, maxRows: settings.resultLimit, ...(currentIntent ? { currentStatement: { offset: currentIntent.offset } } : {}) };
      // 文本计划复用首次捕获的 SQL，切换展示不会读取后来编辑的草稿。
      if (mode !== 'execute') explainSource.current = source;
      const result = parameters ? await invoke('query.executeParameterized', { ...input, parameters }) : mode === 'execute' ? await invoke('query.execute', input) : await invoke('query.explain', { ...input, format: mode === 'explain-text' ? 'text' : 'auto' });
      if (result.failure && locator?.bindRange(result.failure.sourceRange)) { failureSource.current = locator; retainLocator = true; }
      // 原响应只包含此前完整成功结果；清除失败语句的部分流，不能将其当作可固定或导出的结果。
      setOutcome(result); setStream([]);
      if (result.failure) await handleQueryError(new Error(result.failure.message));
      else if (result.transactionOpen !== undefined) { setTransaction(result.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, result.transactionOpen); }
    } catch (reason) { await handleQueryError(reason); }
    finally { if (!retainLocator) locator?.dispose(); busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 事务控制与普通查询串行执行，避免提交正在运行的语句。 */
  async function transactionAction(action: 'begin' | 'commit' | 'rollback') {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try { const session=await ensureSession();await prepareExecutionContext();await invoke('query.transaction', { sessionId:session, action }); setTransaction(action === 'begin'); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, action === 'begin'); useWorkspace.getState().notify(action === 'begin' ? zh.query.text003 : action === 'commit' ? zh.query.text004 : zh.query.text005); }
    catch (reason) { await handleQueryError(reason); }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 普通保存按当前主来源分流，文件标签直接写回关联文件；查询库另存始终有独立入口。 */
  function saveCurrentSource() {
    if (busyRef.current) return;
    invalidateResultSelection();
    if (useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)?.fileSourceBinding) void fileSource.save();
    else { setQueryName(tab.title); setSave(true); }
  }
  /** 文件保存后关闭仍使用严格正文/请求租约；保存期间的新编辑保留并停止关闭队列。 */
  async function saveFileAndClose() {
    const request = closeRequestRef.current;
    let intent: QuerySaveCloseIntent | undefined;
    try {
      if (!request || !editor.current) throw Error(queryCloseZh.unavailable);
      const state = useWorkspace.getState();
      if (state.activeJobs[tab.id] || state.dirtyTabs[tab.id]) throw Error(queryCloseZh.changed);
      captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
      intent = new QuerySaveCloseIntent(editor.current, () => {
        const currentState = useWorkspace.getState(), current = currentState.settings.tabs.find(item => item.id === tab.id);
        return { present: current?.kind === 'query', connection: currentState.connections.find(item => item.id === current?.connectionId), draft: current?.sql, title: current?.title, blocked: !!currentState.dirtyTabs[tab.id], connectionId: current?.connectionId ?? '', connectionVersion: currentState.connectionVersions[tab.connectionId] ?? 0, sessionId: sessionRef.current, database: current?.database, databaseContext: current?.databaseContext };
      }, listener => useWorkspace.subscribe(listener), () => alive.current, () => closeRequestRef.current === request);
      closeIntent.current = intent;
      const result = await fileSource.save(undefined, request, () => !!intent?.isCurrent(), title => intent?.adoptTitle(title));
      if (!alive.current || closeRequestRef.current !== request) return;
      const after = useWorkspace.getState(), close = result.saved && result.applied && result.restored && result.busyUnchanged && intent.isCurrent() && !after.activeJobs[tab.id] && !after.dirtyTabs[tab.id];
      if (result.saved && !close) after.notify(queryCloseZh.retained, true);
      finishClose(close);
    } catch (reason) { request?.failed?.(); setError(errorMessage(reason)); finishClose(false); }
    finally { intent?.dispose(); if (closeIntent.current === intent) closeIntent.current = undefined; }
  }
  /** 关闭三选沿主来源分流；文件失败转恢复入口，绝不隐式转存查询库。 */
  function beginCloseSave() {
    if (useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)?.fileSourceBinding) { setClosePhase(null); void saveFileAndClose(); }
    else { setQueryName(tab.title); setClosePhase('save'); }
  }
  /** 保存点击时的正文与真实会话默认库；不执行SQL，不从初始标签库回填未知状态。 */
  async function saveQuery(action: 'update' | 'create', name: string, intent?: QuerySaveCloseIntent, request?: QueryCloseRequest) {
    if(busyRef.current)throw Error(queryContextZh.busy);
    intent?.assertCurrent();
    const current = useWorkspace.getState().settings.tabs.find(item => item.id === tab.id);
    if (!current) throw Error(queryBindingZh.missing);
    const sql = current.fileSourceBinding ? captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)).sql ?? '' : editor.current?.getModel()?.getValue() ?? current.sql ?? '';
    const fileLease = current.fileSourceBinding ? new QuerySourceLease({ ...current }, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id), listener => useWorkspace.subscribe(listener), () => alive.current) : undefined;
    const job = intent ? acquireWorkspaceBusy(tab.id) : undefined;
    if (job) closeBusy.current = job;
    busyRef.current=true;setBusy(true);if (!job) useWorkspace.getState().setBusy(tab.id,true);
    try {
      const context = sessionRef.current ? savedQueryOriginContext(undefined, queryDatabaseFromSession(await invoke('query.completionState',{sessionId:sessionRef.current}).catch(()=>undefined)))
        : current.sourceBinding?.context.state === 'legacy' && current.databaseContext === undefined ? savedQueryOriginContext(current.database)
        : savedQueryOriginContext(undefined, resolveQueryDatabase(current.database,current.databaseContext,connection?.database));
      intent?.assertCurrent();
      if (context.state !== 'legacy') { intent?.adoptContext(context); rememberDatabase(context, request); }
      const content = { name, connectionId: current.connectionId, context, sql };
      if (action === 'update' && !current.sourceBinding) throw Error(queryBindingZh.unbound);
      const result = action === 'update' ? await invoke('queries.updateSource', { source: current.sourceBinding!, content }) : await invoke('queries.create', content);
      // 成功后才推进所见摘要；仅更新仍存在的原标签，绝不替换会话、事务或结果。
      const workspace = useWorkspace.getState(); let sourceApplied = true;
      if (fileLease) {
        // 文件标签显式另存查询库后原子切换主来源；旧回包不能夺走后来建立的文件关联。
        if (fileLease.current()) {
          const released = await invoke('queryFileSources.release', { tabId: tab.id, source: current.fileSourceBinding! }).catch(() => { throw Error(queryFilesZh.releaseFailed); });
          if (!released.released) throw Error(queryFilesZh.releaseFailed);
        }
        sourceApplied = fileLease.apply((_before, adoptTitle) => {
          const latest = useWorkspace.getState(); latest.updateSettings({ tabs: latest.settings.tabs.map(item => item.id === tab.id ? querySourceTab(item, { sourceBinding: result.source, ...(adoptTitle ? { title: result.name } : {}) }, 'library') : item) });
        });
      } else if ((!intent || intent.ownsView()) && workspace.settings.tabs.some(item => item.id === tab.id)) {
        const before=workspace.settings.tabs.find(item=>item.id===tab.id)!,patch={title:result.name,sourceBinding:result.source};
        if(request?.mutate)request.mutate(before,patch,()=>workspace.updateTab(tab.id,patch));else workspace.updateTab(tab.id,patch);
      }
      if (!intent || intent.ownsView()) setSave(false); workspace.notify(!sourceApplied ? queryFilesZh.libraryRetained : action === 'update' ? queryBindingZh.saved : queryBindingZh.created, !sourceApplied);
      let restored = true;
      await flushSettings().catch(reason => { restored = false; workspace.notify(queryBindingZh.restoreFailed + errorMessage(reason), true); });
      return { restored, busyUnchanged: !job || job.owns() };
    }
    finally {
      fileLease?.dispose();
      busyRef.current=false; if (!intent || intent.ownsView()) setBusy(false);
      // 新作业接替后只释放本次租约，不能清掉新标记或借此获得关闭权限。
      if (job) { job.release(); if (closeBusy.current === job) closeBusy.current = undefined; }
      else useWorkspace.getState().setBusy(tab.id,false);
    }
  }
  /** 一次关闭请求只借用既有保存函数；失败保留弹窗，成功后不重发写入。 */
  async function saveAndClose(action: 'update' | 'create', name: string) {
    const request = closeRequestRef.current;
    let intent: QuerySaveCloseIntent | undefined;
    try {
      if (!request || !editor.current) throw Error(queryCloseZh.unavailable);
      const before = useWorkspace.getState();
      if (before.activeJobs[tab.id] || before.dirtyTabs[tab.id]) throw Error(queryCloseZh.changed);
      intent = new QuerySaveCloseIntent(editor.current, () => {
        const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === current?.connectionId);
        return { present: current?.kind === 'query' && !!profile, connection: profile, draft: current?.sql, blocked: !!state.dirtyTabs[tab.id], connectionId: current?.connectionId ?? '', connectionVersion: state.connectionVersions[tab.connectionId] ?? 0, sessionId: sessionRef.current, database: current?.database, databaseContext: current?.databaseContext };
      }, listener => useWorkspace.subscribe(listener), () => alive.current, () => closeRequestRef.current === request);
      closeIntent.current = intent;
      const result = await saveQuery(action, name, intent, request);
      if (!alive.current || closeRequestRef.current !== request) return;
      const state = useWorkspace.getState(), close = result.restored && result.busyUnchanged && intent.isCurrent() && !state.activeJobs[tab.id] && !state.dirtyTabs[tab.id];
      if (result.restored && !close) state.notify(queryCloseZh.retained, true);
      setClosePhase(null); onCloseRequestFinished?.(request, close);
    } catch (reason) { request?.failed?.(); throw reason; }
    finally { intent?.dispose(); if (closeIntent.current === intent) closeIntent.current = undefined; }
  }
  /** 直接关闭也需核对请求及既有作业/事务守卫；空草稿不要求保存。 */
  function finishClose(close: boolean) {
    const request = closeRequestRef.current; if (!request) return;
    closeIntent.current?.dispose(); setClosePhase(null); onCloseRequestFinished?.(request, close);
  }
  // 保存类互斥不卸载计划查看器；实际新执行在 runQuery 内清空 outcome，仍走原结果生命周期。
  const results = outcome?.failure ? outcome.results : queryRunning ? stream : outcome?.results ?? stream; const pin = pins.find(item => item.id === selectedPin); const sourceResult = pin?.result ?? results[resultIndex];
  const sourceExportable = exportableQueryResult(busy, outcome, resultIndex, pin?.result);
  // 结果快照的寿命独立于模态/保存锁；只有新查询才撤销数据来源，操作权限仍走原忙态守卫。
  const viewSource = exportableQueryResult(queryRunning, outcome, resultIndex, pin?.result);
  const resultContext=[outcome,resultIndex,selectedPin,task.current,connectionVersion,tab.connectionId];
  const layoutMatches=!!columnLayout&&columnLayout.result===sourceResult&&columnLayout.context.length===resultContext.length&&columnLayout.context.every((value,index)=>Object.is(value,resultContext[index]));
  const visibleColumns=useMemo(()=>{
    if(!sourceResult)return [];
    if(layoutMatches&&columnLayout)try{return queryResultVisibleColumns(sourceResult.columns,columnLayout.layout);}catch{/* 元数据变化后回到原列，不能继续沿用旧布局。 */}
    return sourceResult.columns;
  },[sourceResult,columnLayout,layoutMatches]);
  const resultModal=!!comparisonLease||!!statisticsLease||!!presetLease||!!closeRequest||!!exportResult||save||showPinSql||showSnippets||parameterSource!==null||streamExportSource!==null||sessionObjects||recovery;
  const failureLocator = failureSource.current;
  // 先过滤原快照，再排序过滤行；源映射显式合成，所有消费者只索引同一最终视图。
  const filterBinding=resultFilter.bind(viewSource,resultContext,visibleColumns);
  const filterView=resultFilter.view(filterBinding);
  const sortBinding = resultSorter.bind(filterView?.result ?? viewSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
  const historyBinding = resultHistory.bind(viewSource, visibleColumns, resultContext, filterView && sortView ? { expression: filterView.expression, sort: sortView.rules } : undefined, filterBinding);
  const displayedView=useMemo(()=>queryResultFilteredSortView(filterView,sortView),[filterView,sortView]);
  const result = displayedView?.result ?? sourceResult,exportable=sourceExportable ? displayedView?.result ?? sourceExportable : undefined;
  const activeFilterLease=filterLease&&filterLeaseRef.current===filterLease&&resultFilter.view(filterLease.binding)===filterLease.view&&resultSorter.view(filterLease.sortBinding)===filterLease.sortView?filterLease:null;
  if(filterLease&&!activeFilterLease&&filterLeaseRef.current===filterLease)filterLeaseRef.current=null;
  const activeSortLease = sortLease && sortLeaseRef.current === sortLease && resultSorter.view(sortLease.binding) === sortLease.view && resultFilter.view(sortLease.filterBinding) === sortLease.filterView ? sortLease : null;
  if (sortLease && !activeSortLease && sortLeaseRef.current === sortLease) sortLeaseRef.current = null;
  const activePresetLease=presetLease&&presetLeaseRef.current===presetLease&&resultFilter.view(presetLease.filterBinding)===presetLease.filterView&&resultSorter.view(presetLease.binding)===presetLease.view?presetLease:null;
  useEffect(()=>{if(presetLease&&!activePresetLease){if(presetLeaseRef.current===presetLease)presetLeaseRef.current=null;setPresetLease(null);}},[presetLease,activePresetLease]);
  // 父渲染仅核一次完整视图；对话框的分批计数不在每批重复遍历原结果。
  const activeStatisticsLease=statisticsLease&&statisticsLeaseRef.current===statisticsLease&&resultFilter===statisticsLease.filter&&resultSorter===statisticsLease.sorter&&resultFilter.view(statisticsLease.filterBinding)===statisticsLease.filterView&&resultSorter.view(statisticsLease.binding)===statisticsLease.view?statisticsLease:null;
  if(statisticsLease&&!activeStatisticsLease&&statisticsLeaseRef.current===statisticsLease)statisticsLeaseRef.current=null;
  useEffect(()=>{if(statisticsLease&&!activeStatisticsLease)setStatisticsLease(null);},[statisticsLease,activeStatisticsLease]);
  const selectionBinding = resultSelection.bind(settings.activeTabId === tab.id&&!resultModal ? exportable : undefined, resultContext, visibleColumns);
  // 本用途的自有模态不撤销选择绑定；原结果/视图/列/上下文仍随每次渲染同步核验。
  const resultInsertView = useRef({ result: exportable, columns: visibleColumns, context: resultContext, binding: selectionBinding }); resultInsertView.current = { result: exportable, columns: visibleColumns, context: resultContext, binding: selectionBinding };
  // 详情绑定当前行视图的完整原列；排序只改行序，不把visibleColumns当成全部返回字段。
  const detailBinding = rowDetails.bind(settings.activeTabId === tab.id && !resultModal ? exportable : undefined, [tab.id, ...resultContext]);
  const currentRowDetail = rowDetail && rowDetails.valid(rowDetail) ? rowDetail : null;
  /** 排序预算只禁排序；未取得排序租约时仍核准确原结果，原能力另核各自租约和预算。 */
  function resultViewCurrent(expected: QueryResult | undefined): boolean {
    if(filterBinding&&!resultFilter.view(filterBinding))return false;
    return !!expected && (sortBinding ? resultSorter.view(sortBinding)?.result === expected : (filterView?.result ?? sourceExportable) === expected);
  }
  /** 直接读原工作区防止标签/连接/忙态ABA；内联region不放宽已有modal保护。 */
  function rowDetailAllowed(binding: QueryRowDetailsBinding | undefined): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector('[role="dialog"]') && resultViewCurrent(binding?.result) && rowDetails.current(binding);
  }
  /** 活动位置独立于勾选；RDG的视图rowIdx只用于同一视图binding，不索引原source.rows。 */
  function selectActiveDetailRow(index: number | null): void {
    if (!rowDetailAllowed(detailBinding) || !detailBinding) return;
    if (index === null) { setActiveDetailRow(null); return; }
    if (!Number.isSafeInteger(index) || index < 0 || index >= detailBinding.rows.length) return;
    setActiveDetailRow(old => old && old.binding === detailBinding && old.index === index ? old : { binding: detailBinding, index });
  }
  function openRowDetail(): void {
    if (!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)) return;
    try { setRowDetail(rowDetails.open(detailBinding, activeDetailRow.index)); } catch { setError(rowDetailsText.invalid); }
  }
  /** 旧侧栏的翻行/关闭回调不能作用于下一原行视图。 */
  function moveRowDetail(view: QueryRowDetailsView, index: number): void {
    if (!rowDetailAllowed(view.binding) || !rowDetails.valid(view)) return;
    try { setRowDetail(rowDetails.move(view, index)); } catch { setError(rowDetailsText.invalid); }
  }
  function closeRowDetail(view: QueryRowDetailsView): void { if (rowDetailAllowed(view.binding) && rowDetails.close(view)) setRowDetail(null); }
  /** 面板独立草稿租约；同步核源、工作区和模态，取消/切换后旧应用不可重放。 */
  function filterPanelCurrent(lease:FilterLease):boolean{
    if(sortLeaseRef.current||filterLeaseRef.current!==lease||resultFilterRef.current.view(lease.binding)!==lease.view||resultSorterRef.current.view(lease.sortBinding)!==lease.sortView)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!document.querySelector('[role="dialog"]');
  }
  /** 打开只撤销旧选择；取消不修改过滤、排序和原SQL。 */
  function openFilterPanel():void{showFilterPanel();}
  /** 已生效view仍作租约依据；快捷条件只改变独立初始草稿，不冒充已应用视图。 */
  function showFilterPanel(seed?:QueryResultFilterGroup):void{
    if(!filterBinding||!filterView||!sortBinding||!sortView||!resultSelectionAllowed(selectionBinding))return;
    invalidateResultSelection();const lease={binding:filterBinding,view:filterView,sortBinding,sortView,seed};filterLeaseRef.current=lease;setFilterLease(lease);refreshResultSelection(value=>value+1);
  }
  /** 原显示位置对应原行及可见唯一键，追加AND保留旧OR括号；结构超限时完整保留原视图。 */
  function openCellFilter(cell:QueryResultCopyCell,operator:CellFilterOperator):void{
    if(!filterBinding||!filterView||!result||!resultSelectionAllowed(selectionBinding))return;
    try{const capture=captureQueryResultCellFilter(visibleColumns,result.rows,cell),seed=appendQueryResultFilterRule(filterView.expression,queryResultCellFilterRule(capture,operator));showFilterPanel(seed);}catch(reason){setError(errorMessage(reason));}
  }
  /** 勾选集合须与父级接纳的精确索引一致；全部结构检查通过后才撤销选择并打开审核草稿。 */
  function openSelectedFilter(capture:QueryResultSelectedFilterCapture):void{
    const current=()=>!!result&&resultSelectionAllowed(selectionBinding)&&resultSelection.matchesIndices(selectionBinding,capture.indices)&&currentQueryResultSelectedFilter(capture,visibleColumns,result.rows);
    if(!filterBinding||!filterView||!current())return;
    try{
      const seed=appendQueryResultFilterNode(filterView.expression,queryResultSelectedFilterNode(capture));
      if(current())showFilterPanel(seed);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 新筛选与已有完整排序共同试算；两者均成功且来源仍有效才一次发布并记一整步。 */
  function replaceResultFilter(expression:QueryResultFilterGroup,sort:readonly QueryResultSortRule[],isCurrent:()=>boolean):void{
    if(!viewSource||!historyBinding||!isCurrent())return;
    try{
      const prepared=prepareQueryResultOrganization(viewSource,resultContext,visibleColumns,{expression,sort});
      if(!isCurrent())return;
      const next={expression:prepared.filter.view(prepared.filterBinding)!.expression,sort:prepared.sorter.view(prepared.sortBinding)!.rules};
      resultHistory.record(historyBinding,next,prepared.filterBinding);
      resultFilter.invalidate();resultSorter.invalidate();resultFilterRef.current=prepared.filter;resultSorterRef.current=prepared.sorter;
      setError('');invalidateResultSelection();refreshResultSelection(value=>value+1);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 草稿租约同时绑定排序视图，不能在新筛选失败时丢掉NULL、大小写或旧优先级。 */
  function applyFilterRules(lease:FilterLease,expression:QueryResultFilterGroup):void{
    replaceResultFilter(expression,lease.sortView.rules,()=>filterPanelCurrent(lease));
  }
  /** 旧取消只关闭自己的草稿，不影响较新面板。 */
  function closeFilterPanel(lease:FilterLease):void{if(filterLeaseRef.current!==lease)return;sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);}
  /** 清除只移除筛选；在全部原返回行上保留原排序，排序失败时完整保留旧视图。 */
  function clearResultFilter():void{
    if(!filterBinding||!filterView||!sortView)return;
    replaceResultFilter({mode:'AND',children:[]},sortView.rules,()=>resultSelectionAllowed(selectionBinding));
  }
  /** 独立排序草稿同时绑定原排序及筛选视图；结果、列布局和工作区变代后不复活。 */
  function sortPanelCurrent(lease: SortLease): boolean {
    if (sortLeaseRef.current !== lease || resultSorterRef.current.view(lease.binding) !== lease.view || resultFilterRef.current.view(lease.filterBinding) !== lease.filterView) return false;
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !filterLeaseRef.current && !columnLeaseRef.current && !document.querySelector('[role="dialog"]');
  }
  /** 打开只清旧选择；当前筛选、排序和历史均保持，草稿不触发比较或SQL。 */
  function openSortPanel(): void {
    if (!sortBinding || !sortView || !filterBinding || !filterView || !resultSelectionAllowed(selectionBinding)) return;
    invalidateResultSelection(); const lease = { binding: sortBinding, view: sortView, filterBinding, filterView }; sortLeaseRef.current = lease; setSortLease(lease); refreshResultSelection(value => value + 1);
  }
  /** 完整比较通过后一次发布并记一条整理历史；失败保留原排序及独立草稿。 */
  function applySortPanel(lease: SortLease, rules: QueryResultSortRule[]): boolean {
    if (!sortPanelCurrent(lease)) return false;
    try {
      const sorted = resultSorter.apply(lease.binding, lease.view, rules);
      resultHistory.record(historyBinding, { expression: lease.filterView.expression, sort: sorted.rules });
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1); return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  /** 旧取消不能关闭新面板；当前取消不改原视图或整理历史。 */
  function closeSortPanel(lease: SortLease): void {
    if (sortLeaseRef.current !== lease) return;
    invalidateResultSelection(); refreshResultSelection(value => value + 1);
  }
  /** 同一排序视图才可受理列头/键盘回调；同步撤销旧选择，原SQL及会话完全不变。 */
  function sortResult(next: QueryResultSortRule[]): void {
    if (!sortBinding || !sortView || !resultSelectionAllowed(selectionBinding) || resultSorter.view(sortBinding) !== sortView) return;
    try {
      const sorted = resultSorter.apply(sortBinding, sortView, next);
      if (filterView) resultHistory.record(historyBinding, { expression: filterView.expression, sort: sorted.rules });
      invalidateResultSelection(); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 完整试算成功且原视图仍有效才发布两个控制器；不执行SQL，不恢复旧选择或行详情。 */
  function travelResultHistory(direction: -1 | 1): void {
    if (!viewSource || !filterView || !sortView || !historyBinding || !resultSelectionAllowed(selectionBinding)) return;
    const ticket = resultHistory.target(historyBinding, direction); if (!ticket) return;
    try {
      const prepared = prepareQueryResultOrganization(viewSource, resultContext, visibleColumns, ticket.configuration);
      if (!resultSelectionAllowed(selectionBinding)) return;
      resultHistory.commit(ticket, prepared.filterBinding);
      resultFilter.invalidate(); resultSorter.invalidate();
      resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 暂存只复制完整配置，保留当前视图、历史和选择，不获取SQL或行快照。 */
  function rememberResultOrganization(): void {
    if (!viewSource || !filterView || !sortView || !resultSelectionAllowed(selectionBinding) || columnLeaseRef.current) return;
    try {
      const captured = captureQueryResultMemory(viewSource, visibleColumns, { expression: filterView.expression, sort: sortView.rules });
      if (!resultSelectionAllowed(selectionBinding)) return;
      resultMemoryRef.current = captured; setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 用户显式应用到当前完整返回结果；筛选和排序均成功后一次发布、记一条撤销历史。 */
  function applyRememberedOrganization(): void {
    if (!resultMemory || resultMemoryRef.current !== resultMemory || !viewSource || !historyBinding || !resultSelectionAllowed(selectionBinding) || columnLeaseRef.current) return;
    try {
      if (!queryResultMemoryMatches(resultMemory, viewSource, visibleColumns)) throw Error(memoryText.mismatch);
      const prepared = prepareQueryResultOrganization(viewSource, resultContext, visibleColumns, resultMemory.configuration);
      if (resultMemoryRef.current !== resultMemory || !resultSelectionAllowed(selectionBinding)) return;
      resultHistory.record(historyBinding, resultMemory.configuration, prepared.filterBinding);
      resultFilter.invalidate(); resultSorter.invalidate();
      resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 旧结果或旧暂存的丢弃回调不能清除下一份配置。 */
  function rememberedOrganizationCanDiscard(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return !!resultMemory && resultMemoryRef.current === resultMemory && alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && task.current === resultContext[3] && !columnLeaseRef.current && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector('[role="dialog"]') && (selectionBinding ? resultSelectionAllowed(selectionBinding) : !sourceResult?.columns.length);
  }
  /** 即使后续SQL失败或没有行结果，仍可主动清除包含条件值的内存暂存。 */
  function discardRememberedOrganization(): void {
    if (!rememberedOrganizationCanDiscard()) return;
    resultMemoryRef.current = undefined; refreshResultSelection(value => value + 1);
  }
  /** 只允许本方案窗口；另一模态、连接或原结果变代会永久撤销准确双视图租约。 */
  function presetManagerCurrent(lease: PresetLease): boolean {
    if(presetLeaseRef.current!==lease||resultFilterRef.current.view(lease.filterBinding)!==lease.filterView||resultSorterRef.current.view(lease.binding)!==lease.view)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-presets-owner="${lease.owner}"]`)?.querySelector('[role="dialog"]');
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!Array.from(document.querySelectorAll('[role="dialog"]')).some(node=>node!==owned);
  }
  /** 打开时只捕获完整配置和字段，不复制行或SQL；暂存槽保持独立。 */
  function openResultPresets(): void {
    if(!viewSource||!filterBinding||!filterView||!sortBinding||!sortView||!historyBinding||!resultSelectionAllowed(selectionBinding)||columnLeaseRef.current)return;
    try{
      const value=queryResultPresetValueSchema.parse(captureQueryResultMemory(viewSource,visibleColumns,{expression:filterView.expression,sort:sortView.rules}));
      if(!resultSelectionAllowed(selectionBinding))return;
      invalidateResultSelection();const lease={owner:uid(),value,binding:sortBinding,view:sortView,filterBinding,filterView};presetLeaseRef.current=lease;setPresetLease(lease);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 对比独立于当前结果的选择；仅持有明确的本标签固定快照，不执行SQL或猜测行键。 */
  function openResultComparison():void {
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    if(!alive.current||busyRef.current||workspace.activeJobs[tab.id]||workspace.settings.activeTabId!==tab.id||current?.kind!=='query'||current.connectionId!==tab.connectionId||(workspace.connectionVersions[current.connectionId]??0)!==connectionVersion||comparisonPinsRef.current!==pins||pins.length<2||comparisonLeaseRef.current||statisticsLeaseRef.current||columnLeaseRef.current||filterLeaseRef.current||sortLeaseRef.current||presetLeaseRef.current||document.querySelector('[role="dialog"]'))return;
    invalidateResultSelection();const lease={owner:uid(),pins};comparisonLeaseRef.current=lease;setComparisonLease(lease);setError('');
  }
  /** 每批只核父级轻门；对比器最终完整核固定来源，旧窗口不能在标签或连接ABA后复活。 */
  function comparisonCurrent(lease:ComparisonLease):boolean {
    if(comparisonLeaseRef.current!==lease||comparisonPinsRef.current!==lease.pins)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-comparison-owner="${lease.owner}"]`)?.querySelector('[role="dialog"]');
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!statisticsLeaseRef.current&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!presetLeaseRef.current&&!Array.from(document.querySelectorAll('[role="dialog"]')).some(node=>node!==owned);
  }
  /** 迟到关闭只能撤销原owner，不能影响重新打开的对比窗口。 */
  function closeResultComparison(lease:ComparisonLease):void {
    if(comparisonLeaseRef.current!==lease)return;
    comparisonLeaseRef.current=null;setComparisonLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);
  }
  const activeComparisonLease=comparisonLease&&comparisonLeaseRef.current===comparisonLease&&comparisonPinsRef.current===comparisonLease.pins?comparisonLease:null;
  useEffect(()=>{if(comparisonLease&&!activeComparisonLease){if(comparisonLeaseRef.current===comparisonLease)comparisonLeaseRef.current=null;setComparisonLease(null);}},[comparisonLease,activeComparisonLease]);
  /** 每批只核工作区与所属模态；统计器在开始和完成时完整核列、行及原值，避免二次方扫描。 */
  function statisticsCurrent(lease:StatisticsLease):boolean {
    if(statisticsLeaseRef.current!==lease||resultFilterRef.current!==lease.filter||resultSorterRef.current!==lease.sorter)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-statistics-owner="${lease.owner}"]`)?.querySelector('[role="dialog"]');
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!presetLeaseRef.current&&!Array.from(document.querySelectorAll('[role="dialog"]')).some(node=>node!==owned);
  }
  /** 列只认准确可见对象；非空勾选必须匹配父级已接纳回执，不能由调用方伪造范围。 */
  function openResultStatistics(column:ResultColumn,indices:ReadonlySet<number>):void {
    if(!result||!filterBinding||!filterView||!sortBinding||!sortView||!resultSelectionAllowed(selectionBinding)||columnLeaseRef.current||!visibleColumns.includes(column))return;
    try {
      const selected=Array.from(Set.prototype.values.call(indices) as IterableIterator<number>).sort((a,b)=>a-b);
      if(selected.length?!resultSelection.matchesIndices(selectionBinding,selected):resultSelection.count(selectionBinding)!==0)throw Error(statisticsText.stale);
      const admitted=new Set(selected);
      captureQueryResultStatistics(visibleColumns,result.rows,column,selected.length?admitted:undefined);
      if(!resultSelectionAllowed(selectionBinding))return;
      invalidateResultSelection();
      const lease:StatisticsLease={owner:uid(),columns:visibleColumns,rows:result.rows,column,indices:admitted,truncated:result.truncated,binding:sortBinding,view:sortView,filterBinding,filterView,filter:resultFilter,sorter:resultSorter};
      statisticsLeaseRef.current=lease;setStatisticsLease(lease);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 旧窗口关闭回调只撤销自身，不能关闭后来打开的统计窗口。 */
  function closeResultStatistics(lease:StatisticsLease):void {
    if(statisticsLeaseRef.current!==lease)return;
    statisticsLeaseRef.current=null;setStatisticsLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);
  }
  /** Main回读后再核完整元数据并共同试算；成功才原子替换视图并记录一整步。 */
  function applyResultPreset(lease: PresetLease, raw: QueryResultPresetValue): void {
    if(!viewSource||!historyBinding||!presetManagerCurrent(lease))throw Error(presetsText.stale);
    const value=queryResultPresetValueSchema.parse(raw);
    if(!queryResultMemoryMatches(value,viewSource,visibleColumns))throw Error(presetsText.mismatch);
    const prepared=prepareQueryResultOrganization(viewSource,resultContext,visibleColumns,value.configuration);
    if(!presetManagerCurrent(lease))throw Error(presetsText.stale);
    resultHistory.record(historyBinding,value.configuration,prepared.filterBinding);
    resultFilter.invalidate();resultSorter.invalidate();resultFilterRef.current=prepared.filter;resultSorterRef.current=prepared.sorter;
    presetLeaseRef.current=null;setPresetLease(null);invalidateResultSelection();setError('');refreshResultSelection(number=>number+1);
  }
  /** 旧窗口关闭回调只撤销自己的租约，不影响下一份方案或当前结果。 */
  function closeResultPresets(lease: PresetLease): void {if(presetLeaseRef.current!==lease)return;presetLeaseRef.current=null;setPresetLease(null);invalidateResultSelection();refreshResultSelection(number=>number+1);}
  /** 仅重排当前规则数组；仍由sortResult核活视图和全部键，旧按钮不能修改下一代结果。 */
  function moveSortPriority(index: number, offset: -1 | 1): void {
    if (!sortView || index+offset<0 || index+offset>=sortView.rules.length) return;
    const next=[...sortView.rules];[next[index],next[index+offset]]=[next[index+offset],next[index]];sortResult(next);
  }
  /** 空值位置仅替换所属活规则，恢复默认时删除可选项；旧控件仍由sortResult拒绝。 */
  function changeSortNulls(index:number,value:string):void{
    if(!sortView||value!==''&&value!=='FIRST'&&value!=='LAST')return;
    sortResult(sortView.rules.map((item,i)=>{if(i!==index)return item;const{nulls:previous,...base}=item;return value?{...base,nulls:value}:base;}));
  }
  /** 大小写选项只替换所属活规则，关闭时删除可选项，仍由原排序租约核验。 */
  function changeSortCase(index:number,checked:boolean):void{
    if(!sortView)return;
    sortResult(sortView.rules.map((item,i)=>{if(i!==index)return item;const{ignoreCase:previous,...base}=item;return checked?{...base,ignoreCase:true}:base;}));
  }
  const activeColumnLease=columnLease&&columnLeaseRef.current===columnLease&&resultSelection.current(columnLease.binding)?columnLease:null;
  if(columnLease&&!activeColumnLease&&columnLeaseRef.current===columnLease)columnLeaseRef.current=null;
  const selectedExportCount = resultSelection.count(selectionBinding);
  /** 同步读取真实工作区和操作引用；关闭、连接修订或迟到按钮均不能借旧绑定导出。 */
  function resultSelectionAllowed(binding: ResultSelectionBinding | undefined): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !resultInsertRef.current && !comparisonLeaseRef.current && !statisticsLeaseRef.current && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector('[role="dialog"]') && resultViewCurrent(binding?.result) && resultSelection.current(binding);
  }
  /** 网格只交付当前准确数组的选择，验证失败清空选择，不能回退成全结果导出。 */
  function selectResultRows(selection: ResultGridSelection): boolean {
    if (!resultSelectionAllowed(selectionBinding)) return false;
    try { if (resultSelection.select(selectionBinding, selection)) { refreshResultSelection(value => value + 1); return true; } }
    catch (reason) { resultSelection.invalidate(); refreshResultSelection(value => value + 1); setError(errorMessage(reason)); }
    return false;
  }
  /** 打开时克隆已选快照；后续新执行、切换或勾选变化不修改这次文件内容。 */
  function exportSelectedRows() {
    if (!resultSelectionAllowed(selectionBinding)) return;
    try { const snapshot = resultSelection.snapshot(selectionBinding); invalidateResultSelection(); setExportSelected(true); setExportResult(snapshot); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 所有已返回行也只导出打开时的可见列，先校验有界投影再冻结。 */
  function exportVisibleResult(){
    if(!resultSelectionAllowed(selectionBinding))return;
    try{const snapshot=resultSelection.allSnapshot(selectionBinding);invalidateResultSelection();setExportSelected(false);setExportResult(snapshot);}catch(reason){setError(errorMessage(reason));}
  }
  /** 已返回视图直接取得完整typed快照；保留原SQL、事务、结果和勾选，不调用原查询。 */
  function openResultInsert(selected: boolean): void {
    if (!selectionBinding || !resultSelectionAllowed(selectionBinding) || resultInsertRef.current) return;
    try {
      const snapshot = selected ? resultSelection.snapshot(selectionBinding) : resultSelection.allSnapshot(selectionBinding), state = useWorkspace.getState(), originalTab = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === tab.connectionId), binding = selectionBinding, context = [...resultContext], columns = visibleColumns;
      let intent: ResultInsertSourceIntent;
      intent = new ResultInsertSourceIntent(resultExportData(snapshot), selected, uid(), () => {
        const now = useWorkspace.getState(), view = resultInsertView.current, ownBusy = resultInsertActivity.current > 0 && (!resultInsertBusy.current || resultInsertBusy.current.owns());
        return alive.current && resultInsertRef.current === intent && !closeRequestRef.current && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === connectionVersion && (ownBusy || !busyRef.current && !now.activeJobs[tab.id]) && view.result === binding.result && view.columns === columns && view.binding === binding && view.context.length === context.length && view.context.every((value, index) => value === context[index]) && resultSelection.current(binding) && resultViewCurrent(binding.result);
      });
      resultInsertRef.current = intent; setResultInsertSource(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 子任务自有占门不改变查询结果busy视图；实际异步与取消都结束后才能释放原标签。 */
  function resultInsertActivityChange(delta: 1 | -1): void {
    if (delta === 1) {
      if (!resultInsertActivity.current) {
        if (busyRef.current) throw Error(resultInsertZh.stale);
        resultInsertActivity.current = 1; busyRef.current = true;
        try { resultInsertBusy.current = acquireWorkspaceBusy(tab.id); } catch (reason) { resultInsertActivity.current = 0; busyRef.current = false; throw reason; }
      } else resultInsertActivity.current++;
    } else {
      resultInsertActivity.current = Math.max(0, resultInsertActivity.current - 1);
      if (!resultInsertActivity.current) { const lease = resultInsertBusy.current; resultInsertBusy.current = undefined; if (lease?.owns()) busyRef.current = false; lease?.release(); }
    }
  }
  /** 仅原窗口完成收尾后的关闭可以清自身；迟到旧回调不触及下一份结果操作。 */
  function closeResultInsert(intent: ResultInsertSourceIntent): void { if (resultInsertRef.current !== intent) return; intent.invalidate(); resultInsertRef.current = null; setResultInsertSource(null); }
  /** 开管理器即撤销旧网格回执，内部草稿变化只复制列布局。 */
  function openColumnManager(){
    if(!resultSelectionAllowed(selectionBinding)||!selectionBinding)return;
    try{
      const keys=queryResultColumnKeys(selectionBinding.columns), initial=layoutMatches&&columnLayout?columnLayout.layout:{order:keys,visible:keys};
      invalidateResultSelection();const binding=resultSelection.bind(selectionBinding.result,selectionBinding.context,visibleColumns);if(!binding)return;
      const lease={binding,owner:uid(),initial};columnLeaseRef.current=lease;setColumnLease(lease);refreshResultSelection(value=>value+1);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 只忽略本owner唯一模态；其它窗口、任务、连接修订和失效绑定均终止本次管理。 */
  function columnManagerCurrent(lease:ColumnLease):boolean {
    if(columnLeaseRef.current!==lease||!resultSelection.current(lease.binding)||!resultViewCurrent(lease.binding.result))return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id),owned=document.querySelector(`[data-query-columns-owner="${lease.owner}"]`)?.querySelector('[role="dialog"]');
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!closeRequest&&Array.from(document.querySelectorAll('[role="dialog"]')).every(node=>node===owned);
  }
  /** 关闭也撤销本代次；旧关闭／应用回调不能作用于下一次管理器或新结果。 */
  function closeColumnManager(lease:ColumnLease){if(columnLeaseRef.current!==lease)return;columnLeaseRef.current=null;invalidateResultSelection();setColumnLease(null);refreshResultSelection(value=>value+1);}
  /** 接纳前再次核同一准确结果及布局，原outcome与pinned对象都不改写。 */
  function applyColumnLayout(lease:ColumnLease,layout:QueryResultColumnLayout){
    if(!columnManagerCurrent(lease))return;
    try{queryResultVisibleColumns(lease.binding.columns,layout);setColumnLayout({result:sourceResult!,context:resultContext,layout:{order:[...layout.order],visible:[...layout.visible]}});closeColumnManager(lease);}catch(reason){setError(errorMessage(reason));}
  }
  /** 快照由独立克隆保留旧数据，不重执行SQL，也不把结果写入本地配置库。 */
  function pinResult() {
    if (busy || !outcome || !result || pin) return;
    try {
      const next = snapshotQueryResult(pins, sourceResult!, uid(), formatText(zh.query.pinLabel, pinSequence.current + 1));
      invalidateResultSelection(); pinSequence.current++; setPins([...pins, next]); setSelectedPin(next.id); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 释放快照后立即返回本次结果，原SQL标签和事务状态保持原样。 */
  function releasePin(id: string) {
    invalidateResultSelection();
    setPins(current => current.filter(item => item.id !== id));
    if (selectedPin === id) { setSelectedPin(''); setShowPinSql(false); }
  }
  /** 原查询标签的真实布局入口；不读写SQL/model，只取得当次工作台布局租约。 */
  function beginEditorLayout(cancel:()=>void) {
    return beginWorkspaceQueryLayout(tab,connectionVersion,()=>alive.current&&!closeRequestRef.current,cancel);
  }
  const draftContext=resolveQueryDatabase(tab.database,tab.databaseContext,connection?.database);
  const databaseCaption=sessionId?(completionSession?.databaseKnown?completionSession.database||queryContextZh.none:queryContextZh.unknown):draftContext.state==='known'?draftContext.database||queryContextZh.none:queryContextZh.unknown;
  const recoveryDialog=recovery&&<Modal title={queryContextZh.title} onClose={()=>setRecovery(false)}><form onSubmit={event=>{event.preventDefault();if(sessionRef.current||busyRef.current)return;rememberDatabase({state:'known',database:recoveryDatabase||null});setRecovery(false);setError('');}}><div className="modal-content"><p className="muted small">{queryContextZh.hint}</p><Field label={queryContextZh.database}><input autoFocus value={recoveryDatabase} maxLength={256} onChange={event=>setRecoveryDatabase(event.target.value)}/></Field></div><footer className="modal-footer"><span className="grow"/><button type="button" onClick={()=>setRecovery(false)}>{zh.common.cancel}</button><button className="primary" type="submit" disabled={busy}>{queryContextZh.confirm}</button></footer></form></Modal>;
  return <div ref={layoutRoot} className="workspace-tab query-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><ChevronDown size={12}/><span className="breadcrumb-divider">/</span><span aria-label="当前查询默认库">{databaseCaption}</span>{!sessionId&&draftContext.state==='unknown'&&<button disabled={busy} onClick={()=>{invalidateResultSelection();setRecoveryDatabase('');setRecovery(true);}}>{queryContextZh.choose}</button>}<button disabled={busy||!sessionId} title={!sessionId?sessionObjectsZh.needsSession:sessionObjectsZh.title} onClick={()=>{invalidateResultSelection();setSessionObjects(true);}}>{sessionObjectsZh.open}</button><span className="grow"/><QueryFileSourceCaption tab={tab} files={fileSource}/><span className="muted small">{sessionId ? zh.query.text008 : zh.query.text009}</span></div><div className="toolbar"><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button><button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button><button disabled={busy || !connection} title={currentStatementZh.hint} aria-label={currentStatementZh.action} onClick={() => void executeCurrentStatement()}><Play size={14}/>{currentStatementZh.action}</button><button disabled={busy || !connection} title={queryStreamZh.title} aria-label={queryStreamZh.open} onClick={openStreamExport}><Download size={14}/>{queryStreamZh.open}</button><button disabled={busy || !connection} onClick={openParameters}><Braces size={14}/>{parameterZh.open}</button><button disabled={!queryRunning} onClick={() => void cancelCurrentQuery().catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.common.stop}</button><span className="toolbar-divider"/><button disabled={busy} title={sqlFormattingZh.hint} aria-label={sqlFormattingZh.action} onClick={formatQuery}><AlignLeft size={15}/>{sqlFormattingZh.button}</button><button disabled={busy} onClick={() => void execute('explain')}><Gauge size={15}/>{zh.query.text014}</button><span className="grow"/><button disabled={busy || duplicating || !connection || !searchEditor || !!closeRequest || duplicateOrigin.current.connectionId !== tab.connectionId || duplicateOrigin.current.version !== connectionVersion} title={queryDuplicateZh.hint} aria-label={queryDuplicateZh.action} onClick={() => void duplicateQuery()}><Copy size={14}/>{queryDuplicateZh.action}</button><QueryFileActions tab={tab} files={fileSource}/>{tab.fileSourceBinding && <button disabled={busy || fileSource.busy} title={queryFilesZh.librarySave} aria-label={queryFilesZh.librarySave} onClick={() => { invalidateResultSelection(); setQueryName(tab.title); setSave(true); }}>{queryFilesZh.librarySave}</button>}<button title={zh.snippets.title} aria-label={zh.snippets.title} onClick={openSnippets}><BookOpen size={15}/></button><button disabled={busy} onClick={saveCurrentSource} title={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015} aria-label={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015}><Save size={15}/></button><button onClick={onHistory} title={zh.common.historyQueries}><History size={15}/></button></div><SavedQueryMatchNavigation tabId={tab.id} source={searchNavigation} editor={searchEditor}/><div id={layoutEditorId} className="sql-editor-wrap" style={{ height: editorHeight }}>{fileOpening ? <Spinner text={queryFilesZh.opening}/> : <SqlEditor value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })} onReady={attachQueryEditor} onExecute={() => void execute()} onExecuteCurrent={() => void executeCurrentStatement()} onFormat={formatQuery} completion={!busy&&connection?{connectionId:tab.connectionId,connectionVersion,database:draftContext.state==='known'?draftContext.database??undefined:undefined,databaseUnknown:draftContext.state==='unknown',sessionId:sessionId||undefined}:undefined} onCompletionStatus={setCompletionStatus}/>}</div><QueryLayoutSplitter value={preferredEditorHeight} min={queryLayoutLimits.minEditorHeight} max={layoutMaximum} defaultValue={queryLayoutLimits.defaultEditorHeight} controls={layoutEditorId} scope={layoutScope} disabled={layoutActiveTab!==tab.id||!connection||!!closeRequest} begin={beginEditorLayout} onPreview={setEditorPreview}/><div className="result-toolbar"><span className="result-label">{zh.query.text016}</span>{results.map((_, index) => <button className={!pin && resultIndex === index ? 'selected' : ''} onClick={() => { invalidateResultSelection(); setResultIndex(index); setSelectedPin(''); setShowPinSql(false); }} key={index}>{zh.query.text017}{index + 1}</button>)}<span className="grow"/><button disabled={busy||pins.length<2||!!comparisonLease||!!statisticsLease} title={comparisonText.notice} onClick={openResultComparison}>{comparisonText.open}</button><button disabled={busy || !outcome || !result?.columns.length || !!pin} title={zh.query.pinHint} onClick={pinResult}><Pin size={12}/>{zh.query.pinResult}</button>{pin && <button onClick={() => {invalidateResultSelection();setShowPinSql(true);}}>{zh.query.pinnedStatement}</button>}<button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)} title={rowDetailsText.choose} onClick={openRowDetail}>{rowDetailsText.open}</button><button disabled={!sortBinding||!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={openSortPanel}>{sortText.panelTitle}</button><button disabled={!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={!filterBinding?filterText.unavailable:filterText.hint} onClick={openFilterPanel}>{filterText.open}</button><button disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={openColumnManager}>{columnText.open}</button><button title={resultHistory.limited?historyText.limited:historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,-1)} onClick={()=>travelResultHistory(-1)}>{historyText.undo}</button><button title={historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,1)} onClick={()=>travelResultHistory(1)}>{historyText.redo}</button><button disabled={!selectionBinding||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={exportVisibleResult}><Download size={12}/>{zh.resultExport.title}</button><button disabled={!selectedExportCount || busy} onClick={exportSelectedRows}>{zh.resultExport.selectedTitle}</button><button aria-label={resultInsertZh.open} disabled={!selectionBinding || !exportable?.rows.length || busy || !!resultInsertSource || !!activeColumnLease || !!activeFilterLease || !!activeSortLease} onClick={() => openResultInsert(false)}>{resultInsertZh.open}</button><button aria-label={resultInsertZh.selected} disabled={!selectedExportCount || busy || !!resultInsertSource} onClick={() => openResultInsert(true)}>{resultInsertZh.selected}</button>{busy ? <Spinner text={zh.query.text018}/> : outcome && <span className="muted small">{outcome.elapsedMs}{zh.query.text019}</span>}<label className="inline-field">{zh.query.text020}<input aria-label={zh.query.text021} type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => useWorkspace.getState().updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/>{zh.query.text022}</label></div>{pins.length > 0 && <div className="pinned-results" aria-label={zh.query.pinSection}><span>{zh.query.pinSection}</span><button className={`current-results ${!pin ? 'selected' : ''}`} onClick={() => { invalidateResultSelection(); setSelectedPin(''); setShowPinSql(false); }}>{zh.query.currentResults}</button>{pins.map(item => <div key={item.id} className={`pinned-result ${pin?.id === item.id ? 'selected' : ''}`}><button aria-pressed={pin?.id === item.id} title={item.result.statement} onClick={() => { invalidateResultSelection(); setSelectedPin(item.id); setShowPinSql(false); }}><Pin size={11}/>{item.label}</button><button aria-label={formatText(zh.query.releasePin, item.label)} onClick={() => releasePin(item.id)}><X size={11}/></button></div>)}</div>}<ErrorBox message={error}/>{outcome?.failure && <QueryPartialOutcomeNotice failure={outcome.failure} completedResults={outcome.results.length} locateAvailable={!!failureLocator?.available()} onLocate={() => { failureLocator?.locate(); }}/>}<div className="query-result-filter-bar">{sourceResult?.columns.length&&(pin||!outcome?.explain)?<><span>{filterText.counts(sourceResult.rows.length,filterView?.result.rows.length??sourceResult.rows.length)} · {filterText.scope}</span>{sourceResult.truncated&&<strong>{filterText.truncated}</strong>}<button disabled={!filterView?.rules.length||!!activeFilterLease||!!activeColumnLease||!!activeSortLease} onClick={clearResultFilter}>{filterText.clear}</button><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={memoryText.hint} onClick={rememberResultOrganization}>{memoryText.save}</button><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={presetsText.hint} onClick={openResultPresets}>{presetsText.open}</button></>:null}{resultMemory&&<><span role="status" title={memoryText.hint}>{memoryText.saved}</span><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)} title={queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)?memoryText.scope:memoryText.mismatch} onClick={applyRememberedOrganization}>{memoryText.apply}</button><button disabled={!rememberedOrganizationCanDiscard()} onClick={discardRememberedOrganization}>{memoryText.clear}</button></>}</div>{activeFilterLease&&<QueryResultFilterPanel binding={activeFilterLease.binding} initial={activeFilterLease.view} seed={activeFilterLease.seed} isCurrent={()=>filterPanelCurrent(activeFilterLease)} onApply={expression=>applyFilterRules(activeFilterLease,expression)} onClose={()=>closeFilterPanel(activeFilterLease)}/>}{activeSortLease&&<QueryResultSortPanel binding={activeSortLease.binding} initial={activeSortLease.view} isCurrent={()=>sortPanelCurrent(activeSortLease)} onApply={rules=>applySortPanel(activeSortLease,rules)} onClose={()=>closeSortPanel(activeSortLease)}/>}<div className="query-result-sort-scope">{result?.columns.length && (pin || !outcome?.explain) ? <><span>{!sortBinding && sourceExportable && settings.activeTabId === tab.id && !resultModal ? sortText.budget : sortText.scope} {sortText.keyboard} {sortText.selection}</span>{result.truncated && <strong>{sortText.truncated}</strong>}<button disabled={!sortView?.rules.length || !selectionBinding || !!activeColumnLease || !!activeFilterLease} onClick={() => sortResult([])}>{sortText.clear}</button>{!!sortView?.rules.length && <ol className="query-result-sort-priorities" aria-label={sortText.priorities}>{sortView.rules.map((rule,index)=>{
    const column=sourceResult?.columns.find(column=>column.key===rule.column),name=column?.name ?? rule.column;
    return <li key={rule.column}>
      <span>{sortText.priority(index+1,name)} · {rule.direction==='ASC'?sortText.ascending:sortText.descending}</span>
      <select aria-label={sortText.nulls(index+1,name)} title={sortText.nullsHint} value={rule.nulls??''} disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onChange={event=>changeSortNulls(index,event.target.value)}><option value="">{sortText.nullsDefault}</option><option value="FIRST">{sortText.nullsFirst}</option><option value="LAST">{sortText.nullsLast}</option></select>
      {column&&queryResultSortSupportsIgnoreCase(column)&&<label title={sortText.caseHint}><input type="checkbox" aria-label={sortText.ignoreCase(index+1,name)} checked={rule.ignoreCase===true} disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onChange={event=>changeSortCase(index,event.target.checked)}/>{sortText.ignoreCaseLabel}</label>}
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} aria-label={sortText.changeDirection(index+1,name)} onClick={()=>sortResult(sortView.rules.map((item,i)=>i===index?{...item,direction:item.direction==='ASC'?'DESC':'ASC'}:item))}>{rule.direction==='ASC'?'↑':'↓'}</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease||index===0} aria-label={sortText.earlier(index+1,name)} onClick={()=>moveSortPriority(index,-1)}>←</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease||index===sortView.rules.length-1} aria-label={sortText.later(index+1,name)} onClick={()=>moveSortPriority(index,1)}>→</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} aria-label={sortText.remove(index+1,name)} onClick={()=>sortResult(sortView.rules.filter((_,i)=>i!==index))}>×</button>
    </li>;
  })}</ol>}</> : null}</div><div className="result-body">{!pin && outcome?.explain ? <ExplainPlanView key={task.current} outcome={outcome} fileActions fileBusy={busy} busy={busy || !sessionId} onText={() => void runQuery(explainSource.current, 'explain-text')}/> : result?.columns.length ? <div className="query-result-with-details"><div className="query-result-grid"><ResultsGrid key={pin?.id ?? `current-${resultIndex}`} columns={visibleColumns} rows={result.rows} binarySourceIdentity={[...resultContext,result,filterView,sortView]} binaryIsCurrent={() => alive.current && !busyRef.current && task.current === resultContext[3]} sort={sortView?.rules ? [...sortView.rules] : []} onSortChange={sortBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? sortResult : undefined} sortReasons={sortBinding?.reasons} onHistoryTravel={travelResultHistory} onFilterCell={filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openCellFilter : undefined} onFilterSelected={filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openSelectedFilter : undefined} onStatistics={selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openResultStatistics : undefined} selectionScope={selectionBinding} onSelectionChange={selectResultRows} isCurrent={() => resultSelectionAllowed(selectionBinding)} onActiveRowIndexChange={selectActiveDetailRow}/></div>{currentRowDetail && <QueryRowDetailsPanel key={currentRowDetail.id} controller={rowDetails} view={currentRowDetail} isCurrent={() => rowDetailAllowed(currentRowDetail.binding)} onMove={moveRowDetail} onClose={closeRowDetail}/>}</div> : result ? <Empty title={zh.query.text023} text={formatText(zh.query.text024, result.affectedRows ?? 0, result.insertId ? formatText(zh.query.text025, result.insertId) : '', result.warningCount ? formatText(zh.query.text026, result.warningCount) : '')}/> : <Empty title={zh.query.text027} text={zh.query.text028}><div className="key-tip"><kbd>Ctrl / ⌘</kbd><span>+</span><kbd>Enter</kbd></div></Empty>}</div><div className="tab-status"><span>{result ? formatText(zh.query.text029, result.rows.length, result.truncated ? zh.query.text030 : '') : zh.query.text031}</span><span className="grow"/>{!busy&&completionStatus!=='idle'&&<span className="muted small" aria-label="SQL 补全状态" title={completionStatusInfo[completionStatus].hint}>{completionStatusInfo[completionStatus].text}</span>}{(transaction || !transactionKnown) && <span className="warning-text" title={!transactionKnown ? parameterZh.transactionUnknownHint : undefined}><LockKeyhole size={12}/>{transactionKnown ? zh.query.text032 : parameterZh.transactionUnknown}</span>}<button disabled={busy || transaction || !transactionKnown} onClick={() => void transactionAction('begin')}>{zh.common.transactionBegin}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('commit')}><Check size={12}/>{zh.common.transactionCommit}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('rollback')}><RotateCcw size={12}/>{zh.common.transactionRollback}</button></div>{sessionObjects&&<SessionObjectsDialog sessionId={sessionId} database={completionSession?.databaseKnown?completionSession.database??undefined:undefined} busy={busy} onRead={readTemporaryObject} onClose={()=>setSessionObjects(false)}/ >}{recoveryDialog}{closeRequest && closePhase === 'choose' && <QueryCloseDialog title={tab.title} onCancel={() => finishClose(false)} onDiscard={() => finishClose(true)} onSave={beginCloseSave}/ >}{closeRequest && closePhase === 'save' && createPortal(<QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={saveAndClose} onClose={() => finishClose(false)}/>, document.body)}{save && <QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={async (action, name) => { await saveQuery(action, name); }} onClose={() => {invalidateResultSelection();setSave(false);}}/>}{showPinSql && pin && <Modal title={zh.query.pinSource} wide onClose={() => {invalidateResultSelection();setShowPinSql(false);}}><div className="modal-content"><p className="muted small">{zh.query.pinSessionOnly}</p><SqlEditor value={pin.result.statement} height={280} readOnly/></div><footer className="modal-footer"><span className="grow"/><button onClick={() => setShowPinSql(false)}>{zh.common.close}</button></footer></Modal>}{showSnippets && <SnippetsDialog initialSql={snippetSelection.current ? editor.current?.getModel()?.getValueInRange(snippetSelection.current) || tab.sql || '' : tab.sql || ''} onInsert={insertSnippet} onClose={() => {invalidateResultSelection();setShowSnippets(false);}}/ >}{parameterSource !== null && <QueryParametersDialog source={parameterSource} loadNames={loadParameterNames} onExecute={parameters => { const source = parameterSource, locator = parameterFailureSource.current; parameterFailureSource.current = undefined; setParameterSource(null); void runQuery(source, 'execute', parameters, undefined, locator); }} onClose={() => {parameterFailureSource.current?.dispose();parameterFailureSource.current=undefined;invalidateResultSelection();setParameterSource(null);}}/ >}{streamExportSource !== null && <QueryStreamExportDialog sessionBusy={busy} source={streamExportSource} loadNames={loadStreamParameterNames} onExecute={runStreamExport} onCancel={cancelStreamExport} onClose={() => { if (!busyRef.current) setStreamExportSource(null); }}/ >}{activeColumnLease&&<QueryResultColumnsDialog binding={activeColumnLease.binding} initial={activeColumnLease.initial} owner={activeColumnLease.owner} isCurrent={()=>columnManagerCurrent(activeColumnLease)} onApply={layout=>applyColumnLayout(activeColumnLease,layout)} onClose={()=>closeColumnManager(activeColumnLease)}/ >}{activePresetLease&&<QueryResultPresetsDialog key={activePresetLease.owner} connectionId={tab.connectionId} value={activePresetLease.value} owner={activePresetLease.owner} isCurrent={()=>presetManagerCurrent(activePresetLease)} matches={value=>queryResultMemoryMatches(value,viewSource,visibleColumns)} onApply={value=>applyResultPreset(activePresetLease,value)} onClose={()=>closeResultPresets(activePresetLease)}/ >}{activeStatisticsLease&&<QueryResultStatisticsDialog key={activeStatisticsLease.owner} columns={activeStatisticsLease.columns} rows={activeStatisticsLease.rows} initialColumn={activeStatisticsLease.column} selectedIndices={activeStatisticsLease.indices} truncated={activeStatisticsLease.truncated} owner={activeStatisticsLease.owner} isCurrent={()=>statisticsCurrent(activeStatisticsLease)} onClose={()=>closeResultStatistics(activeStatisticsLease)}/ >}{activeComparisonLease&&<QueryResultComparisonDialog key={activeComparisonLease.owner} pins={activeComparisonLease.pins} owner={activeComparisonLease.owner} isCurrent={()=>comparisonCurrent(activeComparisonLease)} onClose={()=>closeResultComparison(activeComparisonLease)}/ >}{resultInsertSource && <ResultInsertDialog intent={resultInsertSource} initialConnectionId={tab.connectionId} onActivity={resultInsertActivityChange} onClose={() => closeResultInsert(resultInsertSource)} onCommitted={output => useWorkspace.getState().notify(resultInsertZh.committed(output.rows))} onCleanupError={message => useWorkspace.getState().notify(resultInsertZh.cleanupFailed + message, true)}/>}{exportResult && <ResultExportDialog result={exportResult} tabId={tab.id} selected={exportSelected} onClose={() => {invalidateResultSelection();setExportResult(null);}}/>}</div>;
}
