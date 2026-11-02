import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TableInfo } from '../../shared/contracts';
import type { FilterMode } from '../../shared/contracts';
import { FILTER_LIMITS } from '../../shared/filtering';
import { emptyFilterDraft, type FilterDraft } from '../tableFilters';
import { foreignKeyJoinFiltersFromDraft, type ForeignKeyJoinFilterDraft } from '../tableForeignKeyJoinFilters';
import { TableForeignKeyJoinFilters } from './TableForeignKeyJoinFilters';
import { tableForeignKeyJoinFilterZh as filterText } from '../locales/tableForeignKeyJoinFilter.zh-CN';
import { buildForeignKeyJoin, foreignKeyJoinChoices, foreignKeyJoinMetadataKey, foreignKeyJoinLimits, foreignKeyJoinResultLimit, type ForeignKeyJoinSort } from '../tableForeignKeyJoin';
import { foreignKeyJoinPreview, revalidateForeignKeyJoin, type ForeignKeyJoinPreview, type ForeignKeyJoinTarget, TableForeignKeyJoinIntent } from '../tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

export interface TableForeignKeyJoinServices { read(input: ForeignKeyJoinTarget & { taskId: string }): Promise<TableInfo>; cancel(taskId: string): Promise<unknown>; }
/** 每次正式元数据读取均持有独立任务编号；取消不借普通查询或复用数据库会话。 */
export const tableForeignKeyJoinServices: TableForeignKeyJoinServices = { read: input => invoke('metadata.table', input), cancel: taskId => invoke('query.cancel', { taskId }) };
interface Selection { fk: string; kind: 'LEFT' | 'INNER'; child: string[]; parent: string[]; childSearch: string; parentSearch: string; childPage: number; parentPage: number; sort: { id: string; rule: ForeignKeyJoinSort }[]; limit: string; filters: ForeignKeyJoinFilterDraft[]; filterMode: FilterMode; }
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
  const [selection, setSelection] = useState<Selection>(() => ({ fk: choices[0]?.name ?? '', kind: 'LEFT', child: origin.intent.source.columns.map(column => column.name), parent: [], childSearch: '', parentSearch: '', childPage: 1, parentPage: 1, sort: [], limit: String(origin.intent.limit), filters: [], filterMode: 'all' }));
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
    try { const limit = foreignKeyJoinResultLimit(selection.limit), filters = foreignKeyJoinFiltersFromDraft(selection.filters, origin.intent.source, parent.info); return { value: foreignKeyJoinPreview(origin.intent, parent.info, selection.fk, selection.kind, { childColumns: selection.child, parentColumns: selection.parent, ...(filters.length ? { filters, filterMode: selection.filterMode } : {}), ...(selection.sort.length ? { sort: selection.sort.map(item => item.rule) } : {}), ...(limit !== origin.intent.limit ? { limit } : {}) }), error: '' }; }
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
    const next = { ...selection, fk: value, child: origin.intent.source.columns.map(column => column.name), parent: [], parentSearch: '', childPage: 1, parentPage: 1, sort: [], filters: [], filterMode: 'all' as const };
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
  /** 条件只在当前原窗口本地添加，未完成值保持原文并阻止打开，不降级为无筛选查询。 */
  function addFilter(): void { if (!editable() || !parent || parent.fk !== selection.fk || selection.filters.length >= FILTER_LIMITS.conditions) return; revise({ ...selection, filters: [...selection.filters, { id: uid(), side: 'child', enabled: true, draft: emptyFilterDraft(origin.intent.source.columns[0].name) }] }); }
  /** 原条目对象和已提交渲染均须仍有效；移除、换FK或改来源后旧输入不能落到其它条件。 */
  function editFilter(entry: ForeignKeyJoinFilterDraft, patch: { side?: 'child' | 'parent'; enabled?: boolean; draft?: Partial<FilterDraft> }): void {
    if (!editable() || !selection.filters.includes(entry)) return;
    const value = { ...entry, ...(patch.side ? { side: patch.side } : {}), ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), draft: { ...entry.draft, ...patch.draft } };
    const filters = selection.filters.map(item => item === entry ? value : item);
    if (filters.reduce((total,item) => total + item.draft.value.length + item.draft.upperValue.length + item.draft.valuesText.length, 0) > FILTER_LIMITS.totalCharacters) { setError(filterText.draftBudget); return; }
    revise({ ...selection, filters });
  }
  /** 排序身份固定为双方真实列名和本地行ID；移动位置不改变旧回调的目标。 */
  function sortColumns(side: 'child' | 'parent'): string[] { return (side === 'child' ? origin.intent.source : parent?.fk === selection.fk ? parent.info : undefined)?.columns.map(column => column.name) ?? []; }
  function availableSort(side: 'child' | 'parent', except?: string): string[] { return sortColumns(side).filter(column => !selection.sort.some(item => item.id !== except && item.rule.side === side && item.rule.column === column)); }
  /** 改来源优先保留同名字段，否则明确选择该侧第一可用列；无可用列时保留原项。 */
  function editSort(id: string, patch: Partial<ForeignKeyJoinSort>): void {
    if (!editable()) return; const item = selection.sort.find(item => item.id === id); if (!item) return;
    const rule = { ...item.rule, ...patch }, columns = availableSort(rule.side, id);
    if (!columns.includes(rule.column) || !['ASC', 'DESC'].includes(rule.direction) || rule.nulls !== undefined && !['FIRST', 'LAST'].includes(rule.nulls)) return;
    revise({ ...selection, sort: selection.sort.map(value => value === item ? { ...value, rule } : value) });
  }
  /** NULL默认位置移除可选属性；清空排序后生成旧版无ORDER BY字节，不偷偷追加主键。 */
  function editSortNulls(id: string, value: string): void {
    if (!editable() || !['DEFAULT', 'FIRST', 'LAST'].includes(value)) return; const item = selection.sort.find(item => item.id === id); if (!item) return;
    const { nulls: _nulls, ...rule } = item.rule;
    revise({ ...selection, sort: selection.sort.map(entry => entry === item ? { ...entry, rule: value === 'DEFAULT' ? rule : { ...rule, nulls: value as 'FIRST' | 'LAST' } } : entry) });
  }
  /** 只有本地明确添加才生成排序项，最多20项；不请求数据或改变原表页排序。 */
  function addSort(): void {
    if (!editable() || !parent || parent.fk !== selection.fk || selection.sort.length >= foreignKeyJoinLimits.sorts) return;
    const side = availableSort('child').length ? 'child' : 'parent', column = availableSort(side)[0]; if (!column) return;
    revise({ ...selection, sort: [...selection.sort, { id: uid(), rule: { side, column, direction: 'ASC' } }] });
  }
  /** 上下移动保留字段、方向和NULL策略；边界及旧条目事件不修改新草稿。 */
  function moveSort(id: string, offset: -1 | 1): void {
    if (!editable()) return; const sort = [...selection.sort], index = sort.findIndex(item => item.id === id), target = index + offset; if (index < 0 || target < 0 || target >= sort.length) return;
    const [item] = sort.splice(index, 1); sort.splice(target, 0, item); revise({ ...selection, sort });
  }
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
    <label>{text.resultLimit}<input aria-label={text.resultLimit} inputMode="numeric" maxLength={128} value={selection.limit} disabled={busy || unavailable} onChange={event => revise({ ...selection, limit: event.target.value })}/></label><p>{text.limitHint}</p>
    <label>{text.fk}<select aria-label={text.fk} disabled={unavailable} value={selection.fk} onChange={event => changeForeignKey(event.target.value)}>{choices.map(item => <option key={item.name} value={item.name}>{item.name} → {item.referencedDatabase}.{item.referencedTable}</option>)}</select></label>
    <label>{text.joinKind}<select aria-label={text.joinKind} disabled={busy || unavailable} value={selection.kind} onChange={event => { if (event.target.value === 'LEFT' || event.target.value === 'INNER') revise({ ...selection, kind: event.target.value }); }}><option value="LEFT">{text.left}</option><option value="INNER">{text.inner}</option></select></label>
    <UsageHelp><p>{selection.kind === 'LEFT' ? text.leftHint : text.innerHint}</p><p>{text.relationship}</p><p>{text.aliases}</p></UsageHelp>{choice && <section aria-label={text.relationship}><ul>{choice.columns.map((name, index) => <li key={name}>{origin.intent.source.database}.{origin.intent.source.name}.{name} = {choice.referencedDatabase}.{choice.referencedTable}.{choice.referencedColumns[index]}</li>)}</ul></section>}
    {fieldList('child', origin.intent.source)}{parent && parent.fk === selection.fk && fieldList('parent', parent.info)}
    {parent && parent.fk === selection.fk && <TableForeignKeyJoinFilters child={origin.intent.source} parent={parent.info} entries={selection.filters} mode={selection.filterMode} disabled={busy || unavailable} onAdd={addFilter} onChange={editFilter} onMode={filterMode => revise({ ...selection, filterMode })} onRemove={entry => { if (selection.filters.includes(entry)) revise({ ...selection, filters: selection.filters.filter(item => item !== entry) }); }} onClear={() => revise({ ...selection, filters: [], filterMode: 'all' })}/>}
    {parent && parent.fk === selection.fk && <fieldset disabled={busy || unavailable} aria-label={text.sortTitle}><legend>{text.sortTitle}</legend><UsageHelp><p>{text.sortHint}</p></UsageHelp>{!selection.sort.length && <p>{text.sortEmpty}</p>}
      {selection.sort.map(({ id, rule }, index) => <div className="filter-inputs" key={id}><span>{index + 1}.</span>
        <label>{text.sortSide(index + 1)}<select aria-label={text.sortSide(index + 1)} disabled={busy || unavailable} value={rule.side} onChange={event => { const side = event.target.value; if (side !== 'child' && side !== 'parent') return; const columns = availableSort(side, id), column = columns.includes(rule.column) ? rule.column : columns[0]; if (column) editSort(id, { side, column }); }}><option value="child" disabled={!availableSort('child', id).length}>{text.sortChild}</option><option value="parent" disabled={!availableSort('parent', id).length}>{text.sortParent}</option></select></label>
        <label>{text.sortColumn(index + 1)}<select aria-label={text.sortColumn(index + 1)} disabled={busy || unavailable} value={rule.column} onChange={event => editSort(id, { column: event.target.value })}>{sortColumns(rule.side).map(column => <option key={column} value={column} disabled={!availableSort(rule.side, id).includes(column)}>{column}</option>)}</select></label>
        <label>{text.sortDirection(index + 1)}<select aria-label={text.sortDirection(index + 1)} disabled={busy || unavailable} value={rule.direction} onChange={event => editSort(id, { direction: event.target.value as ForeignKeyJoinSort['direction'] })}><option value="ASC">{text.sortAsc}</option><option value="DESC">{text.sortDesc}</option></select></label>
        <label>{text.sortNulls(index + 1)}<select aria-label={text.sortNulls(index + 1)} disabled={busy || unavailable} value={rule.nulls ?? 'DEFAULT'} onChange={event => editSortNulls(id, event.target.value)}><option value="DEFAULT">{text.nullsDefault}</option><option value="FIRST">{text.nullsFirst}</option><option value="LAST">{text.nullsLast}</option></select></label>
        <button type="button" aria-label={text.sortEarlier(index + 1)} disabled={busy || unavailable || index === 0} onClick={() => moveSort(id, -1)}>↑</button><button type="button" aria-label={text.sortLater(index + 1)} disabled={busy || unavailable || index === selection.sort.length - 1} onClick={() => moveSort(id, 1)}>↓</button><button type="button" aria-label={text.sortRemove(index + 1)} disabled={busy || unavailable} onClick={() => revise({ ...selection, sort: selection.sort.filter(item => item.id !== id) })}>×</button>
      </div>)}
      <button type="button" disabled={busy || unavailable || selection.sort.length >= foreignKeyJoinLimits.sorts || !availableSort('child').length && !availableSort('parent').length} onClick={addSort}>{text.sortAdd}</button><button type="button" disabled={busy || unavailable || !selection.sort.length} onClick={() => revise({ ...selection, sort: [] })}>{text.sortClear}</button>
    </fieldset>}
    <ErrorBox message={unavailable && !closing ? text.stale : error || preview.error}/>{closing ? <p role="status">{text.closing}</p> : message && <Spinner text={message}/>}
    {preview.value && !unavailable && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.value.sql}</pre></section>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (rendered()) cancel(); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button><button disabled={busy || unavailable || !choice} onClick={() => run('preview')}>{text.preview}</button><button className="primary" disabled={busy || unavailable || !preview.value} onClick={() => run('open')}>{text.open}</button></footer></Modal>;
}
