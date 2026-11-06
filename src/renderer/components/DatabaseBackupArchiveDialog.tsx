import { useRef, useState } from 'react';
import { databaseBackupKinds } from '../../shared/databaseBackup';
import { databaseBackupArchiveZh as text, type DatabaseBackupArchiveView } from '../../shared/databaseBackupArchiveFiles';
import { databaseBackupZh } from '../locales/databaseBackup.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal } from './ui';
import '../databaseBackup.css';

/** 操作结束之前保留对话框；取消请求只作用于当前操作，原操作负责给出最终结果。 */
export function DatabaseBackupArchiveDialog({ onClose }: { onClose(): void }) {
  const [archive, setArchive] = useState<DatabaseBackupArchiveView | null>(null);
  const [busy, setBusy] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const running = useRef<string | undefined>(undefined);
  async function run(action: 'open' | 'export') {
    if (running.current) return;
    const operationId = uid();
    running.current = operationId;
    setError(''); setStatus(''); setBusy(action === 'open' ? text.checking : text.exporting);
    try {
      if (action === 'open') {
        setArchive(null);
        const result = await invoke('backupArchive.open', { operationId });
        if (result) { setArchive(result); setStatus(text.checked); }
      } else if (archive) {
        const result = await invoke('backupArchive.exportSql', { operationId, token: archive.token });
        if (result) setStatus(result.cleanupPending ? text.cleanupPending : text.saved(result.name));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { running.current = undefined; setBusy(''); }
  }
  function cancel() {
    if (running.current) void invoke('backupArchive.cancel', { operationId: running.current }).catch(reason => setError(errorMessage(reason)));
  }
  const close = () => { if (!running.current) onClose(); };
  const counts = new Map<string, number>();
  for (const object of archive?.manifest.objects ?? []) counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <ErrorBox message={error}/>
      {(busy || status) && <p role="status">{busy || status}</p>}
      {archive && <section className="database-backup-plan">
        <p>{text.file}　{archive.name}</p>
        <p>{text.source}　{archive.manifest.database} · {archive.manifest.family === 'mysql' ? 'MySQL' : 'MariaDB'} {archive.manifest.serverVersion}</p>
        <p>{text.bytes}　{archive.manifest.dump.bytes}</p>
        <p>{text.hash}　<code>{archive.manifest.dump.sha256}</code></p>
        <p>{text.archiveHash}　<code>{archive.archive.sha256}</code></p>
        <h3>{text.objects}</h3>
        <ul>{databaseBackupKinds.map(kind => <li key={kind}>{databaseBackupZh.kinds[kind]}　{counts.get(kind) ?? 0}</li>)}</ul>
        {archive.manifest.externalDependencies.length > 0 && <details>
          <summary>{text.dependencies}（{archive.manifest.externalDependencies.length}）</summary>
          <ul>{archive.manifest.externalDependencies.map((value, index) => <li key={index}>{value}</li>)}</ul>
        </details>}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={!!busy} onClick={() => void run('open')}>{text.select}</button>
      <button className="primary" disabled={!!busy || !archive} onClick={() => void run('export')}>{text.export}</button>
      {busy && <button onClick={cancel}>{text.cancel}</button>}
      <span className="grow"/>
      <button disabled={!!busy} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
