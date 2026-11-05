import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresSequenceCreateSchema, postgresSequencePlan, type PostgresSequenceInfo, type PostgresSequenceReadInput } from '../../shared/postgresSequence';
import { errorMessage, invoke } from '../lib';
import { postgresSequenceZh as text } from '../locales/postgresSequence.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';

const numericFields = ['start', 'increment', 'minimum', 'maximum', 'cache'] as const;

/** 仅展示原数据库目录；连接版本变化后废弃旧的回包。 */
export function PostgresSequenceDialog({ target, onClose }: { target: PostgresSequenceReadInput; onClose(): void }) {
  const { connectionId, database, table } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connectionId, database, table, version, attempt]);
  const [result, setResult] = useState<{ key: string; info?: PostgresSequenceInfo; error?: string }>();
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void invoke('postgres.sequence.read', { connectionId, database, table }).then(info => {
        if (active) setResult({ key, info });
      }, reason => {
        if (active) setResult({ key, error: errorMessage(reason) });
      });
    });
    return () => { active = false; };
  }, [connectionId, database, table, key]);
  const current = result?.key === key ? result : undefined;
  const info = current?.info;
  const fields = info && [
    [text.dataType, info.dataType], ...numericFields.map(field => [text[field], info[field]]),
    [text.cycle, info.cycle ? '是' : '否'], [text.lastValue, info.lastValue ?? text.noValue],
    [text.ownedBy, info.ownedBy ? [info.ownedBy.schema, info.ownedBy.relation, info.ownedBy.column]
      .map(postgresIdentifier).join('.') + (info.ownedBy.identity ? ' · ' + text.identity : '') : '—'],
    [text.comment, info.comment ?? '—'],
  ];
  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content pg-structure-content">
      <strong>{database} / {table}</strong>
      {!current && <Spinner text={text.loading}/>}
      <ErrorBox message={current?.error ?? ''}/>
      {fields && <><p>{text.hint}</p><table className="pg-structure-table"><tbody>{fields.map(([label, value]) =>
        <tr key={label}><th scope="row">{label}</th><td><code>{value}</code></td></tr>)}</tbody></table></>}
    </div>
    <footer className="modal-footer"><button disabled={!current} onClick={() => setAttempt(value => value + 1)}>{zh.common.refresh}</button>
      <span className="grow"/><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}

/** 创建窗口的能力只绑定原连接与草稿，未知结果时停止重放。 */
export function PostgresCreateSequenceDialog({ target, onClose, onDirtyChange, onCreated }: {
  target: PostgresCreateTableTarget; onClose(): void; onDirtyChange(value: boolean): void;
  onCreated(name: string, version: number, message: string): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [schemas, setSchemas] = useState<string[]>();
  const [draft, setDraft] = useState({ schema: '', name: '', dataType: 'bigint', start: '', increment: '', minimum: '', maximum: '', cache: '', cycle: false, comment: '' });
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const request = useRef<object | undefined>(undefined), locked = useRef(false);
  useEffect(() => {
    const owner = {};
    request.current = owner;
    setSchemas(undefined);
    setPreview(undefined);
    setError('');
    queueMicrotask(() => {
      if (request.current !== owner) return;
      void invoke('postgres.createTable.schemas', { connectionId, database }).then(list => {
        if (request.current !== owner) return;
        setSchemas(list);
        setDraft(previous => ({ ...previous, schema: list.includes(previous.schema) ? previous.schema : list[0] ?? '' }));
      }, reason => {
        if (request.current !== owner) return;
        setError(errorMessage(reason));
        setSchemas([]);
      });
    });
    return () => { if (request.current === owner) request.current = undefined; };
  }, [connectionId, database, version]);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 修改任一字段后，提交只能消费新预览。 */
  function edit<K extends keyof typeof draft>(key: K, value: typeof draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setDirty(true);
    setPreview(undefined);
    setError('');
  }

  /** 预览校验整数和目录，确认阶段保留真实事务终态。 */
  async function submit() {
    const owner = request.current;
    if (!owner || locked.current || unknown || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setPreview(undefined);
    let sent = false;
    try {
      if (!preview) {
        const input = postgresSequenceCreateSchema.parse({ connectionId, database, ...draft });
        postgresSequencePlan(input);
        const next = await invoke('postgres.sequence.preview', input);
        if (request.current === owner) setPreview(next);
      } else {
        sent = true;
        const result = await invoke('postgres.sequence.apply', { connectionId, database, token: preview.token });
        if (result.outcome === 'committed' && result.table) {
          onCreated(result.table, version, result.message);
          onClose();
        } else {
          setUnknown(result.outcome === 'unknown');
          setError(result.message);
        }
      }
    } catch (reason) {
      if (sent) setUnknown(true);
      if (sent || request.current === owner) setError(errorMessage(reason));
    } finally {
      locked.current = false;
      if (request.current) setBusy(false);
    }
  }

  /** 等待写请求结算，用户可以明确放弃本地草稿。 */
  function close() {
    if (!locked.current && (!dirty || unknown || window.confirm(text.discard))) onClose();
  }

  return <Modal title={text.create} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong><p>{text.createHint}</p>
      {!schemas && <Spinner text={text.loading}/>}
      {busy && <Spinner text={text.working}/>}
      <ErrorBox message={[unknown && text.unknown, error || (schemas?.length === 0 && text.none)].filter(Boolean).join(' ')}/>
      {preview ? <pre className="pg-create-sql">{preview.statements.join(';\n') + ';'}</pre> :
        <fieldset disabled={busy || unknown || !schemas?.length}>
          <div className="pg-create-target">
            <Field label={text.schema}><select value={draft.schema} onChange={event => edit('schema', event.target.value)}>
              {schemas?.map(schema => <option key={schema}>{schema}</option>)}</select></Field>
            <Field label={text.name}><input value={draft.name} maxLength={63} onChange={event => edit('name', event.target.value)}/></Field>
            <Field label={text.dataType}><select value={draft.dataType} onChange={event => edit('dataType', event.target.value)}>
              {['smallint', 'integer', 'bigint'].map(type => <option key={type}>{type}</option>)}</select></Field>
            {numericFields.map(field => <Field key={field} label={text[field]}><input value={draft[field]}
              maxLength={20} placeholder={text.defaultValue} onChange={event => edit(field, event.target.value)}/></Field>)}
            <Field label={text.comment}><input value={draft.comment} maxLength={4096} onChange={event => edit('comment', event.target.value)}/></Field>
          </div>
          <label><input type="checkbox" checked={draft.cycle} onChange={event => edit('cycle', event.target.checked)}/> {text.cycle}</label>
        </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={() => setPreview(undefined)}>{text.back}</button>}
      <span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || unknown || !schemas?.length || !draft.name.trim()} onClick={() => void submit()}>
        {preview ? text.apply : text.preview}
      </button>
    </footer>
  </Modal>;
}
