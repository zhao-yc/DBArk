import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { postgresBackupTableLimit as limit } from '../../shared/postgresTable';
import { errorMessage, invoke, uid } from '../lib';
import { postgresTableBackupZh as text } from '../locales/postgresTableBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresTableBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]), [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState(new Set<string>()), [search, setSearch] = useState('');
  const [file, setFile] = useState<FileChoice | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [task, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!task;
  const visible = tables.filter(table => table.toLowerCase().includes(search.trim().toLowerCase()));
  const nextVisible = new Set([...selected, ...visible]);

  // 目录回包只更新当次连接或数据库，切换选择后的旧请求不会替换列表。
  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);
  useEffect(() => {
    if (!connectionId || !database) return;
    let current = true;
    void invoke('postgres.backup.catalogue', { connectionId, database }).then(items => {
      if (current) setTables(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [connectionId, database]);

  function changeDatabase(value: string) {
    setDatabase(value); setTables([]); setSelected(new Set()); setSearch(''); setLoading(!!value);
    setFile(null); setError(''); setMessage('');
  }
  async function choose() {
    if (occupied.current || !database || !selected.size) return;
    occupied.current = true;
    setBusy(true); setFile(null); setError(''); setMessage('');
    try {
      const name = database.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160) || 'postgresql';
      setFile(await invoke('postgres.table.exportChoose', { format: 'sql-backup-set', suggestedName: name + '-多表备份.sql' }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setBusy(false); }
  }
  async function start() {
    if (occupied.current || !file || !database || !selected.size) return;
    occupied.current = true;
    const taskId = uid(), tablesToSave = [...selected];
    setTask(taskId); setFile(null); setError(''); setMessage('');
    try {
      const result = await invoke('postgres.table.export', {
        connectionId, database, tables: tablesToSave, taskId, fileToken: file.token, format: 'sql-backup-set',
      });
      setMessage(text.done(tablesToSave.length, result.rows));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setTask(undefined); setCancelling(false); occupied.current = false; }
  }
  async function cancel() {
    if (!task || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId: task }); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const close = () => { if (!occupied.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connectionId} onChange={event => {
          if (event.target.value === connectionId) return;
          setConnection(event.target.value); setDatabases([]); changeDatabase('');
        }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length}
          onChange={event => { if (event.target.value !== database) changeDatabase(event.target.value); }}>
          <option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}
        </select></Field>
      </fieldset>
      {database && <fieldset disabled={locked || loading} className="database-backup-table-picker">
        <legend>{text.tables}</legend>
        <input aria-label={text.search} placeholder={text.search} value={search} onChange={event => setSearch(event.target.value)}/>
        <div>
          <button disabled={!visible.length || nextVisible.size > limit} onClick={() => setSelected(nextVisible)}>{text.visible}</button>
          <button disabled={!selected.size} onClick={() => setSelected(new Set())}>{text.clear}</button>
          <span>{text.selected(selected.size, limit)}</span>
        </div>
        <div className="database-backup-table-list">
          {visible.map(table => <label key={table}>
            <input type="checkbox" checked={selected.has(table)} disabled={selected.size >= limit && !selected.has(table)}
              onChange={event => {
                const next = new Set(selected);
                if (event.target.checked) next.add(table); else next.delete(table);
                setSelected(next);
              }}/>{table}
          </label>)}
          {!visible.length && <p>{loading ? text.loading : text.noTables}</p>}
        </div>
      </fieldset>}
      {file && <p>{file.name}</p>}
      {(task || message) && <p role="status">{task ? cancelling ? text.cancelling : text.saving : message}</p>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !selected.size} onClick={() => void choose()}>{text.choose}</button>
      {task ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !file || !selected.size} onClick={() => void start()}>{text.start}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
