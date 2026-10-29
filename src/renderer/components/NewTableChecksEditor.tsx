import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableCreateCheck } from '../../shared/tableCreateChecks';
import { NewTableChecksRows } from '../newTableChecksUi';
import { tableCreateChecksZh as text } from '../locales/tableCreateChecks.zh-CN';
import { Field, UsageHelp } from './ui';
import '../tableCreateChecks.css';

/** 仅编辑新表草稿，不连接数据库、不读取目录、不编译或执行SQL。 */
export function NewTableChecksEditor({ checks, disabled = false, isCurrent, onChange }: { checks?: TableCreateCheck[]; disabled?: boolean; isCurrent?(): boolean; onChange(checks: TableCreateCheck[] | undefined): void }) {
  const [identities] = useState(() => new NewTableChecksRows()), empty = useRef<TableCreateCheck[]>([]).current, rows = checks ?? empty, [page, setPage] = useState(0);
  const renderedRows = useRef(rows), issuedRows = useRef(rows); if (renderedRows.current !== rows) { renderedRows.current = rows; issuedRows.current = rows; }
  const host = useRef<HTMLDivElement | null>(null), alive = useRef(false), committed = useRef<object | null>(null), ticket = {}, names = useRef(new Map<string, HTMLInputElement>()), pendingFocus = useRef<string | undefined>(undefined);
  const ports = useRef({ checks, disabled, isCurrent, onChange }); ports.current = { checks, disabled, isCurrent, onChange };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  // 子Modal passive初始化之后才聚焦新添行；普通输入不重新抢焦点或选择区。
  useEffect(() => { const key = pendingFocus.current, input = key ? names.current.get(key) : undefined; if (input && current()) { input.focus(); input.scrollIntoView?.({ block: 'nearest' }); pendingFocus.current = undefined; } }, [rows, page]);
  /** 可见、已提交、原列表和父目标围栏同时成立才可编辑，旧DOM不能借后继props重入。 */
  function current(): boolean {
    const node = host.current; if (!alive.current || committed.current !== ticket || disabled || ports.current.disabled || ports.current.checks !== checks || ports.current.onChange !== onChange || ports.current.isCurrent !== isCurrent || issuedRows.current !== rows || !node || !document.body.contains(node)) return false;
    try { if (ports.current.isCurrent && !ports.current.isCurrent()) return false; } catch { return false; }
    let own: HTMLElement | null = null; for (let element: HTMLElement | null = node; element && element.nodeType === 1; element = element.parentNode as HTMLElement | null) { if (element.hidden || element.getAttribute('hidden') !== null || element.getAttribute('aria-hidden') === 'true' || element.style.display === 'none' || element.style.visibility === 'hidden') return false; if (!own && element.getAttribute('role') === 'dialog') own = element; }
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); return !!own && dialogs[dialogs.length - 1] === own;
  }
  /** 同步先撤销旧列表编辑权，再通知父表单；不能在React提交前覆盖刚产生的新草稿。 */
  function publish(next: TableCreateCheck[] | undefined): void { if (!next || !current()) return; issuedRows.current = next; ports.current.onChange(next.length ? next : undefined); }
  /** 真实行修改后转交稳定key，不根据已改名称寻找原约束。 */
  function patch(row: TableCreateCheck, value: Partial<TableCreateCheck>): void { if (!current()) return; publish(identities.patch(rows, row, value)); }
  /** 添加不填写猜测名称或表达式；生效布尔仅是明确的待提交意图。 */
  function append(): void { if (!current()) return; const next = identities.append(rows); if (!next) return; pendingFocus.current = identities.key(next.added); setPage(Math.floor((next.rows.length - 1) / 50)); publish(next.rows); }
  const lastPage = Math.max(0, Math.ceil(rows.length / 50) - 1), shownPage = Math.min(page, lastPage);
  return <div ref={host} className="new-table-checks"><UsageHelp><p>{text.draft}</p><p>{text.capability}</p><p>{text.nullable}</p><p>{text.budget}</p></UsageHelp><p>{text.count(rows.length)}</p>{!rows.length && <p>{text.empty}</p>}<div className="new-table-checks-list">{rows.slice(shownPage * 50, (shownPage + 1) * 50).map((row, offset) => { const index = shownPage * 50 + offset + 1, key = identities.key(row); return <fieldset className="new-table-checks-row" key={key} aria-label={text.row(index)} disabled={disabled}>
    <Field label={text.name(index)}><input ref={input => { if (input) names.current.set(key, input); else names.current.delete(key); }} aria-label={text.name(index)} value={row.name} disabled={disabled} onChange={event => patch(row, { name: event.target.value })}/></Field><Field label={text.expression(index)}><textarea aria-label={text.expression(index)} value={row.expression} disabled={disabled} onChange={event => patch(row, { expression: event.target.value })}/></Field><label className="check"><input type="checkbox" aria-label={text.enforced(index)} checked={row.enforced} disabled={disabled} onChange={event => patch(row, { enforced: event.target.checked })}/>{row.enforced ? text.enforceIntent : text.notEnforcedIntent}</label><div className="new-table-checks-actions"><button type="button" aria-label={text.up(index)} disabled={disabled || index === 1} onClick={() => publish(identities.move(rows, row, -1))}>{text.up(index)}</button><button type="button" aria-label={text.down(index)} disabled={disabled || index === rows.length} onClick={() => publish(identities.move(rows, row, 1))}>{text.down(index)}</button><button type="button" aria-label={text.remove(index)} disabled={disabled} onClick={() => publish(identities.remove(rows, row))}>{text.remove(index)}</button></div>
  </fieldset>; })}</div><div className="new-table-checks-actions"><button type="button" disabled={disabled || shownPage === 0} onClick={() => { if (current()) setPage(shownPage - 1); }}>{text.previous}</button><span>{text.page(shownPage + 1, lastPage + 1)}</span><button type="button" disabled={disabled || shownPage === lastPage} onClick={() => { if (current()) setPage(shownPage + 1); }}>{text.next}</button><button type="button" disabled={disabled || rows.length >= 512} onClick={append}>{text.add}</button></div></div>;
}
