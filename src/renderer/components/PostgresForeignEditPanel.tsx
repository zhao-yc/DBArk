import { useMemo, useRef, useState } from 'react';
import {
  postgresForeignActions, postgresForeignPlan, type PostgresForeignChange, type PostgresForeignCreation, type PostgresForeignTargets,
} from '../../shared/postgresForeignKeyEdit';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresForeignEditZh as text } from '../locales/postgresForeignEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 选择真实可引用关系与唯一键，然后按键序显式匹配本表列。 */
export function PostgresForeignEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [kind, setKind] = useState<PostgresForeignChange['kind']>('create');
  const [changes, setChanges] = useState<PostgresForeignChange[]>([]);
  const [name, setName] = useState(''), [from, setFrom] = useState('');
  const [search, setSearch] = useState(''), [targets, setTargets] = useState<PostgresForeignTargets>();
  const [finding, setFinding] = useState(false);
  const [tableChoice, setTableChoice] = useState(''), [keyChoice, setKeyChoice] = useState('');
  const [locals, setLocals] = useState<string[]>([]);
  const [match, setMatch] = useState<PostgresForeignCreation['match']>('s');
  const [onUpdate, setOnUpdate] = useState<PostgresForeignCreation['onUpdate']>('a');
  const [onDelete, setOnDelete] = useState<PostgresForeignCreation['onDelete']>('a');
  const [timing, setTiming] = useState<PostgresForeignCreation['timing']>('immediate');
  const [notValid, setNotValid] = useState(false);
  const findingRef = useRef(false);

  const current = useMemo(() => changes.length
    ? [...postgresForeignPlan(original, { ...target, editStamp: original.editStamp!, changes }).keys]
      .map(([name, fk]) => ({ name, validated: fk.validated, enforced: fk.original?.foreign?.enforced !== false }))
    : original.constraints.filter(fk => fk.kind === 'f' && !fk.inherited)
      .map(fk => ({ name: fk.name, validated: fk.validated, enforced: fk.foreign?.enforced !== false })),
  [original, target, changes]);
  const choices = kind === 'validate' ? current.filter(fk => !fk.validated && fk.enforced) : current;
  const selected = choices.some(choice => choice.name === from) ? from : choices[0]?.name ?? '';
  const ref = tableChoice === '' ? undefined : targets?.targets[Number(tableChoice)];
  const key = keyChoice === '' ? undefined : ref?.keys[Number(keyChoice)];
  const dropping = changes.some(change => change.kind === 'drop');
  const canStage = kind === 'create' ? !!name && !!key && locals.length === key.length && locals.every(Boolean)
    : !!selected && (kind !== 'rename' || !!name);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name, dropping,
      () => invoke('postgres.foreignEdit.preview', { ...target, editStamp: original.editStamp!, changes }),
      token => invoke('postgres.foreignEdit.apply', { ...target, token }));

  /** 显式查询本库可引用目录，旧选择在新查询开始时失效。 */
  async function findTargets() {
    if (findingRef.current || operation.current || unknown) return;
    findingRef.current = true;
    setFinding(true);
    setError('');
    setTargets(undefined);
    setTableChoice('');
    setKeyChoice('');
    setLocals([]);
    try {
      setTargets(await invoke('postgres.foreignEdit.targets', { connectionId: target.connectionId, database: target.database, search }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { findingRef.current = false; setFinding(false); }
  }

  /** 将映射与引用身份一并暂存，允许在同一批中继续改名或验证。 */
  function stage() {
    if (operation.current || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const change: PostgresForeignChange = kind === 'create' ? { kind, name, match, timing, onUpdate, onDelete, notValid,
        reference: { schema: ref!.schema, name: ref!.name, stamp: ref!.stamp },
        pairs: key!.map((remote, i) => ({ local: locals[i], remote })),
      } : kind === 'rename' ? { kind, from: selected, name } : { kind, from: selected };
      const next = [...changes, change];
      postgresForeignPlan(original, { ...target, editStamp: original.editStamp!, changes: next });
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
          setKind(event.target.value as PostgresForeignChange['kind']);
          setName('');
        }}>
          <option value="create">{text.actions.create}</option>
          <option value="rename" disabled={!current.length}>{text.actions.rename}</option>
          <option value="validate" disabled={!current.some(fk => !fk.validated && fk.enforced)}>{text.actions.validate}</option>
          <option value="drop" disabled={!current.length}>{text.actions.drop}</option>
        </select></label>
        {kind !== 'create' && <label>{text.from}<select aria-label={text.from} value={selected} onChange={event => setFrom(event.target.value)}>
          {choices.map(choice => <option key={choice.name} value={choice.name}>{choice.name}</option>)}
        </select></label>}
        {(kind === 'create' || kind === 'rename') && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
      </div>
      {kind === 'create' && <>
        <div className="pg-column-edit-fields">
          <label>{text.search}<input value={search} onChange={event => setSearch(event.target.value)} maxLength={1025}/></label>
          <button disabled={finding} onClick={() => void findTargets()}>{text.find}</button>
          <label>{text.table}<select aria-label={text.table} value={tableChoice} onChange={event => {
            setTableChoice(event.target.value);
            setKeyChoice('');
            setLocals([]);
          }}>
            <option value="" disabled>{text.chooseTable}</option>
            {targets?.targets.map((target, i) => <option key={target.stamp} value={i}>
              {postgresIdentifier(target.schema) + '.' + postgresIdentifier(target.name)}
            </option>)}
          </select></label>
          <label>{text.key}<select aria-label={text.key} value={keyChoice} onChange={event => {
            setKeyChoice(event.target.value);
            setLocals(ref!.keys[Number(event.target.value)].map(() => ''));
          }}>
            <option value="" disabled>{text.chooseKey}</option>
            {ref?.keys.map((key, i) => <option key={i} value={i}>{key.map(postgresIdentifier).join(', ')}</option>)}
          </select></label>
        </div>
        {finding && <p role="status">{text.searching}</p>}
        {targets?.truncated && <p>{text.truncated}</p>}
        {targets && !targets.targets.length && <p>{text.empty}</p>}
        {key?.map((remote, i) => <div key={remote} className="pg-column-edit-fields">
          <label>{text.local(i + 1)}<select aria-label={text.local(i + 1)} value={locals[i]} onChange={event =>
            setLocals(locals.map((name, index) => index === i ? event.target.value : name))}>
            <option value="" disabled>{text.chooseLocal}</option>
            {original.columns.filter(column => column.name === locals[i] || !locals.includes(column.name))
              .map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
          </select></label>
          <p>{text.remote} <code>{postgresIdentifier(remote)}</code></p>
        </div>)}
        <div className="pg-column-edit-fields">
          <label>{text.match}<select aria-label={text.match} value={match} onChange={event => setMatch(event.target.value as typeof match)}>
            {Object.entries(text.matchValues).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>{text.onUpdate}<select aria-label={text.onUpdate} value={onUpdate} onChange={event => setOnUpdate(event.target.value as typeof onUpdate)}>
            {postgresForeignActions.map(value => <option key={value} value={value}>{text.referenceActions[value]}</option>)}
          </select></label>
          <label>{text.onDelete}<select aria-label={text.onDelete} value={onDelete} onChange={event => setOnDelete(event.target.value as typeof onDelete)}>
            {postgresForeignActions.map(value => <option key={value} value={value}>{text.referenceActions[value]}</option>)}
          </select></label>
          <label>{text.timing}<select aria-label={text.timing} value={timing} onChange={event => setTiming(event.target.value as typeof timing)}>
            {Object.entries(text.timingValues).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <label className="pg-column-edit-drop">
          <input type="checkbox" checked={notValid} onChange={event => setNotValid(event.target.checked)}/> {text.notValid}
        </label>
        {notValid && <p>{text.notValidHint}</p>}
      </>}
      <button disabled={!canStage || finding || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, i) => <li key={i}>{text.actions[change.kind]}{' '}
      {change.kind === 'create' ? change.name + ' → ' + postgresIdentifier(change.reference.schema) + '.' + postgresIdentifier(change.reference.name) :
        change.kind === 'rename' ? text.rename(change.from, change.name) : change.from}
    </li>)}</ol>}
    {preview && <>
      <p>{text.lockNote}</p><pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/> {text.confirmDrop}
      </label>}
    </>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || finding || !changes.length || !!name || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview || dropping && !acceptDrop} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
