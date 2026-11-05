import { useMemo, useState } from 'react';
import { postgresKeyPlan, supportsPostgresNullsNotDistinct, type PostgresKeyChange } from '../../shared/postgresKeyEdit';
import { postgresKeyEditZh as text } from '../locales/postgresKeyEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

type Creation = Extract<PostgresKeyChange, { kind: 'create' }>;

/** 用服务器目录选择有序键列，支持在同一预览中移除并重建主键。 */
export function PostgresKeyEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [kind, setKind] = useState<PostgresKeyChange['kind']>('create');
  const [changes, setChanges] = useState<PostgresKeyChange[]>([]);
  const [name, setName] = useState(''), [from, setFrom] = useState('');
  const [key, setKey] = useState<Creation['key']>('p');
  const [timing, setTiming] = useState<Creation['timing']>('immediate');
  const [nullsNotDistinct, setNullsNotDistinct] = useState(false);
  const [columns, setColumns] = useState(['']);
  const available = original.columns.map(column => column.name);
  const current = useMemo(() => {
    const draft = changes.length ? changes : undefined;
    if (draft) return [...postgresKeyPlan(original, { ...target, editStamp: original.editStamp!, changes: draft }).keys]
      .filter(([, constraint]) => !constraint.original?.inherited)
      .map(([name, constraint]) => ({ name, key: constraint.key, replicaIdentity: constraint.replicaIdentity }));
    return original.constraints.filter(constraint => !constraint.inherited && (constraint.kind === 'p' || constraint.kind === 'u'))
      .map(constraint => ({ name: constraint.name, key: constraint.kind,
        replicaIdentity: original.indexes.some(index => index.constraint === constraint.name && index.replicaIdentity) }));
  }, [original, target, changes]);
  const choices = kind === 'drop' ? current.filter(constraint => !constraint.replicaIdentity) : current;
  const selected = choices.some(constraint => constraint.name === from) ? from : choices[0]?.name ?? '';
  const dropping = changes.some(change => change.kind === 'drop');
  const canStage = kind === 'create' ? !!name && columns.every(Boolean) : !!selected && (kind === 'drop' || !!name);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name, dropping,
      () => invoke('postgres.keyEdit.preview', { ...target, editStamp: original.editStamp!, changes }),
      token => invoke('postgres.keyEdit.apply', { ...target, token }));

  /** 用共享编译器校验名称、列与同批前序约束，废弃上一份预览。 */
  function stage() {
    if (operation.current || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const change: PostgresKeyChange = kind === 'create' ? { kind, name, key, columns, timing,
        nullsNotDistinct: key === 'u' && nullsNotDistinct } :
        kind === 'rename' ? { kind, from: selected, name } : { kind, from: selected };
      const next = [...changes, change];
      postgresKeyPlan(original, { ...target, editStamp: original.editStamp!, changes: next });
      setChanges(next);
      setName('');
      setPreview(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{text.actions[kind]}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => {
          setKind(event.target.value as PostgresKeyChange['kind']);
          setName('');
        }}>
          <option value="create">{text.actions.create}</option>
          <option value="rename" disabled={!current.length}>{text.actions.rename}</option>
          <option value="drop" disabled={!current.some(constraint => !constraint.replicaIdentity)}>{text.actions.drop}</option>
        </select></label>
        {kind !== 'create' && <label>{text.from}<select aria-label={text.from} value={selected} onChange={event => setFrom(event.target.value)}>
          {choices.map(constraint => <option key={constraint.name} value={constraint.name}>{constraint.name}</option>)}
        </select></label>}
        {kind !== 'drop' && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
        {kind === 'create' && <>
          <label>{text.keyType}<select aria-label={text.keyType} value={key} onChange={event => setKey(event.target.value as Creation['key'])}>
            <option value="p">{text.primary}</option><option value="u">{text.unique}</option>
          </select></label>
          <label>{text.timing}<select aria-label={text.timing} value={timing} onChange={event => setTiming(event.target.value as Creation['timing'])}>
            {Object.entries(text.timingValues).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {key === 'u' && supportsPostgresNullsNotDistinct(original) && <label>
            <input type="checkbox" checked={nullsNotDistinct} onChange={event => setNullsNotDistinct(event.target.checked)}/> {text.nullsNotDistinct}
          </label>}
        </>}
      </div>
      {kind === 'create' && <>
        {columns.map((name, i) => <div className="pg-column-edit-fields" key={i}>
          <label>{text.key(i + 1)}<select aria-label={text.key(i + 1)} value={name}
            onChange={event => setColumns(columns.map((value, index) => i === index ? event.target.value : value))}>
            <option value="" disabled>{text.choose}</option>
            {available.filter(column => column === name || !columns.includes(column))
              .map(column => <option key={column} value={column}>{column}</option>)}
          </select></label>
          {columns.length > 1 && <button onClick={() => setColumns(columns.filter((_, index) => i !== index))}>{text.removeColumn(i + 1)}</button>}
        </div>)}
        <button disabled={columns.length >= Math.min(32, available.length)} onClick={() => setColumns([...columns, ''])}>{text.addColumn}</button>
      </>}
      <button disabled={!canStage || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, i) => <li key={i}>{text.actions[change.kind]}{' '}
      {change.kind === 'create' ? (change.key === 'p' ? text.primary : text.unique) + ' ' + change.name + ' (' + change.columns.join(', ') + ')' :
        change.kind === 'drop' ? change.from : text.rename(change.from, change.name)}
    </li>)}</ol>}
    {preview && <>
      <p>{text.lockNote}</p><pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/> {text.confirmDrop}
      </label>}
    </>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || !changes.length || !!name || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview || dropping && !acceptDrop} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
