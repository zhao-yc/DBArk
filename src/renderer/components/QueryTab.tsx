import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';
import { Play, Square, AlignLeft, Save, History, Gauge, ChevronDown, Check, RotateCcw, LockKeyhole, Pin, X, Download, BookOpen, Braces } from 'lucide-react';
import type { QueryOutcome, QueryResult } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace, type WorkspaceTab } from '../store';
import { SqlEditor,type SqlCompletionStatus } from './SqlEditor';
import {completionZh} from '../locales/completion.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import { snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { exportableQueryResult } from '../resultExport';
import { ResultExportDialog } from './ResultExportDialog';
import { QueryFileActions } from './QueryFilesDialog';
import { SnippetsDialog } from './SnippetsDialog';
import { snippetEdit } from '../snippetInsertion';
import { QueryParametersDialog } from './QueryParametersDialog';
import { parameterZh } from '../locales/queryParameters.zh-CN';
import type { QueryParameter } from '../../shared/queryParameters';
import '../queryPins.css';
import { QueryStreamExportDialog, type StreamExportOptions } from './QueryStreamExportDialog';
import { queryStreamZh } from '../locales/queryStreamExport.zh-CN';

/** 一个标签对应一个固定会话，流式结果和任务事件只接收当前执行编号。 */
export function QueryTab({ tab, onHistory }: { tab: WorkspaceTab; onHistory: () => void }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const [sessionId, setSessionId] = useState(''); const sessionRef = useRef(''); const pendingSession = useRef<Promise<string> | null>(null);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const task = useRef(''); const [transaction, setTransaction] = useState(false);
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null); const [stream, setStream] = useState<QueryResult[]>([]); const [resultIndex, setResultIndex] = useState(0);
  const [error, setError] = useState(''); const [save, setSave] = useState(false); const [queryName, setQueryName] = useState('');
  const [completionStatus,setCompletionStatus]=useState<SqlCompletionStatus>('idle');const connectionVersion=useWorkspace(state=>state.connectionVersions[tab.connectionId]??0);const [editorHeight, setEditorHeight] = useState(300);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [pins, setPins] = useState<PinnedQueryResult[]>([]); const [selectedPin, setSelectedPin] = useState(''); const pinSequence = useRef(0);
  const [showPinSql, setShowPinSql] = useState(false);
  const [exportResult, setExportResult] = useState<QueryResult | null>(null);
  const [showSnippets, setShowSnippets] = useState(false); const snippetSelection = useRef<monaco.Selection | null>(null);
  const snippetModel = useRef<monaco.editor.ITextModel | null>(null);
  const [parameterSource, setParameterSource] = useState<string | null>(null);
  const parameterSession = useRef(''); const [queryRunning, setQueryRunning] = useState(false);
  const [transactionKnown, setTransactionKnown] = useState(true);
  const [streamExportSource, setStreamExportSource] = useState<string | null>(null); const streamParameterSession = useRef(''); const streamCancelled = useRef('');
  /** 打开前保留查询选区，模态内预览编辑器不能改变插入位置。 */
  function openSnippets() { snippetSelection.current = editor.current?.getSelection() ?? null; snippetModel.current = editor.current?.getModel() ?? null; setShowSnippets(true); }
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
    if (!pendingSession.current) pendingSession.current = invoke('connections.open', { id: tab.connectionId }).then(() => invoke('sessions.open', { connectionId: tab.connectionId, database: tab.database })).then(result => { sessionRef.current = result.sessionId; setSessionId(result.sessionId); return result.sessionId; }).finally(() => { pendingSession.current = null; });
    return pendingSession.current;
  }
  useEffect(() => () => { const id = sessionRef.current; if (id) void invoke('sessions.close', { sessionId: id }).catch(() => {}); else void pendingSession.current?.then(sessionId => invoke('sessions.close', { sessionId })).catch(() => {}); }, []);
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
    if (action === 'execute') void execute();
    if (action === 'save-query') { setQueryName(tab.title); setSave(true); }
  }));

  /** 捕获点击时的编辑器正文和选区，参数表单打开后不重新读取后台草稿。 */
  function querySource(all = false) {
    const selection = editor.current?.getSelection(); const selected = selection ? editor.current?.getModel()?.getValueInRange(selection) : '';
    return !all && selected?.trim() ? selected : editor.current?.getModel()?.getValue() ?? tab.sql ?? '';
  }
  /** 选区优先执行；执行计划走专用命令，由引擎拒绝多语句输入。 */
  async function execute(mode: 'selected' | 'all' | 'explain' = 'selected') {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    await runQuery(querySource(mode === 'all'), mode === 'explain' ? 'explain' : 'execute');
  }
  /** 参数识别只打开固定会话，不建立任务、不执行用户模板，也不清除已有结果。 */
  function openParameters() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    parameterSession.current = ''; setParameterSource(source);
  }
  /** 捕获不可变选区或全文；打开和选择文件均不执行 SQL。 */
  function openStreamExport() {
    if (busyRef.current || document.querySelector('[role="dialog"]')) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    streamParameterSession.current = ''; setStreamExportSource(source);
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
    const source = streamExportSource!;
    busyRef.current = true; streamCancelled.current = ''; setBusy(true); setQueryRunning(true); setError(''); setSelectedPin(''); setShowPinSql(false); setOutcome(null); setStream([]); setResultIndex(0); task.current = options.taskId; useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      if (streamCancelled.current === options.taskId) throw new Error(queryStreamZh.cancelledBeforeExecution);
      if (options.parameters && streamParameterSession.current !== session) throw new Error(queryStreamZh.sessionChanged);
      const result = await invoke('query.exportStream', { ...options, sql: source, sessionId: session });
      setOutcome(result.preview); setTransaction(result.transactionOpen ?? false); setTransactionKnown(result.transactionKnown); useWorkspace.getState().setDirty(tab.id, !result.transactionKnown || !!result.transactionOpen);
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
  async function runQuery(source: string, mode: 'execute' | 'explain' = 'execute', parameters?: QueryParameter[]) {
    if (busyRef.current) return;
    if (!source.trim()) { setError(zh.query.text001); return; }
    busyRef.current = true; setBusy(true); setQueryRunning(true); setError(''); setSelectedPin(''); setShowPinSql(false); setOutcome(null); setStream([]); setResultIndex(0); task.current = uid(); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      if (parameters && session !== parameterSession.current) throw new Error('参数识别时的会话已失效，请重新打开参数表单');
      const input = { sessionId: session, sql: source, taskId: task.current, maxRows: settings.resultLimit };
      const result = parameters ? await invoke('query.executeParameterized', { ...input, parameters }) : await invoke(mode === 'explain' ? 'query.explain' : 'query.execute', input);
      setOutcome(result);
      if (result.transactionOpen !== undefined) { setTransaction(result.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, result.transactionOpen); }
    } catch (reason) { await handleQueryError(reason); }
    finally { busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 事务控制与普通查询串行执行，避免提交正在运行的语句。 */
  async function transactionAction(action: 'begin' | 'commit' | 'rollback') {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try { await invoke('query.transaction', { sessionId: await ensureSession(), action }); setTransaction(action === 'begin'); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, action === 'begin'); useWorkspace.getState().notify(action === 'begin' ? zh.query.text003 : action === 'commit' ? zh.query.text004 : zh.query.text005); }
    catch (reason) { await handleQueryError(reason); }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 保存查询正文及来源连接，之后可从历史面板重新打开。 */
  async function saveQuery() {
    try { await invoke('queries.save', { id: tab.id, name: queryName.trim() || zh.common.unnamedQuery, connectionId: tab.connectionId, database: tab.database, sql: tab.sql ?? '', updatedAt: new Date().toISOString() }); useWorkspace.getState().updateTab(tab.id, { title: queryName.trim() || zh.common.unnamedQuery }); setSave(false); useWorkspace.getState().notify(zh.query.text006); } catch (reason) { setError(errorMessage(reason)); }
  }
  const results = queryRunning ? stream : outcome?.results ?? stream; const pin = pins.find(item => item.id === selectedPin); const result = pin?.result ?? results[resultIndex];
  const exportable = exportableQueryResult(busy, outcome, resultIndex, pin?.result);
  /** 快照由独立克隆保留旧数据，不重执行SQL，也不把结果写入本地配置库。 */
  function pinResult() {
    if (busy || !outcome || !result || pin) return;
    try {
      const next = snapshotQueryResult(pins, result, uid(), formatText(zh.query.pinLabel, pinSequence.current + 1));
      pinSequence.current++; setPins([...pins, next]); setSelectedPin(next.id); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 释放快照后立即返回本次结果，原SQL标签和事务状态保持原样。 */
  function releasePin(id: string) {
    setPins(current => current.filter(item => item.id !== id));
    if (selectedPin === id) { setSelectedPin(''); setShowPinSql(false); }
  }
  /** 保留结果区域最小高度，防止拖动编辑器后无法操作结果。 */
  function resize(event: React.PointerEvent) {
    const start = event.clientY; const height = editorHeight; event.currentTarget.setPointerCapture(event.pointerId);
    /** 根据拖动距离改变编辑区域高度，始终保留查询结果的可操作空间。 */
    const move = (next: PointerEvent) => setEditorHeight(Math.max(130, Math.min(window.innerHeight - 300, height + next.clientY - start)));
    /** 拖动结束释放窗口监听，防止离开分隔条后仍持续调整高度。 */
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  }
  return <div className="workspace-tab query-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><ChevronDown size={12}/><span className="breadcrumb-divider">/</span><span>{tab.database || zh.query.text007}</span><span className="grow"/><span className="muted small">{sessionId ? zh.query.text008 : zh.query.text009}</span></div><div className="toolbar"><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button><button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button><button disabled={busy || !connection} title={queryStreamZh.title} aria-label={queryStreamZh.open} onClick={openStreamExport}><Download size={14}/>{queryStreamZh.open}</button><button disabled={busy || !connection} onClick={openParameters}><Braces size={14}/>{parameterZh.open}</button><button disabled={!queryRunning} onClick={() => void invoke('query.cancel', { taskId: task.current }).catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.common.stop}</button><span className="toolbar-divider"/><button title={zh.query.text012} onClick={() => { try { useWorkspace.getState().updateTab(tab.id, { sql: format(tab.sql ?? '', { language: 'mysql', keywordCase: 'upper' }) }); } catch (reason) { setError(errorMessage(reason)); } }}><AlignLeft size={15}/>{zh.query.text013}</button><button disabled={busy} onClick={() => void execute('explain')}><Gauge size={15}/>{zh.query.text014}</button><span className="grow"/><QueryFileActions tab={tab}/><button title={zh.snippets.title} aria-label={zh.snippets.title} onClick={openSnippets}><BookOpen size={15}/></button><button onClick={() => { setQueryName(tab.title); setSave(true); }} title={zh.query.text015}><Save size={15}/></button><button onClick={onHistory} title={zh.common.historyQueries}><History size={15}/></button></div><div className="sql-editor-wrap" style={{ height: editorHeight }}><SqlEditor value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })} onReady={instance => { editor.current = instance; }} onExecute={() => void execute()} completion={!busy&&connection?{connectionId:tab.connectionId,connectionVersion,database:tab.database}:undefined} onCompletionStatus={setCompletionStatus}/></div><div className="horizontal-resize" onPointerDown={resize}/><div className="result-toolbar"><span className="result-label">{zh.query.text016}</span>{results.map((_, index) => <button className={!pin && resultIndex === index ? 'selected' : ''} onClick={() => { setResultIndex(index); setSelectedPin(''); setShowPinSql(false); }} key={index}>{zh.query.text017}{index + 1}</button>)}<span className="grow"/><button disabled={busy || !outcome || !result?.columns.length || !!pin} title={zh.query.pinHint} onClick={pinResult}><Pin size={12}/>{zh.query.pinResult}</button>{pin && <button onClick={() => setShowPinSql(true)}>{zh.query.pinnedStatement}</button>}<button disabled={!exportable} onClick={() => { if (exportable) setExportResult(exportable); }}><Download size={12}/>{zh.resultExport.title}</button>{busy ? <Spinner text={zh.query.text018}/> : outcome && <span className="muted small">{outcome.elapsedMs}{zh.query.text019}</span>}<label className="inline-field">{zh.query.text020}<input aria-label={zh.query.text021} type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => useWorkspace.getState().updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/>{zh.query.text022}</label></div>{pins.length > 0 && <div className="pinned-results" aria-label={zh.query.pinSection}><span>{zh.query.pinSection}</span><button className={`current-results ${!pin ? 'selected' : ''}`} onClick={() => { setSelectedPin(''); setShowPinSql(false); }}>{zh.query.currentResults}</button>{pins.map(item => <div key={item.id} className={`pinned-result ${pin?.id === item.id ? 'selected' : ''}`}><button aria-pressed={pin?.id === item.id} title={item.result.statement} onClick={() => { setSelectedPin(item.id); setShowPinSql(false); }}><Pin size={11}/>{item.label}</button><button aria-label={formatText(zh.query.releasePin, item.label)} onClick={() => releasePin(item.id)}><X size={11}/></button></div>)}</div>}<ErrorBox message={error}/><div className="result-body">{result?.columns.length ? <ResultsGrid key={pin?.id ?? `current-${resultIndex}`} columns={result.columns} rows={result.rows}/> : result ? <Empty title={zh.query.text023} text={formatText(zh.query.text024, result.affectedRows ?? 0, result.insertId ? formatText(zh.query.text025, result.insertId) : '', result.warningCount ? formatText(zh.query.text026, result.warningCount) : '')}/> : <Empty title={zh.query.text027} text={zh.query.text028}><div className="key-tip"><kbd>Ctrl / ⌘</kbd><span>+</span><kbd>Enter</kbd></div></Empty>}</div><div className="tab-status"><span>{result ? formatText(zh.query.text029, result.rows.length, result.truncated ? zh.query.text030 : '') : zh.query.text031}</span><span className="grow"/>{!busy&&completionStatus!=='idle'&&<span className="muted small" aria-label="SQL 补全状态" title={completionStatus==='partial'?completionZh.partialHint:completionStatus==='limited'?completionZh.limitedHint:completionZh.unavailableHint}>{completionStatus==='partial'?completionZh.partial:completionStatus==='limited'?completionZh.limited:completionZh.unavailable}</span>}{(transaction || !transactionKnown) && <span className="warning-text" title={!transactionKnown ? parameterZh.transactionUnknownHint : undefined}><LockKeyhole size={12}/>{transactionKnown ? zh.query.text032 : parameterZh.transactionUnknown}</span>}<button disabled={busy || transaction || !transactionKnown} onClick={() => void transactionAction('begin')}>{zh.common.transactionBegin}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('commit')}><Check size={12}/>{zh.common.transactionCommit}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('rollback')}><RotateCcw size={12}/>{zh.common.transactionRollback}</button></div>{save && <Modal title={zh.query.text015} onClose={() => setSave(false)}><div className="modal-content"><Field label={zh.query.text033}><input autoFocus value={queryName} onChange={event => setQueryName(event.target.value)}/></Field></div><footer className="modal-footer"><span className="grow"/><button className="primary" onClick={() => void saveQuery()}>{zh.common.save}</button></footer></Modal>}{showPinSql && pin && <Modal title={zh.query.pinSource} wide onClose={() => setShowPinSql(false)}><div className="modal-content"><p className="muted small">{zh.query.pinSessionOnly}</p><SqlEditor value={pin.result.statement} height={280} readOnly/></div><footer className="modal-footer"><span className="grow"/><button onClick={() => setShowPinSql(false)}>{zh.common.close}</button></footer></Modal>}{showSnippets && <SnippetsDialog initialSql={snippetSelection.current ? editor.current?.getModel()?.getValueInRange(snippetSelection.current) || tab.sql || '' : tab.sql || ''} onInsert={insertSnippet} onClose={() => setShowSnippets(false)}/ >}{parameterSource !== null && <QueryParametersDialog source={parameterSource} loadNames={loadParameterNames} onExecute={parameters => { const source = parameterSource; setParameterSource(null); void runQuery(source, 'execute', parameters); }} onClose={() => setParameterSource(null)}/ >}{streamExportSource !== null && <QueryStreamExportDialog sessionBusy={busy} source={streamExportSource} loadNames={loadStreamParameterNames} onExecute={runStreamExport} onCancel={cancelStreamExport} onClose={() => { if (!busyRef.current) setStreamExportSource(null); }}/ >}{exportResult && <ResultExportDialog result={exportResult} tabId={tab.id} onClose={() => setExportResult(null)}/>}</div>;
}
