import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteReferenceOutput } from '../../shared/sqliteReference';
import { SqliteReferenceReader, type SqliteReferenceServices } from '../sqliteReferenceReader';
import { sqliteReferenceZh as text } from '../locales/sqliteReference.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';

export const sqliteReferenceServices: SqliteReferenceServices = { read: input => invoke('sqlite.referencePage', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid };
/** 父记录窗口只读且显式发起读取；关闭等待准确原读和取消链收尾。 */
export function SqliteReferenceDialog({ source, values, current, onActivity, onClose, services = sqliteReferenceServices }: {
  source: SqliteTablePage; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; services?: SqliteReferenceServices;
}) {
  const origin = useRef({ source, values, current, onActivity, onClose, services }).current, alive = useRef(true), dead = useRef(false), closing = useRef(false), reading = useRef(false), work = useRef<Promise<void> | undefined>(undefined);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closeBusy, setCloseBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<SqliteReferenceOutput>(), [selected, setSelected] = useState<number>(), [data, setData] = useState<SqliteReferenceOutput>();
  if (source !== origin.source || values !== origin.values || services !== origin.services) dead.current = true;
  const environment = () => { if (!alive.current || dead.current) return false; try { if (!origin.current()) dead.current = true; } catch { dead.current = true; } return !dead.current; };
  const [reader] = useState(() => new SqliteReferenceReader(source, values, environment, services));
  useLayoutEffect(() => { if (!environment()) { reader.invalidate(); setInvalid(true); } });
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const renderCurrent = () => alive.current && committed.current === renderTicket;
  const actionCurrent = () => renderCurrent() && environment() && !reading.current && !closing.current;
  useEffect(() => { alive.current = true; const observe = () => { if (!environment()) { reader.invalidate(); setInvalid(true); } }; const stop = useWorkspace.subscribe(observe); observe(); return () => { alive.current = false; stop(); reader.invalidate(); }; }, [reader]);
  /** 同步占位后获取父租约；直到原Promise及取消ACK全部结束才释放。 */
  function run(action: () => Promise<void>): void {
    if (!actionCurrent() || !reader.current()) return; reading.current = true;
    const pending = (async () => { let acquired = false; try { origin.onActivity(1); acquired = true; setBusy(true); setError(''); await action(); } catch (failure) { if (alive.current) setError(errorMessage(failure)); } finally { if (acquired) origin.onActivity(-1); reading.current = false; if (alive.current) setBusy(false); } })(); work.current = pending;
  }
  /** 选择或换页只读所选声明，旧页先撤下，不沿用上一个父表结果。 */
  function read(offset: number): void { if (!actionCurrent()) return; const key = catalog?.source.foreignKeys.find(key => key.ordinal === selected); if (!key) return; setData(undefined); run(async () => { const value = await reader.page(key, offset); if (environment()) setData(value); }); }
  async function close(): Promise<void> { if (!renderCurrent() || closing.current) return; closing.current = true; setCloseBusy(true); try { await reader.stop(); await work.current; if (alive.current) origin.onClose(); } catch (failure) { closing.current = false; if (alive.current) { setError(errorMessage(failure)); setCloseBusy(false); } } }
  const key = catalog?.source.foreignKeys.find(key => key.ordinal === selected), disabled = invalid || busy || closeBusy;
  return <Modal title={text.title} wide onClose={() => { void close(); }}><div className="modal-content reference-content">
    <p>{text.hint}</p><p>{text.scope}</p><button disabled={disabled} onClick={() => { if (!actionCurrent()) return; setData(undefined); run(async () => { const next = await reader.catalog(); if (environment()) { setCatalog(next); setSelected(next.source.foreignKeys[0]?.ordinal); } }); }}>{text.catalog}</button>
    {catalog && <><label>{text.constraint}<select aria-label={text.constraint} disabled={disabled} value={selected ?? ''} onChange={event => { if (!actionCurrent()) return; setSelected(Number(event.target.value)); setData(undefined); }}>{catalog.source.foreignKeys.map(key => <option key={key.ordinal} value={key.ordinal}>{text.key(key.ordinal)} · {key.columns.join(', ')} → {key.referencedTable}</option>)}</select></label>{!catalog.source.foreignKeys.length && <p>{text.emptyKeys}</p>}</>}
    {key && <p>{key.columns.join(', ')} → {key.referencedTable} ({key.referencedColumns?.join(', ') ?? text.implicit})</p>}
    <p>{text.unloaded}</p><div className="reference-pagination"><button disabled={disabled || !key} onClick={() => read(0)}>{text.read}</button><button disabled={disabled || !data?.page || data.page.offset === 0} onClick={() => read(Math.max(0, data!.page!.offset - data!.page!.limit))}>{text.previous}</button><button disabled={disabled || !data?.page?.hasMore} onClick={() => read(data!.page!.offset + data!.page!.limit)}>{text.next}</button>{busy && <button disabled={closeBusy} onClick={() => { if (renderCurrent() && !closing.current) void reader.stop().catch(failure => { if (alive.current) setError(errorMessage(failure)); }); }}>{text.stop}</button>}</div>
    <ErrorBox message={invalid ? text.stale : error}/>{busy && <Spinner text={text.loading}/>}{data?.page && <><p>{data.page.target.table} · {data.referencedColumns?.join(', ')} · {data.page.offset + 1}–{data.page.offset + data.page.result.rows.length}</p>{!data.page.result.rows.length && <p role="status">{text.empty}</p>}<div className="reference-grid"><ResultsGrid columns={data.page.result.columns} rows={data.page.result.rows} selectionScope={data.page} isCurrent={() => reader.current() && !busy} binaryFileActions={false}/></div></>}
  </div><footer className="modal-footer"><button disabled={closeBusy} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
