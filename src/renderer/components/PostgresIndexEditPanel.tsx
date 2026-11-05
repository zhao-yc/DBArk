import { useMemo, useState } from 'react';
import {
  canEditPostgresIndex, postgresIndexCapabilities, postgresIndexMethods, postgresIndexEditStamp, postgresIndexPlan,
  type PostgresIndexChange, type PostgresIndexMethod,
} from '../../shared/postgresIndexEdit';
import { postgresIndexEditZh as text } from '../locales/postgresIndexEdit.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox } from './ui';
import { usePostgresStructureEdit, type PostgresStructureEditProps } from './usePostgresStructureEdit';

type Key = Extract<PostgresIndexChange, { kind: 'create' }>['keys'][number];
const emptyKey: Key = { column: '', direction: 'asc', nulls: 'default' };

/** 在索引目录中编辑有序键列，草稿仅使用真实列名和内置索引方法。 */
export function PostgresIndexEditPanel(props: PostgresStructureEditProps) {
  const { target, original, onClose } = props;
  const editStamp = postgresIndexEditStamp(original)!;
  const [kind, setKind] = useState<PostgresIndexChange['kind']>('create');
  const [changes, setChanges] = useState<PostgresIndexChange[]>([]);
  const [name, setName] = useState(''), [from, setFrom] = useState('');
  const [method, setMethod] = useState<PostgresIndexMethod>('btree'), [unique, setUnique] = useState(false);
  const [keys, setKeys] = useState<Key[]>([emptyKey]), [included, setIncluded] = useState<string[]>([]);
  const editableNames = useMemo(() => changes.length
    ? [...postgresIndexPlan(original, { ...target, editStamp, changes }).indexes]
      .filter(([, index]) => !index.original || canEditPostgresIndex(index.original)).map(([name]) => name)
    : original.indexes.filter(canEditPostgresIndex).map(index => index.name), [target, original, editStamp, changes]);
  const existing = editableNames.includes(from) ? from : editableNames[0] ?? '';
  const columns = original.columns.map(column => column.name);
  const selected = [...keys.map(key => key.column), ...included];
  const capability = postgresIndexCapabilities(method);
  const full = selected.length >= Math.min(columns.length, 32);
  const dropping = changes.some(change => change.kind === 'drop');
  const canStage = kind === 'create' ? !!name && selected.every(Boolean) : !!existing && (kind === 'drop' || !!name);
  const { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit } =
    usePostgresStructureEdit(props, !!changes.length || !!name, dropping,
      () => invoke('postgres.indexEdit.preview', { ...target, editStamp, changes }),
      token => invoke('postgres.indexEdit.apply', { ...target, token }));

  /** 方法切换时清理不支持的选项，已暂存的独立草稿保持原值。 */
  function changeMethod(value: PostgresIndexMethod) {
    setMethod(value);
    const next = postgresIndexCapabilities(value);
    if (!next.include) setIncluded([]);
    if (!next.ordering) setUnique(false);
    setKeys((next.multi ? keys : keys.slice(0, 1)).map(key => next.ordering ? key : { ...emptyKey, column: key.column }));
  }

  /** 在加入之前校验所有前序改动及本项，预览令牌随草稿失效。 */
  function stage() {
    if (operation.current || !canStage || changes.length >= 16) return;
    setError('');
    try {
      const change: PostgresIndexChange = kind === 'create' ? { kind, name, method, unique, keys, include: included }
        : kind === 'rename' ? { kind, name, from: existing } : { kind, from: existing };
      const next = [...changes, change];
      postgresIndexPlan(original, { ...target, editStamp, changes: next });
      setChanges(next);
      setName('');
      setPreview(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 每个下拉框仅显示本行及尚未被其它键或包含列使用的列。 */
  function columnOptions(current: string) {
    return <><option value="" disabled>{text.choose}</option>
      {columns.filter(column => column === current || !selected.includes(column))
        .map(column => <option key={column} value={column}>{column}</option>)}</>;
  }

  /** 保留数组顺序，对单个键列应用选项。 */
  function updateKey(index: number, patch: Partial<Key>) {
    setKeys(keys.map((key, i) => i === index ? { ...key, ...patch } : key));
  }

  return <section aria-label={text.title} className="pg-column-edit">
    <h3>{text.title}</h3>
    <ErrorBox message={error || (unknown ? text.unknown : '')}/>
    <fieldset disabled={busy || unknown || !!preview}>
      <legend>{text.actions[kind]}</legend>
      <div className="pg-column-edit-fields">
        <label>{text.operation}<select aria-label={text.operation} value={kind} onChange={event => {
          setKind(event.target.value as PostgresIndexChange['kind']);
          setName('');
        }}>
          {Object.entries(text.actions).map(([value, label]) => <option key={value} value={value}
            disabled={value !== 'create' && !editableNames.length}>{label}</option>)}
        </select></label>
        {kind !== 'create' && <label>{text.from}<select aria-label={text.from} value={existing} onChange={event => setFrom(event.target.value)}>
          {editableNames.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
        {kind !== 'drop' && <label>{text.name}<input value={name} onChange={event => setName(event.target.value)}/></label>}
        {kind === 'create' && <>
          <label>{text.method}<select aria-label={text.method} value={method} onChange={event => changeMethod(event.target.value as PostgresIndexMethod)}>
            {postgresIndexMethods.map(value => <option key={value}>{value}</option>)}
          </select></label>
          {capability.ordering && <label><input type="checkbox" checked={unique} onChange={event => setUnique(event.target.checked)}/> {text.unique}</label>}
        </>}
      </div>
      {kind === 'create' && <>
        {keys.map((key, i) => <div className="pg-column-edit-fields" key={i}>
          <label>{text.key(i + 1)}<select aria-label={text.key(i + 1)} value={key.column}
            onChange={event => updateKey(i, { column: event.target.value })}>{columnOptions(key.column)}</select></label>
          {capability.ordering && <>
            <label>{text.order(i + 1)}<select aria-label={text.order(i + 1)} value={key.direction}
              onChange={event => updateKey(i, { direction: event.target.value as Key['direction'] })}>
              <option value="asc">{text.asc}</option><option value="desc">{text.desc}</option>
            </select></label>
            <label>{text.nulls(i + 1)}<select aria-label={text.nulls(i + 1)} value={key.nulls}
              onChange={event => updateKey(i, { nulls: event.target.value as Key['nulls'] })}>
              <option value="default">{text.defaultNulls}</option><option value="first">{text.first}</option><option value="last">{text.last}</option>
            </select></label>
          </>}
          {keys.length > 1 && <button onClick={() => setKeys(keys.filter((_, index) => index !== i))}>{text.removeKey(i + 1)}</button>}
        </div>)}
        {included.map((column, i) => <div className="pg-column-edit-fields" key={i}>
          <label>{text.include(i + 1)}<select aria-label={text.include(i + 1)} value={column}
            onChange={event => setIncluded(included.map((value, index) => index === i ? event.target.value : value))}>{columnOptions(column)}</select></label>
          <button onClick={() => setIncluded(included.filter((_, index) => index !== i))}>{text.removeInclude(i + 1)}</button>
        </div>)}
        <div className="pg-column-edit-actions">
          {capability.multi && <button disabled={full} onClick={() => setKeys([...keys, emptyKey])}>{text.addKey}</button>}
          {capability.include && <button disabled={full} onClick={() => setIncluded([...included, ''])}>{text.addInclude}</button>}
        </div>
      </>}
      <button disabled={!canStage || changes.length >= 16} onClick={stage}>{text.stage}</button>
    </fieldset>
    {!!changes.length && <ol aria-label={text.draft}>{changes.map((change, i) => <li key={i}>{text.actions[change.kind]}{' '}
      {change.kind === 'create' ? change.name : change.kind === 'drop' ? change.from : text.summaryRename(change.from, change.name)}
    </li>)}</ol>}
    {preview && <>
      <p>{original.kind === 'm' ? text.materializedLockNote : text.lockNote}</p><pre aria-label={text.previewTitle} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre>
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
