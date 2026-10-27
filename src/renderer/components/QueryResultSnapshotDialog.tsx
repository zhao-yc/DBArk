import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotViewerZh as text } from '../locales/queryResultSnapshotViewer.zh-CN';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import '../queryResultSnapshotViewer.css';

export interface QueryResultSnapshotViewerServices {
  open(): Promise<{ name: string; snapshot: QueryResultSnapshotDocument } | null>;
  save(snapshot: QueryResultSnapshotDocument): Promise<{ name: string } | null>;
}
export const queryResultSnapshotViewerServices: QueryResultSnapshotViewerServices = {
  open: () => invoke('resultSnapshotFiles.open', {}), save: snapshot => invoke('resultSnapshotFiles.save', { snapshot }),
};
interface Loaded { name: string; snapshot: QueryResultSnapshotDocument; scope: object; }
interface Operation { mode: 'open' | 'save'; epoch: number; source: Loaded | undefined; }

/** 全局查看只持有文件内容，不创建查询、连接或会话；原文件Promise包括主进程清理。 */
export function QueryResultSnapshotDialog({ onClose, services = queryResultSnapshotViewerServices }: { onClose(): void; services?: QueryResultSnapshotViewerServices }) {
  const [loaded, setLoaded] = useState<Loaded>(), loadedRef = useRef(loaded);
  const [busy, setBusy] = useState<'open' | 'save'>(), [error, setError] = useState(''), [message, setMessage] = useState(''), [showSql, setShowSql] = useState(false);
  const [interaction, setInteraction] = useState(0), interactionRef = useRef(0), operation = useRef<Operation | null>(null);
  const alive = useRef(false), lifetime = useRef(0), committed = useRef<object | null>(null), host = useRef<HTMLDivElement | null>(null), ticket = {};
  const callbacks = useRef({ onClose, services }); callbacks.current = { onClose, services };
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  /** 逐级核可见性和真实挂载；内存测试不需要伪造浏览器几何。 */
  function visible(): boolean {
    const element = host.current; if (!element || !document.body.contains(element)) return false;
    for (let node: HTMLElement | null = element; node && node.nodeType === 1; node = node.parentNode as HTMLElement | null) {
      if (node.hidden || node.getAttribute('hidden') !== null || node.getAttribute('aria-hidden') === 'true' || node.style.display === 'none' || node.style.visibility === 'hidden') return false;
    }
    return true;
  }
  /** 等价于host.closest(dialog)，不依赖测试DOM的CSS class选择器或几何实现。 */
  function ownDialog(): Element | undefined { for (let node: HTMLElement | null = host.current; node && node.nodeType === 1; node = node.parentNode as HTMLElement | null) if (node.getAttribute('role') === 'dialog') return node; return undefined; }
  /** 只有当前最上层模态可以关闭或领文件，alertdialog同样阻止穿透。 */
  function topmost(): boolean { const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); return !!ownDialog() && dialogs[dialogs.length - 1] === ownDialog(); }
  /** 已提交DOM、可见窗口与同步IO槽必须同时有效，旧按钮不能领取新操作。 */
  function editable(): boolean { return alive.current && committed.current === ticket && !operation.current && visible() && topmost(); }
  /** 开始和结束都推进网格回调代次；同一文件selectionScope保持稳定，旧回调永不复活。 */
  function advance(): void { interactionRef.current++; if (alive.current) setInteraction(interactionRef.current); }
  /** 普通网格拒绝任何其它模态；纯字节显示只认可本查看器内部的嵌套窗口。 */
  function gridCurrent(source: Loaded, epoch: number, binary: boolean): boolean {
    if (!alive.current || operation.current || loadedRef.current !== source || interactionRef.current !== epoch || !visible()) return false;
    const own = ownDialog(), dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    return !!own && dialogs.every(dialog => dialog === own || binary && !!host.current?.contains(dialog));
  }
  const binaryIdentity = useMemo(() => loaded ? [loaded.scope, interaction] : [], [loaded, interaction]);
  /** Header、footer和Escape共用原IO门；嵌套字节窗口的Escape不能穿透关闭外层。 */
  function close(): void {
    if (!alive.current || committed.current !== ticket || !visible() || !topmost()) return;
    if (operation.current) { setMessage(text.waiting); return; }
    callbacks.current.onClose();
  }
  /** 只有准确原操作能更新显示；失效保存仍报告已写可能性或原Main错误。 */
  async function file(mode: 'open' | 'save'): Promise<void> {
    if (!editable() || mode === 'save' && (!loaded || loadedRef.current !== loaded)) return;
    const port = callbacks.current.services, active: Operation = { mode, epoch: lifetime.current, source: loadedRef.current };
    operation.current = active; advance(); setBusy(mode); setError(''); setMessage('');
    const current = () => alive.current && lifetime.current === active.epoch && operation.current === active && callbacks.current.services === port && loadedRef.current === active.source && visible() && topmost();
    try {
      if (mode === 'open') {
        const selected = await port.open();
        if (!current()) return;
        if (selected === null) { setMessage(text.cancelled); return; }
        const snapshot = parseQueryResultSnapshot(selected.snapshot); if (!current()) return;
        const next = { name: selected.name, snapshot, scope: {} }; loadedRef.current = next; setLoaded(next); setShowSql(false); setMessage('');
      } else {
        const saved = await port.save(active.source!.snapshot);
        if (saved === null) { if (current()) setMessage(text.cancelled); return; }
        if (current()) setMessage(text.saved(saved.name));
        else useWorkspace.getState().notify(text.lateSave, true);
      }
    } catch (reason) {
      const original = errorMessage(reason);
      if (current()) setError(original); else if (mode === 'save') useWorkspace.getState().notify(original, true);
    } finally {
      // StrictMode/lifetime迟到不发布内容；原槽仍相同才在真实终态解除UI占用。
      if (operation.current === active) { operation.current = null; if (alive.current) { advance(); setBusy(undefined); } }
    }
  }
  /** SQL只控制本窗口只读显隐，不设置编辑器正文或提供任何执行回调。 */
  function toggleSql(): void { if (editable() && loaded && loadedRef.current === loaded) setShowSql(value => !value); }
  return <Modal title={text.title} wide onClose={close}><div ref={host} className="query-result-snapshot-viewer" aria-busy={!!busy}>
    <p>{text.notice}</p><p className="muted small">{text.scope}</p><div className="query-result-snapshot-viewer-actions"><button disabled={!!busy} onClick={() => void file('open')}>{text.choose}</button><button disabled={!!busy || !loaded} onClick={() => void file('save')}>{text.save}</button><button disabled={!!busy || !loaded} onClick={toggleSql}>{showSql ? text.sourceHide : text.sourceShow}</button><span className="grow"/><button disabled={!!busy} onClick={close}>{text.close}</button></div>
    <ErrorBox message={error}/>{busy && <Spinner text={busy === 'open' ? text.opening : text.saving}/>} {message && <p role="status">{message}</p>}
    {loaded ? <><p role="status">{text.opened(loaded.name)}</p><p>{text.count(loaded.snapshot.result.rows.length, loaded.snapshot.result.columns.length)}</p>{loaded.snapshot.result.truncated && <p className="warning-text">{text.truncated}</p>}<div className="query-result-snapshot-viewer-grid"><ResultsGrid columns={loaded.snapshot.result.columns} rows={loaded.snapshot.result.rows} selectionScope={loaded.scope} isCurrent={() => gridCurrent(loaded, interaction, false)} binarySourceIdentity={binaryIdentity} binaryIsCurrent={() => gridCurrent(loaded, interaction, true)} binaryFileActions={false}/></div>{showSql && <section className="query-result-snapshot-viewer-sql" aria-label={text.sourceTitle}><p>{text.sourceTitle}</p><SqlEditor value={loaded.snapshot.result.statement} readOnly height={180}/></section>}</> : <p>{text.empty}</p>}
  </div></Modal>;
}
