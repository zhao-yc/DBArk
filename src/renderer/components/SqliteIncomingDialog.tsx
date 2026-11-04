import { sqliteRelatedTableZh as relatedText } from '../locales/sqliteRelatedTable.zh-CN';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteIncomingOutput } from '../../shared/sqliteIncoming';
import { SqliteIncomingReader, type SqliteIncomingServices } from '../sqliteIncomingReader';
import { sqliteIncomingZh as text } from '../locales/sqliteIncoming.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';

export const sqliteIncomingServices: SqliteIncomingServices = { read: input => invoke('sqlite.incomingPage', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid };
/** 反向关联仅明确只读；旧回调、关闭及来源变化都不能恢复旧子页。 */
export function SqliteIncomingDialog({ source, values, current, onActivity, onClose, onOpen, services = sqliteIncomingServices }: {
  source: SqliteTablePage; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; onOpen?(output: SqliteIncomingOutput): boolean; services?: SqliteIncomingServices;
}) {
  const origin = useRef({ source, values, current, onActivity, onClose, onOpen, services }).current, alive = useRef(true), dead = useRef(false), closing = useRef(false), reading = useRef(false), work = useRef<Promise<void> | undefined>(undefined);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closeBusy, setCloseBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<SqliteIncomingOutput>(), [selected, setSelected] = useState<number>(), [data, setData] = useState<SqliteIncomingOutput>();
  if (source !== origin.source || values !== origin.values || services !== origin.services) dead.current = true;
  const environment = () => { if (!alive.current || dead.current) return false; try { if (!origin.current()) dead.current = true; } catch { dead.current = true; } return !dead.current; };
  const [reader] = useState(() => new SqliteIncomingReader(source, values, environment, services));
  useLayoutEffect(() => { if (!environment()) { reader.invalidate(); setInvalid(true); } });
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const renderCurrent = () => alive.current && committed.current === renderTicket;
  const actionCurrent = () => renderCurrent() && environment() && !reading.current && !closing.current;
  useEffect(() => { alive.current = true; const observe = () => { if (!environment()) { reader.invalidate(); setInvalid(true); } }; const stop = useWorkspace.subscribe(observe); observe(); return () => { alive.current = false; stop(); reader.invalidate(); }; }, [reader]);
  /** 同步占位并取得准确父标签租约，原读及ACK收尾后归还。 */
  function run(action: () => Promise<void>): void {
    if (!actionCurrent() || !reader.current()) return; reading.current = true;
    const pending = (async () => { let acquired = false; try { origin.onActivity(1); acquired = true; setBusy(true); setError(''); await action(); } catch (failure) { if (alive.current) setError(errorMessage(failure)); } finally { if (acquired) origin.onActivity(-1); reading.current = false; if (alive.current) setBusy(false); } })(); work.current = pending;
  }
  /** 换声明或换页先撤下旧结果，不能把不同子表或不同父元组的结果混用。 */
  function read(offset: number): void { if (!actionCurrent() || selected === undefined) return; const entry = catalog?.references[selected]; if (!entry?.referencedColumns) return; setData(undefined); run(async () => { const value = await reader.page(entry, offset); if (environment()) setData(value); }); }
  async function close(): Promise<void> { if (!renderCurrent() || closing.current) return; closing.current = true; setCloseBusy(true); try { await reader.stop(); await work.current; if (alive.current) origin.onClose(); } catch (failure) { closing.current = false; if (alive.current) { setError(errorMessage(failure)); setCloseBusy(false); } } }
  const entry = selected === undefined ? undefined : catalog?.references[selected], disabled = invalid || busy || closeBusy;
  return <Modal title={text.title} wide onClose={() => { void close(); }}><div className="modal-content">
    <p>{text.hint}</p><p>{text.scope}</p><p>{text.budget}</p><button disabled={disabled} onClick={() => { if (!actionCurrent()) return; setData(undefined); run(async () => { const next = await reader.catalog(); if (environment()) { setCatalog(next); const index = next.references.findIndex(entry => !!entry.referencedColumns); setSelected(index < 0 ? undefined : index); } }); }}>{text.catalog}</button>
    {catalog && <><label>{text.constraint}<select aria-label={text.constraint} disabled={disabled} value={selected ?? ''} onChange={event => { if (!actionCurrent()) return; setSelected(Number(event.target.value)); setData(undefined); }}>{selected === undefined && <option value="">{text.unresolved}</option>}{catalog.references.map((entry, index) => <option key={entry.table + ':' + entry.key.ordinal} value={index} disabled={!entry.referencedColumns}>{entry.table} #{entry.key.ordinal} · {entry.key.columns.join(', ')} → {entry.referencedColumns?.join(', ') ?? text.unresolved}</option>)}</select></label>{!catalog.references.length && <p>{text.emptyKeys}</p>}</>}
    {entry && <p>{entry.table} ({entry.key.columns.join(', ')}) → {source.target.table} ({entry.referencedColumns?.join(', ') ?? text.unresolved})</p>}
    <div><button disabled={disabled || !entry?.referencedColumns} onClick={() => read(0)}>{text.read}</button><button disabled={disabled || !data?.page || data.page.offset === 0} onClick={() => read(Math.max(0, data!.page!.offset - data!.page!.limit))}>{text.previous}</button><button disabled={disabled || !data?.page?.hasMore} onClick={() => read(data!.page!.offset + data!.page!.limit)}>{text.next}</button>{busy && <button disabled={closeBusy} onClick={() => { if (renderCurrent() && !closing.current) void reader.stop().catch(failure => { if (alive.current) setError(errorMessage(failure)); }); }}>{text.stop}</button>}</div>
    <ErrorBox message={invalid ? text.stale : error}/>{busy && <Spinner text={text.loading}/>}{data?.page && <><p>{data.page.target.table} · {data.page.offset + 1}–{data.page.offset + data.page.result.rows.length}</p>{!data.page.result.rows.length && <p role="status">{text.empty}</p>}<ResultsGrid columns={data.page.result.columns} rows={data.page.result.rows} selectionScope={data.page} isCurrent={() => reader.current() && !busy} binaryFileActions={false}/></>}
  </div><footer className="modal-footer">{origin.onOpen && <button disabled={disabled || !data?.page} onClick={() => { if (actionCurrent() && data) try { if (!origin.onOpen?.(data)) throw Error(relatedText.expired); } catch (failure) { setError(errorMessage(failure)); } }}>{relatedText.open}</button>}<button disabled={closeBusy} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
