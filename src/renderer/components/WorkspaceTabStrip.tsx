import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type Ref } from 'react';
import { Database, FileCode2, Plus, Table2, X } from 'lucide-react';
import { useWorkspace } from '../store';
import type { TabOrderRef } from '../tabOrder';
import { zh, formatText } from '../locales/zh-CN';
import { tabOrderZh as text } from '../locales/tabOrder.zh-CN';
import '../tabOrder.css';

interface Props { stripRef: Ref<HTMLDivElement>; onClose(id: string): void; onNew(): void; blocked: boolean; }
interface DragOwner { source: TabOrderRef; node: HTMLButtonElement; observer?: MutationObserver; release(): void; }
interface DropMark { owner: DragOwner; target: TabOrderRef; placement: 'before' | 'after'; }

/** 只改原标签数组位置；所有事件都消费渲染时的文档令牌，不从拖动数据读取目标编号。 */
export function WorkspaceTabStrip({ stripRef, onClose, onNew, blocked }: Props) {
  const state = useWorkspace(), element = useRef<HTMLDivElement | null>(null), alive = useRef(false);
  const latest = useRef({ blocked, onClose, onNew, orderAvailable: false }), dragging = useRef<DragOwner | undefined>(undefined);
  const [mark, setMark] = useState<DropMark>(), [dragSource, setDragSource] = useState<TabOrderRef>(), [status, setStatus] = useState('');
  const focusRequest = useRef<{ ref: TabOrderRef; node: HTMLButtonElement } | undefined>(undefined), composing = useRef(false);
  const references = new Map<string, TabOrderRef>(); let orderAvailable = true;
  // 整组身份必须完整对应原列表；异常只暂停交互，不能抛出整个工作台或省略某些标签。
  try {
    const snapshot = state.tabOrderSnapshot();
    if (snapshot.length !== state.settings.tabs.length || snapshot.some((ref, index) => ref.id !== state.settings.tabs[index]?.id)) throw Error(text.unavailable);
    for (const ref of snapshot) { if (references.has(ref.id)) throw Error(text.unavailable); references.set(ref.id, ref); }
  } catch { orderAvailable = false; references.clear(); }

  /** 外层只接收原条带节点，保持App既有的活动标签滚动定位。 */
  function attach(node: HTMLDivElement | null) { element.current = node; if (typeof stripRef === 'function') stripRef(node); else if (stripRef) stripRef.current = node; }
  function available() {
    if (!alive.current || latest.current.blocked || !element.current || !document.documentElement.contains(element.current) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
    for (let node: HTMLElement | null = element.current; node; node = node.parentElement) if (node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden') return false;
    return true;
  }
  /** 精确释放本轮监听，旧dragend/微任务没有清除后来拖动的权限。 */
  function retire(owner: DragOwner | undefined, cancelled = false) {
    if (!owner || dragging.current !== owner) return;
    dragging.current = undefined; owner.release();
    if (alive.current) { setMark(undefined); setDragSource(undefined); if (cancelled) setStatus(text.cancelled); }
  }
  /** 模态出现又移除也保留墓碑，drop前同步取出尚未投递的MutationObserver记录。 */
  function inspect(owner: DragOwner, records: MutationRecord[]) {
    if (records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1 && (
      ['dialog', 'alertdialog'].includes((node as Element).getAttribute('role') ?? '') || (node as Element).querySelector('[role="dialog"], [role="alertdialog"]')
    )))) retire(owner, true);
  }
  function currentDrag() {
    const owner = dragging.current;
    if (owner?.observer) inspect(owner, owner.observer.takeRecords());
    if (!owner || dragging.current !== owner) return;
    if (!available() || !latest.current.orderAvailable || !useWorkspace.getState().resolveTabOrder(owner.source)) { retire(owner, true); return; }
    return owner;
  }
  /** HTML5拖动只留内存owner；固定空类型使原生拖动可用，不携带id、SQL或来源。 */
  function start(event: DragEvent<HTMLButtonElement>, source: TabOrderRef) {
    const tab = useWorkspace.getState().resolveTabOrder(source);
    if (!available() || !latest.current.orderAvailable || !tab || !event.dataTransfer) { event.preventDefault(); return; }
    retire(dragging.current);
    const releases: Array<() => void> = []; let dropTask: ReturnType<typeof setTimeout> | undefined;
    const owner: DragOwner = { source, node: event.currentTarget, release() { owner.observer?.disconnect(); for (const off of releases.splice(0)) off(); } };
    dragging.current = owner;
    try {
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-dbark-tab-order', '');
      const key = (input: globalThis.KeyboardEvent) => { if (input.key === 'Escape') retire(owner, true); };
      const lost = () => retire(owner, true);
      // 原生事件可在document捕获与React冒泡之间清空微任务；兜底必须等整次派发结束后的任务。
      const dropped = () => { if (dropTask === undefined) dropTask = setTimeout(() => { dropTask = undefined; retire(owner, true); }, 0); };
      document.addEventListener('keydown', key, true); document.addEventListener('dragend', lost, true); document.addEventListener('dragstart', lost, true); document.addEventListener('drop', dropped, true); window.addEventListener('blur', lost);
      releases.push(() => { if (dropTask !== undefined) { clearTimeout(dropTask); dropTask = undefined; } }, () => document.removeEventListener('keydown', key, true), () => document.removeEventListener('dragend', lost, true), () => document.removeEventListener('dragstart', lost, true), () => document.removeEventListener('drop', dropped, true), () => window.removeEventListener('blur', lost));
      if (typeof MutationObserver !== 'undefined') { owner.observer = new MutationObserver(records => inspect(owner, records)); owner.observer.observe(document.body, { childList: true, subtree: true }); }
      setDragSource(source); setMark(undefined); setStatus(text.moving(tab.title));
    } catch { retire(owner, true); event.preventDefault(); }
  }
  /** 左右半区只决定插入位置；来源与投放对象均再次由core核验代次。 */
  function destination(event: DragEvent<HTMLDivElement>, target: TabOrderRef) {
    const owner = currentDrag();
    if (!owner || !useWorkspace.getState().resolveTabOrder(target) || owner.source.token === target.token) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!Number.isFinite(event.clientX) || !Number.isFinite(box.left) || !Number.isFinite(box.width) || box.width <= 0) return;
    return { owner, target, placement: event.clientX < box.left + box.width / 2 ? 'before' as const : 'after' as const };
  }
  function over(event: DragEvent<HTMLDivElement>, target: TabOrderRef) {
    const next = destination(event, target);
    if (!next) { if (mark) setMark(undefined); return; }
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setMark(previous => previous?.owner === next.owner && previous.target.token === target.token && previous.placement === next.placement ? previous : next);
  }
  function drop(event: DragEvent<HTMLDivElement>, target: TabOrderRef) {
    const next = destination(event, target); if (!next) return;
    event.preventDefault(); event.stopPropagation();
    const tab = useWorkspace.getState().resolveTabOrder(next.owner.source);
    try {
      if (document.activeElement === next.owner.node) focusRequest.current = { ref: next.owner.source, node: next.owner.node };
      const changed = useWorkspace.getState().moveTab(next.owner.source, { kind: 'relative', target, placement: next.placement });
      if (!changed) focusRequest.current = undefined;
      setStatus(changed && tab ? text.placed(tab.title) : text.boundary);
    }
    finally { retire(next.owner); }
  }
  /** 快捷键只属于获得焦点的标签名称，编辑器、关闭及新增按钮都不接收重排。 */
  function move(event: KeyboardEvent<HTMLButtonElement>, ref: TabOrderRef) {
    if (event.target !== event.currentTarget || document.activeElement !== event.currentTarget || composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented || event.altKey || !event.shiftKey || !(event.ctrlKey || event.metaKey) || event.ctrlKey && event.metaKey || !available() || !latest.current.orderAvailable) return;
    const direction = ({ ArrowLeft: 'left', ArrowRight: 'right', Home: 'first', End: 'last' } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'];
    if (!direction) return;
    const tab = useWorkspace.getState().resolveTabOrder(ref); if (!tab) return;
    event.preventDefault(); event.stopPropagation(); retire(dragging.current);
    focusRequest.current = { ref, node: event.currentTarget };
    const changed = useWorkspace.getState().moveTab(ref, { kind: 'direction', direction });
    setStatus(changed ? text.placed(tab.title) : text.boundary);
    if (!changed) focusRequest.current = undefined;
  }
  useLayoutEffect(() => {
    alive.current = true; return () => { alive.current = false; focusRequest.current = undefined; retire(dragging.current); };
  }, []);
  useLayoutEffect(() => {
    latest.current = { blocked, onClose, onNew, orderAvailable };
    if (dragging.current) currentDrag();
    const request = focusRequest.current; focusRequest.current = undefined;
    if (request && available() && latest.current.orderAvailable && useWorkspace.getState().resolveTabOrder(request.ref) && element.current?.contains(request.node)) { request.node.focus(); request.node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  });
  return <><div ref={attach} className="tab-strip" role="toolbar" aria-label={text.strip}>{state.settings.tabs.length ? state.settings.tabs.map((tab, index) => {
    const ref = references.get(tab.id), disabled = blocked || !orderAvailable || !ref;
    const dirty = Object.hasOwn(state.dirtyTabs, tab.id) && state.dirtyTabs[tab.id] === true || !!tab.fileSourceBinding && (!Object.hasOwn(state.queryFileDirty, tab.id) || state.queryFileDirty[tab.id] !== false);
    const marker = ref && mark?.target.token === ref.token ? ` tab-order-drop-${mark.placement}` : '';
    return <div key={orderAvailable ? tab.id : `invalid-${index}`} data-workspace-tab-id={tab.id} data-active-workspace-tab={tab.id === state.settings.activeTabId ? 'true' : undefined} className={`workspace-tab-button ${tab.id === state.settings.activeTabId ? 'active' : ''}${marker}${ref && dragSource?.token === ref.token ? ' tab-order-dragging' : ''}`} onDragOver={event => { if (ref) over(event, ref); }} onDrop={event => { if (ref) drop(event, ref); }}>
      <button className="tab-select" disabled={disabled} draggable={!disabled} title={text.shortcut} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onDragStart={event => { if (ref) start(event, ref); else event.preventDefault(); }} onKeyDown={event => { if (ref) move(event, ref); }} onClick={() => { if (available() && latest.current.orderAvailable && ref && useWorkspace.getState().resolveTabOrder(ref)) useWorkspace.getState().updateSettings({ activeTabId: ref.id }); }}>{tab.kind === 'query' ? <FileCode2 size={14}/> : <Table2 size={14}/>}<span>{tab.title}</span>{dirty && <span className="dirty-dot"/>}</button>
      <button className="tab-close" disabled={disabled} aria-label={formatText(zh.app.text012, tab.title)} onClick={() => { if (available() && latest.current.orderAvailable && ref && useWorkspace.getState().resolveTabOrder(ref)) latest.current.onClose(ref.id); }}><X size={12}/></button>
    </div>;
  }) : <div className="welcome-tab"><Database size={14}/>{zh.app.text013}</div>}<button className="add-tab" title={zh.common.newQuery} aria-label={zh.app.text014} onClick={() => { if (available()) latest.current.onNew(); }}><Plus size={15}/></button></div><div className="tab-order-help"><span>{text.hint}</span><span role={status || !orderAvailable ? 'status' : undefined} aria-live="polite">{orderAvailable ? status : text.unavailable}</span></div></>;
}
