import { useEffect, useRef, useState } from 'react';
import {
  postgresTablePreviewSchema, postgresTableReferenceLimits as limits,
  type PostgresRelatedTablePage, type PostgresTableChange, type PostgresTablePage, type PostgresTablePreview,
} from '../../shared/postgresTable';
import { cellPreview, errorMessage, invoke } from '../lib';
import { postgresReferencePickerZh as text } from '../locales/postgresReferencePicker.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab } from '../store';
import { PostgresReferenceRecord } from './PostgresReferenceRecord';
import { PostgresRecordForm } from './PostgresRecordFields';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Modal, Spinner } from './ui';

type RowDraft = Extract<PostgresTableChange, { kind: 'update' }>;
interface Edit {
  page: PostgresTablePage & { pageToken: string };
  position: number;
  form?: true;
  draft?: RowDraft;
  preview?: PostgresTablePreview;
  frozen?: true;
}

/** 关联标签在原范围内读取，编辑只领取选中一行的普通更新快照。 */
export function PostgresRelatedTableTab({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const target = { connectionId: tab.connectionId, database: tab.database ?? '', table: tab.table ?? '', tabId: tab.id };
  const version = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const [view, setView] = useState<{ data: PostgresRelatedTablePage; version: number }>();
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [row, setRow] = useState<number | null>(null), [detail, setDetail] = useState(false);
  const [edit, setEdit] = useState<Edit>(), [message, setMessage] = useState('');
  const alive = useRef(false), started = useRef(false), pending = useRef(false);
  const data = view?.version === version ? view.data : undefined;
  const current = () => alive.current && (useWorkspace.getState().connectionVersions[tab.connectionId] ?? 0) === version;
  const gridCurrent = () => active && current() && !pending.current && !edit && useWorkspace.getState().settings.activeTabId === tab.id;

  /** 读写统一持有本标签租约，确认期间无法关闭标签或发起另一操作。 */
  async function run(action: () => Promise<void>, onError?: () => void) {
    if (pending.current || !current()) return;
    const job = acquireWorkspaceBusy(tab.id);
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (reason) {
      if (alive.current) { setError(errorMessage(reason)); onError?.(); }
    } finally {
      pending.current = false;
      job.release();
      if (alive.current) setBusy(false);
    }
  }

  async function read(offset: number, nextSearch?: string) {
    setDetail(false);
    setRow(null);
    try {
      const next = await invoke('postgres.table.related', { ...target, operation: 'page', offset, search: nextSearch });
      if (!current()) return;
      if (!next || !('page' in next)) throw Error(text.relatedExpired);
      setView({ data: next, version });
      setSearch(next.search);
      if (!next.incoming && next.page.rows.length) setRow(0);
    } catch (reason) {
      if (current()) setView(undefined);
      throw reason;
    }
  }

  function load(offset: number, nextSearch?: string) {
    if (!edit) void run(() => read(offset, nextSearch));
  }

  function discardEdit() {
    if (!edit) return;
    setEdit(undefined);
    useWorkspace.getState().setDirty(tab.id, false);
    void invoke('postgres.table.release', { ...target, pageToken: edit.page.pageToken }).catch(() => {});
  }

  function openEdit() {
    if (!active || !current() || pending.current || !data || edit?.frozen || edit?.preview) return;
    if (edit) { setEdit({ ...edit, form: true }); return; }
    if (row === null || !data.editToken) return;
    const pageToken = data.editToken;
    void run(async () => {
      const page = await invoke('postgres.table.related', { ...target, operation: 'edit', pageToken, row });
      if (!page || !('pageToken' in page) || !page.pageToken) throw Error(text.relatedExpired);
      if (!current()) {
        void invoke('postgres.table.release', { ...target, pageToken: page.pageToken }).catch(() => {});
        return;
      }
      setMessage('');
      setEdit({ page: { ...page, pageToken: page.pageToken }, position: data.offset + row + 1, form: true });
    });
  }

  function previewEdit() {
    if (!edit?.draft || edit.frozen || edit.form || !data) return;
    const { pageToken } = edit.page;
    const changes = [edit.draft];
    void run(async () => {
      const preview = await invoke('postgres.table.preview', { ...target, pageToken, changes });
      if (current()) setEdit({ ...edit, preview });
    });
  }

  function applyEdit() {
    if (!edit?.preview || !data || !active) return;
    const { pageToken } = edit.page, { previewToken } = edit.preview;
    const freeze = () => setEdit({ ...edit, preview: undefined, frozen: true });
    void run(async () => {
      let result;
      try { result = await invoke('postgres.table.apply', { ...target, pageToken, previewToken }); }
      catch (reason) { freeze(); setMessage(tableText.unknown); throw reason; }
      if (!alive.current) return;
      setMessage(result.outcome === 'unknown' ? tableText.unknown + ' ' + result.message : result.message);
      if (result.outcome === 'committed') {
        discardEdit();
        if (current()) await read(data.offset, data.search);
      } else if (result.outcome === 'rolledBack' && result.draftsRetained && current()) {
        setEdit({ ...edit, preview: undefined });
        setMessage(result.message + ' ' + tableText.retryAfterRollback);
      } else freeze();
    });
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void invoke('postgres.table.related', { ...target, operation: 'close' }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    load(0);
  }, [active]);

  const record = row === null ? undefined : data?.page.rows[row];
  const blocked = busy || !!edit;
  return <div className="workspace-tab postgres-related-table-tab" aria-label={text.relatedTab}>
    <div className="context-bar"><strong>{tab.title}</strong><span>{text.relatedHint}</span></div>
    <div className="pg-table-controls">
      <button type="button" disabled={blocked || !active} onClick={() => load(data?.offset ?? 0, data?.search)}>{text.relatedRefresh}</button>
      {data?.incoming && <form className="pg-page-jump" onSubmit={event => { event.preventDefault(); if (gridCurrent()) load(0, search); }}>
        <input type="search" aria-label={text.childQuery} value={search} maxLength={limits.search} disabled={blocked}
          onChange={event => setSearch(event.target.value)}/>
        <button type="submit" disabled={blocked}>{text.childSearch}</button>
      </form>}
      {data?.incoming && <>
        <button type="button" disabled={blocked || data.offset === 0}
          onClick={() => load(Math.max(0, data.offset - limits.page), data.search)}>{text.childPrevious}</button>
        <button type="button" disabled={blocked || !data.page.hasNext || data.offset + limits.page > limits.offset}
          onClick={() => load(data.offset + limits.page, data.search)}>{text.childNext}</button>
      </>}
      <button type="button" disabled={blocked || !record} onClick={() => { if (gridCurrent()) setDetail(value => !value); }}>
        {detail ? text.relatedBack : text.relatedRecord}
      </button>
      <button type="button" disabled={busy || !data || (!edit && (!data.editToken || !record)) || !!edit?.frozen || !!edit?.preview || !!edit?.form}
        onClick={openEdit}>{tableText.edit}</button>
      {edit?.draft && <>
        <button type="button" disabled={busy || !data || !!edit.frozen || !!edit.preview || !!edit.form} onClick={previewEdit}>{tableText.preview}</button>
        <button type="button" disabled={busy || !!edit.preview || !!edit.form} onClick={discardEdit}>{tableText.discard}</button>
      </>}
    </div>
    {busy && <Spinner text={text.loading}/>}
    <ErrorBox message={error || (view && !data ? text.relatedExpired : '')}/>
    {message && <p className="info-strip" role="status">{message}</p>}
    {data && !busy && <>
      <div className="tab-status"><span>{data.constraint}</span>
        {data.incoming && !!data.page.rows.length && <span>{text.childRange(data.offset, data.page.rows.length)}</span>}
        {!!data.page.rows.length && !data.editToken && <span>{tableText.noWrite}</span>}
      </div>
      {detail && record ? <PostgresReferenceRecord key={row} columns={data.page.columns} row={record}/>
        : data.page.rows.length ? <div className="pg-table-grid"><ResultsGrid
          columns={data.page.columns} rows={data.page.rows} onActiveRowIndexChange={setRow} isCurrent={gridCurrent}
          navigateTo={!data.incoming ? { row: 0, key: data.page.columns[0].key } : undefined}/></div>
          : <p>{data.incoming ? text.emptyChildren : text.emptyParent}</p>}
    </>}
    {edit?.draft && <div className="pg-table-draft" aria-label={tableText.draft}>
      <strong>{tableText.changes(1)}{edit.frozen ? ' · ' + tableText.refreshAfterFailure : ''}</strong>
      <p>{tableText.originalRow(edit.position)}　{edit.draft.fields.map(field => {
        const column = edit.page.columns.find(item => item.key === field.column)?.name;
        const value = 'value' in field.value ? cellPreview(field.value.value) : field.value.mode.toUpperCase();
        return column + '=' + value;
      }).join('，')}</p>
    </div>}
    {edit?.form && <PostgresRecordForm page={edit.page} row={0} initial={edit.draft} onSave={change => {
      if (change.kind !== 'update' || !current()) throw Error(text.relatedExpired);
      postgresTablePreviewSchema.parse({ ...target, pageToken: edit.page.pageToken, changes: [change] });
      setEdit({ ...edit, draft: change, form: undefined });
      useWorkspace.getState().setDirty(tab.id, true);
    }} onClose={() => { if (edit.draft) setEdit({ ...edit, form: undefined }); else discardEdit(); }}/>}
    {edit?.preview && <Modal title={tableText.preview} onClose={() => { if (!busy) setEdit({ ...edit, preview: undefined }); }} wide>
      <div className="modal-content pg-table-preview">
        <p>{tableText.previewHint}</p>
        <p><strong>{tableText.originalRow(edit.position)}</strong>　{edit.page.columns.filter(column => column.primary)
          .map(column => column.name + '=' + cellPreview(edit.page.rows[0][column.key])).join('，')}</p>
        <dl>{edit.draft?.fields.map(field => <div key={field.column}>
          <dt>{edit.page.columns.find(column => column.key === field.column)?.name}</dt>
          <dd>{'value' in field.value ? field.value.value : field.value.mode === 'null' ? 'NULL' : 'DEFAULT'}</dd>
        </div>)}</dl>
        <pre>{edit.preview.statements[0]}</pre>
      </div>
      <footer className="modal-footer">
        <button disabled={busy} onClick={() => setEdit({ ...edit, preview: undefined })}>{tableText.cancel}</button>
        <button className="primary" disabled={busy || !data || !active} onClick={applyEdit}>{tableText.apply}</button>
      </footer>
    </Modal>}
  </div>;
}
