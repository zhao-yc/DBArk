import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type Ref } from 'react';
import { Database, FileCode2, Plus, Table2, X } from 'lucide-react';
import { useWorkspace } from '../store';
import type { TabOrderRef } from '../tabOrder';
import type { WorkspaceTab } from '../store';
import { queryCloseZh as closeText } from '../locales/queryClose.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { tabOrderZh as text } from '../locales/tabOrder.zh-CN';
import '../tabOrder.css';

interface Props { onCloseSide?(anchor: TabOrderRef, side: 'left' | 'right'): void; stripRef: Ref<HTMLDivElement>; onClose(id: string): void; onNew(): void; blocked: boolean; }
interface DragOwner { source: TabOrderRef; node: HTMLButtonElement; observer?: MutationObserver; release(): void; }
interface QueryMenuOwner {
  anchor: TabOrderRef; node: HTMLButtonElement; tabs: WorkspaceTab[]; refs: readonly TabOrderRef[]; scopes: string[];
  connections: Array<{ id: string; profile?: object; version: number }>; observer: MutationObserver; focus: boolean; release(): void;
}
interface DropMark { owner: DragOwner; target: TabOrderRef; placement: 'before' | 'after'; }

/** 只改原标签数组位置；所有事件都消费渲染时的文档令牌，不从拖动数据读取目标编号。 */
export function WorkspaceTabStrip({ stripRef, onClose, onNew, blocked, onCloseSide }: Props) {
  const state = useWorkspace(), element = useRef<HTMLDivElement | null>(null), alive = useRef(false);
  const latest = useRef({ blocked, onClose, onNew, onCloseSide, orderAvailable: false }), dragging = useRef<DragOwner | undefined>(undefined);
  const [mark, setMark] = useState<DropMark>(), [dragSource, setDragSource] = useState<TabOrderRef>(), [status, setStatus] = useState('');
  const focusRequest = useRef<{ ref: TabOrderRef; node: HTMLButtonElement } | undefined>(undefined), composing = useRef(false);
  const menuOwner = useRef<QueryMenuOwner | undefined>(undefined), menuElement = useRef<HTMLDivElement | null>(null);
  const [queryMenu, setQueryMenu] = useState<QueryMenuOwner>();
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
  /** 菜单租约捕获顺序和原对象；订阅使重排、来源/连接ABA即时且永久撤销旧动作。 */
  function menuHasModal(records: MutationRecord[]): boolean {
    return records.some(record => {
      if (record.type === 'attributes') return record.attributeName === 'role' && (['dialog', 'alertdialog'].includes(record.oldValue ?? '') || record.target.nodeType === 1 && ['dialog', 'alertdialog'].includes((record.target as Element).getAttribute('role') ?? ''));
      return Array.from(record.addedNodes).some(node => node.nodeType === 1 && (['dialog', 'alertdialog'].includes((node as Element).getAttribute('role') ?? '') || (node as Element).querySelector('[role="dialog"], [role="alertdialog"]')));
    });
  }
  function menuCurrent(owner: QueryMenuOwner): boolean {
    // 与拖动同样同步消费尚未投递的模态记录，添加后移除也不能穿透旧菜单权限。
    if (menuOwner.current === owner && menuHasModal(owner.observer.takeRecords())) { retireMenu(owner, false, true); return false; }
    if (menuOwner.current !== owner || !available() || !latest.current.orderAvailable || !latest.current.onCloseSide) return false;
    const current = useWorkspace.getState(), tabs = current.settings.tabs;
    return tabs.length === owner.tabs.length && owner.tabs.every((tab, index) => tabs[index] === tab && current.resolveTabOrder(owner.refs[index]) === tab && menuScope(tab) === owner.scopes[index])
      && owner.connections.every(item => current.connections.find(profile => profile.id === item.id) === item.profile && (current.connectionVersions[item.id] ?? 0) === item.version);
  }
  /** 保存来源快照不共享可变对象，同对象内来源字段变更也不能绕过菜单代次。 */
  function menuScope(tab: WorkspaceTab): string { return JSON.stringify([tab.kind, tab.connectionId, tab.database, tab.databaseContext, tab.table, tab.sourceBinding, tab.fileSourceBinding]); }
  /** 只释放准确旧菜单，迟到Escape/失焦或动作不能撤销后来的新菜单。 */
  function retireMenu(owner = menuOwner.current, restoreFocus = false, changed = false) {
    if (!owner || menuOwner.current !== owner) return;
    menuOwner.current = undefined; owner.release();
    if (alive.current) { setQueryMenu(undefined); if (changed) setStatus(closeText.menuChanged); }
    if (restoreFocus && element.current?.contains(owner.node)) owner.node.focus();
  }
  /** 菜单不切活动标签；所有关闭仍交给App既有确认、保存、作业和会话关闭入口。 */
  function openMenu(anchor: TabOrderRef, node: HTMLButtonElement) {
    if (!available() || !latest.current.orderAvailable || !latest.current.onCloseSide) return;
    const current = useWorkspace.getState(), tab = current.resolveTabOrder(anchor); if (tab?.kind !== 'query') return;
    retire(dragging.current); retireMenu();
    const releases: Array<() => void> = [], observer = new MutationObserver(records => {
      if (menuHasModal(records)) retireMenu(owner, false, true);
    });
    const owner: QueryMenuOwner = { anchor, node, observer, tabs: [...current.settings.tabs], refs: current.tabOrderSnapshot(), scopes: current.settings.tabs.map(menuScope), focus: true,
      connections: [...new Set(current.settings.tabs.map(tab => tab.connectionId))].map(id => ({ id, profile: current.connections.find(profile => profile.id === id), version: current.connectionVersions[id] ?? 0 })),
      release() { observer.disconnect(); for (const release of releases.splice(0)) release(); } };
    menuOwner.current = owner;
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); retireMenu(owner, true); } };
    const pointer = (event: globalThis.PointerEvent) => { const target = event.target as Node; if (!menuElement.current?.contains(target) && target !== owner.node && !owner.node.contains(target)) retireMenu(owner); };
    const blur = () => retireMenu(owner);
    releases.push(useWorkspace.subscribe(() => { if (!menuCurrent(owner)) retireMenu(owner, false, true); }));
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', pointer, true); window.addEventListener('blur', blur);
    releases.push(() => document.removeEventListener('keydown', key, true), () => document.removeEventListener('pointerdown', pointer, true), () => window.removeEventListener('blur', blur));
    // 复用节点切换role再恢复也留下撤销记录，不只监测整块模态的插入。
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'], attributeOldValue: true }); setQueryMenu(owner);
  }
  /** 原菜单必须仍然有效才可消费；关闭菜单后同步交接准确锚点，不从活动标签反查。 */
  function chooseSide(owner: QueryMenuOwner, side: 'left' | 'right') {
    if (!menuCurrent(owner)) { retireMenu(owner, false, true); return; }
    const anchor = owner.tabs.findIndex(tab => tab.id === owner.anchor.id);
    if (!owner.tabs.some((tab, index) => tab.kind === 'query' && (side === 'left' ? index < anchor : index > anchor))) return;
    const action = latest.current.onCloseSide; retireMenu(owner); action?.(owner.anchor, side);
  }
  /** 菜单箭头只在当前可用项目间移动；Tab按原浏览器路径离开并关闭菜单。 */
  function menuKey(event: KeyboardEvent<HTMLDivElement>, owner: QueryMenuOwner) {
    if (!menuCurrent(owner)) { retireMenu(owner, false, true); return; }
    if (event.key === 'Tab') { retireMenu(owner); return; }
    const items = Array.from(menuElement.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []).filter(node => !node.disabled);
    const index = items.indexOf(document.activeElement as HTMLButtonElement); let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length; else if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = items.length - 1; else return;
    event.preventDefault(); items[next]?.focus();
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
    retireMenu(); retire(dragging.current);
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
    event.preventDefault(); event.stopPropagation(); retireMenu(); retire(dragging.current);
    focusRequest.current = { ref, node: event.currentTarget };
    const changed = useWorkspace.getState().moveTab(ref, { kind: 'direction', direction });
    setStatus(changed ? text.placed(tab.title) : text.boundary);
    if (!changed) focusRequest.current = undefined;
  }
  useLayoutEffect(() => {
    alive.current = true; return () => { alive.current = false; focusRequest.current = undefined; retireMenu(); retire(dragging.current); };
  }, []);
  useLayoutEffect(() => {
    latest.current = { blocked, onClose, onNew, onCloseSide, orderAvailable };
    const owner = menuOwner.current;
    if (owner && !menuCurrent(owner)) retireMenu(owner, false, true);
    else if (owner?.focus && menuElement.current) { owner.focus = false; menuElement.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(); }
    if (dragging.current) currentDrag();
    const request = focusRequest.current; focusRequest.current = undefined;
    if (request && available() && latest.current.orderAvailable && useWorkspace.getState().resolveTabOrder(request.ref) && element.current?.contains(request.node)) { request.node.focus(); request.node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  });
  return <><div ref={attach} className="tab-strip" role="toolbar" aria-label={text.strip}>{state.settings.tabs.length ? state.settings.tabs.map((tab, index) => {
    const ref = references.get(tab.id), disabled = blocked || !orderAvailable || !ref;
    const dirty = Object.hasOwn(state.dirtyTabs, tab.id) && state.dirtyTabs[tab.id] === true || !!tab.fileSourceBinding && (!Object.hasOwn(state.queryFileDirty, tab.id) || state.queryFileDirty[tab.id] !== false);
    const marker = ref && mark?.target.token === ref.token ? ` tab-order-drop-${mark.placement}` : '';
    return <div key={orderAvailable ? tab.id : `invalid-${index}`} data-workspace-tab-id={tab.id} data-active-workspace-tab={tab.id === state.settings.activeTabId ? 'true' : undefined} className={`workspace-tab-button ${tab.id === state.settings.activeTabId ? 'active' : ''}${marker}${ref && dragSource?.token === ref.token ? ' tab-order-dragging' : ''}`} onDragOver={event => { if (ref) over(event, ref); }} onDrop={event => { if (ref) drop(event, ref); }}>
      <button className="tab-select" disabled={disabled} draggable={!disabled} title={text.shortcut} aria-description={text.shortcut} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onContextMenu={event => { event.preventDefault(); if (ref) openMenu(ref, event.currentTarget); }} onDragStart={event => { if (ref) start(event, ref); else event.preventDefault(); }} onKeyDown={event => { if (ref) move(event, ref); }} onClick={() => { if (available() && latest.current.orderAvailable && ref && useWorkspace.getState().resolveTabOrder(ref)) { retireMenu(); useWorkspace.getState().updateSettings({ activeTabId: ref.id }); } }}>{tab.kind === 'query' ? <FileCode2 size={14}/> : <Table2 size={14}/>}<span>{tab.title}</span>{dirty && <span className="dirty-dot"/>}</button>
      {tab.kind === 'query' && onCloseSide && <button className="tab-query-menu" disabled={disabled} aria-label={closeText.menuButton(tab.title)} aria-haspopup="menu" aria-expanded={queryMenu?.anchor.token === ref?.token} onClick={event => { if (ref) openMenu(ref, event.currentTarget); }}>⋯</button>}
      <button className="tab-close" disabled={disabled} aria-label={formatText(zh.app.text012, tab.title)} onClick={() => { if (available() && latest.current.orderAvailable && ref && useWorkspace.getState().resolveTabOrder(ref)) latest.current.onClose(ref.id); }}><X size={12}/></button>
    </div>;
  }) : <div className="welcome-tab"><Database size={14}/>{zh.app.text013}</div>}<button className="add-tab" title={zh.common.newQuery} aria-label={zh.app.text014} onClick={() => { if (available()) latest.current.onNew(); }}><Plus size={15}/></button></div>{(status || !orderAvailable) && <div className="tab-order-help" role="status" aria-live="polite">{orderAvailable ? status : text.unavailable}</div>}{queryMenu && <div ref={menuElement} role="menu" className="query-tab-menu" aria-label={closeText.menu(queryMenu.tabs.find(tab => tab.id === queryMenu.anchor.id)!.title)} onKeyDown={event => menuKey(event, queryMenu)}>{(['left', 'right'] as const).map(side => <button key={side} role="menuitem" disabled={!queryMenu.tabs.some((tab, index) => tab.kind === 'query' && (side === 'left' ? index < queryMenu.tabs.findIndex(tab => tab.id === queryMenu.anchor.id) : index > queryMenu.tabs.findIndex(tab => tab.id === queryMenu.anchor.id)))} onClick={() => chooseSide(queryMenu, side)}>{closeText[side]}</button>)}<button role="menuitem" onClick={() => retireMenu(queryMenu, true)}>{closeText.menuCancel}</button></div>}</>;
}
