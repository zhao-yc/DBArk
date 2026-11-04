import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import { SqliteRelationNavigator, type SqliteRelationServices } from '../sqliteRelationNavigator';
import { sqliteRelationZh as text } from '../locales/sqliteRelation.zh-CN';
import { sqliteReferenceZh as parentText } from '../locales/sqliteReference.zh-CN';
import { sqliteIncomingZh as childText } from '../locales/sqliteIncoming.zh-CN';
import { sqliteReferenceServices } from './SqliteReferenceDialog';
import { sqliteIncomingServices } from './SqliteIncomingDialog';
import { useWorkspace } from '../store';
import { Modal, ErrorBox, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';

/** 单个窗口持有根来源，任意层读取均共用原标签租约，关闭等待准确原任务收尾。 */
export function SqliteRelationDialog({ source, values, current, onActivity, onClose, services }: {
  source: SqliteTablePage; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; services?: Omit<SqliteRelationServices, 'activity'>;
}) {
  const origin = useRef({ source, values, current, onActivity, onClose, services }).current, alive = useRef(true), dead = useRef(false), closing = useRef(false);
  const [, render] = useState(0);
  if (origin.source !== source || origin.values !== values || origin.services !== services) dead.current = true;
  const [navigator] = useState(() => new SqliteRelationNavigator(source, values, () => { if (!alive.current || dead.current) return false; try { if (!origin.current()) dead.current = true; } catch { dead.current = true; } return !dead.current; }, { parents: services?.parents ?? sqliteReferenceServices, children: services?.children ?? sqliteIncomingServices, activity: onActivity }));
  useLayoutEffect(() => { navigator.observe(); });
  useEffect(() => { alive.current = true; const update = () => { if (alive.current) render(value => value + 1); }, observe = () => navigator.observe(), unsubscribe = navigator.subscribe(update), stop = useWorkspace.subscribe(observe); observe(); return () => { alive.current = false; stop(); unsubscribe(); navigator.dispose(); }; }, [navigator]);
  const view = navigator.view, panel = view.panel, catalog = panel.catalog, data = panel.data?.page, parents = view.direction === 'parents', labels = parents ? parentText : childText;
  const options = catalog ? 'references' in catalog ? catalog.references.map((entry, index) => ({ value: index, enabled: !!entry.referencedColumns, label: entry.table + ' #' + entry.key.ordinal + ' · ' + entry.key.columns.join(', ') + ' → ' + (entry.referencedColumns?.join(', ') ?? childText.unresolved) })) : catalog.source.foreignKeys.map(key => ({ value: key.ordinal, enabled: true, label: '#' + key.ordinal + ' · ' + key.columns.join(', ') + ' → ' + key.referencedTable })) : [];
  const disabled = !view.valid || view.busy || view.closing;
  /** 当前组件渲染同样拥有关闭权；旧卸载回调或重复关闭不接管新owner。 */
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const currentRender = () => alive.current && committed.current === renderTicket;
  async function close(): Promise<void> { if (!currentRender() || closing.current) return; closing.current = true; try { await navigator.close(); if (alive.current) origin.onClose(); } catch { closing.current = false; } }
  return <Modal title={text.title} wide onClose={() => { void close(); }}><div className="modal-content">
    <p>{text.hint}</p><p>{text.history}</p><nav aria-label={text.path}><button disabled={disabled || view.position === 0} onClick={() => { if (currentRender()) navigator.travel(view, -1); }}>{text.back}</button><button disabled={disabled || view.position + 1 === view.history} onClick={() => { if (currentRender()) navigator.travel(view, 1); }}>{text.forward}</button><span>{view.path.slice(0, view.position + 1).join(' → ')}</span></nav>
    <p>{text.current(view.source.target.table, view.position + 1, view.history)}</p><div role="group" aria-label={text.constraint}><button aria-pressed={parents} disabled={disabled} onClick={() => { if (currentRender()) navigator.direction(view, 'parents'); }}>{text.parents}</button><button aria-pressed={!parents} disabled={disabled} onClick={() => { if (currentRender()) navigator.direction(view, 'children'); }}>{text.children}</button></div>
    <p>{parents ? parentText.scope : childText.scope}</p><button disabled={disabled} onClick={() => { if (currentRender()) void navigator.catalog(view); }}>{labels.catalog}</button>
    {catalog ? <><label>{text.constraint}<select aria-label={text.constraint} disabled={disabled} value={panel.selected ?? ''} onChange={event => { if (currentRender()) navigator.select(view, Number(event.target.value)); }}>{panel.selected === undefined && <option value="">{text.emptyKeys}</option>}{options.map(option => <option key={option.value} value={option.value} disabled={!option.enabled}>{option.label}</option>)}</select></label>{!options.some(option => option.enabled) && <p>{text.emptyKeys}</p>}</> : <p>{text.unloaded}</p>}
    <div><button disabled={disabled || panel.selected === undefined} onClick={() => { if (currentRender()) void navigator.page(view, 0); }}>{labels.read}</button><button disabled={disabled || !data || data.offset === 0} onClick={() => { if (currentRender()) void navigator.page(view, Math.max(0, data!.offset - data!.limit)); }}>{labels.previous}</button><button disabled={disabled || !data?.hasMore} onClick={() => { if (currentRender()) void navigator.page(view, data!.offset + data!.limit); }}>{labels.next}</button>{view.busy && <button disabled={view.closing} onClick={() => { if (currentRender()) void navigator.stop().catch(() => undefined); }}>{text.stop}</button>}</div>
    <ErrorBox message={!view.valid ? text.stale : view.error}/>{view.busy && <Spinner text={labels.loading}/>}{data && <><p>{data.target.table} · {data.offset + 1}–{data.offset + data.result.rows.length}</p>{!data.result.rows.length && <p role="status">{text.empty}</p>}<ResultsGrid columns={data.result.columns} rows={data.result.rows} selectionScope={data} isCurrent={() => currentRender() && navigator.ready(view)} binaryFileActions={false} onActiveRowChange={row => { if (row && currentRender()) navigator.row(view, data, row); }}/></>}
    <p>{panel.row === undefined || !data ? text.selectRow : text.selected(data.offset + panel.row + 1)}</p>
  </div><footer className="modal-footer"><button disabled={disabled || panel.row === undefined} onClick={() => { if (currentRender()) navigator.navigate(view, 'parents'); }}>{text.nextParents}</button><button disabled={disabled || panel.row === undefined} onClick={() => { if (currentRender()) navigator.navigate(view, 'children'); }}>{text.nextChildren}</button><button disabled={view.closing} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
