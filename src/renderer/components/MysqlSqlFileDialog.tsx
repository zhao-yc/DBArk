import { useEffect, useRef, useState } from 'react';
import { mysqlSqlFileEncodings, type MysqlSqlFileChoice, type MysqlSqlFileChooseInput } from '../../shared/mysqlSqlFile';
import { sqlFileImportReceiptSchema, type SqlFileImportReceipt } from '../../shared/sqlFileImport';
import { mysqlSqlFileZh as text } from '../locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh } from '../locales/sqlFileImport.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { SqlFileImportReport } from './SqlFileImportReport';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function MysqlSqlFileDialog({ connections, onRefresh, onClose }: {
  connections: readonly { id: string; name: string; database?: string | null }[];
  onRefresh(connectionId: string): void;
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [encoding, setEncoding] = useState<MysqlSqlFileChooseInput['encoding']>('utf8');
  const [file, setFile] = useState<MysqlSqlFileChoice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<SqlFileImportReceipt | null>();
  const [choosing, setChoosing] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = choosing || !!taskId;
  const connection = connections.find(item => item.id === connectionId);
  const defaultDatabase = connection?.database;

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    setLoading(true);
    void invoke('mysql.compareData.catalogue', { connectionId }).then(items => {
      if (!current) return;
      setDatabases(items);
      if (defaultDatabase && items.includes(defaultDatabase)) setDatabase(defaultDatabase);
    }).catch(reason => { if (current) setError(errorMessage(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [connectionId, defaultDatabase]);

  const target = { connectionId, database: database || null, encoding };
  function reset() { setFile(null); setConfirmed(false); setResult(undefined); setError(''); }

  async function choose() {
    if (occupied.current || !connection || loading) return;
    occupied.current = true;
    setChoosing(true);
    reset();
    try { setFile(await invoke('mysql.sqlFile.choose', target)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }

  async function run() {
    if (occupied.current || !connection || !file || !confirmed || loading) return;
    occupied.current = true;
    const id = uid();
    setTaskId(id);
    reset();
    try {
      const response = await invoke('mysql.sqlFile.execute', { ...target, taskId: id, fileToken: file.token, acknowledgeScript: true });
      const receipt = sqlFileImportReceiptSchema.safeParse(response.sql);
      setResult(receipt.success && receipt.data.taskId === id && receipt.data.encoding === encoding ? receipt.data : null);
      onRefresh(connectionId);
    } catch (reason) {
      setError(errorMessage(reason));
      onRefresh(connectionId);
    } finally {
      occupied.current = false;
      setTaskId(undefined);
      setCancelling(false);
    }
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
      <p>{text.transaction}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connection?.id ?? ''} onChange={event => {
          setConnection(event.target.value); setDatabase(''); setDatabases([]); setLoading(!!event.target.value); reset();
        }}>
          <option value="">—</option>{connections.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!connection || loading} onChange={event => {
          setDatabase(event.target.value); reset();
        }}>
          <option value="">{loading ? text.catalogue : text.noDatabase}</option>
          {databases.map(name => <option key={name}>{name}</option>)}
        </select></Field>
        <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} onChange={event => {
          setEncoding(event.target.value as typeof encoding); reset();
        }}>
          {mysqlSqlFileEncodings.map(value => <option key={value} value={value}>{sqlFileImportZh.encodings[value]}</option>)}
        </select></Field>
      </fieldset>
      {file && <section className="database-backup-plan">
        <p>{file.name} · {file.bytes.toLocaleString()} 字节</p>
        <label className="check"><input type="checkbox" checked={confirmed} disabled={locked}
          onChange={event => setConfirmed(event.target.checked)}/>{text.trust}</label>
      </section>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result !== undefined && <SqlFileImportReport receipt={result}/>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !connection || loading} onClick={() => void choose()}>{text.choose}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || loading || !connection || !file || !confirmed} onClick={() => void run()}>{text.run}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
