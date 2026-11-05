import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresRoutineCreateSchema, type PostgresRoutineCreateInput } from '../../shared/postgresRoutine';
import { errorMessage, invoke } from '../lib';
import { postgresRoutineZh as text } from '../locales/postgresRoutine.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';

type Kind = PostgresRoutineCreateInput['kind'];
type Parameter = PostgresRoutineCreateInput['parameters'][number];
type Fields = { schema: string; name: string; kind: Kind; language: 'sql' | 'plpgsql'; returns: string; setReturning: boolean;
  volatility: 'volatile' | 'stable' | 'immutable'; securityDefiner: boolean; comment: string; body: string; parameters: Parameter[] };

/** 只有原连接上的一次性预览可以发出创建。未知提交结果时保留提示并停止重放。 */
export function PostgresCreateRoutineDialog({ target, onClose, onDirtyChange, onCreated }: {
  target: PostgresCreateTableTarget; onClose(): void; onDirtyChange(value: boolean): void;
  onCreated(kind: Kind, name: string, version: number, message: string): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [schemas, setSchemas] = useState<string[]>();
  const [draft, setDraft] = useState<Fields>({ schema: '', name: '', kind: 'function', language: 'sql', returns: 'integer',
    setReturning: false, volatility: 'volatile', securityDefiner: false, comment: '', body: '', parameters: [] });
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const lifecycle = useRef<object | undefined>(undefined), pending = useRef(false);
  const inferred = draft.parameters.some(parameter => parameter.mode === 'out' || parameter.mode === 'inout');

  useEffect(() => {
    const owner = {};
    lifecycle.current = owner;
    setSchemas(undefined);
    setPreview(undefined);
    setError('');
    queueMicrotask(() => {
      if (lifecycle.current !== owner) return;
      void invoke('postgres.createTable.schemas', { connectionId, database }).then(list => {
        if (lifecycle.current !== owner) return;
        setSchemas(list);
        setDraft(previous => ({ ...previous, schema: list.includes(previous.schema) ? previous.schema : list[0] ?? '' }));
      }, reason => {
        if (lifecycle.current !== owner) return;
        setError(errorMessage(reason));
        setSchemas([]);
      });
    });
    return () => { if (lifecycle.current === owner) lifecycle.current = undefined; };
  }, [connectionId, database, version]);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 任何表单修改都废弃旧预览。 */
  function edit<K extends keyof Fields>(field: K, value: Fields[K]) {
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    setPreview(undefined);
    setError('');
  }

  function editParameter(index: number, value: Partial<Parameter>) {
    edit('parameters', draft.parameters.map((parameter, position) => position === index ? { ...parameter, ...value } : parameter));
  }

  /** 发送后保留服务端原始事务结果，连接版本变化不会把未知提交转为成功。 */
  async function submit() {
    const owner = lifecycle.current;
    if (!owner || pending.current || unknown || !schemas?.length ||
        (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) return;
    pending.current = true;
    setBusy(true);
    setPreview(undefined);
    setError('');
    try {
      if (preview) {
        const result = await invoke('postgres.routine.create.apply', { connectionId, database, token: preview.token });
        if (result.outcome === 'committed' && result.table) {
          onCreated(draft.kind, result.table, version, result.message);
          onClose();
        } else {
          setUnknown(result.outcome === 'unknown');
          setError(result.message);
        }
      } else {
        const { returns, setReturning, volatility, ...base } = draft;
        const input = postgresRoutineCreateSchema.parse({ ...base, connectionId, database,
          ...(draft.kind === 'function' ? { returns: inferred ? '' : returns, setReturning, volatility } : {}) });
        const result = await invoke('postgres.routine.create.preview', input);
        if (lifecycle.current === owner) setPreview(result);
      }
    } catch (reason) {
      if (preview) setUnknown(true);
      if (preview || lifecycle.current === owner) setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (lifecycle.current) setBusy(false);
    }
  }

  function close() {
    if (!pending.current && (!dirty || unknown || window.confirm(text.discard))) onClose();
  }

  return <Modal title={text.create} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong><p>{text.hint}</p>
      {!schemas && <Spinner text={text.wait}/>}{busy && <Spinner text={text.working}/>}
      <ErrorBox message={[unknown && text.unknown, error || (schemas?.length === 0 && text.empty)].filter(Boolean).join(' ')}/>
      {preview ? <pre className="pg-create-sql">{preview.statements.join(';\n\n') + ';'}</pre> :
        <fieldset disabled={busy || unknown || !schemas?.length}>
          <div className="pg-create-target">
            <Field label={text.schema}><select aria-label={text.schema} value={draft.schema} onChange={event => edit('schema', event.target.value)}>
              {schemas?.map(schema => <option key={schema}>{schema}</option>)}</select></Field>
            <Field label={text.kind}><select aria-label={text.kind} value={draft.kind} onChange={event => edit('kind', event.target.value as Kind)}>
              <option value="function">{text.categories.f}</option><option value="procedure">{text.categories.p}</option></select></Field>
            <Field label={text.name}><input maxLength={63} value={draft.name} onChange={event => edit('name', event.target.value)}/></Field>
            <Field label={text.language}><select aria-label={text.language} value={draft.language} onChange={event => edit('language', event.target.value as Fields['language'])}>
              <option value="sql">SQL</option><option value="plpgsql">PL/pgSQL</option></select></Field>
            <Field label={text.comment}><input maxLength={4096} value={draft.comment} onChange={event => edit('comment', event.target.value)}/></Field>
          </div>
          {draft.parameters.map((parameter, index) => <fieldset className="pg-create-field" key={index}>
            <legend>{text.arguments} {index + 1}</legend>
            <Field label={text.parameterName}><input aria-label={text.parameterName + ' ' + (index + 1)} maxLength={63} value={parameter.name}
              onChange={event => editParameter(index, { name: event.target.value })}/></Field>
            <Field label={text.parameterMode}><select aria-label={text.parameterMode + ' ' + (index + 1)} value={parameter.mode}
              onChange={event => editParameter(index, { mode: event.target.value as Parameter['mode'],
                ...(event.target.value === 'out' ? { default: { mode: 'none' } } : {}) })}>
              {['in', 'out', 'inout', 'variadic'].map(mode => <option key={mode} value={mode}>{mode.toUpperCase()}</option>)}</select></Field>
            <Field label={text.parameterType}><input aria-label={text.parameterType + ' ' + (index + 1)} maxLength={512} value={parameter.type}
              onChange={event => editParameter(index, { type: event.target.value })}/></Field>
            <Field label={text.defaultMode}><select aria-label={text.defaultMode + ' ' + (index + 1)} value={parameter.default.mode} disabled={parameter.mode === 'out'}
              onChange={event => editParameter(index, { default: event.target.value === 'literal' ? { mode: 'literal', value: '' }
                : { mode: event.target.value === 'null' ? 'null' : 'none' } })}>
              <option value="none">{text.noDefault}</option><option value="null">NULL</option><option value="literal">{text.literal}</option></select></Field>
            {parameter.default.mode === 'literal' && <Field label={text.defaultValue}><input aria-label={text.defaultValue + ' ' + (index + 1)}
              maxLength={4096} value={parameter.default.value} onChange={event => editParameter(index, { default: { mode: 'literal', value: event.target.value } })}/></Field>}
            <button onClick={() => edit('parameters', draft.parameters.filter((_, position) => position !== index))}>{text.removeParameter}</button>
          </fieldset>)}
          <button disabled={draft.parameters.length >= 100} onClick={() => edit('parameters', [...draft.parameters,
            { name: '', mode: 'in', type: 'integer', default: { mode: 'none' } }])}>{text.addParameter}</button>
          {draft.kind === 'function' && <div className="pg-create-target">
            {inferred ? <span>{text.inferred}</span> : <Field label={text.returns}><input value={draft.returns} maxLength={512}
              onChange={event => edit('returns', event.target.value)}/></Field>}
            <Field label={text.volatility}><select aria-label={text.volatility} value={draft.volatility}
              onChange={event => edit('volatility', event.target.value as Fields['volatility'])}>
              <option value="volatile">{text.volatilityValues.v}</option><option value="stable">{text.volatilityValues.s}</option>
              <option value="immutable">{text.volatilityValues.i}</option></select></Field>
            <label><input type="checkbox" checked={draft.setReturning} onChange={event => edit('setReturning', event.target.checked)}/> {text.setReturning}</label>
          </div>}
          <p><label><input type="checkbox" checked={draft.securityDefiner} onChange={event => edit('securityDefiner', event.target.checked)}/> SECURITY DEFINER</label></p>
          {draft.securityDefiner && <p>{text.definerHint}</p>}
          <Field label={text.body}><textarea aria-label={text.body} className="pg-create-view-definition" rows={7} spellCheck={false}
            maxLength={128 * 1024} value={draft.body} onChange={event => edit('body', event.target.value)}/></Field>
        </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={() => setPreview(undefined)}>{text.back}</button>}
      <span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || unknown || !schemas?.length || !draft.name.trim() || !draft.body.trim()}
        onClick={() => void submit()}>{preview ? text.confirm : text.preview}</button>
    </footer>
  </Modal>;
}
