import { useState } from 'react';
import { postgresMaterializedRefreshSchema, type PostgresMaterializedRefreshInput } from '../../shared/postgresMaterializedView';
import { invoke } from '../lib';
import { postgresMaterializedRefreshZh as text } from '../locales/postgresMaterializedRefresh.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 按目录资格提供刷新方式，清除数据沿用独立的确认勾选。 */
export function PostgresMaterializedRefreshPanel(props: PostgresStructureEditProps) {
  const { original, target, onClose } = props;
  const [mode, setMode] = useState<PostgresMaterializedRefreshInput['mode']>('data');
  const clearing = mode === 'empty';
  const concurrent = original.materialized?.populated && original.materialized.uniqueIndex;
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, true, clearing, async () => invoke('postgres.materializedRefresh.preview',
      postgresMaterializedRefreshSchema.parse({ ...target, mode, stamp: original.materialized?.stamp })),
    token => invoke('postgres.materializedRefresh.apply', { connectionId: target.connectionId, database: target.database, token }));

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    <p>{text.descriptions[mode]}</p>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {clearing && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/>{text.acknowledge}
      </label>}
    </> : <fieldset disabled={busy || unknown}>
      <Field label={text.mode}><select value={mode} onChange={event => {
        setMode(event.target.value as typeof mode);
        setError('');
      }}>
        <option value="data">{text.modes.data}</option>
        <option value="concurrent" disabled={!concurrent}>{text.modes.concurrent}</option>
        <option value="empty">{text.modes.empty}</option>
      </select></Field>
      {!concurrent && <p className="muted">{text.ineligible}</p>}
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={clearing ? 'danger' : 'primary'} disabled={busy || unknown || clearing && !acceptDrop}
          onClick={() => void submit(true)}>{clearing ? text.confirmEmpty : text.confirm}</button>
      </> : <button className="primary" disabled={busy || unknown} onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
