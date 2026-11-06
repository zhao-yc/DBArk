import { useEffect, useRef, useState } from 'react';
import type { CellValue } from '../../shared/contracts';
import {
  postgresDataCompareLimits as limits, postgresDataCompareSchema, postgresDataCompareZh as text,
  type PostgresDataCompareEndpoint as Endpoint, type PostgresDataCompareKind, type PostgresDataCompareOutput, type PostgresDataCompareRow,
} from '../../shared/postgresDataCompare';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Field, Modal } from './ui';
import '../sqliteDataCompare.css';

type Connection = { id: string; name: string };
const kinds = ['source-only', 'target-only', 'different'] as const;

function CompareEndpoint({ label, connections, disabled, value, change }: {
  label: string; connections: readonly Connection[]; disabled: boolean; value: Endpoint; change(next: Endpoint): void;
}) {
  const { connectionId, database, table } = value;
  const [databases, setDatabases] = useState<{ id: string; items: string[] }>();
  const [tables, setTables] = useState<{ id: string; database: string; items: string[] }>();
  const [databaseError, setDatabaseError] = useState(''), [tableError, setTableError] = useState('');
  // 目录请求不接管导航。换连接或数据库后，迟到的目录不能覆盖当前选择。
  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases({ id: connectionId, items });
    }).catch(reason => { if (current) setDatabaseError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);
  useEffect(() => {
    if (!connectionId || !database) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId, database }).then(items => {
      if (current) setTables({ id: connectionId, database, items });
    }).catch(reason => { if (current) setTableError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId, database]);
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

function display(value: CellValue | undefined): string {
  if (value === undefined) return text.absent;
  if (value === null) return 'NULL';
  return typeof value === 'object' ? 'BYTEA Base64 ' + value.base64 : JSON.stringify(value);
}

export function PostgresDataCompareDialog({ connections, onClose }: { connections: readonly Connection[]; onClose(): void }) {
  const initial = { connectionId: connections.length === 1 ? connections[0].id : '', database: '', table: '' };
  const [source, setSource] = useState<Endpoint>(initial), [target, setTarget] = useState<Endpoint>(initial);
  const [filter, setFilter] = useState({ column: '', text: '' });
  const [report, setReport] = useState<PostgresDataCompareOutput>(), [error, setError] = useState('');
  const [kind, setKind] = useState<PostgresDataCompareKind | 'all'>('all'), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PostgresDataCompareRow>(), [busy, setBusy] = useState(false);
  const task = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) detail.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const clear = () => { setReport(undefined); setError(''); setKind('all'); setPage(0); setSelected(undefined); };
  const ready = [source, target].every(side => side.table && connections.some(profile => profile.id === side.connectionId)) &&
    (source.connectionId !== target.connectionId || source.database !== target.database || source.table !== target.table) &&
    (!filter.text || !!filter.column);
  const rows = report?.differences.filter(row => kind === 'all' || row.kind === kind) ?? [];
  async function compare() {
    if (!ready || task.current) return;
    const parsed = postgresDataCompareSchema.safeParse({ source, target, taskId: uid(), ...(filter.text ? { filter } : {}) });
    if (!parsed.success) { setError(errorMessage(parsed.error)); return; }
    const active = { id: parsed.data.taskId, cancelled: false };
    task.current = active; setBusy(true); clear();
    try {
      const result = await invoke('postgres.compareData', parsed.data);
      if (!active.cancelled) setReport(result); else setError(text.cancelled);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { task.current = undefined; setBusy(false); }
  }
  function cancel() {
    const active = task.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    void invoke('postgres.compareData.cancel', { taskId: active.id }).catch(reason => {
      if (task.current === active) { active.cancelled = false; setError(errorMessage(reason)); }
    });
  }
  const close = () => { if (!task.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content sqlite-data-compare">
      <p>{text.intro}</p>
      <div className="sqlite-data-compare-pair">
        <CompareEndpoint label={text.source} connections={connections} disabled={busy} value={source} change={next => { setSource(next); clear(); }}/>
        <CompareEndpoint label={text.target} connections={connections} disabled={busy} value={target} change={next => { setTarget(next); clear(); }}/>
      </div>
      <fieldset disabled={busy} className="sqlite-data-compare-filter">
        <legend>{text.filter}</legend>
        <Field label={text.filterColumn}><input aria-label={text.filterColumn} value={filter.column} maxLength={512} onChange={event => { setFilter({ ...filter, column: event.target.value }); clear(); }}/></Field>
        <Field label={text.filterValue}><input aria-label={text.filterValue} value={filter.text} maxLength={4096} onChange={event => { setFilter({ ...filter, text: event.target.value }); clear(); }}/></Field>
      </fieldset>
      <ErrorBox message={error}/>
      {busy && <p role="status">{text.running}</p>}
      {report && <>
        <p>{report.sharedSnapshot ? text.shared : text.split}</p>
        <p role="status">{text.key}　{report.keyColumns.join('，')}　{[[text.sourceRows, report.sourceRows], [text.targetRows, report.targetRows], [text.equal, report.equal], ...kinds.map(item => [text[item], report.counts[item]])].map(([label, count]) => label + ' ' + count).join(' · ')}</p>
        <Field label={text.kind}><select aria-label={text.kind} value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0); setSelected(undefined); }}>
          <option value="all">{text.all}</option>{kinds.map(item => <option value={item} key={item}>{text[item]}</option>)}
        </select></Field>
        {rows.length ? <>
          <table><thead><tr><th>{text.kind}</th><th>{text.key}</th><th>{text.details}</th></tr></thead>
            <tbody>{rows.slice(page * limits.page, (page + 1) * limits.page).map((row, index) => <tr key={index}>
              <td>{text[row.kind]}</td><td className="sqlite-data-compare-key">{row.key.map(display).join(' / ').slice(0, 200)}</td>
              <td><button onClick={() => setSelected(row)}>{text.details}</button></td>
            </tr>)}</tbody>
          </table>
          <div className="sqlite-data-compare-pager">
            <button disabled={!page} onClick={() => { setPage(page - 1); setSelected(undefined); }}>{text.prev}</button>
            <span>{page + 1} / {Math.ceil(rows.length / limits.page)}</span>
            <button disabled={(page + 1) * limits.page >= rows.length} onClick={() => { setPage(page + 1); setSelected(undefined); }}>{text.next}</button>
          </div>
          {selected && <div ref={detail} role="group" aria-label={text.details}>
            <h3>{text.details}</h3><pre>{selected.key.map(display).join(' / ')}</pre>
            <table><thead><tr><th>{text.field}</th><th>{text.source}</th><th>{text.target}</th></tr></thead><tbody>
              {selected.cells.map(({ column, source, target }) => <tr key={column}>
                <th>{report.columns[column].name}<br/>{report.columns[column].type}</th>
                <td><pre>{display(source)}</pre></td><td><pre>{display(target)}</pre></td>
              </tr>)}
            </tbody></table>
          </div>}
        </> : <p>{text.noDiff}</p>}
      </>}
    </div>
    <footer className="modal-footer"><button className="primary" disabled={!ready || busy} onClick={() => void compare()}>{text.run}</button>
      {busy && <button onClick={cancel}>{text.cancel}</button>}<span className="grow"/><button disabled={busy} onClick={close}>{text.close}</button></footer>
  </Modal>;
}
