import { connectionOverview } from '../sqliteWorkspace';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { connectionOrganizationApplySchema, connectionOrganizationDefaultColor, connectionOrganizationLimits, type ConnectionOrganizationApply, type ConnectionOrganizationSnapshot } from '../../shared/connectionOrganization';
import { connectionOrganizationZh as text } from '../../shared/connectionOrganization.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox, Modal, UsageHelp } from './ui';

interface Props { onClose(): void; onApplied(snapshot: ConnectionOrganizationSnapshot): void; }
type Draft = { editGroup: boolean; group: string; editColor: boolean; color: string; resetColor: boolean };
type Preview = { snapshot: ConnectionOrganizationSnapshot; draft: Draft; selection: ReadonlySet<string>; input: ConnectionOrganizationApply; rows: readonly ConnectionProfile[] };
type Operation = { kind: 'get' | 'apply'; lifecycle: number };
const pageSize = 50;

/** 所有公开概要先读自有数据描述符，不在回包校验时执行getter或解密认证字段。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.snapshotInvalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.snapshotInvalid);
  return descriptor.value;
}
/** 完整拷贝公开transport概要，但明文秘密、循环、访问器和非协议对象都不发布给父层。 */
function publicValue(value: unknown, ancestors: Set<object>, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || depth > 8 || ancestors.has(value)) throw Error(text.snapshotInvalid);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) throw Error(text.snapshotInvalid);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = own(value, 'length'); if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > 1000 || Reflect.ownKeys(value).length !== (length as number) + 1) throw Error(text.snapshotInvalid);
      return Array.from({ length: length as number }, (_, index) => publicValue(own(value, String(index)), ancestors, depth + 1));
    }
    const keys = Reflect.ownKeys(value); if (keys.length > 128) throw Error(text.snapshotInvalid);
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string') throw Error(text.snapshotInvalid);
      const item = own(value, key);
      if (key === 'password' || key === 'passphrase') { if (item !== undefined) throw Error(text.snapshotInvalid); continue; }
      Object.defineProperty(output, key, { value: publicValue(item, ancestors, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally { ancestors.delete(value); }
}
/** 回包不复制输入transport校验合同，只核展示身份并保留其余安全公开字段。 */
function snapshot(raw: unknown): ConnectionOrganizationSnapshot {
  const revision = own(raw, 'revision'), values = own(raw, 'connections');
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || !Array.isArray(values) || Reflect.ownKeys(raw as object).length !== 2) throw Error(text.snapshotInvalid);
  const count = own(values, 'length'); if (!Number.isSafeInteger(count) || Reflect.ownKeys(values).length !== (count as number) + 1) throw Error(text.snapshotInvalid);
  const ids = new Set<string>(), connections: ConnectionProfile[] = [];
  for (let index = 0; index < (count as number); index++) {
    const value = publicValue(own(values, String(index)), new Set()) as ConnectionProfile;
    if (!value || typeof value.id !== 'string' || !value.id || ids.has(value.id) || typeof value.name !== 'string' || typeof value.group !== 'string' || typeof value.color !== 'string') throw Error(text.snapshotInvalid);
    ids.add(value.id); connections.push(value);
  }
  return { revision: revision as number, connections };
}

/** 批量整理只发布已预览的分组与颜色补丁；不触连接transport、会话或编辑标签。 */
export function ConnectionOrganizationDialog({ onClose, onApplied }: Props) {
  const callbacks = useRef({ onClose, onApplied }); callbacks.current = { onClose, onApplied };
  const [loaded, setLoaded] = useState<ConnectionOrganizationSnapshot>(), loadedRef = useRef(loaded);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), selectedRef = useRef(selected);
  const [draft, setDraft] = useState<Draft>({ editGroup: false, group: '', editColor: false, color: connectionOrganizationDefaultColor, resetColor: false }), draftRef = useRef(draft);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [previewPage, setPreviewPage] = useState(1);
  const [preview, setPreview] = useState<Preview>(), previewRef = useRef(preview);
  const [pending, setPending] = useState<'' | 'get' | 'apply'>(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [needsRefresh, setNeedsRefresh] = useState(false);
  const refreshRef = useRef(false), active = useRef<Operation | undefined>(undefined), alive = useRef(true), closed = useRef(false), lifecycle = useRef(0), revision = useRef(0);
  const ticket = revision.current;
  /** 本地代次同步推进，草稿或选择A→B→A也不能复活旧预览及事件回调。 */
  function current(expected = ticket): boolean { return alive.current && !closed.current && revision.current === expected; }
  function editable(): boolean { return current() && !!loadedRef.current && !active.current && !refreshRef.current; }
  /** 所有编辑先撤销预览，再在同一事件栈发布独立草稿或选择引用。 */
  function change(action: () => void): void {
    if (!editable()) return;
    revision.current++; previewRef.current = undefined; setPreview(undefined); setPreviewPage(1); setError(''); setNotice(''); action();
  }
  /** 显式刷新撤销全部旧能力；列表迟到只可发布给仍持有本次owner的实例。 */
  async function load(): Promise<void> {
    if (!alive.current || closed.current || active.current?.kind === 'apply') return;
    const operation: Operation = { kind: 'get', lifecycle: lifecycle.current }; active.current = operation; revision.current++;
    previewRef.current = undefined; setPreview(undefined); setPreviewPage(1); setPending('get'); setError(''); setNotice('');
    try {
      const raw = await invoke('connections.organizationGet', {});
      if (!alive.current || closed.current || active.current !== operation || operation.lifecycle !== lifecycle.current) return;
      const next = snapshot(raw);
      const ids = new Set(next.connections.map(connection => connection.id)), retained = new Set([...selectedRef.current].filter(id => ids.has(id))), removed = selectedRef.current.size - retained.size;
      revision.current++; loadedRef.current = next; setLoaded(next); selectedRef.current = retained; setSelected(retained); refreshRef.current = false; setNeedsRefresh(false); setPage(1);
      if (removed) setNotice(text.selectionRemoved(removed));
    } catch (reason) { if (alive.current && !closed.current && active.current === operation && operation.lifecycle === lifecycle.current) { refreshRef.current = true; setNeedsRefresh(true); setError(errorMessage(reason)); } }
    finally { if (active.current === operation) { active.current = undefined; if (alive.current && !closed.current) setPending(''); } }
  }
  useEffect(() => {
    alive.current = true; lifecycle.current++; void load();
    return () => { alive.current = false; lifecycle.current++; active.current = undefined; previewRef.current = undefined; };
  }, []);

  const filtered = useMemo(() => { const query = search.toLowerCase(); return loaded?.connections.filter(connection => [connection.id, connection.name, connection.group, connectionOverview(connection)].some(value => typeof value === 'string' && value.toLowerCase().includes(query))) ?? []; }, [loaded, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), visiblePage = Math.min(page, pages), visible = filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  const previewPages = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / pageSize)), currentPreviewPage = Math.min(previewPage, previewPages);
  const previewRows = preview?.rows.slice((currentPreviewPage - 1) * pageSize, currentPreviewPage * pageSize) ?? [];
  /** 勾选只使用准确id，搜索隐藏的选择仍保留；整批越1000时全部拒绝，不静默截断。 */
  function select(ids: readonly string[], checked: boolean): void {
    if (!editable() || ids.some(id => !loadedRef.current!.connections.some(connection => connection.id === id))) return;
    const next = new Set(selectedRef.current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    if (next.size > connectionOrganizationLimits.ids) { setError(text.limit); return; }
    change(() => { selectedRef.current = next; setSelected(next); });
  }
  /** 预览也使用正式apply合同，只生成本地有界补丁，不写数据库或保存配置。 */
  function prepare(): void {
    if (!editable()) return;
    try {
      const source = loadedRef.current!, chosen = draftRef.current, rows = source.connections.filter(connection => selectedRef.current.has(connection.id));
      const input = connectionOrganizationApplySchema.parse({ expectedRevision: source.revision, ids: rows.map(connection => connection.id), changes: { ...(chosen.editGroup ? { group: chosen.group } : {}), ...(chosen.editColor ? { color: chosen.resetColor ? null : chosen.color } : {}) } });
      revision.current++; const next = { snapshot: source, draft: chosen, selection: selectedRef.current, input, rows };
      previewRef.current = next; setPreview(next); setPreviewPage(1); setError(''); setNotice('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 原预览准确消费一次；失败只提示刷新，不重放可能已经落盘的写入。 */
  async function apply(expected: Preview): Promise<void> {
    if (!editable() || previewRef.current !== expected || loadedRef.current !== expected.snapshot || draftRef.current !== expected.draft || selectedRef.current !== expected.selection) return;
    const operation: Operation = { kind: 'apply', lifecycle: lifecycle.current }; active.current = operation; revision.current++;
    previewRef.current = undefined; setPreview(undefined); setPending('apply'); setError(''); setNotice('');
    try {
      const raw = await invoke('connections.organizationApply', expected.input);
      if (!alive.current || closed.current || active.current !== operation || operation.lifecycle !== lifecycle.current) return;
      const next = snapshot(raw);
      revision.current++; loadedRef.current = next; setLoaded(next); setNotice(text.success); callbacks.current.onApplied(next);
    } catch (reason) { if (alive.current && !closed.current && active.current === operation && operation.lifecycle === lifecycle.current) { refreshRef.current = true; setNeedsRefresh(true); setError(errorMessage(reason)); } }
    finally { if (active.current === operation) { active.current = undefined; if (alive.current && !closed.current) setPending(''); } }
  }
  /** 写入等待中不能关闭；读取等待可关闭，但任何迟到回包均失去owner。 */
  function close(): void { if (!current() || active.current?.kind === 'apply') return; closed.current = true; revision.current++; active.current = undefined; previewRef.current = undefined; setPreview(undefined); callbacks.current.onClose(); }
  const disabled = !!pending || !loaded || needsRefresh || closed.current;
  const patch = (next: Partial<Draft>) => change(() => { const value = { ...draftRef.current, ...next }; draftRef.current = value; setDraft(value); });
  return <Modal title={text.title} onClose={close} wide><div className="modal-content">
    <UsageHelp><p>{text.notice}</p><p>{text.selectHint}</p><p>{text.groupHint}</p><p>{text.colorHint}</p><p>{text.previewHint}</p></UsageHelp>
    <div className="filter-inputs"><label>{text.search}<input aria-label={text.search} value={search} disabled={disabled} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change(() => { setSearch(event.target.value); setPage(1); }); }}/></label><button disabled={!!pending} onClick={() => { if (current()) void load(); }}>{text.refresh}</button><button disabled={disabled || !visible.length} onClick={() => select(visible.map(connection => connection.id), true)}>{text.visibleSelect}</button><button disabled={disabled || !selected.size} onClick={() => change(() => { const next = new Set<string>(); selectedRef.current = next; setSelected(next); })}>{text.clearAll}</button></div>
    <p role="status">{text.selectedSummary(selected.size, loaded?.connections.length ?? 0)}</p>
    <table aria-label={text.list}><thead><tr><th>{text.selectLabel}</th><th>{text.name}</th><th>{text.currentGroup}</th><th>{text.currentColor}</th></tr></thead><tbody>{visible.map(connection => <tr key={connection.id}><td><input type="checkbox" aria-label={text.select(connection.id)} checked={selected.has(connection.id)} disabled={disabled} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) select([connection.id], event.target.checked); }}/></td><td>{connection.name}</td><td>{text.groupDisplay(connection.group)}</td><td>{connection.color}</td></tr>)}</tbody></table>{!visible.length && !pending && <p>{text.noResults}</p>}
    <div className="filter-inputs"><button disabled={disabled || visiblePage <= 1} onClick={() => change(() => setPage(visiblePage - 1))}>{text.previous}</button><span>{text.page(visiblePage - 1, pages)}</span><button disabled={disabled || visiblePage >= pages} onClick={() => change(() => setPage(visiblePage + 1))}>{text.next}</button></div>
    <fieldset disabled={disabled}><legend>{text.changesHint}</legend><label className="check"><input type="checkbox" aria-label={text.editGroup} checked={draft.editGroup} disabled={disabled} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) patch({ editGroup: event.target.checked }); }}/>{text.editGroup}</label><label>{text.group}<input aria-label={text.group} maxLength={connectionOrganizationLimits.group} value={draft.group} disabled={disabled || !draft.editGroup} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && draftRef.current.editGroup) patch({ group: event.target.value }); }}/></label>
      <label className="check"><input type="checkbox" aria-label={text.editColor} checked={draft.editColor} disabled={disabled} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) patch({ editColor: event.target.checked }); }}/>{text.editColor}</label><label className="check"><input type="checkbox" aria-label={text.resetColor} checked={draft.resetColor} disabled={disabled || !draft.editColor} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && draftRef.current.editColor) patch({ resetColor: event.target.checked }); }}/>{text.resetColor}</label><label>{text.color}<input type="color" aria-label={text.color} value={draft.color} disabled={disabled || !draft.editColor || draft.resetColor} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && draftRef.current.editColor && !draftRef.current.resetColor) patch({ color: event.target.value }); }}/></label></fieldset>
    <button disabled={disabled || !selected.size || !draft.editGroup && !draft.editColor} onClick={prepare}>{text.preview}</button>
    {preview && <section aria-label={text.previewTitle}><h3>{text.previewTitle}</h3><p>{text.selectedSummary(preview.rows.length, loaded?.connections.length ?? 0)}</p><table><thead><tr><th>{text.name}</th><th>{text.currentGroup}</th><th>{text.targetGroup}</th><th>{text.currentColor}</th><th>{text.targetColor}</th></tr></thead><tbody>{previewRows.map(connection => <tr key={connection.id} aria-label={text.previewRow(connection.id)}><td>{connection.name}</td><td>{text.groupDisplay(connection.group)}</td><td>{text.groupDisplay(preview.input.changes.group ?? connection.group)}</td><td>{connection.color}</td><td>{preview.input.changes.color === null ? connectionOrganizationDefaultColor : preview.input.changes.color ?? connection.color}</td></tr>)}</tbody></table><div className="filter-inputs"><button disabled={currentPreviewPage <= 1 || !!pending} onClick={() => { if (current() && previewRef.current === preview) setPreviewPage(currentPreviewPage - 1); }}>{text.previous}</button><span>{text.page(currentPreviewPage - 1, previewPages)}</span><button disabled={currentPreviewPage >= previewPages || !!pending} onClick={() => { if (current() && previewRef.current === preview) setPreviewPage(currentPreviewPage + 1); }}>{text.next}</button></div></section>}
    {pending === 'get' && <p role="status">{text.loading}</p>}{pending === 'apply' && <p role="status">{text.applying}</p>}{needsRefresh && <p>{text.refreshNeeded}</p>}{notice && <p role="status">{notice}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><span className="grow"/><button disabled={pending === 'apply'} onClick={close}>{text.close}</button><button className="primary" disabled={disabled || !preview} onClick={() => { if (preview) void apply(preview); }}>{text.startApply}</button></footer></Modal>;
}
