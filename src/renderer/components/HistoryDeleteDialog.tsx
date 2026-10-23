import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HistoryDeleteApplyOutput, HistoryDeletePreviewInput, HistoryDeletePreviewOutput } from '../../shared/historyDelete';
import { HistoryDeleteIntent, checkHistoryDeleteApply, checkHistoryDeletePreview } from '../historyDeleteUi';
import { historyDeleteZh as text } from '../locales/historyDelete.zh-CN';
import { historyPagesZh as historyText } from '../locales/historyPages.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';

export interface HistoryDeleteServices {
  preview(input: HistoryDeletePreviewInput): Promise<HistoryDeletePreviewOutput>;
  apply(input: { previewToken: string }): Promise<HistoryDeleteApplyOutput>;
  release(input: { previewToken: string }): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
}
const services: HistoryDeleteServices = {
  preview: input => invoke('history.deletePreview', input), apply: input => invoke('history.deleteApply', input),
  release: input => invoke('history.deleteRelease', input), cancel: taskId => invoke('query.cancel', { taskId }),
};
interface Props {
  intent: HistoryDeleteIntent; services?: HistoryDeleteServices; onClose(): void;
  onDeleted(output: HistoryDeleteApplyOutput, sourceCurrent: boolean): void | Promise<void>;
  onCleanupError(message: string): void;
}
type Operation = { kind: 'preview' | 'apply'; taskId?: string; promise: Promise<void>; cancelled: boolean; cancel?: Promise<void> };

/** 本地清理先预览后确认；原任务、原取消和原令牌都收尾后才释放窗口。 */
export function HistoryDeleteDialog({ intent, services: port = services, ...callbacks }: Props) {
  const owner = useRef({ intent, port, callbacks }).current;
  const [preview, setPreview] = useState<HistoryDeletePreviewOutput>(), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState(''), [acknowledged, setAcknowledged] = useState(false), [stale, setStale] = useState(false), [clock, setClock] = useState(Date.now());
  const mounted = useRef(true), closed = useRef(false), operation = useRef<Operation | undefined>(undefined), token = useRef<string | undefined>(undefined), consumed = useRef(false), dispatched = useRef(false), started = useRef(false), cancelled = useRef(false), committed = useRef<object | undefined>(undefined), invalid = useRef(false), output = useRef<HistoryDeleteApplyOutput | undefined>(undefined), releasing = useRef<Promise<void> | undefined>(undefined);
  const ticket = {};
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  if (owner.intent !== intent || owner.port !== port) invalid.current = true;
  /** 任何旧渲染回调或来源ABA都不能重新取得确认权。 */
  function current(): boolean {
    const okay = mounted.current && !closed.current && !invalid.current && owner.intent.current();
    if (!okay && !closed.current && mounted.current) { invalid.current = true; setStale(true); }
    return okay;
  }
  function cleanup(reason: unknown): void { try { owner.callbacks.onCleanupError(errorMessage(reason)); } catch {} }
  /** 失败保留原令牌供明确关闭重试释放，不允许再应用或重新匹配。 */
  async function release(): Promise<void> {
    if (releasing.current) return releasing.current;
    const value = token.current; if (!value || (consumed.current && dispatched.current)) return;
    const promise = owner.port.release({ previewToken: value }).then(() => { if (token.current === value) token.current = undefined; });
    releasing.current = promise;
    try { await promise; } finally { if (releasing.current === promise) releasing.current = undefined; }
  }
  /** 取消ACK与预览完成不是同一事件；每个任务最多发出一次取消。 */
  function cancel(active = operation.current): void {
    if (!active || active.kind !== 'preview' || !active.taskId || active.cancelled) return;
    active.cancelled = true; cancelled.current = true;
    active.cancel = Promise.resolve().then(() => owner.port.cancel(active.taskId!)).then(() => undefined).catch(cleanup);
    if (mounted.current && !closed.current) setError(text.cancelling);
  }
  /** 显式读取完整删除范围；不会在打开弹窗、取消或失败后自动重试。 */
  function read(): void {
    if (committed.current !== ticket || operation.current || started.current || !current()) return;
    let input: HistoryDeletePreviewInput;
    try { input = owner.intent.input(uid()); } catch (reason) { setError(errorMessage(reason)); return; }
    started.current = true; setBusy(true); setError(''); let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active || active.cancelled) return;
      const result = await owner.port.preview(input);
      // 即使已关闭、取消或概要核验失败，也必须释放实际返回的原令牌。
      if (typeof result?.previewToken === 'string') token.current = result.previewToken;
      const checked = checkHistoryDeletePreview(result, input.scope.kind);
      if (!current() || operation.current !== active || active.cancelled) return;
      setPreview(checked); setClock(Date.now());
    }).catch(reason => { if (mounted.current && !closed.current) setError(errorMessage(reason)); }).finally(async () => {
      if (active.cancel) await active.cancel;
      if (active.cancelled || closed.current || invalid.current || !mounted.current) {
        try { await release(); } catch (reason) { cleanup(reason); if (mounted.current && !closed.current) setError(errorMessage(reason)); }
      }
      if (operation.current === active) operation.current = undefined;
      if (mounted.current) { setBusy(false); if (active.cancelled && !closed.current) setError(text.cancelled); }
    });
    active = { kind: 'preview', taskId: input.taskId, promise, cancelled: false }; operation.current = active;
  }
  /** 令牌在第一次调用前消费；双击、迟到事件和失败都不能重发同一删除。 */
  function apply(): void {
    if (committed.current !== ticket || operation.current || consumed.current || cancelled.current || !acknowledged || !preview || !preview.count || !current()) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { setError(text.expired); return; }
    if (token.current !== preview.previewToken) { setError(text.invalid); return; }
    consumed.current = true; setBusy(true); setError(''); let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active) return;
      dispatched.current = true;
      output.current = checkHistoryDeleteApply(await owner.port.apply({ previewToken: preview.previewToken }));
    }).catch(reason => { if (mounted.current && !closed.current) setError(`${errorMessage(reason)} ${text.consumed}`); }).finally(async () => {
      if (operation.current === active) operation.current = undefined;
      if (mounted.current) setBusy(false);
      if (output.current) {
        const result = output.current; output.current = undefined;
        try { await owner.callbacks.onDeleted(result, mounted.current && !invalid.current && owner.intent.current()); }
        catch (reason) { cleanup(reason); if (mounted.current && !closed.current) setError(errorMessage(reason)); }
      }
    });
    active = { kind: 'apply', promise, cancelled: false }; operation.current = active;
  }
  /** 返回保留原页与选择；运行中只等待原操作，不能靠取消ACK提前关闭。 */
  function close(): void {
    if (!mounted.current || closed.current || committed.current !== ticket) return;
    closed.current = true; cancelled.current = true; setClosing(true); const active = operation.current; cancel(active);
    void (async () => {
      try { if (active) { await active.promise; await active.cancel; } await release(); if (mounted.current) owner.callbacks.onClose(); }
      catch (reason) { cleanup(reason); if (mounted.current) { closed.current = false; setClosing(false); setError(errorMessage(reason)); } }
    })();
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = owner.intent.subscribe(() => { invalid.current = true; if (mounted.current) setStale(true); cancel(); });
    const interval = setInterval(() => { if (mounted.current) setClock(Date.now()); }, 1000);
    /** 未预期的第二弹窗撤销本次来源；不能把另一确认框当作本窗口的确认。 */
    const inspect = () => { const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); if (dialogs.length !== 1 || !dialogs[0].querySelector('[data-history-delete-dialog]')) owner.intent.invalidate(); };
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(inspect) : undefined;
    observer?.observe(document.body, { childList: true, subtree: true }); inspect();
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { mounted.current = false; unsubscribe(); observer?.disconnect(); clearInterval(interval); document.removeEventListener('keydown', block, true); const active = operation.current; cancel(active); void (async () => { if (active) { await active.promise; await active.cancel; } await release(); })().catch(cleanup); };
  }, []);
  const expired = !!preview && Date.parse(preview.expiresAt) <= clock, disabled = busy || closing || stale || invalid.current;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" data-history-delete-dialog aria-busy={busy || closing}>
    <p>{owner.intent.scope.kind === 'filtered' ? text.fullScope : text.selectedScope(owner.intent.scope.records.length)}</p>
    {owner.intent.scope.kind === 'filtered' && <section aria-label={text.conditions}><strong>{text.conditions}</strong><dl>
      <dt>{historyText.search}</dt><dd>{owner.intent.scope.filters.search || text.unlimited}</dd>
      <dt>{historyText.fields}</dt><dd>{owner.intent.scope.filters.fields.map(field => field === 'sql' ? historyText.sql : historyText.error).join('、')}</dd>
      <dt>{historyText.scope}</dt><dd>{owner.intent.scope.filters.scope.kind === 'connection' ? `${text.connection} ${owner.intent.scope.filters.scope.connectionId}` : owner.intent.scope.filters.scope.kind === 'unbound' ? historyText.unbound : historyText.all}</dd>
      <dt>{historyText.status}</dt><dd>{owner.intent.scope.filters.status === 'all' ? historyText.allStatus : owner.intent.scope.filters.status === 'success' ? historyText.success : historyText.failed}</dd>
      <dt>{historyText.timeRange}</dt><dd>{owner.intent.scope.filters.timeRange?.from || text.unlimited} ≤ {text.startedAt} ＜ {owner.intent.scope.filters.timeRange?.until || text.unlimited}</dd>
      <dt>{historyText.durationRange}</dt><dd>{owner.intent.scope.filters.durationRange?.minMs ?? text.unlimited} ≤ {text.durationMs} ≤ {owner.intent.scope.filters.durationRange?.maxMs ?? text.unlimited}</dd>
    </dl></section>}
    <p className="warning-text">{text.risk}</p>
    {!started.current && <button disabled={disabled} onClick={read}>{text.preview}</button>}
    {busy && <Spinner text={operation.current?.kind === 'apply' ? text.applying : text.previewing}/>}{closing && <p>{text.closing}</p>}
    {preview && <><p role="status">{text.summary(preview.count, preview.scanned)}</p><section aria-label={text.samples}><strong>{text.samples}</strong>{preview.samples.map(sample => <article key={sample.entry.id} data-history-delete-sample={sample.entry.id}><p>{sample.entry.startedAt} · {sample.entry.success ? '✓' : '✗'}</p><pre>{sample.sqlPreview}{sample.previewTruncated ? '…' : ''}</pre></article>)}</section>{!preview.count && <p>{text.noSamples}</p>}<label className="inline-field"><input type="checkbox" aria-label={text.acknowledge} disabled={disabled || expired || !preview.count || consumed.current || cancelled.current} checked={acknowledged} onChange={event => { if (committed.current === ticket && !operation.current && current()) setAcknowledged(event.target.checked); }}/>{text.acknowledge}</label></>}
    <ErrorBox message={stale || invalid.current ? text.stale : expired ? text.expired : error}/>
  </div><footer className="modal-footer"><button disabled={closing} onClick={close}>{text.cancel}</button><span className="grow"/>{busy && operation.current?.kind === 'preview' && <button disabled={closing || operation.current.cancelled} onClick={() => { if (committed.current === ticket) cancel(); }}>{text.cancelPreview}</button>}<button className="danger" disabled={disabled || expired || !preview?.count || !acknowledged || consumed.current || cancelled.current} onClick={apply}>{text.confirm}</button></footer></Modal>;
}
