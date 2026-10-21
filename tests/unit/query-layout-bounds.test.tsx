import React, { act, useRef } from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
import { useQueryLayoutMaximum } from '../../src/renderer/useQueryLayoutMaximum';
import { queryEditorVisualHeight } from '../../src/renderer/components/QueryLayoutSplitter';
const globalNames = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver'];
const originals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const properties = ['children', 'classList', 'getBoundingClientRect','offsetHeight','clientHeight'].map(name => [name, Object.getOwnPropertyDescriptor(MemoryNode.prototype, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let height: number, toolbar: number, callbacks: Array<() => void>, observed: Set<Element>, disconnect: ReturnType<typeof vi.fn>, removed: Element[];
let result = 0, preferred = 500, showExtra = false, showResultBars=false, showFindStatus=false, resultToolbar=34,showDirectGrid=false,gridOuter=96,gridClient=96;
/** 只给真实ResizeObserver hook提供几何/观察端口，不把窗口变矮写进任何设置。 */
function Example() { const ref = useRef<HTMLDivElement>(null); result = useQueryLayoutMaximum(ref, 8192); return <div ref={ref} className="root"><div className="toolbar"/><div className="sql-editor-wrap" style={{ height: queryEditorVisualHeight(preferred, result) }}/><div className="query-layout-bar"/><div className="result-body">{(showResultBars||showDirectGrid)&&<div className="query-result-with-details"><div className="query-result-grid">{showDirectGrid?<div className="results-grid"/>:<div className="query-result-copy-region"><div className="query-result-copy-actions"/><div className="query-result-find-region"><div className="query-result-find-toolbar"/>{showFindStatus&&<div className="query-result-find-status"/>}<div className="query-result-find-grid"><div className="results-grid"/></div></div></div>}</div></div>}</div>{showExtra && <div className="extra"/>}</div>; }
beforeAll(async () => { doc = memoryDocument();
  Object.defineProperty(MemoryNode.prototype, 'children', { configurable: true, get() { return this.childNodes.filter((node: MemoryNode) => node.nodeType === 1); } });
  Object.defineProperty(MemoryNode.prototype, 'classList', { configurable: true, get() { return { contains: (value: string) => (this.getAttribute('class') ?? '').split(' ').includes(value) }; } });
  Object.defineProperty(MemoryNode.prototype, 'getBoundingClientRect', { configurable: true, value(this: MemoryNode) { const name = this.getAttribute('class'); return { height: name === 'root' ? height : name === 'toolbar' ? toolbar : name === 'query-layout-bar' ? 18 : name === 'extra' ? 30 : name==='query-result-copy-actions'?34:name==='query-result-find-toolbar'?resultToolbar:name==='query-result-find-status'?44:0 }; } });
  Object.defineProperty(MemoryNode.prototype,'offsetHeight',{configurable:true,get(this:MemoryNode){return this.getAttribute('class')==='results-grid'?gridOuter:0;}});
  Object.defineProperty(MemoryNode.prototype,'clientHeight',{configurable:true,get(this:MemoryNode){return this.getAttribute('class')==='results-grid'?gridClient:0;}});
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { height = 600; toolbar = 100; preferred = 500; showExtra = false;showResultBars=false;showFindStatus=false;resultToolbar=34;showDirectGrid=false;gridOuter=96;gridClient=96; callbacks = []; observed = new Set(); removed = []; disconnect = vi.fn(() => observed.clear());
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { constructor(callback: () => void) { callbacks.push(callback); } observe(node: Element) { observed.add(node); } unobserve(node: Element) { observed.delete(node); removed.push(node); } disconnect = disconnect; } });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; expect(observed.size).toBe(0); });
afterAll(() => { for (const [name, descriptor] of properties) if (descriptor) Object.defineProperty(MemoryNode.prototype, name, descriptor); else Reflect.deleteProperty(MemoryNode.prototype, name); for (const [name, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function render() { await act(async () => root!.render(<Example/>)); }
async function mount() { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as any); await render(); }
it('按当前容器和工具条测量，变矮再恢复只改变显示不改500偏好', async () => {
  await mount(); expect(result).toBe(386); expect(preferred).toBe(500);
  height = 170; await act(async () => callbacks[0]()); expect(result).toBe(0); expect(preferred).toBe(500);
  height = 900; await act(async () => callbacks[0]()); expect(result).toBe(686); expect(queryEditorVisualHeight(preferred, result)).toBe(500);
});
it('新工具条占用立即重测，移除后取消观察旧节点；卸载断开', async () => {
  await mount(); showExtra = true; await render(); expect(result).toBe(356);
  showExtra = false; await render(); expect(result).toBe(386); expect(removed).toHaveLength(1);
  await act(async () => root!.unmount()); root = undefined; expect(disconnect).toHaveBeenCalledOnce();
});
it('96像素结果内容之外另扣复制及查找工具条，不让内部网格只剩28像素',async()=>{
  showResultBars=true;await mount();expect(result).toBe(318);expect(preferred).toBe(500);
  const parent=doc.querySelector('[class="root"]')!;expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('164px');
  expect(observed.has(doc.querySelector('[class="query-result-copy-actions"]')! as unknown as Element)).toBe(true);expect(observed.has(doc.querySelector('[class="query-result-find-toolbar"]')! as unknown as Element)).toBe(true);
  height=170;await act(async()=>callbacks[0]());expect(result).toBe(0);expect(preferred).toBe(500);expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('164px');
});
it('查找状态和内部工具条换行会重新保留空间，移除旧条后恢复且不保存偏好',async()=>{
  showResultBars=true;await mount();showFindStatus=true;await render();expect(result).toBe(274);
  const status=doc.querySelector('[class="query-result-find-status"]')! as unknown as Element;expect(observed.has(status)).toBe(true);
  resultToolbar=68;await act(async()=>callbacks[0]());expect(result).toBe(240);expect(preferred).toBe(500);
  showFindStatus=false;await render();expect(result).toBe(284);expect(removed).toContain(status);
  showResultBars=false;await render();expect(result).toBe(386);expect(preferred).toBe(500);
  expect((doc.querySelector('[class="root"]')!.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('96px');
});
it('原97外高89客户区的滚动条占用另行计费，并随真实网格尺寸变化取消预留',async()=>{
  showResultBars=true;gridOuter=97;gridClient=89;await mount();expect(result).toBe(310);expect(preferred).toBe(500);
  const grid=doc.querySelector('[class="results-grid"]')! as unknown as Element,parent=doc.querySelector('[class="root"]')!;
  expect(observed.has(grid)).toBe(true);expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('172px');
  gridClient=97;await act(async()=>callbacks[0]());expect(result).toBe(318);expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('164px');
  showResultBars=false;await render();expect(removed).toContain(grid);expect(result).toBe(386);
});
it('筛选草稿打开时没有复制查找容器，直接结果网格仍预留滚动条，极短窗口保持内容空间',async()=>{
  showDirectGrid=true;gridOuter=97;gridClient=89;await mount();expect(result).toBe(378);
  const parent=doc.querySelector('[class="root"]')!,grid=doc.querySelector('[class="results-grid"]')! as unknown as Element;
  expect(observed.has(grid)).toBe(true);expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('104px');
  height=100;await act(async()=>callbacks[0]());expect(result).toBe(0);expect(preferred).toBe(500);expect((parent.style as unknown as Record<string,string>)['--query-result-min-height']).toBe('104px');
});
