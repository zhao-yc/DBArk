import { useRef, useState } from 'react';
import type { NetworkConnectionProfile } from '../../shared/contracts';
import { databaseBackupKinds } from '../../shared/databaseBackup';
import { databaseBackupArchiveZh as text, type DatabaseBackupArchiveView, type DatabaseBackupRestoreTargetAudit } from '../../shared/databaseBackupArchiveFiles';
import { databaseBackupZh } from '../locales/databaseBackup.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal } from './ui';
import '../databaseBackup.css';

/** 操作结束之前保留对话框；取消请求只作用于当前操作，原操作负责给出最终结果。 */
export function DatabaseBackupArchiveDialog({ connections, onClose }: {
  connections: readonly Pick<NetworkConnectionProfile, 'id' | 'name' | 'dialect'>[];
  onClose(): void;
}) {
  const [archive, setArchive] = useState<DatabaseBackupArchiveView | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [audit, setAudit] = useState<DatabaseBackupRestoreTargetAudit | null>(null);
  const [busy, setBusy] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const running = useRef<string | undefined>(undefined);
  const target = connections.find(connection => connection.id === connectionId);
  const familyName = (family: NetworkConnectionProfile['dialect']) => family === 'mysql' ? 'MySQL' : 'MariaDB';
  async function run(action: 'open' | 'export' | 'audit') {
    if (running.current) return;
    const operationId = uid();
    running.current = operationId;
    setError(''); setStatus(''); setBusy(action === 'open' ? text.checking : action === 'export' ? text.exporting : text.auditing);
    try {
      if (action === 'open') {
        setArchive(null); setAudit(null);
        const result = await invoke('backupArchive.open', { operationId });
        if (result) { setArchive(result); setStatus(text.checked); }
      } else if (action === 'export' && archive) {
        const result = await invoke('backupArchive.exportSql', { operationId, token: archive.token });
        if (result) setStatus(result.cleanupPending ? text.cleanupPending : text.saved(result.name));
      } else if (archive && target) {
        setAudit(null);
        setAudit(await invoke('backupArchive.auditTarget', { operationId, token: archive.token, connectionId: target.id }));
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
        <p>{text.source}　{archive.manifest.database} · {familyName(archive.manifest.family)} {archive.manifest.serverVersion}</p>
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
      {archive && <section className="database-backup-plan">
        <h3>{text.target}</h3>
        {connections.length ? <div className="database-backup-target">
          <select aria-label={text.target} disabled={!!busy} value={target?.id ?? ''}
            onChange={event => { setConnectionId(event.target.value); setAudit(null); setError(''); }}>
            <option value="">{text.targetPlaceholder}</option>
            {connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {familyName(connection.dialect)}</option>)}
          </select>
          <button disabled={!!busy || !target} onClick={() => void run('audit')}>{text.audit}</button>
        </div> : <p>{text.noTargets}</p>}
        {audit && target && <div role="region" aria-label={text.auditResult} aria-live="polite">
          <p>{text.targetServer}　{familyName(audit.family)} {audit.version} · {text.targetVersion[audit.versionMatches ? 'match' : 'mismatch']}</p>
          <p>{text.targetDatabase}　{audit.actualDatabase ?? audit.database} · {text.targetState[audit.state]}</p>
          <p>{text.scheduler}　{text.schedulerState[audit.scheduler]}</p>
          {audit.visible && <p>{Object.entries(audit.visible).map(([kind, amount]) => `${text.visible[kind as keyof typeof text.visible]} ${amount}`).join(' · ')}</p>}
          {audit.blockers.length > 0 && <ul>{audit.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul>}
          <p>{text.auditScope}</p>
        </div>}
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
