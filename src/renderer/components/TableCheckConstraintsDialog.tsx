import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tableCheckChangeSchema, tableCheckConfirmationsMatch, type TableCheckApplyOutput, type TableCheckChange, type TableCheckGetOutput, type TableCheckPreviewOutput, type TableCheckProgress, type TableCheckTarget, type TableCheckView } from '../../shared/tableChecks';
import { assertTableCheckPreview, assertTableCheckSnapshot, TableCheckIntent, TableCheckResourceLedger, tableCheckAcknowledgementLabel, tableCheckAcksComplete, tableCheckExecutionState, tableCheckTargetKey, tableCheckTokenCurrent, type TableCheckStatus } from '../tableChecksUi';
import { assertTableChecksTargetAvailable, tableChecksServices, type TableChecksServices } from '../tableChecksServices';
import { tableChecksZh as text } from '../locales/tableChecks.zh-CN';
import { errorMessage, uid } from '../lib';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { SqlEditor } from './SqlEditor';
import '../tableChecks.css';

type Draft = { op: 'add' | 'replace'; checkRef?: string; name: string; expression: string; enforced: boolean | null } | Extract<TableCheckChange, { op: 'drop' | 'enforcement' }>;
type Operation = { mode: 'get' | 'preview' | 'apply' | 'release'; taskId: string; epoch: number; promise: Promise<void>; cancelled: boolean; dispatched: boolean; settled: boolean; attempted: boolean; cancellation?: Promise<unknown>; evidence: TableCheckProgress | null; terminal: boolean; result?: TableCheckApplyOutput; failure?: string; published: boolean };

/** 一项真实结构变更沿固定快照/预览提交；不借用查询会话，也不生成查询标签冒充管理。 */
export function TableCheckConstraintsDialog({ target, onClose, onApplied, onDirtyChange, beforeApply, services = tableChecksServices }: { target: TableCheckTarget; onClose(): void; onApplied(verified: boolean): void; onDirtyChange?(dirty: boolean): void; beforeApply?(): void; services?: TableChecksServices }) {
  const [intent] = useState(() => { const connectionId = target.connectionId; return new TableCheckIntent(target, () => { const state = useWorkspace.getState(); return { profile: state.connections.find(value => value.id === connectionId), version: state.connectionVersions[connectionId] ?? 0 }; }); });
  intent.observe(target); const source = useRef(services).current; if (source !== services) intent.invalidate();
  const [ledger] = useState(() => new TableCheckResourceLedger(input => source.release(input))), completion = useRef(onApplied);
  const [snapshot, setSnapshot] = useState<TableCheckGetOutput>(), snapshotRef = useRef(snapshot), [draft, setDraftState] = useState<Draft>(), draftRef = useRef(draft), [preview, setPreview] = useState<TableCheckPreviewOutput>(), previewRef = useRef(preview);
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), acksRef = useRef(acks), [names, setNames] = useState({ databaseConfirmation: '', tableConfirmation: '' }), namesRef = useRef(names), acknowledgementRevision = useRef(0), renderedAcknowledgementRevision = acknowledgementRevision.current;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [consumed, setConsumed] = useState(false), consumedRef = useRef(false), [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState<TableCheckStatus>(), [message, setMessage] = useState(''), [executionWarnings, setExecutionWarnings] = useState<string[]>([]), [progress, setProgress] = useState<TableCheckProgress>(), [page, setPage] = useState(0), [clock, setClock] = useState(Date.now());
  const [confirmation, setConfirmation] = useState<object | null>(null), confirmationRef = useRef(confirmation), host = useRef<HTMLDivElement | null>(null), firstInput = useRef<HTMLInputElement | null>(null);
  const active = useRef<Operation | null>(null), alive = useRef(false), lifetime = useRef(0), committed = useRef<object | null>(null), closingRef = useRef(false), ticket = {};
  const callbacks = useRef({ onDirtyChange, beforeApply }); callbacks.current = { onDirtyChange, beforeApply };
  const hasUnreleasedWork = busy || closing || !!draft || !!preview || !!confirmation || ledger.size > 0;
  useEffect(() => { callbacks.current.onDirtyChange?.(hasUnreleasedWork); }, [hasUnreleasedWork]);
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; const operation = active.current; cancel(operation); void (async () => { if (operation) await operation.promise; await ledger.releaseAll(); })().catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  // 子Modal的passive焦点设置后才聚焦本窗口输入，不与通用关闭按钮争抢焦点。
  useEffect(() => { if (surface()) firstInput.current?.focus(); }, [draft?.op]);
  useLayoutEffect(() => {
    const offIntent = intent.subscribe(() => { if (alive.current) { setInvalid(true); cancel(); } });
    const offStore = useWorkspace.subscribe(() => { intent.current(); }); return () => { offIntent(); offStore(); };
  }, [intent]);
  useEffect(() => source.subscribe?.(event => { const operation = active.current; if (!operation || event.taskId !== operation.taskId || operation.terminal && event.status === 'running') return; operation.terminal ||= event.status !== 'running'; operation.evidence = event.progress; if (alive.current && lifetime.current === operation.epoch) setProgress(event.progress); }), [source]);
  useEffect(() => { const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite); if (!deadlines.length) return; const wait = Math.min(...deadlines) - Date.now(); if (wait <= 0) { setClock(Date.now()); return; } const timer = window.setTimeout(() => setClock(Date.now()), Math.min(wait + 1, 2147483647)); return () => window.clearTimeout(timer); }, [snapshot?.expiresAt, preview?.expiresAt]);

  /** 只有真实可见最上层窗口可接纳动作；关闭确认仅放行本窗口内部的准确alertdialog。 */
  function surface(allowConfirmation = false): boolean {
    const node = host.current; if (!node || !document.body.contains(node)) return false; let own: HTMLElement | null = null;
    for (let current: HTMLElement | null = node; current && current.nodeType === 1; current = current.parentNode as HTMLElement | null) { if (current.hidden || current.getAttribute('hidden') !== null || current.getAttribute('aria-hidden') === 'true' || current.style.display === 'none' || current.style.visibility === 'hidden') return false; if (!own && current.getAttribute('role') === 'dialog') own = current; }
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'), top = dialogs[dialogs.length - 1]; return !!own && (top === own || allowConfirmation && (!!confirmationRef.current || closingRef.current) && top?.getAttribute('aria-label') === text.confirmTitle && node.contains(top));
  }
  /** 同步门同时核已提交DOM、生命周期、服务和永久目标授权。 */
  function current(retired = false): boolean { return alive.current && source === services && committed.current === ticket && !closingRef.current && !confirmationRef.current && surface() && (retired || intent.current()); }
  function editable(): boolean { return current() && !active.current; }
  function writable(): boolean { const value = snapshotRef.current; return !!value && value === snapshot && value.writable && value.coverage === 'complete' && tableCheckTokenCurrent(value.expiresAt) && !consumedRef.current; }
  /** 引用先于React状态更新，旧输入同轮也不能覆写新草稿。 */
  function draftValue(value: Draft | undefined): void { draftRef.current = value; setDraftState(value); }
  /** 确认清空推进代次，恢复相同文字或勾选也不能复活旧提交回调。 */
  function resetConfirmations(): void { acknowledgementRevision.current++; const empty = new Set<string>(), blank = { databaseConfirmation: '', tableConfirmation: '' }; acksRef.current = empty; setAcks(empty); namesRef.current = blank; setNames(blank); }
  function clearPreview(): void { previewRef.current = undefined; setPreview(undefined); resetConfirmations(); }
  /** 当前窗口显示原错；关闭中或已退休的原操作错误转宿主通知，不当成正常取消吞掉。 */
  function report(reason: unknown, operation?: Operation): void { const message = errorMessage(reason); if (alive.current && !closingRef.current && (!operation || operation.epoch === lifetime.current) && intent.current()) setError(message); else useWorkspace.getState().notify(message, true); }
  /** 控制请求最多一次；原请求已settled时不对完成任务补发取消。 */
  function cancel(operation = active.current): void {
    if (!operation || active.current !== operation || operation.cancelled || operation.mode === 'release') return; operation.cancelled = true;
    if (operation.dispatched && !operation.settled) { operation.cancellation = Promise.resolve().then(() => source.cancel({ taskId: operation.taskId })); void operation.cancellation.catch(() => undefined); }
    if (alive.current) setMessage(text.cancelling);
  }
  /** 每个原目录/DDL请求记录真正终态，后续释放和取消ACK仍由原operation持锁。 */
  async function request<T>(operation: Operation, send: () => Promise<T>): Promise<T> { operation.dispatched = true; try { return await send(); } finally { operation.settled = true; } }
  /** 只有准确原操作可发布目录或预览；后续清理仍保留原资源责任。 */
  function accepts(operation: Operation): boolean { return alive.current && lifetime.current === operation.epoch && active.current === operation && !operation.cancelled && !closingRef.current && intent.current() && surface(); }
  /** 原槽只在原promise、取消ACK和body负责的释放均结束后释放；旧finally不能动后继。 */
  function run(mode: Operation['mode'], body: (operation: Operation) => Promise<void>, retired = false): void {
    if (!(retired ? current(true) : editable()) || active.current) return;
    const operation: Operation = { mode, taskId: uid(), epoch: lifetime.current, promise: Promise.resolve(), cancelled: false, dispatched: false, settled: false, attempted: false, evidence: null, terminal: false, published: false };
    active.current = operation; setBusy(true); setError(''); setProgress(undefined); setMessage(mode === 'get' ? text.reading : mode === 'preview' ? text.preparing : mode === 'apply' ? text.executing : text.releasing);
    operation.promise = Promise.resolve().then(() => body(operation)).catch(reason => { operation.failure = errorMessage(reason); report(reason, operation); }).finally(async () => {
      try { if (operation.cancellation) await operation.cancellation; } catch (reason) { operation.failure = errorMessage(reason); report(reason, operation); }
      if (mode === 'apply') {
        const result = tableCheckExecutionState(operation.attempted, operation.evidence, operation.failure ? undefined : operation.result, operation.terminal);
        if (alive.current && lifetime.current === operation.epoch) setStatus(result.status);
        if (result.changed && !operation.published) { operation.published = true; try { completion.current(result.verified && intent.current()); } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); } }
      }
      if (active.current === operation) { active.current = null; if (alive.current && lifetime.current === operation.epoch) { setBusy(false); setMessage(''); } }
    });
  }
  /** 明确重读只换目录快照，不重放旧变更；先释放本窗口旧令牌。 */
  function read(): void {
    if (!editable() || draftRef.current && !consumedRef.current) return;
    run('get', async operation => {
      clearPreview(); snapshotRef.current = undefined; setSnapshot(undefined); draftValue(undefined); consumedRef.current = false; setConsumed(false); setStatus(undefined); setExecutionWarnings([]); await ledger.releaseAll(); if (!accepts(operation)) return;
      const next = await request(operation, () => source.get({ ...intent.target, taskId: operation.taskId })); ledger.track('snapshotId', next.snapshotId);
      if (!accepts(operation)) { await ledger.release('snapshotId', next.snapshotId); return; }
      try { assertTableCheckSnapshot(next, intent.target); } catch (reason) { try { await ledger.release('snapshotId', next.snapshotId); } catch (cleanup) { throw Error(errorMessage(reason) + '\n' + errorMessage(cleanup)); } throw reason; }
      snapshotRef.current = next; setSnapshot(next); setPage(0); setClock(Date.now());
    });
  }
  /** 用户只选一个真实引用或新增草稿；未知enforced保留null等待明确选择。 */
  function choose(next: Draft, original?: TableCheckView): void {
    if (!editable() || !writable() || draftRef.current || previewRef.current || original && !snapshotRef.current?.checks.includes(original)) return;
    if (original && !original.access[next.op === 'drop' ? 'drop' : next.op === 'enforcement' ? 'enforcement' : 'replace'].allowed) return;
    draftValue(next); setError(''); setStatus(undefined);
  }
  /** 编辑只作用于本次原草稿，预览固定期间不接受输入。 */
  function edit(next: Draft, original: Draft): void { if (!editable() || !writable() || previewRef.current || draftRef.current !== original) return; draftValue(next); }
  /** 返回编辑/放弃先永久废旧预览，释放失败仍保留ledger责任。 */
  function back(discard = false): void { if (!current(true) || active.current || consumedRef.current) return; run('release', async () => { clearPreview(); await ledger.releaseAll(true); if (discard) draftValue(undefined); }, true); }
  /** 将明确的单项输入转共享合同；未知生效状态不强制猜成true/false。 */
  function change(): TableCheckChange {
    const value = draftRef.current; if (!value || 'enforced' in value && value.enforced === null) throw Error(text.required);
    const candidate = tableCheckChangeSchema.parse(value.op === 'add' ? { op: value.op, name: value.name, expression: value.expression, enforced: value.enforced } : value);
    const original = candidate.op === 'add' ? undefined : snapshotRef.current?.checks.find(item => item.checkRef === candidate.checkRef);
    if (candidate.op !== 'add' && (!original || !original.access[candidate.op === 'drop' ? 'drop' : candidate.op === 'replace' ? 'replace' : 'enforcement'].allowed)) throw Error(text.unavailable);
    if (candidate.op !== 'drop' && !candidate.enforced && !snapshotRef.current?.allowsNotEnforced) throw Error(text.maria); return candidate;
  }
  /** SQL仅由真实preview服务返回，前端不拼DDL或将表达式交query.execute。 */
  function makePreview(): void {
    if (!editable() || !writable() || previewRef.current) return; let value: TableCheckChange; try { value = change(); } catch (reason) { report(reason); return; }
    const original = snapshotRef.current!, originalDraft = draftRef.current;
    run('preview', async operation => {
      clearPreview(); await ledger.releaseAll(true); if (!accepts(operation) || draftRef.current !== originalDraft) return; assertTableCheckSnapshot(original, intent.target);
      const next = await request(operation, () => source.preview({ snapshotId: original.snapshotId, change: value, taskId: operation.taskId })); ledger.track('previewToken', next.previewToken);
      if (!accepts(operation) || draftRef.current !== originalDraft || snapshotRef.current !== original) { await ledger.release('previewToken', next.previewToken); return; }
      try { assertTableCheckPreview(next, original, value); } catch (reason) { try { await ledger.release('previewToken', next.previewToken); } catch (cleanup) { throw Error(errorMessage(reason) + '\n' + errorMessage(cleanup)); } throw reason; }
      previewRef.current = next; setPreview(next); resetConfirmations(); setClock(Date.now());
    });
  }
  /** 同步消费原token并精确核两段名称及确认代次；失败也不自动重试。 */
  function apply(): void {
    const plan = previewRef.current, original = snapshotRef.current;
    if (!editable() || !plan || !original || consumedRef.current || preview !== plan || acknowledgementRevision.current !== renderedAcknowledgementRevision || !tableCheckConfirmationsMatch(namesRef.current, intent.target) || !tableCheckAcksComplete(plan.requiredAcknowledgements, acksRef.current, plan.change)) return;
    consumedRef.current = true; setConsumed(true);
    run('apply', async operation => {
      assertTableCheckPreview(plan, original, change()); callbacks.current.beforeApply?.(); assertTableChecksTargetAvailable(intent.target, useWorkspace.getState()); if (!accepts(operation)) return;
      operation.attempted = true; const result = await request(operation, () => source.apply({ previewToken: plan.previewToken, ...namesRef.current, acknowledgements: [...acksRef.current] as Parameters<TableChecksServices['apply']>[0]['acknowledgements'], taskId: operation.taskId }));
      if (tableCheckTargetKey(result.target) !== tableCheckTargetKey(intent.target) || result.ddlSubmitted !== true || result.ddlCompleted !== true || result.resourcesReleased !== true) throw Error(text.mismatch);
      operation.result = result; operation.evidence = { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: result.definitionVerified, outcome: 'succeeded' }; if (alive.current && lifetime.current === operation.epoch) setExecutionWarnings(result.warnings); await ledger.releaseAll();
      if (alive.current && lifetime.current === operation.epoch && result.verificationError) setError(result.verificationError);
    });
  }
  /** 草稿关闭先内联明确放弃；忙关闭先请求一次取消并等待原任务，再决定是否需放弃。 */
  function closeNow(discard = false): void {
    if (!alive.current || committed.current !== ticket || closingRef.current || !surface(discard)) return;
    const operation = active.current, epoch = lifetime.current, callback = onClose; confirmationRef.current = null; setConfirmation(null); closingRef.current = true; setClosing(true); cancel(operation);
    void (async () => {
      try {
        if (operation) await operation.promise;
        if (!alive.current || lifetime.current !== epoch) return;
        if (!discard && draftRef.current && !consumedRef.current) { const value = {}; confirmationRef.current = value; setConfirmation(value); return; }
        await ledger.releaseAll(); if (alive.current && lifetime.current === epoch && surface(true)) { callbacks.current.onDirtyChange?.(false); callback(); }
      } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); if (alive.current) setError(errorMessage(reason) + '\n' + text.releaseFailed); }
      finally { if (alive.current && lifetime.current === epoch) { closingRef.current = false; setClosing(false); } }
    })();
  }
  const unavailable = invalid || !intent.current(), expired = !!snapshot && !tableCheckTokenCurrent(snapshot.expiresAt, clock) || !!preview && !tableCheckTokenCurrent(preview.expiresAt, clock), enabled = !busy && !closing && !confirmation && !unavailable && !expired && writable();
  const lastPage = Math.max(0, Math.ceil((snapshot?.checks.length ?? 0) / 50) - 1), visiblePage = Math.min(page, lastPage), selectedDraft = draft, renderedOperation = active.current;
  return <Modal title={text.title} wide onClose={() => closeNow()}><div ref={host} className="table-checks-content" aria-busy={busy || closing}>
    <strong>{intent.target.database} / {intent.target.table}</strong><p>{text.independent}</p><UsageHelp><p>{text.caution}</p></UsageHelp>
    {snapshot && <><p>{snapshot.dialect} {snapshot.serverVersion} · {text.count(snapshot.checks.length)}</p>{snapshot.coverage === 'unknown' && <p className="warning-text">{text.incomplete}</p>}{!snapshot.writable && <p className="warning-text">{text.readonly}</p>}{[...snapshot.reasons, ...snapshot.warnings].map((reason, index) => <p className="warning-text" key={index}>{reason}</p>)}{!snapshot.allowsNotEnforced && <p>{text.maria}</p>}
      {!snapshot.checks.length && snapshot.coverage === 'complete' && <p>{text.empty}</p>}<div className="table-checks-list">{snapshot.checks.slice(visiblePage * 50, (visiblePage + 1) * 50).map(item => <section className="table-checks-item" key={item.checkRef} aria-label={item.name}><strong>{item.name}</strong><p>{item.location === 'column' ? `${text.column} ${item.columnName ?? ''}` : text.table} · {item.enforced === null ? text.unknown : item.enforced ? text.active : text.inactive}</p><pre className="table-checks-expression">{item.expression}</pre>{item.reasons.map((reason, index) => <p className="warning-text" key={index}>{reason}</p>)}<div className="table-checks-actions"><button disabled={!enabled || !!draft || !item.access.replace.allowed} onClick={() => choose({ op: 'replace', checkRef: item.checkRef, name: item.name, expression: item.expression, enforced: item.enforced }, item)}>{text.edit}</button><button disabled={!enabled || !!draft || !item.access.drop.allowed} onClick={() => choose({ op: 'drop', checkRef: item.checkRef }, item)}>{text.drop}</button><button disabled={!enabled || !!draft || !snapshot.allowsNotEnforced || item.enforced === null || !item.access.enforcement.allowed} onClick={() => { if (item.enforced !== null && snapshot.allowsNotEnforced) choose({ op: 'enforcement', checkRef: item.checkRef, enforced: !item.enforced }, item); }}>{item.enforced === null ? text.toggle : item.enforced ? text.disable : text.enable}</button></div></section>)}</div><div className="table-checks-actions"><button disabled={busy || closing || !!confirmation || visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>{text.previous}</button><span>{text.page(visiblePage + 1, lastPage + 1)}</span><button disabled={busy || closing || !!confirmation || visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}>{text.next}</button><button disabled={!enabled || !!draft} onClick={() => choose({ op: 'add', name: '', expression: '', enforced: true })}>{text.add}</button></div></>}
    {selectedDraft && <section className="table-checks-editor" aria-label={text.draft}><p>{text.draft}</p><strong>{text[selectedDraft.op]}</strong>{(selectedDraft.op === 'add' || selectedDraft.op === 'replace') ? <><Field label={text.name}><input ref={firstInput} aria-label={text.name} value={selectedDraft.name} disabled={!enabled || !!preview} onChange={event => edit({ ...selectedDraft, name: event.target.value }, selectedDraft)}/></Field><Field label={text.expression}><textarea aria-label={text.expression} value={selectedDraft.expression} disabled={!enabled || !!preview} onChange={event => edit({ ...selectedDraft, expression: event.target.value }, selectedDraft)}/></Field><Field label={text.enforced}><select aria-label={text.enforced} value={selectedDraft.enforced === null ? 'unknown' : selectedDraft.enforced ? 'yes' : 'no'} disabled={!enabled || !!preview} onChange={event => { if (event.target.value === 'yes' || event.target.value === 'no' && snapshot?.allowsNotEnforced) edit({ ...selectedDraft, enforced: event.target.value === 'yes' }, selectedDraft); }}><option value="unknown" disabled>{text.enforcedUnknown}</option><option value="yes">{text.enforcedYes}</option><option value="no" disabled={!snapshot?.allowsNotEnforced}>{text.enforcedNo}</option></select></Field></> : <p>{snapshot?.checks.find(item => item.checkRef === selectedDraft.checkRef)?.name} · {selectedDraft.op === 'drop' ? text.drop : selectedDraft.enforced ? text.enable : text.disable}</p>}<button disabled={busy || closing || !!confirmation || consumed} onClick={() => back(true)}>{text.discard}</button></section>}
    {preview && <section><h3>{text.fixedSql}</h3><SqlEditor value={preview.sql} readOnly height={220}/>{preview.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}<p>{text.confirmationHint}</p><div className="table-checks-confirm-fields">{(['databaseConfirmation', 'tableConfirmation'] as const).map(field => <Field key={field} label={text[field]}><input aria-label={text[field]} autoComplete="off" value={names[field]} disabled={busy || closing || consumed || unavailable || expired || !!confirmation} onChange={event => { if (!editable() || previewRef.current !== preview || consumedRef.current || acknowledgementRevision.current !== renderedAcknowledgementRevision) return; const next = { ...namesRef.current, [field]: event.target.value }; acknowledgementRevision.current++; namesRef.current = next; setNames(next); }}/></Field>)}</div>{preview.requiredAcknowledgements.map(id => <label className="check" key={id}><input type="checkbox" aria-label={tableCheckAcknowledgementLabel(id) ?? id} disabled={busy || closing || consumed || unavailable || expired || !!confirmation || !tableCheckAcknowledgementLabel(id)} checked={acks.has(id)} onChange={event => { if (!editable() || previewRef.current !== preview || consumedRef.current || acknowledgementRevision.current !== renderedAcknowledgementRevision) return; const next = new Set(acksRef.current); if (event.target.checked) next.add(id); else next.delete(id); acknowledgementRevision.current++; acksRef.current = next; setAcks(next); }}/>{tableCheckAcknowledgementLabel(id) ?? id}</label>)}</section>}
    {unavailable && <ErrorBox message={text.stale}/>} {expired && <p className="warning-text">{text.expired}</p>}{consumed && <><p>{text.consumed}</p><p>{text.snapshotOld}</p></>}{status && <p role="status">{text[status]}</p>}{executionWarnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}{progress && <p role="status">{text.phases[progress.phase]}</p>}{closing ? <p role="status">{text.closing}</p> : busy && <Spinner text={message}/>}<ErrorBox message={error}/>
    {confirmation && <section role="alertdialog" aria-label={text.confirmTitle} className="table-checks-confirm"><h3>{text.confirmTitle}</h3><p>{text.confirmBody}</p><div className="table-checks-actions"><button onClick={() => { if (confirmationRef.current === confirmation && surface(true)) { confirmationRef.current = null; setConfirmation(null); } }}>{text.confirmKeep}</button><button onClick={() => { if (confirmationRef.current === confirmation) closeNow(true); }}>{text.confirmClose}</button></div></section>}
  </div><footer className="modal-footer"><button disabled={busy || closing || !!confirmation || unavailable || !!draft && !consumed} onClick={read}>{text.read}</button>{preview && !consumed && <button disabled={busy || closing || !!confirmation || unavailable} onClick={() => back()}>{text.back}</button>}<span className="grow"/>{busy && <button disabled={closing || active.current?.cancelled || active.current?.mode === 'release'} onClick={() => { if (committed.current === ticket && active.current === renderedOperation) cancel(renderedOperation); }}>{text.cancel}</button>}{draft && !preview && <button disabled={!enabled} onClick={makePreview}>{text.preview}</button>}{preview && <button className="primary" disabled={busy || closing || !!confirmation || consumed || unavailable || expired || !tableCheckConfirmationsMatch(names, intent.target) || !tableCheckAcksComplete(preview.requiredAcknowledgements, acks, preview.change)} onClick={apply}>{text.apply}</button>}<button disabled={closing} onClick={() => closeNow()}>{text.close}</button></footer></Modal>;
}
