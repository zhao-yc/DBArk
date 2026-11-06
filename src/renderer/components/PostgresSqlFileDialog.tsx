import { useEffect, useRef, useState } from 'react';
import type { PostgresSqlFileChoice, PostgresSqlFileResult } from '../../shared/postgresSqlFile';
import { errorMessage, invoke, uid } from '../lib';
import { postgresSqlFileZh as text } from '../locales/postgresSqlFile.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresSqlFileDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [file, setFile] = useState<PostgresSqlFileChoice | null>(null);
  const [result, setResult] = useState<PostgresSqlFileResult>();
  const [choosing, setChoosing] = useState(false), [task, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = choosing || !!task;

  // 切换连接后的迟到目录不覆盖当前执行目标。
  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);
  function changeDatabase(value: string) {
    setDatabase(value); setFile(null); setResult(undefined); setError('');
  }
  async function choose() {
    if (occupied.current || !database) return;
    occupied.current = true;
    setChoosing(true); setFile(null); setError(''); setResult(undefined);
    try { setFile(await invoke('postgres.sqlFile.choose', { connectionId, database })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }
  async function execute() {
    if (occupied.current || !file || !database) return;
    occupied.current = true;
    const taskId = uid();
    setTask(taskId); setFile(null); setResult(undefined); setError('');
    try { setResult(await invoke('postgres.sqlFile.execute', { connectionId, database, fileToken: file.token, taskId })); }
    catch (reason) { setError(text.outcome.unknown + ' ' + errorMessage(reason)); }
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
      <p>{text.scope}</p><p>{text.limits}</p><p>{text.warning}</p>
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
      {file && <p>{file.name} · {file.bytes.toLocaleString('zh-CN')} B</p>}
      {task && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result && <section className="database-backup-plan" role="status">
        <p>{text.outcome[result.outcome]} {text.completed(result.completed)}</p>
        {result.failure && <p>{result.failure.statement && text.failedAt(result.failure.statement) + ' · '}{text.reason[result.failure.reason]}</p>}
        {result.failure?.detail && <p>{result.failure.detail}</p>}
        {result.failure?.sqlState && <p>SQLSTATE {result.failure.sqlState}</p>}
        {result.cleanupWarning && <p>{text.cleanup}</p>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !database} onClick={() => void choose()}>{text.choose}</button>
      {task ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !file} onClick={() => void execute()}>{text.execute}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
