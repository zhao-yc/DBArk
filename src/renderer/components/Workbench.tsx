import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Star } from 'lucide-react';
import { parseObjectUri, targetKey, type WorkbenchDocument, type WorkbenchTarget } from '../../shared/workbench';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace } from '../store';
import { useWorkbench } from '../workbench';
import { workbenchZh as t } from '../locales/workbench.zh-CN';
import { ErrorBox, Field, Modal, UsageHelp } from './ui';
import type { OpenWorkbenchTarget } from '../workbenchNavigation';

export type { OpenWorkbenchTarget } from '../workbenchNavigation';

/** 每个入口持有自己的显示生命周期；关闭或卸载只废弃所属请求，不影响其它入口的新请求。 */
function useWorkbenchOpenScope() {
  const mounted = useRef(true), pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  return {
    /** 再次提交前撤销本入口的旧请求归属，信号只在渲染进程使用，不进入 IPC。 */
    begin() { pending.current?.abort(); pending.current = new AbortController(); return { signal: pending.current.signal }; },
    cancel() { pending.current?.abort(); },
    alive() { return mounted.current; }
  };
}

/** 对象树星标只改变本地收藏；同名不同类型对象独立显示状态。 */
export function FavoriteButton({ target, menu = false, beforeAction }: { target: WorkbenchTarget; menu?: boolean; beforeAction?: () => boolean }) {
  const { snapshot, ready, busy } = useWorkbench();
  const saved = snapshot.document.favorites.some(item => targetKey(item.target) === targetKey(target));
  const name = target.kind === 'database' ? target.database : target.name;
  return <button role={menu ? 'menuitem' : undefined} disabled={!ready || busy} aria-label={t.action(saved ? t.remove : t.add, name)} title={saved ? t.remove : t.add} aria-pressed={menu ? undefined : saved} onClick={() => { if (!menu || beforeAction?.()) void useWorkbench.getState().toggleFavorite(target); }}><Star size={12} fill={saved ? 'currentColor' : 'none'}/>{menu && <span>{saved ? t.remove : t.add}</span>}</button>;
}

/** 收藏面板作为独立虚拟关系展示，不复用或更改真实连接分组。 */
export function WorkbenchShelf({ onOpen }: { onOpen: OpenWorkbenchTarget }) {
  const { snapshot, ready } = useWorkbench();
  const connections = useWorkspace(state => state.connections);
  const [opening, setOpening] = useState(false);
  const scope = useWorkbenchOpenScope();
  const { favorites, groups } = snapshot.document;
  if (!ready || !favorites.length) return null;
  return <section className="workbench-shelf" aria-label={t.shelf}><div className="group-label"><Star size={13}/>{t.shelf}</div>{[{ id: null, name: t.ungrouped }, ...groups].map(group => {
    const items = favorites.filter(item => item.groupId === group.id);
    return items.length > 0 && <div key={group.id ?? ''}>{group.id && <div className="workbench-group-label">{group.name}</div>}{items.map(item => {
      const profile = connections.find(profile => profile.id === item.target.connectionId);
      const environment = profile ? [profile.group, profile.name].filter(Boolean).join(' / ') : t.invalidConnection;
      const duplicate = profile && connections.some(other => other.id !== profile.id && other.name === profile.name && other.group === profile.group);
      const connectionLabel = !profile || duplicate ? `${environment} [${item.target.connectionId}]` : environment;
      const identity = `${environment} [${item.target.connectionId}] · ${t.kinds[item.target.kind]} · ${JSON.stringify(item.target.database)}${item.target.kind === 'database' ? '' : '.' + JSON.stringify(item.target.name)}`;
      const description = t.action(t.open, `${item.label} · ${identity}`);
      return <button className="workbench-shelf-item" key={item.id} data-connection-id={item.target.connectionId} disabled={opening} title={description} aria-label={description} onClick={() => {
        setOpening(true); const options = scope.begin();
        void onOpen(item.target, options).catch(error => { if (scope.alive()) useWorkspace.getState().notify(errorMessage(error), true); }).finally(() => { if (scope.alive()) setOpening(false); });
      }}><Star size={12}/><span className="workbench-shelf-identity"><span className="workbench-shelf-name">{item.label}</span><small><span className="workbench-connection-color" aria-hidden="true" style={{ backgroundColor: profile?.color ?? 'var(--muted)' }}/><span>{connectionLabel}</span></small></span></button>;
    })}</div>;
  })}</section>;
}

/** 调整数组相邻顺序，收藏和分组均使用持久化数组位置，不拼接对象名称。 */
function move<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items]; const destination = index + direction;
  if (destination >= 0 && destination < next.length) [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

/** 收藏管理集中提供增删改序和虚拟归组，保存成功前不更新当前快照。 */
export function WorkbenchDialog({ onClose, onOpen }: { onClose(): void; onOpen: OpenWorkbenchTarget }) {
  const { snapshot, ready, busy, error } = useWorkbench();
  const connections = useWorkspace(state => state.connections);
  const document = snapshot.document;
  const [groupName, setGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [label, setLabel] = useState(''); const [groupId, setGroupId] = useState('');
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [database, setDatabase] = useState(''); const [kind, setKind] = useState<WorkbenchTarget['kind']>('table'); const [name, setName] = useState('');
  const [localError, setLocalError] = useState(''); const [opening, setOpening] = useState(false);
  const scope = useWorkbenchOpenScope();
  const disabled = busy || opening || !ready;
  /** 保存仍需等待落盘；导航等待期间允许关闭，并撤销此弹窗的请求归属。 */
  function close() { if (!busy) { scope.cancel(); onClose(); } }
  /** 只提交完整合法文档，保留失败表单以便修改或重试。 */
  async function save(next: WorkbenchDocument) { setLocalError(''); return useWorkbench.getState().save(next); }
  /** 编辑收藏名称与虚拟归组时保持原连接及对象身份，不能暗中换连接。 */
  async function saveFavorite() {
    try {
      const previous = document.favorites.find(item => item.id === editingId);
      const target: WorkbenchTarget = previous?.target ?? (kind === 'database' ? { connectionId, database, kind } : { connectionId, database, kind, name });
      const favorite = { id: previous?.id ?? uid(), label, groupId: groupId || null, target };
      const favorites = previous ? document.favorites.map(item => item.id === previous.id ? favorite : item) : [...document.favorites, favorite];
      if (await save({ ...document, favorites })) setEditingId(undefined);
    } catch (error) { setLocalError(errorMessage(error)); }
  }
  return <Modal title={t.title} onClose={close} wide><div className="modal-content workbench-manager"><UsageHelp><p>{t.hint}</p></UsageHelp>
    {!ready && <button disabled={busy} onClick={() => void useWorkbench.getState().initialize()}>{busy ? t.loading : t.retry}</button>}
    <form className="workbench-group-form" onSubmit={event => { event.preventDefault(); void save({ ...document, groups: editingGroup ? document.groups.map(group => group.id === editingGroup ? { ...group, name: groupName } : group) : [...document.groups, { id: uid(), name: groupName }] }).then(saved => { if (saved) { setGroupName(''); setEditingGroup(null); } }); }}>
      <Field label={t.groupName}><input maxLength={100} value={groupName} onChange={event => setGroupName(event.target.value)} required/></Field><button disabled={disabled} type="submit">{editingGroup ? t.save : t.newGroup}</button>{editingGroup && <button type="button" onClick={() => { setEditingGroup(null); setGroupName(''); }}>{t.cancel}</button>}
    </form>
    <div className="workbench-groups">{document.groups.map((group, index) => <div className="workbench-item" key={group.id}><strong>{group.name}</strong><span className="grow"/>
      <button disabled={disabled || index === 0} aria-label={t.action(t.up, group.name)} onClick={() => void save({ ...document, groups: move(document.groups, index, -1) })}><ArrowUp size={14}/></button>
      <button disabled={disabled || index === document.groups.length - 1} aria-label={t.action(t.down, group.name)} onClick={() => void save({ ...document, groups: move(document.groups, index, 1) })}><ArrowDown size={14}/></button>
      <button disabled={disabled} aria-label={t.action(t.rename, group.name)} onClick={() => { setEditingGroup(group.id); setGroupName(group.name); }}>{t.rename}</button>
      <button disabled={disabled} aria-label={t.action(t.deleteGroup, group.name)} onClick={() => void save({ ...document, groups: document.groups.filter(item => item.id !== group.id), favorites: document.favorites.map(item => item.groupId === group.id ? { ...item, groupId: null } : item) }).then(saved => { if (saved && editingGroup === group.id) { setEditingGroup(null); setGroupName(''); } })}>{t.deleteGroup}</button>
    </div>)}</div>
    <button disabled={disabled} onClick={() => { setEditingId(null); setLabel(''); setGroupId(''); setDatabase(''); setName(''); setLocalError(''); }}>{t.add}</button>
    {editingId !== undefined && <form className="form-grid workbench-editor" onSubmit={event => { event.preventDefault(); void saveFavorite(); }}>
      <Field label={t.label}><input value={label} maxLength={256} onChange={event => setLabel(event.target.value)} required/></Field>
      <Field label={t.group}><select aria-label={t.group} value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">{t.ungrouped}</option>{document.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
      {editingId === null && <><Field label={t.connection}><select aria-label={t.connection} value={connectionId} onChange={event => setConnectionId(event.target.value)} required><option value="" disabled>{t.connection}</option>{connections.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
      <Field label={t.database}><input value={database} maxLength={256} onChange={event => setDatabase(event.target.value)} required/></Field>
      <Field label={t.kind}><select aria-label={t.kind} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>{Object.entries(t.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      {kind !== 'database' && <Field label={t.object}><input value={name} maxLength={256} onChange={event => setName(event.target.value)} required/></Field>}</>}
      <div className="full workbench-actions"><button type="button" onClick={() => setEditingId(undefined)}>{t.cancel}</button><button type="submit" disabled={disabled || (editingId === null && !connectionId)}>{t.save}</button></div>
    </form>}
    <div className="workbench-favorites">{document.favorites.map((favorite, index) => <article className="workbench-favorite" key={favorite.id}>
      <div><strong>{favorite.label}</strong><small>{connections.find(profile => profile.id === favorite.target.connectionId)?.name ?? t.invalidConnection} · {favorite.target.database} · {t.kinds[favorite.target.kind]}{favorite.target.kind !== 'database' && ` · ${favorite.target.name}`}</small><small>{document.groups.find(group => group.id === favorite.groupId)?.name ?? t.ungrouped}</small></div>
      <div className="workbench-actions"><button disabled={disabled} aria-label={t.action(t.open, favorite.label)} onClick={() => { setOpening(true); setLocalError(''); const options = scope.begin(); void onOpen(favorite.target, options).then(opened => { if (opened && scope.alive()) onClose(); }).catch(error => { if (scope.alive()) setLocalError(errorMessage(error)); }).finally(() => { if (scope.alive()) setOpening(false); }); }}>{t.open}</button>
      <button disabled={disabled} aria-label={t.action(t.copy, favorite.label)} onClick={() => { void invoke('workbench.copyUri', favorite.target).then(() => useWorkspace.getState().notify(t.copied)).catch(error => setLocalError(errorMessage(error))); }}><Copy size={14}/></button>
      <button disabled={disabled || index === 0} aria-label={t.action(t.up, favorite.label)} onClick={() => void save({ ...document, favorites: move(document.favorites, index, -1) })}><ArrowUp size={14}/></button>
      <button disabled={disabled || index === document.favorites.length - 1} aria-label={t.action(t.down, favorite.label)} onClick={() => void save({ ...document, favorites: move(document.favorites, index, 1) })}><ArrowDown size={14}/></button>
      <button disabled={disabled} aria-label={t.action(t.rename, favorite.label)} onClick={() => { setEditingId(favorite.id); setLabel(favorite.label); setGroupId(favorite.groupId ?? ''); }}>{t.rename}</button>
      <button disabled={disabled} aria-label={t.action(t.remove, favorite.label)} onClick={() => void save({ ...document, favorites: document.favorites.filter(item => item.id !== favorite.id) })}>{t.remove}</button></div>
    </article>)}</div>{!document.favorites.length && <p className="muted">{t.empty}</p>}<ErrorBox message={localError || error}/>
    </div><footer className="modal-footer"><button disabled={busy || opening} onClick={() => void useWorkbench.getState().initialize()}>{t.retry}</button><span className="grow"/><button disabled={busy} onClick={close}>{t.cancel}</button></footer></Modal>;
}

/** 粘贴内容仅经过自主 URI 解析和对象核验，不调用系统协议、外部 URL 或 SQL 执行入口。 */
export function ObjectLinkDialog({ onClose, onOpen }: { onClose(): void; onOpen: OpenWorkbenchTarget }) {
  const [uri, setUri] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const scope = useWorkbenchOpenScope();
  /** 关闭只废弃异步结果，不等待网络响应，也不把中止信号发送给数据库进程。 */
  function close() { scope.cancel(); onClose(); }
  return <Modal title={t.paste} onClose={close}><form onSubmit={event => { event.preventDefault(); if (busy) return; setError(''); setBusy(true); const options = scope.begin(); void Promise.resolve().then(() => onOpen(parseObjectUri(uri), options)).then(opened => { if (opened && scope.alive()) onClose(); }).catch(error => { if (scope.alive()) setError(errorMessage(error)); }).finally(() => { if (scope.alive()) setBusy(false); }); }}><div className="modal-content"><UsageHelp><p>{t.uriHint}</p></UsageHelp><Field label={t.uri}><textarea aria-label={t.uri} rows={5} maxLength={8192} value={uri} onChange={event => setUri(event.target.value)} required/></Field><ErrorBox message={error}/></div><footer className="modal-footer"><button type="button" onClick={close}>{t.cancel}</button><span className="grow"/><button className="primary" type="submit" disabled={busy || !uri}>{t.openUri}</button></footer></form></Modal>;
}
