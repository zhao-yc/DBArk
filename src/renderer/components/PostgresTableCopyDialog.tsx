import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresTableCopyPreviewSchema, type PostgresTableCopyInput } from '../../shared/postgresTableCopy';
import { errorMessage, invoke } from '../lib';
import { postgresTableCopyZh as text } from '../locales/postgresTableCopy.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 预览仅属于当前来源、目标输入和连接修订，真实提交回执优先于界面收尾。 */
export function PostgresTableCopyDialog({ target, source, onDirtyChange, onCreated, onClose }: {
  target: PostgresCreateTableTarget;
  source: string;
  onDirtyChange(dirty: boolean): void;
  onCreated(table: string, version: number, message: string): void;
  onClose(): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [schemas, setSchemas] = useState<string[]>([]), [schema, setSchema] = useState('');
  const [name, setName] = useState(''), [mode, setMode] = useState<PostgresTableCopyInput['mode']>('structure');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PostgresCreateTablePreview>(), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  const lifecycle = useRef<object | undefined>(undefined), operation = useRef(false);
  useEffect(() => {
    const owner = {};
    lifecycle.current = owner;
    setLoading(true); setPreview(undefined); setConfirmed(false); setSchemas([]);
    void invoke('postgres.createTable.schemas', { connectionId, database }).then(list => {
      if (lifecycle.current !== owner) return;
      setSchemas(list); setSchema(previous => list.includes(previous) ? previous : list[0] ?? '');
    }, reason => {
      if (lifecycle.current === owner) setError(errorMessage(reason));
    }).finally(() => { if (lifecycle.current === owner) setLoading(false); });
    return () => { if (lifecycle.current === owner) lifecycle.current = undefined; };
  }, [connectionId, database, source, version]);
  useEffect(() => { onDirtyChange(busy); return () => onDirtyChange(false); }, [busy, onDirtyChange]);

  const current = () => !!lifecycle.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version;
  function edit(change: () => void) {
    if (operation.current || unknown || !current()) return;
    setPreview(undefined); setConfirmed(false); setError(''); change();
  }

  async function prepare() {
    if (operation.current || loading || unknown || !current()) return;
    const input = postgresTableCopyPreviewSchema.safeParse({ connectionId, database, source, schema, name, mode });
    if (!input.success) { setError(input.error.issues[0]?.message ?? text.changed); return; }
    const owner = lifecycle.current;
    operation.current = true; setBusy(true); setError(''); setPreview(undefined); setConfirmed(false);
    try {
      const result = await invoke('postgres.createTable.copy.preview', input.data);
      if (lifecycle.current === owner && current()) setPreview(result);
    } catch (reason) { if (lifecycle.current === owner) setError(errorMessage(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  async function apply() {
    if (operation.current || !confirmed || !preview || !current()) return;
    operation.current = true; setBusy(true); setError(''); setPreview(undefined); setConfirmed(false);
    try {
      const result = await invoke('postgres.createTable.copy.apply', { connectionId, database, token: preview.token, confirmed: true });
      if (result.outcome === 'committed' && result.table) {
        const message = result.copiedRows === undefined ? result.message : result.message + '。' + text.copied(result.copiedRows);
        onCreated(result.table, version, message); onClose();
      } else {
        setUnknown(result.outcome === 'unknown'); setError(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      }
    } catch (reason) { setUnknown(true); setError(text.unknown + ' ' + errorMessage(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  const close = () => { if (!operation.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content">
      <p><strong>{source}</strong></p>
      <p>{text.scope}</p><p>{text.dataScope}</p>
      {loading ? <Spinner/> : <div className="form-grid">
        <Field label={text.schema}><select aria-label={text.schema} disabled={busy || unknown} value={schema} onChange={event => edit(() => setSchema(event.target.value))}>
          {schemas.map(value => <option key={value}>{value}</option>)}
        </select></Field>
        <Field label={text.name}><input aria-label={text.name} disabled={busy || unknown} maxLength={63} value={name} onChange={event => edit(() => setName(event.target.value))}/></Field>
        <Field label={text.mode}><select aria-label={text.mode} disabled={busy || unknown} value={mode} onChange={event => edit(() => setMode(event.target.value === 'data' ? 'data' : 'structure'))}>
          <option value="structure">{text.structure}</option><option value="data">{text.data}</option>
        </select></Field>
      </div>}
      {preview && <><pre className="pg-create-sql">{preview.statements.join(';\n\n')};</pre>
        <label><input type="checkbox" aria-label={text.confirm} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> {text.confirm}</label></>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button disabled={busy} onClick={close}>{text.close}</button>
      <button disabled={busy || loading || unknown || !name || !schema} onClick={() => void prepare()}>{text.preview}</button>
      <button className="primary" disabled={busy || !preview || !confirmed || unknown} onClick={() => void apply()}>{text.apply}</button></footer>
  </Modal>;
}
