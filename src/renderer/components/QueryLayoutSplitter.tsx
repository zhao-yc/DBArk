import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { queryLayoutZh as text } from '../locales/queryLayout.zh-CN';

/** 手势只持有当次布局租约；实际保存由父页从最新工作台合并，不持有旧tabs。 */
export interface QueryLayoutLease {
  readonly value: number;
  current(): boolean;
  commit(value: number): boolean;
  dispose(): void;
}
interface Props {
  value: number; min: number; max: number; defaultValue: number; controls: string; scope: string; disabled?: boolean;
  begin(cancel: () => void): QueryLayoutLease | null;
  onPreview(value: number | null): void;
}
interface Drag { pointerId: number; target: HTMLElement; startY: number; startHeight: number; height: number; lease: QueryLayoutLease; cleanup(): void; }
/** 窗口不足时只压缩显示；不得把视觉高度当成持久偏好写回。 */
export function queryEditorVisualHeight(value: number, maximum: number): number {
  return Math.max(0, Math.min(Math.max(0, Math.floor(maximum)), Math.round(value)));
}

/** 真实分隔条：原生pointer捕获与窗口监听共同收尾，取消不会回写pointerdown时的偏好。 */
export function QueryLayoutSplitter(props: Props) {
  const latest = useRef(props); latest.current = props;
  const drag = useRef<Drag | null>(null), alive = useRef(true);
  /** 先撤销手势身份再释放capture，迟到lostcapture/up不能结算已取消的旧手势。 */
  function cancel() {
    const current = drag.current; if (!current) return;
    drag.current = null; current.cleanup(); current.lease.dispose();
    if (alive.current) latest.current.onPreview(null);
  }
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, []);
  useLayoutEffect(() => { cancel(); }, [props.scope, props.value, props.min, props.max, props.disabled]);

  /** 仅主指针领取一次布局租约，拖动事件不持有或保存工作台快照。 */
  function start(event: PointerEvent<HTMLDivElement>) {
    const current = latest.current;
    if (drag.current || current.disabled || current.max < current.min || event.button !== 0 || event.isPrimary === false || !Number.isFinite(event.clientY)) return;
    const lease = current.begin(cancel); if (!lease) return;
    const target = event.currentTarget, pointerId = event.pointerId, startY = event.clientY;
    const startHeight = queryEditorVisualHeight(lease.value, current.max);
    /** 所有原生事件都核当次租约；另一个pointer及旧闭包不能修改当前拖动。 */
    const valid = (next: globalThis.PointerEvent) => drag.current === session && next.pointerId === pointerId;
    const move = (next: globalThis.PointerEvent) => {
      if (!valid(next)) return;
      if (!lease.current()) { cancel(); return; }
      if (!Number.isFinite(next.clientY)) return;
      session.height = Math.round(Math.max(current.min, Math.min(current.max, startHeight + next.clientY - startY)));
      latest.current.onPreview(session.height);
    };
    const up = (next: globalThis.PointerEvent) => {
      if (!valid(next)) return;
      if (!lease.current()) { cancel(); return; }
      move(next); if (drag.current !== session) return;
      drag.current = null; session.cleanup();
      try { if (session.height !== session.startHeight) lease.commit(session.height); }
      finally { lease.dispose(); if (alive.current) latest.current.onPreview(null); }
    };
    const stopped = (next: globalThis.PointerEvent) => { if (valid(next)) cancel(); };
    const key = (next: globalThis.KeyboardEvent) => { if (next.key === 'Escape' && drag.current === session) { next.preventDefault(); next.stopPropagation(); cancel(); } };
    const blur = () => { if (drag.current === session) cancel(); };
    const session: Drag = { pointerId, target, startY, startHeight, height: startHeight, lease, cleanup() {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', stopped);
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur);
      try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch { /* 销毁中的节点仍须完成其余监听与租约回收。 */ }
    } };
    drag.current = session;
    try { target.setPointerCapture(pointerId); }
    catch { cancel(); return; }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', stopped);
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur); event.preventDefault();
  }
  /** 键盘一次显式提交，不借旧render的value覆盖快速连续按键刚保存的值。 */
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const current = latest.current;
    if (event.key === 'Escape') { cancel(); return; }
    if (drag.current || current.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const restore = event.key === 'Home', direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!restore && (!direction || current.max < current.min)) return;
    event.preventDefault();
    const lease = current.begin(cancel); if (!lease) return;
    try {
      const visual = queryEditorVisualHeight(lease.value, current.max);
      const value = restore ? current.defaultValue : Math.round(Math.max(current.min, Math.min(current.max, visual + direction * (event.shiftKey ? 50 : 10))));
      // 向已到达的视觉边界按键没有实际位移，不能把较大的保存偏好偷偷改成窗口上限。
      if ((restore ? value !== lease.value : value !== visual) && lease.current()) lease.commit(value);
    } finally { lease.dispose(); }
  }
  /** 恢复是独立显式提交；先撤销拖动，避免其迟到up覆盖恢复结果。 */
  function restore() {
    cancel(); if (latest.current.disabled) return;
    const lease = latest.current.begin(cancel); if (!lease) return;
    try { if (lease.current() && lease.value !== latest.current.defaultValue) lease.commit(latest.current.defaultValue); }
    finally { lease.dispose(); }
  }
  const visual = queryEditorVisualHeight(drag.current?.height ?? props.value, props.max);
  return <div className="query-layout-bar"><div className="query-layout-handle" role="separator" tabIndex={props.disabled ? -1 : 0} aria-orientation="horizontal" aria-label={text.separator} aria-controls={props.controls} aria-valuemin={Math.min(props.min, Math.max(0, props.max))} aria-valuemax={Math.max(0, props.max)} aria-valuenow={visual} aria-valuetext={visual === props.value ? text.height(visual) : text.limited(visual, props.value)} aria-disabled={props.disabled || props.max < props.min} aria-keyshortcuts="ArrowUp ArrowDown Home Escape" title={text.hint} onPointerDown={start} onKeyDown={keyboard} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}/><button type="button" disabled={props.disabled} onClick={restore}>{text.restore}</button></div>;
}
