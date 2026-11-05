import { useEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';
import type { QueryOutcome, QueryResult } from '../../shared/contracts';
import type { QueryParameterNames, QueryParameter } from '../../shared/queryParameters';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { postgresZh as text } from '../locales/postgres.zh-CN';
import { zh } from '../locales/zh-CN';
import { ResultExportSelection, type ResultGridSelection } from '../resultExport';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { SqlEditor, type SqlCompletionStatus } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { QueryResultSortPanel } from './QueryResultSortPanel';
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
  const [resultSorter] = useState(() => new QueryResultSort('postgresql'));
  const [, refreshResult] = useState(0);
  const [sortDraft, setSortDraft] = useState<SortDraft>();
  const sortDraftRef = useRef<SortDraft | undefined>(undefined);
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
      resultSorter.invalidate();
      resultSelection.invalidate();
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
        if (changed) resultSorter.invalidate();
        if ((changed || left) && sortDraftRef.current) closeResultSort(sortDraftRef.current);
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
  }, [closeRequest]);
  const results = outcome?.results ?? [],
    result = results[selected],
    controlsLocked = busy || fileBusy || !!save || !!parameterOwner || !!analyze || !!closeRequest || !!exportView,
    locked = controlsLocked || !!sortDraft;
  const sortSource = !outcome?.analysis && !outcome?.explain && result?.columns.length ? result : undefined;
  const sortBinding = resultSorter.bind(sortSource, [outcome, selected, profile, version, scope.database]);
  const sortView = resultSorter.view(sortBinding);
  const displayResult = sortView?.result ?? result;
  const dataResult = !busy && sortSource ? displayResult : undefined;
  const binding = resultSelection.bind(workspace.settings.activeTabId === tab.id ? dataResult : undefined,
    [outcome, selected, profile, version, scope.database]);
  const selectedCount = resultSelection.count(binding);

  /** 当前标签、连接和事务操作仍归原工作区，排序不借用数据库会话。 */
  function resultScopeCurrent() {
    const current = useWorkspace.getState();
    return !controlsLocked && !closeRef.current && !exportOpen.current && !phase.current && !current.activeJobs[tab.id] &&
      current.settings.activeTabId === tab.id && same(scope);
  }

  /** 选择归属于当前显示顺序及工作区代次，旧网格回调不能读取后来切换的行。 */
  function resultCurrent() {
    return resultScopeCurrent() && !sortDraftRef.current && resultSelection.current(binding);
  }

  /** 排序草稿只消费所属结果与排序视图。 */
  function sortCurrent(draft?: SortDraft) {
    return resultScopeCurrent() && sortDraftRef.current === draft && !!sortBinding && !!sortView &&
      (!draft || draft.binding === sortBinding && draft.view === sortView) && resultSorter.view(sortBinding) === sortView;
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
          readOnly={busy || fileBusy || !!analyze || !!exportView}
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
                if (exportOpen.current || sortDraftRef.current) return;
                resultSorter.invalidate();
                resultSelection.invalidate();
                setSelected(Number(event.target.value));
              }}>
              {results.map((r, i) => <option key={i} value={i}>{text.result(i, r.postgresCommand ?? '', r.rows.length)}</option>)}
            </select>}
            {dataResult && <>
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
            <ResultsGrid columns={result.columns} rows={displayResult!.rows} rowJump selectionScope={binding}
              isCurrent={binding ? resultCurrent : undefined} onSelectionChange={binding ? acceptResultSelection : undefined}
              sort={sortView ? [...sortView.rules] : undefined} sortReasons={sortBinding?.reasons}
              onSortChange={sortView ? rules => applyResultSort(rules) : undefined} />
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
      {closeRequest && !save && !exportView && (
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
