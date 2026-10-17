import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** 扣除实际工具条和状态栏，至少给结果内容保留96像素；不足时编辑区可仅视觉压缩到0。 */
export function queryLayoutMaximum(height: number, chrome: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.floor(height - chrome - 96)));
}

/** 测量当前标签的实际可用区，隐藏标签不沿用全局窗口高度；只返回显示边界，不保存偏好。 */
export function useQueryLayoutMaximum(root: RefObject<HTMLDivElement | null>, maximum: number): number {
  const [value, setValue] = useState(maximum), observer = useRef<ResizeObserver | null>(null), watched = useRef(new Set<Element>());
  /** 只扣固定chrome，编辑区与弹性结果内容不反向参与保存高度。 */
  function measure() {
    const element = root.current; if (!element) return;
    let chrome = 0;
    for (const child of Array.from(element.children)) {
      if (child.classList.contains('sql-editor-wrap') || child.classList.contains('result-body')) continue;
      chrome += child.getBoundingClientRect().height;
    }
    setValue(queryLayoutMaximum(element.getBoundingClientRect().height, chrome, maximum));
  }
  useLayoutEffect(() => {
    const element = root.current;
    observer.current = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (element) { observer.current?.observe(element); watched.current.add(element); }
    window.addEventListener('resize', measure);
    return () => { observer.current?.disconnect(); observer.current = null; watched.current.clear(); window.removeEventListener('resize', measure); };
  }, [maximum]);
  // 新结果/错误/固定结果工具条可改变占用，React提交后补观察；相同测量不会重渲染。
  useLayoutEffect(() => {
    const next = new Set<Element>(root.current ? [root.current, ...Array.from(root.current.children)] : []);
    for (const previous of watched.current) if (!next.has(previous)) observer.current?.unobserve(previous);
    for (const child of next) if (!watched.current.has(child)) observer.current?.observe(child);
    watched.current = next;
    measure();
  });
  return value;
}
