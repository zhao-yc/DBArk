import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { buildTableQueryTemplate, tableQueryTemplateColumns, tableQueryTemplateKinds, type TableQueryTemplateKind, type TableQueryTemplateOptions } from '../tableQueryTemplate';
import { tableQueryTemplateZh as text } from '../locales/tableQueryTemplate.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

const columnsPerPage = 50;
interface Selection { kind: TableQueryTemplateKind; columns: readonly string[]; search: string; page: number; }

/** 无法准入的类型仍可切换以显示模型错误；不能自行猜测另一组可写字段。 */
function defaultColumns(info: TableInfo, kind: TableQueryTemplateKind): string[] {
  try { return tableQueryTemplateColumns(info, kind); } catch { return []; }
}

/** 只预览当前结构的SQL，动作保留单次身份；不会读取数据库或操作原表页草稿。 */
export function TableQueryTemplateDialog({ info, limit, isCurrent, onOpen, onClose }: {
  info: TableInfo; limit: number; isCurrent(): boolean;
  onOpen(sql: string, kind: TableQueryTemplateKind, options?: TableQueryTemplateOptions): boolean; onClose(): void;
}) {
  const [selection, setSelection] = useState<Selection>(() => ({ kind: 'SELECT', columns: defaultColumns(info, 'SELECT'), search: '', page: 1 })), [error, setError] = useState('');
  const selectionRef = useRef(selection), live = useRef<object | null>(null), consumed = useRef(false), invalid = useRef(false), ticket = {};
  const { kind, columns, search } = selection;
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = null; }; });
  const candidates = useMemo(() => {
    try { return { columns: tableQueryTemplateColumns(info, kind), error: '' }; }
    catch (reason) { return { columns: [] as string[], error: reason instanceof Error ? reason.message : text.invalid }; }
  }, [info, kind]);
  const preview = useMemo(() => {
    // 默认字段及其顺序完全一致时保持旧调用合同；显式选择的只读快照同时供预览和打开使用。
    const defaults = columns.length === candidates.columns.length && columns.every((name, index) => name === candidates.columns[index]);
    const options = kind === 'DELETE' || defaults ? undefined : Object.freeze({ columns: Object.freeze([...columns]) });
    try { return { value: buildTableQueryTemplate(info, kind, limit, options), options, error: '' }; }
    catch (reason) { return { value: undefined, options, error: reason instanceof Error ? reason.message : text.invalid }; }
  }, [info, kind, limit, columns, candidates]);
  const selected = useMemo(() => new Map(columns.map((name, index) => [name, index])), [columns]);
  const visible = useMemo(() => [...columns, ...candidates.columns.filter(name => !selected.has(name))].filter(name => name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [columns, candidates, selected, search]);
  const totalPages = Math.max(1, Math.ceil(visible.length / columnsPerPage)), page = Math.min(selection.page, totalPages);
  const pageColumns = visible.slice((page - 1) * columnsPerPage, page * columnsPerPage);

  /** 每个事件核原窗口、同轮选择身份及上层结构租约；父结构失效后不能通过选回原值复活。 */
  function current(): boolean {
    if (invalid.current || consumed.current || live.current !== ticket || selectionRef.current !== selection) return false;
    let valid = false;
    try { const dialogs = document.querySelectorAll('[role="dialog"]'); valid = isCurrent() && dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === text.title; } catch {}
    if (!valid) { invalid.current = true; setError(text.changed); }
    return valid;
  }
  /** 先同步换掉身份再排队渲染，阻止同一轮旧打开、旧排序、旧分页回调操作新选项。 */
  function revise(next: Selection): void {
    if (!current()) return;
    selectionRef.current = next; setSelection(next); setError('');
  }
  /** 切换模板一次性恢复该类型默认列和第一页，不把另一模板的写列资格沿用过来。 */
  function changeKind(value: string): void {
    if (!tableQueryTemplateKinds.includes(value as TableQueryTemplateKind)) return;
    const nextKind = value as TableQueryTemplateKind;
    revise({ kind: nextKind, columns: defaultColumns(info, nextKind), search: '', page: 1 });
  }
  /** 勾选追加到完整输出顺序末尾，取消只移除这一列；搜索不参与SQL字段准入。 */
  function choose(name: string, checked: boolean): void {
    if (!candidates.columns.includes(name)) return;
    revise({ ...selection, columns: checked ? selected.has(name) ? columns : [...columns, name] : columns.filter(value => value !== name), page: 1 });
  }
  /** 对完整已选序列相邻交换；搜索隐藏的字段仍保留次序，移动后跟随该字段所在列表页。 */
  function move(name: string, direction: -1 | 1): void {
    const index = selected.get(name), nextIndex = index === undefined ? -1 : index + direction;
    if (index === undefined || nextIndex < 0 || nextIndex >= columns.length) return;
    const next = [...columns]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    const filtered = next.filter(value => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    revise({ ...selection, columns: next, page: Math.floor(filtered.indexOf(name) / columnsPerPage) + 1 });
  }
  /** 关闭可以清理失效窗口，但迟到的旧窗口回调不能关闭当前的新选择。 */
  function close(): void { if (live.current === ticket && selectionRef.current === selection) onClose(); }
  /** 原子消费打开动作；预览与回调共享冻结选列，默认预览继续只传原有两个参数。 */
  function open(): void {
    if (!current() || !preview.value) return;
    consumed.current = true;
    try {
      const accepted = preview.options === undefined ? onOpen(preview.value.sql, kind) : onOpen(preview.value.sql, kind, preview.options);
      if (!accepted) { invalid.current = true; setError(text.changed); }
    } catch (reason) { consumed.current = false; setError(reason instanceof Error ? reason.message : text.changed); }
  }

  return <Modal title={text.title} wide onClose={close}><div className="modal-content">
    <p className="muted">{text.hint}</p>
    <Field label={text.kind}><select aria-label={text.kind} value={kind} onChange={event => changeKind(event.target.value)}>{tableQueryTemplateKinds.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
    {kind !== 'DELETE' && !candidates.error && <section aria-label={text.columns} style={{ marginTop: 16 }}>
      <strong>{text.columns}</strong><p className="muted">{text.columnsHint}</p>
      {kind === 'INSERT' && <p className="muted">{text.insertColumnsHint}</p>}
      {kind === 'UPDATE' && <p className="muted">{text.updateColumnsHint}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input aria-label={text.filterColumns} placeholder={text.filterColumns} value={search} maxLength={64} onChange={event => revise({ ...selection, search: event.target.value, page: 1 })}/>
        <button onClick={() => revise({ ...selection, columns: candidates.columns, search: '', page: 1 })}>{text.resetColumns}</button>
        <button onClick={() => revise({ ...selection, columns: [], page: 1 })}>{text.clearColumns}</button>
        <span className="muted">{text.columnsCount(columns.length, candidates.columns.length)}</span>
      </div>
      <div style={{ maxHeight: 270, overflow: 'auto', border: '1px solid var(--line)', padding: '4px 10px', borderRadius: 6 }}>
        {pageColumns.map(name => {
          const index = selected.get(name);
          return <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line-soft)' }}>
            <span className="muted" style={{ minWidth: 30 }}>{index === undefined ? '—' : index + 1}</span>
            <label className="check" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><input type="checkbox" aria-label={text.chooseColumn(name)} checked={index !== undefined} onChange={event => choose(name, event.target.checked)}/>{name}</label>
            <button aria-label={text.moveColumnUp(name)} title={text.moveColumnUp(name)} disabled={index === undefined || index === 0} onClick={() => move(name, -1)}>{text.moveUp}</button>
            <button aria-label={text.moveColumnDown(name)} title={text.moveColumnDown(name)} disabled={index === undefined || index === columns.length - 1} onClick={() => move(name, 1)}>{text.moveDown}</button>
          </div>;
        })}
        {!pageColumns.length && <p className="muted">{text.columnsEmpty}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button disabled={page <= 1} onClick={() => revise({ ...selection, page: page - 1 })}>{text.columnsPrevious}</button>
        <span aria-live="polite">{text.columnsPage(page, totalPages)}</span>
        <button disabled={page >= totalPages} onClick={() => revise({ ...selection, page: page + 1 })}>{text.columnsNext}</button>
      </div>
    </section>}
    {preview.value && <><p>{preview.value.parameters ? text.parameters(preview.value.parameters) : kind === 'SELECT' ? text.selectHint : text.noParameters}</p><pre className="sql-preview" aria-label={text.preview}>{preview.value.sql}</pre></>}
    <ErrorBox message={error || preview.error}/>
  </div><footer className="modal-footer"><button onClick={close}>{text.close}</button><span className="grow"/><button className="primary" disabled={!preview.value || !!error} onClick={open}>{text.open}</button></footer></Modal>;
}
