import { useState } from 'react';
import { postgresEditViewPreviewSchema } from '../../shared/postgresCreateView';
import { invoke } from '../lib';
import { postgresViewEditZh as text } from '../locales/postgresViewEdit.zh-CN';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 预填服务器定义，沿用结构编辑器的原窗口保护、预览和明确提交。 */
export function PostgresViewEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [definition, setDefinition] = useState(original.viewDefinition ?? '');
  const dirty = definition !== original.viewDefinition;
  const { preview, setPreview, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, dirty, false,
      async () => invoke('postgres.editView.preview', postgresEditViewPreviewSchema.parse({
        ...target, definition, stamp: original.viewEditStamp,
      })),
      token => invoke('postgres.editView.apply', { connectionId: target.connectionId, database: target.database, token }));

  /** 明确放弃本地草稿，未知终态下关闭编辑将重新读取目录。 */
  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={[unknown && text.unknown, error].filter(Boolean).join(' ')}/>
    {preview ? <>
      <p>{text.review}</p>
      <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
    </> : <>
      <p>{text.hint}</p>
      <label>{text.definition}<textarea rows={10} spellCheck={false} maxLength={128 * 1024}
        value={definition} disabled={busy || unknown} onChange={event => {
          setDefinition(event.target.value);
          setError('');
        }}/></label>
    </>}
    <div className="pg-column-edit-actions">
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || unknown} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || unknown || !dirty || !definition.trim()}
        onClick={() => void submit(false)}>{text.preview}</button>}
      <button disabled={busy} onClick={close}>{text.close}</button>
    </div>
  </section>;
}
