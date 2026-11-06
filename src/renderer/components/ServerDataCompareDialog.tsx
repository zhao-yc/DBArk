import { useEffect, useRef, useState } from 'react';
import type { CellValue } from '../../shared/contracts';
import {
  postgresDataCompareLimits as limits, postgresDataCompareSchema, postgresDataCompareZh,
  postgresDataSyncLimits, postgresDataSyncZh as sync, type PostgresDataSyncPreview,
  type PostgresDataCompareEndpoint as Endpoint, type PostgresDataCompareKind, type PostgresDataCompareOutput, type PostgresDataCompareRow,
} from '../../shared/postgresDataCompare';
import { mysqlDataCompareSchema, mysqlDataCompareZh, mysqlDataSyncZh } from '../../shared/mysqlDataCompare';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Field, Modal } from './ui';
import '../sqliteDataCompare.css';

type Connection = { id: string; name: string };
type Dialect = 'mysql' | 'postgres';
const compareLabels = { mysql: mysqlDataCompareZh, postgres: postgresDataCompareZh } as const;
const kinds = ['source-only', 'target-only', 'different'] as const;
const syncActions = { 'source-only': sync.insert, 'target-only': sync.delete, different: sync.update };

function CompareEndpoint({ label, connections, disabled, value, change, dialect }: {
  label: string; connections: readonly Connection[]; disabled: boolean; dialect: Dialect; value: Endpoint; change(next: Endpoint): void;
}) {
  const text = compareLabels[dialect], command = dialect === 'postgres' ? 'postgres.compareData.catalogue' : 'mysql.compareData.catalogue';
  const { connectionId, database, table } = value;
  const [databases, setDatabases] = useState<{ id: string; items: string[] }>();
  const [tables, setTables] = useState<{ id: string; database: string; items: string[] }>();
  const [databaseError, setDatabaseError] = useState(''), [tableError, setTableError] = useState('');
  // 目录请求不接管导航。换连接或数据库后，迟到的目录不能覆盖当前选择。
  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke(command, { connectionId }).then(items => {
      if (current) setDatabases({ id: connectionId, items });
    }).catch(reason => { if (current) setDatabaseError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId, command]);
  useEffect(() => {
    if (!connectionId || !database) return;
    let current = true;
    void invoke(command, { connectionId, database }).then(items => {
      if (current) setTables({ id: connectionId, database, items });
    }).catch(reason => { if (current) setTableError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId, database, command]);
  const databaseItems = databases?.id === connectionId ? databases.items : [];
  const tableItems = tables?.id === connectionId && tables.database === database ? tables.items : [];
  return <fieldset disabled={disabled} className="sqlite-data-compare-endpoint">
    <legend>{label}</legend>
    <Field label={text.connection}><select aria-label={label + text.connection} value={connectionId} onChange={event => {
      if (event.target.value === connectionId) return;
      setDatabases(undefined); setTables(undefined); setDatabaseError(''); setTableError('');
      change({ connectionId: event.target.value, database: '', table: '' });
    }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label={text.database}><select aria-label={label + text.database} value={database} disabled={!databaseItems.length} onChange={event => {
      if (event.target.value === database) return;
      setTables(undefined); setTableError(''); change({ ...value, database: event.target.value, table: '' });
    }}><option value="">—</option>{databaseItems.map(name => <option key={name}>{name}</option>)}</select></Field>
    <Field label={text.table}><select aria-label={label + text.table} value={table} disabled={!tableItems.length} onChange={event => change({ ...value, table: event.target.value })}>
      <option value="">—</option>{tableItems.map(name => <option key={name}>{name}</option>)}
    </select></Field>
    {databaseError && <ErrorBox message={databaseError}/>}
    {tableError && <ErrorBox message={tableError}/>}
  </fieldset>;
}

function display(value: CellValue | undefined, dialect: Dialect): string {
  if (value === undefined) return compareLabels[dialect].absent;
  if (value === null) return 'NULL';
  return typeof value === 'object' ? (dialect === 'postgres' ? 'BYTEA Base64 ' : '字节 Base64 ') + value.base64 : JSON.stringify(value);
}

function keyLabel(row: PostgresDataCompareRow, dialect: Dialect) {
  const label = row.key.map(value => display(value, dialect)).join(' / ');
  return label.length <= 200 ? label : label.slice(0, 200) + '…';
}

export function ServerDataCompareDialog({ connections, onClose, dialect }: { connections: readonly Connection[]; onClose(): void; dialect: Dialect }) {
  const text = compareLabels[dialect], postgres = dialect === 'postgres';
  const initial = { connectionId: connections.length === 1 ? connections[0].id : '', database: '', table: '' };
  const [source, setSource] = useState<Endpoint>(initial), [target, setTarget] = useState<Endpoint>(initial);
  const [filter, setFilter] = useState({ column: '', text: '' });
  const [report, setReport] = useState<PostgresDataCompareOutput>(), [error, setError] = useState('');
  const [kind, setKind] = useState<PostgresDataCompareKind | 'all'>('all'), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PostgresDataCompareRow>(), [busy, setBusy] = useState(false);
  const [marked, setMarked] = useState<Set<PostgresDataCompareRow>>(() => new Set());
  const [preview, setPreview] = useState<PostgresDataSyncPreview>(), [confirmation, setConfirmation] = useState('');
  const [syncBusy, setSyncBusy] = useState(false), [syncStatus, setSyncStatus] = useState('');
  const syncing = useRef(false);
  const task = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const detail = useRef<HTMLDivElement>(null);
  const review = useRef<HTMLFieldSetElement>(null);
  useEffect(() => { if (selected) detail.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  // 用户可能从长列表底部打开预览，先让操作清单和准确目标进入可视区。
  useEffect(() => { if (preview) review.current?.scrollIntoView({ block: 'center' }); }, [preview]);
  const clear = () => {
    setReport(undefined); setError(''); setKind('all'); setPage(0); setSelected(undefined);
    setMarked(new Set()); setPreview(undefined); setConfirmation(''); setSyncStatus('');
  };
  const ready = [source, target].every(side => side.table && connections.some(profile => profile.id === side.connectionId)) &&
    (source.connectionId !== target.connectionId || source.database !== target.database || source.table !== target.table) &&
    (!filter.text || !!filter.column);
  const rows = report?.differences.filter(row => kind === 'all' || row.kind === kind) ?? [];
  async function compare() {
    if (!ready || task.current || syncing.current) return;
    const parsed = (postgres ? postgresDataCompareSchema : mysqlDataCompareSchema).safeParse({ source, target, taskId: uid(), ...(filter.text ? { filter } : {}) });
    if (!parsed.success) { setError(errorMessage(parsed.error)); return; }
    const active = { id: parsed.data.taskId, cancelled: false };
    task.current = active; setBusy(true); clear();
    try {
      const result = await invoke(postgres ? 'postgres.compareData' : 'mysql.compareData', parsed.data);
      if (!active.cancelled) setReport(result); else setError(text.cancelled);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { task.current = undefined; setBusy(false); }
  }
  function cancel() {
    const active = task.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    void invoke(postgres ? 'postgres.compareData.cancel' : 'mysql.compareData.cancel', { taskId: active.id }).catch(reason => {
      if (task.current === active) { active.cancelled = false; setError(errorMessage(reason)); }
    });
  }
  async function previewSync() {
    if (!report?.syncSnapshotId || !marked.size || task.current || syncing.current) return;
    const selected = report.differences.flatMap((row, index) => marked.has(row) ? [index] : []);
    syncing.current = true; setSyncBusy(true); setError(''); setConfirmation('');
    try { setPreview(await invoke(postgres ? 'postgres.compareData.syncPreview' : 'mysql.compareData.syncPreview', { snapshotId: report.syncSnapshotId, selected })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { syncing.current = false; setSyncBusy(false); }
  }
  async function applySync() {
    if (!report?.syncSnapshotId || !preview || confirmation !== preview.confirmation || syncing.current) return;
    syncing.current = true; setSyncBusy(true);
    try {
      const result = await invoke(postgres ? 'postgres.compareData.syncApply' : 'mysql.compareData.syncApply', {
        snapshotId: report.syncSnapshotId, previewId: preview.previewId, taskId: uid(), confirmation,
      });
      clear();
      if (result.outcome === 'committed') setSyncStatus(result.message); else setError(result.message);
    } catch (reason) { clear(); setError(errorMessage(reason)); }
    finally { syncing.current = false; setSyncBusy(false); }
  }
  const locked = busy || syncBusy || !!preview;
  const close = () => { if (!task.current && !syncing.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content sqlite-data-compare">
      <p>{text.intro}</p>
      <div className="sqlite-data-compare-pair">
        <CompareEndpoint dialect={dialect} label={text.source} connections={connections} disabled={locked} value={source} change={next => { setSource(next); clear(); }}/>
        <CompareEndpoint dialect={dialect} label={text.target} connections={connections} disabled={locked} value={target} change={next => { setTarget(next); clear(); }}/>
      </div>
      <fieldset disabled={locked} className="sqlite-data-compare-filter">
        <legend>{text.filter}</legend>
        <Field label={text.filterColumn}><input aria-label={text.filterColumn} value={filter.column} maxLength={512} onChange={event => { setFilter({ ...filter, column: event.target.value }); clear(); }}/></Field>
        <Field label={text.filterValue}><input aria-label={text.filterValue} value={filter.text} maxLength={4096} onChange={event => { setFilter({ ...filter, text: event.target.value }); clear(); }}/></Field>
      </fieldset>
      <ErrorBox message={error}/>
      {busy && <p role="status">{text.running}</p>}
      {syncBusy && <p role="status">{sync.working}</p>}
      {syncStatus && <p role="status">{syncStatus}</p>}
      {report && <>
        <p>{report.sharedSnapshot ? text.shared : text.split}</p>
        <p role="status">{text.key}　{report.keyColumns.join('，')}　{[[text.sourceRows, report.sourceRows], [text.targetRows, report.targetRows], [text.equal, report.equal], ...kinds.map(item => [text[item], report.counts[item]])].map(([label, count]) => label + ' ' + count).join(' · ')}</p>
        {report.syncSnapshotId ? <p>{postgres ? sync.scope : mysqlDataSyncZh.scope}　{sync.count(marked.size)}</p> :
          report.differences.length > 0 && <p>{postgres ? sync.unavailable : mysqlDataSyncZh.unavailable}</p>}
        {preview && <fieldset ref={review} disabled={syncBusy}>
          <legend>{sync.preview}</legend>
          <p>{connections.find(item => item.id === target.connectionId)?.name}　{preview.confirmation}</p>
          <p>{sync.insert} {preview.counts.insert} · {sync.update} {preview.counts.update} · {sync.delete} {preview.counts.delete}</p>
          <div className="sqlite-data-sync-preview-rows">
            <ul>{[...marked].map((row, index) => <li key={index}>{syncActions[row.kind]}　{keyLabel(row, dialect)}</li>)}</ul>
          </div>
          <Field label={sync.confirm}><input aria-label={sync.confirm} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></Field>
        </fieldset>}
        <Field label={text.kind}><select aria-label={text.kind} disabled={locked} value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0); setSelected(undefined); }}>
          <option value="all">{text.all}</option>{kinds.map(item => <option value={item} key={item}>{text[item]}</option>)}
        </select></Field>
        {rows.length ? <>
          <table><thead><tr>{report.syncSnapshotId && <th>{sync.select}</th>}<th>{text.kind}</th><th>{text.key}</th><th>{text.details}</th></tr></thead>
            <tbody>{rows.slice(page * limits.page, (page + 1) * limits.page).map((row, index) => <tr key={index}>
              {report.syncSnapshotId && <td><input type="checkbox" aria-label={sync.select + ' ' + keyLabel(row, dialect)} checked={marked.has(row)}
                disabled={locked || (!marked.has(row) && marked.size >= postgresDataSyncLimits.selected)} onChange={event => {
                  const checked = event.target.checked;
                  setMarked(previous => { const next = new Set(previous); if (checked) next.add(row); else next.delete(row); return next; });
                }}/></td>}
              <td>{text[row.kind]}</td><td className="sqlite-data-compare-key">{keyLabel(row, dialect)}</td>
              <td><button onClick={() => setSelected(row)}>{text.details}</button></td>
            </tr>)}</tbody>
          </table>
          <div className="sqlite-data-compare-pager">
            <button disabled={locked || !page} onClick={() => { setPage(page - 1); setSelected(undefined); }}>{text.prev}</button>
            <span>{page + 1} / {Math.ceil(rows.length / limits.page)}</span>
            <button disabled={locked || (page + 1) * limits.page >= rows.length} onClick={() => { setPage(page + 1); setSelected(undefined); }}>{text.next}</button>
          </div>
          {selected && <div ref={detail} role="group" aria-label={text.details}>
            <h3>{text.details}</h3><pre>{selected.key.map(value => display(value, dialect)).join(' / ')}</pre>
            <table><thead><tr><th>{text.field}</th><th>{text.source}</th><th>{text.target}</th></tr></thead><tbody>
              {selected.cells.map(({ column, source, target }) => <tr key={column}>
                <th>{report.columns[column].name}<br/>{report.columns[column].type}</th>
                <td><pre>{display(source, dialect)}</pre></td><td><pre>{display(target, dialect)}</pre></td>
              </tr>)}
            </tbody></table>
          </div>}
        </> : <p>{text.noDiff}</p>}
      </>}
    </div>
    <footer className="modal-footer"><button className="primary" disabled={!ready || locked} onClick={() => void compare()}>{text.run}</button>
      {busy && <button onClick={cancel}>{text.cancel}</button>}
      {preview ? <>
        <button disabled={syncBusy} onClick={() => { setPreview(undefined); setConfirmation(''); }}>{sync.back}</button>
        <button className="danger" disabled={syncBusy || confirmation !== preview.confirmation} onClick={() => void applySync()}>{sync.apply}</button>
      </> : report?.syncSnapshotId && <button disabled={locked || !marked.size} onClick={() => void previewSync()}>{sync.preview}</button>}
      <span className="grow"/><button disabled={busy || syncBusy} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
