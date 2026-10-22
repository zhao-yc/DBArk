import { useEffect, useRef, useState } from 'react';
import type { FilterGroup, FilterMode, FilterRule, SortRule } from '../../shared/contracts';
import type { ChildReferencePageInput, ChildReferencePageOutput, IncomingReferenceRelation, IncomingReferencesInput, IncomingReferencesOutput } from '../../shared/incomingReferences';
import { validateFilterGroup } from '../../shared/filtering';
import { ChildReferenceIntent, checkChildReferencePage, checkIncomingReferencePage, childReferenceTuple } from '../childReferenceIntent';
import { errorMessage, invoke, uid } from '../lib';
import { childReferencesZh as text } from '../locales/childReferences.zh-CN';
import { maxTablePage, parsePageJump } from '../tableFilters';
import { validateTableSort } from '../tableSort';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';
import { TableFilterPanel } from './TableFilterPanel';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { TableSortPanel } from './TableSortPanel';
import '../childReferences.css';

export interface ChildReferenceServices {
  incoming(input: IncomingReferencesInput): Promise<IncomingReferencesOutput>;
  page(input: ChildReferencePageInput): Promise<ChildReferencePageOutput>;
  cancel(taskId: string): Promise<unknown>;
}
/** 正式服务仅使用受限IPC，关联元组不会转成普通文本筛选或SQL。 */
export const childReferenceServices: ChildReferenceServices = {
  incoming: input => invoke('table.incomingReferences', input), page: input => invoke('table.childReferencePage', input),
  cancel: taskId => invoke('query.cancel', { taskId }),
};
type Conditions = { page: number; pageSize: number; filters: FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; sort: SortRule[] };
const initialConditions = (): Conditions => ({ page: 1, pageSize: 50, filters: [], filterMode: 'all', sort: [] });

/** 独立只读窗口；所有子页都绑定原父行和真实child→parent映射，绝不进入记录编辑器。 */
export function ChildReferenceDialog({ base, intent, onClose, onActivity, services = childReferenceServices }: {
  base: { connectionId: string; database: string; table: string }; intent: ChildReferenceIntent;
  onClose(): void; onActivity(delta: 1 | -1): void; services?: ChildReferenceServices;
}) {
  const origin = useRef({ base: { ...base }, intent, services }).current;
  // 原属性曾切走一次就撤销原意图，恢复相同属性也不能接纳旧回包。
  if (origin.intent !== intent || origin.services !== services || origin.base.connectionId !== base.connectionId || origin.base.database !== base.database || origin.base.table !== base.table) origin.intent.invalidate();
  const [relations, setRelations] = useState<IncomingReferenceRelation[]>([]), [selected, setSelected] = useState<IncomingReferenceRelation>();
  const [directoryReady, setDirectoryReady] = useState(false), [directoryPage, setDirectoryPage] = useState(0), [nextCursor, setNextCursor] = useState<string>();
  const cursors = useRef<(string | undefined)[]>([undefined]), digest = useRef<string | undefined>(undefined);
  const [data, setData] = useState<ChildReferencePageOutput>(), [conditions, setConditions] = useState<Conditions>(initialConditions), [jump, setJump] = useState('1');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [invalid, setInvalid] = useState(false), [closing, setClosing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false), [groupsOpen, setGroupsOpen] = useState(false);
  const alive = useRef(true), lock = useRef(false), closingRef = useRef(false), pending = useRef<Promise<void> | null>(null);
  const tasks = useRef(new Set<string>()), cancelled = useRef(new Set<string>()), cancellations = useRef(new Set<Promise<unknown>>());
  const activity = useRef(onActivity), closeCallback = useRef(onClose); activity.current = onActivity; closeCallback.current = onClose;
  const epoch = useRef(0), renderTicket = {}, committed = useRef<object | null>(null);
  const currentSelection = useRef(selected); currentSelection.current = selected;
  const currentConditions = useRef(conditions); currentConditions.current = conditions;
  /** 原实例、原意图及已提交渲染共同占门，旧DOM回调不能使用后来的关系或筛选。 */
  function current(): boolean { return alive.current && !closingRef.current && origin.intent === intent && origin.services === services && origin.base.connectionId === base.connectionId && origin.base.database === base.database && origin.base.table === base.table && intent.current(); }
  function editable(): boolean { return current() && !lock.current && committed.current === renderTicket; }
  useEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = null; }; });
  /** 取消确认只表示请求已送达；锁仍由原读取Promise的finally持有。 */
  function cancel(): void {
    for (const taskId of tasks.current) {
      if (cancelled.current.has(taskId)) continue; cancelled.current.add(taskId);
      const cancellation = Promise.resolve().then(() => origin.services.cancel(taskId)).catch(() => undefined);
      cancellations.current.add(cancellation); void cancellation.finally(() => cancellations.current.delete(cancellation));
    }
    if (alive.current && tasks.current.size) setMessage(text.cancelling);
  }
  /** 每条任务记录准确原编号，活动计数覆盖真正IPC结算而不是取消ACK。 */
  async function read<T>(reader: (taskId: string) => Promise<T>): Promise<T> {
    if (!current()) throw Error(text.changed);
    const taskId = uid(); tasks.current.add(taskId); activity.current(1);
    try { return await reader(taskId); }
    finally { tasks.current.delete(taskId); cancelled.current.delete(taskId); activity.current(-1); }
  }
  /** 原始操作同步锁定后再执行，任何同步异常也要经过同一个finally释放。 */
  function run(action: (ticket: number) => Promise<void>): void {
    if (lock.current || !current()) return;
    lock.current = true; setBusy(true); setError(''); setMessage(''); const ticket = ++epoch.current;
    const operation = Promise.resolve().then(() => action(ticket)).catch(reason => {
      if (alive.current && !closingRef.current && ticket === epoch.current) setError(errorMessage(reason));
    }).finally(() => { lock.current = false; if (pending.current === operation) pending.current = null; if (alive.current) setBusy(false); });
    pending.current = operation;
  }
  /** 目录翻页只接受原完整父表及同一摘要，不接续发生变化的目录。 */
  function loadDirectory(index: number, cursor?: string): void {
    run(async ticket => {
      const output = await read(taskId => origin.services.incoming({ ...origin.base, taskId, ...(cursor ? { cursor } : {}) }));
      if (!current() || ticket !== epoch.current) return;
      checkIncomingReferencePage(intent, output, digest.current); digest.current = output.sourceDigest;
      setRelations(structuredClone(output.relations)); setDirectoryReady(true); setDirectoryPage(index); setNextCursor(output.nextCursor);
      cursors.current = cursors.current.slice(0, index + 1); cursors.current[index] = cursor;
      setSelected(undefined); currentSelection.current = undefined; setData(undefined); setConditions(initialConditions()); setJump('1'); setSortOpen(false); setGroupsOpen(false);
    });
  }
  /** 筛选排序始终附加于完整元组；缺字段和部分NULL绝不发送无界子表读取。 */
  function loadChild(relation: IncomingReferenceRelation, next: Conditions): void {
    if (!digest.current) return;
    const expectedDigest = digest.current;
    run(async ticket => {
      const tuple = childReferenceTuple(intent, relation);
      if (tuple.kind === 'missing') { setData(undefined); throw Error(text.incomplete); }
      if (tuple.kind === 'null') { setData(undefined); setMessage(text.nullTuple); return; }
      const output = await read(taskId => origin.services.page({ ...origin.base, relation: { database: relation.database, table: relation.table, foreignKeyName: relation.foreignKey.name, digest: relation.digest }, matchValues: tuple.values, ...next, taskId }));
      if (!current() || ticket !== epoch.current) return;
      checkChildReferencePage(intent, relation, expectedDigest, output, next.page, next.pageSize);
      setData(output);
    });
  }
  /** 条件由当前公开控件发布，先同步换代并清旧网格，再发准确分页读取。 */
  function changeConditions(next: Conditions): boolean {
    if (!editable() || !selected || currentSelection.current !== selected || sortOpen || groupsOpen) return false;
    currentConditions.current = next; setConditions(next); setJump(String(next.page)); setData(undefined); loadChild(selected, next); return true;
  }
  /** 关闭保留模态与父标签占用，直到原读取及取消请求全部实际结算。 */
  function close(): void {
    if (closingRef.current) return; closingRef.current = true; epoch.current++; setClosing(true); cancel();
    void (async () => { if (pending.current) await pending.current; while (cancellations.current.size) await Promise.allSettled([...cancellations.current]); if (alive.current) { alive.current = false; closeCallback.current(); } })();
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = intent.subscribe(() => { if (!alive.current) return; epoch.current++; setInvalid(true); setData(undefined); setSortOpen(false); setGroupsOpen(false); cancel(); });
    loadDirectory(0);
    return () => { alive.current = false; epoch.current++; unsubscribe(); cancel(); };
  }, []);
  useEffect(() => {
    /** 防止模态键盘动作触发后台查询执行或父表提交。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);
  const disabled = busy || closing || invalid || !intent.current();
  const columnNames = data?.target.columns.map(column => column.name) ?? [];
  const panelScope = conditions;
  /** 编辑面板只接受打开时的原条件、关系及意图，旧确认不能变更新页。 */
  function panelCurrent(): boolean { return editable() && currentConditions.current === panelScope && currentSelection.current === selected; }
  return <Modal title={text.title} wide onClose={close}><div className="modal-content child-reference-content" aria-busy={busy || closing}>
    <p>{text.visible}</p><p className="muted small">{text.snapshot}</p><p className="muted small">{text.readonly}</p>
    <p>{text.source}：{intent.source.database}.{intent.source.name}</p>
    <div className="child-reference-tools"><button disabled={disabled || directoryPage === 0} onClick={() => { if (editable()) loadDirectory(directoryPage - 1, cursors.current[directoryPage - 1]); }}>{text.previousRelations}</button><span>{text.relationPage(directoryPage + 1)}</span><button disabled={disabled || !nextCursor} onClick={() => { if (editable() && nextCursor) loadDirectory(directoryPage + 1, nextCursor); }}>{text.nextRelations}</button></div>
    <Field label={text.relations}><select aria-label={text.relations} disabled={disabled} value={selected ? String(relations.indexOf(selected)) : ''} onChange={event => {
      if (!editable()) return; const relation = relations[Number(event.target.value)]; if (event.target.value === '' || !relation) return;
      const next = initialConditions(); currentSelection.current = relation; currentConditions.current = next; setSelected(relation); setConditions(next); setData(undefined); setJump('1'); setSortOpen(false); setGroupsOpen(false); loadChild(relation, next);
    }}><option value="">{text.relations}</option>{relations.map((relation, index) => <option key={relation.digest} value={String(index)}>{relation.database}.{relation.table} · {relation.foreignKey.name}</option>)}</select></Field>
    {directoryReady && !relations.length && <p>{text.emptyRelations}</p>}
    {selected && <><p>{text.target}：{selected.database}.{selected.table}</p><p className="child-reference-mapping">{text.mapping}：{selected.foreignKey.columns.map((column, index) => `${column} → ${selected.foreignKey.referencedColumns[index]}`).join('，')}</p></>}
    <TableFilterPanel columns={columnNames} filters={conditions.filters} mode={conditions.filterMode} disabled={disabled || !data || sortOpen || groupsOpen} onFiltersChange={filters => changeConditions({ ...conditions, filters, filterGroup: undefined, page: 1 })} onModeChange={filterMode => changeConditions({ ...conditions, filterMode, filterGroup: undefined, page: 1 })}/>
    <div className="child-reference-tools"><button disabled={disabled || !data || sortOpen || groupsOpen} onClick={() => { if (editable()) setSortOpen(true); }}>{text.sort}</button><button disabled={disabled || !data || !conditions.filters.length || sortOpen || groupsOpen} onClick={() => { if (editable()) setGroupsOpen(true); }}>{text.groups}</button></div>
    {sortOpen && <TableSortPanel columns={columnNames} initial={conditions.sort} isCurrent={panelCurrent} onClose={() => { if (panelCurrent()) setSortOpen(false); }} onApply={sort => { if (!panelCurrent()) return false; const next = { ...conditions, sort: validateTableSort(sort, columnNames), page: 1 }; setSortOpen(false); currentConditions.current = next; setConditions(next); setData(undefined); setJump('1'); loadChild(selected!, next); return true; }}/ >}
    {groupsOpen && <TableFilterGroupsDialog filters={conditions.filters} mode={conditions.filterMode} initial={conditions.filterGroup} isCurrent={panelCurrent} onClose={() => { if (panelCurrent()) setGroupsOpen(false); }} onApply={group => { if (!panelCurrent()) return false; const next = { ...conditions, filterGroup: validateFilterGroup(conditions.filters, conditions.filterMode, group), page: 1 }; setGroupsOpen(false); currentConditions.current = next; setConditions(next); setData(undefined); setJump('1'); loadChild(selected!, next); return true; }}/ >}
    <ErrorBox message={invalid || !intent.current() ? text.changed : error}/>{message && <p role="status">{message}</p>}{busy && <Spinner text={text.loading}/>}{closing && <p>{text.closing}</p>}
    {data && !disabled && <><p role="status">{text.resultPage(data.page.page, data.page.rows.length)}</p>{!data.stablePagination && <p className="warning-text">{text.unstable}</p>}<div className="child-reference-grid"><ResultsGrid columns={data.page.columns} rows={data.page.rows} selectionScope={data} isCurrent={() => current() && !lock.current && !sortOpen && !groupsOpen && currentConditions.current === conditions && currentSelection.current === selected} sort={conditions.sort} onSortChange={sort => { try { changeConditions({ ...conditions, sort: validateTableSort(sort, columnNames), page: 1 }); } catch (reason) { setError(errorMessage(reason)); } }}/></div>{!data.page.rows.length && <p>{text.empty}</p>}</>}
    <div className="child-reference-pagination"><button disabled={disabled || !data || conditions.page <= 1 || sortOpen || groupsOpen} onClick={() => changeConditions({ ...conditions, page: conditions.page - 1 })}>{text.previous}</button><form onSubmit={event => { event.preventDefault(); if (!editable()) return; try { changeConditions({ ...conditions, page: parsePageJump(jump) }); } catch (reason) { setError(errorMessage(reason)); } }}><input aria-label={text.page} value={jump} disabled={disabled || !data || sortOpen || groupsOpen} onChange={event => { if (editable()) setJump(event.target.value); }}/><button type="submit" disabled={disabled || !data || sortOpen || groupsOpen}>{text.jump}</button></form><button disabled={disabled || !data?.page.hasMore || conditions.page >= maxTablePage || sortOpen || groupsOpen} onClick={() => changeConditions({ ...conditions, page: conditions.page + 1 })}>{text.next}</button><select aria-label={text.pageSize} value={conditions.pageSize} disabled={disabled || !selected || sortOpen || groupsOpen} onChange={event => { const size = Number(event.target.value); if ([50, 100, 200, 500].includes(size)) changeConditions({ ...conditions, page: 1, pageSize: size }); }}>{[50, 100, 200, 500].map(size => <option key={size}>{size}</option>)}</select><button disabled={disabled || !selected || sortOpen || groupsOpen} onClick={() => changeConditions({ ...conditions })}>{text.refresh}</button></div>
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { epoch.current++; setData(undefined); cancel(); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button></footer></Modal>;
}
