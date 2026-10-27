import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildRoutineInvocation, type RoutineInvocationMetadata, type RoutineInvocationTarget } from '../../shared/routineInvocation';
import { routineInvocationZh as sharedText } from '../../shared/routineInvocation.zh-CN';
import { errorMessage, uid } from '../lib';
import { useWorkspace } from '../store';
import { RoutineInvocationIntent } from '../routineInvocationIntent';
import { parseRoutineInvocationForTarget, routineInvocationServices, type RoutineInvocationServices } from '../routineInvocationServices';
import { routineInvocationZh as text } from '../locales/routineInvocation.zh-CN';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import '../routineInvocation.css';

interface Receipt { metadata: RoutineInvocationMetadata; plan: ReturnType<typeof buildRoutineInvocation>; stale: boolean; consumed: boolean; }
interface Operation { taskId: string; promise: Promise<void>; epoch: number; cancelled: boolean; dispatched: boolean; readSettled: boolean; cancellation?: Promise<unknown>; receipt?: Receipt; }

/** 明确读取才生成调用，独立目录任务不占用或停止原查询会话。 */
export function RoutineInvocationDialog({ target, onOpenGeneratedQuery, onClose, services = routineInvocationServices }: {
  target: RoutineInvocationTarget; onOpenGeneratedQuery(sql: string): void; onClose(): void; services?: RoutineInvocationServices;
}) {
  const [intent] = useState(() => new RoutineInvocationIntent(target, () => { const state = useWorkspace.getState(); return { profile: state.connections.find(profile => profile.id === target.connectionId), version: state.connectionVersions[target.connectionId] ?? 0 }; }));
  intent.observe(target);
  const originServices = useRef(services).current; if (originServices !== services) intent.invalidate();
  const [receipt, setReceipt] = useState<Receipt>(), receiptRef = useRef(receipt);
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [invalid, setInvalid] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef<Operation | null>(null), alive = useRef(false), lifetime = useRef(0), committed = useRef<object | null>(null), closingRef = useRef(false), host = useRef<HTMLDivElement | null>(null), ticket = {};
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; cancel(); }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  /** 只有原可见最上层Modal可领任务；旧DOM不能操作恢复后的另一个目标。 */
  function surface(): boolean {
    const node = host.current; if (!node || !document.body.contains(node)) return false;
    for (let current: HTMLElement | null = node; current && current.nodeType === 1; current = current.parentNode as HTMLElement | null) if (current.hidden || current.getAttribute('hidden') !== null || current.getAttribute('aria-hidden') === 'true' || current.style.display === 'none' || current.style.visibility === 'hidden') return false;
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'), top = dialogs[dialogs.length - 1]; return !!top && top.getAttribute('aria-label') === text.title && top.contains(node);
  }
  /** 原结构和连接准确身份即时核对，不依赖原query标签对象或activeJobs。 */
  function current(): boolean { return alive.current && !closingRef.current && intent.current() && originServices === services && surface(); }
  function editable(): boolean { return current() && committed.current === ticket && !active.current; }
  /** 取消只发送给已开始的准确任务一次，持门等原read与ACK双方结束。 */
  function cancel(operation = active.current): void {
    if (!operation || active.current !== operation || operation.cancelled) return;
    operation.cancelled = true; if (operation.receipt) operation.receipt.stale = true;
    if (operation.dispatched && !operation.readSettled) { operation.cancellation = Promise.resolve().then(() => originServices.cancel(operation.taskId)); void operation.cancellation.catch(() => undefined); }
    if (alive.current) setMessage(text.cancelling);
  }
  /** 用户明确重读会废弃旧preview；每份新preview生成独立nonce，fresh不重新命名变量。 */
  function run(mode: 'read' | 'open'): void {
    if (!editable()) return;
    const previous = receipt;
    if (mode === 'open' && (!previous || previous !== receiptRef.current || previous.stale || previous.consumed)) return;
    if (mode === 'read' && previous) previous.stale = true;
    const operation: Operation = { taskId: uid(), promise: Promise.resolve(), epoch: lifetime.current, cancelled: false, dispatched: false, readSettled: false, receipt: previous };
    active.current = operation; setBusy(true); setError(''); setMessage(mode === 'open' ? text.checking : text.reading);
    const owns = () => current() && active.current === operation && lifetime.current === operation.epoch && !operation.cancelled;
    operation.promise = Promise.resolve().then(async () => {
      if (!owns()) return;
      operation.dispatched = true; let raw: RoutineInvocationMetadata;
      // 原读取终态先于交付回调；同步卸载不能再取消已经完成的目录任务。
      try { raw = await originServices.read(intent.target, operation.taskId); } finally { operation.readSettled = true; }
      if (!owns()) return;
      const metadata = parseRoutineInvocationForTarget(raw, intent.target);
      if (mode === 'read') {
        const plan = buildRoutineInvocation(metadata, { nonce: uid().replaceAll('-', '') });
        if (!owns()) return; const next = { metadata, plan, stale: false, consumed: false }; receiptRef.current = next; setReceipt(next);
      } else {
        const plan = buildRoutineInvocation(metadata, { nonce: previous!.plan.nonce });
        if (metadata.fingerprint !== previous!.metadata.fingerprint || JSON.stringify(metadata) !== JSON.stringify(previous!.metadata) || plan.sql !== previous!.plan.sql) { previous!.stale = true; throw Error(text.changed); }
        if (!owns() || receiptRef.current !== previous || previous!.stale || previous!.consumed) return;
        previous!.consumed = true; onOpenGeneratedQuery(previous!.plan.sql);
      }
    }).catch(reason => {
      const message = errorMessage(reason);
      // 只免报准确的正常取消回执，不能把权限或物理关闭失败当作已取消。
      if (operation.cancelled && [sharedText.cancelled, '任务已取消', '任务已取消；已执行的结构或数据变更不会撤销', '任务已取消；此前已经提交的操作不会撤销'].includes(message)) return;
      if (alive.current && lifetime.current === operation.epoch && !closingRef.current) setError(message);
      else useWorkspace.getState().notify(message, true);
    }).finally(async () => {
      try { if (operation.cancellation) await operation.cancellation; }
      catch (reason) { if (alive.current && !closingRef.current) setError(errorMessage(reason)); else useWorkspace.getState().notify(errorMessage(reason), true); }
      finally { if (active.current === operation) { active.current = null; if (alive.current) { setBusy(false); setMessage(''); } } }
    });
  }
  /** 关闭先请求一次取消再等真实终态，回调捕获本次关闭以免误关后来的窗口。 */
  function close(): void {
    if (!alive.current || committed.current !== ticket || closingRef.current || !surface()) return;
    closingRef.current = true; setClosing(true); cancel(); const operation = active.current, epoch = lifetime.current, callback = onClose;
    void (async () => { if (operation) await operation.promise; if (alive.current && lifetime.current === epoch) callback(); })();
  }
  useEffect(() => {
    const unsubscribeIntent = intent.subscribe(() => { if (alive.current) { setInvalid(true); cancel(); } });
    const unsubscribeStore = useWorkspace.subscribe(() => { intent.current(); });
    /** 预览编辑器不执行，原窗口快捷键也不能越过本Modal执行或保存后台SQL。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => { unsubscribeIntent(); unsubscribeStore(); document.removeEventListener('keydown', block, true); };
  }, [intent]);
  const unavailable = invalid || !intent.current(), parameterRows = receipt?.metadata.parameters ?? [];
  return <Modal title={text.title} wide onClose={close}><div ref={host} className="routine-invocation-body" aria-busy={busy || closing}>
    <p>{intent.target.database}.{intent.target.name} · {intent.target.kind === 'procedure' ? text.procedure : text.function}</p><p>{text.notice}</p><p className="warning-text">{text.effects}</p><p>{text.values}</p><p>{text.whole}</p>
    {receipt && <><div className="routine-invocation-parameters"><table><caption>{text.parameters}</caption><thead><tr>{[text.ordinal, text.direction, text.name, text.type, text.binding].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{parameterRows.map(parameter => <tr key={parameter.ordinal}><td>{parameter.ordinal}</td><td>{parameter.mode}</td><td>{parameter.name}</td><td>{parameter.type}</td><td>{receipt.plan.arguments.find(argument => argument.ordinal === parameter.ordinal)?.placeholder}{receipt.plan.outputs.find(output => output.ordinal === parameter.ordinal)?.variable && <span>{' → ' + receipt.plan.outputs.find(output => output.ordinal === parameter.ordinal)!.variable}</span>}</td></tr>)}</tbody></table>{!parameterRows.length && <p>{text.zero}</p>}</div>{receipt.metadata.returnType && <p>{text.returnType}：{receipt.metadata.returnType}</p>}<p>{receipt.plan.outputs.length ? text.variables : text.noOutputs}</p><section aria-label={text.preview} className="routine-invocation-sql"><SqlEditor value={receipt.plan.sql} readOnly height={260}/></section></>}
    <ErrorBox message={unavailable ? text.stale : error}/>{receipt?.stale && !error && !unavailable && <p className="warning-text">{text.changed}</p>}{receipt?.consumed && <p>{text.consumed}</p>}{closing ? <p role="status">{text.closing}</p> : busy && <Spinner text={message}/>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (committed.current === ticket) cancel(); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button><button disabled={busy || closing || unavailable} onClick={() => run('read')}>{text.read}</button><button className="primary" disabled={busy || closing || unavailable || !receipt || receipt.stale || receipt.consumed} onClick={() => run('open')}>{text.open}</button></footer></Modal>;
}
