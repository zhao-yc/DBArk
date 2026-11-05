import { useEffect, useRef, useState } from 'react';
import type { DataRow } from '../../shared/contracts';
import { postgresRelationSelect } from '../../shared/postgresSql';
import {
  isPostgresTableFiltered, postgresTableLimits, postgresTablePreviewSchema, type PostgresTableChange, type PostgresTableField,
  type PostgresTablePage, type PostgresTablePageInput, type PostgresTablePreview, type PostgresTableTarget,
} from '../../shared/postgresTable';
import { cellPreview, cellText, errorMessage, invoke } from '../lib';
import { postgresStructureZh } from '../locales/postgresStructure.zh-CN';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { PostgresTableExportDialog } from './PostgresTableExportDialog';
import { postgresTableExportZh } from '../locales/postgresTableExport.zh-CN';
import { PostgresTableImportDialog } from './PostgresTableImportDialog';
import { PostgresTableFilterPanel } from './PostgresTableFilterPanel';
import { postgresTableImportZh } from '../locales/postgresTableImport.zh-CN';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresTableTab.css';

type PageOptions = Pick<PostgresTablePageInput, 'offset' | 'limit' | 'filter' | 'sort'>;
type Editable = Extract<PostgresTableChange, { kind: 'insert' | 'update' }>;
type DraftEntry = { change: PostgresTableChange & { pageToken: string }; rowKey?: string; offset: number };
type Mode = PostgresTableField['value']['mode'] | 'unchanged';

/** 表单只产生字段和值，明确区分保留原值、空串、NULL及DEFAULT。 */
function RecordForm({ page, row, initial, onSave, onClose }: {
  page: PostgresTablePage; row: number | null; initial?: Editable; onSave(change: Editable): void; onClose(): void;
}) {
  const [fields, setFields] = useState(() => new Map(initial?.fields.map(field => [field.column, field.value])));
  const [error, setError] = useState('');
  const original: DataRow | undefined = row === null ? undefined : page.rows[row];

  /** 切换模式时从原值初始化，数据库生成列没有可编辑入口。 */
  function changeMode(key: string, mode: Mode) {
    setFields(previous => {
      const result = new Map(previous);
      if (mode === 'unchanged') result.delete(key);
      else if (mode === 'null' || mode === 'default') result.set(key, { mode });
      else {
        const old = original?.[key];
        const initial = old === null || old === undefined ? '' : cellText(old);
        result.set(key, { mode, value: mode === 'binary' ? (initial.startsWith('0x') ? initial.slice(2) : '') : initial });
      }
      return result;
    });
  }

  /** 表单保存只更新内存草稿。 */
  function submit() {
    const list = Array.from(fields, ([column, value]) => ({ column, value }));
    if (row !== null && !list.length) { setError(text.noChange); return; }
    try { onSave(row === null ? { kind: 'insert', fields: list } : { kind: 'update', row, fields: list }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={row === null ? text.add : text.edit} onClose={onClose} wide>
    <div className="modal-content pg-record-form">
      {page.columns.map(column => {
        const value = fields.get(column.key);
        return <div className="pg-record-field" key={column.key}>
          <strong>{column.name} <small className="muted">{column.type}</small></strong>
          {original && <div className="muted">{text.original}　{cellPreview(original[column.key])}</div>}
          {column.generated ? <span className="muted">{text.generated}</span> : <div className="pg-record-inputs">
            <select aria-label={column.name + ' ' + text.valueMode} value={value?.mode ?? 'unchanged'} onChange={event => changeMode(column.key, event.target.value as Mode)}>
              <option value="unchanged">{row === null ? text.default : text.unchanged}</option>
              <option value="text">{text.text}</option>
              {column.binary && <option value="binary">{text.hex}</option>}
              {column.nullable && <option value="null">{text.null}</option>}
              {row !== null && <option value="default">{text.default}</option>}
            </select>
            {value && 'value' in value && <textarea aria-label={column.name + ' ' + text.value} value={value.value}
              maxLength={postgresTableLimits.value} rows={2} onChange={event => {
                const next = event.target.value;
                setFields(previous => new Map(previous).set(column.key, { ...value, value: next }));
              }}/>}
          </div>}
        </div>;
      })}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{text.cancel}</button><button className="primary" onClick={submit}>{text.stage}</button></footer>
  </Modal>;
}

/** 浏览、选择、草稿及回执归属于同一标签及原页，隐藏标签保留本地工作。 */
export function PostgresTableTab({ tab, active, onInspect }: { tab: WorkspaceTab; active: boolean; onInspect(): void }) {
  const limit = useWorkspace(state => state.settings.pageSize);
  const [options, setOptions] = useState<PageOptions>({ offset: 0, limit: Math.min(postgresTableLimits.page, limit) });
  const [page, setPage] = useState<PostgresTablePage>();
  const [exportPage, setExportPage] = useState<PostgresTablePage>();
  const [importPage, setImportPage] = useState<PostgresTablePage>();
  const [row, setRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const [form, setForm] = useState<{ row: number | null }>();
  const [preview, setPreview] = useState<PostgresTablePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [filterColumn, setFilterColumn] = useState('');
  const [filterText, setFilterText] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [pageSize, setPageSize] = useState(options.limit);
  const lease = useRef<object | undefined>(undefined);
  const issued = useRef<string | undefined>(undefined);
  const lifetime = useRef<object | undefined>(undefined);
  const started = useRef(false);
  const target: PostgresTableTarget = { connectionId: tab.connectionId, database: tab.database ?? 'postgres', table: tab.table ?? '', tabId: tab.id };

  /** 操作回包只能发布到原组件代次，加载或应用进行时由全局标签忙碌屏障保护。 */
  async function run(action: (isCurrent: () => boolean) => Promise<void>, onError?: (reason: unknown) => void) {
    const life = lifetime.current;
    if (!life || lease.current) return;
    const owner = {}, job = acquireWorkspaceBusy(tab.id);
    lease.current = owner;
    const isCurrent = () => lifetime.current === life && lease.current === owner;
    setBusy(true);
    setError('');
    try { await action(isCurrent); }
    catch (reason) { if (isCurrent()) { setError(errorMessage(reason)); onError?.(reason); } }
    finally {
      if (isCurrent()) setBusy(false);
      if (lease.current === owner) lease.current = undefined;
      job.release();
    }
  }

  /** 只发布完整回包，旧组件迟到的原页能力显式释放。 */
  async function read(next: PageOptions, isCurrent: () => boolean, retainPageTokens: string[] = []) {
    const result = await invoke('postgres.table.page', { ...target, ...next,
      ...(retainPageTokens.length ? { retainPageTokens } : {}) });
    if (!isCurrent()) {
      const token = result.exportToken ?? result.pageToken;
      if (token) await invoke('postgres.table.release', { ...target, pageToken: token }).catch(() => {});
      return;
    }
    issued.current = result.exportToken ?? result.pageToken;
    setPage(result);
    setOptions(next);
    setPageSize(next.limit);
    setRow(null);
    setRequiresRefresh(false);
    if (!result.columns.some(column => column.name === filterColumn)) setFilterColumn(result.columns[0]?.name ?? '');
  }

  /** 标签移除时只释放本代签发的表页令牌。 */
  useEffect(() => {
    lifetime.current = {};
    return () => {
      lifetime.current = undefined;
      const pageToken = issued.current;
      if (pageToken) void invoke('postgres.table.release', { ...target, pageToken }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void run(isCurrent => read(options, isCurrent));
  }, [active]);

  /** 有草稿时只翻页，明确把仍有草稿的原页交给引擎保留。 */
  function navigate(next: PageOptions, keepDraft = false) {
    if ((!keepDraft && draft.length) || (requiresRefresh && draft.length) || preview || form || lease.current) return;
    setMessage('');
    void run(isCurrent => read(next, isCurrent, [...new Set(draft.map(entry => entry.change.pageToken))]));
  }

  /** 更新草稿及标签退出保护。 */
  function setChanges(next: DraftEntry[]) {
    setDraft(next);
    useWorkspace.getState().setDirty(tab.id, next.length > 0);
  }

  /** 每项保留原页和主键身份，重新编辑同一记录只更新这一个动作。 */
  function stage(change: PostgresTableChange) {
    if (!page?.pageToken || requiresRefresh || lease.current) return;
    const rowKey = change.kind === 'insert' ? undefined : page.rowKeys?.[change.row];
    if (change.kind !== 'insert' && !rowKey) throw Error(text.noKey);
    const prior = rowKey ? draft.find(item => item.rowKey === rowKey) : undefined;
    // 回到该页时保留首次暂存的原行版本，避免把外部写入静默变成新的编辑基线。
    const entry: DraftEntry = prior && prior.change.kind !== 'insert' && change.kind !== 'insert'
      ? { ...prior, change: { ...change, row: prior.change.row, pageToken: prior.change.pageToken } }
      : { change: { ...change, pageToken: page.pageToken }, rowKey, offset: options.offset };
    const next = [...draft.filter(item => rowKey === undefined || item.rowKey !== rowKey), entry];
    const checked = postgresTablePreviewSchema.safeParse({ ...target, pageToken: page.pageToken, changes: next.map(item => item.change) });
    if (!checked.success) throw Error(checked.error.issues[0]?.message ?? text.noChange);
    setChanges(next);
    setForm(undefined);
  }

  /** 预览包含服务端构建的参数语句，点击确认前没有写库。 */
  function prepare() {
    const pageToken = page?.exportToken;
    if (!pageToken || !draft.length || requiresRefresh) return;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.preview', { ...target, pageToken, changes: draft.map(item => item.change) });
      if (isCurrent()) setPreview(result);
    });
  }

  /** 每个预览只发送一次；任何未确认回执都要先刷新核对，避免重复提交。 */
  function apply() {
    const pageToken = page?.exportToken;
    if (!pageToken || !preview || !active) return;
    const previewToken = preview.previewToken;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.apply', { ...target, pageToken, previewToken });
      if (!isCurrent()) return;
      issued.current = undefined;
      setPreview(undefined);
      setRequiresRefresh(true);
      setMessage(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      if (result.outcome === 'committed') {
        setChanges([]);
        await read(options, isCurrent);
      }
    }, () => {
      setPreview(undefined);
      if (!issued.current) return;
      setRequiresRefresh(true);
      setMessage(text.unknown);
    });
  }

  const blocked = busy || !!form || !!preview || !!exportPage || !!importPage;
  const frozenPage = blocked || draft.length > 0;
  const pagingBlocked = blocked || (requiresRefresh && draft.length > 0);
  const writable = !blocked && !requiresRefresh && !!page?.pageToken;
  const firstPage = { ...options, offset: 0, limit: pageSize };
  const appliedAdvanced = options.filter && 'rules' in options.filter ? options.filter : undefined;
  const sortedColumn = page?.columns.find(column => column.name === options.sort?.column);
  const sorted = sortedColumn ? [{ column: sortedColumn.key, direction: options.sort?.direction === 'asc' ? 'ASC' as const : 'DESC' as const }] : [];
  const formKey = form?.row == null ? undefined : page?.rowKeys?.[form.row];
  const stagedChange = formKey ? draft.find(entry => entry.rowKey === formKey)?.change : undefined;
  return <div className="workspace-tab postgres-table-tab" aria-label={text.relation}>
    <div className="context-bar"><strong>{tab.title}</strong><span>PostgreSQL / {target.database}</span></div>
    <div className="query-toolbar pg-table-toolbar">
      <button disabled={frozenPage} onClick={() => navigate({ ...options, limit: pageSize })}>{text.refresh}</button>
      <button disabled={blocked} onClick={onInspect}>{postgresStructureZh.open}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken}
        onClick={() => setExportPage(page)}>{postgresTableExportZh.open}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken || !page.canImport}
        onClick={() => setImportPage(page)}>{postgresTableImportZh.open}</button>
      <button disabled={busy} onClick={() => useWorkspace.getState().openTab({
        kind: 'query', title: tab.title, connectionId: target.connectionId, database: target.database, sql: postgresRelationSelect(target.table),
      })}>{text.query}</button>
      <button disabled={!writable || !page?.capabilities.insert} onClick={() => setForm({ row: null })}>{text.add}</button>
      <button disabled={!writable || !page?.capabilities.update || row === null} onClick={() => setForm({ row })}>{text.edit}</button>
      <button disabled={!writable || !page?.capabilities.delete || row === null} onClick={() => {
        if (row === null) return;
        try { stage({ kind: 'delete', row }); } catch (reason) { setError(errorMessage(reason)); }
      }}>{text.remove}</button>
      <button className="primary" disabled={blocked || requiresRefresh || !page?.exportToken || !draft.length} onClick={prepare}>{text.preview}</button>
      {busy && <Spinner text={text.waiting}/>}
    </div>
    <div className="pg-table-controls">
      <button disabled={pagingBlocked || options.offset === 0}
        onClick={() => navigate({ ...firstPage, limit: draft.length ? options.limit : pageSize }, true)}>{text.first}</button>
      <button disabled={pagingBlocked || options.offset === 0}
        onClick={() => navigate({ ...options, offset: Math.max(0, options.offset - options.limit) }, true)}>{text.previous}</button>
      <button disabled={pagingBlocked || !page?.hasNext || options.offset + options.limit > postgresTableLimits.offset}
        onClick={() => navigate({ ...options, offset: options.offset + options.limit }, true)}>{text.next}</button>
      <Field label={text.pageSize}><input type="number" min={1} max={postgresTableLimits.page} value={pageSize} disabled={frozenPage}
        onChange={event => setPageSize(Math.max(1, Math.min(postgresTableLimits.page, Math.trunc(Number(event.target.value)) || 1)))}/></Field>
      <Field label={text.filterColumn}><select aria-label={text.filterColumn} value={filterColumn} disabled={frozenPage}
        onChange={event => setFilterColumn(event.target.value)}>{page?.columns.map(column => <option key={column.key} value={column.name}>{column.name}</option>)}</select></Field>
      <Field label={text.filterText}><input value={filterText} maxLength={4096} disabled={frozenPage} onChange={event => setFilterText(event.target.value)}/></Field>
      <button disabled={frozenPage || !filterColumn} onClick={() => {
        setAdvancedFilters(false); navigate({ ...firstPage, filter: { column: filterColumn, text: filterText } });
      }}>{text.filter}</button>
      <button disabled={frozenPage} aria-expanded={advancedFilters} onClick={() => setAdvancedFilters(value => !value)}>{text.advancedFilter}</button>
      <button disabled={frozenPage || !options.filter} onClick={() => {
        setAdvancedFilters(false); setFilterText(''); navigate({ ...firstPage, filter: undefined });
      }}>{text.clearFilter}</button>
    </div>
    {advancedFilters && <PostgresTableFilterPanel columns={page?.columns.map(column => column.name) ?? []}
      initial={appliedAdvanced} disabled={frozenPage} onApply={filter => navigate({ ...firstPage, filter })}/>}
    {message && <div className="info-strip" role="status">{message}</div>}
    <ErrorBox message={error}/>
    {page?.truncated && <div className="warning-text">{text.truncated}</div>}
    {page?.order === 'unstable' && <div className="info-strip">{text.unstable}</div>}
    {page && <div className="tab-status"><span>{text.page(options.offset, page.rows.length)}</span><span>{row === null ? text.noSelection : text.selected(row + 1)}</span>
      {appliedAdvanced && <span>{text.activeAdvancedFilter(appliedAdvanced.rules.filter(rule => rule.enabled !== false).length)}</span>}
      {!page.pageToken && <span>{text.noWrite}</span>}
      {requiresRefresh && <span>{text.refreshAfterFailure}</span>}
    </div>}
    <div className="pg-table-grid">
      {page ? <ResultsGrid key={page.exportToken} columns={page.columns} rows={page.rows} rowJump onActiveRowIndexChange={setRow}
        sort={sorted} onSortChange={frozenPage ? undefined : sort => {
          const first = sort[0];
          const column = page.columns.find(column => column.key === first?.column);
          navigate({ ...firstPage, sort: first && column ? { column: column.name, direction: first.direction === 'ASC' ? 'asc' : 'desc' } : undefined });
        }}/> : <Empty title={text.empty}/>}
    </div>
    {draft.length > 0 && <div className="pg-table-draft" aria-label={text.draft}>
      <strong>{text.changes(draft.length)}</strong><button disabled={blocked} onClick={() => setChanges([])}>{text.discard}</button>
      <ol>{draft.map(({ change, offset }, index) => <li key={index}>
        <span>{text.change[change.kind]}{change.kind === 'insert' ? '' : ' · ' + text.originalRow(offset + change.row + 1)}</span>
        {requiresRefresh && change.kind !== 'delete' && <span className="muted">　{change.fields.map(field => {
          const name = page?.columns.find(column => column.key === field.column)?.name;
          const value = 'value' in field.value ? cellPreview(field.value.value) : field.value.mode.toUpperCase();
          return name + '=' + value;
        }).join('，')}</span>}
        <button disabled={blocked} onClick={() => setChanges(draft.filter((_, other) => index !== other))}>{text.undo}</button>
      </li>)}</ol>
    </div>}
    {exportPage && <PostgresTableExportDialog target={target} page={exportPage} filtered={isPostgresTableFiltered(options.filter)}
      isCurrent={() => !!lifetime.current && !!exportPage.exportToken && issued.current === exportPage.exportToken &&
        !useWorkspace.getState().dirtyTabs[tab.id]} onClose={() => setExportPage(undefined)}/>}
    {importPage && <PostgresTableImportDialog target={target} page={importPage}
      isCurrent={() => !!lifetime.current && !!importPage.exportToken && issued.current === importPage.exportToken &&
        !useWorkspace.getState().dirtyTabs[tab.id]} onClose={() => setImportPage(undefined)}
      onOutcome={(outcome, committed) => {
        if (!lifetime.current || issued.current !== importPage.exportToken) return;
        setImportPage(undefined); setRequiresRefresh(true); setMessage(outcome);
        if (committed) void run(isCurrent => read(options, isCurrent));
      }}/>}
    {form && page && <RecordForm page={page} row={form.row}
      initial={stagedChange?.kind === 'update' ? stagedChange : undefined}
      onSave={stage} onClose={() => setForm(undefined)}/>}
    {preview && <Modal title={text.preview} onClose={() => { if (!busy) setPreview(undefined); }} wide>
      <div className="modal-content pg-table-preview">
        <p>{text.previewHint}</p>
        <p>{text.change.insert} {preview.counts.insert}　{text.change.update} {preview.counts.update}　{text.change.delete} {preview.counts.delete}</p>
        <ol>{draft.map(({ change, offset }, index) => <li key={index}>
          <strong>{text.change[change.kind]}{change.kind === 'insert' ? '' : ' · ' + text.originalRow(offset + change.row + 1)}</strong>
          {change.kind !== 'delete' && <dl>{change.fields.map(field => <div key={field.column}>
            <dt>{page?.columns.find(column => column.key === field.column)?.name}</dt>
            <dd>{'value' in field.value ? field.value.value : field.value.mode === 'null' ? 'NULL' : 'DEFAULT'}</dd>
          </div>)}</dl>}
          <pre>{preview.statements[index]}</pre>
        </li>)}</ol>
      </div>
      <footer className="modal-footer"><button disabled={busy} onClick={() => setPreview(undefined)}>{text.cancel}</button>
        <button className="primary" disabled={busy || !active} onClick={apply}>{text.apply}</button></footer>
    </Modal>}
  </div>;
}
