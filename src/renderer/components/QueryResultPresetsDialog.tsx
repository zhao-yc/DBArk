import { useEffect, useRef, useState } from 'react';
import { queryResultPresetLimits, queryResultPresetSnapshotSchema, queryResultPresetValueSchema, type QueryResultFilterGroup, type QueryResultPresetSnapshot, type QueryResultPresetValue } from '../../shared/queryResultPresets';
import { invoke, errorMessage } from '../lib';
import { queryResultPresetsZh as text } from '../locales/queryResultPresets.zh-CN';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { zh } from '../locales/zh-CN';
import { Modal, ErrorBox, Spinner } from './ui';
import '../queryResultPresets.css';

/** 预览完整层级及原文，名称只用于显示；实际应用仍核字段唯一键及完整类型。 */
function ExpressionPreview({ group, value }: { group: QueryResultFilterGroup; value: QueryResultPresetValue }) {
  return <ul><li><strong>{group.mode === 'AND' ? filterText.and : filterText.or}</strong>{!group.children.length && <span> · {text.noFilters}</span>}<ul>{group.children.map((node, index) => 'children' in node ? <li key={index}><ExpressionPreview group={node} value={value}/></li> : <li key={index}>
    {node.enabled === false && <strong>{text.disabled} · </strong>}{value.columns.find(column => column.key === node.column)?.name || node.column} · {filterText.operators[node.operator]}
    {node.values ? <span> [{node.values.map(item => JSON.stringify(item)).join(', ')}]</span> : node.upper !== undefined ? <span> {JSON.stringify(node.value)} ～ {JSON.stringify(node.upper)}</span> : node.value !== '' ? <span> {JSON.stringify(node.value)}</span> : null}
    {node.ignoreCase && <span> · {text.ignoreCase}</span>}
  </li>)}</ul></li></ul>;
}

/** 命名方案仅调用本地配置IPC；来源失效、关闭或旧草稿后的迟到回包不能应用到别的结果。 */
export function QueryResultPresetsDialog({ connectionId, value, owner, isCurrent, matches, onApply, onClose }: {
  connectionId: string; value: QueryResultPresetValue; owner: string; isCurrent(): boolean; matches(value: QueryResultPresetValue): boolean; onApply(value: QueryResultPresetValue): void; onClose(): void;
}) {
  const [snapshot, setSnapshot] = useState<QueryResultPresetSnapshot>(), snapshotRef = useRef(snapshot);
  const [draft, setDraft] = useState({ selected: '', name: '' }), draftRef = useRef(draft);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [needsRefresh, setNeedsRefresh] = useState(false);
  const needsRefreshRef = useRef(false);
  const alive = useRef(true), invalid = useRef(false), operation = useRef<object | undefined>(undefined);
  /** 首次来源失效后不复活；同步草稿/快照身份拒绝快速双击及旧渲染回调。 */
  function current(expected?: QueryResultPresetSnapshot, expectedDraft?: typeof draft): boolean {
    if (!alive.current || invalid.current) return false;
    let valid = false; try { valid = isCurrent() === true; } catch {}
    if (!valid) invalid.current = true;
    return valid && (!expected || snapshotRef.current === expected) && (!expectedDraft || draftRef.current === expectedDraft);
  }
  /** 列表和所有成功变更完整校验回包，原token与修订被新快照替换，不拼接本地成功结果。 */
  function install(next: QueryResultPresetSnapshot, selected: string, name?: string) {
    snapshotRef.current = next; setSnapshot(next);
    const entry = next.entries.find(item => item.id === selected), nextDraft = { selected: entry?.id ?? '', name: name ?? entry?.name ?? draftRef.current.name };
    draftRef.current = nextDraft; setDraft(nextDraft); needsRefreshRef.current = false; setNeedsRefresh(false); setError('');
  }
  /** 刷新是显式只读请求，不重放可能已经成功的保存或删除。 */
  async function load() {
    if (!current() || operation.current) return;
    const token = {}; operation.current = token; setBusy(true);
    try {
      const next = queryResultPresetSnapshotSchema.parse(await invoke('result.presets.list', { connectionId }));
      if (operation.current === token && current()) install(next, draftRef.current.selected);
    } catch (reason) { if (operation.current === token && current()) { needsRefreshRef.current = true; setError(errorMessage(reason)); setNeedsRefresh(true); } }
    finally { if (operation.current === token) { operation.current = undefined; if (alive.current) setBusy(false); } }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; operation.current = undefined; }; }, []);
  /** 字段变化立即替换草稿引用，旧保存/覆盖按钮不能读到后来输入的名称。 */
  function change(next: typeof draft) { if (current(snapshot, draft) && !operation.current) { draftRef.current = next; setDraft(next); } }
  const selected = snapshot?.entries.find(item => item.id === draft.selected), valid = current();
  const name = draft.name.trim(), validName = name.length > 0 && name.length <= queryResultPresetLimits.name && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
  const duplicate = snapshot?.entries.some(entry => entry.name === name && entry.id !== selected?.id);
  const connectionMatches = !!selected && selected.connectionDigest === snapshot?.source.connectionDigest;
  const valueMatches = !!selected && matches(selected.value);
  const writable = valid && !busy && !needsRefresh && !!snapshot;
  /** 所有变更携带所见修订与Main令牌，失败强制显式刷新，不把网络/退出错误当可重试成功。 */
  async function mutate(kind: 'create' | 'overwrite' | 'rename' | 'delete') {
    if (!snapshot || !writable || needsRefreshRef.current || operation.current || !current(snapshot, draft) || kind !== 'delete' && !validName || kind !== 'create' && !selected) return;
    const token = {}; operation.current = token; setBusy(true); setError('');
    const scope = { connectionId, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken };
    try {
      const response = kind === 'delete' ? await invoke('result.presets.delete', { ...scope, id: selected!.id })
        : kind === 'rename' ? await invoke('result.presets.rename', { ...scope, id: selected!.id, name })
        : await invoke('result.presets.save', { ...scope, name, value: queryResultPresetValueSchema.parse(value), ...(kind === 'overwrite' ? { replaceId: selected!.id } : {}) });
      const next = queryResultPresetSnapshotSchema.parse(response);
      if (operation.current === token && current(snapshot, draft)) install(next, kind === 'create' ? next.entries.find(entry => entry.name === name)?.id ?? '' : kind === 'delete' ? '' : selected!.id, kind === 'delete' ? '' : name);
    } catch (reason) { if (operation.current === token && current(snapshot, draft)) { needsRefreshRef.current = true; setError(errorMessage(reason)); setNeedsRefresh(true); } }
    finally { if (operation.current === token) { operation.current = undefined; if (alive.current) setBusy(false); } }
  }
  /** Main重新核存储来源，父结果再完整试算，成功后父组件统一关闭并发布；不投递SQL。 */
  async function apply() {
    if (!snapshot || !selected || !writable || needsRefreshRef.current || !connectionMatches || !valueMatches || operation.current || !current(snapshot, draft)) return;
    const token = {}; operation.current = token; setBusy(true); setError('');
    try {
      const next = queryResultPresetValueSchema.parse(await invoke('result.presets.read', { connectionId, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken, id: selected.id }));
      if (operation.current === token && current(snapshot, draft)) onApply(next);
    } catch (reason) { if (operation.current === token && current(snapshot, draft)) { needsRefreshRef.current = true; setError(errorMessage(reason)); setNeedsRefresh(true); } }
    finally { if (operation.current === token) { operation.current = undefined; if (alive.current) setBusy(false); } }
  }
  /** 请求未结算时保留窗口；导航/卸载仍会撤销所有迟到回调。 */
  function close() { if (!operation.current) onClose(); }
  return <div data-query-result-presets-owner={owner}><Modal title={text.title} onClose={close} wide><div className="modal-content query-result-presets">
    <p>{text.scope}</p><p className="muted small">{text.hint} {text.current}：{text.summary(value.columns.length, value.visible.length)}</p>
    <label>{text.choose}<select aria-label={text.choose} value={draft.selected} disabled={!valid || busy} onChange={event => { const entry = snapshot?.entries.find(item => item.id === event.target.value); change({ selected: entry?.id ?? '', name: entry?.name ?? '' }); }}><option value="">{text.placeholder}</option>{snapshot?.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    <label>{text.name}<input aria-label={text.name} maxLength={queryResultPresetLimits.name} disabled={!valid || busy} value={draft.name} onChange={event => change({ ...draft, name: event.target.value })}/></label>
    {!snapshot?.entries.length && !busy && !error && <p>{text.empty}</p>}
    <div className="query-result-preset-actions"><button disabled={!valid || busy} onClick={() => void load()}>{text.refresh}</button><button disabled={!writable || !validName || snapshot?.entries.some(entry => entry.name === name)} onClick={() => void mutate('create')}>{text.create}</button><button disabled={!writable || !selected || !validName || duplicate} onClick={() => void mutate('overwrite')}>{text.overwrite}</button><button disabled={!writable || !selected || !validName || duplicate || name === selected.name} onClick={() => void mutate('rename')}>{text.rename}</button><button disabled={!writable || !selected} onClick={() => void mutate('delete')}>{text.remove}</button></div>
    {selected && <section className="query-result-preset-preview" aria-label={text.preview}><strong>{selected.name} · {text.summary(selected.value.columns.length, selected.value.visible.length)}</strong><h3>{text.filters}</h3><ExpressionPreview group={selected.value.configuration.expression} value={selected.value}/><h3>{text.sort}</h3>{selected.value.configuration.sort.length ? <ol>{selected.value.configuration.sort.map((rule, index) => <li key={index}>{selected.value.columns.find(column => column.key === rule.column)?.name || rule.column} · {rule.direction === 'ASC' ? text.asc : text.desc} · {rule.nulls === 'FIRST' ? text.nullFirst : rule.nulls === 'LAST' ? text.nullLast : text.nullDefault}{rule.ignoreCase && ` · ${text.ignoreCase}`}</li>)}</ol> : <p>{text.noSort}</p>}</section>}
    {selected && !connectionMatches && <ErrorBox message={text.connectionChanged}/>} {selected && !valueMatches && <ErrorBox message={text.mismatch}/>} {!valid && <ErrorBox message={text.stale}/>}<ErrorBox message={error}/>{needsRefresh && <p>{text.refreshNeeded}</p>}{busy && <Spinner text={text.working}/>}
  </div><footer className="modal-footer"><span className="grow"/><button disabled={busy} onClick={close}>{zh.common.close}</button><button className="primary" disabled={!writable || !selected || !connectionMatches || !valueMatches} onClick={() => void apply()}>{text.apply}</button></footer></Modal></div>;
}
