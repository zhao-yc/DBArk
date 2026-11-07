import { useEffect, useRef, useState } from 'react';
import { postgresTransactionIsolations, postgresTransactionSnapshotSchema, type PostgresTransactionDefaults, type PostgresTransactionSnapshot } from '../../shared/postgresTransactionSettings';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { postgresTransactionSettingsZh as text } from '../locales/postgresTransactionSettings.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 原快照只在本弹窗内存；失败撤销再次修改资格，禁止旧值或迟到响应自动重发。 */
export function PostgresTransactionSettingsDialog({intent, connectionName, onRead, onApply, onClose}: {
  intent: QueryTransactionSettingsIntent; connectionName: string;
  onRead(): Promise<PostgresTransactionSnapshot>;
  onApply(expected: PostgresTransactionSnapshot, defaults: PostgresTransactionDefaults): Promise<PostgresTransactionSnapshot>;
  onClose(): void;
}) {
  const alive = useRef(true), running = useRef(false), fresh = useRef(false), generation = useRef(0);
  const [pending, setPending] = useState(false), [invalid, setInvalid] = useState(false), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<PostgresTransactionSnapshot>();
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [defaults, setDefaults] = useState<PostgresTransactionDefaults>({isolation: 'READ COMMITTED', readOnly: false, deferrable: false});
  const defaultsRef = useRef(defaults); defaultsRef.current = defaults;
  const [status, setStatus] = useState(''), [requiresRead, setRequiresRead] = useState(true);

  async function request(apply = false) {
    if (!alive.current || running.current || !intent.current()) return;
    const before = snapshot;
    if (apply && (!fresh.current || !before || snapshotRef.current !== before || defaultsRef.current !== defaults || before.transactionOpen)) return;
    const epoch = ++generation.current; running.current = true; fresh.current = false;
    setRequiresRead(true); setPending(true); setError(''); setStatus(apply ? text.applying : text.loading);
    try {
      const next = postgresTransactionSnapshotSchema.parse(await (apply ? onApply(before!, {...defaults}) : onRead()));
      if (!alive.current || generation.current !== epoch) return;
      intent.assertCurrent();
      if (before && (next.processId !== before.processId || next.backendStart !== before.backendStart || next.database !== before.database)) throw Error(text.changed);
      snapshotRef.current = next; setSnapshot(next); setDefaults({isolation: next.isolation, readOnly: next.readOnly, deferrable: next.deferrable});
      fresh.current = true; setRequiresRead(false); setStatus(apply ? text.applied : text.ready);
    } catch (reason) { if (alive.current && generation.current === epoch) { setError(errorMessage(reason)); setStatus(text.uncertain); } }
    finally { if (alive.current && generation.current === epoch) { running.current = false; setPending(false); } }
  }
  function close() { if (!running.current) onClose(); }
  useEffect(() => {
    alive.current = true;
    const stop = intent.subscribe(() => { fresh.current = false; setRequiresRead(true); setInvalid(true); });
    void request();
    return () => { alive.current = false; generation.current++; stop(); };
  }, [intent]);
  const blocked = pending || invalid || requiresRead, unchanged = !snapshot || snapshot.isolation === defaults.isolation && snapshot.readOnly === defaults.readOnly && snapshot.deferrable === defaults.deferrable;
  return <Modal title={text.title} onClose={close} wide>
    <div className="modal-content">
      <p>{connectionName}</p><p>{text.hint}</p><p className="muted small">{text.semantics}</p>
      {snapshot && <dl><dt>{text.database}</dt><dd>{snapshot.database}</dd><dt>{text.identity}</dt><dd>{snapshot.processId}</dd>
        <dt>{text.transaction}</dt><dd>{snapshot.transactionOpen ? text.active : text.idle}</dd></dl>}
      <Field label={text.isolation}><select aria-label={text.isolation} value={defaults.isolation} disabled={blocked || snapshot?.transactionOpen}
        onChange={event => setDefaults({...defaults, isolation: event.target.value as PostgresTransactionDefaults['isolation']})}>
        {postgresTransactionIsolations.map(value => <option key={value} value={value}>{value}</option>)}
      </select></Field>
      <label className="check"><input type="checkbox" checked={defaults.readOnly} disabled={blocked || snapshot?.transactionOpen}
        onChange={event => setDefaults({...defaults, readOnly: event.target.checked})}/>{text.readOnly}</label>
      <label className="check"><input type="checkbox" checked={defaults.deferrable} disabled={blocked || snapshot?.transactionOpen}
        onChange={event => setDefaults({...defaults, deferrable: event.target.checked})}/>{text.deferrable}</label>
      <p role="status">{pending ? <Spinner text={status}/> : status}</p><ErrorBox message={invalid ? text.changed : error}/>
    </div>
    <footer className="modal-footer"><button disabled={pending || invalid} onClick={() => void request()}>{text.refresh}</button>
      <span className="grow"/><button disabled={pending} onClick={close}>{text.close}</button>
      <button className="primary" disabled={blocked || unchanged || snapshot?.transactionOpen} onClick={() => void request(true)}>{text.apply}</button>
    </footer>
  </Modal>;
}
