import { useRef, useState } from 'react';
import type { NetworkConnectionProfile } from '../../shared/contracts';
import { databaseBackupKinds } from '../../shared/databaseBackup';
import { databaseBackupArchiveZh as text, type DatabaseBackupArchiveView, type DatabaseBackupRestoreTargetAudit, type DatabaseBackupSqlInventory } from '../../shared/databaseBackupArchiveFiles';
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
  const [inventory, setInventory] = useState<DatabaseBackupSqlInventory | null>(null);
  const [busy, setBusy] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const running = useRef<string | undefined>(undefined);
  const target = connections.find(connection => connection.id === connectionId);
  const familyName = (family: NetworkConnectionProfile['dialect']) => family === 'mysql' ? 'MySQL' : 'MariaDB';
  async function run(action: 'open' | 'export' | 'audit' | 'inspectSql') {
    if (running.current) return;
    const operationId = uid();
    running.current = operationId;
    const busyMessage = { open: text.checking, export: text.exporting, audit: text.auditing, inspectSql: text.inspectingSql };
    setError(''); setStatus(''); setBusy(busyMessage[action]);
    try {
      if (action === 'open') {
        setArchive(null); setAudit(null); setInventory(null);
        const result = await invoke('backupArchive.open', { operationId });
        if (result) { setArchive(result); setStatus(text.checked); }
      } else if (action === 'export' && archive) {
        const result = await invoke('backupArchive.exportSql', { operationId, token: archive.token });
        if (result) setStatus(result.cleanupPending ? text.cleanupPending : text.saved(result.name));
      } else if (action === 'inspectSql' && archive) {
        setInventory(null);
        setInventory(await invoke('backupArchive.inspectSql', { operationId, token: archive.token }));
      } else if (action === 'audit' && archive && target) {
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
      {inventory && <section className="database-backup-plan" role="region" aria-label={text.sqlInventory} aria-live="polite">
        <h3>{text.sqlInventory}</h3>
        <p>{text.sqlInventoryState[inventory.state]}</p>
        <p>{text.sqlInventoryCounts(inventory.definitions, inventory.statements, inventory.dataStatements)}</p>
        {!!inventory.databases.length && <p>{text.sqlDatabases}　{inventory.databases.join(' · ')}</p>}
        {!!inventory.definers.length && <p>{text.sqlDefiners}　{inventory.definers.join(' · ')}</p>}
        {inventory.reason && <p>{text.sqlReason[inventory.reason]}</p>}
        {!!inventory.otherStatements && <p>{text.sqlOther(inventory.otherStatements)}</p>}
        {(['missing', 'extra'] as const).map(kind => inventory[kind].total > 0 && <details key={kind} open>
          <summary>{kind === 'missing' ? text.sqlMissing : text.sqlExtra}（{inventory[kind].total}）</summary>
          <ul>{inventory[kind].items.map(item => <li key={JSON.stringify([item.kind, item.name])}>{item.kind === 'table' ? text.sqlTable : databaseBackupZh.kinds[item.kind]}　{item.name}</li>)}</ul>
        </details>)}
        <p>{text.sqlScope}</p>
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
      <button disabled={!!busy || !archive} onClick={() => void run('inspectSql')}>{text.inspectSql}</button>
      <button className="primary" disabled={!!busy || !archive} onClick={() => void run('export')}>{text.export}</button>
      {busy && <button onClick={cancel}>{text.cancel}</button>}
      <span className="grow"/>
      <button disabled={!!busy} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
