import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { mysqlBackupDatabase, type MysqlDatabaseBackupResult } from '../../shared/mysqlDatabaseBackup';
import { errorMessage, invoke, uid } from '../lib';
import { mysqlDatabaseBackupZh as text } from '../locales/mysqlDatabaseBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function MysqlDatabaseBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [tool, setTool] = useState<FileChoice | null>(null);
  const [file, setFile] = useState<FileChoice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<MysqlDatabaseBackupResult>();
  const [busy, setBusy] = useState(false), [taskId, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!taskId;
  const connection = connections.find(item => item.id === connectionId);

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('mysql.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items.filter(item => mysqlBackupDatabase.safeParse(item).success));
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);

  function resetFile() { setFile(null); setConfirmed(false); setResult(undefined); setError(''); }

  async function choose(which: 'tool' | 'file') {
    if (occupied.current || which === 'file' && (!tool || !connection || !database)) return;
    occupied.current = true;
    setBusy(true);
    resetFile();
    try {
      if (which === 'tool') {
        setTool(null);
        setTool(await invoke('mysql.backup.chooseTool', {}));
      } else if (tool) {
        setFile(await invoke('mysql.backup.chooseFile', { connectionId, database, toolToken: tool.token }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); occupied.current = false; }
  }

  async function start() {
    if (occupied.current || !connection || !tool || !file || !database || !confirmed) return;
    occupied.current = true;
    const id = uid();
    setTask(id);
    resetFile();
    try {
      setResult(await invoke('mysql.backup.database', {
        connectionId, database, toolToken: tool.token, fileToken: file.token, taskId: id, acknowledgeSnapshot: true,
      }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setTask(undefined); setCancelling(false); occupied.current = false; }
  }

  async function cancel() {
    if (!taskId || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={text.title} wide onClose={() => { if (!occupied.current) onClose(); }}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p><p>{text.snapshot}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connection?.id ?? ''} onChange={event => {
          setConnection(event.target.value); setDatabase(''); setDatabases([]); resetFile();
        }}>
          <option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length} onChange={event => {
          setDatabase(event.target.value); resetFile();
        }}>
          <option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}
        </select></Field>
      </fieldset>
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.tool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      {file && <section className="database-backup-plan">
        <p>{file.name}</p>
        <label className="check"><input type="checkbox" disabled={locked} checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}/>{text.confirm}</label>
      </section>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result && <section role="status" className="database-backup-plan">
        <p>{text.saved(result.bytes, result.toolVersion)}</p><p>{result.serverVersion}</p>
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !connection || !database || !tool} onClick={() => void choose('file')}>{text.choose}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !file || !confirmed} onClick={() => void start()}>{text.start}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={onClose}>{text.close}</button>
    </footer>
  </Modal>;
}
