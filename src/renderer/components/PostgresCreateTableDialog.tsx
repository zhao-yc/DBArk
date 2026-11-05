import { useEffect, useRef, useState } from 'react';
import {
  postgresCreateTablePreviewSchema, postgresCreateTypes, type PostgresCreateColumn, type PostgresCreateTablePreview,
  type PostgresCreateTableTarget,
} from '../../shared/postgresCreateTable';
import { errorMessage, invoke, uid } from '../lib';
import { postgresCreateTableZh as text } from '../locales/postgresCreateTable.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';

type FieldDraft = PostgresCreateColumn & { id: string };

/** 新字段使用普通可空文本类型，用户明确选择其他属性。 */
function newField(): FieldDraft {
  return { id: uid(), name: '', type: 'text', nullable: true, primary: false, unique: false,
    identity: 'none', default: { mode: 'none' }, comment: '' };
}

/** 表单草稿、SQL 预览与原连接版本绑定，写入结果未知时禁止重复发送。 */
export function PostgresCreateTableDialog({ target, onDirtyChange, onCreated, onClose }: {
  target: PostgresCreateTableTarget; onDirtyChange(value: boolean): void; onCreated(table: string, version: number, message: string): void; onClose(): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const dialect = useWorkspace(state => state.connections.find(profile => profile.id === connectionId)?.dialect);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState('');
  const [table, setTable] = useState('');
  const [comment, setComment] = useState('');
  const [fields, setFields] = useState(() => [newField()]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<(PostgresCreateTablePreview & { version: number })>();
  const lifecycle = useRef<object | undefined>(undefined);
  const operation = useRef(false);
  const closing = useRef(false);

  useEffect(() => {
    const owner = {};
    lifecycle.current = owner;
    setPreview(undefined);
    setSchemas([]);
    setLoading(true);
    setError('');
    queueMicrotask(async () => {
      if (lifecycle.current !== owner) return;
      try {
        if (dialect !== 'postgresql') throw Error(text.changed);
        const result = await invoke('postgres.createTable.schemas', { connectionId, database });
        if (lifecycle.current !== owner) return;
        setSchemas(result);
        setSchema(value => result.includes(value) ? value : result[0] ?? '');
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

  /** 所有编辑立即取消本地预览，下一次只能使用新建表单。 */
  function edit(update: () => void) {
    if (operation.current || unknown) return;
    setDirty(true);
    setPreview(undefined);
    setError('');
    update();
  }

  /** 更新原字段，保留字段顺序和本地控件身份。 */
  function patch(id: string, change: Partial<PostgresCreateColumn>) {
    edit(() => setFields(previous => previous.map(field => field.id === id ? { ...field, ...change } : field)));
  }

  /** 进入其他数据类型时撤下不兼容的长度、精度、默认函数和标识选项。 */
  function changeType(field: FieldDraft, type: PostgresCreateColumn['type']) {
    const identity = ['bigint','integer','smallint'].includes(type) ? field.identity : 'none';
    const defaultValue = field.default.mode === 'currentDate' && type !== 'date' ||
      field.default.mode === 'currentTimestamp' && !['timestamp','timestamptz'].includes(type) ? { mode: 'none' as const } : field.default;
    patch(field.id, { type, length: undefined, precision: undefined, scale: undefined, identity, default: defaultValue });
  }

  /** 主进程收到的预览只有结构字段，原文 SQL 由数据库引擎生成。 */
  async function prepare() {
    if (operation.current || loading || unknown) return;
    const input = postgresCreateTablePreviewSchema.safeParse({ ...target, schema, table, comment, columns: fields.map(({ id: _id, ...field }) => field) });
    if (!input.success) { setError(input.error.issues[0]?.message ?? text.changed); return; }
    const owner = lifecycle.current;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await invoke('postgres.createTable.preview', input.data);
      if (lifecycle.current === owner) setPreview({ ...result, version });
    } catch (reason) {
      if (lifecycle.current === owner) setError(errorMessage(reason));
    } finally {
      operation.current = false;
      if (!closing.current) setBusy(false);
    }
  }

  /** 提交前先消费本地预览，任何 IPC 中断都要求核对原库。 */
  async function apply() {
    if (operation.current || !preview || preview.version !== version || dialect !== 'postgresql') return;
    operation.current = true;
    setBusy(true);
    setError('');
    setPreview(undefined);
    try {
      const result = await invoke('postgres.createTable.apply', { ...target, token: preview.token });
      if (result.outcome === 'committed' && result.table) {
        closing.current = true;
        onCreated(result.table, version, result.message);
        onClose();
        return;
      }
      const uncertain = result.outcome === 'unknown';
      setUnknown(uncertain);
      setError(uncertain ? text.unknown + ' ' + result.message : result.message);
    } catch (reason) {
      setUnknown(true);
      setError(text.unknown + ' ' + errorMessage(reason));
    } finally {
      operation.current = false;
      if (!closing.current) setBusy(false);
    }
  }

  /** 忙碌时等待原结果，放弃尚未提交的草稿需要明确确认。 */
  function close() {
    if (operation.current || closing.current || dirty && !unknown && !window.confirm(text.canceled)) return;
    closing.current = true;
    onClose();
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong>
      {loading && <Spinner text={text.wait}/>}
      <ErrorBox message={error || (!loading && !schemas.length ? text.empty : '')}/>
      {preview ? <>
        <p>{text.review}</p><p>{database} / {schema}</p>
        <pre className="pg-create-sql">{preview.statements.join(';\n\n') + ';'}</pre>
      </> : <fieldset disabled={busy || loading || unknown || !schemas.length}>
        <div className="pg-create-target">
          <Field label={text.schema}><select aria-label={text.schema} value={schema} onChange={event => edit(() => setSchema(event.target.value))}>
            {schemas.map(item => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label={text.table}><input value={table} onChange={event => edit(() => setTable(event.target.value))}/></Field>
          <Field label={text.tableComment}><input value={comment} maxLength={4096} onChange={event => edit(() => setComment(event.target.value))}/></Field>
        </div>
        {fields.map((field, index) => <fieldset className="pg-create-field" key={field.id}>
          <legend>{text.field(index + 1)}</legend>
          <Field label={text.name}><input value={field.name} onChange={event => patch(field.id, { name: event.target.value })}/></Field>
          <Field label={text.type}><select aria-label={text.type} value={field.type} onChange={event => changeType(field, event.target.value as PostgresCreateColumn['type'])}>
            {postgresCreateTypes.map(type => <option key={type}>{type}</option>)}</select></Field>
          {field.type === 'varchar' && <Field label={text.length}><input type="number" min={1} value={field.length ?? ''} onChange={event => patch(field.id, { length: event.target.value ? Number(event.target.value) : undefined })}/></Field>}
          {field.type === 'numeric' && <>
            <Field label={text.precision}><input type="number" min={1} max={1000} value={field.precision ?? ''} onChange={event => patch(field.id, { precision: event.target.value ? Number(event.target.value) : undefined, ...(!event.target.value ? { scale: undefined } : {}) })}/></Field>
            <Field label={text.scale}><input type="number" min={0} max={1000} disabled={!field.precision} value={field.scale ?? ''} onChange={event => patch(field.id, { scale: event.target.value ? Number(event.target.value) : undefined })}/></Field>
          </>}
          <label><input type="checkbox" checked={field.nullable && !field.primary && field.identity === 'none'} disabled={field.primary || field.identity !== 'none'} onChange={event => patch(field.id, { nullable: event.target.checked })}/>{text.nullable}</label>
          <label><input type="checkbox" checked={field.primary} onChange={event => patch(field.id, { primary: event.target.checked })}/>{text.primary}</label>
          <label><input type="checkbox" checked={field.unique} onChange={event => patch(field.id, { unique: event.target.checked })}/>{text.unique}</label>
          {['bigint','integer','smallint'].includes(field.type) && <Field label={text.identity}>
            <select aria-label={text.identity} value={field.identity} onChange={event => patch(field.id, {
              identity: event.target.value as PostgresCreateColumn['identity'], default: { mode: 'none' },
            })}><option value="none">{text.identityNone}</option><option value="always">{text.identityAlways}</option><option value="byDefault">{text.identityDefault}</option></select>
          </Field>}
          <Field label={text.default}><select aria-label={text.default} disabled={field.identity !== 'none'} value={field.default.mode}
            onChange={event => { const mode = event.target.value as PostgresCreateColumn['default']['mode']; patch(field.id, { default: mode === 'literal' ? { mode, value: '' } : { mode } }); }}>
            <option value="none">{text.noDefault}</option><option value="literal">{text.literal}</option>
            {field.type === 'date' && <option value="currentDate">{text.currentDate}</option>}
            {['timestamp','timestamptz'].includes(field.type) && <option value="currentTimestamp">{text.currentTimestamp}</option>}
          </select></Field>
          {field.default.mode === 'literal' && <Field label={text.value}><input value={field.default.value} maxLength={4096} onChange={event => patch(field.id, { default: { mode: 'literal', value: event.target.value } })}/></Field>}
          <Field label={text.comment}><input value={field.comment} maxLength={4096} onChange={event => patch(field.id, { comment: event.target.value })}/></Field>
          <button disabled={fields.length === 1} onClick={() => edit(() => setFields(previous => previous.filter(item => item.id !== field.id)))}>{text.remove}</button>
        </fieldset>)}
        <button disabled={fields.length >= 128} onClick={() => edit(() => setFields(previous => [...previous, newField()]))}>{text.add}</button>
      </fieldset>}
    </div>
    <footer className="modal-footer">
      {busy && <Spinner text={text.wait}/>}
      <button disabled={busy} onClick={close}>{text.close}</button><span className="grow"/>
      {preview ? <>
        <button disabled={busy} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || version !== preview.version} onClick={() => void apply()}>{text.apply}</button>
      </> : <button className="primary" disabled={loading || busy || unknown || !schema} onClick={() => void prepare()}>{text.preview}</button>}
    </footer>
  </Modal>;
}
