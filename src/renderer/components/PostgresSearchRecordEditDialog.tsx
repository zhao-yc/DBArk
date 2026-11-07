import { useEffect, useRef, useState } from 'react';
import { postgresTablePreviewSchema, type PostgresTablePage, type PostgresTablePreview } from '../../shared/postgresTable';
import { errorMessage, invoke, uid } from '../lib';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { useWorkspace } from '../store';
import { PostgresRecordForm, type PostgresEditableRecord } from './PostgresRecordFields';
import { ErrorBox, Modal, Spinner } from './ui';

interface Props {
  connectionId: string;
  database: string;
  table: string;
  recordRef: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}

/** 独立于工作台表页的单行编辑，迟到的快照与提交回执分别清理和报告。 */
export function PostgresSearchRecordEditDialog(props: Props) {
  const { connectionId, database, table, recordRef, focusColumn } = props;
  const [tabId] = useState(uid);
  const target = { connectionId, database, table, tabId };
  const callbacks = useRef(props); callbacks.current = props;
  const [source] = useState(() => {
    const state = useWorkspace.getState();
    return { profile: state.connections.find(item => item.id === connectionId), version: state.connectionVersions[connectionId] ?? 0 };
  });
  const [page, setPage] = useState<PostgresTablePage & { pageToken: string }>();
  const [draft, setDraft] = useState<PostgresEditableRecord>(), [preview, setPreview] = useState<PostgresTablePreview>();
  const [form, setForm] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [frozen, setFrozen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const live = useRef(false), pending = useRef(true), token = useRef<string | undefined>(undefined);
  const notify = (message: string, failure = false) => useWorkspace.getState().notify(message, failure);

  function current() {
    const state = useWorkspace.getState();
    return live.current && source.profile?.dialect === 'postgresql' && state.connections.includes(source.profile) &&
      (state.connectionVersions[connectionId] ?? 0) === source.version;
  }

  function release(pageToken: string) {
    return invoke('postgres.table.release', { ...target, pageToken }).catch(reason => notify(errorMessage(reason), true));
  }

  useEffect(() => {
    let active = true;
    live.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        if (!current()) throw Error(text.postgresEditStale);
        const result = await invoke('postgres.table.page', { ...target, searchRecordRef: recordRef, limit: 1, offset: 0 });
        if (result.pageToken && (!active || !current() || result.rows.length !== 1 ||
            result.truncated || result.hasNext || !result.capabilities.update || result.capabilities.insert || result.capabilities.delete))
          await release(result.pageToken);
        else if (result.pageToken) {
          token.current = result.pageToken;
          setPage({ ...result, pageToken: result.pageToken });
          setForm(true);
          callbacks.current.onDirty(true);
          return;
        }
        throw Error(text.postgresEditStale);
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally {
        if (active) { pending.current = false; setBusy(false); }
      }
    })();
    return () => {
      active = false; live.current = false;
      if (token.current) { void release(token.current); token.current = undefined; }
      callbacks.current.onDirty(false);
    };
  }, [connectionId, database, table, recordRef, tabId]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    if (!current()) { setError(text.postgresEditStale); return; }
    pending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  function close() {
    if (pending.current || ((draft || frozen) && !window.confirm(text.editDiscard))) return;
    callbacks.current.onDone(false);
  }

  function stage(change: PostgresEditableRecord) {
    if (!page || !current() || change.kind !== 'update') throw Error(text.postgresEditStale);
    const request = { ...target, pageToken: page.pageToken, changes: [change] };
    postgresTablePreviewSchema.parse(request);
    setDraft(change); setForm(false); setConfirmed(false);
    void run(async () => {
      const next = await invoke('postgres.table.preview', request);
      if (!current()) throw Error(text.postgresEditStale);
      setPreview(next);
    });
  }

  function apply() {
    if (!page || !preview || !confirmed || frozen) return;
    void run(async () => {
      try {
        const result = await invoke('postgres.table.apply', { ...target, pageToken: page.pageToken, previewToken: preview.previewToken });
        if (result.outcome === 'committed') {
          notify(result.message);
          if (live.current) callbacks.current.onDone(true);
          return;
        }
        if (live.current) {
          setConfirmed(false);
          if (result.outcome === 'rolledBack' && result.draftsRetained && current()) setPreview(undefined);
          else setFrozen(true);
          setError(result.outcome === 'unknown' ? tableText.unknown + ' ' + result.message : result.message);
        } else notify(result.message, true);
      } catch (reason) {
        if (live.current) { setFrozen(true); setConfirmed(false); throw Error(tableText.unknown + ' ' + errorMessage(reason)); }
        notify(tableText.unknown + ' ' + errorMessage(reason), true);
      }
    });
  }

  if (page && form) return <PostgresRecordForm page={page} row={0} initial={draft} initialFocus={focusColumn}
    current={() => current() && !pending.current} onSave={stage} onClose={() => draft ? setForm(false) : close()}/>;

  return <Modal title={draft ? tableText.preview : text.edit} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      <p>{text.postgresEditHint}</p>
      {busy && <Spinner text={text.reading}/>}
      <ErrorBox message={error}/>
      {page && draft && <dl>{draft.fields.map(field => <div key={field.column}>
        <dt>{page.columns.find(column => column.key === field.column)?.name}</dt>
        <dd>{'value' in field.value ? field.value.value : field.value.mode.toUpperCase()}</dd>
      </div>)}</dl>}
      {preview && <><pre>{preview.statements[0]}</pre><label>
        <input type="checkbox" checked={confirmed} disabled={busy || frozen} onChange={event => setConfirmed(event.target.checked)}/>
        {text.postgresConfirm}
      </label></>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.editBack}</button>
      {draft && !frozen && <button disabled={busy} onClick={() => { setPreview(undefined); setForm(true); }}>{tableText.edit}</button>}
      {preview && <button className="primary" disabled={busy || frozen || !confirmed} onClick={apply}>{tableText.apply}</button>}
    </footer>
  </Modal>;
}
