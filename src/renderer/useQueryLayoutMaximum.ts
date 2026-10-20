import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** 外层及结果内部工具条分别计费，网格内容另留96像素；不足时仅视觉压缩编辑区。 */
export function queryLayoutMaximum(height: number, chrome: number, maximum: number, resultChrome=0): number {
  return Math.max(0, Math.min(maximum, Math.floor(height - chrome - 96 - resultChrome)));
}

/** 只沿本结果的固定容器查找工具条，不扫描虚拟行、字段值或旁侧行详情。 */
function resultLayoutChrome(root:Element):Element[]{
  const child=(parent:Element|undefined,name:string)=>Array.from(parent?.children??[]).find(node=>node.classList.contains(name));
  const body=child(root,'result-body'),details=child(body,'query-result-with-details'),holder=child(details,'query-result-grid'),copy=child(holder,'query-result-copy-region'),find=child(copy,'query-result-find-region');
  return[child(copy,'query-result-copy-actions'),child(find,'query-result-find-toolbar'),child(find,'query-result-find-status')].filter((node):node is Element=>!!node);
}

/** 测量当前标签的实际可用区，隐藏标签不沿用全局窗口高度；只调整显示边界，不保存偏好。 */
export function useQueryLayoutMaximum(root: RefObject<HTMLDivElement | null>, maximum: number): number {
  const [value, setValue] = useState(maximum), observer = useRef<ResizeObserver | null>(null), watched = useRef(new Set<Element>());
  const minimum=useRef<{element:HTMLDivElement;height:number}|undefined>(undefined);
  /** 只扣固定chrome，编辑区与弹性结果内容不反向参与保存高度。 */
  function measure() {
    const element = root.current; if (!element) return;
    let chrome = 0;
    for (const child of Array.from(element.children)) {
      if (child.classList.contains('sql-editor-wrap') || child.classList.contains('result-body')) continue;
      chrome += child.getBoundingClientRect().height;
    }
    const resultChrome=Math.ceil(resultLayoutChrome(element).reduce((sum,node)=>sum+Math.max(0,node.getBoundingClientRect().height),0)),height=96+resultChrome;
    // 此变量仅属于当前标签的显示布局；极短窗口靠标签滚动，不让内部工具条挤掉表头。
    if(minimum.current?.element!==element||minimum.current.height!==height){element.style.setProperty('--query-result-min-height',`${height}px`);minimum.current={element,height};}
    setValue(queryLayoutMaximum(element.getBoundingClientRect().height, chrome, maximum,resultChrome));
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
    const next = new Set<Element>(root.current ? [root.current, ...Array.from(root.current.children),...resultLayoutChrome(root.current)] : []);
    for (const previous of watched.current) if (!next.has(previous)) observer.current?.unobserve(previous);
    for (const child of next) if (!watched.current.has(child)) observer.current?.observe(child);
    watched.current = next;
    measure();
  });
  return value;
}
