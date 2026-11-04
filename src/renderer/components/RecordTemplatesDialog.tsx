import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { recordTemplateContentSchema, recordTemplateSnapshotSchema, recordTemplateLimits, type RecordTemplateContent, type RecordTemplateSnapshot, type RecordTemplateTarget } from '../../shared/recordTemplates';
import { errorMessage, invoke } from '../lib';
import { recordTemplatesZh as text } from '../locales/recordTemplates.zh-CN';
import { recordTemplateValueSummary, validateRecordTemplate, type RecordTemplateCandidate, type RecordTemplateColumn, type RecordTemplateLease } from '../recordTemplates';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, UsageHelp } from './ui';

const services = {
  list: (input: RecordTemplateTarget) => invoke('record.templates.list', input),
  save: (input: Parameters<typeof invoke<'record.templates.save'>>[1]) => invoke('record.templates.save', input),
  rename: (input: Parameters<typeof invoke<'record.templates.rename'>>[1]) => invoke('record.templates.rename', input),
  remove: (input: Parameters<typeof invoke<'record.templates.delete'>>[1]) => invoke('record.templates.delete', input),
  read: (input: Parameters<typeof invoke<'record.templates.read'>>[1]) => invoke('record.templates.read', input),
};
interface Props { lease: RecordTemplateLease; target: RecordTemplateTarget; dialect: RecordTemplateContent['dialect']; columns: readonly RecordTemplateColumn[]; candidate?: RecordTemplateCandidate; onStage(content: RecordTemplateContent, copies: number): void; onClose(): void; services?: typeof services; }

/** 模板管理只访问本机配置，所有新增仍由父页准确租约和原草稿账本原子发布。 */
export function RecordTemplatesDialog(props: Props) {
  const { lease, target, dialect, columns, candidate, onStage, onClose } = props, api = props.services ?? services;
  const [snapshot, setSnapshot] = useState<RecordTemplateSnapshot>(), [selected, setSelected] = useState(''), [name, setName] = useState(''), [search, setSearch] = useState('');
  const [fields, setFields] = useState<ReadonlySet<string>>(new Set()), [preview, setPreview] = useState<RecordTemplateContent>(), [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(false), pending = useRef(false), submitted = useRef(false), request = useRef(0), operation = useRef<object | undefined>(undefined), committed = useRef<object | undefined>(undefined), render = {};
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useLayoutEffect(() => { committed.current = render; return () => { if (committed.current === render) committed.current = undefined; }; });
  const current = () => alive.current && lease.current();
  const eventCurrent = () => committed.current === render && current() && !pending.current && !submitted.current;
  const [, refreshValidity] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    // 即使外来模态在同一批观察记录前又移除，addedNodes仍留下撤权事实，不能ABA复活。
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element, dialogs = [...element.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        if (['dialog', 'alertdialog'].includes(element.getAttribute('role') ?? '')) dialogs.push(element);
        if (dialogs.some(dialog => dialog.querySelector('[data-record-template-owner]')?.getAttribute('data-record-template-owner') !== lease.id)) lease.invalidate();
      }
      if (alive.current && !lease.current()) refreshValidity(value => value + 1);
    });
    observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();
  }, [lease]);
  /** 回包只可更新原目标，不能用同名库表或旧连接来源覆写当前管理器。 */
  function accept(raw: unknown): RecordTemplateSnapshot {
    const next = recordTemplateSnapshotSchema.parse(raw);
    if (!current() || [next.target.connectionId, next.target.database, next.target.table].some((value, index) => value !== [target.connectionId, target.database, target.table][index]) || next.source.dialect !== dialect) throw Error(text.stale);
    return next;
  }
  /** busy先在同一调用栈占有，双击或旧渲染按钮不能发送第二次本机写入。 */
  async function run(action: () => Promise<void>): Promise<void> {
    if (!eventCurrent()) return;
    const token = {}; operation.current = token; pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { if (operation.current === token) { operation.current = undefined; pending.current = false; if (current()) setBusy(false); } }
  }
  /** 显式刷新重新领取CAS来源；不读取数据库、不改原数据或所选字段。 */
  async function reload(): Promise<void> {
    const own = ++request.current; setPreview(undefined);
    const next = await api.list(target); if (own !== request.current || !current()) return;
    setSnapshot(accept(next)); setSelected('');
  }
  useEffect(() => {
    if (current()) void run(reload);
    return () => { request.current++; operation.current = undefined; pending.current = false; };
  }, [lease, api]);
  /** 每次动作都携带所见修订与Main签发来源，原值只在显式预览后领取。 */
  function packet() {
    if (!snapshot || !current()) throw Error(text.stale);
    return { ...target, expectedRevision: snapshot.revision, source: snapshot.source, bindingToken: snapshot.bindingToken };
  }
  /** 仅保存明确选择的字段，覆盖必须再次确认且不能借旧来源。 */
  async function save(replace: boolean): Promise<void> {
    if (!candidate || !fields.size) throw Error(text.choose);
    const chosen = candidate.fields.filter(field => fields.has(field.name));
    if (chosen.length !== fields.size || chosen.some(field => !field.value)) throw Error(text.choose);
    const content = validateRecordTemplate({ version: 1, dialect, fields: chosen.map(({ name, signature, value }) => ({ name, signature, value })) }, dialect, columns);
    const entry = snapshot?.entries.find(entry => entry.id === selected);
    if (replace && (!entry || !window.confirm(text.replaceConfirm(entry.name)) || !current())) return;
    const next = await api.save({ ...packet(), name: replace ? entry!.name : name, content, ...(replace ? { replaceId: entry!.id } : {}) });
    if (!current()) return;
    const accepted = accept(next); setSnapshot(accepted); setSelected(accepted.entries.find(entry => entry.name === (replace ? entry!.name : name))?.id ?? ''); setPreview(undefined); setNotice(text.saved);
  }
  /** 改名携带当前CAS，不改字段值或生成记录草稿。 */
  async function rename(): Promise<void> {
    if (!selected) return;
    const next = await api.rename({ ...packet(), id: selected, name }); if (!current()) return;
    setSnapshot(accept(next)); setPreview(undefined); setNotice(text.renamed);
  }
  /** 明确确认后只删除本机模板，取消时不发送写入。 */
  async function remove(): Promise<void> {
    const entry = snapshot?.entries.find(entry => entry.id === selected);
    if (!entry || !window.confirm(text.removeConfirm(entry.name)) || !current()) return;
    const next = await api.remove({ ...packet(), id: entry.id }); if (!current()) return;
    setSnapshot(accept(next)); setSelected(''); setPreview(undefined); setNotice(text.removed);
  }
  /** 预览整份校验成功才可发布，结构变化时保留原数据且不尝试自动映射或转换。 */
  async function read(): Promise<void> {
    if (!selected) return;
    const next = await api.read({ ...packet(), id: selected }); if (!current()) return;
    setPreview(validateRecordTemplate(recordTemplateContentSchema.parse(next), dialect, columns));
  }
  /** 最终暂存同步消费来源；父页原预算和一次性意图失败时不会产生部分新增。 */
  function stage(): void {
    if (!eventCurrent() || !preview || !/^[1-9][0-9]{0,2}$/.test(count) || Number(count) > recordTemplateLimits.copies) return;
    try { const content = validateRecordTemplate(preview, dialect, columns); submitted.current = true; onStage(content, Number(count)); }
    catch (reason) { submitted.current = false; if (current()) setError(errorMessage(reason)); }
  }
  const valid = lease.current(), disabled = busy || !valid, entry = snapshot?.entries.find(entry => entry.id === selected), needle = search.trim().toLocaleLowerCase();
  const matches = candidate?.fields.filter(field => field.name.toLocaleLowerCase().includes(needle)) ?? [];
  return <Modal title={text.title} onClose={onClose} wide><div className="modal-content" data-record-template-owner={lease.id}>
    <UsageHelp><p>{text.scope}</p><p>{text.draft}</p></UsageHelp><p>{target.database} / {target.table}</p>
    <div className="toolbar" style={{ flexWrap: 'wrap' }}><button disabled={disabled} onClick={() => { void run(reload); }}>{text.reload}</button>
      <label>{text.list}<select aria-label={text.list} value={selected} disabled={disabled || !snapshot} onChange={event => { if (!eventCurrent()) return; setSelected(event.target.value); setPreview(undefined); const entry = snapshot?.entries.find(entry => entry.id === event.target.value); if (entry) setName(entry.name); }}><option value="">{text.list}</option>{snapshot?.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <input aria-label={text.name} placeholder={text.name} maxLength={80} value={name} disabled={disabled} onChange={event => { if (eventCurrent()) setName(event.target.value); }}/>
      <button disabled={disabled || !entry || !entry.sourceCurrent} onClick={() => { void run(read); }}>{text.preview}</button><button disabled={disabled || !entry || !name.trim()} onClick={() => { void run(rename); }}>{text.rename}</button><button disabled={disabled || !entry} onClick={() => { void run(remove); }}>{text.remove}</button>
    </div>{!snapshot?.entries.length && <p>{text.empty}</p>}{entry && !entry.sourceCurrent && <p role="status">{text.sourceChanged}</p>}
    <details open><summary>{text.capture}</summary>{candidate ? <><input type="search" aria-label={text.search} value={search} disabled={disabled} onChange={event => { if (eventCurrent()) setSearch(event.target.value); }}/><div style={{ maxHeight: '25vh', overflowY: 'auto' }}>{matches.map(field => <label key={field.name} style={{ display: 'block', margin: '8px 0', overflowWrap: 'anywhere' }}><input type="checkbox" aria-label={text.field(field.name)} checked={fields.has(field.name)} disabled={disabled || !field.value} onChange={event => { if (!eventCurrent()) return; const checked = event.target.checked; setFields(previous => { const next = new Set(previous); if (checked) next.add(field.name); else next.delete(field.name); return next; }); }}/><strong>{field.name}</strong><small> · {field.value ? recordTemplateValueSummary(field.value) : field.unavailable}</small></label>)}{!matches.length && <p>{text.noFields}</p>}</div><div className="toolbar"><button disabled={disabled || !snapshot || !fields.size || !name.trim()} onClick={() => { void run(() => save(false)); }}>{text.save}</button><button disabled={disabled || !entry || !fields.size} onClick={() => { void run(() => save(true)); }}>{text.replace}</button></div></> : <p>{text.noSource}</p>}</details>
    {preview ? <section aria-label={text.preview}><h3>{text.preview} · {entry?.name}</h3><div style={{ maxHeight: '25vh', overflowY: 'auto' }}>{preview.fields.map(field => <p key={field.name} style={{ overflowWrap: 'anywhere' }}><strong>{field.name}</strong> · {recordTemplateValueSummary(field.value)}</p>)}</div></section> : <p className="muted small">{text.noPreview}</p>}
    {busy && valid && <p role="status">{text.busy}</p>}{!valid && <p role="alert">{text.stale}</p>}{notice && <p role="status">{notice}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button onClick={onClose}>{zh.common.close}</button><span className="grow"/><label>{text.copies}<input type="number" aria-label={text.copies} min={1} max={100} value={count} disabled={disabled} onChange={event => { if (eventCurrent()) setCount(event.target.value); }}/></label><button className="primary" disabled={disabled || !preview || !/^[1-9][0-9]{0,2}$/.test(count) || Number(count) > 100} onClick={stage}>{text.stage}</button></footer></Modal>;
}
