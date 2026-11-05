import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { tableCellFilterZh as text } from '../locales/tableCellFilter.zh-CN';
import type { GridCellMenuAnchor } from './ResultsGrid';
import '../sidebarContextMenu.css';

/** 鼠标和键盘共用菜单；只在用户选中操作后把当前捕获交给表页。 */
export function PostgresTableCellFilterMenu({ anchor, column, onClose, onChoose }: {
  anchor: GridCellMenuAnchor; column: string; onClose(restoreFocus: boolean): void; onChoose(exclude: boolean): void;
}) {
  const menu = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector('button')?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (!element.contains(event.target as Node)) close.current(false); };
    const dismiss = () => close.current(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [anchor]);
  return createPortal(<div ref={menu} role="menu" aria-label={text.context} className="sidebar-context-menu"
    style={{ left: anchor.x, top: anchor.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
      if (event.key === 'Tab') { event.preventDefault(); onClose(true); }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const buttons = event.currentTarget.querySelectorAll('button');
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : document.activeElement === buttons[0] ? 1 : 0]?.focus();
      }
    }}>
    <div className="sidebar-context-menu-title" title={column}>{column}</div>
    <button type="button" role="menuitem" onClick={() => onChoose(false)}>{text.equal}</button>
    <button type="button" role="menuitem" onClick={() => onChoose(true)}>{text.exclude}</button>
  </div>, document.body);
}
