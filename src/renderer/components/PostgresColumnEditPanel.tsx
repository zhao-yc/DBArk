import { useMemo, useState } from 'react';
import { postgresColumnPlan, type PostgresColumnChange } from '../../shared/postgresColumnEdit';
import { postgresCreateTypes, type PostgresColumnType, type PostgresCreateColumn } from '../../shared/postgresCreateTable';
import { postgresColumnEditZh as text } from '../locales/postgresColumnEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';
import { ErrorBox } from './ui';

/** 在原结构视图中编辑结构化草稿，输入、预览和实际提交分别锁定。 */
export function PostgresColumnEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [kind, setKind] = useState<PostgresColumnChange['kind']>('add');
  const [changes, setChanges] = useState<PostgresColumnChange[]>([]);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [type, setType] = useState<PostgresColumnType['type'] | ''>('text');
  const [length, setLength] = useState(''), [precision, setPrecision] = useState(''), [scale, setScale] = useState('');
  const [nullable, setNullable] = useState(true), [hasDefault, setHasDefault] = useState(false);
  const [defaultValue, setDefaultValue] = useState(''), [comment, setComment] = useState('');
  const names = useMemo(() => changes.length
    ? postgresColumnPlan(original, { ...target, editStamp: original.editStamp!, changes }).columns.map(column => column.name)
    : original.columns.map(column => column.name), [original, target, changes]);
  const old = names.includes(from) ? from : names[0] ?? '';
  const needsName = kind === 'add' || kind === 'rename';
  const needsType = kind === 'add' || kind === 'type';
  const dropping = changes.some(change => change.kind === 'drop');
  const canStage = (!needsName || !!name) && (!needsType || !!type) && (kind === 'add' || !!old);

  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name, dropping,
      () => invoke('postgres.columnEdit.preview', { ...target, editStamp: original.editStamp!, changes }),
      token => invoke('postgres.columnEdit.apply', { ...target, token }));

  /** 将当前表单编译成一项受限改动，及早发现批次中的名称冲突。 */
  function stage() {
    if (operation.current || unknown || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const dataType: PostgresColumnType = { type: type || 'text',
        ...(type === 'varchar' && length ? { length: Number(length) } : {}),
        ...(type === 'numeric' && precision ? { precision: Number(precision) } : {}),
        ...(type === 'numeric' && scale ? { scale: Number(scale) } : {}) };
      const field: PostgresCreateColumn = { ...dataType, name, nullable, primary: false, unique: false, identity: 'none',
        default: hasDefault ? { mode: 'literal', value: defaultValue } : { mode: 'none' }, comment };
      let change: PostgresColumnChange;
      switch (kind) {
        case 'add': change = { kind, field }; break;
        case 'rename': change = { kind, from: old, name }; break;
        case 'type': change = { kind, from: old, dataType }; break;
        case 'nullable': change = { kind, from: old, nullable }; break;
        case 'default': change = { kind, from: old, value: hasDefault ? defaultValue : null }; break;
        case 'comment': change = { kind, from: old, value: comment || null }; break;
        case 'drop': change = { kind, from: old }; break;
      }
      const next = [...changes, change];
      postgresColumnPlan(original, { ...target, editStamp: original.editStamp!, changes: next });
      setChanges(next);
      setPreview(undefined);
      setName('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{text.actions[kind]}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => {
          const action = event.target.value as PostgresColumnChange['kind'];
          setKind(action);
          setName('');
          setType(action === 'add' ? 'text' : '');
          setLength('');
          setPrecision('');
          setScale('');
          setNullable(true);
          setHasDefault(false);
          setDefaultValue('');
          setComment('');
        }}>
          {Object.entries(text.actions).map(([action, label]) =>
            <option key={action} value={action} disabled={action !== 'add' && !names.length}>{label}</option>)}
        </select></label>
        {kind !== 'add' && <label>{text.from}<select aria-label={text.from} value={old} onChange={event => setFrom(event.target.value)}>
          {names.map(value => <option key={value}>{value}</option>)}
        </select></label>}
        {needsName && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
        {needsType && <>
          <label>{text.type}<select aria-label={text.type} value={type} onChange={event => setType(event.target.value as PostgresColumnType['type'] | '')}>
            {kind === 'type' && <option value="" disabled>{text.chooseType}</option>}
            {postgresCreateTypes.map(value => <option key={value}>{value}</option>)}
          </select></label>
          {type === 'varchar' && <label>{text.length}<input type="number" min={1} value={length} onChange={event => setLength(event.target.value)}/></label>}
          {type === 'numeric' && <>
            <label>{text.precision}<input type="number" min={1} value={precision} onChange={event => setPrecision(event.target.value)}/></label>
            <label>{text.scale}<input type="number" min={0} value={scale} onChange={event => setScale(event.target.value)}/></label>
          </>}
        </>}
        {(kind === 'add' || kind === 'comment') &&
          <label>{text.comment}<input value={comment} onChange={event => setComment(event.target.value)}/></label>}
        {(kind === 'add' || kind === 'nullable') &&
          <label><input type="checkbox" checked={nullable} onChange={event => setNullable(event.target.checked)}/> {text.nullable}</label>}
        {(kind === 'add' || kind === 'default') && <>
          <label><input type="checkbox" checked={hasDefault} onChange={event => setHasDefault(event.target.checked)}/> {text.useDefault}</label>
          {hasDefault && <label>{text.defaultValue}<input value={defaultValue} onChange={event => setDefaultValue(event.target.value)}/></label>}
        </>}
      </div>
      {kind === 'type' && <p>{text.typeNote}</p>}
      {kind === 'default' && !hasDefault && <p>{text.clearDefault}</p>}
      {kind === 'comment' && !comment && <p>{text.clearComment}</p>}
      <button disabled={!canStage || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, index) =>
      <li key={index}>{change.kind === 'add' ? text.adding(change.field.name) : change.kind === 'rename'
        ? text.renaming(change.from, change.name) : text.modifying(change)}</li>)}</ol>}
    {preview && <pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>}
    {preview && dropping && <label className="pg-column-edit-drop">
      <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/> {text.confirmDrop}
    </label>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || !changes.length || needsName && !!name || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview || dropping && !acceptDrop} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
