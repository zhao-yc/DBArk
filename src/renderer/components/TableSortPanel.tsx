import { useLayoutEffect, useRef, useState } from 'react';
import type { SortRule } from '../../shared/contracts';
import { tableSortZh as text } from '../locales/tableSort.zh-CN';
import { validateTableSort } from '../tableSort';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';

type SortEntry = { id: number; rule: SortRule };

/** 排序草稿独立于已应用状态；只有一次明确应用才能交还父页读取服务器。 */
export function TableSortPanel({ columns, initial, isCurrent, onApply, onClose }: { columns: readonly string[]; initial: readonly SortRule[]; isCurrent(): boolean; onApply(rules: SortRule[]): boolean; onClose(): void }) {
  const sequence = useRef(0);
  const [draft, setDraft] = useState<SortEntry[]>(() => validateTableSort(initial, columns).map(rule => ({ id: sequence.current++, rule }))), [error, setError] = useState('');
  const live = useRef<object | null>(null), invalid = useRef(false), consumed = useRef(false), ticket = {};
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = null; }; });
  /** 旧渲染回调不改变新草稿；上层环境失效后，关闭前不允许恢复应用。 */
  function current(): boolean {
    if (live.current !== ticket || consumed.current || invalid.current) return false;
    if (!isCurrent()) { invalid.current = true; setError(text.stale); return false; }
    return true;
  }
  /** 所有编辑均保留规则顺序，只在本地验证，不发IPC。 */
  function edit(next: SortEntry[]): void {
    if (!current()) return;
    try { validateTableSort(next.map(item => item.rule), columns); setDraft(next); setError(''); } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 优先级移动不改方向和字段；首尾按钮不可越界。 */
  function move(index: number, offset: number): void {
    const destination = index + offset;
    if (destination < 0 || destination >= draft.length) return;
    const next = [...draft], [rule] = next.splice(index, 1); next.splice(destination, 0, rule); edit(next);
  }
  /** 取消父层草稿确认时保留当前排序草稿；成功同步消费，连点不能重复读取。 */
  function apply(): void {
    if (!current()) return;
    try { const next = validateTableSort(draft.map(item => item.rule), columns); consumed.current = true; if (!onApply(next)) { consumed.current = false; setError(text.declined); } }
    catch (reason) { consumed.current = false; setError(errorMessage(reason)); }
  }
  const disabled = invalid.current || consumed.current, available = columns.filter(column => !draft.some(item => item.rule.column === column));
  return <section className="filter-panel expanded-filter-panel" role="region" aria-label={text.title}>
    <strong>{text.title}</strong><p>{text.hint}</p><p className="muted">{text.ties}</p>
    {!draft.length && <p>{text.empty}</p>}
    {draft.map(({ id, rule }, index) => <div className="filter-inputs" key={id}>
      <span>{index + 1}.</span><label>{text.field(index + 1)}<select aria-label={text.field(index + 1)} disabled={disabled} value={rule.column} onChange={event => edit(draft.map((item, position) => position === index ? { ...item, rule: { ...item.rule, column: event.target.value } } : item))}>{columns.map(column => <option key={column} value={column} disabled={column !== rule.column && draft.some(item => item.rule.column === column)}>{column}</option>)}</select></label>
      <label>{text.direction(index + 1)}<select aria-label={text.direction(index + 1)} disabled={disabled} value={rule.direction} onChange={event => edit(draft.map((item, position) => position === index ? { ...item, rule: { ...item.rule, direction: event.target.value as SortRule['direction'] } } : item))}><option value="ASC">{text.asc}</option><option value="DESC">{text.desc}</option></select></label>
      <button type="button" aria-label={text.earlier(index + 1)} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={text.later(index + 1)} disabled={disabled || index === draft.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={text.remove(index + 1)} disabled={disabled} onClick={() => edit(draft.filter((_, position) => position !== index))}>×</button>
    </div>)}
    <ErrorBox message={error}/><div className="filter-inputs"><button type="button" disabled={disabled || !available.length || draft.length >= 20} onClick={() => edit([...draft, { id: sequence.current++, rule: { column: available[0], direction: 'ASC' } }])}>{text.add}</button><button type="button" disabled={disabled || !draft.length} onClick={() => edit([])}>{text.clear}</button><span className="grow"/><button type="button" onClick={onClose}>{text.cancel}</button><button type="button" className="primary" disabled={disabled} onClick={apply}>{text.apply}</button></div>
  </section>;
}
