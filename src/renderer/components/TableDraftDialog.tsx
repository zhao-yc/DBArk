import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseTableDraftDocument, parseTableDraftPayload, type TableDraftDocument, type TableDraftPayload, type TableDraftTarget } from '../../shared/tableDraft';
import { errorMessage, invoke, uid } from '../lib';
import { tableDraftFilesZh as text } from '../locales/tableDraftFiles.zh-CN';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

export interface TableDraftDialogServices {
  open(target: TableDraftTarget): Promise<{ name: string; document: TableDraftDocument } | null>;
  save(payload: TableDraftPayload): Promise<{ name: string } | null>;
  verify(document: TableDraftDocument, taskId: string): Promise<{ verifiedChanges: number }>;
  cancel(taskId: string): Promise<unknown>;
}
/** 文件操作只使用专用受限能力，恢复只读核验不会发送任何数据修改请求。 */
export const tableDraftDialogServices: TableDraftDialogServices = {
  open: target => invoke('tableDraftFiles.open', { target }),
  save: payload => invoke('tableDraftFiles.save', { payload }),
  verify: (document, taskId) => invoke('table.draftVerify', { ...document.target, taskId, metadataKey: document.metadataKey, changes: document.changes }),
  cancel: taskId => invoke('query.cancel', { taskId }),
};
export interface TableDraftDialogProps {
  mode: 'save' | 'restore'; target: TableDraftTarget; payload?: TableDraftPayload;
  assertCurrent(): void; onRestore(document: TableDraftDocument): void; onBusy(busy: boolean): void; onClose(): void;
  services?: TableDraftDialogServices;
}
type View = { acknowledged: boolean; file?: { name: string; document: TableDraftDocument }; saved?: string; error?: string; message?: string };
type Operation = { lifetime: object; kind: 'open' | 'save' | 'verify'; taskId?: string; cancelled: boolean; cancelPromise?: Promise<void>; promise?: Promise<void>; restored: boolean };

/** 对话框只领取原表页的一次草稿意图，所有迟到回包都必须重新核对该所有权。 */
export function TableDraftDialog({ services = tableDraftDialogServices, ...props }: TableDraftDialogProps) {
  const owner = useRef({ ...props, target: { ...props.target }, services }).current;
  const [view, setView] = useState<View>({ acknowledged: false }), live = useRef(view); live.current = view;
  const [busy, setBusy] = useState(false), operation = useRef<Operation | undefined>(undefined);
  const mounted = useRef(true), invalid = useRef(false), closed = useRef(false), consumed = useRef(false), committed = useRef<object | undefined>(undefined), lifetime = useRef<object | null>({});
  const ticket = {};
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  if (props.mode !== owner.mode || props.payload !== owner.payload || services !== owner.services || props.target.connectionId !== owner.target.connectionId || props.target.database !== owner.target.database || props.target.table !== owner.target.table) invalid.current = true;

  /** 同步发布草稿身份，旧按钮即使在同一事件轮次调用也不能恢复旧确认状态。 */
  function replace(next: View): void { live.current = next; if (mounted.current && !closed.current) setView(next); }
  /** 原所有权一旦失败永久撤销，之后回到相同页面也不能复活。 */
  function check(active?: Operation): void {
    if (!mounted.current || closed.current || invalid.current || active && (operation.current !== active || active.lifetime !== lifetime.current)) throw Error(text.changed);
    try { owner.assertCurrent(); } catch (reason) { invalid.current = true; throw reason; }
  }
  /** 只接受最后一次已提交渲染的操作，输入变化即时撤销旧事件闭包。 */
  function editable(): boolean {
    if (operation.current || committed.current !== ticket || live.current !== view || consumed.current) return false;
    try { check(); return true; } catch (reason) { replace({ ...live.current, error: errorMessage(reason) }); return false; }
  }
  /** 取消只投递到原编号，取消ACK不能提前释放仍在执行的核验与父页占门。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.kind !== 'verify' || !active.taskId || active.cancelled) return;
    active.cancelled = true;
    replace({ ...live.current, message: text.cancelling });
    active.cancelPromise = Promise.resolve().then(() => owner.services.cancel(active.taskId!)).then(() => undefined).catch(reason => {
      replace({ ...live.current, error: text.cancelFailed + errorMessage(reason) });
    });
  }
  /** 原始操作从文件选择到全部收尾都持有同一同步锁，组件卸载也不会提前放行。 */
  function start(kind: Operation['kind'], action: (active: Operation) => Promise<void>): void {
    if (!editable()) return;
    const active: Operation = { lifetime: lifetime.current!, kind, cancelled: false, restored: false, ...(kind === 'verify' ? { taskId: uid() } : {}) };
    operation.current = active; setBusy(true);
    try { owner.onBusy(true); } catch (reason) { operation.current = undefined; setBusy(false); replace({ ...live.current, error: errorMessage(reason) }); return; }
    active.promise = Promise.resolve().then(async () => { check(active); await action(active); }).catch(reason => {
      if (mounted.current && !closed.current && operation.current === active) replace({ ...live.current, error: errorMessage(reason) });
    }).finally(async () => {
      if (active.cancelPromise) await active.cancelPromise;
      if (active.cancelled && mounted.current && !closed.current) replace({ ...live.current, file: undefined, acknowledged: false, message: text.cancelled });
      if (operation.current === active) operation.current = undefined;
      if (mounted.current) setBusy(false);
      try { owner.onBusy(false); } catch (reason) { replace({ ...live.current, error: errorMessage(reason) }); } finally {
        if (active.restored && mounted.current && !closed.current) { closed.current = true; try { owner.onClose(); } catch { /* 原恢复已完成，不自动重放。 */ } }
      }
    });
  }
  /** 保存只捕获本地已暂存修改；确认前不会弹出选择器，保存成功仍保留父页dirty。 */
  function save(): void {
    if (!view.acknowledged || view.saved || !owner.payload) return;
    start('save', async active => {
      check(active); const payload = parseTableDraftPayload(owner.payload);
      replace({ ...live.current, error: undefined, message: undefined });
      const result = await owner.services.save(payload);
      if (result === null) { check(active); return; }
      if (!result || typeof result.name !== 'string' || !result.name || result.name.length > 1024) throw Error(text.invalid);
      // 原保存成功是已写入文件的事实；仅原页失效不能把它改称未保存或触发自动重试。
      let current = true;
      try { check(active); } catch { invalid.current = true; current = false; }
      if (mounted.current && !closed.current && operation.current === active && active.lifetime === lifetime.current) replace({ ...live.current, saved: result.name, message: current ? text.saved : text.savedStale, error: undefined });
    });
  }
  /** 每次重选都消费前份文件与确认，不让取消的选择器复用旧恢复按钮。 */
  function choose(): void {
    start('open', async active => {
      replace({ acknowledged: false }); check(active);
      const result = await owner.services.open(owner.target); check(active);
      if (result === null) return;
      if (!result || typeof result.name !== 'string' || !result.name || result.name.length > 1024) throw Error(text.invalid);
      const document = parseTableDraftDocument(result.document);
      if (document.target.connectionId !== owner.target.connectionId || document.target.database !== owner.target.database || document.target.table !== owner.target.table) throw Error(text.changed);
      replace({ acknowledged: false, file: { name: result.name, document } });
    });
  }
  /** 全部原行读核通过后只恢复一次；它不是提交授权，仍由父页走原SQL预览与确认。 */
  function restore(): void {
    const selected = view.file;
    if (!selected || !view.acknowledged) return;
    start('verify', async active => {
      replace({ ...live.current, error: undefined, message: undefined }); check(active);
      const result = await owner.services.verify(selected.document, active.taskId!); check(active);
      if (active.cancelled) return;
      const descriptor = result && typeof result === 'object' ? Object.getOwnPropertyDescriptor(result, 'verifiedChanges') : undefined;
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value !== selected.document.changes.length || Reflect.ownKeys(result).length !== 1) throw Error(text.invalid);
      if (live.current.file !== selected || !live.current.acknowledged || consumed.current) throw Error(text.changed);
      check(active); consumed.current = true;
      owner.onRestore(selected.document); active.restored = true;
    });
  }
  /** 忙碌期关闭只保留原窗口，文件IO不可凭关闭按钮强行中断。 */
  function close(): void {
    if (!mounted.current || closed.current || operation.current || committed.current !== ticket || live.current !== view) return;
    closed.current = true; owner.onClose();
  }
  useEffect(() => {
    mounted.current = true; const token = {}; lifetime.current = token;
    /** 阻止父页执行或保存快捷键穿过模态框触发另一项操作。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { mounted.current = false; if (lifetime.current === token) lifetime.current = null; cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const activeOperation = operation.current, disabled = busy || invalid.current || consumed.current, counts = { insert: 0, update: 0, delete: 0 };
  for (const change of view.file?.document.changes ?? []) counts[change.kind]++;
  const progress = operation.current?.kind === 'open' ? text.choosing : operation.current?.kind === 'save' ? text.saving : text.verifying;
  return <Modal title={owner.mode === 'save' ? text.saveTitle : text.restoreTitle} onClose={close}>
    <div className="modal-content" data-table-draft-dialog aria-busy={busy}>
      <p>{owner.target.database}.{owner.target.table}</p>
      {owner.mode === 'save' ? <><p className="warning-text">{text.saveWarning}</p><UsageHelp><p>{text.saveScope}</p><p>{text.localOnly}</p></UsageHelp></> : <><p>{text.restoreScope}</p><p>{text.restoreView}</p>
        <button className="file-picker" disabled={disabled} onClick={choose}>{view.file ? text.chooseAgain : text.choose}</button>
        {view.file ? <section aria-label={text.file}><strong>{view.file.name}</strong><div aria-label={text.summary}>{text.insert}：{counts.insert}；{text.update}：{counts.update}；{text.delete}：{counts.delete}</div></section> : <p>{text.noSelection}</p>}
      </>}
      <label className="checkbox-line"><input type="checkbox" aria-label={owner.mode === 'save' ? text.saveAcknowledgement : text.restoreAcknowledgement} checked={view.acknowledged} disabled={disabled || owner.mode === 'restore' && !view.file || !!view.saved} onChange={event => { if (editable()) replace({ ...view, acknowledged: event.target.checked }); }}/>{owner.mode === 'save' ? text.saveAcknowledgement : text.restoreAcknowledgement}</label>
      {busy && <Spinner text={progress}/>}<ErrorBox message={view.error}/>{view.message && <p role="status">{view.message}</p>}{view.saved && <p>{view.saved}</p>}
    </div>
    <footer><button disabled={busy} onClick={close}>{text.close}</button>{operation.current?.kind === 'verify' && <button disabled={operation.current.cancelled} onClick={() => cancel(activeOperation)}>{text.cancel}</button>}
      {owner.mode === 'save' ? <button className="primary" disabled={disabled || !view.acknowledged || !owner.payload || !!view.saved} onClick={save}>{text.saveAction}</button> : <button className="primary" disabled={disabled || !view.file || !view.acknowledged} onClick={restore}>{text.restoreAction}</button>}
    </footer>
  </Modal>;
}