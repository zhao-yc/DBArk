import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FILTER_LIMITS } from '../../shared/filtering';
import type { TableSelectedFilterProposal } from '../tableSelectedFilter';
import { tableSelectedFilterZh as text } from '../locales/tableSelectedFilter.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';

type EventSignal = { defaultPrevented?: boolean; nativeEvent?: { defaultPrevented?: boolean } };
interface Props { proposal: TableSelectedFilterProposal; isCurrent(): boolean; onApply(): boolean; onClose(): void; }

/** 输入框、可编辑子节点拥有自己的按键；即使将来加入搜索输入也不能误用面板快捷键。 */
function inputTarget(event: KeyboardEvent<HTMLElement>): boolean {
  let node = event.target as HTMLElement | null;
  while (node && node !== event.currentTarget) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable || node.getAttribute?.('contenteditable') === 'true' || node.getAttribute?.('contenteditable') === '') return true;
    node = (node.parentElement ?? node.parentNode) as HTMLElement | null;
  }
  return false;
}

/** 内联审核只展示冻结提案；不会取原表行、执行IPC或在预览时应用条件。 */
export function TableSelectedFilterPanel({ proposal, isCurrent, onApply, onClose }: Props) {
  const origin = useRef(proposal).current, latest = useRef(proposal); latest.current = proposal;
  const [prepared] = useState(() => {
    // 守住展示体积，不把异常超限集合截成看似完整的预览；完整筛选的准入仍由父模型负责。
    if (!Array.isArray(origin.values) || origin.values.length > FILTER_LIMITS.setValues || origin.values.some(value => typeof value !== 'string' || value.length > FILTER_LIMITS.valueLength)) return { valid: false, error: text.budget };
    if (!origin.column || !Number.isSafeInteger(origin.rowCount) || origin.rowCount < 1 || !origin.values.length && !origin.includesNull) return { valid: false, error: text.unavailable };
    return { valid: true, error: '' };
  });
  const [feedback, setFeedback] = useState({ message: prepared.error }), [composing, setComposing] = useState(false), [settled, setSettled] = useState(false);
  const mounted = useRef(true), invalid = useRef(false), consumed = useRef(false), composition = useRef(false), committed = useRef<object | null>(null), ticket = {};
  useLayoutEffect(() => { mounted.current = true; committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  useLayoutEffect(() => () => { mounted.current = false; }, []);

  /** 父级一旦否决或更换提案，原窗口永久失效；相同值或原对象重新传回也不能追认。 */
  function environment(): boolean {
    if (invalid.current || !prepared.valid) return false;
    try { if (latest.current !== origin || !isCurrent()) { invalid.current = true; return false; } }
    catch { invalid.current = true; return false; }
    return true;
  }
  /** 只允许已提交的当前渲染拥有操作权；旧按钮和卸载回调不能操作后继面板。 */
  function ownsRender(): boolean { return mounted.current && committed.current === ticket && latest.current === origin && !consumed.current; }
  /** 应用还需原提案和父来源有效；失败明确显示，不能由旧事件再次授权。 */
  function current(): boolean {
    if (!ownsRender()) return false;
    if (!environment()) { setFeedback({ message: prepared.error || text.unavailable }); return false; }
    return true;
  }
  /** 按钮被上层消费或处于组合输入时保持原状；取消只关闭自己，不改父筛选。 */
  function cancel(event?: EventSignal): void {
    if (event?.defaultPrevented || event?.nativeEvent?.defaultPrevented || !ownsRender() || composition.current) return;
    consumed.current = true; committed.current = null; setSettled(true); onClose();
  }
  /** 同步消费一次尝试；父级否决或抛错保留预览，必须由下一次新事件明确重试。 */
  function apply(event?: EventSignal): void {
    if (event?.defaultPrevented || event?.nativeEvent?.defaultPrevented || !current() || composition.current) return;
    consumed.current = true; committed.current = null;
    try {
      if (onApply()) { setFeedback({ message: '' }); setSettled(true); return; }
      // 每次否决都发布新反馈身份；连续两次相同提示也必须重新取得下一次明确重试的票据。
      consumed.current = false; setFeedback({ message: text.declined });
    } catch (reason) { consumed.current = false; setFeedback({ message: errorMessage(reason) }); }
  }
  /** 仅未消费且不属于输入法或输入控件的明确快捷键生效；额外修饰的Esc不取消。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.nativeEvent?.defaultPrevented || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || composition.current || event.repeat || inputTarget(event) || !ownsRender()) return;
    if (event.key === 'Enter' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); apply(); }
    else if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); cancel(); }
  }
  const valid = environment(), disabled = !valid || composing || settled;
  const semantics = !prepared.valid ? '' : origin.exclude
    ? origin.values.length ? origin.includesNull ? text.excludeValuesNull : text.excludeValues : text.excludeNull
    : origin.values.length ? origin.includesNull ? text.includeValuesNull : text.includeValues : text.includeNull;
  return <section className="filter-panel expanded-filter-panel" role="region" aria-label={text.title} tabIndex={-1} onKeyDown={keyDown}
    onCompositionStart={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && ownsRender()) { composition.current = true; setComposing(true); } }}
    onCompositionEnd={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && ownsRender()) { composition.current = false; setComposing(false); } }}>
    <strong>{text.title}</strong><p>{text.hint}</p>
    {prepared.valid && <>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '5px 14px', margin: '10px 0', overflowWrap: 'anywhere' }}>
        <dt>{text.column}</dt><dd aria-label={text.column} style={{ margin: 0 }}>{origin.column}</dd>
        <dt>{text.rowCount}</dt><dd aria-label={text.rowCount} style={{ margin: 0 }}>{origin.rowCount}</dd>
        <dt>{text.valueCount}</dt><dd aria-label={text.valueCount} style={{ margin: 0 }}>{origin.values.length}</dd>
        <dt>{text.nullState}</dt><dd aria-label={text.nullState} style={{ margin: 0 }}>{origin.includesNull ? text.hasNull : text.noNull}</dd>
      </dl>
      <p aria-label={text.semantics}>{semantics}</p><p>{text.originalAnd}</p><p className="muted">{text.valueHint}</p>
      <div role="list" aria-label={text.values} style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 5, padding: 8 }}>
        {origin.values.map((value, index) => <pre role="listitem" key={index} style={{ margin: '3px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(value)}</pre>)}
        {!origin.values.length && <p>{text.noValues}</p>}
      </div>
      {origin.includesNull && <p aria-label={text.nullValue}>{text.null}</p>}
    </>}
    <p>{text.applyHint}</p><p className="muted">{text.shortcuts}</p>{composing && <p>{text.composing}</p>}
    <ErrorBox message={prepared.error || (!valid && !settled ? text.unavailable : feedback.message)}/>
    <div className="filter-inputs"><span className="grow"/><button type="button" disabled={composing || settled || latest.current !== origin} onClick={cancel}>{text.cancel}</button><button type="button" className="primary" disabled={disabled} onClick={apply}>{text.apply}</button></div>
  </section>;
}
