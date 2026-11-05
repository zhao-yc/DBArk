import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresSequenceCreateSchema, postgresSequenceManageSchema, postgresSequencePlan, type PostgresSequenceInfo,
  type PostgresSequenceManageInput, type PostgresSequenceReadInput, type PostgresSequenceTargets } from '../../shared/postgresSequence';
import { errorMessage, invoke } from '../lib';
import { postgresSequenceZh as text } from '../locales/postgresSequence.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { PostgresDependenciesDialog } from './PostgresDependenciesDialog';
import { postgresDependenciesZh } from '../locales/postgresDependencies.zh-CN';
import './PostgresCreateTableDialog.css';

const numericFields = ['start', 'increment', 'minimum', 'maximum', 'cache'] as const;
type SequenceOperation = PostgresSequenceManageInput['action'];
type SequenceAction = 'edit' | 'rename' | 'drop' | 'ownership';
type OwnershipAction = 'bind' | 'detach' | 'owner';

/** 详情绑定原数据库目录；连接版本变化后废弃旧的读取回包。 */
export function PostgresSequenceDialog({ target, onClose, onDirtyChange, onManaged }: {
  target: PostgresSequenceReadInput; onClose(): void; onDirtyChange(value: boolean): void;
  onManaged(action: SequenceOperation, name: string, version: number, message: string): void;
}) {
  const { connectionId, database, table } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connectionId, database, table, version, attempt]);
  const [result, setResult] = useState<{ key: string; info?: PostgresSequenceInfo; error?: string }>();
  const [manage, setManage] = useState<{ action: SequenceAction; info: PostgresSequenceInfo; version: number }>();
  const [dependencies, setDependencies] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void invoke('postgres.sequence.read', { connectionId, database, table }).then(info => {
        if (active) setResult({ key, info });
      }, reason => {
        if (active) setResult({ key, error: errorMessage(reason) });
      });
    });
    return () => { active = false; };
  }, [connectionId, database, table, key]);
  const current = result?.key === key ? result : undefined;
  const info = current?.info;
  const fields = info && [
    [text.dataType, info.dataType], [text.owner, info.owner], ...numericFields.map(field => [text[field], info[field]]),
    [text.cycle, info.cycle ? '是' : '否'], [text.lastValue, info.lastValue ?? text.noValue],
    [text.ownedBy, info.ownedBy ? [info.ownedBy.schema, info.ownedBy.relation, info.ownedBy.column]
      .map(postgresIdentifier).join('.') + (info.ownedBy.identity ? ' · ' + text.identity : '') : '—'],
    [text.comment, info.comment ?? '—'],
  ];
  if (dependencies) return <PostgresDependenciesDialog target={target} onBack={() => setDependencies(false)}/>;
  if (manage) return <PostgresManageSequenceDialog target={target} {...manage} onDirtyChange={onDirtyChange}
    onClose={unknown => {
      if (unknown) onClose();
      else setManage(undefined);
    }} onManaged={(action, name, message) => {
      setManage(undefined);
      setAttempt(value => value + 1);
      onManaged(action, name, manage.version, message);
    }}/>;
  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content pg-structure-content">
      <strong>{database} / {table}</strong>
      {!current && <Spinner text={text.loading}/>}
      <ErrorBox message={current?.error ?? ''}/>
      {fields && <><p>{text.hint}</p><table className="pg-structure-table"><tbody>{fields.map(([label, value]) =>
        <tr key={label}><th scope="row">{label}</th><td><code>{value}</code></td></tr>)}</tbody></table></>}
    </div>
    <footer className="modal-footer"><button disabled={!current} onClick={() => setAttempt(value => value + 1)}>{zh.common.refresh}</button>
      {info && <button onClick={() => setDependencies(true)}>{postgresDependenciesZh.open}</button>}
      {info?.canManage && <>
        <button onClick={() => setManage({ action: 'edit', info, version })}>{text.edit}</button>
        <button onClick={() => setManage({ action: 'rename', info, version })}>{text.rename}</button>
        {!info.ownedBy?.identity && <button onClick={() => setManage({ action: 'ownership', info, version })}>{text.ownership}</button>}
        {!info.ownedBy?.identity && <button onClick={() => setManage({ action: 'drop', info, version })}>{text.drop}</button>}
      </>}
      <span className="grow"/><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}

/** 详情版本和一次性预览共同绑定本次编辑，重启或删除须再次明确确认。 */
function PostgresManageSequenceDialog({ target, action, info, version, onClose, onManaged, onDirtyChange }: {
  target: PostgresSequenceReadInput; action: SequenceAction; info: PostgresSequenceInfo; version: number;
  onClose(unknown: boolean): void; onManaged(action: SequenceOperation, name: string, message: string): void; onDirtyChange(value: boolean): void;
}) {
  const currentVersion = useWorkspace(state => state.connectionVersions[target.connectionId] ?? 0);
  const [draft, setDraft] = useState({ dataType: info.dataType, start: info.start, increment: info.increment,
    minimum: info.minimum, maximum: info.maximum, cache: info.cache, cycle: info.cycle, comment: info.comment ?? '', restart: '' });
  const [name, setName] = useState(info.name);
  const [ownership, setOwnership] = useState<OwnershipAction>('bind');
  const [search, setSearch] = useState(''), [choice, setChoice] = useState('');
  const [targets, setTargets] = useState<PostgresSequenceTargets>();
  const [targetsError, setTargetsError] = useState('');
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [preview, setPreview] = useState<PostgresCreateTablePreview>(), [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [dependencies, setDependencies] = useState(false);
  const locked = useRef(false);
  const stale = version !== currentVersion;
  const operation = action === 'ownership' ? ownership : action;
  const choosingTarget = operation === 'bind' || operation === 'owner';
  const needsAcknowledgement = action === 'ownership' || action === 'drop' || (action === 'edit' && !!draft.restart);
  useEffect(() => { onDirtyChange(dirty || busy || !!preview); }, [dirty, busy, preview, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!choosingTarget || stale) return;
    let active = true;
    const timer = setTimeout(() => {
      void invoke('postgres.sequence.targets', { ...target, stamp: info.stamp,
        kind: operation === 'owner' ? 'role' : 'column', search }).then(result => {
        if (active) setTargets(result);
      }, reason => { if (active) setTargetsError(errorMessage(reason)); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [choosingTarget, info.stamp, operation, search, stale, target.connectionId, target.database, target.table]);

  /** 筛选变化后必须从新结果选择，防止把上一份目录的选择用于当前操作。 */
  function resetTargets() {
    setChoice('');
    setTargets(undefined);
    setTargetsError('');
    setError('');
  }

  /** 取消预览后清除上一次的确认。 */
  function back() {
    setPreview(undefined);
    setAcknowledged(false);
    setError('');
  }

  /** 一旦发出确认，依据原事务回执报告成功、回滚或未知。 */
  async function submit() {
    if (locked.current || unknown || (useWorkspace.getState().connectionVersions[target.connectionId] ?? 0) !== version ||
        (preview && needsAcknowledgement && !acknowledged)) return;
    locked.current = true;
    setBusy(true);
    back();
    try {
      if (!preview) {
        const base = { ...target, action: operation, stamp: info.stamp };
        const input = postgresSequenceManageSchema.parse(operation === 'edit' ? { ...base, ...draft,
          comment: draft.comment === (info.comment ?? '') ? undefined : draft.comment } : operation === 'rename' ? { ...base, name } :
          choosingTarget ? { ...base, key: choice } : base);
        const next = await invoke('postgres.sequence.manage.preview', input);
        if ((useWorkspace.getState().connectionVersions[target.connectionId] ?? 0) === version) setPreview(next);
      } else {
        const result = await invoke('postgres.sequence.manage.apply', { connectionId: target.connectionId,
          database: target.database, token: preview.token });
        if (result.outcome === 'committed' && result.table) onManaged(operation, result.table, result.message);
        else {
          setUnknown(result.outcome === 'unknown');
          setError(result.message);
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

  function close() {
    if (!locked.current && (!dirty || stale || unknown || window.confirm(text.discard))) onClose(unknown);
  }

  function edit<K extends keyof typeof draft>(field: K, value: typeof draft[K]) {
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    setError('');
  }

  const hint = { edit: text.editHint, rename: text.renameHint, drop: text.dropHint, bind: text.bindHint,
    detach: text.detachHint, owner: text.transferHint }[operation];
  const confirm = { edit: text.applyEdit, rename: text.applyRename, drop: text.applyDrop, ownership: text.applyOwnership }[action];
  if (dependencies) return <PostgresDependenciesDialog target={target} onBack={() => setDependencies(false)}/>;
  return <Modal title={text[action]} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>{target.database} / {target.table}</strong><p>{hint}</p>
      <ErrorBox message={[stale && text.stale, unknown && text.unknownManage, error].filter(Boolean).join(' ')}/>
      {busy && <Spinner text={text.working}/>}
      {preview ? <>
        <pre className="pg-create-sql">{preview.statements.join(';\n') + ';'}</pre>
        {needsAcknowledgement && <label><input type="checkbox" checked={acknowledged} disabled={stale}
          onChange={event => setAcknowledged(event.target.checked)}/> {action === 'ownership' ? text.acknowledgeOwnership :
            action === 'drop' ? text.acknowledge : text.acknowledgeRestart}</label>}
      </> : <fieldset disabled={busy || unknown || stale}>
        {action === 'ownership' && <>
          <Field label={text.ownershipMode}><select aria-label={text.ownershipMode} value={ownership} onChange={event => {
            setOwnership(event.target.value as OwnershipAction); setSearch(''); resetTargets();
          }}>
            <option value="bind">{text.bind}</option>
            {info.ownedBy ? <option value="detach">{text.detach}</option> : <option value="owner">{text.transfer}</option>}
          </select></Field>
          {choosingTarget && <>
            <Field label={text.targetSearch}><input value={search} maxLength={256} onChange={event => {
              setSearch(event.target.value); resetTargets();
            }}/></Field>
            <Field label={text.targetChoice}><select aria-label={text.targetChoice} value={choice} disabled={!targets?.choices.length}
              onChange={event => { setChoice(event.target.value); setDirty(true); setError(''); }}>
              <option value="">{text.targetPlaceholder}</option>
              {targets?.choices.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}
            </select></Field>
            {!targets && !targetsError && !stale && <Spinner text={text.loading}/>}
            <ErrorBox message={targetsError}/>
            {targets && !targets.choices.length && <p>{text.targetEmpty}</p>}
            {targets?.limited && <p>{text.targetLimited}</p>}
          </>}
        </>}
        {action === 'rename' && <Field label={text.name}><input value={name} maxLength={63}
          onChange={event => { setName(event.target.value); setDirty(true); setError(''); }}/></Field>}
        {action === 'edit' && <>
          <div className="pg-create-target">
            <Field label={text.dataType}><select value={draft.dataType} onChange={event => edit('dataType', event.target.value as typeof draft.dataType)}>
              {['smallint', 'integer', 'bigint'].map(type => <option key={type}>{type}</option>)}</select></Field>
            {numericFields.map(field => <Field key={field} label={text[field]}><input value={draft[field]}
              maxLength={20} onChange={event => edit(field, event.target.value)}/></Field>)}
            <Field label={text.restart}><input value={draft.restart} maxLength={20} placeholder={text.restartPlaceholder}
              onChange={event => edit('restart', event.target.value)}/></Field>
            <Field label={text.comment}><textarea aria-label={text.comment} value={draft.comment}
              maxLength={4096} onChange={event => edit('comment', event.target.value)}/></Field>
          </div>
          <label><input type="checkbox" checked={draft.cycle} onChange={event => edit('cycle', event.target.checked)}/> {text.cycle}</label>
        </>}
      </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={back}>{text.back}</button>}
      {action === 'drop' && <button disabled={busy || stale} onClick={() => setDependencies(true)}>{postgresDependenciesZh.open}</button>}
      <span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || stale || unknown || (preview && needsAcknowledgement && !acknowledged) ||
        (action === 'rename' && (!name.trim() || name === info.name)) || (choosingTarget && !choice)}
        onClick={() => void submit()}>{preview ? confirm : text.preview}</button>
    </footer>
  </Modal>;
}

/** 创建窗口的能力只绑定原连接与草稿，未知结果时停止重放。 */
export function PostgresCreateSequenceDialog({ target, onClose, onDirtyChange, onCreated }: {
  target: PostgresCreateTableTarget; onClose(): void; onDirtyChange(value: boolean): void;
  onCreated(name: string, version: number, message: string): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [schemas, setSchemas] = useState<string[]>();
  const [draft, setDraft] = useState({ schema: '', name: '', dataType: 'bigint', start: '', increment: '', minimum: '', maximum: '', cache: '', cycle: false, comment: '' });
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const request = useRef<object | undefined>(undefined), locked = useRef(false);
  useEffect(() => {
    const owner = {};
    request.current = owner;
    setSchemas(undefined);
    setPreview(undefined);
    setError('');
    queueMicrotask(() => {
      if (request.current !== owner) return;
      void invoke('postgres.createTable.schemas', { connectionId, database }).then(list => {
        if (request.current !== owner) return;
        setSchemas(list);
        setDraft(previous => ({ ...previous, schema: list.includes(previous.schema) ? previous.schema : list[0] ?? '' }));
      }, reason => {
        if (request.current !== owner) return;
        setError(errorMessage(reason));
        setSchemas([]);
      });
    });
    return () => { if (request.current === owner) request.current = undefined; };
  }, [connectionId, database, version]);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 修改任一字段后，提交只能消费新预览。 */
  function edit<K extends keyof typeof draft>(key: K, value: typeof draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setDirty(true);
    setPreview(undefined);
    setError('');
  }

  /** 预览校验整数和目录，确认阶段保留真实事务终态。 */
  async function submit() {
    const owner = request.current;
    if (!owner || locked.current || unknown || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setPreview(undefined);
    let sent = false;
    try {
      if (!preview) {
        const input = postgresSequenceCreateSchema.parse({ connectionId, database, ...draft });
        postgresSequencePlan(input);
        const next = await invoke('postgres.sequence.preview', input);
        if (request.current === owner) setPreview(next);
      } else {
        sent = true;
        const result = await invoke('postgres.sequence.apply', { connectionId, database, token: preview.token });
        if (result.outcome === 'committed' && result.table) {
          onCreated(result.table, version, result.message);
          onClose();
        } else {
          setUnknown(result.outcome === 'unknown');
          setError(result.message);
        }
      }
    } catch (reason) {
      if (sent) setUnknown(true);
      if (sent || request.current === owner) setError(errorMessage(reason));
    } finally {
      locked.current = false;
      if (request.current) setBusy(false);
    }
  }

  /** 等待写请求结算，用户可以明确放弃本地草稿。 */
  function close() {
    if (!locked.current && (!dirty || unknown || window.confirm(text.discard))) onClose();
  }

  return <Modal title={text.create} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong><p>{text.createHint}</p>
      {!schemas && <Spinner text={text.loading}/>}
      {busy && <Spinner text={text.working}/>}
      <ErrorBox message={[unknown && text.unknown, error || (schemas?.length === 0 && text.none)].filter(Boolean).join(' ')}/>
      {preview ? <pre className="pg-create-sql">{preview.statements.join(';\n') + ';'}</pre> :
        <fieldset disabled={busy || unknown || !schemas?.length}>
          <div className="pg-create-target">
            <Field label={text.schema}><select value={draft.schema} onChange={event => edit('schema', event.target.value)}>
              {schemas?.map(schema => <option key={schema}>{schema}</option>)}</select></Field>
            <Field label={text.name}><input value={draft.name} maxLength={63} onChange={event => edit('name', event.target.value)}/></Field>
            <Field label={text.dataType}><select value={draft.dataType} onChange={event => edit('dataType', event.target.value)}>
              {['smallint', 'integer', 'bigint'].map(type => <option key={type}>{type}</option>)}</select></Field>
            {numericFields.map(field => <Field key={field} label={text[field]}><input value={draft[field]}
              maxLength={20} placeholder={text.defaultValue} onChange={event => edit(field, event.target.value)}/></Field>)}
            <Field label={text.comment}><input value={draft.comment} maxLength={4096} onChange={event => edit('comment', event.target.value)}/></Field>
          </div>
          <label><input type="checkbox" checked={draft.cycle} onChange={event => edit('cycle', event.target.checked)}/> {text.cycle}</label>
        </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && <button disabled={busy} onClick={() => setPreview(undefined)}>{text.back}</button>}
      <span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || unknown || !schemas?.length || !draft.name.trim()} onClick={() => void submit()}>
        {preview ? text.apply : text.preview}
      </button>
    </footer>
  </Modal>;
}
