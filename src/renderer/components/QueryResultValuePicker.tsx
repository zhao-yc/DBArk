import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { QueryResultFilterGroup, QueryResultFilterRule } from '../queryResultFilter';
import { queryResultValueOptionsLimits, queryResultValueOptionsNode, searchQueryResultValueOptions, type QueryResultValueOptions } from '../queryResultValueOptions';
import { queryResultValueOptionsZh as text } from '../locales/queryResultValueOptions.zh-CN';
import { UsageHelp, ErrorBox  } from './ui';

type Draft = { query: string; mode: 'include' | 'exclude'; selected: readonly number[]; page: number; problem?: string };
/** 不同值勾选只写入所属条件草稿；源捕获、父级租约和每次草稿身份共同拒绝迟到事件。 */
export function QueryResultValuePicker({ capture, isCurrent, onApply, onClose }: { capture: QueryResultValueOptions; isCurrent(): boolean; onApply(node: QueryResultFilterRule | QueryResultFilterGroup): void; onClose(): void }) {
  const owner = useRef(capture), latestCapture = useRef(capture), invalid = useRef(false), closed = useRef(false), mounted = useRef(true), checking = useRef(false), composition = useRef(false), busy = useRef(false);
  const [draft, setDraft] = useState<Draft>({ query: '', mode: 'include', selected: [], page: 0 }), [composing, setComposing] = useState(false), live = useRef(draft);
  live.current = draft; latestCapture.current = capture;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (capture !== owner.current) invalid.current = true;
  /** 首次源失效永久撤销；父守卫同步重入或改动当前草稿也不能借用原事件授权。 */
  function current(expected = draft): boolean {
    if (!mounted.current || invalid.current || closed.current || checking.current || live.current !== expected || busy.current) return false;
    let okay = false; checking.current = true;
    try { okay = isCurrent() === true; } catch {} finally { checking.current = false; }
    if (!okay) invalid.current = true;
    return okay && mounted.current && !invalid.current && live.current === expected;
  }
  /** 事件发现源已失效时立即展示原因；渲染检查本身不调用 setState，旧代次也不能触碰新草稿。 */
  function actionCurrent(): boolean {
    const okay = current();
    if (!okay && invalid.current && mounted.current && !closed.current && live.current === draft) { const next = { ...draft }; live.current = next; setDraft(next); }
    return okay;
  }
  /** 同值输入也产生新代次，防止搜索或勾选经历 ABA 后旧按钮重新生效。 */
  function replace(next: Draft, input = false): void {
    if (!actionCurrent() || composition.current && !input) return;
    live.current = next; setDraft(next);
  }
  /** 错误只改变本组件提示，不修改父条件或已勾选的完整集合。 */
  function problem(reason: unknown): void {
    if (!actionCurrent()) return;
    replace({ ...draft, problem: reason instanceof Error ? reason.message : text.error }, true);
  }
  let matches: readonly number[] = [], searchError: string | undefined;
  const valid = current();
  if (valid) try { matches = searchQueryResultValueOptions(capture, draft.query); } catch (reason) { searchError = reason instanceof Error ? reason.message : text.error; }
  const pages = Math.max(1, Math.ceil(matches.length / 50)), page = Math.min(draft.page, pages - 1), visible = matches.slice(page * 50, (page + 1) * 50), selected = new Set(draft.selected);
  /** 搜索完整匹配成功后才替换原搜索；分页不缩小搜索集合，也不改已勾选值。 */
  function search(query: string): void {
    if (!actionCurrent()) return;
    try { searchQueryResultValueOptions(capture, query); replace({ ...draft, query, page: 0, problem: undefined }, true); } catch (reason) { problem(reason); }
  }
  /** 逐项勾选明确限定 128 种；超出时保留原集合，不静默丢弃已有值。 */
  function toggle(id: number, checked: boolean): void {
    if (!actionCurrent() || composition.current) return;
    const ids = new Set(draft.selected); if (checked) ids.add(id); else ids.delete(id);
    if (ids.size > queryResultValueOptionsLimits.members) { problem(Error(text.selection)); return; }
    replace({ ...draft, selected: [...ids], problem: undefined });
  }
  /** 全选覆盖所有搜索匹配而非当前页；整个并集超限即拒绝，不截取前 128 项。 */
  function selectMatches(): void {
    if (!actionCurrent() || composition.current) return;
    try {
      const ids = [...new Set([...draft.selected, ...searchQueryResultValueOptions(capture, draft.query)])];
      if (ids.length > queryResultValueOptionsLimits.members) throw Error(text.selection);
      replace({ ...draft, selected: ids, problem: undefined });
    } catch (reason) { problem(reason); }
  }
  /** 输入法组合也更新事件代次，旧结束事件不能解除后一轮组合输入的锁。 */
  function beginComposition(): void { if (!actionCurrent()) return; replace({ ...draft }); composition.current = true; setComposing(true); }
  function endComposition(): void {
    if (!mounted.current || closed.current || busy.current || live.current !== draft || latestCapture.current !== capture) return;
    composition.current = false; setComposing(false); const next = { ...draft }; live.current = next; setDraft(next);
  }
  /** 节点构建和父全树校验都可能拒绝；失败保留本地勾选与父草稿，成功才消费本次授权。 */
  function apply(): void {
    if (!actionCurrent() || composition.current || !draft.selected.length) return;
    try {
      const node = queryResultValueOptionsNode(capture, draft.selected, draft.mode);
      if (!actionCurrent()) return;
      busy.current = true;
      try { onApply(node); invalid.current = true; } finally { busy.current = false; }
    } catch (reason) { problem(reason); }
  }
  /** 源已失效仍能关闭自己的选择器；父级再以 owner 身份隔离较新的窗口。 */
  function close(): void {
    if (!mounted.current || closed.current || busy.current || composition.current || live.current !== draft || latestCapture.current !== capture) return;
    closed.current = true; invalid.current = true; onClose();
  }
  /** 单 Esc 只关闭此选择器；组合输入、重复按键也不能冒泡触发父面板提交或关闭。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    const applyKey = event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const closeKey = event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (!applyKey && !closeKey) return;
    const consumed = event.defaultPrevented || event.nativeEvent.defaultPrevented; event.preventDefault(); event.stopPropagation();
    if (consumed || event.repeat || composition.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (applyKey) apply(); else close();
  }
  /** 展示用 JSON 保留空串、引号和换行区别；省略仅影响展示，不修改选值原文。 */
  function label(literal: string | null): string {
    if (literal === null || literal === '') return text.value(literal);
    const json = JSON.stringify(literal); return json.length > 80 ? json.slice(0, 80) + text.displayTruncated : json;
  }
  return <section role="region" aria-label={text.title} className="query-result-value-picker" onKeyDown={keyDown}>
    <strong>{text.title}</strong><p>{text.column(capture.column.name, capture.column.type)}</p><UsageHelp><p>{text.hint}</p><p>{text.shortcuts}</p></UsageHelp>
    <p aria-live="polite">{text.counts(capture.rows, capture.entries.length, matches.length, draft.selected.length)}</p>
    <div className="query-result-value-picker-controls"><label>{text.search}<input aria-label={text.search} value={draft.query} disabled={!valid} onChange={event => search(event.target.value)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/></label>
      <label>{text.mode}<select aria-label={text.mode} value={draft.mode} disabled={!valid || composing} onChange={event => { const mode = event.target.value; if (mode === 'include' || mode === 'exclude') replace({ ...draft, mode, problem: undefined }); }}><option value="include">{text.include}</option><option value="exclude">{text.exclude}</option></select></label>
      <button type="button" disabled={!valid || composing || !!searchError || !matches.length} onClick={selectMatches}>{text.selectMatches}</button><button type="button" disabled={!valid || composing || !draft.selected.length} onClick={() => replace({ ...draft, selected: [], problem: undefined })}>{text.clear}</button></div>
    <div className="query-result-value-picker-list">{visible.map(id => {
      const entry = capture.entries[id], full = text.value(entry.literal), shortened = full.length > 80;
      // 完整只读详情在label之外，展开原生details不会误勾选；同前缀候选可核对真实尾部。
      return <div key={id} className="query-result-value-picker-option-row"><label className="query-result-value-picker-option" title={full}><input type="checkbox" title={full} aria-label={label(entry.literal)} checked={selected.has(id)} disabled={!valid || composing || !!searchError} onChange={event => toggle(id, event.target.checked)}/><code>{label(entry.literal)}</code><span>{text.occurrences(entry.count)}</span></label>{shortened&&<details><summary>{text.completeValue(id+1)}</summary><pre>{full}</pre></details>}</div>;
    })}{!matches.length && !searchError && <p>{text.empty}</p>}</div>
    <div className="query-result-value-picker-pages"><button type="button" disabled={!valid || composing || page === 0 || !!searchError} onClick={() => replace({ ...draft, page: page - 1, problem: undefined })}>{text.previous}</button><span>{text.page(page + 1, pages)}</span><button type="button" disabled={!valid || composing || page + 1 >= pages || !!searchError} onClick={() => replace({ ...draft, page: page + 1, problem: undefined })}>{text.next}</button></div>
    <ErrorBox message={!valid ? text.stale : searchError ?? draft.problem}/><div className="query-result-filter-actions">{composing && <span>{text.composing}</span>}<button type="button" disabled={composing} onClick={close}>{text.cancel}</button><button type="button" className="primary" aria-keyshortcuts="Control+Enter Meta+Enter" disabled={!valid || composing || !!searchError || !draft.selected.length} onClick={apply}>{text.apply}</button></div>
  </section>;
}
