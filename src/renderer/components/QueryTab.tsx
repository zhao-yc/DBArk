import { connectionDatabase, connectionOverview } from '../sqliteWorkspace';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { queryRowDetailsZh as rowDetailsText } from '../locales/queryRowDetails.zh-CN';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { queryResultColumnKeys, queryResultVisibleColumns, frozenQueryResultKeys, setQueryResultFrozenThrough, type QueryResultColumnLayout } from '../queryResultColumns';
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
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { SqliteExplainPlanView } from './SqliteExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from './QueryAnalyzeConfirmDialog';
import { QueryTransactionSettingsDialog, type QueryTransactionSettingsApplyInput } from './QueryTransactionSettingsDialog';
import { QueryTransactionSettingsIntent, type QueryTransactionSettingsScope } from '../queryTransactionSettingsIntent';
import { queryTransactionSettingsZh } from '../locales/queryTransactionSettings.zh-CN';
import { queryTransactionSettingsSnapshotSchema, type QueryTransactionSettingsSnapshot } from '../../shared/queryTransactionSettings';
import { checkQueryAutocommitOutput, type QueryAutocommitApplyInput, type QueryAutocommitOutput } from '../../shared/queryAutocommit';
import { QueryDatabaseSwitchDialog } from './QueryDatabaseSwitchDialog';
import { QueryDatabaseSwitchIntent, type QueryDatabaseSwitchScope } from '../queryDatabaseSwitchIntent';
import { queryDatabaseSwitchZh } from '../locales/queryDatabaseSwitch.zh-CN';
import type { QueryDatabaseSwitchOutput } from '../../shared/queryDatabaseSwitch';
import { QueryAnalyzeIntent, type QueryAnalyzeScope } from '../queryAnalyzeIntent';
import { queryAnalyzeCapability } from '../../shared/queryAnalyze';
import { queryAnalyzeZh } from '../locales/queryAnalyze.zh-CN';
import { QueryPartialOutcomeNotice } from './QueryPartialOutcomeNotice';
import { QueryContinueOnErrorNotice, confirmedQueryContinueRange } from './QueryContinueOnErrorNotice';
import { queryContinueOnErrorZh } from '../locales/queryContinueOnError.zh-CN';
import { QueryWarningsDialog } from './QueryWarningsDialog';
import { QueryWarningsViewIntent, sameQueryWarningsExecution, type QueryWarningsViewScope } from '../queryWarningsView';
import { queryWarningsZh } from '../locales/queryWarnings.zh-CN';
import type { QueryFailure } from '../../shared/queryFailure';
import { captureQueryFailureSource, type QueryFailureSourceLease, type QueryFailureSourceScope } from '../queryFailureSource';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import { pinLimits, snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { QueryResultSnapshotActions, type QueryResultSnapshotOperation } from './QueryResultSnapshotActions';
import { QueryResultSnapshotIntent } from '../queryResultSnapshotIntent';
import { queryResultSnapshotUiZh } from '../locales/queryResultSnapshot.zh-CN';
import { exportableQueryResult, resultExportData, ResultExportSelection, type ResultSelectionBinding, type ResultGridSelection } from '../resultExport';
import { ResultExportDialog } from './ResultExportDialog';
import { ResultInsertDialog } from './ResultInsertDialog';
import { ResultInsertSourceIntent } from '../resultInsertUi';
import { resultInsertZh } from '../locales/resultInsert.zh-CN';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import { SnippetsDialog } from './SnippetsDialog';
import { snippetEdit } from '../snippetInsertion';
import { captureHistoryInsertion, type HistoryInsertionRegistry, type HistoryInsertionTarget } from '../historyInsertion';
import { QueryParametersDialog } from './QueryParametersDialog';
import { QueryParameterReuseOwner } from '../queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../queryParameterReusePort';
import type { QueryParameterReuseScopeInput } from '../queryParameterReuseScope';
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
import { ActionMenu, ActionMenuSection } from './ActionMenu';
import { AdaptiveToolbar } from './AdaptiveToolbar';
import { useUiCommandScope } from '../uiCommands';
import { actionMenuZh as menuText } from '../locales/actionMenu.zh-CN';
const completionStatusInfo={sessionUnknown:{text:completionZh.sessionUnknown,hint:completionZh.sessionUnknownHint},partial:{text:completionZh.partial,hint:completionZh.partialHint},unavailable:{text:completionZh.unavailable,hint:completionZh.unavailableHint},limited:{text:completionZh.limited,hint:completionZh.limitedHint},databaseUnknown:{text:completionZh.databaseUnknown,hint:completionZh.databaseUnknownHint},startupTimeout:{text:completionZh.startupTimeout,hint:completionZh.startupTimeoutHint},analysisTimeout:{text:completionZh.analysisTimeout,hint:completionZh.analysisTimeoutHint}};

/** 一个标签对应一个固定会话，流式结果和任务事件只接收当前执行编号。 */
export function QueryTab({ tab, onHistory,searchNavigation,closeRequest,onCloseRequestFinished,historyInsertionRegistry }: { historyInsertionRegistry?: HistoryInsertionRegistry; closeRequest?: QueryCloseRequest; onCloseRequestFinished?(request: QueryCloseRequest, close: boolean): void; tab: WorkspaceTab; onHistory: () => void;searchNavigation?:SavedQueryNavigationSource }) {
  const alive = useRef(true), closeRequestRef = useRef(closeRequest); closeRequestRef.current = closeRequest;
  const closeIntent = useRef<QuerySaveCloseIntent | undefined>(undefined);
  const closeBusy = useRef<WorkspaceBusyLease | undefined>(undefined);
  const formatting = useRef<DeferredUpperSqlFormatting | null>(null);
  const duplicateIntent = useRef<QueryDuplicateIntent | null>(null); const [duplicating, setDuplicating] = useState(false);
  const [closePhase, setClosePhase] = useState<'choose' | 'save' | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; failureSource.current?.dispose(); parameterFailureSource.current?.dispose(); formatting.current?.dispose(); formatting.current = null; duplicateIntent.current?.dispose(); if (closeIntent.current) { closeIntent.current.dispose(); closeBusy.current?.release(); } }; }, []);
  useEffect(() => { formatting.current?.dispose(); closeIntent.current?.dispose(); setClosePhase(closeRequest ? 'choose' : null); }, [closeRequest]);
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const sqlite = connection?.dialect === 'sqlite';
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
  const [completionSession,commitCompletionSession]=useState<CompletionSessionState>();
  const completionSessionRef=useRef<CompletionSessionState|undefined>(undefined);
  /** 协议缓存同步发布给来源围栏，不能等React提交后才发现来源已变化。 */
  function setCompletionSession(state:CompletionSessionState|undefined){completionSessionRef.current=state;commitCompletionSession(state);databaseSwitchIntent.current?.current();}
  const databaseSwitchIntent=useRef<QueryDatabaseSwitchIntent|null>(null),databaseSwitchTask=useRef('');
  type DatabaseSwitchOperation={intent:QueryDatabaseSwitchIntent;job?:WorkspaceBusyLease;acquiring:boolean};
  const databaseSwitchOperation=useRef<DatabaseSwitchOperation|null>(null),databaseSwitchAwaitingRelease=useRef(false);
  const [databaseSwitchDialog,setDatabaseSwitchDialog]=useState<QueryDatabaseSwitchIntent|null>(null);
  useEffect(()=>useWorkspace.subscribe(state=>{if(databaseSwitchAwaitingRelease.current&&!state.activeJobs[tab.id]){databaseSwitchAwaitingRelease.current=false;busyRef.current=false;if(alive.current)setBusy(false);}}),[tab.id]);
  useLayoutEffect(()=>{databaseSwitchIntent.current?.current();});
  useEffect(()=>()=>{databaseSwitchIntent.current?.dispose();},[]);
  const [sessionObjects,setSessionObjects]=useState(false);
  const [recovery,setRecovery]=useState(false);const [recoveryDatabase,setRecoveryDatabase]=useState('');
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const failureSource = useRef<QueryFailureSourceLease | undefined>(undefined), parameterFailureSource = useRef<QueryFailureSourceLease | undefined>(undefined);
  const [continueOnError, setContinueOnError] = useState(false);
  const [collectWarnings, setCollectWarnings] = useState(false);
  const parameterCollectWarnings = useRef(false);
  const parameterContinueOnError = useRef(false), scriptFailureRanges = useRef(new Set<QueryFailure>());
  const [, refreshFailureSource] = useState(0);
  const fileSource = useQueryFileSource(tab, () => captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)), () => alive.current, value => { busyRef.current = value; setBusy(value); }, { editor: () => editor.current, available: () => !busyRef.current && !pendingSession.current && !closeRequestRef.current && !formatting.current, current: () => !pendingSession.current && !closeRequestRef.current && !formatting.current });
  const activeCurrentIntent = useRef<CurrentStatementIntent | null>(null);
  /** 关闭或文件切换开始即撤销当前语句意图，随后恢复同值也不能复活原光标来源。 */
  useLayoutEffect(() => { if (closeRequest || fileSource.busy || fileOpening) activeCurrentIntent.current?.dispose(); }, [closeRequest, fileSource.busy, fileOpening]);
  const analyzeIntent = useRef<QueryAnalyzeIntent | null>(null);
  const [analyzeDialog, setAnalyzeDialog] = useState<{ intent: QueryAnalyzeIntent; connectionName: string; databaseLabel: string } | null>(null);
  const [analyzeInvalid, setAnalyzeInvalid] = useState('');
  const transactionSettingsIntent = useRef<QueryTransactionSettingsIntent | null>(null);
  const transactionSettingsOperation = useRef<object | null>(null);
  const [transactionSettingsDialog, setTransactionSettingsDialog] = useState<{ intent: QueryTransactionSettingsIntent; connectionName: string } | null>(null);
  useEffect(() => () => { transactionSettingsIntent.current?.dispose(); }, []);
  useEffect(() => { transactionSettingsIntent.current?.current(); }, [closeRequest, tab.id, tab.connectionId, connectionVersion, sessionId]);
  useEffect(() => () => { analyzeIntent.current?.dispose(); }, []);
  const [searchEditor,setSearchEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  const [pins, setPins] = useState<PinnedQueryResult[]>([]); const [selectedPin, setSelectedPin] = useState(''); const pinSequence = useRef(0);
  type SnapshotOperation = { intent: QueryResultSnapshotIntent; job?: WorkspaceBusyLease; acquiring: boolean };
  const snapshotOperation = useRef<SnapshotOperation | null>(null);
  const snapshotAwaitingBusyRelease = useRef(false);
  const snapshotValues = useRef<readonly unknown[]>([]), snapshotView = useRef<{ result?: QueryResult; pins: PinnedQueryResult[] }>({ pins });
  /** 原文件操作的busy只认自己的世代；切页和别人覆盖同true都同步永久撤销发布。 */
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    // 原IO已结束但被另一作业接管时，只在该作业明确释放后撤下本用途的局部忙态。
    if (snapshotAwaitingBusyRelease.current && !state.activeJobs[tab.id]) { snapshotAwaitingBusyRelease.current = false; busyRef.current = false; if (alive.current) setBusy(false); }
    const operation = snapshotOperation.current; if (!operation) return;
    if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId]) operation.intent.invalidate();
    if (state.activeJobs !== previous.activeJobs && !operation.acquiring && !operation.job?.owns()) operation.intent.invalidate();
  }), [tab.id, tab.connectionId]);
  useLayoutEffect(() => { snapshotOperation.current?.intent.observe(snapshotValues.current); if (closeRequest) snapshotOperation.current?.intent.invalidate(); });
  useEffect(() => () => snapshotOperation.current?.intent.invalidate(), []);
  const warningsOutcome = useRef(outcome), warningsPinned = useRef(!!selectedPin); warningsOutcome.current = outcome; warningsPinned.current = !!selectedPin;
  const warningsResultSource = useRef<{ scope: QueryWarningsViewScope; valid: boolean } | null>(null);
  const warningsIntent = useRef<QueryWarningsViewIntent | null>(null), [warningsDialog, setWarningsDialog] = useState<QueryWarningsViewIntent | null>(null);
  useEffect(() => () => { warningsIntent.current?.dispose(); }, []);
  useEffect(() => { warningsIntent.current?.current(); }, [outcome, sessionId, connectionVersion, closeRequest, selectedPin, busy]);
  useEffect(() => useWorkspace.subscribe(() => { const receipt = warningsResultSource.current; if (receipt?.valid && !sameQueryWarningsExecution(receipt.scope, warningsViewScope())) receipt.valid = false; }), []);
  useEffect(() => { const receipt = warningsResultSource.current; if (receipt?.valid && !sameQueryWarningsExecution(receipt.scope, warningsViewScope())) receipt.valid = false; }, [sessionId, connectionVersion, closeRequest]);
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
  const [resultSelectionRevision, refreshResultSelection] = useState(0);
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
  function invalidateResultSelection() { snapshotOperation.current?.intent.invalidate();resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;setComparisonLease(null);statisticsLeaseRef.current=null;setStatisticsLease(null);sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);resultSelection.invalidate(); rowDetails.invalidate(); setRowDetail(null); setActiveDetailRow(null); }
  const [showSnippets, setShowSnippets] = useState(false); const snippetSelection = useRef<monaco.Selection | null>(null);
  const historyInsertion = useRef<HistoryInsertionTarget | null>(null);
  /** App只登记工厂，打开历史时才捕获原查询；隐藏页不会被误认为活动编辑器。 */
  useEffect(() => {
    if (!historyInsertionRegistry) return;
    const unregister = historyInsertionRegistry.register(tab.id, () => {
      historyInsertion.current?.dispose();
      const instance = editor.current;
      if (!instance) return null;
      flushEditorContent(instance);
      historyInsertion.current = captureHistoryInsertion(instance, () => {
        const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
        return { tab: current, activeTabId: workspace.settings.activeTabId, connection: workspace.connections.find(item => item.id === current?.connectionId), connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0, selection: workspace.selection,
          session: sessionRef.current, execution: task.current, alive: alive.current && editor.current === instance, busy: busyRef.current || !!pendingSession.current || !!workspace.activeJobs[tab.id] || !!formatting.current || fileSource.isBusy(), closing: !!closeRequestRef.current };
      }, listener => useWorkspace.subscribe(listener));
      return historyInsertion.current;
    });
    return () => { unregister(); historyInsertion.current?.dispose(); historyInsertion.current = null; };
  }, [historyInsertionRegistry, tab.id]);
  // 纯React忙态、关闭和会话提交同样立即观察；不等历史回包才比较，不增加轮询。
  useLayoutEffect(() => { historyInsertion.current?.current(); });
  const snippetModel = useRef<monaco.editor.ITextModel | null>(null);
  const [parameterSource, setParameterSource] = useState<string | null>(null);
  const parameterSession = useRef(''); const [queryRunning, setQueryRunning] = useState(false);
  const parameterReuse = useRef<QueryParameterReuseOwner | null>(null);
  const parameterReusePort = useRef<QueryParameterReusePort | null>(null);
  /** 值只属于当前组件RAM；不进入workspace、设置、历史或文件来源。 */
  function parameterReuseOwner(): QueryParameterReuseOwner {
    return parameterReuse.current ??= new QueryParameterReuseOwner(parameterReuseInput);
  }
  /** 直接读取真实模型和同步工作区；来源键只含有界摘要，不序列化整个SQL正文。 */
  function parameterReuseInput(): Omit<QueryParameterReuseScopeInput, 'formIdentity'> | null {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    if (!current || current.kind !== 'query') return null;
    const profile = workspace.connections.find(item => item.id === current.connectionId);
    const context = resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(profile));
    const saved = current.sourceBinding, file = current.fileSourceBinding;
    return { tabId: current.id, connectionId: current.connectionId, connectionVersion: workspace.connectionVersions[current.connectionId] ?? 0,
      sessionId: sessionRef.current || null, editor: editor.current, present: alive.current && !!profile && !closeRequestRef.current,
      draft: current.sql, savedSourceKey: JSON.stringify(saved ? [saved.id, saved.digest, saved.connectionId ?? null, saved.connectionDigest ?? null, saved.context.state, 'database' in saved.context ? saved.context.database ?? null : null] : null),
      fileSourceKey: JSON.stringify(file ? [file.id, file.revision] : null), databaseKey: JSON.stringify([context.state === 'known' ? context.database : null]),
      databaseKnown: context.state === 'known', taskId: task.current };
  }
  useEffect(() => {
    const stop = useWorkspace.subscribe(() => parameterReuse.current?.observe());
    return () => { stop(); parameterReuse.current?.dispose(); parameterReuse.current = null; parameterReusePort.current = null; };
  }, []);
  useLayoutEffect(() => { parameterReuse.current?.observe(); });
  useEffect(() => {
    // 首次打开参数表单后才观察模型，普通编辑无需读取参数来源或注册额外模型事件。
    if (!searchEditor || !parameterReuse.current) return;
    const changed = () => parameterReuse.current?.observe();
    const subscriptions = [searchEditor.onDidChangeModel(changed), searchEditor.onDidChangeModelContent(changed), searchEditor.onDidChangeCursorSelection(changed), searchEditor.onDidDispose(() => {
      if (editor.current === searchEditor) { editor.current = null; parameterReuse.current?.dispose(); parameterReuse.current = null; }
    })];
    return () => subscriptions.forEach(subscription => subscription.dispose());
  }, [searchEditor, parameterSource]);
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
      const context: QueryDatabaseContext = resolveQueryDatabase(current.database,current.databaseContext,connectionDatabase(workspace.connections.find(item=>item.id===tab.connectionId)));
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
    // 显式切库自己逐次核owner并发布缓存，普通effect不得清空其原actualContext。
    if(databaseSwitchIntent.current)return;
    let alive=true;setCompletionSession(undefined);
    if(sessionId&&!busy)void invoke('query.completionState',{sessionId}).then(state=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current){const context=queryDatabaseFromSession(state);setCompletionSession(state);rememberDatabase(context);if(context.state==='known')parameterReuse.current?.confirmed(task.current,JSON.stringify([context.database]));}}).catch(()=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current)rememberDatabase({state:'unknown'});});
    return()=>{alive=false;};
  },[sessionId,busy,connectionVersion,databaseSwitchDialog]);
  useEffect(() => window.dbark?.onTask(event => {
    if (event.taskId !== task.current || event.resultIndex === undefined) return;
    setStream(previous => {
      const updated = previous.slice(); const index = event.resultIndex!;
      const result = updated[index] ?? { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: '' };
      updated[index] = { ...result, columns: event.columns ?? result.columns, rows: [...result.rows, ...(event.batch ?? [])].slice(0, settings.resultLimit) }; return updated;
    });
  }), [settings.resultLimit]);

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
      const preferences = { tabSize: workspace.settings.editorTabSize, insertSpaces: workspace.settings.editorInsertSpaces, keywordCase: workspace.settings.sqlKeywordCase, dialect: sqlite ? 'sqlite' as const : 'mysql' as const };
      if (preferences.dialect === 'sqlite' || readSqlKeywordCase(preferences.keywordCase) === 'preserve') { formatting.current?.dispose(); formatting.current = null; formatSqlEditor(instance, preferences); return; }
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
        database: async initial => initial.sessionId ? queryDatabaseFromSession(await invoke('query.completionState', { sessionId: initial.sessionId })) : resolveQueryDatabase(initial.tab?.database, initial.tab?.databaseContext, connectionDatabase(initial.connection)),
        open: candidate => { const workspace = useWorkspace.getState(); if (workspace.settings.tabs.length >= 100) throw Error(queryDuplicateZh.tooMany); workspace.openTab(candidate); },
      });
      duplicateIntent.current = intent; setDuplicating(true); await intent.run();
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { intent?.dispose(); if (duplicateIntent.current === intent) { duplicateIntent.current = null; if (alive.current) setDuplicating(false); } }
  }
  /** 选区优先执行；执行计划走专用命令，由引擎拒绝多语句输入。 */
  async function execute(mode: 'selected' | 'all' | 'explain' = 'selected') {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    if (sqlite && mode === 'explain') {
      if (!alive.current || useWorkspace.getState().activeJobs[tab.id] || closeRequestRef.current || fileSource.isBusy() || formatting.current || useWorkspace.getState().queryFileOpenings?.[tab.id] || document.querySelector('[role="alertdialog"]')) return;
      let intent: CurrentStatementIntent | undefined;
      try {
        if (!editor.current) throw Error(currentStatementZh.unavailable);
        // 复用原模型/光标/上下文租约只作投递守卫，计划仍规划准确捕获的选区或全文，不发送 currentStatement。
        intent = new CurrentStatementIntent(editor.current, currentStatementScope, changed => useWorkspace.subscribe(changed)); activeCurrentIntent.current = intent;
        const source = querySource(); await runQuery(source, 'explain', undefined, intent);
      } catch (reason) { setError(errorMessage(reason)); }
      finally { intent?.dispose(); if (activeCurrentIntent.current === intent) activeCurrentIntent.current = null; }
      return;
    }
    const source = querySource(mode === 'all'), locator = mode === 'explain' ? undefined : captureFailureSource(source, mode === 'all');
    await runQuery(source, mode === 'explain' ? 'explain' : 'execute', undefined, undefined, locator, undefined, !sqlite && mode !== 'explain' && continueOnError, !sqlite && mode !== 'explain' && collectWarnings);
  }
  /** 事务默认值绑定原标签和物理会话来源，SQL正文变化不撤销设置。 */
  function transactionSettingsScope(): QueryTransactionSettingsScope {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: state.connectionVersions[connectionId] ?? 0, connection: state.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, present: alive.current && current?.kind === 'query', active: state.settings.activeTabId === tab.id, closing: !!closeRequestRef.current };
  }

  /** 每次打开都由弹窗重新读取，不保存或恢复之前的默认事务设置。 */
  function openTransactionSettings() {
    if (sqlite) return;
    const workspace = useWorkspace.getState();
    if (busyRef.current || workspace.activeJobs[tab.id] || pendingSession.current || closeRequestRef.current || formatting.current || fileSource.isBusy() || transactionSettingsIntent.current || document.querySelector('[role="dialog"]')) return;
    const current = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === current?.connectionId);
    if (current?.kind !== 'query' || !profile) return;
    // 尚未建立会话且默认库来源未知时，沿用既有确认入口，避免猜库或叠加模态。
    if (!sessionRef.current && resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(profile)).state === 'unknown') { setRecoveryDatabase(''); setRecovery(true); return; }
    try {
      const intent = new QueryTransactionSettingsIntent(transactionSettingsScope, listener => useWorkspace.subscribe(listener), queryTransactionSettingsZh.changed);
      transactionSettingsIntent.current = intent; setTransactionSettingsDialog({ intent, connectionName: profile.name });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 占用仅覆盖本次固定元数据命令；不使用查询任务编号，不改已有结果和执行历史。 */
  async function requestTransactionSettings(intent: QueryTransactionSettingsIntent, taskId: string, input?: QueryTransactionSettingsApplyInput): Promise<QueryTransactionSettingsSnapshot> {
    if (transactionSettingsIntent.current !== intent) throw Error(queryTransactionSettingsZh.changed);
    intent.assertCurrent();
    if (busyRef.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(queryTransactionSettingsZh.busy);
    const job = acquireWorkspaceBusy(tab.id), operation = {};
    transactionSettingsOperation.current = operation; busyRef.current = true; setBusy(true);
    /** 每个await边界核对同一弹窗、会话来源及本次工作台占用。 */
    const assertOwner = () => {
      intent.assertCurrent();
      if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current !== operation || !job.owns()) throw Error(queryTransactionSettingsZh.changed);
    };
    try {
      assertOwner(); const session = await ensureSession(); intent.bindSession(session); assertOwner();
      const response = input ? await invoke('query.transactionSettings.apply', { sessionId: session, taskId, expected: input.expected, isolation: input.isolation, readOnly: input.readOnly }) : await invoke('query.transactionSettings.read', { sessionId: session, taskId });
      assertOwner(); const snapshot = queryTransactionSettingsSnapshotSchema.parse(response);
      // 新鲜协议状态允许只读事务拒写后恢复显式回滚按钮，不触碰旧可视结果。
      setTransaction(snapshot.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, snapshot.transactionOpen);
      return snapshot;
    } catch (reason) {
      // 断线或SET后读回失败不能继续声称旧协议状态可信；旧来源回执无权修改新标签。
      try { assertOwner(); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); } catch { /* 仅原占用可标记未知，来源失效时保留新状态。 */ }
      throw reason;
    } finally {
      if (transactionSettingsOperation.current === operation) { transactionSettingsOperation.current = null; busyRef.current = false; if (alive.current) setBusy(false); }
      job.release();
    }
  }

  /** 自动提交沿用原弹窗及原会话租约，收到确认后保留提交事实，不重连或重放。 */
  async function requestAutocommit(intent: QueryTransactionSettingsIntent, input: Omit<QueryAutocommitApplyInput, 'sessionId'>): Promise<QueryAutocommitOutput> {
    if (transactionSettingsIntent.current !== intent) throw Error(queryTransactionSettingsZh.changed);
    intent.assertCurrent();
    if (busyRef.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(queryTransactionSettingsZh.busy);
    const job = acquireWorkspaceBusy(tab.id), operation = {};
    transactionSettingsOperation.current = operation; busyRef.current = true; setBusy(true);
    /** 协议确认可记录到原任务，只有仍持有原来源的回执才能更新当前标签。 */
    const assertOwner = () => {
      intent.assertCurrent();
      if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current !== operation || !job.owns()) throw Error(queryTransactionSettingsZh.changed);
    };
    try {
      assertOwner(); const session = await ensureSession(); intent.bindSession(session); assertOwner();
      const output = checkQueryAutocommitOutput(await invoke('query.autocommit.apply', { ...input, sessionId: session }), input.expected, input.autocommit);
      assertOwner();
      setTransaction(output.snapshot.transactionOpen); setTransactionKnown(!output.cleanupWarning);
      useWorkspace.getState().setDirty(tab.id, output.snapshot.transactionOpen || !!output.cleanupWarning);
      return output;
    } catch (reason) {
      try { assertOwner(); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); } catch { /* 失效来源无权覆盖新标签状态。 */ }
      throw reason;
    } finally {
      if (transactionSettingsOperation.current === operation) { transactionSettingsOperation.current = null; busyRef.current = false; if (alive.current) setBusy(false); }
      job.release();
    }
  }

  /** 晚到关闭回调不能清掉后一次弹窗，请求落定之前不允许关闭。 */
  function closeTransactionSettings(intent: QueryTransactionSettingsIntent) {
    if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current) return;
    intent.dispose(); transactionSettingsIntent.current = null; setTransactionSettingsDialog(null);
  }

  /** 原标签对象、实际协议库及模型由同步端口读取；只豁免本操作自己的忙租约。 */
  function databaseSwitchScope(): QueryDatabaseSwitchScope {
    const state=useWorkspace.getState(),current=state.settings.tabs.find(item=>item.id===tab.id),operation=databaseSwitchOperation.current;
    const own=operation?.intent===databaseSwitchIntent.current&&(operation?.acquiring||operation?.job?.owns());
    return {tab:current,connection:state.connections.find(item=>item.id===current?.connectionId),connectionVersion:state.connectionVersions[current?.connectionId??'']??0,sessionId:sessionRef.current,
      actualContext:queryDatabaseFromSession(completionSessionRef.current),present:alive.current&&current?.kind==='query',active:state.settings.activeTabId===tab.id,closing:!!closeRequestRef.current,
      available:!pendingSession.current&&!formatting.current&&!fileSource.isBusy()&&(!!own||!busyRef.current&&!state.activeJobs[tab.id])};
  }

  /** 仅当前已连接空闲页打开目录；绝不建连、修改正文或借普通runQuery发送USE。 */
  function openDatabaseSwitch() {
    if (sqlite) return;
    if(databaseSwitchIntent.current||busyRef.current||!sessionRef.current||!editor.current||closeRequestRef.current||document.querySelector('[role="dialog"]'))return;
    try {
      const intent=new QueryDatabaseSwitchIntent(editor.current,databaseSwitchScope,changed=>useWorkspace.subscribe(changed),queryDatabaseSwitchZh.changed);
      databaseSwitchIntent.current=intent;setDatabaseSwitchDialog(intent);
    }catch(reason){setError(errorMessage(reason));}
  }

  /** 目录晚回只属于原弹窗；取消加载不改默认库、不发送USE。 */
  async function loadDatabaseSwitchChoices(intent:QueryDatabaseSwitchIntent):Promise<readonly string[]> {
    if(databaseSwitchIntent.current!==intent)throw Error(queryDatabaseSwitchZh.changed);intent.assertCurrent();
    const scope=databaseSwitchScope(),databases=await invoke('metadata.databases',{connectionId:scope.tab!.connectionId});
    if(databaseSwitchIntent.current!==intent)throw Error(queryDatabaseSwitchZh.changed);intent.assertCurrent();
    return intent.ready(databases);
  }

  /** 缓存和事务分别读原session；每个await后再次核owner，失败绝不用旧库冒充服务器事实。 */
  async function refreshDatabaseSwitchSession(intent:QueryDatabaseSwitchIntent,assertOwner:()=>void) {
    assertOwner();
    const completion=await invoke('query.completionState',{sessionId:intent.sessionId}).catch(()=>undefined);assertOwner();
    const state=await invoke('query.sessionState',{sessionId:intent.sessionId}).catch(()=>null);assertOwner();
    const observed=state?.broken?undefined:completion,context=queryDatabaseFromSession(observed);
    intent.transition({recovery:context,actual:context},()=>{setCompletionSession(observed);rememberDatabase(context);});
    setTransactionKnown(!!state?.transactionKnown&&!state?.broken);
    if(state?.transactionKnown&&!state.broken)setTransaction(state.transactionOpen);
    useWorkspace.getState().setDirty(tab.id,!state?.transactionKnown||!!state?.broken||!!state?.transactionOpen);
    return context;
  }

  /** 独立任务只改变会话默认库；原task、结果来源和已应用筛选排序保持原身份。 */
  async function applyDatabaseSwitch(intent:QueryDatabaseSwitchIntent,database:string):Promise<QueryDatabaseSwitchOutput> {
    if(databaseSwitchIntent.current!==intent||busyRef.current||useWorkspace.getState().activeJobs[tab.id])throw Error(queryDatabaseSwitchZh.busy);
    intent.beginSend(database);
    const operation:DatabaseSwitchOperation={intent,acquiring:true};databaseSwitchOperation.current=operation;
    let output:QueryDatabaseSwitchOutput|undefined,failure:unknown,submitted=false;
    const taskId=uid();databaseSwitchTask.current=taskId;
    /** 原会话、原操作和原workspace占用同时成立才可推进；旧finally也无权清新busy。 */
    const assertOwner=()=>{intent.assertCurrent();if(databaseSwitchIntent.current!==intent||databaseSwitchOperation.current!==operation||databaseSwitchTask.current!==taskId||!operation.job?.owns())throw Error(queryDatabaseSwitchZh.changed);};
    try {
      operation.job=acquireWorkspaceBusy(tab.id);operation.acquiring=false;busyRef.current=true;setBusy(true);assertOwner();
      invalidateResultSelection();columnLeaseRef.current=null;setColumnLease(null);presetLeaseRef.current=null;setPresetLease(null);
      activeCurrentIntent.current?.dispose();analyzeIntent.current?.dispose();transactionSettingsIntent.current?.dispose();
      // RAM候选和值即刻撤销，不能跨越默认库迁移；物理临时表目录从未清空。
      parameterReuse.current?.dispose();parameterReuse.current=null;parameterReusePort.current=null;
      try {
        const actual=await invoke('query.completionState',{sessionId:intent.sessionId});assertOwner();
        if(actual.busy||actual.broken)throw Error(queryDatabaseSwitchZh.busy);
        const expectedContext=queryDatabaseFromSession(actual);
        if(JSON.stringify(expectedContext)!==JSON.stringify(intent.expectedContext))throw Error(queryDatabaseSwitchZh.changed);
        // 只允许自己的unknown恢复账本；发送给Engine的仍是刚读取的真实协议缓存。
        await intent.transition({recovery:{state:'unknown'}},()=>prepareExecutionContext());assertOwner();
        submitted=true;
        const response=await invoke('query.databaseSwitch',{sessionId:intent.sessionId,taskId,database,expectedContext});assertOwner();
        const context=queryDatabaseFromSession(response.completion);
        if(response.sessionId!==intent.sessionId||response.taskId!==taskId||response.database!==database||context.state!=='known'||context.database!==response.database)throw Error(queryDatabaseSwitchZh.unconfirmed);
        output=response;
        intent.transition({recovery:context,actual:context},()=>{setCompletionSession(response.completion);rememberDatabase(context);});
        setTransactionKnown(response.transactionKnown);if(response.transactionKnown&&response.transactionOpen!==undefined)setTransaction(response.transactionOpen);
        useWorkspace.getState().setDirty(tab.id,!response.transactionKnown||!!response.transactionOpen);
      }catch(reason){failure=reason;}
      if(submitted){
        try {const latest=await refreshDatabaseSwitchSession(intent,assertOwner);if(output&&(latest.state!=='known'||latest.database!==output.database))failure??=Error(queryDatabaseSwitchZh.unconfirmed);}catch(reason){failure??=reason;}
        // 只保存已观察事实；无论失败发生在哪一阶段，都不重放USE或创建替代session。
        assertOwner();
        try {await flushSettings();}catch(reason){if(output)throw Error(queryDatabaseSwitchZh.saveFailed(output.database)+errorMessage(reason));throw reason;}
        assertOwner();
      }
      assertOwner();
      if(failure)throw Error((submitted&&!output?queryDatabaseSwitchZh.unconfirmed:'')+errorMessage(failure));
      if(!output)throw Error(queryDatabaseSwitchZh.failed);
      setError('');return output;
    }finally{
      if(databaseSwitchOperation.current===operation){databaseSwitchOperation.current=null;databaseSwitchTask.current='';
        if(operation.job?.owns()||!useWorkspace.getState().activeJobs[tab.id]){busyRef.current=false;if(alive.current)setBusy(false);}
        else databaseSwitchAwaitingRelease.current=true;
      }
      operation.job?.release();
    }
  }

  /** 旧加载、旧关闭回调不能清掉新弹窗；发送中的操作必须等原任务真实落定。 */
  function closeDatabaseSwitch(intent:QueryDatabaseSwitchIntent) {
    if(databaseSwitchIntent.current!==intent||databaseSwitchOperation.current)return;
    databaseSwitchIntent.current=null;intent.dispose();setDatabaseSwitchDialog(null);
  }

  /** 同步读取原模型所属连接/会话，确认期间的工作台ABA立即撤销授权。 */
  function analyzeScope(): QueryAnalyzeScope {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: state.connectionVersions[connectionId] ?? 0, connection: state.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, draft: current?.sql, databaseKey: JSON.stringify([current?.database, current?.databaseContext]), sourceKey: JSON.stringify([current?.sourceBinding, current?.fileSourceBinding]), present: alive.current && current?.kind === 'query', active: state.settings.activeTabId === tab.id };
  }
  /** 先在原会话受限读取真实默认库；完整确认之前不发送用户SQL，也不清除已有结果。 */
  async function openAnalyze() {
    if (sqlite) return;
    if (busyRef.current || analyzeIntent.current || document.querySelector('[role="dialog"]') || !editor.current || closeRequestRef.current) return;
    let intent: QueryAnalyzeIntent | undefined, opened = false;
    try {
      intent = new QueryAnalyzeIntent(editor.current, analyzeScope, changed => useWorkspace.subscribe(changed), () => { if (alive.current) setAnalyzeInvalid(queryAnalyzeZh.changed); }, queryAnalyzeZh.changed);
      analyzeIntent.current = intent; setAnalyzeInvalid(''); busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
      const session = await ensureSession(); intent.bindSession(session);
      const state = await invoke('query.analyzeContext', { sessionId: session, taskId: uid() }); intent.assertCurrent();
      if (state.dialect === 'sqlite' || state.broken || state.busy || !state.databaseKnown || state.database === undefined) throw Error(queryAnalyzeZh.changed);
      const capability = state.dialect && state.serverVersion ? queryAnalyzeCapability({ dialect: state.dialect, version: state.serverVersion }) : undefined;
      if (!capability?.supported) throw Error(capability?.reason ?? queryAnalyzeZh.unsupported);
      setCompletionSession(state); rememberDatabase({ state: 'known', database: state.database });
      intent.ready(state.database);
      const current = useWorkspace.getState().connections.find(item => item.id === tab.connectionId);
      if (!current) throw Error(queryAnalyzeZh.changed);
      setAnalyzeDialog({ intent, connectionName: `${current.name} · ${connectionOverview(current)} · ${state.dialect} ${state.serverVersion}`, databaseLabel: state.database ?? queryContextZh.none }); opened = true;
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally {
      if (!opened) { intent?.dispose(); if (analyzeIntent.current === intent) analyzeIntent.current = null; }
      busyRef.current = false; if (alive.current) setBusy(false); useWorkspace.getState().setBusy(tab.id, false);
    }
  }
  /** 取消只释放本次确认租约，保留原会话、原结果及已有事务。 */
  function closeAnalyze(intent: QueryAnalyzeIntent) {
    if (analyzeIntent.current !== intent) return;
    intent.dispose(); analyzeIntent.current = null; setAnalyzeDialog(null); setAnalyzeInvalid('');
  }
  /** 明确确认后仅交付冻结来源一次；所有await仍核同一个模型及物理会话。 */
  async function confirmAnalyze(intent: QueryAnalyzeIntent) {
    if (analyzeIntent.current !== intent || busyRef.current) return;
    try { intent.beginSend(); setAnalyzeDialog(null); await runQuery(intent.source, 'analyze', undefined, undefined, undefined, intent); }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { if (analyzeIntent.current === intent) closeAnalyze(intent); else intent.dispose(); }
  }
  /** 编辑器实例被替换时立即撤销旧意图，旧实例迟到销毁或随后换回也不能复活。 */
  function attachQueryEditor(instance: monaco.editor.IStandaloneCodeEditor) {
    fileModelAttached.current = true;
    if (editor.current !== instance) { analyzeIntent.current?.dispose(); clearFailureSource(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; formatting.current?.dispose(); formatting.current = null; activeCurrentIntent.current?.dispose(); duplicateIntent.current?.dispose(); }
    editor.current = instance; setSearchEditor(instance);
  }
  /** 直接读workspace和session同步引用，不等待React重新渲染才能拒绝旧连接或旧草稿。 */
  function currentStatementScope(): CurrentStatementScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, sessionId: sessionRef.current, draft: current?.sql, present: alive.current && !closeRequestRef.current && !fileSource.isBusy() && !workspace.queryFileOpenings?.[tab.id] && current?.kind === 'query' && workspace.connections.some(item => item.id === connectionId), active: workspace.settings.activeTabId === tab.id, modal: !!document.querySelector('[role="dialog"], [role="alertdialog"]') };
  }
  /** 独立入口只捕获当前模型，不读取选区或tab.sql代替正文，也不改原执行快捷键。 */
  async function executeCurrentStatement() {
    if (!alive.current || busyRef.current || useWorkspace.getState().activeJobs[tab.id] || closeRequestRef.current || fileSource.isBusy() || formatting.current || useWorkspace.getState().queryFileOpenings?.[tab.id] || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    let intent: CurrentStatementIntent | undefined;
    try {
      if (!editor.current) throw new Error(currentStatementZh.unavailable);
      intent = new CurrentStatementIntent(editor.current, currentStatementScope, changed => useWorkspace.subscribe(changed));
      activeCurrentIntent.current = intent;
      await runQuery(intent.source, 'execute', undefined, intent, captureFailureSource(intent.source, true), undefined, !sqlite && continueOnError, !sqlite && collectWarnings);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { intent?.dispose(); if (activeCurrentIntent.current === intent) activeCurrentIntent.current = null; }
  }
  /** 参数识别只打开固定会话，不建立任务、不执行用户模板，也不清除已有结果。 */
  function openParameters() {
    if (sqlite) return;
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    clearFailureSource(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = captureFailureSource(source); parameterContinueOnError.current = continueOnError; parameterCollectWarnings.current = collectWarnings;
    invalidateResultSelection(); parameterSession.current = ''; parameterReusePort.current = parameterReuseOwner().begin(source); setParameterSource(source);
  }
  /** 捕获不可变选区或全文；打开和选择文件均不执行 SQL。 */
  function openStreamExport() {
    if (sqlite) return;
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
      parameterSession.current = session;
      // 只读原协议缓存确认当前库；确认失败仅禁用复用，普通捕获模板仍沿原执行路径。
      try {
        const state = await invoke('query.completionState', { sessionId: session });
        if (sessionRef.current === session) {
          rememberDatabase(queryDatabaseFromSession(state));
          const port = parameterReusePort.current; if (port) parameterReuse.current?.recognized(port);
        }
      } catch { parameterReuse.current?.observe(); }
      return names;
    } catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 读取协议缓存更新事务提示；错误后不附加 SQL，不重放任何已经执行的写操作。 */
  async function handleQueryError(reason: unknown) {
    const message = errorMessage(reason); const current = sessionRef.current;
    const state = current ? await invoke('query.sessionState', { sessionId: current }).catch(() => null) : null;
    if (state?.broken || /会话不存在|会话连接已断开|数据库执行进程已退出|PROTOCOL_CONNECTION_LOST|ECONNRESET/.test(message)) {
      rememberDatabase({state:'unknown'});
      // SQLite 失效会话仍保留未知事务及原会话身份，不能冒充已回滚或在下一次执行时自动重建。
      if (sqlite) { if (state?.transactionOpen) setTransaction(true); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); setError(sqliteZh.brokenTransaction + message); return; }
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
  async function runQuery(source: string, mode: 'execute' | 'explain' | 'explain-text' | 'analyze' = 'execute', parameters?: QueryParameter[], currentIntent?: CurrentStatementIntent, locator?: QueryFailureSourceLease, analysisIntent?: QueryAnalyzeIntent, continueAfterError = false, collectWarningDetails = false, reuseExecution?: { beforeLedger(taskId: string): void }): Promise<boolean> {
    if (sqlite && (!['execute', 'explain', 'explain-text'].includes(mode) || parameters || continueAfterError || collectWarningDetails)) { locator?.dispose(); setError(sqliteZh.unsupported); return false; }
    if (busyRef.current) { locator?.dispose(); return false; }
    if (!source.trim()) { locator?.dispose(); setError(zh.query.text001); return false; }
    clearFailureSource(); let retainLocator = false;
    invalidateResultSelection(); busyRef.current = true; setBusy(true); setQueryRunning(true); setError(''); setSelectedPin(''); setShowPinSql(false); setOutcome(null); setStream([]); setResultIndex(0); task.current = uid();cancelledQuery.current=''; useWorkspace.getState().setBusy(tab.id, true);
    let warningReceipt: { scope: QueryWarningsViewScope; valid: boolean } | undefined;
    try {
      if (mode === 'execute' && collectWarningDetails === true) { warningReceipt = { scope: warningsViewScope(), valid: true }; warningsResultSource.current = warningReceipt; }
      if (mode === 'analyze') { if (!analysisIntent) throw Error(queryAnalyzeZh.changed); analysisIntent.assertCurrent(); }
      const session = await ensureSession();
      if (warningReceipt) { if (warningReceipt.scope.sessionId && warningReceipt.scope.sessionId !== session) warningReceipt.valid = false; warningReceipt.scope.sessionId = session; }
      currentIntent?.bindSession(session);
      if (mode === 'analyze') { analysisIntent!.assertCurrent(); analysisIntent!.allowContextPreparation(); }
      if (parameters && session !== parameterSession.current) throw new Error('参数识别时的会话已失效，请重新打开参数表单');
      // 从发送前到协议终态之间持久化为未知，崩溃恢复不会误把初始库用于下一次写入。
      reuseExecution?.beforeLedger(task.current);
      await prepareExecutionContext();
      if (mode === 'analyze') analysisIntent!.assertCurrent();
      if(cancelledQuery.current===task.current)throw new Error(queryContextZh.cancelledBeforeSend);
      currentIntent?.assertCurrent();
      const input = { sessionId: session, sql: source, taskId: task.current, maxRows: settings.resultLimit, ...(mode === 'execute' && currentIntent ? { currentStatement: { offset: currentIntent.offset } } : {}), ...(mode === 'execute' && continueAfterError ? { continueOnError: true as const } : {}), ...(mode === 'execute' && collectWarningDetails === true ? { collectWarnings: true as const } : {}) };
      // 文本计划复用首次捕获的 SQL，切换展示不会读取后来编辑的草稿。
      if (mode === 'explain' || mode === 'explain-text') explainSource.current = source;
      const result = parameters ? await invoke('query.executeParameterized', { ...input, parameters }) : mode === 'execute' ? await invoke('query.execute', input) : mode === 'analyze' ? await invoke('query.analyze', { ...input, acknowledged: true, expectedDatabase: analysisIntent!.database }) : await invoke('query.explain', { ...input, format: mode === 'explain-text' ? 'text' : 'auto' });
      if (result.scriptReport) {
        // 多个错误只共享一份模型/模板捕获；仅经数值和UTF16边界确认的范围可重绑定位。
        const failures = result.scriptReport.errors.filter(failure => confirmedQueryContinueRange(source, failure));
        scriptFailureRanges.current = new Set(failures);
        if (failures.length && locator?.bindRange(failures[0].sourceRange)) { failureSource.current = locator; retainLocator = true; }
      } else if (result.failure && locator?.bindRange(result.failure.sourceRange)) { failureSource.current = locator; retainLocator = true; }
      // 原响应只包含此前完整成功结果；清除失败语句的部分流，不能将其当作可固定或导出的结果。
      if (warningReceipt && result.warnings) warningReceipt.scope.outcome = result;
      setOutcome(result); setStream([]);
      if (result.failure) await handleQueryError(new Error(result.failure.message));
      else if (result.transactionOpen !== undefined) { setTransaction(result.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, result.transactionOpen); }
      return !result.failure && (!result.scriptReport || result.scriptReport.reachedEnd && result.scriptReport.errors.length === 0) && cancelledQuery.current !== task.current;
    } catch (reason) { await handleQueryError(reason); return false; }
    finally { if (!retainLocator) locator?.dispose(); busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 可选暂存与SQL提交分开：原方法同步签发任务，明确成功后再等待原会话库确认。 */
  function submitParameterQuery(source: string, parameters: QueryParameter[]): void {
    const port = parameterReusePort.current, owner = parameterReuse.current;
    const initial = owner ? parameterReuseInput() : null, session = parameterSession.current;
    const origin = initial ? { connectionId: initial.connectionId, connectionVersion: initial.connectionVersion } : null;
    const locator = parameterFailureSource.current; parameterFailureSource.current = undefined;
    const operation = runQuery(source, 'execute', parameters, undefined, locator, undefined, parameterContinueOnError.current, parameterCollectWarnings.current, owner ?? undefined);
    const taskId = task.current;
    if (port) owner?.bind(port, taskId);
    parameterReusePort.current = null; setParameterSource(null);
    void operation.then(success => {
      if (!owner?.settled(taskId, success === true)) return;
      if (origin) void confirmParameterReuse(owner, taskId, session, origin);
      else owner.settled(taskId, false);
    });
  }
  /** 成功后补读一次协议缓存，避免React先确认库、后收到成功Promise时丢失发布机会；绝不执行诊断SQL。 */
  async function confirmParameterReuse(owner: QueryParameterReuseOwner, taskId: string, session: string, origin: { connectionId: string; connectionVersion: number }): Promise<void> {
    const current = () => {
      const workspace = useWorkspace.getState(), active = workspace.settings.tabs.find(item => item.id === tab.id);
      return alive.current && parameterReuse.current === owner && !busyRef.current && task.current === taskId && sessionRef.current === session && active?.kind === 'query' && active.connectionId === origin.connectionId && (workspace.connectionVersions[origin.connectionId] ?? 0) === origin.connectionVersion && workspace.connections.some(item => item.id === origin.connectionId);
    };
    try {
      if (!current()) { owner.settled(taskId, false); return; }
      const state = await invoke('query.completionState', { sessionId: session });
      if (!current()) { owner.settled(taskId, false); return; }
      const context = queryDatabaseFromSession(state);
      if (context.state !== 'known') { owner.settled(taskId, false); return; }
      rememberDatabase(context); owner.confirmed(taskId, JSON.stringify([context.database]));
    } catch { owner.settled(taskId, false); }
  }
  /** 取消只撤原表单；不清除其它新表单，也不写入或执行参数值。 */
  function closeParameters(): void {
    const port = parameterReusePort.current; if (port) parameterReuse.current?.close(port);
    parameterReusePort.current = null; parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; invalidateResultSelection(); setParameterSource(null);
  }
  /** 报告绑定整次执行而非某个CALL结果集或排序后的行，不接触诊断会话。 */
  function warningsViewScope(): QueryWarningsViewScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, connection: workspace.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, taskId: task.current, outcome: warningsOutcome.current, present: alive.current && current?.kind === 'query', active: workspace.settings.activeTabId === tab.id, closing: !!closeRequestRef.current, busy: busyRef.current || !!workspace.activeJobs[tab.id], pinned: warningsPinned.current };
  }

  /** 打开只使用已返回的离线报告，固定结果不能借用当前会话重新读警告。 */
  function openWarningsReport() {
    if (busyRef.current || warningsIntent.current || document.querySelector('[role="dialog"]') || !warningsReportAvailable()) return;
    let intent: QueryWarningsViewIntent | undefined;
    try {
      intent = new QueryWarningsViewIntent(warningsViewScope, listener => useWorkspace.subscribe(listener), () => {
        if (warningsIntent.current === intent) { warningsIntent.current = null; if (alive.current) setWarningsDialog(null); }
      }, warningsResultSource.current!.scope);
      warningsIntent.current = intent; setWarningsDialog(intent);
    } catch (reason) { intent?.dispose(); setError(errorMessage(reason)); }
  }

  /** 执行时的收据失效后即使报告尚未打开，也不能把旧快照重新关联新连接。 */
  function warningsReportAvailable(): boolean {
    const receipt = warningsResultSource.current;
    return !!receipt?.valid && receipt.scope.outcome === warningsOutcome.current && !!warningsOutcome.current?.warnings && !warningsPinned.current && sameQueryWarningsExecution(receipt.scope, warningsViewScope());
  }

  /** 晚到的旧关闭回调不能清除新执行的报告窗口。 */
  function closeWarningsReport(intent: QueryWarningsViewIntent) {
    if (warningsIntent.current !== intent) return;
    intent.dispose(); warningsIntent.current = null; setWarningsDialog(null);
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
    // 旧保存/历史来源的其他库名不能被静默保存为 main，也不能改写原查询正文或来源。
    if (sqlite && !sessionRef.current) { const context = resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(connection)); if (context.state === 'known' && context.database && context.database !== 'main') throw Error(sqliteZh.mainOnly); }
    const sql = current.fileSourceBinding ? captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)).sql ?? '' : editor.current?.getModel()?.getValue() ?? current.sql ?? '';
    const fileLease = current.fileSourceBinding ? new QuerySourceLease({ ...current }, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id), listener => useWorkspace.subscribe(listener), () => alive.current) : undefined;
    const job = intent ? acquireWorkspaceBusy(tab.id) : undefined;
    if (job) closeBusy.current = job;
    busyRef.current=true;setBusy(true);if (!job) useWorkspace.getState().setBusy(tab.id,true);
    try {
      const context = sessionRef.current ? savedQueryOriginContext(undefined, queryDatabaseFromSession(await invoke('query.completionState',{sessionId:sessionRef.current}).catch(()=>undefined)))
        : current.sourceBinding?.context.state === 'legacy' && current.databaseContext === undefined ? savedQueryOriginContext(current.database)
        : savedQueryOriginContext(undefined, resolveQueryDatabase(current.database,current.databaseContext,connectionDatabase(connection)));
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
  const results = outcome?.failure ? outcome.results : queryRunning ? stream : outcome?.results ?? stream; const pin = pins.find(item => item.id === selectedPin); const sourceResult = pin?.result ?? (outcome?.sqliteExplain ? undefined : results[resultIndex]);
  snapshotValues.current = [tab, connection, connectionVersion, outcome, pins, selectedPin, resultIndex, sourceResult, task.current, sessionRef.current, closeRequest]; snapshotView.current = { result: queryRunning ? undefined : sourceResult, pins };
  /** 文件能力只绑定本轮查询页与已返回来源，不要求连接存在，不触发建连或读取数据库。 */
  function beginResultSnapshot(mode: 'open' | 'save'): QueryResultSnapshotOperation {
    const state = useWorkspace.getState(), originalTab = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === tab.connectionId), view = snapshotView.current, values = [...snapshotValues.current];
    if (!alive.current || snapshotOperation.current || busyRef.current || pendingSession.current || closeRequestRef.current || formatting.current || fileSource.isBusy() || state.activeJobs[tab.id] || originalTab?.kind !== 'query' || originalTab !== tab || state.settings.activeTabId !== tab.id || document.querySelector('[role="dialog"]')) throw Error(queryResultSnapshotUiZh.unavailable);
    if (mode === 'save' && !view.result?.columns.length) throw Error(zh.query.pinRequiresRows);
    if (mode === 'open' && view.pins.length >= pinLimits.count) throw Error(zh.query.pinCountLimit);
    const version = state.connectionVersions[tab.connectionId] ?? 0;
    let operation: SnapshotOperation;
    const intent = new QueryResultSnapshotIntent(values, () => {
      const now = useWorkspace.getState();
      return alive.current && snapshotOperation.current === operation && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && !closeRequestRef.current && !pendingSession.current && !formatting.current && !fileSource.isBusy() && (operation.acquiring || !!operation.job?.owns()) && values.length === snapshotValues.current.length && values.every((value, index) => Object.is(value, snapshotValues.current[index]));
    });
    operation = { intent, acquiring: true }; snapshotOperation.current = operation;
    try { operation.job = acquireWorkspaceBusy(tab.id); busyRef.current = true; setBusy(true); }
    catch (reason) { snapshotOperation.current = null; intent.invalidate(); throw reason; }
    finally { operation.acquiring = false; }
    let finished = false;
    return {
      result: view.result,
      current: () => intent.current(), invalidate: () => intent.invalidate(),
      /** 解析和容量检查全部完成后一次追加固定结果，原结果/SQL/事务都保留。 */
      adopt(snapshot, name) {
        if (!intent.current() || snapshotView.current.pins !== view.pins) throw Error(queryResultSnapshotUiZh.stale);
        const next = snapshotQueryResult(view.pins, snapshot.result, uid(), snapshot.name || name || formatText(zh.query.pinLabel, pinSequence.current + 1));
        intent.consume(); invalidateResultSelection(); pinSequence.current++; setPins([...view.pins, next]); setSelectedPin(next.id); setShowPinSql(false); setError('');
      },
      uncertain: message => useWorkspace.getState().notify(message, true),
      reportError: message => useWorkspace.getState().notify(message, true),
      /** 原IO及Maincleanup真实结束才释放；旧finally不修改后来owner的busy或界面。 */
      finish() {
        if (finished) return; finished = true; intent.invalidate();
        if (snapshotOperation.current === operation) {
          snapshotOperation.current = null;
          if (operation.job?.owns() || !useWorkspace.getState().activeJobs[tab.id]) { snapshotAwaitingBusyRelease.current = false; busyRef.current = false; if (alive.current) setBusy(false); }
          else snapshotAwaitingBusyRelease.current = true;
        }
        operation.job?.release();
      },
    };
  }
  const sourceExportable = !pin && outcome?.sqliteExplain ? undefined : exportableQueryResult(busy, outcome, resultIndex, pin?.result);
  // 结果快照的寿命独立于模态/保存锁；只有新查询才撤销数据来源，操作权限仍走原忙态守卫。
  const viewSource = !pin && outcome?.sqliteExplain ? undefined : exportableQueryResult(queryRunning, outcome, resultIndex, pin?.result);
  const resultContext=[outcome,resultIndex,selectedPin,task.current,connectionVersion,tab.connectionId];
  const layoutMatches=!!columnLayout&&columnLayout.result===sourceResult&&columnLayout.context.length===resultContext.length&&columnLayout.context.every((value,index)=>Object.is(value,resultContext[index]));
  const shownColumns=useRef<ResultColumn[]>([]);
  const visibleColumns=useMemo(()=>{
    let next=sourceResult?.columns??[];
    if(sourceResult&&layoutMatches&&columnLayout)try{next=queryResultVisibleColumns(sourceResult.columns,columnLayout.layout);}catch{/* 元数据变化后回到原列，不能继续沿用旧布局。 */}
    // 只改变冻结边界时复用相同可见列身份，不能让筛选/排序控制器把它误认成新列布局。
    if(shownColumns.current.length===next.length&&shownColumns.current.every((column,index)=>column===next[index]))return shownColumns.current;
    shownColumns.current=next;return next;
  },[sourceResult,columnLayout,layoutMatches]);
  const frozenKeys=useMemo(()=>sourceResult&&layoutMatches&&columnLayout?frozenQueryResultKeys(sourceResult.columns,columnLayout.layout):[],[sourceResult,columnLayout,layoutMatches]);
  const resultModal=!!warningsDialog||!!comparisonLease||!!statisticsLease||!!presetLease||!!closeRequest||!!exportResult||save||showPinSql||showSnippets||parameterSource!==null||streamExportSource!==null||sessionObjects||recovery||!!databaseSwitchDialog;
  const failureLocator = failureSource.current;
  // SQLite 动态类型暂不进入 MySQL 比较器；其余方言先筛选再排序，所有消费者沿用同一最终视图。
  const filterBinding=sqlite?undefined:resultFilter.bind(viewSource,resultContext,visibleColumns);
  const filterView=resultFilter.view(filterBinding);
  const sortBinding = sqlite ? undefined : resultSorter.bind(filterView?.result ?? viewSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
  const historyBinding = sqlite ? undefined : resultHistory.bind(viewSource, visibleColumns, resultContext, filterView && sortView ? { expression: filterView.expression, sort: sortView.rules } : undefined, filterBinding);
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
    if (sqlite) return;
    if(!filterBinding||!filterView||!sortBinding||!sortView||!resultSelectionAllowed(selectionBinding))return;
    invalidateResultSelection();const lease={binding:filterBinding,view:filterView,sortBinding,sortView,seed};filterLeaseRef.current=lease;setFilterLease(lease);refreshResultSelection(value=>value+1);
  }
  /** 原显示位置对应原行及可见唯一键，追加AND保留旧OR括号；结构超限时完整保留原视图。 */
  function openCellFilter(cell:QueryResultCopyCell,operator:CellFilterOperator):void{
    if (sqlite) return;
    if(!filterBinding||!filterView||!result||!resultSelectionAllowed(selectionBinding))return;
    try{const capture=captureQueryResultCellFilter(visibleColumns,result.rows,cell),seed=appendQueryResultFilterRule(filterView.expression,queryResultCellFilterRule(capture,operator));showFilterPanel(seed);}catch(reason){setError(errorMessage(reason));}
  }
  /** 勾选集合须与父级接纳的精确索引一致；全部结构检查通过后才撤销选择并打开审核草稿。 */
  function openSelectedFilter(capture:QueryResultSelectedFilterCapture):void{
    if (sqlite) return;
    const current=()=>!!result&&resultSelectionAllowed(selectionBinding)&&resultSelection.matchesIndices(selectionBinding,capture.indices)&&currentQueryResultSelectedFilter(capture,visibleColumns,result.rows);
    if(!filterBinding||!filterView||!current())return;
    try{
      const seed=appendQueryResultFilterNode(filterView.expression,queryResultSelectedFilterNode(capture));
      if(current())showFilterPanel(seed);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 新筛选与已有完整排序共同试算；两者均成功且来源仍有效才一次发布并记一整步。 */
  function replaceResultFilter(expression:QueryResultFilterGroup,sort:readonly QueryResultSortRule[],isCurrent:()=>boolean):void{
    if (sqlite) return;
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
    if (sqlite) return;
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
    if (sqlite) return;
    if (!sortBinding || !sortView || !filterBinding || !filterView || !resultSelectionAllowed(selectionBinding)) return;
    invalidateResultSelection(); const lease = { binding: sortBinding, view: sortView, filterBinding, filterView }; sortLeaseRef.current = lease; setSortLease(lease); refreshResultSelection(value => value + 1);
  }
  /** 完整比较通过后一次发布并记一条整理历史；失败保留原排序及独立草稿。 */
  function applySortPanel(lease: SortLease, rules: QueryResultSortRule[]): boolean {
    if (sqlite) return false;
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
    if (sqlite) return;
    if (!sortBinding || !sortView || !resultSelectionAllowed(selectionBinding) || resultSorter.view(sortBinding) !== sortView) return;
    try {
      const sorted = resultSorter.apply(sortBinding, sortView, next);
      if (filterView) resultHistory.record(historyBinding, { expression: filterView.expression, sort: sorted.rules });
      invalidateResultSelection(); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 完整试算成功且原视图仍有效才发布两个控制器；不执行SQL，不恢复旧选择或行详情。 */
  function travelResultHistory(direction: -1 | 1): void {
    if (sqlite) return;
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
      const captured = captureQueryResultMemory(viewSource, visibleColumns, { expression: filterView.expression, sort: sortView.rules }, frozenKeys.at(-1));
      if (!resultSelectionAllowed(selectionBinding)) return;
      resultMemoryRef.current = captured; setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 用户显式应用到当前完整返回结果；筛选和排序均成功后一次发布、记一条撤销历史。 */
  function applyRememberedOrganization(): void {
    if (sqlite) return;
    if (!resultMemory || resultMemoryRef.current !== resultMemory || !viewSource || !historyBinding || !resultSelectionAllowed(selectionBinding) || columnLeaseRef.current) return;
    try {
      if (!queryResultMemoryMatches(resultMemory, viewSource, visibleColumns)) throw Error(memoryText.mismatch);
      const layout=layoutWithFrozenThrough(resultMemory.frozenThrough);
      const prepared = prepareQueryResultOrganization(viewSource, resultContext, visibleColumns, resultMemory.configuration);
      if (resultMemoryRef.current !== resultMemory || !resultSelectionAllowed(selectionBinding)) return;
      resultHistory.record(historyBinding, resultMemory.configuration, prepared.filterBinding);
      resultFilter.invalidate(); resultSorter.invalidate();
      resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      setColumnLayout({result:sourceResult!,context:resultContext,layout});
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
    if (sqlite) return;
    if(!viewSource||!filterBinding||!filterView||!sortBinding||!sortView||!historyBinding||!resultSelectionAllowed(selectionBinding)||columnLeaseRef.current)return;
    try{
      const value=queryResultPresetValueSchema.parse(captureQueryResultMemory(viewSource,visibleColumns,{expression:filterView.expression,sort:sortView.rules},frozenKeys.at(-1)));
      if(!resultSelectionAllowed(selectionBinding))return;
      invalidateResultSelection();const lease={owner:uid(),value,binding:sortBinding,view:sortView,filterBinding,filterView};presetLeaseRef.current=lease;setPresetLease(lease);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 对比独立于当前结果的选择；仅持有明确的本标签固定快照，不执行SQL或猜测行键。 */
  function openResultComparison():void {
    if (sqlite) return;
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
    if (sqlite) return;
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
    const layout=layoutWithFrozenThrough(value.frozenThrough);
    const prepared=prepareQueryResultOrganization(viewSource,resultContext,visibleColumns,value.configuration);
    if(!presetManagerCurrent(lease))throw Error(presetsText.stale);
    resultHistory.record(historyBinding,value.configuration,prepared.filterBinding);
    resultFilter.invalidate();resultSorter.invalidate();resultFilterRef.current=prepared.filter;resultSorterRef.current=prepared.sorter;
    setColumnLayout({result:sourceResult!,context:resultContext,layout});
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
    if (sqlite) return;
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
    try{queryResultVisibleColumns(lease.binding.columns,layout);setColumnLayout({result:sourceResult!,context:resultContext,layout:{order:[...layout.order],visible:[...layout.visible],...(layout.frozenThrough===undefined?{}:{frozenThrough:layout.frozenThrough})}});closeColumnManager(lease);}catch(reason){setError(errorMessage(reason));}
  }
  /** 方案和暂存仅替换当前边界，不改可见列/顺序；旧方案没有边界就明确清除当前冻结。 */
  function layoutWithFrozenThrough(key?:string):QueryResultColumnLayout {
    if(!sourceResult)throw Error(columnText.stale);
    const keys=queryResultColumnKeys(sourceResult.columns), base=layoutMatches&&columnLayout?columnLayout.layout:{order:keys,visible:keys};
    const next=setQueryResultFrozenThrough(base,key);queryResultVisibleColumns(sourceResult.columns,next);
    return {order:[...next.order],visible:[...next.visible],...(next.frozenThrough===undefined?{}:{frozenThrough:next.frozenThrough})};
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
  /** 命令只归属当前查询；左树切换不能把已有标签的会话或文件来源改成另一数据库。 */
  function queryMenuCurrent(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && workspace.settings.activeTabId === tab.id && current?.kind === 'query'
      && current.connectionId === tab.connectionId && current.database === tab.database
      && JSON.stringify(current.databaseContext) === JSON.stringify(tab.databaseContext)
      && JSON.stringify(current.fileSourceBinding) === JSON.stringify(tab.fileSourceBinding)
      && JSON.stringify(current.sourceBinding) === JSON.stringify(tab.sourceBinding)
      && workspace.connections.find(profile => profile.id === tab.connectionId) === connection
      && (workspace.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && !closeRequestRef.current && !document.querySelector('[role="dialog"], [role="alertdialog"]');
  }
  /** 使用当前Monaco实例的正式查找动作，不发送模拟按键或点击旧按钮。 */
  function openEditorFind(replace = false): void {
    if (!queryMenuCurrent() || !editor.current || fileSource.isBusy()) return;
    const instance = editor.current, action = instance.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find');
    if (action) { instance.focus(); void action.run().catch(reason => setError(errorMessage(reason))); }
  }
  const queryMenuKey = JSON.stringify([tab.id, tab.connectionId, connectionVersion, sessionId, tab.database, tab.databaseContext, tab.fileSourceBinding, tab.sourceBinding, settings.activeTabId, busy, queryRunning, !!closeRequest, fileSource.busy]);
  const menuResult = useRef<{ result?: QueryResult; revision: number }>({ revision: 0 });
  if (menuResult.current.result !== sourceResult) menuResult.current = { result: sourceResult, revision: menuResult.current.revision + 1 };
  const resultMenuKey = JSON.stringify([queryMenuKey, menuResult.current.revision, resultIndex, selectedPin, resultSelectionRevision, !!activeColumnLease, !!activeFilterLease, !!activeSortLease]);
  useUiCommandScope(`tab:${tab.id}`, {
    execute: { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute(); } },
    'execute-current': { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void executeCurrentStatement(); } },
    'execute-all': { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute('all'); } },
    stop: { enabled: queryRunning, run: () => { void cancelCurrentQuery().catch(reason => setError(errorMessage(reason))); } },
    format: { enabled: !busy && !closeRequest && !fileSource.busy, run: async () => { await formatQuery(); } },
    parameters: { enabled: !sqlite && !busy && !!connection && !closeRequest, run: openParameters },
    explain: { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute('explain'); } },
    analyze: { enabled: !sqlite && !busy && !!connection && !closeRequest, run: () => { void openAnalyze(); } },
    'transaction-settings': { enabled: !sqlite && !busy && !!connection && !closeRequest, run: openTransactionSettings },
    'save-query': { enabled: !busy && !closeRequest && !fileSource.busy, run: saveCurrentSource },
    find: { enabled: !!searchEditor && !closeRequest && !fileSource.busy, run: () => openEditorFind() },
    replace: { enabled: !!searchEditor && !closeRequest && !fileSource.busy, run: () => openEditorFind(true) },
    export: { enabled: !!selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease, run: exportVisibleResult },
  }, { active: settings.activeTabId === tab.id && !closeRequest, contextKey: queryMenuKey });
  const draftContext: QueryDatabaseContext = resolveQueryDatabase(tab.database,tab.databaseContext,connectionDatabase(connection));
  const databaseCaption=sessionId?(completionSession?.databaseKnown?completionSession.database||queryContextZh.none:queryContextZh.unknown):draftContext.state==='known'?draftContext.database||queryContextZh.none:queryContextZh.unknown;
  const recoveryDialog=recovery&&<Modal title={queryContextZh.title} onClose={()=>setRecovery(false)}><form onSubmit={event=>{event.preventDefault();if(sessionRef.current||busyRef.current)return;rememberDatabase({state:'known',database:sqlite?'main':recoveryDatabase||null});setRecovery(false);setError('');}}><div className="modal-content"><p className="muted small">{sqlite ? sqliteZh.recoveryHint : queryContextZh.hint}</p><Field label={queryContextZh.database}><input autoFocus readOnly={sqlite} value={sqlite ? 'main' : recoveryDatabase} maxLength={256} onChange={event=>setRecoveryDatabase(event.target.value)}/></Field></div><footer className="modal-footer"><span className="grow"/><button type="button" onClick={()=>setRecovery(false)}>{zh.common.cancel}</button><button className="primary" type="submit" disabled={busy}>{queryContextZh.confirm}</button></footer></form></Modal>;
  return <div ref={layoutRoot} className="workspace-tab query-tab"><div className="context-bar query-context-bar"><div className="query-context-target"><span className="connection-dot" style={{ background: connection?.color }}/><strong title={connection?.name ?? zh.common.connectionDeleted}>{connection?.name ?? zh.common.connectionDeleted}</strong><ChevronDown size={12}/><span className="breadcrumb-divider">/</span><span className="query-database-caption" aria-label="当前查询默认库" title={databaseCaption}>{databaseCaption}</span></div><QueryFileSourceCaption tab={tab} files={fileSource} compact/><span className="muted small query-session-state" title={sessionId ? zh.query.text008 : zh.query.text009}>{sessionId ? zh.query.text008 : zh.query.text009}</span>{!sqlite && <ActionMenu label={menuText.sessionOptions} className="query-context-options" contextKey={queryMenuKey} isCurrent={queryMenuCurrent} disabled={resultModal || !!transactionSettingsDialog || !!analyzeDialog || settings.activeTabId !== tab.id || !!closeRequest}><button aria-label={queryDatabaseSwitchZh.open} disabled={busy||!sessionId||!connection||settings.activeTabId!==tab.id||!!closeRequest||!!databaseSwitchDialog} onClick={openDatabaseSwitch}>{queryDatabaseSwitchZh.open}</button>{!sessionId&&draftContext.state==='unknown'&&<button disabled={busy} onClick={()=>{invalidateResultSelection();setRecoveryDatabase('');setRecovery(true);}}>{queryContextZh.choose}</button>}<button disabled={busy||!sessionId} title={!sessionId?sessionObjectsZh.needsSession:sessionObjectsZh.title} onClick={()=>{invalidateResultSelection();setSessionObjects(true);}}>{sessionObjectsZh.open}</button><div className="query-execution-options query-menu-options" role="group" aria-label={menuText.executionOptions}><label className="check" title={queryWarningsZh.hint}><input type="checkbox" aria-label={queryWarningsZh.option} checked={collectWarnings} disabled={busy || parameterSource !== null} onChange={event => { if (!busyRef.current && parameterSource === null) setCollectWarnings(event.target.checked); }}/>{queryWarningsZh.option}</label><label className="check" title={queryContinueOnErrorZh.hint}><input type="checkbox" aria-label={queryContinueOnErrorZh.option} checked={continueOnError} disabled={busy || parameterSource !== null} onChange={event => { if (!busyRef.current && parameterSource === null) setContinueOnError(event.target.checked); }}/>{queryContinueOnErrorZh.option}</label></div></ActionMenu>}</div><QueryFileActions tab={tab} files={fileSource} renderActions={fileActions => <AdaptiveToolbar
      className="toolbar query-primary-toolbar" ariaLabel={menuText.queryToolbar} contextKey={queryMenuKey} isCurrent={queryMenuCurrent}
      items={[
        { key: 'execute', content: (<div className="query-execute-split"><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button><ActionMenu label={menuText.executeOptions} disabled={busy || !connection} contextKey={queryMenuKey} isCurrent={queryMenuCurrent}><button disabled={busy || !connection} title={menuText.selectedOrScriptHint} onClick={() => void execute()}>{menuText.selectedOrScript}</button><button disabled={busy || !connection || !!closeRequest || fileSource.busy} title={currentStatementZh.hint} aria-label={currentStatementZh.action} onClick={() => void executeCurrentStatement()}><Play size={14}/>{currentStatementZh.action}</button><button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button></ActionMenu></div>), overflow: (<ActionMenuSection label={menuText.executeOptions}><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button>
<button disabled={busy || !connection || !!closeRequest || fileSource.busy} title={currentStatementZh.hint} aria-label={currentStatementZh.action} onClick={() => void executeCurrentStatement()}><Play size={14}/>{currentStatementZh.action}</button>
<button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button></ActionMenuSection>) },
        { key: 'stop', content: (<button disabled={!queryRunning} onClick={() => void cancelCurrentQuery().catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.common.stop}</button>) },
        { key: 'format', content: (<button disabled={busy} title={sqlFormattingZh.hint} aria-label={sqlFormattingZh.action} onClick={formatQuery}><AlignLeft size={15}/>{sqlFormattingZh.button}</button>) },
        { key: 'save', content: (<button disabled={busy} onClick={saveCurrentSource} title={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015} aria-label={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015}><Save size={15}/>{zh.common.save}</button>) }
      ]}
      moreLabel={menuText.queryMore}
      more={<>
        <ActionMenuSection label={menuText.execution}>{!sqlite && <><button disabled={busy || !connection} title={queryStreamZh.title} aria-label={queryStreamZh.open} onClick={openStreamExport}><Download size={14}/>{queryStreamZh.open}</button>
<button disabled={busy || !connection} onClick={openParameters}><Braces size={14}/>{parameterZh.open}</button>
<button disabled={busy || !connection || !!closeRequest} onClick={openTransactionSettings}>{queryTransactionSettingsZh.open}</button></>}
<button disabled={busy || !connection || !!closeRequest || fileSource.busy} onClick={() => void execute('explain')}><Gauge size={15}/>{zh.query.text014}</button>
{!sqlite && <button disabled={busy || !connection || !!closeRequest} onClick={() => void openAnalyze()}><Gauge size={15}/>{queryAnalyzeZh.open}</button>}</ActionMenuSection>
        <ActionMenuSection label={menuText.files}>{fileActions}
{tab.fileSourceBinding && <button disabled={busy || fileSource.busy} title={queryFilesZh.librarySave} aria-label={queryFilesZh.librarySave} onClick={() => { invalidateResultSelection(); setQueryName(tab.title); setSave(true); }}>{queryFilesZh.librarySave}</button>}</ActionMenuSection>
        <ActionMenuSection label={menuText.library}><button disabled={busy || duplicating || !connection || !searchEditor || !!closeRequest || duplicateOrigin.current.connectionId !== tab.connectionId || duplicateOrigin.current.version !== connectionVersion} title={queryDuplicateZh.hint} aria-label={queryDuplicateZh.action} onClick={() => void duplicateQuery()}><Copy size={14}/>{queryDuplicateZh.action}</button>
<button title={zh.snippets.title} aria-label={zh.snippets.title} onClick={openSnippets}><BookOpen size={15}/></button>
<button onClick={onHistory} title={zh.common.historyQueries}><History size={15}/></button></ActionMenuSection>
      </>}
    />}/>{!sqlite && collectWarnings && <aside className="info-strip" role="note" aria-label={queryWarningsZh.notice} style={{ margin: '0 12px 8px', padding: '8px 12px', fontSize: 11, lineHeight: 1.6, maxHeight: 72, overflow: 'auto', flexShrink: 0 }}>{queryWarningsZh.hint}</aside>}<SavedQueryMatchNavigation tabId={tab.id} source={searchNavigation} editor={searchEditor}/><div id={layoutEditorId} className="sql-editor-wrap" style={{ height: editorHeight }}>{fileOpening ? <Spinner text={queryFilesZh.opening}/> : <SqlEditor value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })} onReady={instance => { attachQueryEditor(instance); parameterReuse.current?.observe(); }} onExecute={() => void execute()} onExecuteCurrent={() => void executeCurrentStatement()} onFormat={formatQuery} dialect={connection?.dialect} completion={!busy&&connection&&!sqlite?{connectionId:tab.connectionId,connectionVersion,database:draftContext.state==='known'?draftContext.database??undefined:undefined,databaseUnknown:draftContext.state==='unknown',sessionId:sessionId||undefined}:undefined} onCompletionStatus={setCompletionStatus}/>}</div><QueryLayoutSplitter value={preferredEditorHeight} min={queryLayoutLimits.minEditorHeight} max={layoutMaximum} defaultValue={queryLayoutLimits.defaultEditorHeight} controls={layoutEditorId} scope={layoutScope} disabled={layoutActiveTab!==tab.id||!connection||!!closeRequest} begin={beginEditorLayout} onPreview={setEditorPreview}/><QueryResultSnapshotActions result={queryRunning ? undefined : sourceResult} disabled={busy || resultModal || settings.activeTabId !== tab.id} begin={beginResultSnapshot} renderActions={snapshotActions => <div className="result-toolbar query-result-toolbar">
      <span className="result-label">{zh.query.text016}</span><div className="query-result-tabs">{results.map((_, index) => <button className={!pin && resultIndex === index ? 'selected' : ''} onClick={() => { invalidateResultSelection(); setResultIndex(index); setSelectedPin(''); setShowPinSql(false); }} key={index}>{zh.query.text017}{index + 1}</button>)}</div>
      <AdaptiveToolbar className="query-result-actions" ariaLabel={menuText.resultToolbar} contextKey={resultMenuKey} isCurrent={queryMenuCurrent}
        items={[
          ...(sqlite ? [] : [{ key: 'filter', content: (<button disabled={!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={!filterBinding?filterText.unavailable:filterText.hint} onClick={openFilterPanel}>{filterText.open}</button>) },
          { key: 'sort', content: (<button disabled={!sortBinding||!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={sortText.scope} onClick={openSortPanel}>{sortText.panelTitle}</button>) }]),
          { key: 'columns', content: (<button disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={openColumnManager}>{columnText.open}</button>) },
          { key: 'export', content: (<button disabled={!selectionBinding||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={exportVisibleResult}><Download size={12}/>{zh.resultExport.title}</button>) }
        ]}
        moreLabel={menuText.resultMore}
        more={<>
          <ActionMenuSection label={menuText.resultView}>{!sqlite && <button disabled={busy||pins.length<2||!!comparisonLease||!!statisticsLease} title={comparisonText.notice} onClick={openResultComparison}>{comparisonText.open}</button>}{outcome?.warnings && !pin && <button disabled={busy || !!pin || !warningsReportAvailable() || !!closeRequest} onClick={openWarningsReport}>{queryWarningsZh.open}</button>}
<button disabled={busy || !outcome || !result?.columns.length || !!pin} title={zh.query.pinHint} onClick={pinResult}><Pin size={12}/>{zh.query.pinResult}</button>
{pin && <button onClick={() => {invalidateResultSelection();setShowPinSql(true);}}>{zh.query.pinnedStatement}</button>}
<button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)} title={rowDetailsText.choose} onClick={openRowDetail}>{rowDetailsText.open}</button></ActionMenuSection>
          <ActionMenuSection label={sqlite ? zh.app.text020 : menuText.resultHistory}>{!sqlite && <><button title={resultHistory.limited?historyText.limited:historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,-1)} onClick={()=>travelResultHistory(-1)}>{historyText.undo}</button>
<button title={historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,1)} onClick={()=>travelResultHistory(1)}>{historyText.redo}</button>
{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis))?<><button disabled={!filterView?.rules.length||!!activeFilterLease||!!activeColumnLease||!!activeSortLease} onClick={clearResultFilter}>{filterText.clear}</button><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={memoryText.hint} onClick={rememberResultOrganization}>{memoryText.save}</button><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={presetsText.hint} onClick={openResultPresets}>{presetsText.open}</button></>:null}{resultMemory&&<><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)} title={queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)?memoryText.scope:memoryText.mismatch} onClick={applyRememberedOrganization}>{memoryText.apply}</button><button disabled={!rememberedOrganizationCanDiscard()} onClick={discardRememberedOrganization}>{memoryText.clear}</button></>}</>}<div className="action-menu-field" role="group" aria-label={zh.app.text020}><label className="inline-field">{zh.query.text020}<input aria-label={zh.query.text021} type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => useWorkspace.getState().updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/>{zh.query.text022}</label></div></ActionMenuSection>
          <ActionMenuSection label={menuText.resultTransfer}><button disabled={!selectedExportCount || busy} onClick={exportSelectedRows}>{zh.resultExport.selectedTitle}</button>
{!sqlite && <button aria-label={resultInsertZh.open} disabled={!selectionBinding || !exportable?.rows.length || busy || !!resultInsertSource || !!activeColumnLease || !!activeFilterLease || !!activeSortLease} onClick={() => openResultInsert(false)}>{resultInsertZh.open}</button>}
{!sqlite && <button aria-label={resultInsertZh.selected} disabled={!selectedExportCount || busy || !!resultInsertSource} onClick={() => openResultInsert(true)}>{resultInsertZh.selected}</button>}</ActionMenuSection>
          <ActionMenuSection label={menuText.snapshots}>{snapshotActions}</ActionMenuSection>
        </>}/>

    </div>}/>{pins.length > 0 && <div className="pinned-results" aria-label={zh.query.pinSection}><span>{zh.query.pinSection}</span><button className={`current-results ${!pin ? 'selected' : ''}`} onClick={() => { invalidateResultSelection(); setSelectedPin(''); setShowPinSql(false); }}>{zh.query.currentResults}</button>{pins.map(item => <div key={item.id} className={`pinned-result ${pin?.id === item.id ? 'selected' : ''}`}><button aria-pressed={pin?.id === item.id} title={item.result.statement} onClick={() => { invalidateResultSelection(); setSelectedPin(item.id); setShowPinSql(false); }}><Pin size={11}/>{item.label}</button><button aria-label={formatText(zh.query.releasePin, item.label)} onClick={() => releasePin(item.id)}><X size={11}/></button></div>)}</div>}<ErrorBox message={error}/>{outcome?.scriptReport && <QueryContinueOnErrorNotice report={outcome.scriptReport} completedResults={outcome.results.length} locateAvailable={failure => scriptFailureRanges.current.has(failure) && !!failureLocator?.available()} onLocate={failure => { if (scriptFailureRanges.current.has(failure) && failureLocator?.available() && failureLocator.bindRange(failure.sourceRange)) failureLocator.locate(); }}/>}{outcome?.failure && !outcome.scriptReport && <QueryPartialOutcomeNotice failure={outcome.failure} completedResults={outcome.results.length} locateAvailable={!!failureLocator?.available()} onLocate={() => { failureLocator?.locate(); }}/>}{!sqlite && <div className="query-result-filter-bar">{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis))?<><span>{filterText.counts(sourceResult.rows.length,filterView?.result.rows.length??sourceResult.rows.length)}</span>{sourceResult.truncated&&<strong>{filterText.truncated}</strong>}</>:null}{resultMemory&&<span role="status" title={memoryText.hint}>{memoryText.saved}</span>}</div>}{!sqlite && activeFilterLease&&<QueryResultFilterPanel binding={activeFilterLease.binding} initial={activeFilterLease.view} seed={activeFilterLease.seed} isCurrent={()=>filterPanelCurrent(activeFilterLease)} onApply={expression=>applyFilterRules(activeFilterLease,expression)} onClose={()=>closeFilterPanel(activeFilterLease)}/>}{!sqlite && activeSortLease&&<QueryResultSortPanel binding={activeSortLease.binding} initial={activeSortLease.view} isCurrent={()=>sortPanelCurrent(activeSortLease)} onApply={rules=>applySortPanel(activeSortLease,rules)} onClose={()=>closeSortPanel(activeSortLease)}/>}{!sqlite && <div className="query-result-sort-scope">{result?.columns.length && (pin || !(outcome?.explain || outcome?.analysis)) && (!!sortView?.rules.length || !sortBinding && sourceExportable && settings.activeTabId === tab.id && !resultModal) ? <>{!sortBinding && sourceExportable && settings.activeTabId === tab.id && !resultModal && <strong>{sortText.budget}</strong>}<button disabled={!sortView?.rules.length || !selectionBinding || !!activeColumnLease || !!activeFilterLease} onClick={() => sortResult([])}>{sortText.clear}</button>{!!sortView?.rules.length && <ol className="query-result-sort-priorities" aria-label={sortText.priorities}>{sortView.rules.map((rule,index)=>{
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
  })}</ol>}</> : null}</div>}<div className="result-body">{!pin && outcome?.sqliteExplain ? <SqliteExplainPlanView key={task.current} outcome={outcome} busy={busy} isCurrent={queryMenuCurrent}/> : !pin && outcome?.analysis ? <QueryAnalyzeView key={task.current} plan={outcome.analysis} outcome={outcome} fileActions busy={busy}/> : !pin && outcome?.explain ? <ExplainPlanView key={task.current} outcome={outcome} fileActions fileBusy={busy} busy={busy || !sessionId} onText={() => void runQuery(explainSource.current, 'explain-text')}/> : result?.columns.length ? <div className="query-result-with-details"><div className="query-result-grid"><ResultsGrid key={pin?.id ?? `current-${resultIndex}`} columns={visibleColumns} rows={result.rows} frozenKeys={frozenKeys} binarySourceIdentity={[...resultContext,result,filterView,sortView]} binaryIsCurrent={() => alive.current && !busyRef.current && task.current === resultContext[3]} sort={sqlite ? undefined : sortView?.rules ? [...sortView.rules] : []} onSortChange={!sqlite && sortBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? sortResult : undefined} sortReasons={sqlite ? undefined : sortBinding?.reasons} onHistoryTravel={sqlite ? undefined : travelResultHistory} onFilterCell={!sqlite && filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openCellFilter : undefined} onFilterSelected={!sqlite && filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openSelectedFilter : undefined} onStatistics={!sqlite && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openResultStatistics : undefined} selectionScope={selectionBinding} onSelectionChange={selectResultRows} isCurrent={() => resultSelectionAllowed(selectionBinding)} onActiveRowIndexChange={selectActiveDetailRow}/></div>{currentRowDetail && <QueryRowDetailsPanel key={currentRowDetail.id} controller={rowDetails} view={currentRowDetail} isCurrent={() => rowDetailAllowed(currentRowDetail.binding)} onMove={moveRowDetail} onClose={closeRowDetail}/>}</div> : result ? <Empty title={zh.query.text023} text={formatText(zh.query.text024, result.affectedRows ?? 0, result.insertId ? formatText(zh.query.text025, result.insertId) : '', result.warningCount ? formatText(zh.query.text026, result.warningCount) : '')}/> : <Empty title={zh.query.text027} text={zh.query.text028}><div className="key-tip"><kbd>Ctrl / ⌘</kbd><span>+</span><kbd>Enter</kbd></div></Empty>}</div><div className="tab-status">{result?.columns.length && result.warningCount !== undefined ? <span aria-label={queryWarningsZh.count(result.warningCount)}>{queryWarningsZh.count(result.warningCount)}</span> : null}<span>{result ? formatText(zh.query.text029, result.rows.length, result.truncated ? zh.query.text030 : '') : zh.query.text031}</span>{busy ? <Spinner text={zh.query.text018}/> : outcome && <span className="muted small">{outcome.elapsedMs}{zh.query.text019}</span>}<span className="grow"/>{!busy&&completionStatus!=='idle'&&<span className="muted small" aria-label="SQL 补全状态" title={completionStatusInfo[completionStatus].hint}>{completionStatusInfo[completionStatus].text}</span>}{(transaction || !transactionKnown) && <span className="warning-text" title={!transactionKnown ? parameterZh.transactionUnknownHint : undefined}><LockKeyhole size={12}/>{transactionKnown ? zh.query.text032 : parameterZh.transactionUnknown}</span>}<button disabled={busy || transaction || !transactionKnown} onClick={() => void transactionAction('begin')}>{zh.common.transactionBegin}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('commit')}><Check size={12}/>{zh.common.transactionCommit}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('rollback')}><RotateCcw size={12}/>{zh.common.transactionRollback}</button></div>{sessionObjects&&<SessionObjectsDialog sessionId={sessionId} database={completionSession?.databaseKnown?completionSession.database??undefined:undefined} busy={busy} onRead={readTemporaryObject} onClose={()=>setSessionObjects(false)}/ >}{recoveryDialog}{databaseSwitchDialog&&<QueryDatabaseSwitchDialog intent={databaseSwitchDialog} onLoad={()=>loadDatabaseSwitchChoices(databaseSwitchDialog)} onApply={database=>applyDatabaseSwitch(databaseSwitchDialog,database)} onClose={()=>closeDatabaseSwitch(databaseSwitchDialog)}/ >}{closeRequest && closePhase === 'choose' && <QueryCloseDialog title={tab.title} onCancel={() => finishClose(false)} onDiscard={() => finishClose(true)} onSave={beginCloseSave}/ >}{closeRequest && closePhase === 'save' && createPortal(<QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={saveAndClose} onClose={() => finishClose(false)}/>, document.body)}{save && <QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={async (action, name) => { await saveQuery(action, name); }} onClose={() => {invalidateResultSelection();setSave(false);}}/>}{showPinSql && pin && <Modal title={zh.query.pinSource} wide onClose={() => {invalidateResultSelection();setShowPinSql(false);}}><div className="modal-content"><SqlEditor value={pin.result.statement} height={280} readOnly/></div><footer className="modal-footer"><span className="grow"/><button onClick={() => setShowPinSql(false)}>{zh.common.close}</button></footer></Modal>}{showSnippets && <SnippetsDialog initialSql={snippetSelection.current ? editor.current?.getModel()?.getValueInRange(snippetSelection.current) || tab.sql || '' : tab.sql || ''} onInsert={insertSnippet} onClose={() => {invalidateResultSelection();setShowSnippets(false);}}/ >}{warningsDialog && <QueryWarningsDialog report={warningsDialog.report} onClose={() => closeWarningsReport(warningsDialog)}/ >}{transactionSettingsDialog && <QueryTransactionSettingsDialog intent={transactionSettingsDialog.intent} connectionName={transactionSettingsDialog.connectionName} onRead={taskId => requestTransactionSettings(transactionSettingsDialog.intent, taskId)} onApply={input => requestTransactionSettings(transactionSettingsDialog.intent, input.taskId, input)} onAutocommit={input => requestAutocommit(transactionSettingsDialog.intent, input)} onClose={() => closeTransactionSettings(transactionSettingsDialog.intent)}/>}{analyzeDialog && <QueryAnalyzeConfirmDialog source={analyzeDialog.intent.source} connectionName={analyzeDialog.connectionName} databaseLabel={analyzeDialog.databaseLabel} invalidReason={analyzeInvalid || undefined} onConfirm={() => void confirmAnalyze(analyzeDialog.intent)} onClose={() => closeAnalyze(analyzeDialog.intent)}/ >}{parameterSource !== null && <QueryParametersDialog source={parameterSource} loadNames={loadParameterNames} reuse={parameterReusePort.current ?? undefined} onExecute={parameters => submitParameterQuery(parameterSource, parameters)} onClose={closeParameters}/ >}{streamExportSource !== null && <QueryStreamExportDialog sessionBusy={busy} source={streamExportSource} loadNames={loadStreamParameterNames} onExecute={runStreamExport} onCancel={cancelStreamExport} onClose={() => { if (!busyRef.current) setStreamExportSource(null); }}/ >}{activeColumnLease&&<QueryResultColumnsDialog binding={activeColumnLease.binding} initial={activeColumnLease.initial} owner={activeColumnLease.owner} isCurrent={()=>columnManagerCurrent(activeColumnLease)} onApply={layout=>applyColumnLayout(activeColumnLease,layout)} onClose={()=>closeColumnManager(activeColumnLease)}/ >}{activePresetLease&&<QueryResultPresetsDialog key={activePresetLease.owner} connectionId={tab.connectionId} value={activePresetLease.value} owner={activePresetLease.owner} isCurrent={()=>presetManagerCurrent(activePresetLease)} matches={value=>queryResultMemoryMatches(value,viewSource,visibleColumns)} onApply={value=>applyResultPreset(activePresetLease,value)} onClose={()=>closeResultPresets(activePresetLease)}/ >}{activeStatisticsLease&&<QueryResultStatisticsDialog key={activeStatisticsLease.owner} columns={activeStatisticsLease.columns} rows={activeStatisticsLease.rows} initialColumn={activeStatisticsLease.column} selectedIndices={activeStatisticsLease.indices} truncated={activeStatisticsLease.truncated} owner={activeStatisticsLease.owner} isCurrent={()=>statisticsCurrent(activeStatisticsLease)} onClose={()=>closeResultStatistics(activeStatisticsLease)}/ >}{activeComparisonLease&&<QueryResultComparisonDialog key={activeComparisonLease.owner} pins={activeComparisonLease.pins} owner={activeComparisonLease.owner} isCurrent={()=>comparisonCurrent(activeComparisonLease)} onClose={()=>closeResultComparison(activeComparisonLease)}/ >}{resultInsertSource && <ResultInsertDialog intent={resultInsertSource} initialConnectionId={tab.connectionId} onActivity={resultInsertActivityChange} onClose={() => closeResultInsert(resultInsertSource)} onCommitted={output => useWorkspace.getState().notify(resultInsertZh.committed(output.rows))} onCleanupError={message => useWorkspace.getState().notify(resultInsertZh.cleanupFailed + message, true)}/>}{exportResult && <ResultExportDialog result={exportResult} tabId={tab.id} allowSql={!sqlite} selected={exportSelected} onClose={() => {invalidateResultSelection();setExportResult(null);}}/>}</div>;
}
