import { useEffect, useMemo, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import type { ColumnWidths } from 'react-data-grid';
import { format } from 'sql-formatter';
import type { QueryOutcome, QueryResult, ResultColumn } from '../../shared/contracts';
import type { QueryParameterNames, QueryParameter } from '../../shared/queryParameters';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { postgresZh as text } from '../locales/postgres.zh-CN';
import { zh } from '../locales/zh-CN';
import { ResultExportSelection, type ResultGridSelection, type ResultSelectionBinding } from '../resultExport';
import { frozenQueryResultKeys, queryResultColumnKeys, queryResultColumnWidth, queryResultVisibleColumns, type QueryResultColumnLayout } from '../queryResultColumns';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { queryRowDetailsZh as detailText } from '../locales/queryRowDetails.zh-CN';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { appendQueryResultFilterNode, QueryResultFilter, type QueryResultFilterBinding, type QueryResultFilterGroup, type QueryResultFilterRule, type QueryResultFilterView } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterNode, type CellFilterOperator } from '../queryResultCellFilter';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture } from '../queryResultSelectedFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { prepareQueryResultOrganization } from '../queryResultHistory';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { SqlEditor, type SqlCompletionStatus } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { ExplainPlanView } from './ExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from './QueryAnalyzeConfirmDialog';
import { queryAnalyzeZh } from '../locales/queryAnalyze.zh-CN';
import { ErrorBox, Spinner, Empty, Modal } from './ui';
import { QueryCloseDialog } from './QueryCloseDialog';
import { QueryBindingDialog } from './QueryBindingDialog';
import { QueryParametersDialog } from './QueryParametersDialog';
import { useQueryFileSource } from '../useQueryFileSource';
import { captureQueryFileSnapshot } from '../queryFileSnapshot';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import './PostgresQueryTab.css';
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
interface ResultLayout { source: QueryResult; layout: QueryResultColumnLayout; columns: ResultColumn[]; }
/** PostgreSQL查询复用原编辑器、结果网格、文件来源及保存查询；驱动任务和事务明确独立。 */
export function PostgresQueryTab({
  tab,
  closeRequest,
  onCloseRequestFinished,
  onHistory,
}: {
  tab: WorkspaceTab;
  closeRequest?: QueryCloseRequest;
  onCloseRequestFinished?(request: QueryCloseRequest, close: boolean, keep?: WorkspaceTab): void;
  onHistory(): void;
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
  const [busy, setBusy] = useState(false),
    [fileBusy, setFileBusy] = useState(false),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState<QueryOutcome>(),
    [selected, setSelected] = useState(0),
    [state, setState] = useState({
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
  const [completionStatus, setCompletionStatus] = useState<SqlCompletionStatus>('idle');
  const [analyze, setAnalyze] = useState<AnalyzeOwner>();
  const analyzeRef = useRef<AnalyzeOwner | undefined>(undefined);
  const [resultSelection] = useState(() => new ResultExportSelection());
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
  const [exportView, setExportView] = useState<{ result: QueryResult; selected: boolean }>();
  const exportOpen = useRef(false);
  const scope: Scope = {
    profile,
    version,
    database: tab.database || (profile?.dialect === 'postgresql' && profile.database) || 'postgres',
  };
  const currentTab = () => useWorkspace.getState().settings.tabs.find((t) => t.id === tab.id);
  const source = () => editor.current?.getModel()?.getValue() ?? currentTab()?.sql ?? '';
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
      !fileBusy &&
      !closeRef.current &&
      !document.querySelector('[role="dialog"], [role="alertdialog"]')
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
        setState({ ...next, transactionFailed: next.transactionFailed === true });
        useWorkspace.getState().setDirty(tab.id, next.transactionOpen || !next.transactionKnown);
      }
    } catch {
      if (same(owner.scope)) {
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
    mode: 'normal' | 'current' | 'explain' | 'analyzePreview' = 'normal',
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
    } else if (!available()) return;
    if (session.current && !state.transactionKnown) {
      setError(text.unknown);
      return;
    }
    const model = editor.current?.getModel(),
      selection = editor.current?.getSelection(),
      original = model?.getValue() ?? source();
    let sql = confirmed?.source ?? sqlOverride ?? original,
      offset: number | undefined;
    if (!confirmed && !sqlOverride && !values && selection) {
      if (mode === 'current' || (mode === 'explain' || mode === 'analyzePreview') && selection.isEmpty()) offset = model!.getOffsetAt(selection.getPosition());
      else if (!selection.isEmpty()) sql = model!.getValueInRange(selection);
    }
    if (values) sql = parameter!.source;
    if (!sql.trim()) {
      setError(text.noSql);
      return;
    }
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
    setBusy(true);
    setError('');
    if (mode !== 'analyzePreview') {
      resultFilter.invalidate();
      resultSorter.invalidate();
      resultSelection.invalidate();
      setColumnLayout(undefined);
      setOutcome(undefined);
      setSelected(0);
    }
    owner.work = (async () => {
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
        owner.sent = true;
        if (parameter) setParameterOwner(undefined);
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
        if (owner.valid && same(owner.scope) && life.current === owner.life) {
          setOutcome(result);
          if (result.failure) setError(result.failure.message);
        }
      } catch (reason) {
        if (alive.current && life.current === owner.life) setError(errorMessage(reason));
      } finally {
        if (owner.cancel) await owner.cancel;
        const id = session.current?.id;
        if (id) await readState(id, owner);
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
    const sql = selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getValue();
    setParameterOwner({ source: sql, scope, model, version: model.getVersionId(), valid: true });
  }
  /** 显式重连先正常关闭旧会话；旧事务或未知写入不会被自动恢复和重放。 */
  async function reconnect() {
    const original = session.current;
    if (!original || !available() || !window.confirm(text.confirmReconnect) || !available()) return;
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
          organization.filter.invalidate();
          organization.sorter.invalidate();
          setColumnLayout(undefined);
        }
        if ((changed || left) && sortDraftRef.current) closeResultSort(sortDraftRef.current);
        if ((changed || left) && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
        if ((changed || left) && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
        const parameter = parameters.current;
        if (parameter && (changed || left)) {
          parameter.valid = false;
          setParameterOwner((current) => (current === parameter ? undefined : current));
        }
        if (analyzeRef.current && (changed || left || beforeTab?.sql !== afterTab?.sql)) clearAnalyze();
      }),
    [tab.id, tab.connectionId],
  );
  useEffect(() => {
    if (closeRequest && analyzeRef.current) clearAnalyze();
    if (closeRequest && sortDraftRef.current) closeResultSort(sortDraftRef.current);
    if (closeRequest && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
    if (closeRequest && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
  }, [closeRequest]);
  const results = outcome?.results ?? [],
    result = results[selected],
    controlsLocked = busy || fileBusy || !!save || !!parameterOwner || !!analyze || !!closeRequest || !!exportView,
    locked = controlsLocked || !!sortDraft || !!filterDraft || !!columnDraft;
  const resultSource = !outcome?.analysis && !outcome?.explain && result?.columns.length ? result : undefined;
  const resultContext = [outcome, selected, profile, version, scope.database];
  const currentLayout = columnLayout?.source === resultSource ? columnLayout : undefined;
  const layout = currentLayout?.layout;
  const visibleColumns = currentLayout?.columns ?? resultSource?.columns;
  const frozenKeys = useMemo(() => resultSource && layout ? frozenQueryResultKeys(resultSource.columns, layout) : undefined,
    [resultSource, layout]);
  const filterBinding = resultFilter.bind(resultSource, resultContext, visibleColumns);
  const filterView = resultFilter.view(filterBinding);
  const sortBinding = resultSorter.bind(filterView?.result ?? resultSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
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
    return alive.current && !controlsLocked && !closeRef.current && !exportOpen.current && !phase.current && !current.activeJobs[tab.id] &&
      current.settings.activeTabId === tab.id && same(scope);
  }

  /** 选择归属于当前显示顺序及工作区代次，旧网格回调不能读取后来切换的行。 */
  function resultCurrent() {
    return resultScopeCurrent() && !sortDraftRef.current && !filterDraftRef.current && !columnDraftRef.current && resultSelection.current(binding);
  }

  /** 行详情沿用当前网格的来源校验，另排除遮挡网格的模态窗口。 */
  function rowDetailCurrent(source: QueryRowDetailsBinding | undefined) {
    return resultCurrent() && rowDetails.current(source) && !document.querySelector('[role="dialog"], [role="alertdialog"]');
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
    return resultScopeCurrent() && !filterDraftRef.current && !columnDraftRef.current && sortDraftRef.current === draft && !!sortBinding && !!sortView &&
      (!draft || draft.binding === sortBinding && draft.view === sortView) && resultSorter.view(sortBinding) === sortView;
  }

  /** 筛选与排序原视图必须同时有效，迟到草稿不能覆盖另一结果集。 */
  function filterCurrent(draft?: FilterDraft) {
    return resultScopeCurrent() && !sortDraftRef.current && !columnDraftRef.current && filterDraftRef.current === draft &&
      !!filterBinding && !!filterView && !!sortView &&
      (!draft || draft.binding === filterBinding && draft.view === filterView && draft.sortView === sortView) &&
      resultFilter.view(filterBinding) === filterView && resultSorter.view(sortBinding) === sortView;
  }

  /** 普通入口和快捷入口都打开同一草稿，追加条件与当前生效表达式分开保存。 */
  function openResultFilter(node?: QueryResultFilterRule | QueryResultFilterGroup) {
    if (!filterBinding || !filterView || !sortView || !filterCurrent() ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const seed = node && appendQueryResultFilterNode(filterView.expression, node);
    const draft = { binding: filterBinding, view: filterView, sortView, seed };
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
      resultFilter.invalidate();
      resultSorter.invalidate();
      organization.filter = next.filter;
      organization.sorter = next.sorter;
      resultSelection.invalidate();
      if (draft) closeResultFilter(draft);
      refreshResult(value => value + 1);
    } catch (reason) {
      if (draft) setFilterError(errorMessage(reason));
      else setError(errorMessage(reason));
    }
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
      resultSorter.apply(sortBinding, sortView, rules);
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
    if (!binding || !resultCurrent() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
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
    return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).every(node => node === owned);
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
    if (!resultCurrent() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    try {
      const snapshot = selectedOnly ? resultSelection.snapshot(binding) : resultSelection.allSnapshot(binding);
      exportOpen.current = true;
      setExportView({ result: snapshot, selected: selectedOnly });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  return (
    <div className="workspace-tab query-tab postgres-query">
      <div className="context-bar">
        <strong>{profile?.name}</strong>
        <span>PostgreSQL / {scope.database}</span>
        <QueryFileSourceCaption tab={tab} files={files} compact />
        <span>{session.current ? '原查询会话' : '尚未连接'}</span>
      </div>
      <QueryFileActions
        tab={tab}
        files={files}
        renderActions={(actions) => (
          <div className="query-toolbar postgres-toolbar">
            {actions}
            <button disabled={locked || !state.transactionKnown} onClick={() => run()}>
              {text.execute}
            </button>
            <button disabled={locked || !state.transactionKnown} onClick={() => run('current')}>
              {text.current}
            </button>
            <button disabled={locked || !state.transactionKnown || state.transactionFailed} onClick={() => run('explain')}>
              {text.explain}
            </button>
            <button disabled={locked || !state.transactionKnown || state.transactionFailed} onClick={() => run('analyzePreview')}>
              {queryAnalyzeZh.open}
            </button>
            <button disabled={locked || !state.transactionKnown} onClick={openParameters}>
              {text.parameters}
            </button>
            <button disabled={!busy || phase.current?.cancelled} onClick={stop}>
              {text.stop}
            </button>
            <button
              disabled={locked}
              onClick={() => {
                try {
                  const sql = source();
                  if (sql.length > 65536) throw Error('格式化SQL不能超过64KiB');
                  editor.current?.executeEdits('postgres-format', [
                    {
                      range: editor.current.getModel()!.getFullModelRange(),
                      text: format(sql, { language: 'postgresql' }),
                    },
                  ]);
                } catch (reason) {
                  setError(errorMessage(reason));
                }
              }}
            >
              {text.format}
            </button>
            <button disabled={locked} onClick={() => setSave(true)}>
              {text.save}
            </button>
            <button disabled={locked} onClick={onHistory}>
              {text.history}
            </button>
            <button disabled={locked || !session.current} onClick={() => void reconnect()}>
              {text.reconnect}
            </button>
          </div>
        )}
      />
      <div className="postgres-editor">
        <SqlEditor
          value={tab.sql ?? ''}
          dialect="postgresql"
          postgresCompletion={{ tabId: tab.id, connectionId: tab.connectionId, database: scope.database,
            connectionVersion: scope.version, sessionId: session.current?.id }}
          onCompletionStatus={setCompletionStatus}
          readOnly={busy || fileBusy || !!analyze || !!exportView || !!filterDraft || !!columnDraft}
          onReady={(instance) => {
            editor.current = instance;
          }}
          onChange={(sql) => {
            if (analyzeRef.current) clearAnalyze();
            if (!phase.current) useWorkspace.getState().updateTab(tab.id, { sql });
          }}
          onExecute={() => run()}
          onExecuteCurrent={() => run('current')}
        />
      </div>
      <ErrorBox message={error} />
      {!busy && completionStatus !== 'idle' && <p className="muted small" role="status">{completionStatus === 'limited'
        ? text.completionLimited : completionStatus === 'partial' ? text.completionPartial
          : completionStatus === 'sessionUnknown' ? text.completionTransaction : text.completionUnavailable}</p>}
      {busy && <Spinner text={phase.current?.sent ? text.running : text.connecting} />}
      <div className="postgres-results">
        {(results.length > 1 || dataResult) && (
          <div className="postgres-result-actions">
            {results.length > 1 && <select aria-label="PostgreSQL结果集" value={selected} disabled={locked}
              onChange={event => {
                if (exportOpen.current || sortDraftRef.current || filterDraftRef.current || columnDraftRef.current) return;
                resultFilter.invalidate();
                resultSorter.invalidate();
                resultSelection.invalidate();
                setColumnLayout(undefined);
                setSelected(Number(event.target.value));
              }}>
              {results.map((r, i) => <option key={i} value={i}>{text.result(i, r.postgresCommand ?? '', r.rows.length)}</option>)}
            </select>}
            {dataResult && <>
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
                  if (!sortBinding || !sortView || !sortCurrent() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
                  const draft = { binding: sortBinding, view: sortView };
                  sortDraftRef.current = draft;
                  setSortDraft(draft);
                }}>{sortText.panelTitle}</button>
              {!!sortView?.rules.length && <button disabled={locked} onClick={() => applyResultSort([])}>{sortText.clear}</button>}
              <button disabled={locked || !binding} onClick={() => openResultExport(false)}>{zh.resultExport.title}</button>
              <button disabled={locked || !selectedCount} onClick={() => openResultExport(true)}>{zh.resultExport.selectedTitle}</button>
            </>}
          </div>
        )}
        {outcome?.analysis ? <QueryAnalyzeView plan={outcome.analysis} outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> :
          outcome?.explain ? <ExplainPlanView outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> : result ? (
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
        {result?.truncated && <p className="warning-text">{text.truncated}</p>}
      </div>
      {columnDraft && <QueryResultColumnsDialog key={columnDraft.owner} binding={columnDraft.binding}
        initial={columnDraft.initial} owner={columnDraft.owner}
        isCurrent={() => columnCurrent(columnDraft)} onApply={next => applyResultColumns(columnDraft, next)}
        onClose={() => closeResultColumns(columnDraft)} />}
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
        allowSql={false} onClose={() => {
          exportOpen.current = false;
          setExportView(undefined);
        }} />}
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
      {closeRequest && !save && !exportView && !filterDraft && !columnDraft && (
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
          loadNames={() => names(parameterOwner)}
          onExecute={(values) => run('normal', values, parameterOwner)}
          onClose={() => {
            parameterOwner.valid = false;
            setParameterOwner(undefined);
          }}
        />
      )}
    </div>
  );
}
