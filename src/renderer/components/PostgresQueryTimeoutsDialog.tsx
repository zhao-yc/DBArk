import { useState } from 'react';
import { postgresQueryTimeoutSnapshot, postgresQueryTimeoutValues,
  type PostgresQueryTimeoutSnapshot, type PostgresQueryTimeoutChange } from '../../shared/postgresQueryTimeouts';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { usePostgresSessionSetting } from '../usePostgresSessionSetting';
import { postgresQueryTimeoutsZh as text } from '../locales/postgresQueryTimeouts.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';

export function PostgresQueryTimeoutsDialog({intent, onRead, onApply, onClose}: {
  intent: QueryTransactionSettingsIntent;
  onRead(): Promise<PostgresQueryTimeoutSnapshot>;
  onApply(expected: PostgresQueryTimeoutSnapshot, change: PostgresQueryTimeoutChange): Promise<PostgresQueryTimeoutSnapshot>;
  onClose(): void;
}) {
  const [statement, setStatement] = useState(''), [lock, setLock] = useState('');
  const {snapshot, pending, invalid, status, error, editable, request, close} = usePostgresSessionSetting({
    intent, onRead, onApply, onClose, text,
    parse: value => postgresQueryTimeoutSnapshot.parse(value),
    onSnapshot: next => { setStatement(String(next.statementMs)); setLock(String(next.lockMs)); },
  });
  const values = postgresQueryTimeoutValues.safeParse({
    statementMs: /^\d{1,10}$/.test(statement) ? Number(statement) : NaN,
    lockMs: /^\d{1,10}$/.test(lock) ? Number(lock) : NaN,
  });
  const changed = values.success && (values.data.statementMs !== snapshot?.statementMs || values.data.lockMs !== snapshot?.lockMs);
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content">
      <p>{text.intro}</p><p className="muted small">{text.help}</p>
      {snapshot && <p>{text.identity(snapshot.database, snapshot.processId)}</p>}
      <Field label={text.statement}><input aria-label={text.statement} value={statement} inputMode="numeric"
        disabled={!editable} onChange={event => setStatement(event.target.value)}/></Field>
      <Field label={text.lock}><input aria-label={text.lock} value={lock} inputMode="numeric"
        disabled={!editable} onChange={event => setLock(event.target.value)}/></Field>
      {snapshot && <p>{text.defaults(snapshot.defaults.statementMs, snapshot.defaults.lockMs)}</p>}
      {editable && !values.success && <p role="note">{text.invalid}</p>}
      <p role="status">{pending ? <Spinner text={status}/> : status}</p>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={pending || invalid} onClick={() => void request()}>{text.refresh}</button>
      <button disabled={!editable} onClick={() => void request({mode: 'reset'})}>{text.reset}</button>
      <span className="grow"/><button disabled={pending} onClick={close}>{text.close}</button>
      <button className="primary" disabled={!editable || !changed}
        onClick={() => { if (values.success) void request({mode: 'set', values: values.data}); }}>{text.apply}</button>
    </footer>
  </Modal>;
}
