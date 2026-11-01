import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sqliteTablePresetSaveSchema, sqliteTablePresetSelectSchema, sqliteTablePresetSnapshotSchema, validateSqlitePresetColumns, type SqliteTablePresetQuery, type SqliteTablePresetTarget, type SqliteTablePresetSnapshot, type SqliteTablePresetSave, type SqliteTablePresetSelect } from '../../shared/sqliteTablePresets';
import { sqliteTablePresetsZh as text } from '../locales/sqliteTablePresets.zh-CN';
import { invoke, errorMessage } from '../lib';
import { ErrorBox } from './ui';

export interface SqliteTablePresetServices {
  list(target: SqliteTablePresetTarget): Promise<SqliteTablePresetSnapshot>;
  save(input: SqliteTablePresetSave): Promise<SqliteTablePresetSnapshot>;
  remove(input: SqliteTablePresetSelect): Promise<SqliteTablePresetSnapshot>;
  read(input: SqliteTablePresetSelect): Promise<SqliteTablePresetQuery>;
}
interface Props { scope: object; target: SqliteTablePresetTarget; columns: readonly string[]; draftKey: string; current(): boolean; configuration(): SqliteTablePresetQuery; onLoad(query: SqliteTablePresetQuery): boolean; services?: SqliteTablePresetServices; }
interface Owner { scope: object; api: SqliteTablePresetServices; key: string; valid: boolean; busy: boolean; }
const services: SqliteTablePresetServices = { list: target => invoke('sqlite.tablePresets.list', target), save: input => invoke('sqlite.tablePresets.save', input), remove: input => invoke('sqlite.tablePresets.delete', input), read: input => invoke('sqlite.tablePresets.read', input) };

/** 方案只操作本机配置；所有异步回包绑定原页，载入不自动应用也不丢数据草稿。 */
export function SqliteTablePresetPanel(props: Props) {
  const api = props.services ?? services, latest = useRef(props); latest.current = props;
  const alive = useRef(false), owner = useRef<Owner | undefined>(undefined), render = {}, committed = useRef<object | undefined>(undefined);
  const draftGeneration = useRef(0), lastDraft = useRef(props.draftKey);
  const [snapshot, setSnapshot] = useState<SqliteTablePresetSnapshot>(), [selected, setSelected] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const key = JSON.stringify([props.target, props.columns]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; if (owner.current) owner.current.valid = false; }; }, []);
  useLayoutEffect(() => { committed.current = render; return () => { if (committed.current === render) committed.current = undefined; }; });
  // 用户改完又改回也算新草稿代次，旧载入请求不能借表单ABA覆盖。
  useLayoutEffect(() => { if (lastDraft.current !== props.draftKey) { lastDraft.current = props.draftKey; draftGeneration.current++; } }, [props.draftKey]);
  /** 当前页面门每次重新核对，已观察失效不能借目标ABA复活；刷新可显式领取新代。 */
  function baseCurrent(value: Owner): boolean {
    try { return alive.current && value.scope === latest.current.scope && value.api === (latest.current.services ?? services) && value.key === JSON.stringify([latest.current.target, latest.current.columns]) && latest.current.current(); } catch { return false; }
  }
  function current(value: Owner): boolean { if (!value.valid || owner.current !== value) return false; if (!baseCurrent(value)) value.valid = false; return value.valid; }
  /** 只允许当前已提交控件启动；busy在同一调用栈先占有，不能重复保存或消费旧选项。 */
  function eventCurrent(): Owner | undefined { const value = owner.current; return committed.current === render && value && current(value) && !value.busy ? value : undefined; }
  /** 回包目标必须精确匹配原页；数量、版本、typed条件及令牌均复用严格合同。 */
  function checkSnapshot(raw: unknown, value: Owner): SqliteTablePresetSnapshot {
    const result = sqliteTablePresetSnapshotSchema.parse(raw);
    if (JSON.stringify(result.target) !== JSON.stringify(latest.current.target) || !current(value)) throw Error(text.changed);
    return result;
  }
  /** 显式本机刷新不碰数据库；换代撤销旧请求交付权，保留同目标名称输入。 */
  async function reload(): Promise<void> {
    if (owner.current?.valid && owner.current.busy || !alive.current) return;
    const value: Owner = { scope: latest.current.scope, api, key: JSON.stringify([latest.current.target, latest.current.columns]), valid: true, busy: true };
    if (!baseCurrent(value)) return;
    if (owner.current) owner.current.valid = false; owner.current = value; setBusy(true); setSnapshot(undefined); setSelected(''); setError(''); setNotice('');
    try { const result = await api.list({ ...latest.current.target }); if (current(value)) setSnapshot(checkSnapshot(result, value)); }
    catch (reason) { if (current(value)) setError(errorMessage(reason)); }
    finally { value.busy = false; if (current(value)) setBusy(false); }
  }
  useEffect(() => { if (owner.current) owner.current.valid = false; void reload(); const value = owner.current; return () => { if (value) value.valid = false; }; }, [props.scope, key, api]);
  /** 请求携带所见修订与真实Main来源；不以选中ID或同名项绕过CAS。 */
  function packet(value: Owner) {
    if (!snapshot || !current(value)) throw Error(text.stale);
    return { ...latest.current.target, expectedRevision: snapshot.revision, source: snapshot.source, bindingToken: snapshot.bindingToken };
  }
  /** 保存捕获提交时的有效表单，成功只更新方案列表，绝不将回包写回条件或数据。 */
  async function save(replace: boolean): Promise<void> {
    const value = eventCurrent(); if (!value) return;
    value.busy = true; setBusy(true);
    try {
      const entry = snapshot?.entries.find(entry => entry.id === selected); if (replace && !entry) throw Error(text.missing);
      const input = sqliteTablePresetSaveSchema.parse({ ...packet(value), name: replace ? entry!.name : name, query: latest.current.configuration(), ...(replace ? { replaceId: entry!.id } : {}) });
      if (replace && !window.confirm(text.confirmReplace(input.name)) || !current(value)) return;
      setError(''); setNotice('');
      const result = await api.save(input);
      if (current(value)) { const next = checkSnapshot(result, value); setSnapshot(next); setSelected(next.entries.find(entry => entry.name === input.name)?.id ?? ''); setNotice(text.saved); }
    } catch (reason) { if (current(value)) setError(errorMessage(reason)); }
    finally { value.busy = false; if (current(value)) setBusy(false); }
  }
  /** 载入只原子填写条件草稿；等待期间用户编辑了表单，则整份拒绝覆盖。 */
  async function load(): Promise<void> {
    const value = eventCurrent(); if (!value) return;
    value.busy = true; setBusy(true);
    try {
      const input = sqliteTablePresetSelectSchema.parse({ ...packet(value), id: selected }), before = latest.current.draftKey, generation = draftGeneration.current;
      setError(''); setNotice('');
      const result = await api.read(input); if (!current(value)) return;
      const query = validateSqlitePresetColumns(result, latest.current.columns);
      if (generation !== draftGeneration.current || before !== latest.current.draftKey || !latest.current.onLoad(query)) throw Error(text.changed);
      if (current(value)) setNotice(text.loaded);
    } catch (reason) { if (current(value)) setError(errorMessage(reason)); }
    finally { value.busy = false; if (current(value)) setBusy(false); }
  }
  /** 删除仅移除本机所选方案，须确认，当前条件及未提交数据保持。 */
  async function remove(): Promise<void> {
    const value = eventCurrent(); if (!value) return;
    value.busy = true; setBusy(true);
    try {
      const entry = snapshot?.entries.find(entry => entry.id === selected); if (!entry) throw Error(text.missing);
      const input = sqliteTablePresetSelectSchema.parse({ ...packet(value), id: entry.id }); if (!window.confirm(text.confirmRemove(entry.name)) || !current(value)) return;
      setError(''); setNotice(''); const result = await api.remove(input);
      if (current(value)) { setSnapshot(checkSnapshot(result, value)); setSelected(''); setNotice(text.removed); }
    } catch (reason) { if (current(value)) setError(errorMessage(reason)); }
    finally { value.busy = false; if (current(value)) setBusy(false); }
  }
  const value = owner.current, valid = !!value && current(value), disabled = busy || !valid, entry = snapshot?.entries.find(entry => entry.id === selected);
  return <fieldset className="sqlite-table-presets" aria-label={text.title}><legend>{text.title}</legend><p className="muted small">{text.scope}</p><strong>{props.target.database}.{props.target.table}</strong>
    <div className="toolbar sqlite-preset-controls"><button disabled={!!value?.valid && value.busy} onClick={() => { if (committed.current === render) void reload(); }}>{text.reload}</button>
      <select aria-label={text.selection} disabled={disabled || !snapshot} value={selected} onChange={event => { if (!eventCurrent()) return; setSelected(event.target.value); const chosen = snapshot?.entries.find(entry => entry.id === event.target.value); if (chosen) setName(chosen.name); }}><option value="">{text.placeholder}</option>{snapshot?.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.connectionDigest !== snapshot.source.connectionDigest ? text.staleEntry : ''}</option>)}</select>
      <input aria-label={text.name} disabled={disabled} value={name} maxLength={80} onChange={event => { if (eventCurrent()) setName(event.target.value); }}/>
      <button disabled={disabled || !snapshot} onClick={() => { void save(false); }}>{text.save}</button><button disabled={disabled || !entry} onClick={() => { void save(true); }}>{text.replace}</button>
      <button disabled={disabled || !entry} onClick={() => { void load(); }}>{text.load}</button><button disabled={disabled || !entry} onClick={() => { void remove(); }}>{text.remove}</button>
    </div>{busy && valid && <p role="status">{text.busy}</p>}{!valid && !busy && <p role="status">{text.stale}</p>}{snapshot && !snapshot.entries.length && <p>{text.empty}</p>}{notice && <p role="status">{notice}</p>}<ErrorBox message={error}/>
  </fieldset>;
}
