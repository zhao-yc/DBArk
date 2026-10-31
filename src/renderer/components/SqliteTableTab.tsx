import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ResultExportData } from '../../shared/contracts';
import type { SqliteOriginalValue, SqliteTableEditPreview } from '../../shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab, type WorkspaceBusyLease } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { resultExportData } from '../resultExport';
import { SqliteTableBrowser, sqliteTableDraft, type SqliteTableQuery, type SqliteTableView, type SqliteFilterDraft, type SqliteSortDraft } from '../sqliteTableBrowser';
import { sqliteTableBrowseZh as text } from '../locales/sqliteTableBrowse.zh-CN';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { openSqliteSelect } from '../sqliteNavigation';
import { useUiCommandScope } from '../uiCommands';
import { ResultsGrid } from './ResultsGrid';
import { SqliteTableExportDialog } from './SqliteTableExportDialog';
import { SqliteTableExportIntent } from '../sqliteTableExportUi';
import { sqliteTableExportZh as exportText } from '../locales/sqliteTableExport.zh-CN';
import { ResultExportDialog } from './ResultExportDialog';
import { Empty, ErrorBox, Spinner } from './ui';
import { SqliteTableEditor, type SqliteEditView, type SqliteDraftRow } from '../sqliteTableEditor';
import { SqliteTableEditGrid } from './SqliteTableEditGrid';
import { SqliteTableValueDialog, SqliteTablePreviewDialog } from './SqliteTableEditDialog';
import { sqliteTableEditZh as editText } from '../locales/sqliteTableEdit.zh-CN';
import '../sqliteTableBrowse.css';

interface FullExportOwner { intent: SqliteTableExportIntent; acquiring: boolean; lease?: WorkspaceBusyLease; }
interface EditInputTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; row: SqliteDraftRow; column?: number; }
interface EditPreviewTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; }

/** 初次请求只读取无条件第一页，不恢复未明确应用的草稿条件。 */
const initialQuery = (): SqliteTableQuery => ({ limit: 100, mode: 'and', filters: [], sort: [] });
/** 原 table 标签的 SQLite 分支复用分页来源；编辑采用独立快照，不借用查询标签事务。 */
export function SqliteTableTab({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const profile = useWorkspace(state => state.connections.find(item => item.id === tab.connectionId));
  const version = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const externalBusy = useWorkspace(state => !!state.activeJobs[tab.id]);
  const latest = useRef({ tab, active }); latest.current = { tab, active };
  const [view, setView] = useState<SqliteTableView>({ busy: false, stopping: false, error: '', columns: [] });
  const [conditions, setConditions] = useState(false), [limit, setLimit] = useState(100), [mode, setMode] = useState<'and' | 'or'>('and');
  const [filters, setFilters] = useState<SqliteFilterDraft[]>([]), [sort, setSort] = useState<SqliteSortDraft[]>([]), [validation, setValidation] = useState('');
  const [exportData, setExportData] = useState<ResultExportData | null>(null);
  const applied = useRef(initialQuery());
  const [fullExport, setFullExport] = useState<FullExportOwner | null>(null), fullExportRef = useRef<FullExportOwner | null>(null);
  const editorRef = useRef<SqliteTableEditor | null>(null), [editView, setEditView] = useState<SqliteEditView | null>(null);
  const [selectedRow, setSelectedRow] = useState<string>(), [cellInput, setCellInput] = useState<EditInputTicket | null>(null), inputRef = useRef<EditInputTicket | null>(null);
  const [previewOpen, setPreviewOpen] = useState<EditPreviewTicket | null>(null), previewRef = useRef<EditPreviewTicket | null>(null);
  const editRenderTicket = {}, editRender = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { editRender.current = editRenderTicket; return () => { if (editRender.current === editRenderTicket) editRender.current = undefined; }; });
  const [controller] = useState(() => new SqliteTableBrowser({
    scope: () => {
      const current = latest.current, workspace = useWorkspace.getState(), present = workspace.settings.tabs.find(item => item.id === current.tab.id), connection = workspace.connections.find(item => item.id === current.tab.connectionId);
      return { tab: present, profile: connection, connectionId: current.tab.connectionId, database: current.tab.database, table: current.tab.table, version: workspace.connectionVersions[current.tab.connectionId] ?? 0, present: present === current.tab && present?.kind === 'table', active: current.active && workspace.settings.activeTabId === current.tab.id, sqlite: connection?.dialect === 'sqlite', ...(connection?.dialect === 'sqlite' && !connection.sqlite.readOnly ? { editing: true } : {}) };
    },
    acquire: () => acquireWorkspaceBusy(latest.current.tab.id), read: input => invoke('sqlite.tablePage', input), release: snapshotId => invoke('sqlite.tableEdit.release', { snapshotId }), cancel: taskId => invoke('query.cancel', { taskId }), id: uid, changed: next => { fullExportRef.current?.intent.current(); setView(next); }, subscribe: changed => useWorkspace.subscribe(changed),
  }));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const target = useRef({ profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table });
  /** 新连接修订先清旧条件；初次只读无条件第一页，重新激活同目标沿已明确应用的配置。 */
  useEffect(() => {
    const before = target.current, changed = before.profile !== profile || before.version !== version || before.connectionId !== tab.connectionId || before.database !== tab.database || before.table !== tab.table;
    target.current = { profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table };
    editorRef.current?.observe();
    // 有草稿时保留原页；连接或目标变化只撤销提交权，不拿新回包替换本地内容。
    if (editorRef.current?.dirty || editorRef.current?.busy) { controller.observe(); return; }
    if (changed) { applied.current = initialQuery(); setLimit(100); setMode('and'); setFilters([]); setSort([]); setValidation(''); }
    if (active) { dropEditor(); void controller.load(applied.current, 0); } else controller.observe();
  }, [controller, active, profile, version, tab.connectionId, tab.database, tab.table]);
  useLayoutEffect(() => { controller.observe(); editorRef.current?.observe(); fullExportRef.current?.intent.observe([view.page, applied.current, tab, profile, version, active]); });
  useEffect(() => { const stop = useWorkspace.subscribe(() => fullExportRef.current?.intent.current()); return () => { stop(); fullExportRef.current?.intent.invalidate(); }; }, []);
  /** 页面编辑能力只从后端签发的准确快照创建；同步订阅守住真实来源 ABA。 */
  useEffect(() => {
    const received = view.page;
    if (!received || received.edit?.kind !== 'editable' || editorRef.current?.page === received || editorRef.current?.dirty) return;
    if (!controller.pageCurrent(received) || profile?.dialect !== 'sqlite' || profile.sqlite.readOnly) { controller.releaseUnadopted(received); return; }
    dropEditor();
    const captured = { tab, profile, version };
    try {
      const editor = new SqliteTableEditor(received, {
        current: () => { const now = useWorkspace.getState(); return now.settings.tabs.find(item => item.id === captured.tab.id) === captured.tab && now.connections.find(item => item.id === captured.tab.connectionId) === captured.profile && captured.profile?.dialect === 'sqlite' && !captured.profile.sqlite.readOnly && (now.connectionVersions[captured.tab.connectionId] ?? 0) === captured.version; },
        active: () => latest.current.active && useWorkspace.getState().settings.activeTabId === captured.tab.id,
        available: () => !useWorkspace.getState().activeJobs[captured.tab.id], acquire: () => acquireWorkspaceBusy(captured.tab.id), id: uid, now: Date.now,
        changed: setEditView, dirty: dirty => { const now = useWorkspace.getState(); if (now.settings.tabs.find(item => item.id === captured.tab.id) === captured.tab && !!now.dirtyTabs[captured.tab.id] !== dirty) now.setDirty(captured.tab.id, dirty); },
        preview: input => invoke('sqlite.tableEdit.preview', input), apply: input => invoke('sqlite.tableEdit.apply', input), release: input => invoke('sqlite.tableEdit.release', input), cancel: taskId => invoke('query.cancel', { taskId }),
        committed: () => { useWorkspace.getState().notify(editor.view.message); if (editorRef.current === editor) { const offset = editor.page.offset; dropEditor(); if (latest.current.active) void controller.load(applied.current, offset); } },
      });
      // 构造阶段仅复制本地值；准确页交接成功后才把编辑器登记为快照拥有者。
      if (!controller.adopt(received)) { controller.releaseUnadopted(received); return; }
      editorRef.current = editor; setEditView(editor.view); setSelectedRow(editor.view.rows[0]?.id);
    } catch (reason) { setValidation(errorMessage(reason)); controller.releaseUnadopted(received); }
  }, [view.page]);
  useEffect(() => { const unsubscribe = useWorkspace.subscribe(() => editorRef.current?.observe()); const timer = setInterval(() => editorRef.current?.observe(), 5000); return () => { unsubscribe(); clearInterval(timer); editorRef.current?.dispose(); }; }, []);
  const page = editView && (editView.dirty || !view.page || editView.page === view.page) ? editView.page : view.page;
  const names = (page?.columns ?? view.columns).map(column => column.name), invalidTarget = profile?.dialect !== 'sqlite' || tab.database !== 'main' || !tab.table;
  /** 只有明确放弃或无草稿时可替换当前页，运行中写操作从不被读取入口打断。 */
  function dropEditor(): void { editorRef.current?.dispose(); editorRef.current = null; inputRef.current = null; previewRef.current = null; setEditView(null); setCellInput(null); setPreviewOpen(null); const now = useWorkspace.getState(); if (now.settings.tabs.find(item => item.id === tab.id) === tab && now.dirtyTabs[tab.id]) now.setDirty(tab.id, false); }
  function prepareRead(): boolean { const editor = editorRef.current; if (editor?.busy) return false; if (editor?.dirty && !window.confirm(editText.confirmDiscard)) return false; dropEditor(); return true; }
  /** 操作读取同步目标和占用，旧按钮与隐藏标签不得开始新读取。 */
  function available(): boolean { const workspace = useWorkspace.getState(); return active && !invalidTarget && workspace.settings.tabs.find(item => item.id === tab.id) === tab && workspace.settings.activeTabId === tab.id && workspace.connections.find(item => item.id === tab.connectionId) === profile && (workspace.connectionVersions[tab.connectionId] ?? 0) === version && (!workspace.activeJobs[tab.id] || view.busy) && !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 表单只在明确应用时严格校验并读取，类型或顺序编辑本身不发送请求。 */
  function apply() {
    if (!available()) return;
    try { const next = sqliteTableDraft({ connectionId: tab.connectionId, database: tab.database, table: tab.table }, limit, mode, filters, sort); if (!prepareRead()) return; applied.current = next; setValidation(''); void controller.load(next, 0); }
    catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 翻页和刷新沿原已应用配置，不把尚未应用的条件带入请求。 */
  function read(offset: number) { if (available() && prepareRead()) { setValidation(''); void controller.load(applied.current, offset); } }
  /** 导出只冻结当前页原值；不读取全表，不生成 MySQL INSERT SQL。 */
  function exportPage() { if (!page || !available() || !controller.pageCurrent(page)) return; try { setExportData(resultExportData(structuredClone(page.result))); } catch (reason) { setValidation(errorMessage(reason)); } }
  /** 全量导出只捕获准确当前页的元数据与已应用条件，不取尚未应用的表单草稿。 */
  function openAllExport() {
    if (!page || !available() || !controller.pageCurrent(page) || fullExportRef.current) return;
    try {
      const query = applied.current; let owner!: FullExportOwner;
      const intent = new SqliteTableExportIntent(page, query, [page, query, tab, profile, version, active], () => {
        const now = useWorkspace.getState();
        return latest.current.active && latest.current.tab === tab && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && applied.current === query && controller.pageCurrent(page) && (!now.activeJobs[tab.id] || owner.acquiring || owner.lease?.owns() === true);
      });
      owner = { intent, acquiring: false }; if (!intent.current()) throw Error(exportText.stale);
      fullExportRef.current = owner; setFullExport(owner); setValidation('');
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** chooser及流式请求分别取得准确作业租约；自身同步占用不使来源自失效，旧收尾不清他人作业。 */
  function fullExportActivity(owner: FullExportOwner, delta: 1 | -1) {
    if (delta === 1) {
      if (fullExportRef.current !== owner || owner.lease || !owner.intent.current()) throw Error(exportText.stale);
      owner.acquiring = true;
      try { owner.lease = acquireWorkspaceBusy(tab.id); } finally { owner.acquiring = false; }
    } else { const lease = owner.lease; owner.lease = undefined; lease?.release(); }
  }
  /** 对话框已等待原操作及取消确认收尾，关闭只撤销本次意图，不提前释放运行中的资源。 */
  function closeAllExport(owner: FullExportOwner) { owner.intent.invalidate(); if (fullExportRef.current === owner) { fullExportRef.current = null; setFullExport(null); } }
  /** 条件编辑只更新本地草稿，不附带任何读取。 */
  function updateFilter(id: string, patch: Partial<SqliteFilterDraft>) { setFilters(values => values.map(value => value.id === id ? { ...value, ...patch } : value)); }
  /** NULL 去掉值，包含固定文本；无效的类型比较由严格合同在应用前拒绝。 */
  function changeOperator(id: string, operator: SqliteFilterDraft['operator']) { setFilters(values => values.map(value => value.id === id ? { ...value, operator, ...(operator === 'contains' ? { kind: 'text' as const } : {}) } : value)); }
  /** 顺序即服务端 ORDER BY 优先级；只移动草稿，应用时才发送。 */
  function moveSort(index: number, offset: -1 | 1) { setSort(values => { const next = [...values], to = index + offset; if (to < 0 || to >= next.length) return values; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  useUiCommandScope('tab:' + tab.id, { stop: { enabled: active && view.busy, run: () => { void controller.stop(); } }, export: { enabled: active && !!page && !view.busy && !externalBusy, run: exportPage } }, { active, contextKey: JSON.stringify([tab.id, version, page?.offset, page?.limit, view.busy]) });
  const renderedEditor = editorRef.current?.page === editView?.page ? editorRef.current : null, editRows = editView?.rows ?? [];
  /** 每个编辑入口绑定准确渲染、编辑器、页和草稿数组；同名 row id 不提供跨页授权。 */
  function editActionCurrent(writable = true): boolean {
    return editRender.current === editRenderTicket && !!renderedEditor && editorRef.current === renderedEditor && renderedEditor.page === page && renderedEditor.view.rows === editRows && latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id && (!writable || renderedEditor.canEdit());
  }
  /** 选格只认可本次 rows 中的原对象，旧 grid 事件不能选中新页同 id 记录。 */
  function selectEditRow(row: SqliteDraftRow): void { if (editActionCurrent(false) && editRows.includes(row)) setSelectedRow(row.id); }
  function openInput(editor: SqliteTableEditor, row: SqliteDraftRow, column?: number): void {
    const ticket: EditInputTicket = { id: uid(), editor, page: editor.page, rows: editor.view.rows, row, column };
    inputRef.current = ticket; editor.inputOpen(true); setCellInput(ticket);
  }
  /** 单元格与整行输入仅写入原草稿，对话框未保存文本也登记 dirty 防关闭丢失。 */
  function editRow(row: SqliteDraftRow, column?: number): void { if (!editActionCurrent() || !available() || !editRows.includes(row) || row.deleted || inputRef.current || previewRef.current) return; openInput(renderedEditor!, row, column); }
  function inputCurrent(ticket: EditInputTicket): boolean { return inputRef.current === ticket && editorRef.current === ticket.editor && ticket.editor.page === ticket.page && ticket.editor.view.rows === ticket.rows && ticket.rows.includes(ticket.row) && ticket.editor.canEdit(); }
  function saveInput(ticket: EditInputTicket, values: (SqliteOriginalValue | undefined)[]): boolean { if (!inputCurrent(ticket)) return false; ticket.editor.save(ticket.row.id, values); if (inputRef.current !== ticket || editorRef.current !== ticket.editor) return false; inputRef.current = null; ticket.editor.inputOpen(false); setCellInput(null); return true; }
  /** 关闭只消费准确输入票据；旧 Modal 的关闭不能清除后继窗口或新编辑器 dirty。 */
  function closeInput(ticket: EditInputTicket): void { if (inputRef.current !== ticket || editorRef.current !== ticket.editor || ticket.editor.page !== ticket.page || ticket.editor.view.rows !== ticket.rows) return; inputRef.current = null; ticket.editor.inputOpen(false); setCellInput(null); }
  function addRow(): void { if (!editActionCurrent() || !available() || inputRef.current || previewRef.current) return; const editor = renderedEditor!, id = editor.add(), row = editor.view.rows.find(row => row.id === id); if (row) { setSelectedRow(row.id); openInput(editor, row); } }
  function removeRow(): void { const row = editRows.find(row => row.id === selectedRow); if (row && editActionCurrent() && available() && window.confirm(editText.confirmDelete) && editActionCurrent() && editRows.includes(row)) renderedEditor!.remove(row.id); }
  function undoEdit(): void { if (editActionCurrent() && available()) renderedEditor!.undo(); }
  function redoEdit(): void { if (editActionCurrent() && available()) renderedEditor!.redo(); }
  function discardEdit(): void { if (!editActionCurrent(false) || renderedEditor!.busy || !available() || !window.confirm(editText.confirmDiscard) || !editActionCurrent(false)) return; renderedEditor!.discard(); read(page?.offset ?? 0); }
  function previewChanges(): void { if (!editActionCurrent() || !available() || previewRef.current || inputRef.current) return; const editor = renderedEditor!, ticket: EditPreviewTicket = { id: uid(), editor, page: editor.page, rows: editRows }; previewRef.current = ticket; setPreviewOpen(ticket); void editor.preview(); }
  /** 预览事件同时绑定准确回执与 task；旧 pending 预览的 stop 不得取消后继 apply。 */
  function previewCurrent(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined, taskId: string | undefined): boolean { const current = ticket.editor.view; return previewRef.current === ticket && editorRef.current === ticket.editor && ticket.editor.page === ticket.page && current.rows === ticket.rows && current.preview === expected && current.taskId === taskId && latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id; }
  function applyPreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined): void { if (!expected || !previewCurrent(ticket, expected, undefined) || !ticket.editor.canEdit()) return; void ticket.editor.apply(); }
  function closePreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined): void { if (!previewCurrent(ticket, expected, undefined) || ticket.editor.busy) return; previewRef.current = null; ticket.editor.closePreview(); setPreviewOpen(null); }
  function stopPreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined, taskId: string | undefined): void { if (taskId && previewCurrent(ticket, expected, taskId)) ticket.editor.stop(); }
  const changes = renderedEditor?.changes ?? [], counts = { insert: changes.filter(change => change.kind === 'insert').length, update: changes.filter(change => change.kind === 'update').length, delete: changes.filter(change => change.kind === 'delete').length };
  const editBlocked = !active || externalBusy || !editView?.valid || editView.unknown || !!cellInput;
  const fieldOptions = (page?.columns ?? view.columns).map((column, index) => <option key={index} value={column.name}>{column.name} · {column.declaredType || text.dynamic}</option>);
  return <div className="workspace-tab table-tab sqlite-table-tab" aria-label={text.title} data-readonly={editView ? 'false' : 'true'}>
    <div className="context-bar"><span className="connection-dot" style={{ background: profile?.color }}/><strong>{profile?.name ?? tab.connectionId}</strong><span>/</span><span>{tab.database}</span><span>/</span><strong>{tab.table}</strong><span className="grow"/><span className="tag">SQLite · {text.title}</span></div>
    <div className="toolbar"><button aria-label={text.refresh} disabled={!active || invalidTarget || !!exportData || externalBusy && !view.busy} onClick={() => read(page?.offset ?? 0)}>{text.refresh}</button><button aria-label={text.stop} disabled={!view.busy} onClick={() => void controller.stop()}>{text.stop}</button><button aria-expanded={conditions} onClick={() => setConditions(value => !value)}>{text.conditions}</button><button aria-label={sqliteZh.selectQuery} disabled={invalidTarget || view.busy || externalBusy} onClick={() => { if (available()) openSqliteSelect(tab.connectionId, tab.database!, { name: tab.table!, kind: page?.target.kind ?? 'table' }); }}>{sqliteZh.selectQuery}</button><button aria-label={text.export} disabled={!page || view.busy || externalBusy} onClick={exportPage}>{text.export}</button><button aria-label={exportText.entry} disabled={!page || view.busy || externalBusy || !!fullExport} onClick={openAllExport}>{exportText.entry}</button></div>
    <p className="sqlite-browse-hint">{editView ? editText.editable : page?.edit?.kind === 'readonly' ? page.edit.reason : text.readonly}</p>
    {conditions && <div className="sqlite-browse-conditions"><p className="muted small">{text.typesHint}</p><fieldset aria-label={text.filters}><legend>{text.filters}</legend><select aria-label={text.mode} value={mode} onChange={event => setMode(event.target.value as 'and' | 'or')}><option value="and">AND</option><option value="or">OR</option></select><button disabled={!names.length || filters.length >= sqliteTableBrowseLimits.filters} onClick={() => setFilters(values => values.length >= sqliteTableBrowseLimits.filters ? values : [...values, { id: uid(), column: names[0], operator: 'eq', kind: 'text', value: '' }])}>{text.addFilter}</button>
      {filters.map((filter, index) => <div className="sqlite-browse-rule" key={filter.id}><select aria-label={text.filterColumn(index + 1)} value={filter.column} onChange={event => updateFilter(filter.id, { column: event.target.value })}>{fieldOptions}</select><select aria-label={text.filterOperator(index + 1)} value={filter.operator} onChange={event => changeOperator(filter.id, event.target.value as SqliteFilterDraft['operator'])}>{Object.entries(text.operators).map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}</select>{!['isNull', 'notNull'].includes(filter.operator) && <><select aria-label={text.filterKind(index + 1)} value={filter.kind} onChange={event => updateFilter(filter.id, { kind: event.target.value as SqliteFilterDraft['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind} disabled={filter.operator === 'contains' && kind !== 'text' || kind === 'blob' && !['eq', 'ne'].includes(filter.operator)}>{label}</option>)}</select><input aria-label={text.filterValue(index + 1)} value={filter.value} maxLength={sqliteTableBrowseLimits.valueUnits} onChange={event => updateFilter(filter.id, { value: event.target.value })}/></>}<button aria-label={text.removeFilter(index + 1)} onClick={() => setFilters(values => values.filter(value => value.id !== filter.id))}>×</button></div>)}</fieldset>
      <fieldset aria-label={text.sorts}><legend>{text.sorts}</legend><button disabled={!names.length || sort.length >= sqliteTableBrowseLimits.sorts || sort.length >= names.length} onClick={() => setSort(values => { if (values.length >= sqliteTableBrowseLimits.sorts) return values; const column = names.find(name => !values.some(value => value.column === name)); return column ? [...values, { id: uid(), column, direction: 'asc' }] : values; })}>{text.addSort}</button>{sort.map((rule, index) => <div className="sqlite-browse-rule" key={rule.id}><span>{index + 1}</span><select aria-label={text.sortColumn(index + 1)} value={rule.column} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, column: event.target.value } : value))}>{view.columns.map((column, columnIndex) => <option key={columnIndex} value={column.name} disabled={sort.some(value => value.id !== rule.id && value.column === column.name)}>{column.name}</option>)}</select><select aria-label={text.sortDirection(index + 1)} value={rule.direction} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, direction: event.target.value as 'asc' | 'desc' } : value))}><option value="asc">{text.ascending}</option><option value="desc">{text.descending}</option></select><button aria-label={text.up(index + 1)} disabled={index === 0} onClick={() => moveSort(index, -1)}>↑</button><button aria-label={text.down(index + 1)} disabled={index === sort.length - 1} onClick={() => moveSort(index, 1)}>↓</button><button aria-label={text.removeSort(index + 1)} onClick={() => setSort(values => values.filter(value => value.id !== rule.id))}>×</button></div>)}</fieldset>
      <label>{text.limit}<input aria-label={text.limit} type="number" min={1} max={sqliteTableBrowseLimits.pageSize} value={limit} onChange={event => setLimit(Number(event.target.value))}/></label><button className="primary" disabled={!active || invalidTarget || externalBusy && !view.busy} onClick={apply}>{text.apply}</button></div>}
    <ErrorBox message={invalidTarget ? text.unsupported : validation || view.error}/>
    <div className="sqlite-browse-result">{view.busy ? <div className="empty"><Spinner text={view.stopping ? text.stopping : text.loading}/></div> : page && editView && editView.page === page ? <SqliteTableEditGrid page={page} rows={editView.rows} disabled={editBlocked} selected={selectedRow} isCurrent={() => editActionCurrent(false)} onSelect={selectEditRow} onEdit={editRow}/> : page ? <ResultsGrid columns={page.result.columns} rows={page.result.rows} selectionScope={page} isCurrent={() => controller.pageCurrent(page) && available() && !externalBusy} binaryFileActions={false}/> : <Empty title={text.noPage}/>}</div>
    {editView && <div className="table-action-bar"><span role="status">{editText.counts(counts.insert, counts.update, counts.delete)}</span><button aria-label={editText.add} disabled={editBlocked} onClick={addRow}>{editText.add}</button><button aria-label={editText.editRow} disabled={editBlocked || !selectedRow || editRows.find(row => row.id === selectedRow)?.deleted} onClick={() => { const row = editRows.find(row => row.id === selectedRow); if (row) editRow(row); }}>{editText.editRow}</button><button aria-label={editText.remove} disabled={editBlocked || !selectedRow || editRows.find(row => row.id === selectedRow)?.deleted} onClick={removeRow}>{editText.remove}</button><button aria-label={editText.undo} disabled={editBlocked || !editView.undo} onClick={undoEdit}>{editText.undo}</button><button aria-label={editText.redo} disabled={editBlocked || !editView.redo} onClick={redoEdit}>{editText.redo}</button><button aria-label={editText.discard} disabled={editView.busy || !editView.dirty} onClick={discardEdit}>{editText.discard}</button><button className="primary" aria-label={editText.preview} disabled={editBlocked || !changes.length} onClick={previewChanges}>{editText.preview}</button></div>}
    {editView?.message && <p role="status" className="sqlite-browse-hint">{editView.message}</p>}
    <div className="tab-status"><button aria-label={text.first} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(0)}>{text.first}</button><button aria-label={text.previous} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(Math.max(0, page!.offset - page!.limit))}>{text.previous}</button><button aria-label={text.next} disabled={view.busy || !page?.hasMore || externalBusy || page.offset + page.limit > sqliteTableBrowseLimits.offset} onClick={() => read(page!.offset + page!.limit)}>{text.next}</button><span>{page ? text.page(page.offset, page.result.rows.length, page.hasMore) : ''}</span><span className="grow"/><small title={text.noCount}>{text.noCount}</small></div>
    {fullExport && <SqliteTableExportDialog intent={fullExport.intent} onActivity={delta => fullExportActivity(fullExport, delta)} onClose={() => closeAllExport(fullExport)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onCommitted={(output, _changed, content) => useWorkspace.getState().notify(content === 'structure' ? exportText.structureCommittedChanged : exportText.committedChanged(output.rows))}/>}
    {exportData && <ResultExportDialog result={exportData} tabId={tab.id} scope="table" allowSql={false} onClose={() => setExportData(null)}/>}
    {cellInput && <SqliteTableValueDialog key={cellInput.id} ticket={cellInput} page={cellInput.page} row={cellInput.row} column={cellInput.column} current={() => inputCurrent(cellInput)} onSave={values => saveInput(cellInput, values)} onClose={() => closeInput(cellInput)}/>}
    {previewOpen && editView && previewOpen.editor === renderedEditor && <SqliteTablePreviewDialog key={previewOpen.id + ':' + (editView.preview?.previewId ?? 'pending')} ticket={previewOpen} view={editView} current={() => previewCurrent(previewOpen, editView.preview, editView.taskId)} onApply={() => applyPreview(previewOpen, editView.preview)} onClose={() => closePreview(previewOpen, editView.preview)} onStop={() => stopPreview(previewOpen, editView.preview, editView.taskId)}/>}
  </div>;
}
