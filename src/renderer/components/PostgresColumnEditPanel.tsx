import { useEffect, useRef, useState } from 'react';
import { postgresColumnPreviewSchema, type PostgresColumnChange } from '../../shared/postgresColumnEdit';
import { postgresCreateTypes, type PostgresCreateColumn, type PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import type { PostgresStructureInput, PostgresStructureResult } from '../../shared/postgresStructure';
import { postgresRelationName } from '../../shared/postgresSql';
import { postgresColumnEditZh as text } from '../locales/postgresColumnEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { ErrorBox } from './ui';

interface Props {
  target: PostgresStructureInput;
  original: PostgresStructureResult;
  version: number;
  onClose(): void;
  onResult(message: string, unknown: boolean): void;
  onDirtyChange(value: boolean): void;
}

/** 在原结构视图中编辑结构化草稿，输入、预览和实际提交分别锁定。 */
export function PostgresColumnEditPanel({ target, original, version, onClose, onResult, onDirtyChange }: Props) {
  const [kind, setKind] = useState<PostgresColumnChange['kind']>('add');
  const [changes, setChanges] = useState<PostgresColumnChange[]>([]);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [type, setType] = useState<PostgresCreateColumn['type']>('text');
  const [length, setLength] = useState(''), [precision, setPrecision] = useState(''), [scale, setScale] = useState('');
  const [nullable, setNullable] = useState(true), [hasDefault, setHasDefault] = useState(false);
  const [defaultValue, setDefaultValue] = useState(''), [comment, setComment] = useState('');
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const operation = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(busy || !!changes.length || !!name); }, [busy, changes.length, name, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const names = original.columns.map(column => column.name);
  for (const change of changes) {
    if (change.kind === 'add') names.push(change.field.name);
    else names[names.indexOf(change.from)] = change.name;
  }
  const old = names.includes(from) ? from : names[0] ?? '';

  /** 只允许已读连接修订及无表页草稿的目标进入修改流程。 */
  function assertCurrent() {
    const workspace = useWorkspace.getState();
    if (!alive.current || (workspace.connectionVersions[target.connectionId] ?? 0) !== version) throw Error(text.changed);
    if (workspace.settings.tabs.some(tab => {
      if (tab.kind !== 'table' || tab.connectionId !== target.connectionId || (tab.database || 'postgres') !== target.database ||
          !tab.table || !(workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id])) return false;
      const relation = postgresRelationName(tab.table);
      return relation.schema === original.schema && relation.name === original.name;
    })) throw Error(text.dirty);
  }

  /** 把表单转换为受限字段数据，同时废弃旧预览。 */
  function stage() {
    if (operation.current || unknown || changes.length >= 16) return;
    setError('');
    try {
      if (names.includes(name)) throw Error('字段名称已存在');
      const field: PostgresCreateColumn = { name, type, nullable, primary: false, unique: false, identity: 'none',
        default: hasDefault ? { mode: 'literal', value: defaultValue } : { mode: 'none' }, comment,
        ...(type === 'varchar' && length ? { length: Number(length) } : {}),
        ...(type === 'numeric' && precision ? { precision: Number(precision) } : {}),
        ...(type === 'numeric' && scale ? { scale: Number(scale) } : {}) };
      const change: PostgresColumnChange = kind === 'add' ? { kind, field } : { kind, from: old, name };
      const validated = postgresColumnPreviewSchema.parse({ ...target, editStamp: original.editStamp, changes: [...changes, change] });
      setChanges(validated.changes);
      setPreview(undefined);
      setName('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 同步占有预览或提交按钮，实际回执不依赖窗口渲染时序。 */
  async function submit(apply: boolean) {
    if (operation.current || unknown || apply && !preview) return;
    operation.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      assertCurrent();
      if (!apply) {
        setPreview(undefined);
        const result = await invoke('postgres.columnEdit.preview', { ...target, editStamp: original.editStamp!, changes });
        assertCurrent();
        setPreview(result);
        return;
      }
      setPreview(undefined);
      sent = true;
      const result = await invoke('postgres.columnEdit.apply', { ...target, token: preview!.token });
      if (result.outcome === 'committed') onResult(result.message, false);
      else if (result.outcome === 'unknown') {
        setUnknown(true);
        onResult(result.message, true);
      } else setError(result.message);
    } catch (reason) {
      if (alive.current) {
        const message = errorMessage(reason);
        setError(message);
        if (sent) {
          setUnknown(true);
          onResult(message, true);
        }
      }
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{kind === 'add' ? text.add : text.rename}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => setKind(event.target.value as PostgresColumnChange['kind'])}>
          <option value="add">{text.add}</option><option value="rename" disabled={!names.length}>{text.rename}</option>
        </select></label>
        {kind === 'rename' && <label>{text.from}<select aria-label={text.from} value={old} onChange={event => setFrom(event.target.value)}>
          {names.map(value => <option key={value}>{value}</option>)}
        </select></label>}
        <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>
        {kind === 'add' && <>
          <label>{text.type}<select aria-label={text.type} value={type} onChange={event => setType(event.target.value as PostgresCreateColumn['type'])}>
            {postgresCreateTypes.map(value => <option key={value}>{value}</option>)}
          </select></label>
          {type === 'varchar' && <label>{text.length}<input type="number" min={1} value={length} onChange={event => setLength(event.target.value)}/></label>}
          {type === 'numeric' && <>
            <label>{text.precision}<input type="number" min={1} value={precision} onChange={event => setPrecision(event.target.value)}/></label>
            <label>{text.scale}<input type="number" min={0} value={scale} onChange={event => setScale(event.target.value)}/></label>
          </>}
          <label>{text.comment}<input value={comment} onChange={event => setComment(event.target.value)}/></label>
          <label><input type="checkbox" checked={nullable} onChange={event => setNullable(event.target.checked)}/> {text.nullable}</label>
          <label><input type="checkbox" checked={hasDefault} onChange={event => setHasDefault(event.target.checked)}/> {text.useDefault}</label>
          {hasDefault && <label>{text.defaultValue}<input value={defaultValue} onChange={event => setDefaultValue(event.target.value)}/></label>}
        </>}
      </div>
      <button disabled={!name || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, index) =>
      <li key={index}>{change.kind === 'add' ? text.adding(change.field.name) : text.renaming(change.from, change.name)}</li>)}</ol>}
    {preview && <pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || !changes.length || !!name || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
