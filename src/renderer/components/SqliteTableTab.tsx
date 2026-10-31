import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ResultExportData } from '../../shared/contracts';
import { sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { resultExportData } from '../resultExport';
import { SqliteTableBrowser, sqliteTableDraft, type SqliteTableQuery, type SqliteTableView, type SqliteFilterDraft, type SqliteSortDraft } from '../sqliteTableBrowser';
import { sqliteTableBrowseZh as text } from '../locales/sqliteTableBrowse.zh-CN';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { openSqliteSelect } from '../sqliteNavigation';
import { useUiCommandScope } from '../uiCommands';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { Empty, ErrorBox, Spinner } from './ui';
import '../sqliteTableBrowse.css';

/** 初次请求只读取无条件第一页，不恢复未明确应用的草稿条件。 */
const initialQuery = (): SqliteTableQuery => ({ limit: 100, mode: 'and', filters: [], sort: [] });
/** 原 table 标签的 SQLite 分支只浏览现存数据，永远不创建查询会话、编辑器或事务。 */
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
  const [controller] = useState(() => new SqliteTableBrowser({
    scope: () => {
      const current = latest.current, workspace = useWorkspace.getState(), present = workspace.settings.tabs.find(item => item.id === current.tab.id), connection = workspace.connections.find(item => item.id === current.tab.connectionId);
      return { tab: present, profile: connection, connectionId: current.tab.connectionId, database: current.tab.database, table: current.tab.table, version: workspace.connectionVersions[current.tab.connectionId] ?? 0, present: present === current.tab && present?.kind === 'table', active: current.active && workspace.settings.activeTabId === current.tab.id, sqlite: connection?.dialect === 'sqlite' };
    },
    acquire: () => acquireWorkspaceBusy(latest.current.tab.id), read: input => invoke('sqlite.tablePage', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid, changed: setView, subscribe: changed => useWorkspace.subscribe(changed),
  }));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const target = useRef({ profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table });
  /** 新连接修订先清旧条件；初次只读无条件第一页，重新激活同目标沿已明确应用的配置。 */
  useEffect(() => {
    const before = target.current, changed = before.profile !== profile || before.version !== version || before.connectionId !== tab.connectionId || before.database !== tab.database || before.table !== tab.table;
    target.current = { profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table };
    if (changed) { applied.current = initialQuery(); setLimit(100); setMode('and'); setFilters([]); setSort([]); setValidation(''); }
    if (active) void controller.load(applied.current, 0); else controller.observe();
  }, [controller, active, profile, version, tab.connectionId, tab.database, tab.table]);
  useLayoutEffect(() => { controller.observe(); });
  const page = view.page, names = view.columns.map(column => column.name), invalidTarget = profile?.dialect !== 'sqlite' || tab.database !== 'main' || !tab.table;
  /** 操作读取同步目标和占用，旧按钮与隐藏标签不得开始新读取。 */
  function available(): boolean { const workspace = useWorkspace.getState(); return active && !invalidTarget && workspace.settings.tabs.find(item => item.id === tab.id) === tab && workspace.settings.activeTabId === tab.id && workspace.connections.find(item => item.id === tab.connectionId) === profile && (workspace.connectionVersions[tab.connectionId] ?? 0) === version && (!workspace.activeJobs[tab.id] || view.busy) && !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 表单只在明确应用时严格校验并读取，类型或顺序编辑本身不发送请求。 */
  function apply() {
    if (!available()) return;
    try { const next = sqliteTableDraft({ connectionId: tab.connectionId, database: tab.database, table: tab.table }, limit, mode, filters, sort); applied.current = next; setValidation(''); void controller.load(next, 0); }
    catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 翻页和刷新沿原已应用配置，不把尚未应用的条件带入请求。 */
  function read(offset: number) { if (available()) { setValidation(''); void controller.load(applied.current, offset); } }
  /** 导出只冻结当前页原值；不读取全表，不生成 MySQL INSERT SQL。 */
  function exportPage() { if (!page || !available() || !controller.pageCurrent(page)) return; try { setExportData(resultExportData(structuredClone(page.result))); } catch (reason) { setValidation(errorMessage(reason)); } }
  /** 条件编辑只更新本地草稿，不附带任何读取。 */
  function updateFilter(id: string, patch: Partial<SqliteFilterDraft>) { setFilters(values => values.map(value => value.id === id ? { ...value, ...patch } : value)); }
  /** NULL 去掉值，包含固定文本；无效的类型比较由严格合同在应用前拒绝。 */
  function changeOperator(id: string, operator: SqliteFilterDraft['operator']) { setFilters(values => values.map(value => value.id === id ? { ...value, operator, ...(operator === 'contains' ? { kind: 'text' as const } : {}) } : value)); }
  /** 顺序即服务端 ORDER BY 优先级；只移动草稿，应用时才发送。 */
  function moveSort(index: number, offset: -1 | 1) { setSort(values => { const next = [...values], to = index + offset; if (to < 0 || to >= next.length) return values; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  useUiCommandScope('tab:' + tab.id, { stop: { enabled: active && view.busy, run: () => { void controller.stop(); } }, export: { enabled: active && !!page && !view.busy && !externalBusy, run: exportPage } }, { active, contextKey: JSON.stringify([tab.id, version, page?.offset, page?.limit, view.busy]) });
  const fieldOptions = view.columns.map((column, index) => <option key={index} value={column.name}>{column.name} · {column.declaredType || text.dynamic}</option>);
  return <div className="workspace-tab table-tab sqlite-table-tab" aria-label={text.title} data-readonly="true">
    <div className="context-bar"><span className="connection-dot" style={{ background: profile?.color }}/><strong>{profile?.name ?? tab.connectionId}</strong><span>/</span><span>{tab.database}</span><span>/</span><strong>{tab.table}</strong><span className="grow"/><span className="tag">SQLite · {text.title}</span></div>
    <div className="toolbar"><button aria-label={text.refresh} disabled={!active || invalidTarget || !!exportData || externalBusy && !view.busy} onClick={() => read(page?.offset ?? 0)}>{text.refresh}</button><button aria-label={text.stop} disabled={!view.busy} onClick={() => void controller.stop()}>{text.stop}</button><button aria-expanded={conditions} onClick={() => setConditions(value => !value)}>{text.conditions}</button><button aria-label={sqliteZh.selectQuery} disabled={invalidTarget || view.busy || externalBusy} onClick={() => { if (available()) openSqliteSelect(tab.connectionId, tab.database!, { name: tab.table!, kind: page?.target.kind ?? 'table' }); }}>{sqliteZh.selectQuery}</button><button aria-label={text.export} disabled={!page || view.busy || externalBusy} onClick={exportPage}>{text.export}</button></div>
    <p className="sqlite-browse-hint">{text.readonly}</p>
    {conditions && <div className="sqlite-browse-conditions"><p className="muted small">{text.typesHint}</p><fieldset aria-label={text.filters}><legend>{text.filters}</legend><select aria-label={text.mode} value={mode} onChange={event => setMode(event.target.value as 'and' | 'or')}><option value="and">AND</option><option value="or">OR</option></select><button disabled={!names.length || filters.length >= sqliteTableBrowseLimits.filters} onClick={() => setFilters(values => values.length >= sqliteTableBrowseLimits.filters ? values : [...values, { id: uid(), column: names[0], operator: 'eq', kind: 'text', value: '' }])}>{text.addFilter}</button>
      {filters.map((filter, index) => <div className="sqlite-browse-rule" key={filter.id}><select aria-label={text.filterColumn(index + 1)} value={filter.column} onChange={event => updateFilter(filter.id, { column: event.target.value })}>{fieldOptions}</select><select aria-label={text.filterOperator(index + 1)} value={filter.operator} onChange={event => changeOperator(filter.id, event.target.value as SqliteFilterDraft['operator'])}>{Object.entries(text.operators).map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}</select>{!['isNull', 'notNull'].includes(filter.operator) && <><select aria-label={text.filterKind(index + 1)} value={filter.kind} onChange={event => updateFilter(filter.id, { kind: event.target.value as SqliteFilterDraft['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind} disabled={filter.operator === 'contains' && kind !== 'text' || kind === 'blob' && !['eq', 'ne'].includes(filter.operator)}>{label}</option>)}</select><input aria-label={text.filterValue(index + 1)} value={filter.value} maxLength={sqliteTableBrowseLimits.valueUnits} onChange={event => updateFilter(filter.id, { value: event.target.value })}/></>}<button aria-label={text.removeFilter(index + 1)} onClick={() => setFilters(values => values.filter(value => value.id !== filter.id))}>×</button></div>)}</fieldset>
      <fieldset aria-label={text.sorts}><legend>{text.sorts}</legend><button disabled={!names.length || sort.length >= sqliteTableBrowseLimits.sorts || sort.length >= names.length} onClick={() => setSort(values => { if (values.length >= sqliteTableBrowseLimits.sorts) return values; const column = names.find(name => !values.some(value => value.column === name)); return column ? [...values, { id: uid(), column, direction: 'asc' }] : values; })}>{text.addSort}</button>{sort.map((rule, index) => <div className="sqlite-browse-rule" key={rule.id}><span>{index + 1}</span><select aria-label={text.sortColumn(index + 1)} value={rule.column} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, column: event.target.value } : value))}>{view.columns.map((column, columnIndex) => <option key={columnIndex} value={column.name} disabled={sort.some(value => value.id !== rule.id && value.column === column.name)}>{column.name}</option>)}</select><select aria-label={text.sortDirection(index + 1)} value={rule.direction} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, direction: event.target.value as 'asc' | 'desc' } : value))}><option value="asc">{text.ascending}</option><option value="desc">{text.descending}</option></select><button aria-label={text.up(index + 1)} disabled={index === 0} onClick={() => moveSort(index, -1)}>↑</button><button aria-label={text.down(index + 1)} disabled={index === sort.length - 1} onClick={() => moveSort(index, 1)}>↓</button><button aria-label={text.removeSort(index + 1)} onClick={() => setSort(values => values.filter(value => value.id !== rule.id))}>×</button></div>)}</fieldset>
      <label>{text.limit}<input aria-label={text.limit} type="number" min={1} max={sqliteTableBrowseLimits.pageSize} value={limit} onChange={event => setLimit(Number(event.target.value))}/></label><button className="primary" disabled={!active || invalidTarget || externalBusy && !view.busy} onClick={apply}>{text.apply}</button></div>}
    <ErrorBox message={invalidTarget ? text.unsupported : validation || view.error}/>
    <div className="sqlite-browse-result">{view.busy ? <div className="empty"><Spinner text={view.stopping ? text.stopping : text.loading}/></div> : page ? <ResultsGrid columns={page.result.columns} rows={page.result.rows} selectionScope={page} isCurrent={() => controller.pageCurrent(page) && available() && !externalBusy} binaryFileActions={false}/> : <Empty title={text.noPage}/>}</div>
    <div className="tab-status"><button aria-label={text.first} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(0)}>{text.first}</button><button aria-label={text.previous} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(Math.max(0, page!.offset - page!.limit))}>{text.previous}</button><button aria-label={text.next} disabled={view.busy || !page?.hasMore || externalBusy || page.offset + page.limit > sqliteTableBrowseLimits.offset} onClick={() => read(page!.offset + page!.limit)}>{text.next}</button><span>{page ? text.page(page.offset, page.result.rows.length, page.hasMore) : ''}</span><span className="grow"/><small title={text.noCount}>{text.noCount}</small></div>
    {exportData && <ResultExportDialog result={exportData} tabId={tab.id} scope="table" allowSql={false} onClose={() => setExportData(null)}/>}
  </div>;
}
