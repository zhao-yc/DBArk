import { useState } from 'react';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresSearchPathLimit, postgresSearchPathSnapshotSchema,
  type PostgresSearchPathChange, type PostgresSearchPathSnapshot } from '../../shared/postgresSearchPath';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { postgresSearchPathZh as text } from '../locales/postgresSearchPath.zh-CN';
import { usePostgresSessionSetting } from '../usePostgresSessionSetting';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 只有本窗口最近一次读回的快照可应用。异常和来源变化后须重新读取或打开。 */
export function PostgresSearchPathDialog({intent, onRead, onApply, onClose}: {
  intent: QueryTransactionSettingsIntent;
  onRead(): Promise<PostgresSearchPathSnapshot>;
  onApply(expected: PostgresSearchPathSnapshot, change: PostgresSearchPathChange): Promise<PostgresSearchPathSnapshot>;
  onClose(): void;
}) {
  const [path, setPath] = useState(''), [candidate, setCandidate] = useState('');
  const {snapshot, pending, invalid, status, error, editable, request, close} = usePostgresSessionSetting({
    intent, onRead, onApply, onClose, text,
    parse: value => postgresSearchPathSnapshotSchema.parse(value),
    onSnapshot: next => { setPath(next.path); setCandidate(''); },
  });
  const appended = candidate ? (path.trimEnd() ? path.trimEnd() + ', ' : '') + postgresIdentifier(candidate) : '';
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
      <ErrorBox message={error}/>
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
