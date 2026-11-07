import { appModalSelector, isAppModalNode } from '../modalSelectors';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type * as monaco from 'monaco-editor';
import type { ColumnWidths } from 'react-data-grid';
import { format } from 'sql-formatter';
import type { QueryOutcome, QueryResult, ResultColumn } from '../../shared/contracts';
import { queryResultTitle } from '../../shared/queryResultTitle';
import { postgresTableLimits } from '../../shared/postgresTable';
import type { QueryParameterNames, QueryParameter } from '../../shared/queryParameters';
import type { SavedQueryNavigationSource } from '../../shared/savedQuerySearch';
import type { UiCommandId } from '../../shared/uiCommands';
import { sqlLineCommandIds } from '../../shared/uiCommandIds';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import { queryResultPresetValueSchema, type QueryResultPresetValue } from '../../shared/queryResultPresets';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { postgresZh as text } from '../locales/postgres.zh-CN';
import { formatText, zh } from '../locales/zh-CN';
import { pinLimits, snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { QueryResultSnapshotIntent } from '../queryResultSnapshotIntent';
import { queryResultSnapshotUiZh as snapshotText } from '../locales/queryResultSnapshot.zh-CN';
import { postgresRecordTransferZh as transferText } from '../locales/postgresRecordTransfer.zh-CN';
import { capturePostgresQueryTransfer, usePostgresRecordTransfer } from '../postgresRecordTransfer';
import { queryResultComparisonZh as comparisonText } from '../locales/queryResultComparison.zh-CN';
import { ResultExportSelection, type ResultGridSelection, type ResultSelectionBinding } from '../resultExport';
import { frozenQueryResultKeys, queryResultColumnKeys, queryResultColumnWidth, queryResultVisibleColumns, setQueryResultFrozenThrough, type QueryResultColumnLayout } from '../queryResultColumns';
import { captureQueryResultMemory, queryResultMemoryMatches } from '../queryResultMemory';
import { queryResultPresetsZh as presetsText } from '../locales/queryResultPresets.zh-CN';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { queryRowDetailsZh as detailText } from '../locales/queryRowDetails.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { appendQueryResultFilterNode, QueryResultFilter, type QueryResultFilterBinding, type QueryResultFilterGroup, type QueryResultFilterRule, type QueryResultFilterView } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterNode, type CellFilterOperator } from '../queryResultCellFilter';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture } from '../queryResultSelectedFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { prepareQueryResultOrganization, QueryResultHistory } from '../queryResultHistory';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { SqlEditor, type SqlCompletionStatus } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { PostgresQueryExportDialog, type PostgresQueryExportSource } from './PostgresQueryExportDialog';
import { postgresQueryExportZh as fullExportText } from '../locales/postgresQueryExport.zh-CN';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { QueryResultStatisticsDialog } from './QueryResultStatisticsDialog';
import { QueryResultPresetsDialog } from './QueryResultPresetsDialog';
import { QueryResultComparisonDialog } from './QueryResultComparisonDialog';
import { QueryResultSnapshotActions, type QueryResultSnapshotOperation } from './QueryResultSnapshotActions';
import { ExplainPlanView } from './ExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from './QueryAnalyzeConfirmDialog';
import { queryAnalyzeZh } from '../locales/queryAnalyze.zh-CN';
import { ErrorBox, Spinner, Empty, Modal } from './ui';
import { QueryCloseDialog } from './QueryCloseDialog';
import { QueryBindingDialog } from './QueryBindingDialog';
import { QueryDuplicateIntent } from '../queryDuplicateIntent';
import { queryDuplicateZh } from '../locales/queryDuplicate.zh-CN';
import { QueryParametersDialog } from './QueryParametersDialog';
import { captureQueryFailureSource, type QueryFailureSourceLease, type QueryFailureSourceScope } from '../queryFailureSource';
import { QueryPartialOutcomeNotice } from './QueryPartialOutcomeNotice';
import { QueryParameterReuseOwner, type QueryParameterReuseOwnerInput } from '../queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../queryParameterReusePort';
import { SnippetsDialog } from './SnippetsDialog';
import { SNIPPET_LIMITS } from '../../shared/snippets';
import { useQueryFileSource } from '../useQueryFileSource';
import { captureQueryFileSnapshot } from '../queryFileSnapshot';
import { flushEditorContent } from '../editorContentBridge';
import { captureHistoryInsertion, type HistoryInsertionRegistry, type HistoryInsertionTarget } from '../historyInsertion';
import { SavedQueryMatchNavigation } from './SavedQueryMatchNavigation';
import { useUiCommandScope, type UiCommandHandler } from '../uiCommands';
import { bracketCommands, sqlPositionActions, sqlTextActions } from '../sqlEditorActions';
import { hasExplicitCaseSelection } from '../sqlSelectionCase';
import { openFocusedGridRowJump } from './GridRowJump';
import { StatementNavigationPanel } from './StatementNavigationPanel';
import { usePostgresStatementNavigation } from '../usePostgresStatementNavigation';
import { statementNavigationZh as navigationText } from '../locales/statementNavigation.zh-CN';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import { QueryLayoutSplitter, queryEditorVisualHeight } from './QueryLayoutSplitter';
import { beginWorkspaceQueryLayout, queryLayoutActiveTab, queryLayoutTarget } from '../queryLayoutWorkspace';
import { useQueryLayoutMaximum } from '../useQueryLayoutMaximum';
import { queryLayoutLimits, queryLayoutWidthLimits, queryResultBesideMinimum, queryEditorWidthMaximum,
  readQueryEditorHeight, readQueryEditorWidth, readQueryResultPlacement } from '../../shared/queryLayout';
import { queryLayoutZh } from '../locales/queryLayout.zh-CN';
import '../queryLayout.css';
import './PostgresQueryTab.css';
import '../queryPins.css';
import '../queryResultSort.css';
interface Scope {
  profile: unknown;
  version: number;
  database: string;
}
interface Phase {
  life: object;
  scope: Scope;
  valid: boolean;
  cancelled: boolean;
  taskId: string;
  sent: boolean;
  work?: Promise<void>;
  cancel?: Promise<void>;
}
interface ParameterOwner {
  source: string;
  scope: Scope;
  model: monaco.editor.ITextModel;
  version: number;
  valid: boolean;
  session?: string;
  reuse: QueryParameterReusePort | null;
  failureSource?: QueryFailureSourceLease;
}
interface AnalyzeOwner {
  token: string;
  source: string;
  sessionId: string;
  scope: Scope;
  model: monaco.editor.ITextModel;
  version: number;
}
interface SortDraft { binding: QueryResultSortBinding; view: QueryResultSortView; }
interface FilterDraft { binding: QueryResultFilterBinding; view: QueryResultFilterView; sortView: QueryResultSortView; seed?: QueryResultFilterGroup; }
interface ColumnDraft { binding: ResultSelectionBinding; owner: string; initial: QueryResultColumnLayout; }
interface StatisticsDraft { binding: ResultSelectionBinding; owner: string; column: ResultColumn; indices: ReadonlySet<number>; }
interface PresetDraft { binding: ResultSelectionBinding; owner: string; value: QueryResultPresetValue; }
interface ResultLayout { source: QueryResult; layout: QueryResultColumnLayout; columns: ResultColumn[]; }
interface PinState { items: PinnedQueryResult[]; selected?: string; sequence: number; }
interface ComparisonDraft { pins: PinnedQueryResult[]; owner: string; }
/** PostgreSQL查询复用原编辑器、结果网格、文件来源及保存查询；驱动任务和事务明确独立。 */
export function PostgresQueryTab({
  tab,
  closeRequest,
  onCloseRequestFinished,
  onHistory,
  searchNavigation,
  historyInsertionRegistry,
}: {
  tab: WorkspaceTab;
  closeRequest?: QueryCloseRequest;
  onCloseRequestFinished?(request: QueryCloseRequest, close: boolean, keep?: WorkspaceTab): void;
  onHistory(): void;
  searchNavigation?: SavedQueryNavigationSource;
  historyInsertionRegistry?: HistoryInsertionRegistry;
}) {
  const workspace = useWorkspace((s) => s),
    profile = workspace.connections.find((p) => p.id === tab.connectionId),
    version = workspace.connectionVersions[tab.connectionId] ?? 0;
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    alive = useRef(false),
    life = useRef<object>({}),
    session = useRef<{ id: string; scope: Scope } | undefined>(undefined),
    phase = useRef<Phase | undefined>(undefined),
    closeRef = useRef(closeRequest);
  closeRef.current = closeRequest;
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const layoutRoot = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0), [resultsOnly, setResultsOnly] = useState(false);
  const [editorPreview, setEditorPreview] = useState<number | null>(null), [editorWidthPreview, setEditorWidthPreview] = useState<number | null>(null);
  const preferredPlacement = readQueryResultPlacement(tab.queryResultPlacement);
  const besideAvailable = layoutWidth >= queryResultBesideMinimum;
  const resultLayout = resultsOnly ? 'results' : preferredPlacement === 'beside' && besideAvailable ? 'beside' : 'below';
  const layoutMaximum = useQueryLayoutMaximum(layoutRoot, queryLayoutLimits.maxEditorHeight, setLayoutWidth);
  const widthMaximum = queryEditorWidthMaximum(layoutWidth);
  const preferredEditorHeight = readQueryEditorHeight(tab.queryEditorHeight), preferredEditorWidth = readQueryEditorWidth(tab.queryEditorWidth);
  const editorHeight = queryEditorVisualHeight(editorPreview ?? preferredEditorHeight, layoutMaximum);
  const editorWidth = queryEditorVisualHeight(editorWidthPreview ?? preferredEditorWidth, widthMaximum);
  const layoutActiveTab = queryLayoutActiveTab(workspace.settings);
  const layoutScope = JSON.stringify([queryLayoutTarget(tab, version), layoutActiveTab, !!closeRequest]);
  const layoutEditorId = useId();
  useLayoutEffect(() => { setEditorPreview(null); setEditorWidthPreview(null); }, [resultLayout]);
  const [editorSelection, setEditorSelection] = useState({ explicit: false, single: false });
  const updateEditorSelection = useCallback((explicit: boolean, single: boolean) => {
    setEditorSelection(previous => previous.explicit === explicit && previous.single === single ? previous : { explicit, single });
  }, []);
  const historyInsertion = useRef<HistoryInsertionTarget | null>(null);
  const duplicateIntent = useRef<QueryDuplicateIntent | undefined>(undefined);
  const duplicateOrigin = useRef({ connectionId: tab.connectionId, version });
  const [duplicating, setDuplicating] = useState(false);
  const [snippets, setSnippets] = useState<{ initialSql: string; create: boolean }>();
  const snippetTarget = useRef<HistoryInsertionTarget | null>(null);
  const [busy, setBusy] = useState(false),
    [fileBusy, setFileBusy] = useState(false),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState<QueryOutcome>(),
    [selected, setSelected] = useState(0),
    [state, setState] = useState<{
      transactionOpen: boolean;
      transactionKnown: boolean;
      transactionFailed: boolean;
      broken: boolean;
      standardConformingStrings?: boolean;
    }>({
      transactionOpen: false,
      transactionKnown: true,
      transactionFailed: false,
      broken: false,
    });
  const [save, setSave] = useState(false),
    [closeSaving, setCloseSaving] = useState(false),
    [parameterOwner, setParameterOwner] = useState<ParameterOwner>(),
    parameters = useRef<ParameterOwner | undefined>(undefined);
  parameters.current = parameterOwner;
  const parameterReuse = useRef<QueryParameterReuseOwner | null>(null), parameterTask = useRef('');
  const parameterState = useRef<{ sessionId: string; known: boolean }>({ sessionId: '', known: false });
  const failureSource = useRef<QueryFailureSourceLease | undefined>(undefined);
  const [, refreshFailureSource] = useState(0);
  const [completionStatus, setCompletionStatus] = useState<SqlCompletionStatus>('idle');
  const [analyze, setAnalyze] = useState<AnalyzeOwner>();
  const analyzeRef = useRef<AnalyzeOwner | undefined>(undefined);
  const [resultSelection] = useState(() => new ResultExportSelection());
  const [pinState, setPinState] = useState<PinState>({ items: [], sequence: 0 });
  const pinStateRef = useRef(pinState);
  const snapshotOperation = useRef<QueryResultSnapshotIntent | undefined>(undefined);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [pinSql, setPinSql] = useState<PinnedQueryResult>();
  const [comparisonDraft, setComparisonDraft] = useState<ComparisonDraft>();
  const comparisonDraftRef = useRef<ComparisonDraft | undefined>(undefined);
  const [resultHistory] = useState(() => new QueryResultHistory());
  const [rowDetails] = useState(() => new QueryRowDetails());
  const [activeDetailRow, setActiveDetailRow] = useState<{ binding: QueryRowDetailsBinding; index: number }>();
  const [rowDetail, setRowDetail] = useState<QueryRowDetailsView>();
  const [organization] = useState(() => ({ filter: new QueryResultFilter('postgresql'), sorter: new QueryResultSort('postgresql') }));
  const { filter: resultFilter, sorter: resultSorter } = organization;
  const [, refreshResult] = useState(0);
  const [sortDraft, setSortDraft] = useState<SortDraft>();
  const sortDraftRef = useRef<SortDraft | undefined>(undefined);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>();
  const filterDraftRef = useRef<FilterDraft | undefined>(undefined);
  const [filterError, setFilterError] = useState('');
  const [columnLayout, setColumnLayout] = useState<ResultLayout>();
  const [columnDraft, setColumnDraft] = useState<ColumnDraft>();
  const columnDraftRef = useRef<ColumnDraft | undefined>(undefined);
  const [statisticsDraft, setStatisticsDraft] = useState<StatisticsDraft>();
  const statisticsDraftRef = useRef<StatisticsDraft | undefined>(undefined);
  const [presetDraft, setPresetDraft] = useState<PresetDraft>();
  const presetDraftRef = useRef<PresetDraft | undefined>(undefined);
  const [exportView, setExportView] = useState<{ result: QueryResult; selected: boolean }>();
  const [fullExport, setFullExport] = useState<PostgresQueryExportSource>();
  const exportOpen = useRef(false);
  const scope: Scope = {
    profile,
    version,
    database: tab.database || (profile?.dialect === 'postgresql' && profile.database) || 'postgres',
  };
  const currentTab = () => useWorkspace.getState().settings.tabs.find((t) => t.id === tab.id);
  const source = () => editor.current?.getModel()?.getValue() ?? currentTab()?.sql ?? '';
  /** 定位只持原模型和执行范围，来源变化永久撤销；忙碌或模态期间仅暂时禁用。 */
  function failureSourceScope(): QueryFailureSourceScope {
    const now = useWorkspace.getState(), current = currentTab(), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: now.connectionVersions[connectionId] ?? 0,
      draft: current?.sql, present: alive.current && current?.kind === 'query' && now.connections.some(item => item.id === connectionId),
      active: now.settings.activeTabId === tab.id, busy: !!phase.current || !!now.activeJobs[tab.id],
      modal: !!document.querySelector(appModalSelector), closing: !!closeRef.current };
  }
  function captureFailureSource(sql: string, all = false): QueryFailureSourceLease | undefined {
    if (!editor.current) return;
    return captureQueryFailureSource({ editor: editor.current, source: sql, all, scope: failureSourceScope,
      subscribe: changed => useWorkspace.subscribe(changed),
      onInvalidated: () => { if (alive.current) refreshFailureSource(value => value + 1); } });
  }
  function clearFailureSource(): void { failureSource.current?.dispose(); failureSource.current = undefined; }
  /** 暂存只读取本标签原模型及已确认的物理会话；不把参数值写入工作区或来源键。 */
  function parameterReuseInput(): QueryParameterReuseOwnerInput | null {
    const now = useWorkspace.getState(), current = currentTab(), owned = session.current;
    if (!current || current.kind !== 'query') return null;
    const connection = now.connections.find(item => item.id === current.connectionId);
    const saved = current.sourceBinding, file = current.fileSourceBinding;
    const database = current.database || (connection?.dialect === 'postgresql' && connection.database) || 'postgres';
    return { tabId: current.id, connectionId: current.connectionId, connectionVersion: now.connectionVersions[current.connectionId] ?? 0,
      sessionId: owned?.id ?? null, editor: editor.current, present: alive.current && connection?.dialect === 'postgresql' && !closeRef.current,
      draft: current.sql, savedSourceKey: JSON.stringify(saved ? [saved.id, saved.digest, saved.connectionId ?? null,
        saved.connectionDigest ?? null, saved.context.state, 'database' in saved.context ? saved.context.database ?? null : null] : null),
      fileSourceKey: JSON.stringify(file ? [file.id, file.revision] : null), databaseKey: JSON.stringify([database]),
      databaseKnown: !!owned && owned.scope.database === database && parameterState.current.sessionId === owned.id && parameterState.current.known,
      taskId: parameterTask.current };
  }
  useLayoutEffect(() => { parameterReuse.current?.observe(); });
  useEffect(() => {
    if (!editorInstance) return;
    const changed = () => parameterReuse.current?.observe();
    const subscriptions = [editorInstance.onDidChangeModel(changed), editorInstance.onDidChangeModelContent(changed),
      editorInstance.onDidChangeCursorSelection(changed), editorInstance.onDidDispose(() => {
        parameterReuse.current?.dispose(); parameterReuse.current = null;
      })];
    return () => subscriptions.forEach(item => item.dispose());
  }, [editorInstance]);
  /** 来源判断不靠同名连接或旧渲染闭包；等待中的配置／默认库ABA会留下永久失效标记。 */
  function same(original: Scope) {
    const now = useWorkspace.getState(),
      p = now.connections.find((p) => p.id === tab.connectionId),
      current = currentTab();
    return (
      alive.current &&
      !!current &&
      current.connectionId === tab.connectionId &&
      p === original.profile &&
      (now.connectionVersions[tab.connectionId] ?? 0) === original.version &&
      (current.database || (p?.dialect === 'postgresql' && p.database) || 'postgres') === original.database
    );
  }
  function available() {
    const now = useWorkspace.getState();
    return (
      same(scope) &&
      profile?.dialect === 'postgresql' &&
      now.settings.activeTabId === tab.id &&
      !!editor.current?.getModel() &&
      !now.activeJobs[tab.id] &&
      !phase.current &&
      !analyzeRef.current &&
      !exportOpen.current &&
      !sortDraftRef.current &&
      !filterDraftRef.current &&
      !columnDraftRef.current &&
      !statisticsDraftRef.current &&
      !presetDraftRef.current &&
      !comparisonDraftRef.current &&
      !snapshotOperation.current &&
      !fileBusy &&
      !closeRef.current &&
      !document.querySelector(appModalSelector)
    );
  }
  /** 撤销确认来源，后续事件不能使用已经关闭或换代的弹窗。 */
  function clearAnalyze(discard = true) {
    const current = analyzeRef.current;
    analyzeRef.current = undefined;
    setAnalyze(undefined);
    if (discard && current) void invoke('postgres.analyzeDiscard', { sessionId: current.sessionId, token: current.token }).catch(() => {});
  }

  /** 参数弹窗绑定准确的模型和活动标签，选区正文无需与整份脚本相等。 */
  function parameterCurrent(owner: ParameterOwner) {
    const current = useWorkspace.getState();
    return (
      owner.valid &&
      parameters.current === owner &&
      same(owner.scope) &&
      current.settings.activeTabId === tab.id &&
      !closeRef.current &&
      editor.current?.getModel() === owner.model &&
      !owner.model.isDisposed() &&
      owner.model.getVersionId() === owner.version
    );
  }
  const files = useQueryFileSource(
    tab,
    () => captureQueryFileSnapshot(editor.current, currentTab),
    () => alive.current,
    (v) => setFileBusy(v),
    {
      editor: () => editor.current,
      available: () => !phase.current && !closeRef.current,
      current: () => !phase.current && !closeRef.current,
    },
  );
  /** 原会话只在用户操作时创建；任何等待失效都关闭刚创建的新会话，不把它交给新目标。 */
  async function ensure(owner: Phase): Promise<string> {
    if (!owner.valid || owner.cancelled || !same(owner.scope) || life.current !== owner.life)
      throw Error(text.changed);
    if (session.current) {
      if (!same(session.current.scope) || session.current.scope.profile !== owner.scope.profile)
        throw Error(text.unknown);
      return session.current.id;
    }
    await invoke('connections.open', { id: tab.connectionId });
    if (!owner.valid || owner.cancelled || !same(owner.scope)) throw Error(text.changed);
    const result = await invoke('sessions.open', {
      connectionId: tab.connectionId,
      database: owner.scope.database,
    });
    if (!owner.valid || owner.cancelled || !same(owner.scope) || life.current !== owner.life) {
      await invoke('sessions.close', { sessionId: result.sessionId });
      throw Error(text.changed);
    }
    session.current = { id: result.sessionId, scope: owner.scope };
    return result.sessionId;
  }
  /** 事务dirty来自实际ReadyForQuery；未知状态保持退出保护，不按按钮文字猜COMMIT。 */
  async function readState(id: string, owner: Phase) {
    try {
      const next = await invoke('query.sessionState', { sessionId: id });
      if (phase.current === owner && owner.valid && same(owner.scope)) {
        parameterState.current = { sessionId: id, known: next.transactionKnown && !next.broken };
        parameterReuse.current?.observe();
        setState({ ...next, transactionFailed: next.transactionFailed === true });
        useWorkspace.getState().setDirty(tab.id, next.transactionOpen || !next.transactionKnown);
      }
    } catch {
      if (same(owner.scope)) {
        parameterState.current = { sessionId: id, known: false };
        parameterReuse.current?.observe();
        setState({ transactionOpen: true, transactionKnown: false, transactionFailed: false, broken: true });
        useWorkspace.getState().setDirty(tab.id, true);
      }
    }
  }
  /** 停止只投递原task，等待原查询及取消Promise都结束；取消ACK不代表数据库未写入。 */
  function stop() {
    const owner = phase.current;
    if (!owner || owner.cancelled) return;
    owner.cancelled = true;
    if (owner.sent)
      owner.cancel = invoke('query.cancel', { taskId: owner.taskId })
        .then(() => {})
        .catch((reason) => {
          if (alive.current) setError(errorMessage(reason));
        });
  }
  /** 查询和计划都捕获原模型版本，实际分析只接受已经确认的原令牌。 */
  function run(
    mode: 'normal' | 'selection' | 'current' | 'all' | 'explain' | 'analyzePreview' = 'normal',
    values?: QueryParameter[],
    parameter?: ParameterOwner,
    sqlOverride?: string,
    confirmed?: AnalyzeOwner,
  ) {
    if (confirmed) {
      const current = useWorkspace.getState();
      if (analyzeRef.current !== confirmed || phase.current || closeRef.current || !same(confirmed.scope) ||
          current.settings.activeTabId !== tab.id || current.activeJobs[tab.id] ||
          session.current?.id !== confirmed.sessionId || editor.current?.getModel() !== confirmed.model ||
          confirmed.model.isDisposed() || confirmed.model.getVersionId() !== confirmed.version) {
        clearAnalyze();
        setError(queryAnalyzeZh.changed);
        return;
      }
      clearAnalyze(false);
    } else if (values) {
      if (
        !parameter ||
        !parameterCurrent(parameter) ||
        phase.current ||
        useWorkspace.getState().activeJobs[tab.id] ||
        parameter.session !== session.current?.id ||
        !parameter.session
      )
        throw Error(text.changed);
    } else if (!commandEditor()) return;
    if (session.current && !state.transactionKnown) {
      setError(text.unknown);
      return;
    }
    const model = editor.current?.getModel(),
      selection = editor.current?.getSelection(),
      original = model?.getValue() ?? source();
    // 「执行选区」在实际派发时重新读取原选区，空选区或多选区不得降级为整份执行。
    if (mode === 'selection' && (!model || !selection || selection.isEmpty() || editor.current?.getSelections()?.length !== 1)) return;
    if (mode === 'current' && !selection) return;
    let sql = confirmed?.source ?? sqlOverride ?? original,
      offset: number | undefined;
    if (!confirmed && !sqlOverride && !values && selection && mode !== 'all') {
      if (mode === 'current' || (mode === 'explain' || mode === 'analyzePreview') && selection.isEmpty()) offset = model!.getOffsetAt(selection.getPosition());
      else if (!selection.isEmpty()) sql = model!.getValueInRange(selection);
    }
    if (values) sql = parameter!.source;
    if (!sql.trim()) {
      setError(text.noSql);
      return;
    }
    clearFailureSource();
    const locator = parameter?.failureSource ?? (!sqlOverride && !confirmed && mode !== 'explain' && mode !== 'analyzePreview'
      ? captureFailureSource(sql, mode === 'all' || mode === 'current') : undefined);
    if (parameter) parameter.failureSource = undefined;
    const modelVersion = model?.getVersionId(),
      job = acquireWorkspaceBusy(tab.id),
      owner: Phase = {
        life: life.current,
        scope: confirmed?.scope ?? parameter?.scope ?? scope,
        valid: true,
        cancelled: false,
        taskId: uid(),
        sent: false,
      };
    phase.current = owner;
    parameterTask.current = owner.taskId;
    setBusy(true);
    setError('');
    if (mode !== 'analyzePreview') {
      resetResultView();
      if (pinStateRef.current.selected) publishPinState({ ...pinStateRef.current, selected: undefined });
      setOutcome(undefined);
      setSelected(0);
    }
    owner.work = (async () => {
      let succeeded = false;
      let retainLocator = false;
      try {
        const id = await ensure(owner);
        if (
          !owner.valid ||
          owner.cancelled ||
          !same(owner.scope) ||
          editor.current?.getModel() !== model ||
          model?.getVersionId() !== modelVersion ||
          (confirmed && confirmed.sessionId !== id) ||
          (parameter && (!parameterCurrent(parameter) || parameter.session !== id))
        )
          throw Error(text.changed);
        if (mode === 'analyzePreview') {
          const preview = await invoke('postgres.analyzePreview', { sessionId: id, sql,
            ...(offset === undefined ? {} : { currentStatement: { offset } }) });
          if (model && modelVersion !== undefined && !model.isDisposed() && model.getVersionId() === modelVersion &&
              owner.valid && !owner.cancelled && same(owner.scope) && !closeRef.current &&
              editor.current?.getModel() === model && useWorkspace.getState().settings.activeTabId === tab.id) {
            const intent = { ...preview, sessionId: id, scope: owner.scope, model, version: modelVersion };
            analyzeRef.current = intent;
            setAnalyze(intent);
          } else void invoke('postgres.analyzeDiscard', { sessionId: id, token: preview.token }).catch(() => {});
          return;
        }
        if (parameter?.reuse) {
          const reuse = parameterReuse.current;
          // 暂存失效只撤销可选记忆能力；原表单的明确执行仍沿原来源校验。
          if (reuse?.bind(parameter.reuse, owner.taskId)) reuse.beforeLedger(owner.taskId);
        }
        if (parameter) setParameterOwner(undefined);
        owner.sent = true;
        const result = confirmed
          ? await invoke('postgres.analyze', { sessionId: id, taskId: owner.taskId, token: confirmed.token, acknowledged: true })
          : values
          ? await invoke('query.executeParameterized', {
              sessionId: id,
              taskId: owner.taskId,
              sql,
              parameters: values,
              maxRows: useWorkspace.getState().settings.resultLimit,
            })
          : await invoke(mode === 'explain' ? 'postgres.explain' : 'query.execute', {
              sessionId: id,
              taskId: owner.taskId,
              sql,
              maxRows: useWorkspace.getState().settings.resultLimit,
              ...(offset === undefined ? {} : { currentStatement: { offset } }),
            });
        succeeded = !result.failure && !result.scriptReport?.errors.length && result.scriptReport?.reachedEnd !== false;
        if (owner.valid && same(owner.scope) && life.current === owner.life) {
          if (result.failure && locator?.bindRange(result.failure.sourceRange)) {
            failureSource.current = locator; retainLocator = true;
          }
          setOutcome(result);
          if (result.failure) setError(result.failure.message);
        }
      } catch (reason) {
        if (alive.current && life.current === owner.life) setError(errorMessage(reason));
      } finally {
        if (!retainLocator) locator?.dispose();
        if (owner.cancel) await owner.cancel;
        const id = session.current?.id;
        if (id) await readState(id, owner);
        if (parameter?.reuse) {
          const reuse = parameterReuse.current;
          const success = succeeded && !owner.cancelled && owner.valid && same(owner.scope) && life.current === owner.life;
          if (reuse?.settled(owner.taskId, success)) reuse.confirmed(owner.taskId, JSON.stringify([owner.scope.database]));
        }
        if (phase.current === owner) phase.current = undefined;
        job.release();
        if (alive.current && life.current === owner.life) {
          setBusy(false);
          if (parameter) {
            parameter.valid = false;
            setParameterOwner(undefined);
          }
        }
      }
    })();
  }
  /** 参数识别只读原模式；表单值不持久到settings、历史或草稿文件。 */
  async function names(owner: ParameterOwner): Promise<QueryParameterNames> {
    if (!parameterCurrent(owner) || phase.current) throw Error(text.changed);
    const job = acquireWorkspaceBusy(tab.id);
    const operation: Phase = {
      life: life.current,
      scope: owner.scope,
      valid: true,
      cancelled: false,
      taskId: uid(),
      sent: false,
    };
    phase.current = operation;
    const result = (async () => {
      try {
        const id = await ensure(operation);
        if (!parameterCurrent(owner)) throw Error(text.changed);
        const result = await invoke('query.parameterNames', { sessionId: id, sql: owner.source });
        if (!parameterCurrent(owner)) throw Error(text.changed);
        owner.session = id;
        await readState(id, operation);
        if (!parameterCurrent(owner)) throw Error(text.changed);
        if (owner.reuse) parameterReuse.current?.recognized(owner.reuse);
        return result;
      } finally {
        if (phase.current === operation) phase.current = undefined;
        job.release();
      }
    })();
    operation.work = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** 记录所选正文和模型版本，表单存续期间禁止借用其他标签或模型。 */
  function openParameters() {
    if (!available()) return;
    const model = editor.current?.getModel(),
      selection = editor.current?.getSelection();
    if (!model) return;
    if (editor.current?.getSelections()?.length !== 1) return;
    const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : '';
    const sql = selected.trim() ? selected : model.getValue();
    const reuse = (parameterReuse.current ??= new QueryParameterReuseOwner(parameterReuseInput)).begin(sql);
    clearFailureSource();
    setParameterOwner({ source: sql, scope, model, version: model.getVersionId(), valid: true, reuse,
      failureSource: captureFailureSource(sql) });
  }
  /** 显式重连先正常关闭旧会话；旧事务或未知写入不会被自动恢复和重放。 */
  async function reconnect() {
    const original = session.current;
    if (!original || !available() || !window.confirm(text.confirmReconnect) || !available()) return;
    clearFailureSource();
    const job = acquireWorkspaceBusy(tab.id);
    const owner: Phase = { life: life.current, scope, valid: true, cancelled: false, taskId: uid(), sent: false };
    phase.current = owner;
    setBusy(true);
    setError('');
    owner.work = (async () => {
      try {
        await invoke('sessions.close', { sessionId: original.id });
        if (session.current === original) session.current = undefined;
        if (!same(owner.scope) || life.current !== owner.life) return;
        setState({ transactionOpen: false, transactionKnown: true, transactionFailed: false, broken: false });
        useWorkspace.getState().setDirty(tab.id, false);
        if (owner.valid && !owner.cancelled) await readState(await ensure(owner), owner);
      } catch (reason) {
        if (same(owner.scope)) setError(errorMessage(reason));
      } finally {
        if (phase.current === owner) phase.current = undefined;
        job.release();
        if (alive.current && life.current === owner.life) setBusy(false);
      }
    })();
    await owner.work;
  }
  /** 保存目录沿原来源CAS接口；回包过期仍保留已保存事实，不能覆盖后来编辑器内容。 */
  async function saveQuery(action: 'create' | 'update', name: string) {
    const snapshot = captureQueryFileSnapshot(editor.current, currentTab);
    const originalTab = currentTab(),
      original = snapshot.sql ?? '',
      originalScope = scope;
    const request = closeSaving ? closeRef.current : undefined;
    const instance = editor.current,
      model = instance?.getModel(),
      modelVersion = model?.getVersionId();
    if (!originalTab || !instance || !model || !same(originalScope) || (closeSaving && !request))
      throw Error(text.changed);
    if (action === 'update' && !snapshot.sourceBinding) throw Error(text.changed);
    const read = useWorkspace.getState;
    const intent =
      request &&
      new QuerySaveCloseIntent(
        instance,
        () => {
          const state = read(),
            current = currentTab(),
            connection = state.connections.find((item) => item.id === current?.connectionId);
          return {
            present: current?.kind === 'query' && !!connection,
            connection,
            blocked: !!state.dirtyTabs[tab.id],
            connectionId: current?.connectionId ?? '',
            connectionVersion: state.connectionVersions[tab.connectionId] ?? 0,
            sessionId: session.current?.id ?? '',
            draft: current?.sql,
            title: current?.title,
            database: current?.database,
            databaseContext: current?.databaseContext,
          };
        },
        (listener) => useWorkspace.subscribe(listener),
        () => alive.current,
        () => closeRef.current === request,
      );
    let job: ReturnType<typeof acquireWorkspaceBusy> | undefined;
    try {
      job = acquireWorkspaceBusy(tab.id);
      const content = {
        name,
        connectionId: tab.connectionId,
        context: { state: 'known' as const, database: originalScope.database },
        sql: original,
      };
      const result =
        action === 'update'
          ? await invoke('queries.updateSource', { source: snapshot.sourceBinding!, content })
          : await invoke('queries.create', content);
      const current =
        same(originalScope) &&
        currentTab() === originalTab &&
        instance.getModel() === model &&
        !model.isDisposed() &&
        model.getVersionId() === modelVersion &&
        (!intent || intent.isCurrent()) &&
        job.owns();
      if (!current || snapshot.fileSourceBinding) {
        read().notify(text.retainedSave, true);
        if (alive.current) {
          setSave(false);
          setCloseSaving(false);
        }
        if (request) onCloseRequestFinished?.(request, false);
        return;
      }
      intent?.adoptTitle(result.name);
      const patch = { title: result.name, sourceBinding: result.source };
      const update = () => read().updateTab(tab.id, patch);
      if (request?.mutate) request.mutate(originalTab, patch, update);
      else update();
      setSave(false);
      setCloseSaving(false);
      const updated = currentTab();
      let restored = true;
      await flushSettings().catch((reason) => {
        restored = false;
        read().notify(text.retainedSave + ' ' + errorMessage(reason), true);
      });
      if (request && closeRef.current === request) {
        const close = restored && currentTab() === updated && !!intent?.isCurrent() && job.owns();
        job.release();
        onCloseRequestFinished?.(request, close);
      }
    } catch (reason) {
      request?.failed?.();
      throw reason;
    } finally {
      job?.release();
      intent?.dispose();
    }
  }
  function finishClose(close: boolean, keep = false) {
    const request = closeRef.current,
      current = currentTab();
    if (!request || !current || phase.current || files.isBusy()) return;
    if (keep && source() !== (current.sql ?? '')) return;
    onCloseRequestFinished?.(request, close, keep ? current : undefined);
  }
  async function saveClose() {
    if (!closeRef.current) return;
    if (tab.fileSourceBinding) {
      const request = closeRef.current,
        receipt = await files.save(undefined, request, () => closeRef.current === request);
      onCloseRequestFinished?.(request, receipt.restored && receipt.busyUnchanged);
    } else {
      setCloseSaving(true);
      setSave(true);
    }
  }
  useEffect(() => {
    const token = {};
    life.current = token;
    alive.current = true;
    return () => {
      alive.current = false;
      clearFailureSource(); parameters.current?.failureSource?.dispose();
      parameterReuse.current?.dispose(); parameterReuse.current = null;
      duplicateIntent.current?.dispose();
      snippetTarget.current?.dispose();
      snapshotOperation.current?.invalidate();
      const pending = phase.current,
        owned = session.current;
      if (pending?.life === token) stop();
      void (async () => {
        if (pending?.life === token && pending.work) await pending.work;
        const current = session.current ?? owned;
        if (current) {
          await invoke('sessions.close', { sessionId: current.id });
          if (session.current === current) session.current = undefined;
        }
      })().catch((reason) => useWorkspace.getState().notify(text.closeFailed + errorMessage(reason), true));
    };
  }, []);
  useEffect(
    () =>
      useWorkspace.subscribe((next, previous) => {
        parameterReuse.current?.observe();
        const beforeTab = previous.settings.tabs.find((item) => item.id === tab.id);
        const afterTab = next.settings.tabs.find((item) => item.id === tab.id);
        const changed =
          next.connections.find((p) => p.id === tab.connectionId) !==
            previous.connections.find((p) => p.id === tab.connectionId) ||
          next.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] ||
          beforeTab?.database !== afterTab?.database ||
          beforeTab?.connectionId !== afterTab?.connectionId;
        const left = next.settings.activeTabId !== tab.id;
        if (phase.current && (changed || (left && !phase.current.sent))) phase.current.valid = false;
        if (changed || left) resultSelection.invalidate();
        if (changed) {
          clearFailureSource();
          resetResultView();
          publishPinState({ items: [], sequence: 0 });
          setOutcome(undefined);
          setSelected(0);
        }
        if (changed || left) setPinSql(undefined);
        if (changed || left) snapshotOperation.current?.invalidate();
        if ((changed || left) && sortDraftRef.current) closeResultSort(sortDraftRef.current);
        if ((changed || left) && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
        if ((changed || left) && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
        if ((changed || left) && statisticsDraftRef.current) closeResultStatistics(statisticsDraftRef.current);
        if ((changed || left) && presetDraftRef.current) closeResultPresets(presetDraftRef.current);
        if ((changed || left) && comparisonDraftRef.current) closeResultComparison(comparisonDraftRef.current);
        const parameter = parameters.current;
        if (parameter && (changed || left)) {
          parameter.failureSource?.dispose();
          parameter.valid = false;
          setParameterOwner((current) => (current === parameter ? undefined : current));
        }
        if (analyzeRef.current && (changed || left || beforeTab?.sql !== afterTab?.sql)) clearAnalyze();
      }),
    [tab.id, tab.connectionId],
  );
  useEffect(() => {
    if (closeRequest && analyzeRef.current) clearAnalyze();
    if (closeRequest) setFullExport(undefined);
    if (closeRequest && sortDraftRef.current) closeResultSort(sortDraftRef.current);
    if (closeRequest && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
    if (closeRequest && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
    if (closeRequest && statisticsDraftRef.current) closeResultStatistics(statisticsDraftRef.current);
    if (closeRequest && presetDraftRef.current) closeResultPresets(presetDraftRef.current);
    if (closeRequest && comparisonDraftRef.current) closeResultComparison(comparisonDraftRef.current);
    if (closeRequest) setPinSql(undefined);
    if (closeRequest) snapshotOperation.current?.invalidate();
  }, [closeRequest]);
  const pin = pinState.items.find(item => item.id === pinState.selected);
  const results = outcome?.results ?? [],
    result = pin?.result ?? results[selected],
    controlsLocked = busy || fileBusy || snapshotBusy || !!save || !!parameterOwner || !!analyze || !!closeRequest || !!exportView || !!pinSql,
    operationLocked = controlsLocked || !!sortDraft || !!filterDraft || !!columnDraft || !!statisticsDraft || !!presetDraft || !!comparisonDraft,
    locked = operationLocked || !!snippets || !!fullExport;
  // 名称属于服务器已返回的语句，编辑草稿时仍显示原结果的名称。
  const resultNames = useMemo(() => outcome?.results.map(result => result.columns.length
    ? queryResultTitle(result.statement, 'postgresql') : undefined) ?? [], [outcome]);
  const insertionLocked = useRef(locked);
  const snippetInsertionLocked = useRef(operationLocked);
  const fileOperation = useRef(files.isBusy);
  useLayoutEffect(() => {
    insertionLocked.current = locked;
    snippetInsertionLocked.current = operationLocked;
    fileOperation.current = files.isBusy;
    historyInsertion.current?.current();
    snippetTarget.current?.current();
    if (locked) duplicateIntent.current?.dispose();
  });
  /** 片段模态只放行自身的插入；会话、正文、选区、关闭和其它操作仍沿原意图保护。 */
  function captureInsertion(instance: monaco.editor.IStandaloneCodeEditor, ownSnippet = false) {
    flushEditorContent(instance);
    return captureHistoryInsertion(instance, () => {
      const current = useWorkspace.getState();
      const draft = current.settings.tabs.find(item => item.id === tab.id);
      return {
        tab: draft, activeTabId: current.settings.activeTabId,
        connection: current.connections.find(item => item.id === draft?.connectionId),
        connectionVersion: current.connectionVersions[draft?.connectionId ?? ''] ?? 0,
        selection: current.selection, session: session.current?.id ?? '', execution: phase.current?.taskId ?? '',
        alive: alive.current && editor.current === instance,
        busy: (ownSnippet ? snippetInsertionLocked.current : insertionLocked.current) || !!phase.current ||
          !!current.activeJobs[tab.id] || fileOperation.current(), closing: !!closeRef.current,
      };
    }, listener => useWorkspace.subscribe(listener));
  }
  /** 进入历史或保存查询搜索时才捕获原选区。后续执行、切源、关闭或模型变化会撤销插入资格。 */
  useEffect(() => {
    if (!historyInsertionRegistry) return;
    const unregister = historyInsertionRegistry.register(tab.id, () => {
      historyInsertion.current?.dispose();
      const instance = editor.current;
      if (!instance) return null;
      historyInsertion.current = captureInsertion(instance);
      return historyInsertion.current;
    });
    return () => {
      unregister();
      historyInsertion.current?.dispose();
      historyInsertion.current = null;
    };
  }, [historyInsertionRegistry, tab.id]);
  const resultSource = pin?.result ?? (!outcome?.analysis && !outcome?.explain && result?.columns.length ? result : undefined);
  const resultContext = [pin ?? outcome, pin ? undefined : selected, profile, version, scope.database];
  const snapshotIdentity = [tab, pinState, ...resultContext, resultSource];
  useLayoutEffect(() => { snapshotOperation.current?.observe(snapshotIdentity); });
  const currentLayout = columnLayout?.source === resultSource ? columnLayout : undefined;
  const layout = currentLayout?.layout;
  const visibleColumns = currentLayout?.columns ?? resultSource?.columns;
  const frozenKeys = useMemo(() => resultSource && layout ? frozenQueryResultKeys(resultSource.columns, layout) : undefined,
    [resultSource, layout]);
  const filterBinding = resultFilter.bind(resultSource, resultContext, visibleColumns);
  const filterView = resultFilter.view(filterBinding);
  const sortBinding = resultSorter.bind(filterView?.result ?? resultSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
  const historyBinding = resultHistory.bind(resultSource, visibleColumns ?? [], resultContext,
    filterView && sortView ? { expression: filterView.expression, sort: sortView.rules } : undefined, filterBinding);
  const displayResult = sortView?.result ?? filterView?.result ?? result;
  const dataResult = !busy && resultSource ? displayResult : undefined;
  const binding = resultSelection.bind(workspace.settings.activeTabId === tab.id ? dataResult : undefined,
    resultContext, visibleColumns);
  const selectedCount = resultSelection.count(binding);
  // 显示行已筛选和排序，完整列仍来自该结果的原始元数据。
  const detailBinding = rowDetails.bind(!locked ? binding?.result : undefined, [binding]);
  const currentRowDetail = rowDetail && rowDetails.valid(rowDetail) ? rowDetail : undefined;
  useEffect(() => {
    // 切换来源后释放旧快照，旧行号不会沿用到新结果。
    setRowDetail(old => old?.binding === detailBinding ? old : undefined);
    setActiveDetailRow(old => old?.binding === detailBinding ? old : undefined);
  }, [detailBinding]);

  /** 当前标签、连接和事务操作仍归原工作区，排序不借用数据库会话。 */
  function resultScopeCurrent() {
    const current = useWorkspace.getState();
    return alive.current && !controlsLocked && !closeRef.current && !exportOpen.current && !phase.current &&
      !snapshotOperation.current && !current.activeJobs[tab.id] &&
      current.settings.activeTabId === tab.id && same(scope);
  }

  /** 选择归属于当前显示顺序及工作区代次，旧网格回调不能读取后来切换的行。 */
  function resultCurrent() {
    return resultScopeCurrent() && !sortDraftRef.current && !filterDraftRef.current && !columnDraftRef.current &&
      !statisticsDraftRef.current && !presetDraftRef.current && !comparisonDraftRef.current && resultSelection.current(binding);
  }

  /** 切换结果来源时同步撤销旧布局、整理历史和网格回执。 */
  function resetResultView() {
    organization.filter.invalidate();
    organization.sorter.invalidate();
    resultSelection.invalidate();
    resultHistory.invalidate();
    setColumnLayout(undefined);
  }

  /** 同步替换快照列表与选中项，旧按钮不能覆盖后续快照。 */
  function publishPinState(next: PinState) {
    pinStateRef.current = next;
    setPinState(next);
  }

  /** 文件回包只归原标签及作业，打开时校验 PostgreSQL 格式和固定快照容量。 */
  function beginResultSnapshot(mode: 'open' | 'save'): QueryResultSnapshotOperation {
    if (!pinNavigationCurrent() || currentTab() !== tab) throw Error(snapshotText.unavailable);
    if (mode === 'save' && !resultSource?.columns.length) throw Error(zh.query.pinRequiresRows);
    if (mode === 'open' && pinState.items.length >= pinLimits.count) throw Error(zh.query.pinCountLimit);
    const job = acquireWorkspaceBusy(tab.id);
    const intent: QueryResultSnapshotIntent = new QueryResultSnapshotIntent(snapshotIdentity, () =>
      snapshotOperation.current === intent && same(scope) && currentTab() === tab &&
      useWorkspace.getState().settings.activeTabId === tab.id && !closeRef.current && job.owns() &&
      pinStateRef.current === pinState && !document.querySelector(appModalSelector));
    snapshotOperation.current = intent;
    setSnapshotBusy(true);
    let finished = false;
    const notify = (message: string) => useWorkspace.getState().notify(message, true);
    return {
      result: resultSource,
      current: () => intent.current(),
      invalidate: () => intent.invalidate(),
      /** 完成方言和容量检查后一次性加入固定列表。 */
      adopt(snapshot, name) {
        if (!intent.current()) throw Error(snapshotText.stale);
        if (snapshot.version !== 3) throw Error(snapshotText.postgresRequired);
        const sequence = pinState.sequence + 1;
        const label = `${formatText(zh.query.pinLabel, sequence)} · ${snapshot.name || name}`;
        const next = snapshotQueryResult(pinState.items, snapshot.result, uid(), label);
        intent.consume();
        resetResultView();
        publishPinState({ items: [...pinState.items, next], selected: next.id, sequence });
      },
      uncertain: notify,
      reportError: notify,
      /** 即使窗口撤销回包，也要等待原文件操作完成后才释放作业。 */
      finish() {
        if (finished) return;
        finished = true;
        intent.invalidate();
        if (snapshotOperation.current === intent) {
          snapshotOperation.current = undefined;
          if (alive.current) setSnapshotBusy(false);
        }
        job.release();
      },
    };
  }

  /** 快照切换和释放也可在没有本次行结果时使用，仍核对当前标签和操作窗口。 */
  function pinNavigationCurrent() {
    return pinStateRef.current === pinState && !locked && available();
  }

  /** 克隆原始完整结果，保留原列、原行和附带 SQL。 */
  function pinResult() {
    if (pin || !resultSource || !pinNavigationCurrent() || !resultCurrent()) return;
    try {
      const sequence = pinState.sequence + 1;
      const base = formatText(zh.query.pinLabel, sequence), name = resultNames[selected];
      const label = name ? formatText(zh.query.namedResultLabel, base, name) : base;
      const next = snapshotQueryResult(pinState.items, resultSource, uid(), label);
      resetResultView();
      publishPinState({ items: [...pinState.items, next], selected: next.id, sequence });
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 来源切换后，新网格从原返回顺序开始整理。 */
  function selectPinnedResult(next?: PinnedQueryResult) {
    if (!pinNavigationCurrent() || next && !pinState.items.includes(next) || pin === next) return;
    resetResultView();
    publishPinState({ ...pinState, selected: next?.id });
  }

  /** 释放当前快照时返回本次结果，释放其它快照保留当前结果视图。 */
  function releasePinnedResult(item: PinnedQueryResult) {
    if (!pinNavigationCurrent() || !pinState.items.includes(item)) return;
    if (pin === item) resetResultView();
    publishPinState({ ...pinState, items: pinState.items.filter(entry => entry !== item),
      selected: pin === item ? undefined : pinState.selected });
  }

  /** 只展示当前固定结果所附带的原 SQL。 */
  function openPinnedSql() {
    if (pin?.result.statement.trim() && pinNavigationCurrent() && resultCurrent()) setPinSql(pin);
  }

  /** 旧预览的关闭回调仅能释放自身。 */
  function closePinnedSql(item: PinnedQueryResult) {
    setPinSql(current => current === item ? undefined : current);
  }

  /** 对比只使用当前标签的固定快照，即使本次查询没有行结果也可打开。 */
  function openResultComparison() {
    if (!pinNavigationCurrent() || pinState.items.length < 2) return;
    const draft = { pins: pinState.items, owner: uid() };
    comparisonDraftRef.current = draft;
    setComparisonDraft(draft);
  }

  /** 每批核对当前标签、固定列表和本窗口，逐行校验由对比器完成。 */
  function comparisonCurrent(draft: ComparisonDraft) {
    if (!resultScopeCurrent() || comparisonDraftRef.current !== draft || pinStateRef.current.items !== draft.pins) return false;
    const owned = document.querySelector(`[data-query-result-comparison-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只撤销准确的对比窗口，取消当前扫描由共享组件负责。 */
  function closeResultComparison(draft: ComparisonDraft) {
    if (comparisonDraftRef.current !== draft) return;
    comparisonDraftRef.current = undefined;
    setComparisonDraft(undefined);
  }

  /** 行详情沿用当前网格的来源校验，另排除遮挡网格的模态窗口。 */
  function rowDetailCurrent(source: QueryRowDetailsBinding | undefined) {
    return resultCurrent() && rowDetails.current(source) && !document.querySelector(appModalSelector);
  }

  /** 同坐标重新点击也采集当前单元格，旧投影的行索引不能重用。 */
  function selectDetailRow(index: number | undefined) {
    if (!detailBinding || !rowDetailCurrent(detailBinding)) return;
    setActiveDetailRow(old => index === undefined ? undefined :
      old?.binding === detailBinding && old.index === index ? old : { binding: detailBinding, index });
  }

  /** 打开准确活动行，保留完整原值。 */
  function openRowDetail() {
    if (!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailCurrent(detailBinding)) return;
    try { setRowDetail(rowDetails.open(detailBinding, activeDetailRow.index)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 侧栏翻行只访问当前显示行，旧侧栏回调必须通过同一视图校验。 */
  function moveRowDetail(view: QueryRowDetailsView, index: number) {
    if (!rowDetailCurrent(view.binding) || !rowDetails.valid(view)) return;
    try { setRowDetail(rowDetails.move(view, index)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 关闭对应侧栏，保留网格中的活动行。 */
  function closeRowDetail(view: QueryRowDetailsView) {
    if (rowDetailCurrent(view.binding) && rowDetails.close(view)) setRowDetail(undefined);
  }

  /** 排序草稿只消费所属结果与排序视图。 */
  function sortCurrent(draft?: SortDraft) {
    return resultScopeCurrent() && !filterDraftRef.current && !columnDraftRef.current && !statisticsDraftRef.current &&
      !presetDraftRef.current && !comparisonDraftRef.current &&
      sortDraftRef.current === draft && !!sortBinding && !!sortView &&
      (!draft || draft.binding === sortBinding && draft.view === sortView) && resultSorter.view(sortBinding) === sortView;
  }

  /** 筛选与排序原视图必须同时有效，迟到草稿不能覆盖另一结果集。 */
  function filterCurrent(draft?: FilterDraft) {
    return resultScopeCurrent() && !sortDraftRef.current && !columnDraftRef.current && !statisticsDraftRef.current &&
      !presetDraftRef.current && !comparisonDraftRef.current &&
      filterDraftRef.current === draft &&
      !!filterBinding && !!filterView && !!sortView &&
      (!draft || draft.binding === filterBinding && draft.view === filterView && draft.sortView === sortView) &&
      resultFilter.view(filterBinding) === filterView && resultSorter.view(sortBinding) === sortView;
  }

  /** 普通入口和快捷入口都打开同一草稿，追加条件与当前生效表达式分开保存。 */
  function openResultFilter(node?: QueryResultFilterRule | QueryResultFilterGroup) {
    if (!filterBinding || !filterView || !sortView || !filterCurrent() ||
        document.querySelector(appModalSelector)) return;
    const seed = node && appendQueryResultFilterNode(filterView.expression, node);
    beginResultFilter({ binding: filterBinding, view: filterView, sortView, seed });
  }

  /** 提交已经校验的草稿，统计窗口也沿用同一个筛选应用入口。 */
  function beginResultFilter(draft: FilterDraft) {
    filterDraftRef.current = draft;
    setFilterDraft(draft);
  }

  /** 重新核对当前可见列和显示行，从原格填入等值或排除条件。 */
  function openCellFilter(cell: QueryResultCopyCell, operator: CellFilterOperator) {
    if (!resultCurrent() || !binding) return;
    try {
      const capture = captureQueryResultCellFilter(binding.visibleColumns, binding.rows, cell, undefined, 'postgresql');
      openResultFilter(queryResultCellFilterNode(capture, operator));
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 只接受当前网格与导出选择共同认可的勾选位置，以活动列原值构造审核草稿。 */
  function openSelectedFilter(capture: QueryResultSelectedFilterCapture) {
    if (!resultCurrent() || !binding || !resultSelection.matchesIndices(binding, capture.indices) ||
        !currentQueryResultSelectedFilter(capture, binding.visibleColumns, binding.rows)) return;
    try { openResultFilter(queryResultSelectedFilterNode(capture)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 统计以父网格接纳的行索引为准，锁定已显示行和准确可见列。 */
  function openResultStatistics(column: ResultColumn, indices: ReadonlySet<number>) {
    if (!binding || !resultCurrent() || !binding.visibleColumns.includes(column) ||
        document.querySelector(appModalSelector)) return;
    const selected = Array.from(Set.prototype.values.call(indices) as IterableIterator<number>).sort((a, b) => a - b);
    if (selected.length ? !resultSelection.matchesIndices(binding, selected) : resultSelection.count(binding) !== 0) return;
    const draft = { binding, column, indices: new Set(selected), owner: uid() };
    statisticsDraftRef.current = draft;
    setStatisticsDraft(draft);
  }

  /** 扫描批次仅核对工作区和本窗口身份，完整原值校验交由共享扫描器完成。 */
  function statisticsCurrent(draft: StatisticsDraft) {
    if (!resultScopeCurrent() || statisticsDraftRef.current !== draft || binding !== draft.binding) return false;
    const owned = document.querySelector(`[data-query-result-statistics-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只关闭对应统计窗口。 */
  function closeResultStatistics(draft: StatisticsDraft) {
    if (statisticsDraftRef.current !== draft) return;
    statisticsDraftRef.current = undefined;
    setStatisticsDraft(undefined);
  }

  /** 先验证追加条件，再从分布图交接到同一结果的筛选草稿。 */
  function filterFromStatistics(draft: StatisticsDraft, node: QueryResultFilterRule | QueryResultFilterGroup) {
    if (!statisticsCurrent(draft) || !resultSelection.current(draft.binding) || !filterBinding || !filterView ||
        !sortView || resultFilter.view(filterBinding) !== filterView || resultSorter.view(sortBinding) !== sortView)
      throw Error(statisticsText.stale);
    const seed = appendQueryResultFilterNode(filterView.expression, node);
    closeResultStatistics(draft);
    beginResultFilter({ binding: filterBinding, view: filterView, sortView, seed });
  }

  /** 只关闭自己打开的草稿。 */
  function closeResultFilter(draft: FilterDraft) {
    if (filterDraftRef.current !== draft) return;
    filterDraftRef.current = undefined;
    setFilterDraft(undefined);
    setFilterError('');
  }

  /** 在独立控制器上完整试算筛选和原排序，任何失败都保留现有视图。 */
  function applyResultFilter(expression: QueryResultFilterGroup, draft?: FilterDraft) {
    if (!resultSource || !visibleColumns || !sortView || !filterCurrent(draft)) return;
    try {
      const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns,
        { expression, sort: sortView.rules }, 'postgresql');
      if (historyBinding) resultHistory.record(historyBinding, {
        expression: next.filter.view(next.filterBinding)!.expression,
        sort: next.sorter.view(next.sortBinding)!.rules,
      }, next.filterBinding);
      publishResultOrganization(next);
      if (draft) closeResultFilter(draft);
    } catch (reason) {
      if (draft) setFilterError(errorMessage(reason));
      else setError(errorMessage(reason));
    }
  }

  /** 发布已验证的筛选和排序，原勾选、查找及行详情由新的网格绑定重置。 */
  function publishResultOrganization(next: ReturnType<typeof prepareQueryResultOrganization>) {
    resultFilter.invalidate();
    resultSorter.invalidate();
    organization.filter = next.filter;
    organization.sorter = next.sorter;
    resultSelection.invalidate();
    setError('');
    refreshResult(value => value + 1);
  }

  /** 验证历史目标能完整恢复后才移动游标，避免失败丢失重做。 */
  function travelResultHistory(direction: -1 | 1) {
    if (!resultSource || !visibleColumns || !resultCurrent() || document.querySelector(appModalSelector)) return;
    const ticket = resultHistory.target(historyBinding, direction);
    if (!ticket) return;
    try {
      const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns, ticket.configuration, 'postgresql');
      resultHistory.commit(ticket, next.filterBinding);
      publishResultOrganization(next);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 打开时捕获当前条件、排序、字段身份和冻结边界，沿用原本机方案存储。 */
  function openResultPresets() {
    if (!binding || !resultSource || !visibleColumns || !filterView || !sortView || !historyBinding ||
        !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const value = queryResultPresetValueSchema.parse(captureQueryResultMemory(resultSource, visibleColumns,
        { expression: filterView.expression, sort: sortView.rules }, layout?.frozenThrough, 'postgresql'));
      const draft = { binding, value, owner: uid() };
      presetDraftRef.current = draft;
      setPresetDraft(draft);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 异步读写前后均核对原结果、连接和模态归属，旧回包不能应用到其它结果。 */
  function presetCurrent(draft: PresetDraft) {
    if (!resultScopeCurrent() || presetDraftRef.current !== draft || !resultSelection.current(draft.binding)) return false;
    const owned = document.querySelector(`[data-query-result-presets-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只关闭本代窗口，迟到的关闭不能撤销后来打开的方案。 */
  function closeResultPresets(draft: PresetDraft) {
    if (presetDraftRef.current !== draft) return;
    presetDraftRef.current = undefined;
    setPresetDraft(undefined);
  }

  /** 保存的配置须匹配完整列及可见顺序；完整试算成功才发布，并记录一整步撤销。 */
  function applyResultPreset(draft: PresetDraft, value: QueryResultPresetValue) {
    if (!resultSource || !visibleColumns || !historyBinding || !presetCurrent(draft)) throw Error(presetsText.stale);
    if (!queryResultMemoryMatches(value, resultSource, visibleColumns)) throw Error(presetsText.mismatch);
    const keys = resultSource.columns.map(column => column.key);
    const nextLayout = setQueryResultFrozenThrough(layout ?? { order: keys, visible: keys }, value.frozenThrough);
    const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns, value.configuration, 'postgresql');
    resultHistory.record(historyBinding, {
      expression: next.filter.view(next.filterBinding)!.expression,
      sort: next.sorter.view(next.sortBinding)!.rules,
    }, next.filterBinding);
    setColumnLayout({ source: resultSource, layout: nextLayout, columns: visibleColumns });
    closeResultPresets(draft);
    publishResultOrganization(next);
  }

  /** 只关闭准确的草稿，旧面板不能关闭后来打开的排序。 */
  function closeResultSort(draft: SortDraft) {
    if (sortDraftRef.current !== draft) return;
    sortDraftRef.current = undefined;
    setSortDraft(undefined);
  }

  /** 单列与多列共用同一投影，成功后撤销旧行位置并重建导出选择。 */
  function applyResultSort(rules: QueryResultSortRule[], draft?: SortDraft) {
    if (!sortBinding || !sortView || !sortCurrent(draft)) return false;
    try {
      const sorted = resultSorter.apply(sortBinding, sortView, rules);
      if (historyBinding && filterView) resultHistory.record(historyBinding, { expression: filterView.expression, sort: sorted.rules });
      resultSelection.invalidate();
      if (draft) closeResultSort(draft);
      refreshResult(value => value + 1);
      return true;
    } catch (reason) {
      if (draft) throw reason;
      setError(errorMessage(reason));
      return false;
    }
  }

  /** 列管理从当前已返回的显示行取样，以原列键维护所有列的草稿。 */
  function openResultColumns() {
    if (!binding || !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const keys = queryResultColumnKeys(binding.columns);
      const draft = { binding, owner: uid(), initial: layout ?? { order: keys, visible: keys } };
      columnDraftRef.current = draft;
      setColumnDraft(draft);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 应用时只允许本草稿的窗口存在，并再次核对结果及连接归属。 */
  function columnCurrent(draft: ColumnDraft) {
    if (!resultScopeCurrent() || columnDraftRef.current !== draft || !resultSelection.current(draft.binding)) return false;
    const owned = document.querySelector(`[data-query-columns-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 关闭时撤销旧网格回执，迟到的草稿事件不能修改后续结果。 */
  function closeResultColumns(draft: ColumnDraft) {
    if (columnDraftRef.current !== draft) return;
    columnDraftRef.current = undefined;
    resultSelection.invalidate();
    setColumnDraft(undefined);
  }

  /** 在新列投影上验证原筛选和排序，全部通过才切换视图。 */
  function applyResultColumns(draft: ColumnDraft, nextLayout: QueryResultColumnLayout) {
    if (!resultSource || !visibleColumns || !filterView || !sortView || !columnCurrent(draft)) return;
    const projected = queryResultVisibleColumns(resultSource.columns, nextLayout);
    const changed = projected.length !== visibleColumns.length || projected.some((column, index) => column !== visibleColumns[index]);
    if (changed) {
      const keys = new Set(projected.map(column => column.key));
      if ([...filterView.rules, ...sortView.rules].some(rule => !keys.has(rule.column))) throw Error(columnText.activeRule);
      const next = prepareQueryResultOrganization(resultSource, resultContext, projected,
        { expression: filterView.expression, sort: sortView.rules }, 'postgresql');
      resultHistory.invalidate();
      resultFilter.invalidate();
      resultSorter.invalidate();
      organization.filter = next.filter;
      organization.sorter = next.sorter;
    }
    setColumnLayout({ source: resultSource, layout: nextLayout, columns: changed ? projected : visibleColumns });
    closeResultColumns(draft);
  }

  /** 网格拖动只更新当前可见列的宽度，沿用行、列投影及其它显示配置。 */
  function resizeResultColumns(sizes: ColumnWidths) {
    if (!resultSource || !visibleColumns || !resultCurrent()) return;
    const widths = new Map(layout?.widths);
    let changed = false;
    for (const { key } of visibleColumns) {
      const size = sizes.get(key);
      if (size?.type !== 'resized' || !Number.isFinite(size.width)) continue;
      const width = Math.max(queryResultColumnWidth.min, Math.min(queryResultColumnWidth.max, Math.round(size.width)));
      if (widths.get(key) === width) continue;
      widths.set(key, width);
      changed = true;
    }
    if (!changed) return;
    const keys = resultSource.columns.map(column => column.key);
    setColumnLayout({ source: resultSource, columns: visibleColumns,
      layout: { ...(layout ?? { order: keys, visible: keys }), widths } });
  }

  /** 仅接收当前网格送出的行位置；校验失败后旧勾选失效。 */
  function acceptResultSelection(selection: ResultGridSelection) {
    if (!resultCurrent()) return false;
    try {
      if (!resultSelection.select(binding, selection)) return false;
      refreshResult(value => value + 1);
      return true;
    } catch (reason) {
      resultSelection.invalidate();
      setError(errorMessage(reason));
      return false;
    }
  }

  /** 打开时冻结导出内容，不通过会话、SQL 或数据库连接再次读取。 */
  function openResultExport(selectedOnly: boolean) {
    if (!resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const snapshot = selectedOnly ? resultSelection.snapshot(binding) : resultSelection.allSnapshot(binding);
      exportOpen.current = true;
      setExportView({ result: snapshot, selected: selectedOnly });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 仅消费当前结果代次已接纳的勾选，不读取连接或再次执行原 SQL。 */
  function captureResultTransfer() {
    if (pin || !binding || !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const snapshot = capturePostgresQueryTransfer({
        connectionId: tab.connectionId, label: profile?.name ?? tab.connectionId, database: scope.database,
        title: tab.title, result: selected + 1,
      }, resultSelection.snapshot(binding), binding.visibleColumns);
      usePostgresRecordTransfer.setState({ snapshot });
      workspace.notify(transferText.queryCapturedToNetwork(snapshot.rows.length));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 菜单、快捷键和工具栏只操作活动标签中已同步且可编辑的原模型。 */
  function commandEditor() {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model || model.isDisposed() || !available() || files.isBusy() || instance.getRawOptions().readOnly) return;
    const draft = currentTab()?.sql ?? '';
    if (model.getValue() === draft.replace(/\r\n|\r|\n/g, model.getEOL())) {
      // 显式编辑命令先恢复原编辑区，不卸载模型或让定位动作落在隐藏控件。
      if (resultsOnly) flushSync(() => setResultsOnly(false));
      return { instance, model };
    }
  }
  /** 布局只通过既有租约合并当前标签字段，不持有或回写旧SQL快照。 */
  function beginEditorLayout(cancel: () => void, dimension: 'height' | 'width' = 'height') {
    return beginWorkspaceQueryLayout(tab, version, () => alive.current && !closeRef.current && !phase.current && !insertionLocked.current, cancel, dimension);
  }
  function changeResultLayout(value: string) {
    if (!available()) return;
    if (value === 'results') { setResultsOnly(true); return; }
    if (value !== 'below' && value !== 'beside') return;
    setResultsOnly(false);
    if (preferredPlacement !== value) useWorkspace.getState().updateTab(tab.id, {queryResultPlacement: value});
  }
  async function editorAction(actionId: string, explicitSelection = false) {
    const target = commandEditor();
    if (!target || explicitSelection && !hasExplicitCaseSelection(target.instance)) return;
    const action = target.instance.getAction(actionId);
    if (!action?.isSupported()) return;
    target.instance.focus();
    await action.run();
  }
  function formatQuery() {
    const target = commandEditor();
    if (!target) return;
    const { instance, model } = target;
    try {
      const sql = model.getValue();
      if (sql.length > 65536) throw Error(text.formatTooLarge);
      const formatted = format(sql, { language: 'postgresql' });
      if (formatted === sql) return;
      instance.pushUndoStop();
      instance.executeEdits('postgres-format', [{ range: model.getFullModelRange(), text: formatted }]);
      instance.pushUndoStop();
      instance.focus();
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function openSaveQuery() {
    if (commandEditor()) setSave(true);
  }
  /** 捕获要重新执行的正文及其目标。选择文件期间不会读取后来编辑的草稿。 */
  function openFullExport() {
    const target = commandEditor(), draft = currentTab();
    if (!target || !draft) return;
    const selections = target.instance.getSelections();
    const selection = selections?.[0];
    const sql = selection?.isEmpty() ? target.model.getValue() : selection && target.model.getValueInRange(selection);
    if (selections?.length !== 1 || !sql?.trim()) { setError(fullExportText.singleSource); return; }
    const version = target.model.getVersionId();
    setFullExport({tabId: draft.id, connectionId: draft.connectionId, database: scope.database, sql,
      current: () => same(scope) && currentTab() === draft && useWorkspace.getState().settings.activeTabId === draft.id &&
        !closeRef.current && target.instance.getModel() === target.model && !target.model.isDisposed() && target.model.getVersionId() === version});
  }
  /** 打开片段库时捕获原选区；预览编辑器和本地保存不能接管查询模型。 */
  function openSnippets(create = false, instance = editor.current) {
    const target = commandEditor();
    if (!target || target.instance !== instance) return;
    const ranges = instance.getSelections();
    if (ranges?.length !== 1) { setError(zh.snippets.singleTarget); return; }
    const range = ranges[0], length = target.model.getValueLengthInRange(range);
    if (create && range.isEmpty()) return;
    if (create && length > SNIPPET_LIMITS.sql) { setError(zh.snippets.selectionTooLong); return; }
    const selected = length <= SNIPPET_LIMITS.sql ? target.model.getValueInRange(range) : '';
    if (create && !selected.trim()) { setError(zh.snippets.selectionBlank); return; }
    const initialSql = selected || (target.model.getValueLength() <= SNIPPET_LIMITS.sql ? target.model.getValue() : '');
    snippetTarget.current?.dispose();
    snippetTarget.current = captureInsertion(instance, true);
    if (snippetTarget.current) setSnippets({ initialSql, create });
  }
  function closeSnippets() {
    snippetTarget.current?.dispose();
    snippetTarget.current = null;
    setSnippets(undefined);
  }
  /** 只消费捕获的原选区，沿既有正文桥与单一撤销组插入纯文本，不执行SQL。 */
  function insertSnippet(sql: string) {
    const instance = editor.current, target = snippetTarget.current;
    if (!instance || !target?.current()) throw Error(zh.snippets.insertChanged);
    target.insert(sql);
    closeSnippets();
    window.setTimeout(() => {
      if (alive.current && editor.current === instance && useWorkspace.getState().settings.activeTabId === tab.id) instance.focus();
    }, 0);
  }
  /** 复制只读取原草稿和固定数据库上下文，沿既有意图保护新建未绑定的独立查询。 */
  async function duplicateQuery() {
    if (duplicateIntent.current || !commandEditor()) return;
    let intent: QueryDuplicateIntent | undefined;
    try {
      intent = new QueryDuplicateIntent({
        editor: () => editor.current,
        flush: flushEditorContent,
        scope: () => {
          const workspace = useWorkspace.getState();
          const current = workspace.settings.tabs.find(item => item.id === tab.id);
          const connection = workspace.connections.find(item => item.id === current?.connectionId);
          const origin = duplicateOrigin.current;
          return {
            tab: current, connection, connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0,
            sessionId: session.current?.id ?? '',
            present: alive.current && current?.kind === 'query' && connection?.dialect === 'postgresql' &&
              current.connectionId === origin.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === origin.version,
            active: workspace.settings.activeTabId === tab.id,
            blocked: insertionLocked.current || !!phase.current || !!workspace.activeJobs[tab.id] || !!closeRef.current ||
              fileOperation.current() || !!document.querySelector(appModalSelector),
          };
        },
        subscribe: changed => {
          const release = useWorkspace.subscribe(changed);
          const observer = new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes].some(node =>
              isAppModalNode(node) || node.nodeType === 1 && !!(node as Element).querySelector(appModalSelector))))
              intent?.dispose();
          });
          observer.observe(document.body, { childList: true, subtree: true });
          return () => { release(); observer.disconnect(); };
        },
        database: initial => {
          const connection = initial.connection;
          if (connection?.dialect !== 'postgresql') throw Error(queryDuplicateZh.changed);
          const original = session.current;
          if (initial.sessionId && (!original || original.id !== initial.sessionId || !same(original.scope)))
            throw Error(queryDuplicateZh.changed);
          return { state: 'known', database: original?.scope.database || initial.tab?.database || connection.database || 'postgres' };
        },
        open: candidate => {
          const workspace = useWorkspace.getState();
          if (workspace.settings.tabs.length >= 100) throw Error(queryDuplicateZh.tooMany);
          workspace.openTab(candidate);
        },
      });
      duplicateIntent.current = intent;
      setDuplicating(true);
      await intent.run();
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      intent?.dispose();
      if (duplicateIntent.current === intent) {
        duplicateIntent.current = undefined;
        if (alive.current) setDuplicating(false);
      }
    }
  }
  const editable = !!profile && !!editorInstance && !locked;
  const canRun = editable && state.transactionKnown;
  const canPlan = canRun && !state.transactionFailed;
  const canStop = busy && !!phase.current && !phase.current.cancelled;
  const navigation = usePostgresStatementNavigation(() => {
    const target = commandEditor(), draft = currentTab(), original = session.current;
    if (!target || !draft || locked) return;
    return { ...target, sessionId: original?.id, current: () =>
      available() && !files.isBusy() && currentTab() === draft && session.current === original &&
      editor.current === target.instance && !target.instance.getRawOptions().readOnly };
  });
  const canNavigate = editable && !navigation.busy;
  const commands: Partial<Record<UiCommandId, UiCommandHandler>> = {
    execute: { enabled: canRun, run: () => run() },
    'execute-selection': { enabled: canRun && editorSelection.single, run: () => run('selection') },
    'execute-current': { enabled: canRun, run: () => run('current') },
    'execute-all': { enabled: canRun, run: () => run('all') },
    'statement-navigation': { enabled: canNavigate, run: () => navigation.open() },
    'select-current-statement': { enabled: canNavigate, run: () => navigation.open('select') },
    'previous-statement': { enabled: canNavigate, run: () => navigation.open('previous') },
    'next-statement': { enabled: canNavigate, run: () => navigation.open('next') },
    stop: { enabled: canStop, run: stop },
    explain: { enabled: canPlan, run: () => run('explain') },
    analyze: { enabled: canPlan, run: () => run('analyzePreview') },
    parameters: { enabled: canRun, run: openParameters },
    format: { enabled: editable, run: formatQuery },
    'save-query': { enabled: editable, run: openSaveQuery },
    'sql-selection-to-snippet': { enabled: editable && editorSelection.single, run: () => openSnippets(true) },
    find: { enabled: editable, run: () => editorAction('actions.find') },
    replace: { enabled: editable, run: () => editorAction('editor.action.startFindReplaceAction') },
    'sql-goto-line': { enabled: editable, run: () => { if (!openFocusedGridRowJump()) return editorAction(sqlPositionActions['sql-goto-line']); } },
    'sql-toggle-comment': { enabled: editable, run: () => editorAction('editor.action.commentLine') },
    'sql-uppercase': { enabled: editable && editorSelection.explicit, run: () => editorAction(sqlTextActions['sql-uppercase'], true) },
    'sql-lowercase': { enabled: editable && editorSelection.explicit, run: () => editorAction(sqlTextActions['sql-lowercase'], true) },
  };
  for (const id of bracketCommands) commands[id] = { enabled: editable, run: () => editorAction(sqlPositionActions[id]) };
  for (const id of sqlLineCommandIds) commands[id] = { enabled: editable, run: () => editorAction(sqlTextActions[id]) };
  useUiCommandScope(`tab:${tab.id}`, commands, {
    active: workspace.settings.activeTabId === tab.id && !closeRequest,
    contextKey: JSON.stringify([scope.database, session.current?.id, phase.current?.taskId, state.transactionKnown, state.transactionFailed]),
  });
  useEffect(() => {
    if (!editorInstance || !editable || workspace.settings.activeTabId !== tab.id) return;
    let active = true;
    const action = editorInstance.addAction({
      id: `dbark-postgres-selection-to-snippet:${uid()}`, label: uiCommandLabels['sql-selection-to-snippet'],
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 6,
      run: () => { if (active) openSnippets(true, editorInstance); },
    });
    return () => { active = false; action.dispose(); };
  }, [editorInstance, editable, workspace.settings.activeTabId, tab.id, tab.sql, profile, version]);
  return (
    <div ref={layoutRoot} className="workspace-tab query-tab postgres-query" data-result-layout={resultLayout}>
      <div className="context-bar">
        <strong>{profile?.name}</strong>
        <span>PostgreSQL / {scope.database}</span>
        <QueryFileSourceCaption tab={tab} files={files} compact />
        <span>{session.current ? '原查询会话' : '尚未连接'}</span>
      </div>
      <QueryResultSnapshotActions result={resultSource} disabled={locked} begin={beginResultSnapshot}
        renderActions={snapshotActions => <QueryFileActions
        tab={tab}
        files={files}
        renderActions={(actions) => (
          <div className="query-toolbar postgres-toolbar">
            {actions}
            <button disabled={!canRun} onClick={() => run()}>
              {text.execute}
            </button>
            <button disabled={!canRun} onClick={() => run('current')}>
              {text.current}
            </button>
            <button disabled={!canNavigate} onClick={() => navigation.open()}>
              {navigationText.entry}
            </button>
            <button disabled={!canPlan} onClick={() => run('explain')}>
              {text.explain}
            </button>
            <button disabled={!canPlan} onClick={() => run('analyzePreview')}>
              {queryAnalyzeZh.open}
            </button>
            <button disabled={!canRun} onClick={openParameters}>
              {text.parameters}
            </button>
            <button disabled={!canStop} onClick={stop}>
              {text.stop}
            </button>
            <button disabled={!editable} onClick={formatQuery}>
              {text.format}
            </button>
            <button disabled={!editable} onClick={openSaveQuery}>
              {text.save}
            </button>
            <button disabled={!editable} onClick={openFullExport}>{fullExportText.open}</button>
            <button disabled={!editable} onClick={() => openSnippets()}>{zh.snippets.title}</button>
            <button disabled={!editable || duplicating || duplicateOrigin.current.connectionId !== tab.connectionId ||
              duplicateOrigin.current.version !== version} title={queryDuplicateZh.hint}
              onClick={() => void duplicateQuery()}>{queryDuplicateZh.action}</button>
            <button disabled={locked} onClick={onHistory}>
              {text.history}
            </button>
            <button disabled={locked || !session.current} onClick={() => void reconnect()}>
              {text.reconnect}
            </button>
            {snapshotActions}
          </div>
        )}
      />} />
      <ErrorBox message={error} />
      {outcome?.failure && <QueryPartialOutcomeNotice failure={outcome.failure} completedResults={outcome.results.length}
        locateAvailable={!pin && !!failureSource.current?.available()} onLocate={() => {
          if (!pin && failureSource.current?.available()) {
            flushSync(() => setResultsOnly(false));
            // 仅结果模式隐藏过容器，须在可见尺寸下重排后再滚到原语句。
            editor.current?.layout(); failureSource.current?.locate();
          }
        }} />}
      {!busy && completionStatus !== 'idle' && <p className="muted small" role="status">{completionStatus === 'limited'
        ? text.completionLimited : completionStatus === 'partial' ? text.completionPartial
          : completionStatus === 'sessionUnknown' ? text.completionTransaction : text.completionUnavailable}</p>}
      {busy && <Spinner text={phase.current?.sent ? text.running : text.connecting} />}
      <div className="postgres-result-actions postgres-layout-actions">
        <select aria-label={queryLayoutZh.placement} value={resultsOnly ? 'results' : preferredPlacement}
          disabled={layoutActiveTab !== tab.id || !profile || locked} onChange={event => changeResultLayout(event.target.value)}>
          <option value="below">{queryLayoutZh.below}</option><option value="beside">{queryLayoutZh.beside}</option>
          <option value="results">{queryLayoutZh.results}</option>
        </select>
        {!resultsOnly && preferredPlacement === 'beside' && !besideAvailable && <span className="muted small">{queryLayoutZh.besideNarrow}</span>}
      </div>
      <div className="query-layout-panes">
        <div className="query-layout-editor" style={resultLayout === 'beside' ? {width: editorWidth} : undefined}>
          <SavedQueryMatchNavigation tabId={tab.id} source={searchNavigation} editor={editorInstance} />
          <div id={layoutEditorId} className="postgres-editor sql-editor-wrap query-editor-region" style={resultLayout === 'below' ? {height: editorHeight} : undefined}>
            <SqlEditor
              value={tab.sql ?? ''}
              dialect="postgresql"
              snippetCompletion
              postgresStandardStrings={session.current && !busy && same(session.current.scope) ? state.standardConformingStrings : undefined}
              postgresCompletion={{ tabId: tab.id, connectionId: tab.connectionId, database: scope.database,
                connectionVersion: scope.version, sessionId: session.current?.id }}
              onCompletionStatus={setCompletionStatus}
              readOnly={busy || fileBusy || snapshotBusy || !!analyze || !!exportView || !!filterDraft || !!columnDraft || !!statisticsDraft ||
                !!presetDraft || !!pinSql || !!comparisonDraft}
              onReady={(instance) => {
                editor.current = instance;
                setEditorInstance(instance);
              }}
              onChange={(sql) => {
                if (analyzeRef.current) clearAnalyze();
                if (!phase.current) useWorkspace.getState().updateTab(tab.id, { sql });
              }}
              onExecute={() => run()}
              onExecuteCurrent={() => run('current')}
              onSelectCurrent={() => navigation.open('select')}
              onFormat={formatQuery}
              onToggleComment={() => editorAction('editor.action.commentLine')}
              onSelectionState={updateEditorSelection}
            />
            {navigation.panel && <StatementNavigationPanel {...navigation.panel} />}
          </div>
        </div>
        {resultLayout === 'below' && <QueryLayoutSplitter value={preferredEditorHeight} min={queryLayoutLimits.minEditorHeight}
          max={layoutMaximum} defaultValue={queryLayoutLimits.defaultEditorHeight} controls={layoutEditorId} scope={layoutScope}
          disabled={layoutActiveTab !== tab.id || !profile || locked} begin={beginEditorLayout} onPreview={setEditorPreview} />}
        {resultLayout === 'beside' && <QueryLayoutSplitter dimension="width" value={preferredEditorWidth} min={queryLayoutWidthLimits.minEditorWidth}
          max={widthMaximum} defaultValue={queryLayoutWidthLimits.defaultEditorWidth} controls={layoutEditorId} scope={layoutScope}
          disabled={layoutActiveTab !== tab.id || !profile || locked} begin={cancel => beginEditorLayout(cancel, 'width')} onPreview={setEditorWidthPreview} />}
        <div className="postgres-results query-layout-results">
          {!!pinState.items.length && <div className="pinned-results" role="group" aria-label={zh.query.pinSection} title={zh.query.pinSessionOnly}>
            <span>{zh.query.pinSection}</span>
            <button className={`current-results ${pin ? '' : 'selected'}`} aria-pressed={!pin} disabled={locked}
              onClick={() => selectPinnedResult()}>{zh.query.currentResults}</button>
            {pinState.items.map(item => <div key={item.id} className={`pinned-result ${pin === item ? 'selected' : ''}`}>
              <button aria-pressed={pin === item} disabled={locked} onClick={() => selectPinnedResult(item)}>{item.label}</button>
              <button aria-label={formatText(zh.query.releasePin, item.label)} title={formatText(zh.query.releasePin, item.label)}
                disabled={locked} onClick={() => releasePinnedResult(item)}>×</button>
            </div>)}
            <button disabled={locked || pinState.items.length < 2} title={pinState.items.length < 2 ? comparisonText.requireTwo : comparisonText.notice}
              onClick={openResultComparison}>{comparisonText.open}</button>
          </div>}
          {(!pin && results.length > 1 || dataResult) && (
            <div className="postgres-result-actions">
              {!pin && results.length > 1 && <select aria-label="PostgreSQL结果集" value={selected} disabled={locked}
                onChange={event => {
                  if (!pinNavigationCurrent()) return;
                  resetResultView();
                  setSelected(Number(event.target.value));
                }}>
                {results.map((r, i) => <option key={i} value={i}>{text.result(i, r.postgresCommand ?? '', r.rows.length, resultNames[i])}</option>)}
              </select>}
              {dataResult && <>
                {!pin && results.length === 1 && resultNames[selected] && <strong className="postgres-result-name">{resultNames[selected]}</strong>}
                {pin ? <button disabled={locked || !pin.result.statement.trim()} onClick={openPinnedSql}>{zh.query.pinnedStatement}</button> :
                  <button disabled={locked || !binding} title={zh.query.pinHint} onClick={pinResult}>{zh.query.pinResult}</button>}
                <button disabled={locked || !binding} onClick={openResultColumns}>{columnText.open}</button>
                <button disabled={locked || !detailBinding || activeDetailRow?.binding !== detailBinding}
                  title={detailText.choose} onClick={openRowDetail}>{detailText.open}</button>
                <button disabled={locked || !filterBinding || !filterView || !sortView}
                  onClick={() => openResultFilter()}>{filterText.open}</button>
                {!!filterView?.rules.length && <>
                  <button disabled={locked} onClick={() => applyResultFilter({ mode: 'AND', children: [] })}>{filterText.clear}</button>
                  <span role="status">{filterText.counts(resultSource!.rows.length, dataResult.rows.length)}</span>
                </>}
                <button disabled={locked || !sortView || !sortBinding?.visible.some(column => !sortBinding.reasons.get(column.key))}
                  onClick={() => {
                    if (!sortBinding || !sortView || !sortCurrent() || document.querySelector(appModalSelector)) return;
                    const draft = { binding: sortBinding, view: sortView };
                    sortDraftRef.current = draft;
                    setSortDraft(draft);
                  }}>{sortText.panelTitle}</button>
                {!!sortView?.rules.length && <button disabled={locked} onClick={() => applyResultSort([])}>{sortText.clear}</button>}
                <button disabled={locked || !binding || !resultHistory.target(historyBinding, -1)}
                  title={resultHistory.limited ? historyText.limited : historyText.postgresHint}
                  onClick={() => travelResultHistory(-1)}>{historyText.undo}</button>
                <button disabled={locked || !binding || !resultHistory.target(historyBinding, 1)} title={historyText.postgresHint}
                  onClick={() => travelResultHistory(1)}>{historyText.redo}</button>
                <button disabled={locked || !binding || !historyBinding} onClick={openResultPresets}>{presetsText.open}</button>
                <button disabled={locked || !binding} onClick={() => openResultExport(false)}>{zh.resultExport.title}</button>
                <button disabled={locked || !selectedCount} onClick={() => openResultExport(true)}>{zh.resultExport.selectedTitle}</button>
                {!pin && <button disabled={locked || !binding || !selectedCount || selectedCount > postgresTableLimits.changes ||
                  binding.visibleColumns.length > postgresTableLimits.fields} title={transferText.limits} onClick={captureResultTransfer}>
                  {transferText.queryCapture}</button>}
              </>}
            </div>
          )}
          <div className="result-body">
            {!pin && outcome?.analysis ? <QueryAnalyzeView plan={outcome.analysis} outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> :
              !pin && outcome?.explain ? <ExplainPlanView outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> : result ? (
              result.columns.length ? (
                <div className="query-result-with-details">
                  <div className="query-result-grid">
                    <ResultsGrid columns={visibleColumns ?? result.columns} rows={displayResult!.rows} rowJump selectionScope={binding}
                      frozenKeys={frozenKeys} columnWidths={layout?.widths} rowHeight={layout?.rowHeight} onColumnWidthsChange={resizeResultColumns}
                      isCurrent={binding ? resultCurrent : undefined} onSelectionChange={binding ? acceptResultSelection : undefined}
                      onActiveCellChange={cell => selectDetailRow(cell?.column ? cell.index : undefined)}
                      filterDialect="postgresql"
                      onFilterCell={filterBinding && sortView && binding ? openCellFilter : undefined}
                      onFilterSelected={filterBinding && sortView && binding ? openSelectedFilter : undefined}
                      onStatistics={binding ? openResultStatistics : undefined}
                      onHistoryTravel={binding && historyBinding ? travelResultHistory : undefined}
                      sort={sortView ? [...sortView.rules] : undefined} sortReasons={sortBinding?.reasons}
                      onSortChange={sortView ? rules => applyResultSort(rules) : undefined} />
                  </div>
                  {currentRowDetail && <QueryRowDetailsPanel controller={rowDetails} view={currentRowDetail}
                    isCurrent={() => rowDetailCurrent(currentRowDetail.binding)} onMove={moveRowDetail} onClose={closeRowDetail} />}
                </div>
              ) : (
                <div className="info-strip">
                  {text.complete(result.postgresCommand ?? '', result.affectedRows)}
                </div>
              )
            ) : (
              <Empty title={text.empty} />
            )}
          </div>
          {result?.truncated && <p className="warning-text">{text.truncated}</p>}
        </div>
      </div>
      {pinSql && <Modal title={zh.query.pinSource} wide onClose={() => closePinnedSql(pinSql)}>
        <div className="modal-content"><p>{zh.query.resultSqlHint}</p>
          <SqlEditor value={pinSql.result.statement} dialect="postgresql" height={280} readOnly />
        </div>
        <footer className="modal-footer"><span className="grow"/>
          <button onClick={() => closePinnedSql(pinSql)}>{zh.common.close}</button>
        </footer>
      </Modal>}
      {columnDraft && <QueryResultColumnsDialog key={columnDraft.owner} binding={columnDraft.binding}
        initial={columnDraft.initial} owner={columnDraft.owner}
        isCurrent={() => columnCurrent(columnDraft)} onApply={next => applyResultColumns(columnDraft, next)}
        onClose={() => closeResultColumns(columnDraft)} />}
      {statisticsDraft && <QueryResultStatisticsDialog key={statisticsDraft.owner} owner={statisticsDraft.owner}
        columns={statisticsDraft.binding.visibleColumns} rows={statisticsDraft.binding.rows} dialect="postgresql"
        initialColumn={statisticsDraft.column} selectedIndices={statisticsDraft.indices} truncated={statisticsDraft.binding.truncated}
        isCurrent={() => statisticsCurrent(statisticsDraft)} onClose={() => closeResultStatistics(statisticsDraft)}
        onFrequencyFilter={filterBinding && sortView ? node => filterFromStatistics(statisticsDraft, node) : undefined} />}
      {presetDraft && <QueryResultPresetsDialog key={presetDraft.owner} connectionId={tab.connectionId}
        value={presetDraft.value} owner={presetDraft.owner} isCurrent={() => presetCurrent(presetDraft)}
        matches={value => !!visibleColumns && queryResultMemoryMatches(value, resultSource, visibleColumns)}
        onApply={value => applyResultPreset(presetDraft, value)} onClose={() => closeResultPresets(presetDraft)} />}
      {comparisonDraft && <QueryResultComparisonDialog key={comparisonDraft.owner} owner={comparisonDraft.owner}
        pins={comparisonDraft.pins} dialect="postgresql" isCurrent={() => comparisonCurrent(comparisonDraft)}
        onClose={() => closeResultComparison(comparisonDraft)} />}
      {filterDraft && <Modal title={filterText.title} wide onClose={() => closeResultFilter(filterDraft)} onEscape={event => {
        // 先交给内层条件草稿或值选择处理，候选面板的 Esc 不关闭外层窗口。
        if (event.target instanceof Element && event.target.closest('.query-result-filter-panel')) return;
        event.stopPropagation();
        closeResultFilter(filterDraft);
      }}>
        <div className="modal-content"><QueryResultFilterPanel binding={filterDraft.binding} initial={filterDraft.view} seed={filterDraft.seed}
          isCurrent={() => filterCurrent(filterDraft)} onApply={expression => applyResultFilter(expression, filterDraft)}
          onClose={() => closeResultFilter(filterDraft)} /><ErrorBox message={filterError} /></div>
      </Modal>}
      {sortDraft && <Modal title={sortText.panelTitle} wide onClose={() => closeResultSort(sortDraft)}>
        <div className="modal-content"><QueryResultSortPanel binding={sortDraft.binding} initial={sortDraft.view}
          isCurrent={() => sortCurrent(sortDraft)} onApply={rules => applyResultSort(rules, sortDraft)}
          onClose={() => closeResultSort(sortDraft)} /></div>
      </Modal>}
      {exportView && <ResultExportDialog result={exportView.result} tabId={tab.id} selected={exportView.selected}
        sqlDialect="postgresql" onClose={() => {
          exportOpen.current = false;
          setExportView(undefined);
        }} />}
      {fullExport && !closeRequest && <PostgresQueryExportDialog source={fullExport} onClose={() => setFullExport(undefined)} />}
      <div className="tab-status">
        <span>
          {!state.transactionKnown
            ? text.unknown
            : state.transactionFailed
              ? text.failedTransaction
              : state.transactionOpen
                ? text.transaction
                : text.idle}
        </span>
        <span className="grow" />
        <button
          disabled={locked || state.transactionOpen || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'BEGIN')}
        >
          {text.begin}
        </button>
        <button
          disabled={locked || !state.transactionOpen || state.transactionFailed || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'COMMIT')}
        >
          {text.commit}
        </button>
        <button
          disabled={locked || !state.transactionOpen || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'ROLLBACK')}
        >
          {text.rollback}
        </button>
      </div>
      {analyze && !busy && !closeRequest && (
        <QueryAnalyzeConfirmDialog key={analyze.token} source={analyze.source} dialect="postgresql"
          connectionName={profile?.name ?? ''} databaseLabel={analyze.scope.database}
          onConfirm={() => run('normal', undefined, undefined, undefined, analyze)} onClose={clearAnalyze} />
      )}
      {save && (
        <QueryBindingDialog
          initialName={tab.title}
          bound={!!tab.sourceBinding}
          onSave={saveQuery}
          onClose={() => {
            setSave(false);
            setCloseSaving(false);
          }}
        />
      )}
      {closeRequest && !save && !snippets && !exportView && !filterDraft && !columnDraft && !statisticsDraft && !presetDraft && !pinSql && !comparisonDraft && (
        <QueryCloseDialog
          title={tab.title}
          onCancel={() => finishClose(false)}
          onDiscard={() => finishClose(true)}
          onKeep={() => finishClose(true, true)}
          onSave={() => void saveClose()}
        />
      )}
      {parameterOwner && (
        <QueryParametersDialog
          syntaxHint={text.parameterHint}
          source={parameterOwner.source}
          reuse={parameterOwner.reuse ?? undefined}
          loadNames={() => names(parameterOwner)}
          onExecute={(values) => run('normal', values, parameterOwner)}
          onClose={() => {
            parameterOwner.failureSource?.dispose();
            if (parameterOwner.reuse) parameterReuse.current?.close(parameterOwner.reuse);
            parameterOwner.valid = false;
            setParameterOwner(undefined);
          }}
        />
      )}
      {snippets && <SnippetsDialog dialect="postgresql" initialSql={snippets.initialSql} startWithDraft={snippets.create}
        onInsert={insertSnippet} onClose={closeSnippets} />}
    </div>
  );
}
