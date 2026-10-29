import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { WorkbenchTarget } from '../../shared/workbench';
import { useWorkspace } from '../store';
import { sidebarContextMenuZh as text } from '../locales/sidebarContextMenu.zh-CN';
import '../sidebarContextMenu.css';

export type SidebarNodeTarget = { kind: 'connection'; connectionId: string } | WorkbenchTarget;
type ActionProps = { children?: ReactNode; title?: string; disabled?: boolean; className?: string; 'aria-label'?: string; 'data-menu-group'?: string; 'data-menu-order'?: number; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; menu?: boolean; beforeAction?: () => boolean };
type RowLease = { node?: HTMLElement; current(): boolean };
interface MenuOwner {
  target: SidebarNodeTarget; name: string; node: HTMLElement; lease: RowLease; actions: ReactNode;
  x: number; y: number; profile: unknown; revision: number; observer: MutationObserver; release(): void;
}
interface TreeContext {
  target?: SidebarNodeTarget;
  current(): SidebarNodeTarget | undefined;
  selected(target: SidebarNodeTarget): boolean;
  select(target: SidebarNodeTarget, lease?: RowLease): void;
  open(target: SidebarNodeTarget, name: string, node: HTMLElement, lease: RowLease, actions: ReactNode, point?: { x: number; y: number }): void;
  retireFor(node: HTMLElement | null): void;
}
const Context = createContext<TreeContext | null>(null);

/** 左树与中央对象列表共用明确选择，不将当前编辑标签作为对象菜单的隐式目标。 */
export function useSidebarSelection(): { target?: SidebarNodeTarget; current(): SidebarNodeTarget | undefined; select(target: SidebarNodeTarget): void } {
  const context = useContext(Context);
  if (!context) throw new Error('对象导航必须位于统一选择容器内');
  return { target: context.target, current: context.current, select: context.select };
}

/** 名称中的分隔符不能混淆连接、库或同名不同种类对象。 */
export function sidebarNodeKey(target: SidebarNodeTarget): string {
  return JSON.stringify([target.connectionId, target.kind === 'connection' ? null : target.database, target.kind, 'name' in target ? target.name : null]);
}

/** 只比较树选择上下文，不把当前编辑标签作为右键动作的目标来源。 */
function sameScope(target: SidebarNodeTarget): boolean {
  const selection = useWorkspace.getState().selection;
  return selection?.connectionId === target.connectionId && selection.database === (target.kind === 'connection' ? undefined : target.database);
}

/** 模态出现后即使马上移除，也不能让旧菜单恢复执行资格。 */
function modalChanged(records: MutationRecord[]): boolean {
  const modal = (node: Node) => node.nodeType === 1 && (['dialog', 'alertdialog'].includes((node as Element).getAttribute('role') ?? '') || !!(node as Element).querySelector('[role="dialog"], [role="alertdialog"]'));
  return records.some(record => record.type === 'attributes'
    ? ['dialog', 'alertdialog'].includes(record.oldValue ?? '') || modal(record.target)
    : [...record.addedNodes, ...record.removedNodes].some(modal));
}

/** 全树共享一个菜单；选择与菜单均为会话界面状态，不写配置或发送数据库请求。 */
export function SidebarTreeProvider({ children }: { children: ReactNode }) {
  const selection = useWorkspace(state => state.selection);
  const profiles = useWorkspace(state => state.connections), revisions = useWorkspace(state => state.connectionVersions);
  const [selected, setSelected] = useState<SidebarNodeTarget>(), selectedRef = useRef<SidebarNodeTarget | undefined>(undefined);
  const selectedOwner = useRef<{ profile: unknown; revision: number; lease?: RowLease; invalid: boolean } | undefined>(undefined);
  const fallbackSelection = useRef<{ selection: ReturnType<typeof useWorkspace.getState>['selection']; profile: unknown; revision: number; target: SidebarNodeTarget } | undefined>(undefined);
  const [menu, setMenu] = useState<MenuOwner>(), ownerRef = useRef<MenuOwner | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null), mounted = useRef(false);

  /** 只清理原owner；迟到事件不能关闭后来打开的菜单。 */
  function retire(owner = ownerRef.current, restoreFocus = false) {
    if (!owner || ownerRef.current !== owner) return;
    ownerRef.current = undefined; owner.release();
    if (mounted.current) setMenu(undefined);
    if (restoreFocus && owner.node.isConnected) owner.node.querySelector<HTMLButtonElement>('.tree-label')?.focus();
  }

  /** 执行前同步核对节点、目录代次、原连接对象和修订，不能从新选择重定向旧动作。 */
  function current(owner: MenuOwner): boolean {
    if (ownerRef.current !== owner) return false;
    if (modalChanged(owner.observer.takeRecords())) { retire(owner); return false; }
    const state = useWorkspace.getState();
    return owner.node.isConnected && owner.lease.current() && sameScope(owner.target)
      && !document.querySelector('[role="dialog"], [role="alertdialog"]')
      && state.connections.find(profile => profile.id === owner.target.connectionId) === owner.profile
      && (state.connectionVersions[owner.target.connectionId] ?? 0) === owner.revision;
  }

  /** 菜单资格同步消费一次，再由原操作继续负责权限、忙态和用户确认。 */
  function execute(owner: MenuOwner): boolean {
    if (!current(owner)) { retire(owner); return false; }
    retire(owner, true); return true;
  }

  /** 同步选择先于菜单发布，保留当前标签、SQL、事务及展开状态。 */
  function select(target: SidebarNodeTarget, lease?: RowLease) {
    const state = useWorkspace.getState(), profile = state.connections.find(item => item.id === target.connectionId);
    if (!profile || lease?.current() === false) return;
    const next = { ...target }; selectedRef.current = next; setSelected(next);
    selectedOwner.current = { profile, revision: state.connectionVersions[target.connectionId] ?? 0, lease, invalid: false };
    useWorkspace.getState().select({ connectionId: target.connectionId, ...(target.kind === 'connection' ? {} : { database: target.database }) });
  }

  /** 原选择的连接或库曾离开后立即撤销对象身份，即使同名配置恢复也不复活旧动作。 */
  function selectedTarget(): SidebarNodeTarget | undefined {
    const target = selectedRef.current, state = useWorkspace.getState(), owner = selectedOwner.current;
    if (target && owner && !owner.invalid) {
      if (sameScope(target) && state.connections.find(item => item.id === target.connectionId) === owner.profile
        && (state.connectionVersions[target.connectionId] ?? 0) === owner.revision && owner.lease?.current() !== false) return target;
      owner.invalid = true;
    }
    if (!state.selection) return;
    const profile = state.connections.find(item => item.id === state.selection!.connectionId);
    if (!profile) return;
    const revision = state.connectionVersions[state.selection.connectionId] ?? 0, fallback = fallbackSelection.current;
    if (fallback?.selection === state.selection && fallback.profile === profile && fallback.revision === revision) return fallback.target;
    const targetFallback: SidebarNodeTarget = state.selection.database === undefined
      ? { kind: 'connection', connectionId: state.selection.connectionId }
      : { kind: 'database', connectionId: state.selection.connectionId, database: state.selection.database };
    fallbackSelection.current = { selection: state.selection, profile, revision, target: targetFallback };
    return targetFallback;
  }

  /** 指针和键盘共用目标捕获；打开菜单不会调用节点的左键展开处理器。 */
  function open(target: SidebarNodeTarget, name: string, node: HTMLElement, lease: RowLease, actions: ReactNode, point?: { x: number; y: number }) {
    retire();
    if (!mounted.current || !node.isConnected || !lease.current() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const state = useWorkspace.getState(), profile = state.connections.find(profile => profile.id === target.connectionId);
    if (!profile) return;
    select(target, lease);
    const bounds = node.getBoundingClientRect(), releases: Array<() => void> = [];
    const observer = new MutationObserver(records => { if (modalChanged(records)) retire(owner); });
    const owner: MenuOwner = { target: { ...target }, name, node, lease, actions, x: point?.x ?? bounds.left, y: point?.y ?? bounds.bottom,
      profile, revision: state.connectionVersions[target.connectionId] ?? 0, observer,
      release() { observer.disconnect(); for (const release of releases.splice(0)) release(); } };
    ownerRef.current = owner;
    const pointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) retire(owner); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !(event.target instanceof Element && event.target.closest('[data-sidebar-submenu]'))) { event.preventDefault(); event.stopPropagation(); retire(owner, true); } };
    const blur = () => retire(owner);
    const scroll = (event: Event) => { const node = event.target; if (node instanceof Element && node.closest('.tree-scroll, .objects-browser-scroll') && !menuRef.current?.contains(node)) retire(owner); };
    document.addEventListener('pointerdown', pointer, true); document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    releases.push(() => document.removeEventListener('pointerdown', pointer, true), () => document.removeEventListener('keydown', escape, true),
      () => document.removeEventListener('scroll', scroll, true), () => window.removeEventListener('blur', blur), () => window.removeEventListener('resize', blur));
    releases.push(useWorkspace.subscribe(() => { if (!current(owner)) retire(owner); }));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['role'] });
    setMenu(owner);
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; retire(); }; }, []);
  useEffect(() => useWorkspace.subscribe(() => {
    const target = selectedRef.current;
    if (target && selectedTarget() !== target) { selectedRef.current = undefined; selectedOwner.current = undefined; setSelected(undefined); }
  }), []);
  useLayoutEffect(() => {
    if (!menu || ownerRef.current !== menu || !menuRef.current) return;
    if (!current(menu)) { retire(menu); return; }
    const node = menuRef.current, bounds = node.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8)) + 'px';
    node.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [menu]);

  /** 菜单键盘只移动可用操作；Enter/空格使用原生按钮，避免重复执行。 */
  function keydown(event: KeyboardEvent<HTMLDivElement>, owner: MenuOwner) {
    if (!current(owner)) { retire(owner); return; }
    if (event.key === 'Tab') { retire(owner, true); return; }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')].filter(button => button.closest('[role="menu"]') === event.currentTarget);
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement); let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = buttons.length - 1; else return;
    event.preventDefault(); buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
  }

  const context: TreeContext = {
    target: selectedTarget(),
    current: selectedTarget,
    selected(target) {
      const local = selectedTarget();
      if (local && sameScope(local)) return sidebarNodeKey(local) === sidebarNodeKey(target);
      return selection?.connectionId === target.connectionId && (target.kind === 'connection' ? !selection.database : target.kind === 'database' && selection.database === target.database);
    }, select, open,
    retireFor(node) {
      if (node && ownerRef.current?.node === node) retire();
      const owner = selectedOwner.current;
      // 只撤销已失效的原行证明，旧清理不能清掉同DOM后来产生的新选择。
      if (node && owner?.lease?.node === node && !owner.lease.current()) {
        owner.invalid = true; selectedRef.current = undefined; selectedOwner.current = undefined;
        if (mounted.current) setSelected(undefined);
      }
    }
  };
  // selected是渲染订阅，真正选择身份从同步ref读取，避免同轮右键读取旧state。
  void selected;
  void profiles; void revisions;
  return <Context.Provider value={context}>{children}{menu && createPortal(<div ref={menuRef} role="menu" className="sidebar-context-menu" aria-label={text.title(menu.name)} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => keydown(event, menu)}>
    <div className="sidebar-context-menu-title" title={menu.name}>{menu.name}</div>
    <SidebarMenuActions actions={menu.actions} execute={() => execute(menu)}/>
  </div>, document.body)}</Context.Provider>;
}

/** 只在菜单打开时渲染原操作；没有隐藏按钮或保留操作区高度。 */
function SidebarMenuActions({ actions, execute }: { actions: ReactNode; execute(): boolean }) {
  const [openGroup, setOpenGroup] = useState<string>();
  useEffect(() => setOpenGroup(undefined), [actions]);
  const items: ReactElement<ActionProps>[] = [];
  const visit = (nodes: ReactNode) => Children.forEach(nodes, child => {
    if (!isValidElement<ActionProps>(child)) return;
    if (child.type === Fragment) visit(child.props.children); else items.push(child);
  }); visit(actions);
  const groupFor = (item: ReactElement<ActionProps>) => item.props['data-menu-group'] ?? (item.props.menu ? 'favorite' : 'open');
  const groups = (['open', 'create', 'structure', 'transfer', 'favorite', 'refresh', 'danger'] as const)
    .map(group => ({ group, items: items.filter(item => groupFor(item) === group || group === 'open' && groupFor(item) === 'general')
      .sort((a, b) => (a.props['data-menu-order'] ?? 10) - (b.props['data-menu-order'] ?? 10)) })).filter(group => group.items.length);
  return <>{groups.map(({ group, items: groupItems }, index) => <Fragment key={group}>
    {index > 0 && <div role="separator"/>}
    {groupItems.length > 3 && group !== 'danger'
      ? <SidebarSubmenu label={text.groups[group]} open={openGroup === group} onOpen={() => setOpenGroup(group)} onClose={() => setOpenGroup(undefined)}>
        {groupItems.map((item, itemIndex) => <SidebarMenuAction key={itemIndex} item={item} danger={false} execute={execute}/>)}</SidebarSubmenu>
      : groupItems.map((item, itemIndex) => <SidebarMenuAction key={itemIndex} item={item} danger={group === 'danger'} execute={execute}/>)}
  </Fragment>)}</>;
}

/** 所有展示层级均消费同一个原节点租约；收藏仍走原组件的 beforeAction。 */
function SidebarMenuAction({ item, danger, execute }: { item: ReactElement<ActionProps>; danger: boolean; execute(): boolean }) {
  return item.type === 'button'
    ? cloneElement(item, { role: 'menuitem', className: danger ? 'danger' : undefined, onClick: (event: MouseEvent<HTMLButtonElement>) => { if (!item.props.disabled && execute()) item.props.onClick?.(event); } } as Partial<ActionProps>, <>{item.props.children}<span>{item.props.title ?? item.props['aria-label']}</span></>)
    : cloneElement(item, { menu: true, beforeAction: execute });
}

/** 较长的同类动作在原菜单的 DOM 子树展开，保留外部点击判断和原节点所有权。 */
function SidebarSubmenu({ label, open, onOpen, onClose, children }: { label: string; open: boolean; onOpen(): void; onClose(): void; children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null), submenu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !submenu.current) return;
    const anchor = trigger.current.getBoundingClientRect(), node = submenu.current, bounds = node.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(anchor.right + 3 + bounds.width > window.innerWidth - 8 ? anchor.left - bounds.width - 3 : anchor.right + 3, window.innerWidth - bounds.width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(anchor.top, window.innerHeight - bounds.height - 8)) + 'px';
    node.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);
  /** 子菜单只处理自己的按键，向左或 Escape 返回分组按钮，不关闭整个对象菜单。 */
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); onClose(); trigger.current?.focus(); return; }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = buttons.length - 1; else return;
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' });
  }
  return <div className="sidebar-context-submenu"><button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => open ? onClose() : onOpen()} onKeyDown={event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onOpen(); }
  }}><span>{label}</span><ChevronRight size={14}/></button>{open && <div ref={submenu} role="menu" aria-label={label} className="sidebar-context-menu sidebar-context-child-menu" data-sidebar-submenu="true" onKeyDown={keydown}>{children}</div>}</div>;
}

/** 每个节点持有独立租约，目录代次变化或卸载永久撤销旧菜单；不依赖名称反查新对象。 */
export function SidebarTreeRow({ target, label, className, version, actions, children, isCurrent }: { target: SidebarNodeTarget; label: string; className: string; version: readonly unknown[]; actions: ReactNode; children: ReactElement; isCurrent?: () => boolean }) {
  const context = useContext(Context), row = useRef<HTMLDivElement>(null);
  const present = useRef(false);
  const lease = useRef<{ key: string; version: readonly unknown[]; token: object } | undefined>(undefined);
  const key = sidebarNodeKey(target);
  if (!lease.current || lease.current.key !== key || lease.current.version.length !== version.length || version.some((value, index) => value !== lease.current!.version[index])) lease.current = { key, version: [...version], token: {} };
  const token = lease.current.token, latest = useRef({ target, label, actions, token, isCurrent }); latest.current = { target, label, actions, token, isCurrent };
  useLayoutEffect(() => { const node = row.current; context?.retireFor(node); return () => context?.retireFor(node); }, [token]);
  useLayoutEffect(() => { present.current = true; return () => { present.current = false; context?.retireFor(row.current); }; }, []);
  /** 行生命周期与目录代次共同约束选择和动作，中央列表同步刷新也能撤销旧目标。 */
  function proof(node: HTMLDivElement, captured: typeof latest.current): RowLease {
    return { node, current: () => present.current && row.current === node && latest.current.token === captured.token && captured.isCurrent?.() !== false };
  }
  /** 右键与菜单键仅选择节点，不调用children的左键处理器。 */
  function menu(point?: { x: number; y: number }) {
    const node = row.current, captured = latest.current;
    if (node) context?.open(captured.target, captured.label, node, proof(node, captured), captured.actions, point);
  }
  const button = children as ReactElement<{ onClick?: (event: MouseEvent<HTMLButtonElement>) => void; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void; title?: string }>;
  return <div ref={row} className={`tree-row ${className}${context?.selected(target) ? ' active' : ''}`} data-sidebar-node={key} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); menu(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined); }}>
    {cloneElement(button, { title: button.props.title ?? label, 'aria-haspopup': 'menu', onClick: (event: MouseEvent<HTMLButtonElement>) => {
      const node = row.current, captured = latest.current;
      if (!node || captured.token !== token) return;
      const lease = proof(node, captured); if (!lease.current()) return;
      context?.select(captured.target, lease); button.props.onClick?.(event);
    }, onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); menu(); } else button.props.onKeyDown?.(event);
    } } as Partial<typeof button.props>)}
  </div>;
}
