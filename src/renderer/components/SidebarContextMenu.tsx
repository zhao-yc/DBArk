import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WorkbenchTarget } from '../../shared/workbench';
import { useWorkspace } from '../store';
import { sidebarContextMenuZh as text } from '../locales/sidebarContextMenu.zh-CN';
import '../sidebarContextMenu.css';

export type SidebarNodeTarget = { kind: 'connection'; connectionId: string } | WorkbenchTarget;
type ActionProps = { children?: ReactNode; title?: string; disabled?: boolean; className?: string; 'aria-label'?: string; 'data-menu-group'?: string; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; menu?: boolean; beforeAction?: () => boolean };
type RowLease = { current(): boolean };
interface MenuOwner {
  target: SidebarNodeTarget; name: string; node: HTMLElement; lease: RowLease; actions: ReactNode;
  x: number; y: number; profile: unknown; revision: number; observer: MutationObserver; release(): void;
}
interface TreeContext {
  selected(target: SidebarNodeTarget): boolean;
  select(target: SidebarNodeTarget): void;
  open(target: SidebarNodeTarget, name: string, node: HTMLElement, lease: RowLease, actions: ReactNode, point?: { x: number; y: number }): void;
  retireFor(node: HTMLElement | null): void;
}
const Context = createContext<TreeContext | null>(null);

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
  const [selected, setSelected] = useState<SidebarNodeTarget>(), selectedRef = useRef<SidebarNodeTarget | undefined>(undefined);
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
  function select(target: SidebarNodeTarget) {
    const next = { ...target }; selectedRef.current = next; setSelected(next);
    useWorkspace.getState().select({ connectionId: target.connectionId, ...(target.kind === 'connection' ? {} : { database: target.database }) });
  }

  /** 指针和键盘共用目标捕获；打开菜单不会调用节点的左键展开处理器。 */
  function open(target: SidebarNodeTarget, name: string, node: HTMLElement, lease: RowLease, actions: ReactNode, point?: { x: number; y: number }) {
    retire();
    if (!mounted.current || !node.isConnected || !lease.current() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const state = useWorkspace.getState(), profile = state.connections.find(profile => profile.id === target.connectionId);
    if (!profile) return;
    select(target);
    const bounds = node.getBoundingClientRect(), releases: Array<() => void> = [];
    const observer = new MutationObserver(records => { if (modalChanged(records)) retire(owner); });
    const owner: MenuOwner = { target: { ...target }, name, node, lease, actions, x: point?.x ?? bounds.left, y: point?.y ?? bounds.bottom,
      profile, revision: state.connectionVersions[target.connectionId] ?? 0, observer,
      release() { observer.disconnect(); for (const release of releases.splice(0)) release(); } };
    ownerRef.current = owner;
    const pointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) retire(owner); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); retire(owner, true); } };
    const blur = () => retire(owner);
    const scroll = (event: Event) => { const node = event.target; if (node instanceof Element && node.closest('.tree-scroll') && !menuRef.current?.contains(node)) retire(owner); };
    document.addEventListener('pointerdown', pointer, true); document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    releases.push(() => document.removeEventListener('pointerdown', pointer, true), () => document.removeEventListener('keydown', escape, true),
      () => document.removeEventListener('scroll', scroll, true), () => window.removeEventListener('blur', blur), () => window.removeEventListener('resize', blur));
    releases.push(useWorkspace.subscribe(() => { if (!current(owner)) retire(owner); }));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['role'] });
    setMenu(owner);
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; retire(); }; }, []);
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
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement); let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = buttons.length - 1; else return;
    event.preventDefault(); buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
  }

  const context: TreeContext = {
    selected(target) {
      const local = selectedRef.current;
      if (local && sameScope(local)) return sidebarNodeKey(local) === sidebarNodeKey(target);
      return selection?.connectionId === target.connectionId && (target.kind === 'connection' ? !selection.database : target.kind === 'database' && selection.database === target.database);
    }, select, open,
    retireFor(node) { if (node && ownerRef.current?.node === node) retire(); }
  };
  // selected是渲染订阅，真正选择身份从同步ref读取，避免同轮右键读取旧state。
  void selected;
  return <Context.Provider value={context}>{children}{menu && createPortal(<div ref={menuRef} role="menu" className="sidebar-context-menu" aria-label={text.title(menu.name)} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => keydown(event, menu)}>
    <div className="sidebar-context-menu-title" title={menu.name}>{menu.name}</div>
    <SidebarMenuActions actions={menu.actions} execute={() => execute(menu)}/>
  </div>, document.body)}</Context.Provider>;
}

/** 只在菜单打开时渲染原操作；没有隐藏按钮或保留操作区高度。 */
function SidebarMenuActions({ actions, execute }: { actions: ReactNode; execute(): boolean }) {
  const items: ReactElement<ActionProps>[] = [];
  const visit = (nodes: ReactNode) => Children.forEach(nodes, child => {
    if (!isValidElement<ActionProps>(child)) return;
    if (child.type === Fragment) visit(child.props.children); else items.push(child);
  }); visit(actions);
  const groups = ['general', 'create', 'structure', 'danger'];
  items.sort((a, b) => groups.indexOf(a.props['data-menu-group'] ?? 'general') - groups.indexOf(b.props['data-menu-group'] ?? 'general'));
  return <>{items.map((item, index) => {
    const group = item.props['data-menu-group'] ?? 'general', previous = items[index - 1]?.props['data-menu-group'] ?? 'general';
    const content = item.type === 'button'
      ? cloneElement(item, { role: 'menuitem', className: group === 'danger' ? 'danger' : undefined, onClick: (event: MouseEvent<HTMLButtonElement>) => { if (!item.props.disabled && execute()) item.props.onClick?.(event); } } as Partial<ActionProps>, <>{item.props.children}<span>{item.props.title ?? item.props['aria-label']}</span></>)
      : cloneElement(item, { menu: true, beforeAction: execute });
    return <Fragment key={index}>{index > 0 && previous !== group && <div role="separator"/>}{content}</Fragment>;
  })}</>;
}

/** 每个节点持有独立租约，目录代次变化或卸载永久撤销旧菜单；不依赖名称反查新对象。 */
export function SidebarTreeRow({ target, label, className, version, actions, children }: { target: SidebarNodeTarget; label: string; className: string; version: readonly unknown[]; actions: ReactNode; children: ReactElement }) {
  const context = useContext(Context), row = useRef<HTMLDivElement>(null);
  const lease = useRef<{ key: string; version: readonly unknown[]; token: object } | undefined>(undefined);
  const key = sidebarNodeKey(target);
  if (!lease.current || lease.current.key !== key || lease.current.version.length !== version.length || version.some((value, index) => value !== lease.current!.version[index])) lease.current = { key, version: [...version], token: {} };
  const token = lease.current.token, latest = useRef({ target, label, actions, token }); latest.current = { target, label, actions, token };
  useLayoutEffect(() => { const node = row.current; context?.retireFor(node); return () => context?.retireFor(node); }, [token]);
  useLayoutEffect(() => () => context?.retireFor(row.current), []);
  /** 右键与菜单键仅选择节点，不调用children的左键处理器。 */
  function menu(point?: { x: number; y: number }) {
    const node = row.current, captured = latest.current;
    if (node) context?.open(captured.target, captured.label, node, { current: () => row.current === node && latest.current.token === captured.token }, captured.actions, point);
  }
  const button = children as ReactElement<{ onClick?: (event: MouseEvent<HTMLButtonElement>) => void; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void; title?: string }>;
  return <div ref={row} className={`tree-row ${className}${context?.selected(target) ? ' active' : ''}`} data-sidebar-node={key} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); menu(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined); }}>
    {cloneElement(button, { title: button.props.title ?? label, 'aria-haspopup': 'menu', onClick: (event: MouseEvent<HTMLButtonElement>) => { context?.select(target); button.props.onClick?.(event); }, onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); menu(); } else button.props.onKeyDown?.(event);
    } } as Partial<typeof button.props>)}
  </div>;
}
