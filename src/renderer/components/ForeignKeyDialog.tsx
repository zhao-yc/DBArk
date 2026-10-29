import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellValue, CommandMap, DataRow, FilterMode, FilterRule, ForeignKeyInfo, SortRule, TableInfo } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { referenceClearable, referenceSignature, referenceTuple, referenceWritable, sourceReference, type ReferenceSnapshot } from '../referenceChanges';
import { referenceZh as text } from '../locales/references.zh-CN';
import { zh } from '../locales/zh-CN';
import { parsePageJump, maxTablePage } from '../tableFilters';
import { TableFilterPanel } from './TableFilterPanel';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import '../references.css';

type ReferencePage = CommandMap['table.referencePage']['output'];
/** 所有记录从有界服务器分页读取；选择只回传经服务器复核的元组。 */
export function ForeignKeyDialog({ base, snapshot, keys, mode, onApply, onClose, onActivity }: { base: { connectionId: string; database: string; table: string }; snapshot: ReferenceSnapshot; keys: ForeignKeyInfo[]; mode: 'choose' | 'browse'; onApply: (values: CellValue[], source: TableInfo, key: ForeignKeyInfo, expected: ForeignKeyInfo, clear: boolean) => void; onClose: () => void; onActivity: (delta: 1 | -1) => void }) {
  const [keyName, setKeyName] = useState(snapshot.foreignKey.name); const key = keys.find(item => item.name === keyName)!;
  const [data, setData] = useState<ReferencePage | null>(null); const [candidate, setCandidate] = useState<DataRow | null>(null);
  const [targetInfo, setTargetInfo] = useState<TableInfo | null>(null);
  const [pageIndex, setPageIndex] = useState(1); const [jump, setJump] = useState('1'); const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState<FilterRule[]>([]); const [filterMode, setFilterMode] = useState<FilterMode>('all'); const [sort, setSort] = useState<SortRule[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [clearConfirm, setClearConfirm] = useState(false); const [refresh, setRefresh] = useState(0);
  const alive = useRef(true); const generation = useRef(0); const pending = useRef(new Set<string>()); const verifying = useRef(false); const activity = useRef(onActivity); activity.current = onActivity;
  const match = mode === 'browse' ? referenceTuple(snapshot.data, key.columns) : undefined;
  /** 活动计数直到实际 IPC 请求结束才释放，关闭窗口不能提前放开源标签。 */
  const request = useCallback(async <T,>(reader: (taskId: string) => Promise<T>) => {
    const taskId = uid(); pending.current.add(taskId); activity.current(1);
    try { return await reader(taskId); }
    finally { pending.current.delete(taskId); activity.current(-1); }
  }, []);
  /** 取消复用任务入口，服务器连接释放由引擎的 finally 保证。 */
  const cancel = useCallback(() => { for (const taskId of pending.current) void invoke('query.cancel', { taskId }).catch(() => {}); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; cancel(); }; }, [cancel]);
  useEffect(() => {
    const current = ++generation.current; setCandidate(null); setData(null); setError(''); setBusy(true);
    if (mode === 'browse' && !match) { setError(text.incomplete); setBusy(false); return; }
    void request(taskId => invoke('table.referencePage', { ...base, foreignKeyName: keyName, ...(match ? { matchValues: match } : {}), page: pageIndex, pageSize, filters, filterMode, sort, taskId })).then(next => {
      if (!alive.current || current !== generation.current) return;
      if (referenceSignature(next.foreignKey) !== referenceSignature(key)) throw new Error(text.mappingChanged);
      setData(next); setTargetInfo(next.target);
    }).catch(reason => { if (alive.current && current === generation.current) { setData(null); setCandidate(null); setError(errorMessage(reason)); } }).finally(() => { if (alive.current && current === generation.current) setBusy(false); });
    return () => { generation.current++; cancel(); };
  }, [base, keyName, pageIndex, pageSize, filters, filterMode, sort, refresh, mode, request, cancel]);
  useEffect(() => { setJump(String(pageIndex)); }, [pageIndex]);
  useEffect(() => {
    if (!clearConfirm) return;
    // 把确认区滚动到可见范围并聚焦取消，键盘用户不必寻找内容下方的确认按钮。
    const panel = document.querySelector<HTMLElement>('.reference-content [role="alertdialog"]');
    panel?.scrollIntoView({ block: 'nearest' }); panel?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [clearConfirm]);
  useEffect(() => {
    /** 模态快捷键不能作用于后台网格、SQL 或提交预览。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);
  const selectCandidate = useCallback((row: DataRow | null) => setCandidate(row), []);
  /** 排序回调保持稳定，选择候选行时不重建网格列。 */
  const changeSort = useCallback((next: SortRule[]) => { if (!busy) { setSort(next); setPageIndex(1); } }, [busy]);
  /** 确认前清除用户筛选，精确查询选中元组，核对最新定义及父记录仍存在。 */
  async function confirm(clear = false) {
    if (busy || verifying.current || (!clear && !data) || mode !== 'choose') return;
    const values = clear ? key.columns.map(() => null) : candidate && data ? referenceTuple(candidate, data.foreignKey.referencedColumns) : null;
    if (!values) { setError(candidate ? text.nullParent : text.selectRow); return; }
    verifying.current = true; setBusy(true); setError('');
    try {
      if (clear) {
        // 清空关联不读取父表：只复核最新源约束与可空字段，父表 SELECT 权限不是必要条件。
        const source = await request(taskId => invoke('metadata.table', { ...base, taskId }));
        if (!alive.current) return;
        const latest = source.foreignKeys.find(item => item.name === keyName);
        if (!latest) throw new Error(text.mappingChanged);
        const canonical = sourceReference(source, latest);
        if (referenceSignature(canonical) !== referenceSignature(key)) throw new Error(text.mappingChanged);
        onApply(values, source, canonical, key, true);
      } else {
        const next = await request(taskId => invoke('table.referencePage', { ...base, foreignKeyName: keyName, matchValues: values, page: 1, pageSize: 50, filters: [], filterMode: 'all', sort: [], taskId }));
        if (!alive.current) return;
        if (referenceSignature(next.foreignKey) !== referenceSignature(key) || !next.page.rows.some(row => JSON.stringify(referenceTuple(row, next.foreignKey.referencedColumns)) === JSON.stringify(values))) throw new Error(text.missingParent);
        onApply(values, next.source, next.foreignKey, key, false);
      }
      onClose();
    } catch (reason) { if (alive.current) { setError(errorMessage(reason)); setCandidate(null); setData(null); setClearConfirm(false); } }
    finally { verifying.current = false; if (alive.current) setBusy(false); }
  }
  /** 关闭后继续追踪未结束请求，不向已卸载组件写状态。 */
  function close() { alive.current = false; generation.current++; cancel(); onClose(); }
  const writable = mode === 'choose' && referenceWritable(data?.source ?? snapshot.source, key);
  const canClear = writable && referenceClearable(data?.source ?? snapshot.source, key);
  return <Modal title={mode === 'choose' ? text.choose : text.browse} wide onClose={close}><div className="modal-content reference-content">
    <UsageHelp><p>{mode === 'choose' ? text.hint : text.browseHint}</p></UsageHelp>
    <Field label={text.constraint}><select disabled={busy} value={keyName} onChange={event => { setKeyName(event.target.value); setPageIndex(1); setFilters([]); setSort([]); setClearConfirm(false); }}>{keys.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></Field>
    <p>{text.target}：{key.referencedDatabase}.{key.referencedTable}</p><p className="reference-mapping">{text.mapping}：{key.columns.map((column, index) => `${column} → ${key.referencedColumns[index]}`).join('，')}</p>
    <TableFilterPanel columns={(targetInfo?.columns ?? []).map(column => column.name)} filters={filters} mode={filterMode} disabled={busy || !data} onFiltersChange={next => { if (busy) return false; setFilters(next); setPageIndex(1); return true; }} onModeChange={next => { if (busy) return false; setFilterMode(next); setPageIndex(1); return true; }}/>
    <ErrorBox message={error}/>{busy && <Spinner text={text.loading}/>}
    {data && <div className="reference-grid"><ResultsGrid columns={data.page.columns} rows={data.page.rows} onActiveRowChange={selectCandidate} sort={sort} onSortChange={changeSort}/></div>}
    {data && !data.page.rows.length && <p>{text.empty}</p>}
    <div className="reference-pagination"><button disabled={busy || pageIndex === 1} aria-label={text.previous} onClick={() => setPageIndex(index => index - 1)}>{zh.common.pagePrevious}</button><form onSubmit={event => { event.preventDefault(); try { if (!busy) setPageIndex(parsePageJump(jump)); } catch (reason) { setError(errorMessage(reason)); } }}><input aria-label={text.page} value={jump} disabled={busy} onChange={event => setJump(event.target.value)}/><button disabled={busy} type="submit">{text.jump}</button></form><button disabled={busy || !data?.page.hasMore || pageIndex >= maxTablePage} aria-label={text.next} onClick={() => setPageIndex(index => index + 1)}>{zh.common.pageNext}</button><select aria-label={text.pageSize} value={pageSize} disabled={busy} onChange={event => { setPageSize(Number(event.target.value)); setPageIndex(1); }}>{[50, 100, 200, 500].map(size => <option key={size}>{size}</option>)}</select><button disabled={busy} onClick={() => setRefresh(value => value + 1)}>{text.refresh}</button>{busy && <button onClick={cancel}>{text.cancelRead}</button>}</div>
    {clearConfirm && <div role="alertdialog" aria-label={text.clear}><p>{text.clearConfirm}</p><button disabled={busy} onClick={() => setClearConfirm(false)}>{zh.common.cancel}</button><button disabled={busy} onClick={() => void confirm(true)}>{text.clear}</button></div>}
  </div><footer className="modal-footer">{mode === 'choose' && <><button disabled={busy || !canClear} onClick={() => setClearConfirm(true)}>{text.clear}</button><button className="primary" disabled={busy || !candidate || !data || !writable || clearConfirm} onClick={() => void confirm()}>{text.use}</button></>}<span className="grow"/><button onClick={close}>{zh.common.close}</button></footer></Modal>;
}
