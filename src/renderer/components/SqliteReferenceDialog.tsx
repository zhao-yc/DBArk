import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteRelationshipName as fold } from '../../shared/sqliteRelationships';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteReferenceOutput, SqliteReferenceSearch } from '../../shared/sqliteReference';
import { sqliteReferenceTuple, assertSqliteReferenceChoice, type SqliteReferenceChoice } from '../sqliteReferenceChoice';
import { SqliteReferenceReader, type SqliteReferenceServices } from '../sqliteReferenceReader';
import { sqliteReferenceZh as text } from '../locales/sqliteReference.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';

export const sqliteReferenceServices: SqliteReferenceServices = { read: input => invoke('sqlite.referencePage', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid };
/** 父记录与候选均显式只读，选择仅交回草稿；关闭等待准确原读和取消链收尾。 */
export function SqliteReferenceDialog({ source, values, current, onActivity, onClose, onStage, services = sqliteReferenceServices }: {
  source: SqliteTablePage; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; onStage?(choice: SqliteReferenceChoice): boolean; services?: SqliteReferenceServices;
}) {
  const origin = useRef({ source, values, current, onActivity, onClose, onStage, services }).current, alive = useRef(true), dead = useRef(false), closing = useRef(false), reading = useRef(false), work = useRef<Promise<void> | undefined>(undefined);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closeBusy, setCloseBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<SqliteReferenceOutput>(), [selected, setSelected] = useState<number>(), [data, setData] = useState<SqliteReferenceOutput>();
  const [chosen, setChosen] = useState<number>(), selection = useRef<{ data: SqliteReferenceOutput; index: number; values: SqliteOriginalValue[] } | undefined>(undefined);
  const [searchColumns, setSearchColumns] = useState<string[]>([]);
  const [searchColumn, setSearchColumn] = useState(''), [searchText, setSearchText] = useState(''), appliedSearch = useRef<SqliteReferenceSearch | undefined>(undefined);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const choosing = !!origin.onStage;
  const resetSelection = () => { selection.current = undefined; setChosen(undefined); setClearConfirmed(false); };
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
  function run(action: () => Promise<void | (() => void)>): void {
    if (!actionCurrent() || !reader.current()) return; reading.current = true;
    const pending = (async () => { let acquired = false, after: void | (() => void) = undefined;
      try { origin.onActivity(1); acquired = true; setBusy(true); setError(''); after = await action(); }
      catch (failure) { if (alive.current) setError(errorMessage(failure)); }
      finally { if (acquired) origin.onActivity(-1); reading.current = false; if (alive.current) setBusy(false); }
      // Editor只能在原读取租约归还后暂存；归还触发的同步来源变化仍会使这次确认失败。
      if (after && environment() && !closing.current) try { after(); } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
    })(); work.current = pending;
  }
  /** 换页保留已应用搜索；编辑搜索草稿不发送任务，并撤销上一条父候选选择。 */
  function read(offset: number, restart = false): void {
    if (!actionCurrent()) return; const key = catalog?.source.foreignKeys.find(key => key.ordinal === selected); if (!key) return;
    if (choosing && restart) appliedSearch.current = searchText ? { column: searchColumn, text: searchText } : undefined;
    resetSelection(); setData(undefined);
    run(async () => { const value = choosing ? await reader.candidates(key, offset, appliedSearch.current) : await reader.page(key, offset); if (environment()) { setData(value); if (choosing) setSearchColumns(value.page!.columns.map(column => column.name)); if (choosing && !searchColumn) setSearchColumn(value.referencedColumns![0]); } });
  }
  /** 明确确认后复读所选整组父键；旧选择、迟到结果和关闭过程都不能暂存源行。 */
  function stage(): void {
    if (!actionCurrent() || !origin.onStage || !key) return;
    const token = selection.current; if (!token || token.data !== data) return;
    run(async () => { const proof = await reader.verify(key, token.values, token.data.page!.schemaKey); assertSqliteReferenceChoice(proof, token.values);
      return () => { if (selection.current !== token || !reader.current()) return; if (!origin.onStage!({ foreignKey: key.ordinal, proof, values: token.values })) throw Error(text.stale); };
    });
  }
  /** 清空不查询父表，重新核对源目录后将所有可空子键一次暂存为NULL。 */
  function clear(): void {
    if (!actionCurrent() || !origin.onStage || !key || !clearConfirmed) return; const ordinal = key.ordinal;
    resetSelection(); run(async () => { const proof = await reader.catalog(); return () => { if (!origin.onStage!({ foreignKey: ordinal, proof, values: null })) throw Error(text.stale); }; });
  }
  async function close(): Promise<void> { if (!renderCurrent() || closing.current) return; closing.current = true; setCloseBusy(true); try { await reader.stop(); await work.current; if (alive.current) origin.onClose(); } catch (failure) { closing.current = false; if (alive.current) { setError(errorMessage(failure)); setCloseBusy(false); } } }
  const key = catalog?.source.foreignKeys.find(key => key.ordinal === selected), disabled = invalid || busy || closeBusy;
  const editableKey = key && source.edit?.kind === 'editable' && key.columns.every(name => source.edit?.kind === 'editable' && source.edit.columns.some(column => fold(column.name) === fold(name) && !column.generated));
  const clearable = editableKey && key!.columns.every(name => source.edit?.kind === 'editable' && source.edit.columns.some(column => fold(column.name) === fold(name) && column.nullable));
  return <Modal title={choosing ? text.choiceTitle : text.title} wide onClose={() => { void close(); }}><div className="modal-content reference-content">
    <p>{choosing ? text.choiceHint : text.hint}</p><p>{text.scope}</p><button disabled={disabled} onClick={() => { if (!actionCurrent()) return; resetSelection(); setData(undefined); setSearchColumns([]); setSearchColumn(''); setSearchText(''); appliedSearch.current = undefined; run(async () => { const next = await reader.catalog(); if (environment()) { setCatalog(next); setSelected(next.source.foreignKeys[0]?.ordinal); } }); }}>{text.catalog}</button>
    {catalog && <><label>{text.constraint}<select aria-label={text.constraint} disabled={disabled} value={selected ?? ''} onChange={event => { if (!actionCurrent()) return; resetSelection(); setSelected(Number(event.target.value)); setData(undefined); setSearchColumns([]); setSearchColumn(''); setSearchText(''); appliedSearch.current = undefined; }}>{catalog.source.foreignKeys.map(key => <option key={key.ordinal} value={key.ordinal}>{text.key(key.ordinal)} · {key.columns.join(', ')} → {key.referencedTable}</option>)}</select></label>{!catalog.source.foreignKeys.length && <p>{text.emptyKeys}</p>}</>}
    {key && <p>{key.columns.join(', ')} → {key.referencedTable} ({key.referencedColumns?.join(', ') ?? text.implicit})</p>}
    {choosing && searchColumns.length > 0 && <div><label>{text.searchColumn}<select aria-label={text.searchColumn} disabled={disabled} value={searchColumn} onChange={event => { if (actionCurrent()) { resetSelection(); setSearchColumn(event.target.value); } }}>{searchColumns.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>{text.search}<input aria-label={text.search} maxLength={256} disabled={disabled} value={searchText} onChange={event => { if (actionCurrent()) { resetSelection(); setSearchText(event.target.value); } }}/></label><p>{text.searchHint}</p></div>}
    <p>{text.unloaded}</p><div className="reference-pagination"><button disabled={disabled || !key} onClick={() => read(0, true)}>{choosing ? text.candidates : text.read}</button><button disabled={disabled || !data?.page || data.page.offset === 0} onClick={() => read(Math.max(0, data!.page!.offset - data!.page!.limit))}>{text.previous}</button><button disabled={disabled || !data?.page?.hasMore} onClick={() => read(data!.page!.offset + data!.page!.limit)}>{text.next}</button>{busy && <button disabled={closeBusy} onClick={() => { if (renderCurrent() && !closing.current) void reader.stop().catch(failure => { if (alive.current) setError(errorMessage(failure)); }); }}>{text.stop}</button>}</div>
    <ErrorBox message={invalid ? text.stale : error}/>{busy && <Spinner text={text.loading}/>}{data?.page && <><p>{data.page.target.table} · {data.referencedColumns?.join(', ')} · {data.page.offset + 1}–{data.page.offset + data.page.result.rows.length}</p>{!data.page.result.rows.length && <p role="status">{text.empty}</p>}<div className="reference-grid"><ResultsGrid columns={data.page.result.columns} rows={data.page.result.rows} selectionScope={data.page} isCurrent={() => reader.current() && !busy} binaryFileActions={false} onActiveRowChange={choosing ? row => { if (!actionCurrent() || !data?.page) return; resetSelection(); const index = row ? data.page.result.rows.indexOf(row) : -1; if (index < 0) return; try { const values = sqliteReferenceTuple(data, index); selection.current = { data, index, values }; setChosen(index); setError(''); } catch (failure) { setError(errorMessage(failure)); } } : undefined}/></div></>}
      {choosing && <><p>{chosen === undefined ? text.selectRow : text.selectedRow(chosen + 1)}</p><label><input type="checkbox" checked={clearConfirmed} disabled={disabled || !clearable} onChange={event => { if (actionCurrent()) setClearConfirmed(event.target.checked); }}/>{text.clearConfirm}</label><button disabled={disabled || !clearable || !clearConfirmed} onClick={clear}>{text.clear}</button></>}
  </div><footer className="modal-footer">{choosing && <button disabled={disabled || !editableKey || chosen === undefined} onClick={stage}>{text.stage}</button>}<button disabled={closeBusy} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
