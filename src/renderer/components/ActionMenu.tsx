import { Children, Fragment, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkspace } from '../store';
import '../actionMenu.css';

interface SectionProps { label: string; children: ReactNode; }
interface ButtonProps { children?: ReactNode; disabled?: boolean; title?: string; className?: string; 'aria-label'?: string; 'data-menu-group'?: string; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; }
interface Props {
  label: string; icon?: ReactNode; className?: string; disabled?: boolean; children: ReactNode;
  isCurrent?(): boolean; contextKey?: string;
}
type Entry = { kind: 'button'; element: ReactElement<ButtonProps> } | { kind: 'section'; label: string; entries: Entry[] } | { kind: 'custom'; element: ReactNode };
interface Owner { anchor: HTMLButtonElement; contextKey?: string; entries: Entry[]; generation: object; observer: MutationObserver; valid: boolean; unsubscribeStore?: () => void; }
let dismissCurrent: (() => void) | undefined;

/** 声明一个分组子菜单；实际内容由ActionMenu在原owner内渲染。 */
export function ActionMenuSection(_props: SectionProps): ReactNode { return null; }

/** 只展开Fragment及显式分组；不会调用业务组件或复制其状态。 */
function entriesOf(children: ReactNode): Entry[] {
  const entries: Entry[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) entries.push(...entriesOf((child.props as { children: ReactNode }).children));
    else if (child.type === ActionMenuSection) { const props = child.props as SectionProps; entries.push({ kind: 'section', label: props.label, entries: entriesOf(props.children) }); }
    else if (child.type === 'button') entries.push({ kind: 'button', element: child as ReactElement<ButtonProps> });
    else entries.push({ kind: 'custom', element: child });
  });
  return entries;
}

/** 打开菜单只捕获展示与原回调；不查询数据库，不渲染隐藏的兼容按钮。 */
export function ActionMenu({ label, icon, className, disabled, children, isCurrent, contextKey }: Props) {
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), submenu = useRef<HTMLDivElement>(null);
  const latest = useRef({ disabled, isCurrent, contextKey }); latest.current = { disabled, isCurrent, contextKey };
  const alive = useRef(false), generation = useRef<object>({}), ownerRef = useRef<Owner | undefined>(undefined);
  const source = useRef(children); source.current = children;
  const dismissRef = useRef<() => void>(() => close());
  const [owner, setOwner] = useState<Owner>(), [path, setPath] = useState<number[]>([]);
  const [subAnchor, setSubAnchor] = useState<HTMLElement>();
  const contextRef = useRef(contextKey);
  if (contextRef.current !== contextKey) { contextRef.current = contextKey; generation.current = {}; }

  /** 仅消费原菜单；迟到事件不能关闭后来打开的菜单。 */
  function close(current = ownerRef.current, focus = false): void {
    if (!current || ownerRef.current !== current) return;
    current.valid = false; current.observer.disconnect();
    const unsubscribe = current.unsubscribeStore; current.unsubscribeStore = undefined; unsubscribe?.();
    ownerRef.current = undefined;
    if (dismissCurrent === dismissRef.current) dismissCurrent = undefined;
    if (alive.current) { setOwner(undefined); setPath([]); setSubAnchor(undefined); }
    if (focus && current.anchor.isConnected) current.anchor.focus();
  }

  /** 模态曾出现、目标换代或原锚点消失后，旧操作永久失效。 */
  function current(candidate: Owner): boolean {
    if (ownerRef.current !== candidate || !candidate.valid || !alive.current || !candidate.anchor.isConnected || generation.current !== candidate.generation || latest.current.disabled || latest.current.contextKey !== candidate.contextKey || latest.current.isCurrent?.() === false) return false;
    const records = candidate.observer.takeRecords();
    if (records.some(record => record.type === 'attributes' ? record.attributeName === 'role' && ['dialog', 'alertdialog'].includes(record.oldValue ?? '') : [...record.addedNodes, ...record.removedNodes].some(hasModal))) candidate.valid = false;
    return candidate.valid && !document.querySelector('[role="dialog"], [role="alertdialog"]');
  }
  function hasModal(node: Node): boolean { return node.nodeType === 1 && (['dialog', 'alertdialog'].includes((node as Element).getAttribute('role') ?? '') || !!(node as Element).querySelector('[role="dialog"], [role="alertdialog"]')); }

  /** 一个页面同时只有一份分组菜单，旧菜单先退出再捕获新目标。 */
  function open(): void {
    if (ownerRef.current) { close(ownerRef.current, true); return; }
    const node = anchor.current;
    if (!node || disabled || isCurrent?.() === false || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    dismissCurrent?.();
    const observer = new MutationObserver(records => {
      const candidate = ownerRef.current; if (!candidate) return;
      if (records.some(record => record.type === 'attributes' ? ['dialog', 'alertdialog'].includes(record.oldValue ?? '') || hasModal(record.target) : [...record.addedNodes, ...record.removedNodes].some(hasModal)) || !current(candidate)) close(candidate);
    });
    const candidate: Owner = { anchor: node, contextKey, entries: entriesOf(children), generation: generation.current, observer, valid: true };
    ownerRef.current = candidate; observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['role', 'hidden'] });
    // 每次store通知都复核原proof；同批次A→B→A不能等React最终值而复活旧菜单。
    candidate.unsubscribeStore = useWorkspace.subscribe(() => { if (!current(candidate)) close(candidate); });
    dismissCurrent = dismissRef.current; setPath([]); setOwner(candidate);
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; close(); }; }, []);
  useLayoutEffect(() => { const candidate = ownerRef.current; if (candidate && !current(candidate)) close(candidate); });
  useEffect(() => {
    if (!owner) return;
    const pointer = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !submenu.current?.contains(event.target) && !owner.anchor.contains(event.target)) close(owner); };
    const blur = () => close(owner);
    const scroll = (event: Event) => { if (event.target instanceof Node && (panel.current?.contains(event.target) || submenu.current?.contains(event.target))) return; close(owner); };
    document.addEventListener('pointerdown', pointer, true); window.addEventListener('blur', blur); window.addEventListener('resize', blur); document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); document.removeEventListener('scroll', scroll, true); };
  }, [owner]);
  useLayoutEffect(() => {
    if (!owner || !panel.current) return;
    const bounds = owner.anchor.getBoundingClientRect(), node = panel.current, rect = node.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - rect.width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - rect.height - 8)) + 'px';
    if (!path.length) node.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus();
  }, [owner]);
  useLayoutEffect(() => {
    if (!owner || !submenu.current || !subAnchor) return;
    const node = submenu.current, bounds = subAnchor.getBoundingClientRect(), rect = node.getBoundingClientRect();
    const left = bounds.right + rect.width + 8 <= window.innerWidth ? bounds.right + 4 : bounds.left - rect.width - 4;
    node.style.left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(bounds.top, window.innerHeight - rect.height - 8)) + 'px';
    node.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus();
  }, [owner, path, subAnchor]);

  /** 方向键仅操作当前层；动作执行前先消费原owner再调用原业务回调。 */
  function keydown(event: KeyboardEvent<HTMLDivElement>, candidate: Owner, nested: boolean): void {
    if (!current(candidate)) { close(candidate); return; }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(candidate, true); return; }
    if (event.key === 'Tab') {
      // 自定义表单可在同层控件间Tab；离开首尾时才关闭菜单。
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
        const position = controls.indexOf(event.target), next = controls[position + (event.shiftKey ? -1 : 1)];
        if (next) { event.preventDefault(); next.focus(); return; }
      }
      close(candidate); return;
    }
    // 菜单内数字/文本控件保留原生光标与步进键，不把编辑按键改成菜单导航。
    if (event.target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable)
      && !(event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) return;
    if (nested && event.key === 'ArrowLeft') { event.preventDefault(); setPath([]); setSubAnchor(undefined); subAnchor?.focus(); return; }
    if (event.key === 'ArrowRight') { const target = event.target; if (target instanceof HTMLButtonElement && target.dataset.submenuIndex) { event.preventDefault(); setPath([Number(target.dataset.submenuIndex)]); setSubAnchor(target); } return; }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length; else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = buttons.length - 1; else return;
    if (buttons[next]) { event.preventDefault(); buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' }); }
  }
  /** 当前展示项仍须存在且可用，避免菜单打开期间原按钮被禁用后执行旧回调。 */
  function actionAvailable(index: number, nested: boolean): boolean {
    const fresh = freshEntry(index, nested);
    return fresh?.kind === 'button' && !fresh.element.props.disabled;
  }
  /** 表单展示读取最新受控值，菜单的业务动作仍使用打开时捕获的回调和owner。 */
  function freshEntry(index: number, nested: boolean): Entry | undefined {
    const root = entriesOf(source.current), parent = path.length ? root[path[0]] : undefined;
    return nested ? parent?.kind === 'section' ? parent.entries[index] : undefined : root[index];
  }
  function renderEntries(entries: Entry[], candidate: Owner, nested = false): ReactNode {
    return entries.map((entry, index) => {
      if (entry.kind === 'custom') { const fresh = freshEntry(index, nested); return <Fragment key={index}>{fresh?.kind === 'custom' ? fresh.element : entry.element}</Fragment>; }
      if (entry.kind === 'section') return <button type="button" key={index} role="menuitem" aria-haspopup="menu" aria-expanded={path[0] === index} data-submenu-index={String(index)} onClick={event => { if (!current(candidate)) { close(candidate); return; } setPath([index]); setSubAnchor(event.currentTarget); }}><span>{entry.label}</span><ChevronRight size={13}/></button>;
      const original = entry.element, group = original.props['data-menu-group'], previous = index ? entries[index - 1] : undefined;
      const label = original.props['aria-label'] ?? original.props.title;
      const content = original.props.children;
      return <Fragment key={index}>{index > 0 && group && previous?.kind === 'button' && previous.element.props['data-menu-group'] !== group && <div role="separator"/>}{cloneElement(original, { role: 'menuitem', className: original.props.className, onClick: (event: MouseEvent<HTMLButtonElement>) => { if (original.props.disabled || !current(candidate) || !actionAvailable(index, nested)) { close(candidate); return; } close(candidate); original.props.onClick?.(event); } } as Partial<ButtonProps>, <>{content}{label && !containsText(content) && <span>{label}</span>}</>)}</Fragment>;
    });
  }
  const section = owner && path.length ? owner.entries[path[0]] : undefined;
  return <><button ref={anchor} type="button" className={`action-menu-trigger ${className ?? ''}`} disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={!!owner} onClick={open} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!ownerRef.current) open(); } }}>{icon}<span className="action-menu-label">{label}</span><ChevronDown className="action-menu-chevron" size={12}/></button>{owner && createPortal(<><div ref={panel} className="action-menu-panel" role="menu" aria-label={label} onKeyDown={event => keydown(event, owner, false)}>{renderEntries(owner.entries, owner)}</div>{section?.kind === 'section' && <div ref={submenu} className="action-menu-panel action-menu-submenu" role="menu" aria-label={section.label} onKeyDown={event => keydown(event, owner, true)}>{renderEntries(section.entries, owner, true)}</div>}</>, document.body)}</>;
}

/** 图标按钮迁入菜单时补充文字，已有可见文案不重复。 */
function containsText(children: ReactNode): boolean {
  let result = false;
  Children.forEach(children, child => { if (typeof child === 'string' && child.trim() || typeof child === 'number') result = true; else if (isValidElement(child) && child.type === Fragment && containsText((child.props as { children: ReactNode }).children)) result = true; });
  return result;
}
