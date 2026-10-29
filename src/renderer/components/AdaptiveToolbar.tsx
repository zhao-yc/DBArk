import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActionMenu } from './ActionMenu';
import '../navigation.css';

export interface AdaptiveToolbarItem { key: string; content: ReactNode; overflow?: ReactNode; }
interface Props { className?: string; ariaLabel: string; items: AdaptiveToolbarItem[]; more: ReactNode; moreLabel?: string; moreDisabled?: boolean; contextKey?: string; isCurrent?: () => boolean; }

/** 仅测量实际可见按钮；空间不足的完整动作转入更多，没有隐藏的旧入口。 */
export function AdaptiveToolbar({ className = '', ariaLabel, items, more, moreLabel = '更多', moreDisabled, contextKey, isCurrent }: Props) {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLDivElement>(null), widths = useRef(new Map<string, number>());
  const [visible, setVisible] = useState(items.length), current = useRef({ items, visible }); current.current = { items, visible };
  const measureRef = useRef<() => void>(() => undefined);
  measureRef.current = () => {
    const node = root.current; if (!node) return;
    const style = getComputedStyle(node), gap = Number.parseFloat(style.columnGap) || 0;
    for (const element of node.querySelectorAll<HTMLElement>(':scope > [data-toolbar-item]')) {
      const key = element.dataset.toolbarItem;
      if (key) widths.current.set(key, element.getBoundingClientRect().width);
    }
    const available = node.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const reserved = (trigger.current?.getBoundingClientRect().width ?? 60) + gap;
    let used = reserved, count = 0;
    for (const item of current.current.items) {
      const width = widths.current.get(item.key) ?? 88;
      if (used + width + (count ? gap : 0) > available) break;
      used += width + (count ? gap : 0); count++;
    }
    if (count !== current.current.visible) setVisible(count);
  };
  useLayoutEffect(() => { measureRef.current(); });
  useLayoutEffect(() => {
    const node = root.current; if (!node) return;
    const observer = new ResizeObserver(() => measureRef.current()); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={root} className={`adaptive-toolbar ${className}`} role="toolbar" aria-label={ariaLabel}>
    {items.slice(0, visible).map(item => <div key={item.key} data-toolbar-item={item.key}>{item.content}</div>)}
    <div ref={trigger} className="toolbar-overflow"><ActionMenu label={moreLabel} disabled={moreDisabled} contextKey={contextKey} isCurrent={isCurrent}>
      {items.slice(visible).map(item => <Fragment key={item.key}>{item.overflow ?? item.content}</Fragment>)}{more}
    </ActionMenu></div>
  </div>;
}
