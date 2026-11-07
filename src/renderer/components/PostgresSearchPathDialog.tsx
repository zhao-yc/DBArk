import { useEffect, useRef, useState } from 'react';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresSearchPathLimit, postgresSearchPathSnapshotSchema,
  type PostgresSearchPathChange, type PostgresSearchPathSnapshot } from '../../shared/postgresSearchPath';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { postgresSearchPathZh as text } from '../locales/postgresSearchPath.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 只有本窗口最近一次读回的快照可应用。异常和来源变化后须重新读取或打开。 */
export function PostgresSearchPathDialog({intent, onRead, onApply, onClose}: {
  intent: QueryTransactionSettingsIntent;
  onRead(): Promise<PostgresSearchPathSnapshot>;
  onApply(expected: PostgresSearchPathSnapshot, change: PostgresSearchPathChange): Promise<PostgresSearchPathSnapshot>;
  onClose(): void;
}) {
  const mounted = useRef(false), running = useRef(false), generation = useRef(0);
  const fresh = useRef<PostgresSearchPathSnapshot | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<PostgresSearchPathSnapshot>();
  const [path, setPath] = useState(''), [candidate, setCandidate] = useState('');
  const [pending, setPending] = useState(false), [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');

  async function request(change?: PostgresSearchPathChange) {
    if (!mounted.current || running.current || !intent.current()) return;
    const before = change ? fresh.current : undefined;
    if (change && (!before || snapshot !== before)) return;
    const epoch = ++generation.current;
    running.current = true;
    fresh.current = undefined;
    setPending(true);
    setError('');
    setStatus(change ? text.applying : text.loading);
    try {
      const next = postgresSearchPathSnapshotSchema.parse(await (change ? onApply(before!, change) : onRead()));
      if (!mounted.current || generation.current !== epoch) return;
      intent.assertCurrent();
      fresh.current = next;
      setSnapshot(next);
      setPath(next.path);
      setCandidate('');
      setStatus(change ? text.applied : text.ready);
    } catch (reason) {
      if (mounted.current && generation.current === epoch) {
        setError(errorMessage(reason));
        setStatus('');
      }
    } finally {
      if (mounted.current && generation.current === epoch) {
        running.current = false;
        setPending(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    running.current = false;
    const unsubscribe = intent.subscribe(() => { fresh.current = undefined; setInvalid(true); });
    void request();
    return () => { mounted.current = false; generation.current++; unsubscribe(); };
  }, [intent]);

  const editable = !pending && !invalid && !!fresh.current;
  const appended = candidate ? (path.trimEnd() ? path.trimEnd() + ', ' : '') + postgresIdentifier(candidate) : '';
  function close() { if (!running.current) onClose(); }
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content">
      <p>{text.intro}</p>
      {snapshot && <p>{text.identity(snapshot.database, snapshot.role, snapshot.processId)}</p>}
      <Field label={text.configured}><textarea aria-label={text.configured} rows={3} value={path} maxLength={postgresSearchPathLimit}
        disabled={!editable} onChange={event => setPath(event.target.value)}/></Field>
      <p className="muted small">{text.help}</p>
      {snapshot && <>
        <div className="postgres-result-actions">
          <Field label={text.candidates}><select aria-label={text.candidates} value={candidate} disabled={!editable}
            onChange={event => setCandidate(event.target.value)}>
            <option value="">{text.choose}</option>
            {snapshot.candidates.map(name => <option key={name} value={name}>{name}</option>)}
          </select></Field>
          <button disabled={!editable || !appended || appended.length > postgresSearchPathLimit}
            onClick={() => setPath(appended)}>{text.append}</button>
        </div>
        {snapshot.candidatesTruncated && <p>{text.candidatesTruncated}</p>}
        <strong>{text.effective}</strong>
        {snapshot.effective.length ? <ol aria-label={text.effective} style={{maxHeight: '9rem', overflow: 'auto', overflowWrap: 'anywhere'}}>
          {snapshot.effective.map((name, index) => <li key={index}>{name}</li>)}
        </ol> : <p>{text.effectiveEmpty}</p>}
      </>}
      <p role="status">{pending ? <Spinner text={status}/> : status}</p>
      <ErrorBox message={invalid ? text.changed : error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={pending || invalid} onClick={() => void request()}>{text.refresh}</button>
      <button disabled={!editable} onClick={() => void request({mode: 'reset'})}>{text.reset}</button>
      <span className="grow"/>
      <button disabled={pending} onClick={close}>{text.close}</button>
      <button className="primary" disabled={!editable || path === snapshot?.path}
        onClick={() => void request({mode: 'set', path})}>{text.apply}</button>
    </footer>
  </Modal>;
}
