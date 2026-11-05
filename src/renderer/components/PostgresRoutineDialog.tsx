import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import { postgresRoutineManageSchema, type PostgresRoutineInfo, type PostgresRoutineManageInput, type PostgresRoutineProperties,
  type PostgresRoutineReadInput } from '../../shared/postgresRoutine';
import { errorMessage, invoke } from '../lib';
import { postgresRoutineZh as text } from '../locales/postgresRoutine.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';
import './PostgresStructureDialog.css';

type RoutineAction = PostgresRoutineManageInput['action'];
type RoutineManage = { action: RoutineAction; stamp: string; version: number; originalBody?: string; originalProperties?: PostgresRoutineProperties };

/** 定义读取和草稿绑定原连接及完整签名，加载或打开时只读取文本。 */
export function PostgresRoutineDialog({ target, readOnly, onClose, onDirtyChange, onManaged }: {
  target: PostgresRoutineReadInput; readOnly?: boolean; onClose(): void; onDirtyChange(value: boolean): void;
  onManaged(action: RoutineAction, name: string, version: number, message: string): void;
}) {
  const { connectionId, database, kind, name } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connectionId, database, kind, name, version, attempt]);
  const [result, setResult] = useState<{ key: string; info?: PostgresRoutineInfo; error?: string }>();
  const [manage, setManage] = useState<RoutineManage>();
  const current = result?.key === key ? result : undefined;
  const info = current?.info;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void invoke('postgres.routine.read', { connectionId, database, kind, name }).then(info => {
        if (active) setResult({ key, info });
      }, reason => { if (active) setResult({ key, error: errorMessage(reason) }); });
    });
    return () => { active = false; };
  }, [connectionId, database, kind, name, key]);

  function openDraft() {
    const workspace = useWorkspace.getState();
    if (!info || (workspace.connectionVersions[connectionId] ?? 0) !== version ||
        workspace.connections.find(profile => profile.id === connectionId)?.dialect !== 'postgresql') return;
    workspace.openTab({ kind: 'query', title: name, connectionId, database, sql: info.definition });
    onClose();
  }

  const fields = info && [[text.kind, text.categories[info.category]], [text.owner, info.owner], [text.language, info.language],
    [text.arguments, info.arguments || '—'], ...(info.category === 'p' ? [] : [
      [text.returns, info.returns ?? '—'], [text.volatility, text.volatilityValues[info.volatility]],
      [text.nullInput, info.strict ? text.strict : text.calledOnNull], [text.parallel, text.parallelValues[info.parallel]],
      [text.cost, info.cost], ...(info.rows === null ? [] : [[text.rows, info.rows]]),
    ]), [text.security, info.securityDefiner ? text.definer : text.invoker], [text.comment, info.comment ?? '—']];

  if (manage) return <PostgresManageRoutineDialog target={target} {...manage} onDirtyChange={onDirtyChange}
    onClose={unknown => {
      if (unknown) onClose();
      else {
        setManage(undefined);
        setAttempt(value => value + 1);
      }
    }}
    onManaged={(name, message) => {
      setManage(undefined);
      setAttempt(value => value + 1);
      onManaged(manage.action, name, manage.version, message);
    }}/>;

  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content pg-structure-content">
      <div className="pg-structure-caption"><strong>{name}</strong><span>{database}</span></div>
      {!current && <Spinner text={text.loading}/>}
      <ErrorBox message={current?.error ?? ''}/>
      {info && fields && <><table className="pg-structure-table"><tbody>{fields.map(([label, value]) =>
        <tr key={label}><th scope="row">{label}</th><td><code>{value}</code></td></tr>)}</tbody></table>
        <SqlEditor value={info.definition} dialect="postgresql" readOnly height={300}/></>}
    </div>
    <footer className="modal-footer"><button disabled={!current} onClick={() => setAttempt(value => value + 1)}>{zh.common.refresh}</button>
      <button disabled={!info} onClick={openDraft}>{text.draft}</button>
      {!readOnly && info?.canManage && <>
        <button disabled={info.editableBody === null} title={info.editableBody === null ? text.editUnavailable : undefined}
          onClick={() => setManage({ action: 'edit', stamp: info.stamp, version, originalBody: info.editableBody ?? undefined })}>{text.edit}</button>
        <button onClick={() => setManage({ action: 'properties', stamp: info.stamp, version, originalProperties: info })}>{text.properties}</button>
        <button onClick={() => setManage({ action: 'rename', stamp: info.stamp, version })}>{text.rename}</button>
        <button onClick={() => setManage({ action: 'drop', stamp: info.stamp, version })}>{text.drop}</button>
      </>}
      <span className="grow"/><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}

/** 预览与确认绑定原连接版本及输入签名。写入结果未知时需要重新打开核对。 */
function PostgresManageRoutineDialog({ target, action, stamp, version, originalBody, originalProperties,
  onClose, onManaged, onDirtyChange }: RoutineManage & {
  target: PostgresRoutineReadInput; onClose(unknown: boolean): void; onManaged(name: string, message: string): void;
  onDirtyChange(value: boolean): void;
}) {
  const stale = useWorkspace(state => (state.connectionVersions[target.connectionId] ?? 0) !== version);
  const [name, setName] = useState('');
  const [body, setBody] = useState(originalBody ?? '');
  const [changes, setChanges] = useState<Partial<PostgresRoutineProperties>>({});
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const dropping = action === 'drop';
  const editing = action === 'edit';
  const changed = originalProperties ? Object.keys(changes).length > 0 : editing ? body !== originalBody : !!name;
  const enablingDefiner = changes.securityDefiner === true;
  const requiresAcknowledgement = dropping || enablingDefiner;
  useEffect(() => { onDirtyChange(busy || !!preview || changed); }, [busy, preview, changed, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function back() {
    setPreview(undefined);
    setAcknowledged(false);
    setError('');
  }

  function close() {
    if (!locked.current && (!changed || stale || unknown || window.confirm(action === 'rename' ? text.discardManage : text.discard))) onClose(unknown);
  }

  /** 恢复原值时移除变更，保留未编辑的旧目录字段。 */
  function setProperty<K extends keyof PostgresRoutineProperties>(key: K, value: PostgresRoutineProperties[K]) {
    setChanges(previous => {
      const next = { ...previous };
      if (value === originalProperties?.[key]) delete next[key];
      else next[key] = value;
      return next;
    });
    setError('');
  }

  async function submit() {
    if (locked.current || unknown || (useWorkspace.getState().connectionVersions[target.connectionId] ?? 0) !== version ||
        (preview && requiresAcknowledgement && !acknowledged)) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if (!preview) {
        const base = { ...target, stamp };
        const input = postgresRoutineManageSchema.parse(action === 'drop' ? { ...base, action } :
          action === 'edit' ? { ...base, action, body } : action === 'properties' ? { ...base, action, changes } :
            { ...base, action, newName: name });
        const next = await invoke('postgres.routine.manage.preview', input);
        if ((useWorkspace.getState().connectionVersions[target.connectionId] ?? 0) === version) setPreview(next);
      } else {
        setPreview(undefined);
        setAcknowledged(false);
        const outcome = await invoke('postgres.routine.manage.apply', { connectionId: target.connectionId,
          database: target.database, token: preview.token });
        if (outcome.outcome === 'committed' && outcome.table) onManaged(outcome.table, outcome.message);
        else {
          setUnknown(outcome.outcome === 'unknown');
          setError(outcome.message);
        }
      }
    } catch (reason) {
      if (preview) setUnknown(true);
      setError(errorMessage(reason));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <Modal title={text[action]} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>{target.database} / {target.name}</strong>
      <p>{dropping ? text.dropHint : editing ? text.editHint : originalProperties ? text.propertiesHint : text.renameHint}</p>
      <ErrorBox message={[stale && text.stale, unknown && text.manageUnknown, error].filter(Boolean).join(' ')}/>
      {busy && <Spinner text={text.working}/>}
      {preview ? <>
        <pre className="pg-create-sql">{preview.statements.join(';\n') + ';'}</pre>
        {requiresAcknowledgement && <label><input type="checkbox" checked={acknowledged} disabled={busy || stale}
          onChange={event => setAcknowledged(event.target.checked)}/> {dropping ? text.acknowledgeDrop : text.acknowledgeDefiner}</label>}
      </> : originalProperties ? <fieldset disabled={busy || stale || unknown}>
        <RoutinePropertyFields kind={target.kind} values={{ ...originalProperties, ...changes }} onChange={setProperty}/>
        {enablingDefiner && <p>{text.definerHint}</p>}
      </fieldset> : editing ? <Field label={text.body}><textarea aria-label={text.body} className="pg-create-view-definition" value={body} rows={14} maxLength={128 * 1024}
        disabled={busy || stale || unknown} spellCheck={false} onChange={event => { setBody(event.target.value); setError(''); }}/></Field> :
        !dropping && <Field label={text.newName}><input value={name} maxLength={63} disabled={busy || stale || unknown}
          onChange={event => { setName(event.target.value); setError(''); }}/></Field>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={back}>{text.returnFromPreview}</button>}
      <span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className={preview && dropping ? 'danger' : 'primary'}
        disabled={busy || stale || unknown || (!!preview && requiresAcknowledgement && !acknowledged) ||
          (!dropping && (!changed || (!originalProperties && !(editing ? body : name).trim())))}
        onClick={() => void submit()}>{preview ? (dropping ? text.confirmDrop : editing ? text.confirmEdit :
          originalProperties ? text.confirmProperties : text.confirmRename) : text.preview}</button>
    </footer>
  </Modal>;
}

/** 过程与标量函数只显示服务器允许设置的字段。 */
function RoutinePropertyFields({ kind, values, onChange }: {
  kind: PostgresRoutineReadInput['kind']; values: PostgresRoutineProperties;
  onChange<K extends keyof PostgresRoutineProperties>(key: K, value: PostgresRoutineProperties[K]): void;
}) {
  return <div className="form-grid">
    {kind === 'function' && <>
      <Field label={text.volatility}><select aria-label={text.volatility} value={values.volatility}
        onChange={event => onChange('volatility', event.target.value as PostgresRoutineProperties['volatility'])}>
        {Object.entries(text.volatilityValues).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label={text.parallel}><select aria-label={text.parallel} value={values.parallel}
        onChange={event => onChange('parallel', event.target.value as PostgresRoutineProperties['parallel'])}>
        {Object.entries(text.parallelValues).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label={text.nullInput}><select aria-label={text.nullInput} value={String(values.strict)}
        onChange={event => onChange('strict', event.target.value === 'true')}>
        <option value="false">{text.calledOnNull}</option><option value="true">{text.strict}</option>
      </select></Field>
      <Field label={text.cost}><input value={values.cost} maxLength={32}
        onChange={event => onChange('cost', event.target.value)}/></Field>
      {values.rows !== null && <Field label={text.rows}><input value={values.rows} maxLength={32}
        onChange={event => onChange('rows', event.target.value)}/></Field>}
    </>}
    <Field label={text.security}><select aria-label={text.security} value={String(values.securityDefiner)}
      onChange={event => onChange('securityDefiner', event.target.value === 'true')}>
      <option value="false">{text.invoker}</option><option value="true">{text.definer}</option>
    </select></Field>
    <Field label={text.comment} full><textarea aria-label={text.comment} value={values.comment ?? ''} rows={3}
      maxLength={4096} onChange={event => onChange('comment', event.target.value || null)}/></Field>
  </div>;
}
