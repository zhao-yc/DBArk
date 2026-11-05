import { useState } from 'react';
import { postgresViewManagePreviewSchema } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresViewManageZh as text } from '../locales/postgresViewManage.zh-CN';
import { ErrorBox, Field } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 重命名和受限删除复用原结构窗口的提交与未知结果保护。 */
export function PostgresViewManagePanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [action, setAction] = useState<'rename' | 'drop'>('rename');
  const [name, setName] = useState('');
  const dropping = action === 'drop';
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, submit } =
    usePostgresStructureEdit(props, dropping || !!name, dropping, async () => {
      const base = original.kind === 'm'
        ? { ...target, stamp: original.materializedManageStamp, relationKind: 'materialized' }
        : { ...target, stamp: original.viewEditStamp };
      const input = postgresViewManagePreviewSchema.parse(dropping ? { ...base, action } : { ...base, action, name });
      return invoke('postgres.viewManage.preview', input);
    }, token => invoke('postgres.viewManage.apply', { connectionId: target.connectionId, database: target.database, token }));

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    <p>{dropping ? original.kind === 'm' ? text.materializedDropHint : text.dropHint : text.renameHint}</p>
    {preview ? <>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/>{text.acknowledge}
      </label>}
    </> : <fieldset disabled={busy || unknown}>
      <div className="pg-column-edit-fields">
        <Field label={text.operation}><select value={action} onChange={event => {
          setAction(event.target.value as typeof action);
          setError('');
        }}><option value="rename">{text.rename}</option><option value="drop">{text.drop}</option></select></Field>
        {!dropping && <Field label={text.name}><input value={name} maxLength={63} onChange={event => {
          setName(event.target.value);
          setError('');
        }}/></Field>}
      </div>
    </fieldset>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={dropping ? 'danger' : 'primary'} disabled={busy || unknown || dropping && !acceptDrop}
          onClick={() => void submit(true)}>{dropping ? text.confirmDrop : text.confirmRename}</button>
      </> : <button className="primary" disabled={busy || unknown || !dropping && (!name.trim() || name === original.name)}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
