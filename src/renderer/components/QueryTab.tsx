import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';
import { Play, Square, AlignLeft, Save, History, Gauge, ChevronDown, Check, RotateCcw, LockKeyhole } from 'lucide-react';
import type { QueryOutcome, QueryResult } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace, type WorkspaceTab } from '../store';
import { SqlEditor } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';

/** 一个标签对应一个固定会话，流式结果和任务事件只接收当前执行编号。 */
export function QueryTab({ tab, onHistory }: { tab: WorkspaceTab; onHistory: () => void }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const [sessionId, setSessionId] = useState(''); const sessionRef = useRef(''); const pendingSession = useRef<Promise<string> | null>(null);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const task = useRef(''); const [transaction, setTransaction] = useState(false);
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null); const [stream, setStream] = useState<QueryResult[]>([]); const [resultIndex, setResultIndex] = useState(0);
  const [error, setError] = useState(''); const [save, setSave] = useState(false); const [queryName, setQueryName] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]); const [editorHeight, setEditorHeight] = useState(300);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  /** 每个查询标签保持独立会话；事务和临时表不会混入其他标签。 */
  async function ensureSession() {
    if (sessionRef.current) return sessionRef.current;
    if (!pendingSession.current) pendingSession.current = invoke('connections.open', { id: tab.connectionId }).then(() => invoke('sessions.open', { connectionId: tab.connectionId, database: tab.database })).then(result => { sessionRef.current = result.sessionId; setSessionId(result.sessionId); return result.sessionId; }).finally(() => { pendingSession.current = null; });
    return pendingSession.current;
  }
  useEffect(() => () => { const id = sessionRef.current; if (id) void invoke('sessions.close', { sessionId: id }).catch(() => {}); else void pendingSession.current?.then(sessionId => invoke('sessions.close', { sessionId })).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    if (tab.database) void invoke('connections.open', { id: tab.connectionId }).then(() => invoke('metadata.objects', { connectionId: tab.connectionId, database: tab.database! })).then(async objects => {
      const names = objects.map(object => object.name);
      const columns = await Promise.allSettled(objects.filter(object => object.kind === 'table').slice(0, 20).map(object => invoke('metadata.table', { connectionId: tab.connectionId, database: tab.database!, table: object.name })));
      if (alive) setSuggestions([...names, ...columns.flatMap(result => result.status === 'fulfilled' ? result.value.columns.map(column => column.name) : [])]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [tab.connectionId, tab.database]);
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
    if (action === 'execute') void execute();
    if (action === 'save-query') { setQueryName(tab.title); setSave(true); }
  }));

  /** 选区优先执行；执行计划走专用命令，由引擎拒绝多语句输入。 */
  async function execute(mode: 'selected' | 'all' | 'explain' = 'selected') {
    if (busyRef.current) return;
    const selection = editor.current?.getSelection(); const selected = selection ? editor.current?.getModel()?.getValueInRange(selection) : '';
    const source = mode === 'all' ? tab.sql ?? '' : selected?.trim() ? selected : tab.sql ?? '';
    if (!source.trim()) { setError(zh.query.text001); return; }
    busyRef.current = true; setBusy(true); setError(''); setOutcome(null); setStream([]); setResultIndex(0); task.current = uid(); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      const result = await invoke(mode === 'explain' ? 'query.explain' : 'query.execute', { sessionId: session, sql: source, taskId: task.current, maxRows: settings.resultLimit });
      setOutcome(result);
      if (result.transactionOpen !== undefined) { setTransaction(result.transactionOpen); useWorkspace.getState().setDirty(tab.id, result.transactionOpen); }
    } catch (reason) {
      const message = errorMessage(reason);
      if (/会话不存在|会话连接已断开|PROTOCOL_CONNECTION_LOST|ECONNRESET/.test(message)) {
        const expired = sessionRef.current; sessionRef.current = ''; setSessionId(''); setTransaction(false); useWorkspace.getState().setDirty(tab.id, false);
        if (expired) void invoke('sessions.close', { sessionId: expired }).catch(() => {});
        setError(formatText(zh.query.text002, message));
      } else setError(message);
    }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 事务控制与普通查询串行执行，避免提交正在运行的语句。 */
  async function transactionAction(action: 'begin' | 'commit' | 'rollback') {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try { await invoke('query.transaction', { sessionId: await ensureSession(), action }); setTransaction(action === 'begin'); useWorkspace.getState().setDirty(tab.id, action === 'begin'); useWorkspace.getState().notify(action === 'begin' ? zh.query.text003 : action === 'commit' ? zh.query.text004 : zh.query.text005); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 保存查询正文及来源连接，之后可从历史面板重新打开。 */
  async function saveQuery() {
    try { await invoke('queries.save', { id: tab.id, name: queryName.trim() || zh.common.unnamedQuery, connectionId: tab.connectionId, database: tab.database, sql: tab.sql ?? '', updatedAt: new Date().toISOString() }); useWorkspace.getState().updateTab(tab.id, { title: queryName.trim() || zh.common.unnamedQuery }); setSave(false); useWorkspace.getState().notify(zh.query.text006); } catch (reason) { setError(errorMessage(reason)); }
  }
  const results = busy ? stream : outcome?.results ?? stream; const result = results[resultIndex];
  /** 保留结果区域最小高度，防止拖动编辑器后无法操作结果。 */
  function resize(event: React.PointerEvent) {
    const start = event.clientY; const height = editorHeight; event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setEditorHeight(Math.max(130, Math.min(window.innerHeight - 300, height + next.clientY - start)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  }
  return <div className="workspace-tab query-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><ChevronDown size={12}/><span className="breadcrumb-divider">/</span><span>{tab.database || zh.query.text007}</span><span className="grow"/><span className="muted small">{sessionId ? zh.query.text008 : zh.query.text009}</span></div><div className="toolbar"><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button><button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button><button disabled={!busy} onClick={() => void invoke('query.cancel', { taskId: task.current }).catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.common.stop}</button><span className="toolbar-divider"/><button title={zh.query.text012} onClick={() => { try { useWorkspace.getState().updateTab(tab.id, { sql: format(tab.sql ?? '', { language: 'mysql', keywordCase: 'upper' }) }); } catch (reason) { setError(errorMessage(reason)); } }}><AlignLeft size={15}/>{zh.query.text013}</button><button disabled={busy} onClick={() => void execute('explain')}><Gauge size={15}/>{zh.query.text014}</button><span className="grow"/><button onClick={() => { setQueryName(tab.title); setSave(true); }} title={zh.query.text015}><Save size={15}/></button><button onClick={onHistory} title={zh.common.historyQueries}><History size={15}/></button></div><div className="sql-editor-wrap" style={{ height: editorHeight }}><SqlEditor value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })} onReady={instance => { editor.current = instance; }} onExecute={() => void execute()} suggestions={suggestions}/></div><div className="horizontal-resize" onPointerDown={resize}/><div className="result-toolbar"><span className="result-label">{zh.query.text016}</span>{results.map((_, index) => <button className={resultIndex === index ? 'selected' : ''} onClick={() => setResultIndex(index)} key={index}>{zh.query.text017}{index + 1}</button>)}<span className="grow"/>{busy ? <Spinner text={zh.query.text018}/> : outcome && <span className="muted small">{outcome.elapsedMs}{zh.query.text019}</span>}<label className="inline-field">{zh.query.text020}<input aria-label={zh.query.text021} type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => useWorkspace.getState().updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/>{zh.query.text022}</label></div><ErrorBox message={error}/><div className="result-body">{result?.columns.length ? <ResultsGrid columns={result.columns} rows={result.rows}/> : result ? <Empty title={zh.query.text023} text={formatText(zh.query.text024, result.affectedRows ?? 0, result.insertId ? formatText(zh.query.text025, result.insertId) : '', result.warningCount ? formatText(zh.query.text026, result.warningCount) : '')}/> : <Empty title={zh.query.text027} text={zh.query.text028}><div className="key-tip"><kbd>Ctrl / ⌘</kbd><span>+</span><kbd>Enter</kbd></div></Empty>}</div><div className="tab-status"><span>{result ? formatText(zh.query.text029, result.rows.length, result.truncated ? zh.query.text030 : '') : zh.query.text031}</span><span className="grow"/>{transaction && <span className="warning-text"><LockKeyhole size={12}/>{zh.query.text032}</span>}<button disabled={busy || transaction} onClick={() => void transactionAction('begin')}>{zh.common.transactionBegin}</button><button disabled={busy || !transaction} onClick={() => void transactionAction('commit')}><Check size={12}/>{zh.common.transactionCommit}</button><button disabled={busy || !transaction} onClick={() => void transactionAction('rollback')}><RotateCcw size={12}/>{zh.common.transactionRollback}</button></div>{save && <Modal title={zh.query.text015} onClose={() => setSave(false)}><div className="modal-content"><Field label={zh.query.text033}><input autoFocus value={queryName} onChange={event => setQueryName(event.target.value)}/></Field></div><footer className="modal-footer"><span className="grow"/><button className="primary" onClick={() => void saveQuery()}>{zh.common.save}</button></footer></Modal>}</div>;
}
