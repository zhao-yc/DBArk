import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { buildForeignKeyJoin, foreignKeyJoinChoices, foreignKeyJoinMetadataKey } from '../tableForeignKeyJoin';
import { foreignKeyJoinPreview, revalidateForeignKeyJoin, type ForeignKeyJoinPreview, type ForeignKeyJoinTarget, TableForeignKeyJoinIntent } from '../tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

export interface TableForeignKeyJoinServices { read(input: ForeignKeyJoinTarget & { taskId: string }): Promise<TableInfo>; cancel(taskId: string): Promise<unknown>; }
/** 每次正式元数据读取均持有独立任务编号；取消不借普通查询或复用数据库会话。 */
export const tableForeignKeyJoinServices: TableForeignKeyJoinServices = { read: input => invoke('metadata.table', input), cancel: taskId => invoke('query.cancel', { taskId }) };
interface Selection { fk: string; kind: 'LEFT' | 'INNER'; child: string[]; parent: string[]; childSearch: string; parentSearch: string; childPage: number; parentPage: number; }
interface Operation { promise: Promise<void>; cancelled: boolean; read?: { taskId: string; cancelPromise?: Promise<unknown> }; cancellation?: Promise<unknown>; }
const pageSize = 50;

/** 一次原读取和最新本地选择共用占门；不持有任何父页行数据或执行SQL的能力。 */
export function TableForeignKeyJoinDialog({ intent, onOpen, onClose, onActivity, onCleanupError, services = tableForeignKeyJoinServices }: {
  intent: TableForeignKeyJoinIntent; onOpen(preview: ForeignKeyJoinPreview): boolean; onClose(): void;
  onActivity(delta: 1 | -1): void; onCleanupError(message: string): void; services?: TableForeignKeyJoinServices;
}) {
  const origin = useRef({ intent, services, onActivity }).current;
  if (origin.intent !== intent || origin.services !== services) origin.intent.invalidate();
  const choices = useMemo(() => foreignKeyJoinChoices(origin.intent.source), [origin.intent]);
  const [selection, setSelection] = useState<Selection>(() => ({ fk: choices[0]?.name ?? '', kind: 'LEFT', child: origin.intent.source.columns.map(column => column.name), parent: [], childSearch: '', parentSearch: '', childPage: 1, parentPage: 1 }));
  const selectionRef = useRef(selection), [parent, setParent] = useState<{ fk: string; info: TableInfo }>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [invalid, setInvalid] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), closingRef = useRef(false), operation = useRef<Operation | null>(null), revision = useRef(0), consumed = useRef(false), committed = useRef<object | null>(null), ticket = {};
  const cleanupError = useRef(onCleanupError), closeCallback = useRef(onClose); cleanupError.current = onCleanupError; closeCallback.current = onClose;
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  /** 当前渲染和原来源同时有效；本组件自己的占用由父页精确owner租约认可。 */
  function current(): boolean {
    if (!alive.current || closingRef.current || consumed.current || origin.intent !== intent || origin.services !== services || !origin.intent.current()) return false;
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialogs.length !== 1 || dialogs[0].getAttribute('aria-label') !== text.title || document.querySelector('[role="alertdialog"]')) { origin.intent.invalidate(); return false; }
    return true;
  }
  function rendered(): boolean { return committed.current === ticket && selectionRef.current === selection; }
  function editable(): boolean { return current() && rendered() && !operation.current; }
  const choice = choices.find(value => value.name === selection.fk);
  const preview = useMemo(() => {
    if (!parent || parent.fk !== selection.fk) return { value: undefined, error: '' };
    try { return { value: foreignKeyJoinPreview(origin.intent, parent.info, selection.fk, selection.kind, { childColumns: selection.child, parentColumns: selection.parent }), error: '' }; }
    catch (reason) { return { value: undefined, error: errorMessage(reason) }; }
  }, [origin.intent, parent, selection]);
  const aliases = useMemo(() => {
    if (!preview.value) return new Map<string, string>();
    return new Map(buildForeignKeyJoin(origin.intent.source, preview.value.parent, preview.value.foreignKey, preview.value.kind, origin.intent.limit, preview.value.options).columns.map(column => [JSON.stringify([column.side, column.column]), column.alias]));
  }, [origin.intent, preview.value]);

  /** 只取消原当前任务一次；ACK和真实读取都属于原operation，不能ACK先释放占用。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.cancelled) return;
    active.cancelled = true; revision.current++;
    if (active.read) {
      const read = active.read;
      read.cancelPromise = Promise.resolve().then(() => origin.services.cancel(read.taskId));
      active.cancellation = read.cancelPromise; void read.cancelPromise.catch(() => undefined);
    }
    if (alive.current) setMessage(text.cancelling);
  }
  /** 每步先登记原taskId再发送；切FK、关闭或来源变化后不启动后续结构读取。 */
  async function read(active: Operation, target: ForeignKeyJoinTarget, owns: () => boolean): Promise<TableInfo> {
    if (!owns()) throw Error(text.stale);
    const request = { taskId: uid() }; active.read = request;
    try { return await origin.services.read({ ...target, taskId: request.taskId }); }
    finally { if (active.read === request) active.read = undefined; }
  }
  /** 同步占门后才排原异步链，按钮连点和旧DOM均不能建立第二个在途操作。 */
  function run(kind: 'preview' | 'open'): void {
    if (!editable() || !choice || kind === 'open' && !preview.value) return;
    const selected = selection, generation = ++revision.current, receipt = preview.value;
    let active: Operation;
    const owns = () => current() && operation.current === active && !active.cancelled && generation === revision.current && selectionRef.current === selected;
    active = { promise: Promise.resolve(), cancelled: false }; operation.current = active;
    try { origin.onActivity(1); } catch (reason) { operation.current = null; setError(errorMessage(reason)); return; }
    setBusy(true); setError(''); setMessage(kind === 'open' ? text.checking : text.parentLoading);
    active.promise = Promise.resolve().then(async () => {
      if (!owns()) return;
      if (kind === 'preview') {
        const metadata = await read(active, { connectionId: origin.intent.connectionId, database: choice.referencedDatabase, table: choice.referencedTable }, owns);
        if (!owns()) return;
        // 用单列小输出验证关系与真实父目标；默认宽表超预算时仍允许用户精简选列。
        const metadataKey = foreignKeyJoinMetadataKey(metadata), previous = parent?.fk === selected.fk ? parent : undefined;
        // 同一关系重读只核结构，不重置用户选列；结构变化必须重新打开，不能重签旧意图。
        if (previous && foreignKeyJoinMetadataKey(previous.info) !== metadataKey) { origin.intent.invalidate(); throw Error(text.stale); }
        buildForeignKeyJoin(origin.intent.source, metadata, selected.fk, selected.kind, origin.intent.limit, { childColumns: [origin.intent.source.columns[0].name], parentColumns: [] });
        const next = { ...selected, parent: previous ? selected.parent : metadata.columns.map(column => column.name), parentSearch: previous ? selected.parentSearch : '', parentPage: previous ? selected.parentPage : 1 };
        selectionRef.current = next; setSelection(next); setParent({ fk: selected.fk, info: structuredClone(metadata) });
      } else {
        await revalidateForeignKeyJoin(origin.intent, receipt!, target => read(active, target, owns), owns);
        if (!owns()) return;
        if (!onOpen(receipt!)) throw Error(text.stale);
        consumed.current = true;
      }
    }).catch(reason => { if (alive.current && !closingRef.current && operation.current === active && generation === revision.current) setError(errorMessage(reason)); }).finally(async () => {
      try { if (active.cancellation) await active.cancellation; }
      catch (reason) { cleanupError.current(errorMessage(reason)); }
      finally { if (operation.current === active) operation.current = null; origin.onActivity(-1); if (alive.current) { setBusy(false); setMessage(''); } }
    });
  }
  /** FK改变立即撤销旧父回执，取消仅本地原任务；原Promise收尾前不并发读新FK。 */
  function changeForeignKey(value: string): void {
    if (!current() || !rendered() || !choices.some(item => item.name === value) || value === selection.fk) return;
    cancel(); revision.current++; setParent(undefined); setError('');
    const next = { ...selection, fk: value, child: origin.intent.source.columns.map(column => column.name), parent: [], parentSearch: '', childPage: 1, parentPage: 1 };
    selectionRef.current = next; setSelection(next);
  }
  /** 搜索只影响本地分页；字段变化后同步废弃旧打开闭包，未选字段不会改变JOIN条件。 */
  function revise(next: Selection): void { if (!editable()) return; revision.current++; selectionRef.current = next; setSelection(next); setError(''); }
  /** 关闭状态真实等待原读取与取消响应，不把局部卸载或取消ACK冒充服务器已收尾。 */
  function close(): void {
    if (!alive.current || closingRef.current || committed.current !== ticket) return;
    closingRef.current = true; revision.current++; setClosing(true); cancel();
    const active = operation.current;
    void (async () => { if (active) await active.promise; if (alive.current) { alive.current = false; closeCallback.current(); } })();
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = origin.intent.subscribe(() => { if (alive.current) { setInvalid(true); setParent(undefined); cancel(); } });
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { alive.current = false; revision.current++; unsubscribe(); cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const unavailable = invalid || !origin.intent.current() || closing || consumed.current;
  /** 每侧最多挂载50个字段，完整选择仍保留；默认全选和超预算错误不阻止精简。 */
  function fieldList(side: 'child' | 'parent', info: TableInfo): ReactNode {
    const searchKey = side === 'child' ? 'childSearch' : 'parentSearch', pageKey = side === 'child' ? 'childPage' : 'parentPage';
    const names = info.columns.map(column => column.name).filter(name => name.toLocaleLowerCase().includes(selection[searchKey].toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(names.length / pageSize)), page = Math.min(selection[pageKey], pages), selected = selection[side];
    return <fieldset disabled={busy || unavailable}><legend>{side === 'child' ? text.childFields : text.parentFields}</legend><p>{text.selected(selected.length, info.columns.length)}</p>
      <button disabled={busy || unavailable} onClick={() => revise({ ...selection, [side]: info.columns.map(column => column.name) })}>{text.allFields}</button><button disabled={busy || unavailable || !selected.length} onClick={() => revise({ ...selection, [side]: [] })}>{text.clearFields}</button>
      <label>{text.search}<input aria-label={side === 'child' ? text.childFields + text.search : text.parentFields + text.search} value={selection[searchKey]} maxLength={512} onChange={event => revise({ ...selection, [searchKey]: event.target.value, [pageKey]: 1 })}/></label>
      <div>{names.slice((page - 1) * pageSize, page * pageSize).map(name => <label key={name} style={{ display: 'block' }}><input type="checkbox" aria-label={side === 'child' ? text.childSelect(name) : text.parentSelect(name)} checked={selected.includes(name)} onChange={event => revise({ ...selection, [side]: event.target.checked ? [...selected, name] : selected.filter(value => value !== name) })}/>{name}{aliases.get(JSON.stringify([side, name])) && <> → {aliases.get(JSON.stringify([side, name]))}</>}</label>)}</div>
      <button disabled={busy || unavailable || page <= 1} onClick={() => revise({ ...selection, [pageKey]: page - 1 })}>{text.previous}</button><span>{text.page(page, pages)}</span><button disabled={busy || unavailable || page >= pages} onClick={() => revise({ ...selection, [pageKey]: page + 1 })}>{text.next}</button>
    </fieldset>;
  }
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" aria-busy={busy || closing}>
    <p>{text.scope}</p><p>{origin.intent.source.database}.{origin.intent.source.name} · {text.limit}：{origin.intent.limit}</p>
    <label>{text.fk}<select aria-label={text.fk} disabled={unavailable} value={selection.fk} onChange={event => changeForeignKey(event.target.value)}>{choices.map(item => <option key={item.name} value={item.name}>{item.name} → {item.referencedDatabase}.{item.referencedTable}</option>)}</select></label>
    <label>{text.joinKind}<select aria-label={text.joinKind} disabled={busy || unavailable} value={selection.kind} onChange={event => { if (event.target.value === 'LEFT' || event.target.value === 'INNER') revise({ ...selection, kind: event.target.value }); }}><option value="LEFT">{text.left}</option><option value="INNER">{text.inner}</option></select></label>
    <UsageHelp><p>{selection.kind === 'LEFT' ? text.leftHint : text.innerHint}</p><p>{text.relationship}</p><p>{text.aliases}</p></UsageHelp>{choice && <section aria-label={text.relationship}><ul>{choice.columns.map((name, index) => <li key={name}>{origin.intent.source.database}.{origin.intent.source.name}.{name} = {choice.referencedDatabase}.{choice.referencedTable}.{choice.referencedColumns[index]}</li>)}</ul></section>}
    {fieldList('child', origin.intent.source)}{parent && parent.fk === selection.fk && fieldList('parent', parent.info)}
    <ErrorBox message={unavailable && !closing ? text.stale : error || preview.error}/>{closing ? <p role="status">{text.closing}</p> : message && <Spinner text={message}/>}
    {preview.value && !unavailable && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.value.sql}</pre></section>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (rendered()) cancel(); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button><button disabled={busy || unavailable || !choice} onClick={() => run('preview')}>{text.preview}</button><button className="primary" disabled={busy || unavailable || !preview.value} onClick={() => run('open')}>{text.open}</button></footer></Modal>;
}
