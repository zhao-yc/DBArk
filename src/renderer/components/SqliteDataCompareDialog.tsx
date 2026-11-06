import { useEffect, useRef, useState } from 'react';
import type { SqliteValue } from '../../engine/sqlite/protocol';
import { sqliteDataCompareLimits as limits, sqliteDataCompareZh as text, sqliteDataSyncLimits, sqliteDataSyncZh as syncText, type SqliteDataSyncPreview, type SqliteDataCompareKind, type SqliteDataCompareOutput, type SqliteDataCompareRow } from '../../shared/sqliteDataCompare';
import type { SqliteTableFilter } from '../../shared/sqliteTableBrowse';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Field, Modal } from './ui';
import '../sqliteDataCompare.css';

const kinds = ['source-only', 'target-only', 'different'] as const;
const syncActions = { 'source-only': syncText.insert, 'target-only': syncText.delete, different: syncText.update };
type Selection = { connectionId: string; table: string };
type Connection = { id: string; name: string };

/** 两侧共用真实对象目录。连接切换时撤销之前的异步列表及表名。 */
function CompareEndpoint({ label, connections, disabled, selection, change, onError }: {
  label: string; connections: readonly Connection[]; disabled: boolean; selection: Selection; change(next: Selection): void; onError(message: string): void;
}) {
  const [objects, setObjects] = useState<{ connectionId: string; names: string[] }>(), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selection.connectionId) return;
    let current = true;
    setLoading(true);
    const id = selection.connectionId;
    void invoke('metadata.objects', { connectionId: id, database: 'main' }).then(result => {
      if (current) setObjects({ connectionId: id, names: result.filter(item => item.kind === 'table').map(item => item.name) });
    }).catch(reason => { if (current) onError(errorMessage(reason)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [selection.connectionId, onError]);
  const names = objects?.connectionId === selection.connectionId ? objects.names : [];
  return <fieldset disabled={disabled} className="sqlite-data-compare-endpoint">
    <legend>{label}</legend>
    <Field label={text.connection}><select aria-label={label + text.connection} value={selection.connectionId} onChange={event => {
      setObjects(undefined); change({ connectionId: event.target.value, table: '' });
    }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label={text.table}><select aria-label={label + text.table} disabled={!selection.connectionId || loading} value={selection.table}
      onChange={event => change({ ...selection, table: event.target.value })}><option value="">—</option>{names.map(name => <option key={name}>{name}</option>)}</select></Field>
  </fieldset>;
}

/** 不混淆空值、缺行、文本和原生数值。二进制显示为原始 Base64。 */
function display(value: SqliteValue | undefined): string {
  if (value === undefined) return text.absent;
  if (value === null) return 'NULL';
  if (typeof value === 'string') return 'TEXT ' + JSON.stringify(value);
  if (value.type === 'binary') return 'BLOB Base64 ' + value.base64;
  return (value.type === 'integer' ? 'INTEGER ' : 'REAL ') + value.value;
}

function keyLabel(row: SqliteDataCompareRow): string {
  const value = row.key.map(display).join(' / ');
  return value.length <= 200 ? value : value.slice(0, 200) + '…';
}

export function SqliteDataCompareDialog({ connections, onClose }: { connections: readonly Connection[]; onClose(): void }) {
  const initial = { connectionId: connections.length === 1 ? connections[0].id : '', table: '' };
  const [source, setSource] = useState<Selection>(initial), [target, setTarget] = useState<Selection>(initial);
  const [filter, setFilter] = useState({ column: '', kind: 'text' as keyof typeof text.types, value: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<SqliteDataCompareOutput>(), [kind, setKind] = useState<SqliteDataCompareKind | 'all'>('all');
  const [page, setPage] = useState(0), [selected, setSelected] = useState<SqliteDataCompareRow>();
  const running = useRef<string | undefined>(undefined);
  const [marked, setMarked] = useState<Set<SqliteDataCompareRow>>(() => new Set());
  const [preview, setPreview] = useState<SqliteDataSyncPreview>(), [confirmation, setConfirmation] = useState('');
  const [syncBusy, setSyncBusy] = useState(false), [syncStatus, setSyncStatus] = useState('');
  const syncRunning = useRef(false);
  const detail = useRef<HTMLDivElement>(null);
  // 展开原值时将详情滚入当前对话框，避免按钮有回执却被长列表挡住。
  useEffect(() => { if (selected) detail.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const clear = () => {
    setOutput(undefined); setError(''); setPage(0); setSelected(undefined);
    setMarked(new Set()); setPreview(undefined); setConfirmation(''); setSyncStatus('');
  };
  const available = (side: Selection) => !!side.table && connections.some(profile => profile.id === side.connectionId);
  const ready = available(source) && available(target) && (source.connectionId !== target.connectionId || source.table !== target.table);
  async function compare() {
    if (running.current || syncRunning.current || !ready) return;
    const taskId = uid();
    const filters: SqliteTableFilter[] = filter.column ? [{ column: filter.column, operator: 'eq', value: { kind: filter.kind, value: filter.value } }] : [];
    running.current = taskId; setBusy(true); clear(); setKind('all');
    try { setOutput(await invoke('sqlite.compareData', { source: { ...source, database: 'main' }, target: { ...target, database: 'main' }, taskId, mode: 'and', filters })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { running.current = undefined; setBusy(false); }
  }
  const visible = output?.differences.filter(row => kind === 'all' || row.kind === kind) ?? [];
  const close = () => { if (!running.current && !syncRunning.current) onClose(); };
  async function previewSync() {
    if (!output?.syncSnapshotId || !marked.size || running.current || syncRunning.current) return;
    const selected = output.differences.flatMap((row, index) => marked.has(row) ? [index] : []);
    syncRunning.current = true; setSyncBusy(true); setError(''); setConfirmation('');
    try { setPreview(await invoke('sqlite.compareSync.preview', { snapshotId: output.syncSnapshotId, selected })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { syncRunning.current = false; setSyncBusy(false); }
  }
  async function applySync() {
    if (!preview || confirmation !== preview.confirmation || syncRunning.current) return;
    syncRunning.current = true; setSyncBusy(true);
    try {
      const result = await invoke('sqlite.compareSync.apply', { previewId: preview.previewId, confirmation, taskId: uid() });
      clear();
      if (result.outcome === 'committed') setSyncStatus(result.message); else setError(result.message);
    } catch (reason) { clear(); setError(errorMessage(reason)); }
    finally { syncRunning.current = false; setSyncBusy(false); }
  }
  const locked = busy || syncBusy || !!preview;
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content sqlite-data-compare">
      <p>{text.intro}</p>
      <div className="sqlite-data-compare-pair">
        <CompareEndpoint label={text.source} connections={connections} disabled={locked} selection={source} onError={setError} change={next => { setSource(next); clear(); }}/>
        <CompareEndpoint label={text.target} connections={connections} disabled={locked} selection={target} onError={setError} change={next => { setTarget(next); clear(); }}/>
      </div>
      <fieldset disabled={locked} className="sqlite-data-compare-filter">
        <legend>{text.filter}</legend>
        <Field label={text.filterColumn}><input aria-label={text.filterColumn} value={filter.column} maxLength={512} onChange={event => { setFilter({ ...filter, column: event.target.value }); clear(); }}/></Field>
        <Field label={text.filterType}><select aria-label={text.filterType} value={filter.kind} onChange={event => { setFilter({ ...filter, kind: event.target.value as typeof filter.kind }); clear(); }}>
          {Object.entries(text.types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label={text.filterValue}><input aria-label={text.filterValue} value={filter.value} disabled={!filter.column} maxLength={65536} onChange={event => { setFilter({ ...filter, value: event.target.value }); clear(); }}/></Field>
      </fieldset>
      <ErrorBox message={error}/>
      {busy && <p role="status">{text.running}</p>}
      {syncBusy && <p role="status">{syncText.working}</p>}
      {syncStatus && <p role="status">{syncStatus}</p>}
      {output && <>
        <p>{output.snapshot === 'one-file' ? text.singleSnapshot : text.splitSnapshot}</p>
        <p role="status">{text.keys}　{output.keyColumns.join('，')}　{[[text.sourceRows, output.sourceRows], [text.targetRows, output.targetRows], [text.equal, output.equal], ...kinds.map(item => [text[item], output.counts[item]])].map(([label, count]) => label + ' ' + count).join(' · ')}</p>
        {output.syncSnapshotId ? <p>{syncText.scope}　{syncText.count(marked.size)}</p> :
          output.differences.length > 0 && <p>{syncText.unavailable}</p>}
        {preview && <fieldset disabled={syncBusy}>
          <legend>{syncText.preview}</legend>
          <p>{connections.find(item => item.id === target.connectionId)?.name}　{preview.confirmation}</p>
          <p>{syncText.insert} {preview.counts.insert} · {syncText.update} {preview.counts.update} · {syncText.delete} {preview.counts.delete}</p>
          <div className="sqlite-data-sync-preview-rows">
            <ul>{[...marked].map((row, index) => <li key={index}>{syncActions[row.kind]}　{keyLabel(row)}</li>)}</ul>
          </div>
          <Field label={syncText.confirm}><input aria-label={syncText.confirm} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></Field>
        </fieldset>}
        <Field label={text.kind}><select aria-label={text.kind} disabled={locked} value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0); setSelected(undefined); }}>
          <option value="all">{text.all}</option>{kinds.map(item => <option value={item} key={item}>{text[item]}</option>)}</select></Field>
        {visible.length ? <>
          <table><thead><tr>{output.syncSnapshotId && <th>{syncText.select}</th>}<th>{text.kind}</th><th>{text.keys}</th><th>{text.detail}</th></tr></thead>
            <tbody>{visible.slice(page * limits.page, (page + 1) * limits.page).map((row, index) => <tr key={index}>
              {output.syncSnapshotId && <td><input type="checkbox" aria-label={syncText.select + ' ' + keyLabel(row)}
                checked={marked.has(row)} disabled={locked || (!marked.has(row) && marked.size >= sqliteDataSyncLimits.selected)} onChange={event => {
                  const checked = event.target.checked;
                  setMarked(previous => { const next = new Set(previous); if (checked) next.add(row); else next.delete(row); return next; });
                }}/></td>}
              <td>{text[row.kind]}</td><td className="sqlite-data-compare-key">{keyLabel(row)}</td>
              <td><button onClick={() => setSelected(row)}>{text.detail}</button></td>
            </tr>)}</tbody></table>
          <div className="sqlite-data-compare-pager"><button disabled={!page} onClick={() => { setPage(page - 1); setSelected(undefined); }}>{text.prev}</button>
            <span>{page + 1} / {Math.ceil(visible.length / limits.page)}</span>
            <button disabled={(page + 1) * limits.page >= visible.length} onClick={() => { setPage(page + 1); setSelected(undefined); }}>{text.next}</button></div>
          {selected && <div ref={detail}><pre>{text.keys}　{selected.key.map(display).join(' / ')}</pre><table aria-label={text.detail}><thead><tr><th>{text.field}</th><th>{text.source}</th><th>{text.target}</th></tr></thead>
            <tbody>{selected.cells.map(cell => <tr key={cell.column}><th>{output.columns[cell.column]}</th><td><pre>{display(cell.source)}</pre></td><td><pre>{display(cell.target)}</pre></td></tr>)}</tbody></table></div>}
        </> : <p>{text.noDiff}</p>}
      </>}
    </div>
    <footer className="modal-footer"><button className="primary" disabled={!ready || locked} onClick={() => void compare()}>{text.run}</button>
      {busy && <button onClick={() => {
        if (running.current) void invoke('sqlite.compareData.cancel', { taskId: running.current }).catch(reason => setError(errorMessage(reason)));
      }}>{text.cancel}</button>}{preview ? <>
        <button disabled={syncBusy} onClick={() => { setPreview(undefined); setConfirmation(''); }}>{syncText.back}</button>
        <button className="danger" disabled={syncBusy || confirmation !== preview.confirmation} onClick={() => void applySync()}>{syncText.apply}</button>
      </> : output?.syncSnapshotId && <button disabled={locked || !marked.size} onClick={() => void previewSync()}>{syncText.preview}</button>}
      <span className="grow"/><button disabled={busy || syncBusy} onClick={close}>{text.close}</button></footer>
  </Modal>;
}
