import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import type { PostgresDatabaseBackupResult } from '../../shared/postgresDatabaseBackup';
import { errorMessage, invoke, uid } from '../lib';
import { postgresDatabaseBackupZh as text } from '../locales/postgresDatabaseBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresDatabaseBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [format, setFormat] = useState<'sql' | 'custom'>('sql');
  const [portable, setPortable] = useState(false);
  const [tool, setTool] = useState<FileChoice | null>(null), [file, setFile] = useState<FileChoice | null>(null);
  const [result, setResult] = useState<PostgresDatabaseBackupResult>();
  const [busy, setBusy] = useState(false), [taskId, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!taskId;

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);

  function resetFile() { setFile(null); setResult(undefined); setError(''); }
  async function choose(which: 'tool' | 'file') {
    if (occupied.current || which === 'file' && (!tool || !database)) return;
    occupied.current = true;
    setBusy(true);
    resetFile();
    try {
      if (which === 'tool') {
        setTool(null);
        setTool(await invoke('postgres.backup.chooseDumpTool', {}));
      } else if (tool) {
        setFile(await invoke('postgres.backup.chooseDatabaseFile', { connectionId, database, format, portable, toolToken: tool.token }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); occupied.current = false; }
  }
  async function start() {
    if (occupied.current || !tool || !file || !database) return;
    occupied.current = true;
    const id = uid();
    setTask(id);
    resetFile();
    try {
      setResult(await invoke('postgres.backup.database', { connectionId, database, format, portable, toolToken: tool.token, fileToken: file.token, taskId: id }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setTask(undefined); setCancelling(false); occupied.current = false; }
  }
  async function cancel() {
    if (!taskId || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const close = () => { if (!occupied.current) onClose(); };

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connectionId} onChange={event => {
          if (event.target.value === connectionId) return;
          setConnection(event.target.value); setDatabase(''); setDatabases([]); resetFile();
        }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length} onChange={event => {
          if (event.target.value === database) return;
          setDatabase(event.target.value); resetFile();
        }}><option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label={text.format}><select aria-label={text.format} value={format} onChange={event => {
          const value = event.target.value === 'custom' ? 'custom' : 'sql';
          if (value === format) return;
          setFormat(value); setPortable(false); resetFile();
        }}><option value="sql">{text.sql}</option><option value="custom">{text.custom}</option></select></Field>
      </fieldset>
      {format === 'sql' && <label className="check"><input type="checkbox" checked={portable} disabled={locked} onChange={event => {
        setPortable(event.target.checked); resetFile();
      }}/>{text.portable}</label>}
      <p>{format === 'sql' ? text.portableHint : text.customHint}</p>
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.tool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      {file && <p>{file.name}</p>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result && <section className="database-backup-plan" role="status">
        <p>{text.done(result.bytes, result.toolVersion)}</p>
        {result.warning && <details><summary>{text.warnings}</summary><p>{result.warning}</p></details>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !database || !tool} onClick={() => void choose('file')}>{text.choose}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !file} onClick={() => void start()}>{text.start}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
