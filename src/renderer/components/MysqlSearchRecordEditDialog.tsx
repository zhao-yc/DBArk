import { useEffect, useRef, useState } from 'react';
import type { RowChange, SqlPreview } from '../../shared/contracts';
import type { MysqlSearchEditRecord } from '../../shared/dataSearchRecords';
import { collectChanges, type DraftRow } from '../dataChanges';
import { errorMessage, invoke, ownCell, uid } from '../lib';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { recordViewZh as recordText } from '../locales/recordViews.zh-CN';
import {
  beginRecordDraft, editRecordInput, recordFieldTooLarge, recordInputDirty, recordReadonlyReason,
  recordValueSummary, stageRecordDraft, type RecordContext, type RecordDraft,
} from '../recordViews';
import { useWorkspace } from '../store';
import { RecordValueEditor } from './RecordValueEditor';
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

/** 独立表单复用普通表页的字段输入和草稿校验，提交继续走原事务回执。 */
export function MysqlSearchRecordEditDialog({ connectionId, database, table, recordRef, focusColumn, onDirty, onDone }: Props) {
  const target = { connectionId, database, table };
  const [version] = useState(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0);
  const [data, setData] = useState<MysqlSearchEditRecord>();
  const [row, setRow] = useState<DraftRow>(), [draft, setDraft] = useState<RecordDraft>();
  const [preview, setPreview] = useState<SqlPreview & { previewId: string }>(), [changes, setChanges] = useState<RowChange[]>();
  const [field, setField] = useState<string>(), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false), [frozen, setFrozen] = useState(false);
  const pending = useRef(true), live = useRef(false), callbacks = useRef({ onDirty, onDone });
  callbacks.current = { onDirty, onDone };
  const context: RecordContext = { target, generation: 0, connectionVersion: version, info: data?.info ?? null, loaded: !!data, stale: false, busy: false };
  const current = () => live.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version;
  const notify = (message: string, failure = false) => useWorkspace.getState().notify(message, failure);

  useEffect(() => {
    let active = true, reading = false;
    const taskId = uid();
    live.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        reading = true;
        const record = await invoke('search.recordEditRead', { connectionId, taskId, recordRef });
        if (!active) return;
        if (!current() || record.info.database !== database || record.info.name !== table) throw Error(text.mysqlEditStale);
        const original = { id: uid(), original: record.row, data: record.row, inserted: false, deleted: false };
        const context = { target, generation: 0, connectionVersion: version, info: record.info, loaded: true, stale: false, busy: false };
        const name = record.info.columns.find(column => column.name === focusColumn) ?? record.info.columns[0];
        const input = beginRecordDraft(original, context);
        const editable = name && !recordReadonlyReason(context, original, name.name) && !recordFieldTooLarge(ownCell(record.row, name.name));
        setData(record); setRow(original); setDraft(editable ? editRecordInput(input, name) : input); setField(name?.name);
        callbacks.current.onDirty(true);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { reading = false; if (active) { pending.current = false; setBusy(false); } }
    })();
    return () => {
      active = false; live.current = false;
      if (reading) void invoke('query.cancel', { taskId }).catch(reason => notify(errorMessage(reason), true));
      callbacks.current.onDirty(false);
    };
  }, [connectionId, database, table, recordRef]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    if (!current()) { setError(text.mysqlEditStale); return; }
    pending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  function close() {
    if (pending.current || ((changes || recordInputDirty(draft ?? null, context.info)) && !window.confirm(text.editDiscard))) return;
    callbacks.current.onDone(false);
  }

  function stage() {
    if (!draft || !row) return;
    void run(async () => {
      const next = collectChanges(stageRecordDraft([row], draft, context));
      if (next.length !== 1 || next[0].kind !== 'update') throw Error(text.mysqlNoChange);
      const plan = await invoke('table.preview', { ...target, changes: next, searchRecordRef: recordRef });
      if (!current() || !plan.previewId) throw Error(text.mysqlEditStale);
      setChanges(next); setPreview({ ...plan, previewId: plan.previewId }); setConfirmed(false);
    });
  }

  function apply() {
    if (!preview || !changes || !confirmed || frozen) return;
    void run(async () => {
      try {
        const result = await invoke('table.apply', { ...target, changes, previewId: preview.previewId, taskId: uid(), searchRecordRef: recordRef });
        notify(text.mysqlCommitted(result.affectedRows), result.receiptSaved === false);
        if (live.current) callbacks.current.onDone(true);
      } catch (reason) {
        if (live.current) { setFrozen(true); setConfirmed(false); throw reason; }
        notify(errorMessage(reason), true);
      }
    });
  }

  return <Modal title={preview ? text.mysqlPreview : text.edit} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      <p>{text.mysqlEditHint}</p>
      {busy && <Spinner text={text.reading}/>}
      <ErrorBox message={error}/>
      {preview ? <><pre>{preview.sql}</pre><label>
        <input type="checkbox" checked={confirmed} disabled={busy || frozen} onChange={event => setConfirmed(event.target.checked)}/>
        {text.mysqlConfirm}
      </label></> : data && row && draft && <div className="record-fields">
        {data.info.columns.map(column => {
          const value = ownCell(row.data, column.name), input = draft.fields.get(column.name);
          const reason = recordReadonlyReason(context, row, column.name) || (recordFieldTooLarge(value) ? recordText.fieldTooLarge : '');
          return <section className="record-field" key={column.name} aria-label={column.name}>
            <h3>{column.name}<small>{column.type}</small></h3>
            <p>{recordValueSummary(value)}</p>
            {reason ? <p>{reason}</p> : field === column.name && input ? <RecordValueEditor column={column} input={input} inserted={false}
              reason={busy ? recordText.busy : ''} focus source={[row, column]} isCurrent={current}
              onChange={next => { try { setDraft(editRecordInput(draft, column, next)); setError(''); } catch (failure) { setError(errorMessage(failure)); } }}/>
              : <button disabled={busy} onClick={() => {
                try { setDraft(editRecordInput(draft, column)); setField(column.name); setError(''); }
                catch (failure) { setError(errorMessage(failure)); }
              }}>{recordText.editField}</button>}
          </section>;
        })}
      </div>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.editBack}</button>
      {draft && !preview && <button className="primary" disabled={busy || !recordInputDirty(draft, context.info)} onClick={stage}>{text.mysqlPreview}</button>}
      {preview && !frozen && <button disabled={busy} onClick={() => { setPreview(undefined); setChanges(undefined); }}>{recordText.editField}</button>}
      {preview && <button className="primary" disabled={busy || frozen || !confirmed} onClick={apply}>{text.mysqlApply}</button>}
    </footer>
  </Modal>;
}
