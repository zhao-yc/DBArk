import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresCreateViewPreviewSchema, type PostgresCreateViewKind } from '../../shared/postgresCreateView';
import { errorMessage, invoke } from '../lib';
import { postgresCreateViewZh as text } from '../locales/postgresCreateView.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';

/** 编辑、预览及确认绑定原数据库和连接修订，提交结果未知时停止再次发送。 */
export function PostgresCreateViewDialog({ target, kind, onDirtyChange, onCreated, onClose }: {
  target: PostgresCreateTableTarget;
  kind: PostgresCreateViewKind;
  onDirtyChange(value: boolean): void;
  onCreated(view: string, version: number, message: string): void;
  onClose(): void;
}) {
  const materialized = kind === 'materialized';
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const dialect = useWorkspace(state => state.connections.find(item => item.id === connectionId)?.dialect);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [draft, setDraft] = useState({ schema: '', view: '', definition: '', comment: '', populate: true });
  const [preview, setPreview] = useState<(PostgresCreateTablePreview & { version: number })>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const operation = useRef(false), lifecycle = useRef<object | undefined>(undefined);

  useEffect(() => {
    const owner = {};
    lifecycle.current = owner;
    setPreview(undefined);
    setLoading(true);
    setSchemas([]);
    setError('');
    queueMicrotask(async () => {
      if (lifecycle.current !== owner) return;
      try {
        if (dialect !== 'postgresql') throw Error(text.changed);
        const list = await invoke('postgres.createTable.schemas', { connectionId, database });
        if (lifecycle.current !== owner) return;
        setSchemas(list);
        setDraft(previous => ({ ...previous, schema: list.includes(previous.schema) ? previous.schema : list[0] ?? '' }));
      } catch (reason) {
        if (lifecycle.current === owner) setError(errorMessage(reason));
      } finally {
        if (lifecycle.current === owner) setLoading(false);
      }
    });
    return () => { if (lifecycle.current === owner) lifecycle.current = undefined; };
  }, [connectionId, database, dialect, version]);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 编辑只修改本地草稿，原预览不再可提交。 */
  function edit<K extends keyof typeof draft>(field: K, value: typeof draft[K]) {
    if (operation.current || unknown) return;
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    setPreview(undefined);
    setError('');
  }

  /** 预览只读取目录，确认才消费准确令牌并请求创建。 */
  async function submit(apply: boolean) {
    const owner = lifecycle.current;
    if (!owner || operation.current || unknown || loading || dialect !== 'postgresql' ||
        (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version ||
        apply && preview?.version !== version) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setPreview(undefined);
    let sent = false;
    try {
      if (!apply) {
        const { populate, ...fields } = draft;
        const input = postgresCreateViewPreviewSchema.parse({ connectionId, database, ...fields,
          ...(materialized ? { materialized: { populate } } : {}),
        });
        const result = await invoke('postgres.createView.preview', input);
        if (lifecycle.current === owner) setPreview({ ...result, version });
        return;
      }
      sent = true;
      const result = await invoke('postgres.createView.apply', { connectionId, database, token: preview!.token });
      if (result.outcome === 'committed' && result.table) {
        onCreated(result.table, version, result.message);
        onClose();
      } else {
        setUnknown(result.outcome === 'unknown');
        setError(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      }
    } catch (reason) {
      if (sent) setUnknown(true);
      if (sent || lifecycle.current === owner)
        setError((sent ? text.unknown + ' ' : '') + errorMessage(reason));
    } finally {
      operation.current = false;
      if (lifecycle.current) setBusy(false);
    }
  }

  /** 等待原提交结算，关闭尚有草稿的窗口须明确丢弃。 */
  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  return <Modal title={materialized ? text.materializedTitle : text.title} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong>
      <p>{preview ? text.review : materialized ? text.materializedHint : text.hint}</p>
      {loading && <Spinner text={text.wait} />}
      {busy && <Spinner text={text.working} />}
      <ErrorBox message={error || (!loading && !schemas.length ? text.empty : '')} />
      {preview ? <pre className="pg-create-sql">{preview.statements.join(';\n\n') + ';'}</pre> :
        <fieldset disabled={busy || loading || unknown || !schemas.length}>
          <div className="pg-create-target">
            <Field label={text.schema}><select value={draft.schema} onChange={event => edit('schema', event.target.value)}>
              {schemas.map(schema => <option key={schema}>{schema}</option>)}</select></Field>
            <Field label={materialized ? text.materializedName : text.name}><input value={draft.view} maxLength={63} onChange={event => edit('view', event.target.value)} /></Field>
            <Field label={text.comment}><input value={draft.comment} maxLength={4096} onChange={event => edit('comment', event.target.value)} /></Field>
          </div>
          <Field label={text.definition}><textarea className="pg-create-view-definition" value={draft.definition}
            spellCheck={false} rows={8} maxLength={128 * 1024} onChange={event => edit('definition', event.target.value)} /></Field>
          {materialized && <label><input type="checkbox" checked={draft.populate}
            onChange={event => edit('populate', event.target.checked)} /> {text.populate}</label>}
        </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={() => setPreview(undefined)}>{text.edit}</button>}
      <span className="grow"/>
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || loading || unknown || !schemas.length}
        onClick={() => void submit(!!preview)}>{preview ? materialized ? text.materializedApply : text.apply : text.preview}</button>
    </footer>
  </Modal>;
}
