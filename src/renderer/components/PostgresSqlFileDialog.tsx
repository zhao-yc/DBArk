import { useEffect, useRef, useState } from 'react';
import { postgresRestoreDatabaseName, type PostgresSqlFileChoice, type PostgresSqlFileResult } from '../../shared/postgresSqlFile';
import type { PostgresArchiveRestoreChoice } from '../../shared/postgresArchive';
import { errorMessage, invoke, uid } from '../lib';
import { postgresSqlFileZh as text } from '../locales/postgresSqlFile.zh-CN';
import { postgresArchiveZh as archiveText } from '../locales/postgresArchive.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresSqlFileDialog({ connections, onClose, onDatabaseCreated, archive }: {
  connections: readonly { id: string; name: string }[];
  archive?: PostgresArchiveRestoreChoice;
  onClose(): void;
  onDatabaseCreated(connectionId: string): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const dataOnly = archive?.selection.content === 'data';
  const [create, setCreate] = useState(!!archive && !dataOnly);
  const [newDatabase, setNewDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  const [file, setFile] = useState<PostgresSqlFileChoice | null>(null);
  const [result, setResult] = useState<PostgresSqlFileResult>();
  const [choosing, setChoosing] = useState(false), [task, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = choosing || !!task;
  const validName = !create || postgresRestoreDatabaseName.safeParse(newDatabase).success;
  const archiveReady = !!archive && !error && result?.outcome !== 'committed' &&
    result?.outcome !== 'unknown' && result?.databaseCreation !== 'unknown';
  const ready = !!database && validName && (!!file || archiveReady);
  const target = { connectionId, database, ...(create ? { newDatabase } : {}) };

  // 切换连接后的迟到目录不覆盖当前执行目标。
  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId, catalogueVersion]);
  function changeDatabase(value: string) {
    setDatabase(value); resetFile();
  }
  function resetFile() { setFile(null); setResult(undefined); setError(''); }
  async function choose() {
    if (occupied.current || !database || !validName) return;
    occupied.current = true;
    setChoosing(true); setFile(null); setError(''); setResult(undefined);
    try { setFile(await invoke('postgres.sqlFile.choose', target)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }
  async function execute() {
    if (occupied.current || !ready) return;
    occupied.current = true;
    const taskId = uid();
    setTask(taskId); setFile(null); setResult(undefined); setError('');
    try {
      const source = archive ? { archive: archive.selection } : { fileToken: file!.token };
      const result = await invoke('postgres.sqlFile.execute', { ...target, ...source, taskId });
      setResult(result);
      if (result.databaseCreation === 'created') {
        setCatalogueVersion(version => version + 1);
        onDatabaseCreated(connectionId);
      }
    }
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
  return <Modal title={archive ? text.archiveTitle : text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{archive ? text.archiveScope : text.scope}</p>
      {archive ? <p>{archive.name} · {archiveText[archive.selection.content]}{archive.selection.portable && ' · ' + archiveText.portable}</p> : <p>{text.limits}</p>}
      <p>{text.warning}</p>
      {dataOnly ? <p>{text.archiveDataOnly}</p> : <label className="check"><input type="checkbox" checked={create} disabled={locked} onChange={event => {
        setCreate(event.target.checked); resetFile();
      }}/>{text.createMode}</label>}
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connectionId} onChange={event => {
          if (event.target.value === connectionId) return;
          setConnection(event.target.value); setDatabases([]); changeDatabase('');
        }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={create ? text.maintenance : text.database}><select aria-label={create ? text.maintenance : text.database} value={database} disabled={!databases.length}
          onChange={event => { if (event.target.value !== database) changeDatabase(event.target.value); }}>
          <option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}
        </select></Field>
        {create && <Field label={text.newDatabase}><input aria-label={text.newDatabase} value={newDatabase} maxLength={63}
            aria-invalid={newDatabase !== '' && !validName} onChange={event => {
              setNewDatabase(event.target.value); resetFile();
            }}/></Field>}
      </fieldset>
      {create && <p>{newDatabase && !validName ? text.nameError : text.createWarning}</p>}
      {file && <p>{file.name} · {file.bytes.toLocaleString('zh-CN')} B</p>}
      {task && <p role="status">{cancelling ? text.cancelling : archive ? text.archiveRunning : text.running}</p>}
      {result && <section className="database-backup-plan" role="status">
        {result.databaseCreation && <p>{text.databaseCreation[result.databaseCreation]}</p>}
        <p>{text.outcome[result.outcome]} {text.completed(result.completed)}</p>
        {result.failure && <p>{result.failure.statement && text.failedAt(result.failure.statement) + ' · '}{text.reason[result.failure.reason]}</p>}
        {result.failure?.detail && <p>{result.failure.detail}</p>}
        {result.failure?.sqlState && <p>SQLSTATE {result.failure.sqlState}</p>}
        {result.archiveWarning && <details><summary>{archiveText.warnings}</summary><p>{result.archiveWarning}</p></details>}
        {result.cleanupWarning && <p>{text.cleanup}</p>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      {!archive && <button disabled={locked || !database || !validName} onClick={() => void choose()}>{text.choose}</button>}
      {task ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !ready} onClick={() => void execute()}>
          {create ? text.createAndExecute : archive ? text.archiveExecute : text.execute}
        </button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
