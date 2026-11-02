import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { SqliteRelationshipReader, type SqliteRelationshipServices } from '../sqliteRelationshipReader';
import type { RelationshipDiagram } from '../relationshipDiagram';
import { relationshipDiagramZh as text } from '../locales/relationshipDiagram.zh-CN';
import { sqliteRelationshipsZh as sqliteText } from '../locales/sqliteRelationships.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, invoke } from '../lib';
import { RelationshipDiagramCanvas } from './RelationshipDiagramDialog';
import { ErrorBox, Modal, Spinner } from './ui';

export const sqliteRelationshipServices: SqliteRelationshipServices = { objects: input => invoke('metadata.objects', input), read: input => invoke('sqlite.relationships', input), cancel: taskId => invoke('query.cancel', { taskId }) };
interface Props { source: SqliteTablePage; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; services?: SqliteRelationshipServices; }
/** 打开与勾选只操作本地草稿；明确读取才调用独立SQLite结构快照。 */
export function SqliteRelationshipDialog({ source, current, onActivity, onClose, services = sqliteRelationshipServices }: Props) {
  const origin = useRef({ source, current, services, onActivity, onClose, schemaKey: source.schemaKey, table: source.target.table, connectionId: source.target.connectionId }).current;
  const latest = useRef({ source, current, services }); latest.current = { source, current, services };
  const alive = useRef(true), dead = useRef(false), closingRef = useRef(false), reading = useRef(false);
  const work = useRef<Promise<void> | undefined>(undefined);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState('');
  const [diagram, setDiagram] = useState<RelationshipDiagram>(), [catalog, setCatalog] = useState([origin.table]), [selection, setSelection] = useState<ReadonlySet<string>>(new Set([origin.table])), selected = useRef(selection); selected.current = selection;
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [notice, setNotice] = useState('');
  /** 绑定首次页对象和不可变指纹；父级切换或原地改写均永久撤销当前图的后续读取。 */
  function environment(): boolean {
    if (!alive.current || dead.current) return false;
    let valid = false; try { valid = latest.current.source === origin.source && latest.current.services === origin.services && origin.source.schemaKey === origin.schemaKey && origin.source.target.table === origin.table && origin.source.target.connectionId === origin.connectionId && origin.current() && latest.current.current(); } catch {}
    if (!valid) dead.current = true; return valid;
  }
  const [reader] = useState(() => new SqliteRelationshipReader({ connectionId: origin.connectionId, database: 'main', anchor: { table: origin.table, schemaKey: origin.schemaKey } }, services, environment));
  useLayoutEffect(() => { if (!environment()) { reader.invalidate(); setInvalid(true); } });
  useEffect(() => { alive.current = true; const observe = () => { if (!environment()) { reader.invalidate(); setInvalid(true); } }; const unsubscribe = useWorkspace.subscribe(observe); observe(); return () => { alive.current = false; unsubscribe(); reader.invalidate(); }; }, [reader]);
  /** 在store同步通知前登记租约，直至原读取及取消链终态才归还父标签占用。 */
  function run(action: () => Promise<void>): Promise<void> {
    if (reading.current || closingRef.current || !reader.current()) return Promise.resolve(); reading.current = true;
    const pending = (async () => {
      let acquired = false;
      try { origin.onActivity(1); acquired = true; setBusy(true); setError(''); await action(); }
      catch (reason) { if (alive.current) setError(errorMessage(reason)); }
      finally { if (acquired) origin.onActivity(-1); reading.current = false; if (alive.current) setBusy(false); }
    })();
    work.current = pending; return pending;
  }
  /** 读取完整成功且租约仍有效时才替换图，不拼接上轮或半份结构。 */
  function read(names: readonly string[]): void { void run(async () => { const next = await reader.read(names); if (environment()) { setDiagram(next); setNotice(''); } }); }
  async function close(): Promise<void> { if (closingRef.current) return; closingRef.current = true; setClosing(true); try { await reader.stop(); await work.current; if (alive.current) origin.onClose(); } catch (reason) { closingRef.current = false; if (alive.current) { setClosing(false); setError(errorMessage(reason)); } } }
  const visible = useMemo(() => catalog.filter(name => name.toLowerCase().includes(search.toLowerCase())), [catalog, search]), pages = Math.max(1, Math.ceil(visible.length / 50)), index = Math.min(page, pages - 1), disabled = invalid || busy || closing;
  return <Modal title={text.title} onClose={() => { void close(); }} wide><div className="modal-content relationship-diagram-dialog" aria-busy={busy || closing}>
    <p className="muted">{sqliteText.scope}</p><p className="muted">{sqliteText.referenceScope}</p><p>{sqliteText.initial}</p>
    <div className="relationship-diagram-selection"><div className="relationship-diagram-pick-controls"><button disabled={disabled} onClick={() => { void run(async () => { const names = await reader.catalog(); if (environment()) { setCatalog(names); setPage(0); setNotice(text.catalogChanged); } }); }}>{text.catalog}</button><label>{text.search}<input disabled={disabled} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label><span>{text.selected} {selection.size} / 40</span></div>
      <div className="relationship-diagram-picker" role="group" aria-label={text.tableList}>{visible.slice(index * 50, index * 50 + 50).map(name => <label key={name} title={name}><input type="checkbox" checked={selection.has(name)} disabled={disabled || name === origin.table} onChange={event => { if (!environment() || reader.busy || closingRef.current) return; const next = new Set(selected.current); if (event.target.checked) { if (next.size >= 40) { setError(text.limit); return; } next.add(name); } else next.delete(name); selected.current = next; setSelection(next); setNotice(text.selectionChanged); }}/><span>{name}</span></label>)}{!visible.length && <span>{text.noTables}</span>}</div>
      <div className="relationship-diagram-pick-controls"><button disabled={disabled || !index} onClick={() => setPage(index - 1)}>{text.previous}</button><span>{index + 1} / {pages}</span><button disabled={disabled || index + 1 >= pages} onClick={() => setPage(index + 1)}>{text.next}</button><button disabled={disabled} onClick={() => read([...selected.current])}>{text.read}</button><button disabled={disabled || !diagram} onClick={() => read(diagram!.tables.map(table => table.name))}>{text.refresh}</button>{busy && <button disabled={closing} onClick={() => { void reader.stop().catch(reason => { if (alive.current) setError(errorMessage(reason)); }); }}>{text.stop}</button>}</div>
    </div><ErrorBox message={invalid ? text.stale : error}/>{notice && <p role="status">{notice}</p>}{busy && <Spinner text={text.read}/>}<p className="muted">{text.limit}</p>{diagram && <RelationshipDiagramCanvas diagram={diagram}/>}
  </div><footer className="modal-footer"><span className="grow"/><button disabled={closing} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
