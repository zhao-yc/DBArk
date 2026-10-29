import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { FILTER_LIMITS } from '../../shared/filtering';
import { tableValueOptionsColumnCapability, tableValueOptionsLimits, tableValueOptionsSearchPattern, type TableValueOptionsInput, type TableValueOptionsOutput } from '../../shared/tableValueOptions';
import { buildTableValueOptionsConditions, checkTableValueOptionsOutput, tableValueOptionsLiteral, type TableValueOptionsConditions } from '../tableValueOptionsUi';
import { errorMessage, uid } from '../lib';
import { tableValueOptionsZh as text } from '../locales/tableValueOptions.zh-CN';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

export interface TableValueOptionsServices { read(input: TableValueOptionsInput): Promise<TableValueOptionsOutput>; cancel(taskId: string): Promise<unknown>; }
export interface TableValueOptionsDialogProps {
  target: { connectionId: string; database: string; table: string }; source: TableInfo; column: string;
  conditions: TableValueOptionsConditions; isCurrent(): boolean; services: TableValueOptionsServices;
  onApply(conditions: TableValueOptionsConditions): boolean; onClose(): void; onCleanupError(message: string): void; onActivity?(delta: 1 | -1): void;
}
type Draft = { column: string; query: string; exclude: boolean; selected: readonly number[]; page: number; receipt?: TableValueOptionsOutput; needsRead?: boolean; problem?: string; prompt?: 'read' | 'close' };
type Operation = { id: string; cancelled: boolean; settled: Promise<void>; cancel?: Promise<void> };

/** 显式服务器读取与本地勾选分离；原Promise终结前始终占有任务门，取消ACK不能提前解锁。 */
export function TableValueOptionsDialog(props: TableValueOptionsDialogProps) {
  const { target, source, column, conditions, services } = props;
  const origin = useRef({ target: { ...target }, source, conditions, services, sourceKey: JSON.stringify(source), conditionsKey: JSON.stringify(conditions) }).current;
  const [draft, setDraft] = useState<Draft>({ column, query: '', exclude: false, selected: [], page: 0 }), live = useRef(draft); live.current = draft;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [composing, setComposing] = useState(false);
  const mounted = useRef(true), invalid = useRef(false), checking = useRef(false), applying = useRef(false), closed = useRef(false), composition = useRef(false), operation = useRef<Operation | undefined>(undefined), latest = useRef(props); latest.current = props;
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  if (source !== origin.source || conditions !== origin.conditions || services !== origin.services || target.connectionId !== origin.target.connectionId || target.database !== origin.target.database || target.table !== origin.target.table) invalid.current = true;
  /** 父守卫失败永久撤销，字段/条件同引用原地漂移也不能在A→B→A后复活。 */
  function current(): boolean {
    if (!mounted.current || closed.current || invalid.current || checking.current) return false;
    checking.current = true; let okay = false;
    try { okay = JSON.stringify(source) === origin.sourceKey && JSON.stringify(conditions) === origin.conditionsKey && latest.current.isCurrent() === true; } catch {} finally { checking.current = false; }
    if (!okay) invalid.current = true;
    return okay && mounted.current && !closed.current && !invalid.current;
  }
  /** 每次输入都换独立草稿身份；迟到DOM、同值ABA和同步重入不能代投递后继动作。 */
  function editable(): boolean {
    const okay = current() && !operation.current && !applying.current && committed.current === ticket && live.current === draft;
    if (!okay && invalid.current && mounted.current && !closed.current && live.current === draft) replace({ ...draft });
    return okay;
  }
  function replace(next: Draft): void { live.current = next; setDraft(next); }
  function problem(reason: unknown): void { if (mounted.current && !closed.current && live.current === draft) replace({ ...draft, problem: errorMessage(reason), prompt: undefined }); }
  /** 取消请求失败只汇报清理错误，原读取仍保持占用直到自己的finally。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.cancelled) return;
    active.cancelled = true;
    active.cancel = Promise.resolve().then(() => origin.services.cancel(active.id)).then(() => undefined).catch(reason => { try { latest.current.onCleanupError(errorMessage(reason)); } catch {} });
    if (mounted.current && !closed.current) replace({ ...live.current, receipt: undefined, selected: [], problem: text.cancelling });
  }
  /** 只有明确读取或明确丢弃确认才调用服务器，不在输入、选列、勾选或父重绘时自动查询。 */
  function read(confirmed = false): void {
    if (!editable() || composition.current) return;
    if (draft.selected.length && !confirmed) { replace({ ...draft, prompt: 'read' }); return; }
    let searchPattern: string | undefined;
    try {
      searchPattern = tableValueOptionsSearchPattern(draft.query);
      const info = source.columns.find(value => value.name === draft.column);
      if (!info || tableValueOptionsColumnCapability(info.type) === 'unsupported') throw Error(text.unsupported);
    } catch (reason) { problem(reason); return; }
    const id = uid(), readColumn = draft.column, query = draft.query;
    const next = { ...draft, receipt: undefined, needsRead: false, selected: [], page: 0, problem: undefined, prompt: undefined }; replace(next);
    let active: Operation;
    const settled = Promise.resolve().then(async () => {
      if (!current() || active.cancelled || operation.current !== active) return;
      const output = await origin.services.read({ ...origin.target, column: readColumn, taskId: id, ...structuredClone(origin.conditions), filters: structuredClone(origin.conditions.filters) as TableValueOptionsInput['filters'], ...(searchPattern === undefined ? {} : { searchPattern }) });
      if (!current() || active.cancelled || operation.current !== active || live.current !== next) return;
      checkTableValueOptionsOutput(origin.source, readColumn, query, output);
      replace({ ...next, receipt: output });
    }).catch(reason => { if (mounted.current && !closed.current && operation.current === active && !active.cancelled && !invalid.current) replace({ ...live.current, problem: errorMessage(reason) }); }).finally(async () => {
      // 读取先终结时也保留取消门；原取消ACK结算前不能重读、关闭或释放父标签占用。
      if (active.cancel) await active.cancel;
      if (operation.current === active) operation.current = undefined;
      latest.current.onActivity?.(-1); if (mounted.current) setBusy(false);
    });
    active = { id, cancelled: false, settled }; operation.current = active; setBusy(true); latest.current.onActivity?.(1);
  }
  /** 搜索或选列保留原候选与勾选供核对，标记待重读；不会误把旧回执作为新搜索结果。 */
  function change(field: 'query' | 'column', value: string): void { if (!editable()) return; replace({ ...draft, [field]: value, needsRead: true, page: 0, prompt: undefined, problem: undefined }); }
  const receiptMatches = !draft.needsRead && !!draft.receipt && draft.receipt.column === draft.column && (draft.receipt.searchPattern ?? '') === draft.query;
  function toggle(id: number, checked: boolean): void {
    if (!editable() || composition.current || !receiptMatches || !draft.receipt?.values[id]) return;
    const next = new Set(draft.selected); if (checked) next.add(id); else next.delete(id);
    if (next.size > FILTER_LIMITS.setValues) { problem(Error(text.selection)); return; }
    replace({ ...draft, selected: [...next], problem: undefined, prompt: undefined });
  }
  /** 全选只涵盖本次实际返回候选；超限整份拒绝，不假装已选择未读取服务器分组。 */
  function selectAll(): void {
    if (!editable() || composition.current || !receiptMatches || !draft.receipt) return;
    if (!draft.receipt.values.length || draft.receipt.values.length > FILTER_LIMITS.setValues) { problem(Error(text.selection)); return; }
    replace({ ...draft, selected: draft.receipt.values.map((_, index) => index), problem: undefined, prompt: undefined });
  }
  /** 完整新条件构造与父源守卫各核一次；父返回false保留本地勾选，不能假报应用成功。 */
  function apply(): void {
    if (!editable() || composition.current || !receiptMatches || !draft.receipt || !draft.selected.length || draft.prompt) return;
    try {
      checkTableValueOptionsOutput(origin.source, draft.column, draft.query, draft.receipt);
      const next = buildTableValueOptionsConditions(origin.conditions, draft.column, draft.selected.map(index => draft.receipt!.values[index].value), draft.exclude, origin.source.columns.find(info => info.name === draft.column)?.type);
      if (!editable()) return;
      applying.current = true; let accepted = false;
      try { accepted = latest.current.onApply(next) === true; } finally { applying.current = false; }
      if (!accepted) { problem(Error(text.rejected)); return; }
      if (mounted.current && !closed.current) { closed.current = true; latest.current.onClose(); }
    } catch (reason) { problem(reason); }
  }
  /** 关闭先确认勾选；运行中发送一次取消，并等待原Promise和取消Promise均结算。 */
  function close(confirmed = false): void {
    if (!mounted.current || closed.current || applying.current || composition.current || committed.current !== ticket || live.current !== draft) return;
    if (draft.selected.length && !confirmed && !operation.current) { replace({ ...draft, prompt: 'close' }); return; }
    closed.current = true; setClosing(true); const active = operation.current; cancel(active);
    void (async () => { if (active) { await active.settled; await active.cancel; } if (mounted.current) latest.current.onClose(); })();
  }
  /** IME每轮开始/结束也换代，旧compositionend不能解锁新一轮输入。 */
  function beginComposition(): void { if (!editable()) return; composition.current = true; setComposing(true); replace({ ...draft }); }
  function endComposition(): void { if (!mounted.current || closed.current || live.current !== draft || committed.current !== ticket) return; composition.current = false; setComposing(false); replace({ ...draft }); }
  /** 禁止模态快捷键穿透触发表页执行；普通Enter不隐式读取服务器。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.altKey && !event.shiftKey) apply();
    }
  }
  useEffect(() => {
    mounted.current = true;
    /** 捕获层统一隔离正文和页脚的后台执行/保存快捷键。 */
    const block = (event: globalThis.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { mounted.current = false; cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const valid = current(), disabled = !valid || busy || closing, options = draft.receipt?.values ?? [], pages = Math.max(1, Math.ceil(options.length / tableValueOptionsLimits.pageSize)), page = Math.min(draft.page, pages - 1), selected = new Set(draft.selected);
  /** 标签仅省略展示，详情和条件构造始终读取服务器完整原值。 */
  function label(value: typeof options[number]['value'], short = false): string { const full = text.value(tableValueOptionsLiteral(value, origin.source.columns.find(info => info.name === draft.receipt?.column)?.type)); return short && full.length > 80 ? full.slice(0, 80) + text.displayTruncated : full; }
  return <Modal title={text.title} wide onClose={() => close()}><div className="modal-content" data-table-value-options-dialog onKeyDown={keyDown} aria-busy={busy || closing}>
    <p>{source.database}.{source.name}</p><p>{text.scope}</p><UsageHelp><p>{text.semantics}</p><p>{text.bounded}</p><p>{text.searchHint}</p></UsageHelp>{tableValueOptionsColumnCapability(source.columns.find(info => info.name === draft.column)?.type ?? '') === 'floating' && <p className="warning-text">{text.approximate}</p>}
    <label>{text.column}<select aria-label={text.column} value={draft.column} disabled={disabled || composing} onChange={event => change('column', event.target.value)}>{source.columns.map(info => <option key={info.name} value={info.name} disabled={tableValueOptionsColumnCapability(info.type) === 'unsupported'}>{info.name} · {info.type}</option>)}</select></label>
    <label>{text.search}<input aria-label={text.search} value={draft.query} disabled={disabled} onChange={event => change('query', event.target.value)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/></label>
    <label>{text.mode}<select aria-label={text.mode} value={draft.exclude ? 'exclude' : 'include'} disabled={disabled || composing} onChange={event => { if (!editable() || composition.current) return; const value = event.target.value; if (value === 'include' || value === 'exclude') replace({ ...draft, exclude: value === 'exclude', prompt: undefined }); }}><option value="include">{text.include}</option><option value="exclude">{text.exclude}</option></select></label>
    {busy && <Spinner text={text.loading}/>}<ErrorBox message={!valid ? text.stale : draft.problem}/>{closing && <p>{text.closing}</p>}
    {draft.receipt && <section aria-label={text.title}><p aria-live="polite">{text.selected(options.length, draft.selected.length)}</p>{!receiptMatches && <p className="warning-text">{text.searchPending}</p>}{draft.receipt.truncated && <p className="warning-text">{text.truncated}</p>}{draft.receipt.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
      <button disabled={disabled || composing || !receiptMatches || !options.length} onClick={selectAll}>{text.selectAll}</button><button disabled={disabled || composing || !draft.selected.length} onClick={() => { if (editable() && !composition.current) replace({ ...draft, selected: [], problem: undefined, prompt: undefined }); }}>{text.clear}</button>
      <div>{options.slice(page * 50, (page + 1) * 50).map((option, index) => { const id = page * 50 + index, full = label(option.value); return <div key={id}><label title={full}><input type="checkbox" aria-label={label(option.value, true)} checked={selected.has(id)} disabled={disabled || composing || !receiptMatches} onChange={event => toggle(id, event.target.checked)}/><code>{label(option.value, true)}</code> <span>{text.count(option.count)}</span></label>{full.length > 80 && <details><summary>{text.complete(id + 1)}</summary><pre>{full}</pre></details>}</div>; })}{!options.length && <p>{text.empty}</p>}</div>
      <button disabled={disabled || composing || page === 0} onClick={() => { if (editable() && !composition.current) replace({ ...draft, page: page - 1 }); }}>{text.previous}</button><span>{text.page(page + 1, pages)}</span><button disabled={disabled || composing || page + 1 >= pages} onClick={() => { if (editable() && !composition.current) replace({ ...draft, page: page + 1 }); }}>{text.next}</button>
    </section>}
    {draft.prompt && <section role="alertdialog" aria-label={draft.prompt === 'read' ? text.discardRead : text.discardClose}><p>{draft.prompt === 'read' ? text.discardRead : text.discardClose}</p><button disabled={disabled || composing} onClick={() => { if (editable()) replace({ ...draft, prompt: undefined }); }}>{text.keep}</button><button disabled={busy || closing || composing} onClick={() => { if (draft.prompt === 'read') read(true); else close(true); }}>{draft.prompt === 'read' ? text.confirmRead : text.confirmClose}</button></section>}
    {composing && <p>{text.composing}</p>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (committed.current === ticket) cancel(); }}>{text.cancelTask}</button>}<span className="grow"/><button disabled={closing || composing} onClick={() => close()}>{text.close}</button><button disabled={disabled || composing} onClick={() => read()}>{draft.receipt ? text.refresh : text.read}</button><button className="primary" disabled={disabled || composing || !receiptMatches || !draft.selected.length || !!draft.prompt} onClick={apply}>{text.apply}</button></footer></Modal>;
}
