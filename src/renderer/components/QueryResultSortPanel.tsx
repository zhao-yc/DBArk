import { useLayoutEffect, useRef, useState } from 'react';
import { queryResultSortSupportsIgnoreCase, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { queryResultSortZh as text } from '../locales/queryResultSort.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';

type Entry = { id: number; rule: QueryResultSortRule };
const pageSize = 10;

/** 草稿只复制规则，不读取单元格；全部比较仍在父层原控制器的一次明确应用中执行。 */
export function QueryResultSortPanel({ binding, initial, isCurrent, onApply, onClose }: { binding: QueryResultSortBinding; initial: QueryResultSortView; isCurrent(): boolean; onApply(rules: QueryResultSortRule[]): boolean; onClose(): void }) {
  const sequence = useRef(0), [entries, setEntries] = useState<Entry[]>(() => initial.rules.map(rule => ({ id: sequence.current++, rule: { ...rule } })));
  const [page, setPage] = useState(0), [error, setError] = useState(''), [composing, setComposing] = useState(false);
  const live = useRef(entries), render = useRef<object | null>(null), ticket = {}, invalid = useRef(false), consumed = useRef(false), composition = useRef(false); live.current = entries;
  useLayoutEffect(() => { render.current = ticket; return () => { if (render.current === ticket) render.current = null; }; });
  /** 首次环境失效后不复活；旧渲染、组合输入和连点不能提交下一代草稿。 */
  function current(): boolean {
    if (render.current !== ticket || live.current !== entries || invalid.current || consumed.current || composition.current) return false;
    let okay = false; try { okay = isCurrent() === true; } catch { /* 上层校验失败也只保留旧视图。 */ }
    if (!okay) { invalid.current = true; setError(text.stale); }
    return okay;
  }
  /** 元数据准入与原控制器一致；不猜重复显示名，也不让隐藏字段或二进制进入规则。 */
  function validate(next: Entry[]): QueryResultSortRule[] {
    if (next.length > binding.visible.length || new Set(next.map(item => item.rule.column)).size !== next.length) throw Error(text.rules);
    return next.map(({ rule }) => {
      const column = binding.visible.find(item => item.key === rule.column);
      if (!column || !binding.reasons.has(column.key) || binding.reasons.get(column.key) || !['ASC', 'DESC'].includes(rule.direction)) throw Error(text.type);
      if (rule.nulls !== undefined && rule.nulls !== 'FIRST' && rule.nulls !== 'LAST') throw Error(text.nullsInvalid);
      if (rule.ignoreCase !== undefined && (typeof rule.ignoreCase !== 'boolean' || !queryResultSortSupportsIgnoreCase(column))) throw Error(text.caseInvalid);
      return { ...rule };
    });
  }
  /** 编辑仅更新自有规则和页码；旧回调不能覆盖后来输入或撤销新面板。 */
  function edit(next: Entry[], nextPage = page): void {
    if (!current()) return;
    try { validate(next); live.current = next; setEntries(next); setPage(Math.max(0, Math.min(nextPage, Math.ceil(next.length / pageSize) - 1))); setError(''); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 跨页移动仍保留完整规则顺序、方向及空值和文本选项。 */
  function move(index: number, offset: number): void {
    const destination = index + offset; if (destination < 0 || destination >= entries.length) return;
    const next = [...entries], [item] = next.splice(index, 1); next.splice(destination, 0, item); edit(next, Math.floor(destination / pageSize));
  }
  /** 只有父层完整排序成功才关闭；预算或数据漂移拒绝时原生效视图不变。 */
  function apply(): void {
    if (!current()) return;
    try { const rules = validate(entries); consumed.current = true; if (!onApply(rules)) { consumed.current = false; setError(text.panelDeclined); } }
    catch (reason) { consumed.current = false; setError(errorMessage(reason)); }
  }
  const disabled = invalid.current || consumed.current || composing;
  const available = binding.visible.filter(column => binding.reasons.has(column.key) && !binding.reasons.get(column.key) && !entries.some(item => item.rule.column === column.key));
  const pages = Math.max(1, Math.ceil(entries.length / pageSize)), currentPage = Math.min(page, pages - 1);
  return <section role="region" aria-label={text.panelTitle} className="filter-panel expanded-filter-panel query-result-sort-panel" onCompositionStart={() => { composition.current = true; setComposing(true); }} onCompositionEnd={() => { composition.current = false; setComposing(false); }}>
    <strong>{text.panelTitle}</strong><p>{text.panelHint}</p><p className="muted">{text.scope} {text.nullsHint}</p>
    {!entries.length && <p>{text.panelEmpty}</p>}
    {entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(({ id, rule }, position) => {
      const index = currentPage * pageSize + position, order = index + 1, column = binding.visible.find(item => item.key === rule.column)!;
      return <div className="filter-inputs" key={id}><span>{order}.</span>
        <label>{text.panelField(order)}<select aria-label={text.panelField(order)} disabled={disabled} value={rule.column} onChange={event => edit(entries.map((item, i) => i === index ? { ...item, rule: { column: event.target.value, direction: item.rule.direction, ...(item.rule.nulls ? { nulls: item.rule.nulls } : {}) } } : item))}>{binding.visible.map((item, i) => <option value={item.key} key={item.key} disabled={!!binding.reasons.get(item.key) || !binding.reasons.has(item.key) || item.key !== rule.column && entries.some(entry => entry.rule.column === item.key)}>{i + 1}. {item.name} · {item.type}</option>)}</select></label>
        <select aria-label={text.panelDirection(order)} disabled={disabled} value={rule.direction} onChange={event => edit(entries.map((item, i) => i === index ? { ...item, rule: { ...item.rule, direction: event.target.value as QueryResultSortRule['direction'] } } : item))}><option value="ASC">{text.ascending}</option><option value="DESC">{text.descending}</option></select>
        <select aria-label={text.panelNulls(order)} disabled={disabled} value={rule.nulls ?? ''} onChange={event => edit(entries.map((item, i) => { if (i !== index) return item; const { nulls, ...base } = item.rule; return { ...item, rule: event.target.value ? { ...base, nulls: event.target.value as 'FIRST' | 'LAST' } : base }; }))}><option value="">{text.nullsDefault}</option><option value="FIRST">{text.nullsFirst}</option><option value="LAST">{text.nullsLast}</option></select>
        {queryResultSortSupportsIgnoreCase(column) && <label title={text.caseHint}><input type="checkbox" aria-label={text.panelCase(order)} disabled={disabled} checked={rule.ignoreCase === true} onChange={event => edit(entries.map((item, i) => { if (i !== index) return item; const { ignoreCase, ...base } = item.rule; return { ...item, rule: event.target.checked ? { ...base, ignoreCase: true } : base }; }))}/>{text.ignoreCaseLabel}</label>}
        <button type="button" aria-label={text.panelEarlier(order)} disabled={disabled || !index} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={text.panelLater(order)} disabled={disabled || index === entries.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={text.panelRemove(order)} disabled={disabled} onClick={() => edit(entries.filter((_, i) => i !== index))}>×</button>
      </div>;
    })}
    {pages > 1 && <div className="filter-inputs"><button type="button" disabled={disabled || !currentPage} onClick={() => { if (current()) setPage(currentPage - 1); }}>{text.panelPrevious}</button><span>{text.panelPage(currentPage + 1, pages)}</span><button type="button" disabled={disabled || currentPage + 1 >= pages} onClick={() => { if (current()) setPage(currentPage + 1); }}>{text.panelNext}</button></div>}
    <ErrorBox message={error}/><div className="filter-inputs"><button type="button" disabled={disabled || !available.length} onClick={() => edit([...entries, { id: sequence.current++, rule: { column: available[0].key, direction: 'ASC' } }], Math.floor(entries.length / pageSize))}>{text.panelAdd}</button><button type="button" disabled={disabled || !entries.length} onClick={() => edit([])}>{text.panelClear}</button><span className="grow"/><button type="button" disabled={composing} onClick={() => { if (render.current === ticket && live.current === entries && !composition.current && !consumed.current) { consumed.current = true; onClose(); } }}>{text.panelCancel}</button><button type="button" className="primary" disabled={disabled} onClick={apply}>{text.panelApply}</button></div>
  </section>;
}
