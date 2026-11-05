import { useMemo, useState } from 'react';
import { postgresCheckPlan, supportsPostgresCheckNotEnforced, type PostgresCheckChange } from '../../shared/postgresCheckEdit';
import { postgresCheckEditZh as text } from '../locales/postgresCheckEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

/** 用原目录表达式和状态构建草稿，预览前可继续累加同批改动。 */
export function PostgresCheckEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const [kind, setKind] = useState<PostgresCheckChange['kind']>('create');
  const [changes, setChanges] = useState<PostgresCheckChange[]>([]);
  const [name, setName] = useState(''), [from, setFrom] = useState('');
  const [expression, setExpression] = useState<string>(), [noInherit, setNoInherit] = useState<boolean>(), [notValid, setNotValid] = useState<boolean>();
  const [notEnforced, setNotEnforced] = useState<boolean>();
  const current = useMemo(() => changes.length
    ? [...postgresCheckPlan(original, { ...target, editStamp: original.editStamp!, changes }).checks]
      .map(([name, value]) => ({ name, validated: value.validated, definition: value.created ?? value.original?.check,
        enforced: !value.created?.notEnforced && value.original?.check?.enforced !== false }))
    : original.constraints.filter(constraint => constraint.kind === 'c' && !constraint.inherited)
      .map(constraint => ({ name: constraint.name, validated: constraint.validated, definition: constraint.check,
        enforced: constraint.check?.enforced !== false })), [original, target, changes]);
  const choices = kind === 'validate' ? current.filter(check => !check.validated && check.enforced) : current;
  const selected = choices.find(choice => choice.name === from) ?? choices[0];
  const replacement = kind === 'replace' ? selected : undefined;
  const input = expression ?? replacement?.definition?.expression ?? '';
  const chosenNoInherit = noInherit ?? replacement?.definition?.noInherit ?? false;
  const chosenNotEnforced = notEnforced ?? (replacement?.enforced === false);
  const chosenNotValid = !chosenNotEnforced && (notValid ?? (replacement ? !replacement.validated : false));
  const needsExpression = kind === 'create' || kind === 'replace';
  const needsName = kind === 'create' || kind === 'rename';
  const canStage = (!needsName || !!name) && (!needsExpression || !!input.trim()) && (kind === 'create' || !!selected);
  const dropping = changes.some(change => change.kind === 'drop' || change.kind === 'replace');
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name || expression !== undefined, dropping,
      () => invoke('postgres.checkEdit.preview', { ...target, editStamp: original.editStamp!, changes }),
      token => invoke('postgres.checkEdit.apply', { ...target, token }));

  /** 清除当前表单的临时覆盖，替换时重新采用所选约束的定义。 */
  function resetExpression() {
    setExpression(undefined);
    setNoInherit(undefined);
    setNotValid(undefined);
    setNotEnforced(undefined);
  }

  /** 暂存原文和选项，保持词法及批次校验与引擎一致。 */
  function stage() {
    if (operation.current || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const options = { expression: input, noInherit: chosenNoInherit, notValid: chosenNotValid, notEnforced: chosenNotEnforced };
      const change: PostgresCheckChange = kind === 'create' ? { kind, name, ...options }
        : kind === 'replace' ? { kind, from: selected!.name, ...options }
        : kind === 'rename' ? { kind, from: selected!.name, name } : { kind, from: selected!.name };
      const next = [...changes, change];
      postgresCheckPlan(original, { ...target, editStamp: original.editStamp!, changes: next });
      setChanges(next);
      setPreview(undefined);
      setName('');
      resetExpression();
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{text.actions[kind]}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => {
          setKind(event.target.value as PostgresCheckChange['kind']);
          setName('');
          resetExpression();
        }}>
          {Object.entries(text.actions).map(([value, label]) => <option key={value} value={value}
            disabled={value === 'validate' ? !current.some(check => !check.validated && check.enforced) : value !== 'create' && !current.length}>
            {label}
          </option>)}
        </select></label>
        {kind !== 'create' && <label>{text.from}<select aria-label={text.from} value={selected?.name ?? ''} onChange={event => {
          setFrom(event.target.value);
          resetExpression();
        }}>
          {choices.map(choice => <option key={choice.name} value={choice.name}>{choice.name}</option>)}
        </select></label>}
        {needsName && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
      </div>
      {needsExpression && <>
        <label>{text.expression}<textarea value={input} maxLength={16384} rows={4}
          onChange={event => setExpression(event.target.value)}/></label>
        <p>{text.expressionHint}</p>
        <label><input type="checkbox" checked={chosenNoInherit} onChange={event => setNoInherit(event.target.checked)}/> {text.noInherit}</label>
        {supportsPostgresCheckNotEnforced(original) && <label><input type="checkbox" checked={chosenNotEnforced}
          onChange={event => setNotEnforced(event.target.checked)}/> {text.notEnforced}</label>}
        <label><input type="checkbox" disabled={chosenNotEnforced} checked={chosenNotValid}
          onChange={event => setNotValid(event.target.checked)}/> {text.notValid}</label>
        {chosenNotValid && <p>{text.notValidHint}</p>}
      </>}
      <button disabled={!canStage || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, i) => <li key={i}>{text.actions[change.kind]}{' '}
      {change.kind === 'create' ? change.name : change.kind === 'rename' ? text.rename(change.from, change.name) : change.from}
    </li>)}</ol>}
    {preview && <>
      <p>{text.lockNote}</p><pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
      {dropping && <label className="pg-column-edit-drop">
        <input type="checkbox" checked={acceptDrop} onChange={event => setAcceptDrop(event.target.checked)}/> {text.confirmDrop}
      </label>}
    </>}
    <div className="pg-column-edit-actions">
      <button disabled={busy || unknown || !changes.length} onClick={() => { setPreview(undefined); setChanges(changes.slice(0, -1)); }}>{text.undo}</button>
      <button disabled={busy || unknown || !changes.length || !!name || expression !== undefined || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button disabled={busy || unknown || !preview || dropping && !acceptDrop} onClick={() => void submit(true)}>{text.apply}</button>
      <button disabled={busy} onClick={onClose}>{text.close}</button>
    </div>
  </section>;
}
