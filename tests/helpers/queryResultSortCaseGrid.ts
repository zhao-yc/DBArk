export interface QueryResultSortCaseGridReading {
  ids: string[];
  dataRows: number;
  viewportHeight: number;
  contentHeight: number;
  pages: { top: number; indices: number[] }[];
}

/** 序列化到原页面：只沿真实网格滚动读取完全可见的ID单元格，不改尺寸、样式、模型或选择。 */
export async function readQueryResultSortCaseGrid(grid: HTMLElement): Promise<QueryResultSortCaseGridReading> {
  // 失败只记录几何及行下标，不记录单元格正文、SQL或认证；原八页和完全可见判据保持。
  const diagnostics: { phase: string; pages: { step: number; top: number; bottom: number; headerBottom: number; indices: number[] }[]; rejectedCells: { index: number; top: number; bottom: number; height: number; headerBottom: number; viewportBottom: number; horizontal: boolean }[] } = { phase: 'identity', pages: [], rejectedCells: [] };
  const reject = (): never => { throw Error('排序窗口网格身份、几何或完整行序读取失败：' + JSON.stringify(diagnostics)); };
  const view = grid.ownerDocument.defaultView;
  if (!grid.isConnected || !view || typeof view.requestAnimationFrame !== 'function') reject();
  /** 等待原浏览器滚动和虚拟行提交；不通过睡眠或读取React内部状态猜测结果。 */
  const frames = async (): Promise<void> => {
    await new Promise<void>(resolve => view!.requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => view!.requestAnimationFrame(() => resolve()));
  };
  // 前一个正式控件刚关闭时先让原布局提交；基线建立后不再接纳几何或行数变化。
  await frames();
  const countText = grid.getAttribute('aria-rowcount');
  if (!countText || !/^[1-8]$/.test(countText)) reject();
  const count = Number(countText) - 1, height = grid.clientHeight, content = grid.scrollHeight, width = grid.clientWidth;
  diagnostics.phase = 'minimum-geometry';
  if (![height, content, width].every(Number.isFinite) || height < 96 || width <= 0 || content < 40 + count * 32) reject();
  const initialBounds = grid.getBoundingClientRect(), outerHeight = grid.offsetHeight;
  const initialStyle = view!.getComputedStyle(grid);
  const borderTop = Number.parseFloat(initialStyle.borderTopWidth), borderBottom = Number.parseFloat(initialStyle.borderBottomWidth);
  if (![initialBounds.height, initialBounds.width, outerHeight, borderTop, borderBottom].every(Number.isFinite) || initialBounds.height <= 0 || initialBounds.width <= 0 || borderTop < 0 || borderBottom < 0) reject();
  // clientHeight取整会漏掉缩放后的末行。无上下边框及占位横滚动条时，真实矩形底边就是裁切底边；其余情况保留原保守客户区。
  const exactBottom = borderTop === 0 && borderBottom === 0 && outerHeight === height;
  /** 一次矩阵读取期间原网格及行数保持；漂移不拼接成貌似完整的成功矩阵。 */
  const current = (): void => {
    diagnostics.phase = 'stable-geometry';
    if (!grid.isConnected || grid.getAttribute('aria-rowcount') !== countText || grid.clientHeight !== height || grid.scrollHeight !== content || grid.clientWidth !== width) reject();
    const bounds = grid.getBoundingClientRect(), style = view!.getComputedStyle(grid);
    if (bounds.height !== initialBounds.height || bounds.width !== initialBounds.width || grid.offsetHeight !== outerHeight || Number.parseFloat(style.borderTopWidth) !== borderTop || Number.parseFloat(style.borderBottomWidth) !== borderBottom) reject();
  };
  const seen = new Map<number, string>(), pages: QueryResultSortCaseGridReading['pages'] = [];
  grid.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  for (let step = 0; step < 8; step++) {
    await frames(); current();
    diagnostics.phase = 'header';
    const bounds = grid.getBoundingClientRect(), bottom = exactBottom ? bounds.bottom : bounds.top + grid.clientTop + height;
    const headers = Array.from(grid.querySelectorAll<HTMLElement>('[role="columnheader"]'));
    if (!headers.length) reject();
    const headerBottom = Math.max(...headers.map(header => header.getBoundingClientRect().bottom));
    if (!Number.isFinite(headerBottom) || headerBottom < bounds.top || headerBottom + 32 > bottom) reject();
    const indices: number[] = [], onPage = new Set<number>();
    diagnostics.phase = 'rows';
    for (const row of grid.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')) {
      const raw = row.getAttribute('aria-rowindex');
      if (raw === '1') continue;
      if (!raw || !/^[2-8]$/.test(raw)) reject();
      const index = Number(raw) - 2;
      if (index >= count || onPage.has(index)) reject();
      onPage.add(index);
      const cell = row.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]');
      if (!cell) reject();
      const box = cell!.getBoundingClientRect();
      if (box.top < headerBottom || box.bottom > bottom || box.height !== 32 || box.left < bounds.left + grid.clientLeft || box.right > bounds.left + grid.clientLeft + width) {
        if (diagnostics.rejectedCells.length < 12) diagnostics.rejectedCells.push({ index, top: box.top, bottom: box.bottom, height: box.height, headerBottom, viewportBottom: bottom, horizontal: box.left < bounds.left + grid.clientLeft || box.right > bounds.left + grid.clientLeft + width });
        continue;
      }
      const id = cell!.textContent;
      if (!id || !/^[1-7]$/.test(id) || seen.has(index) && seen.get(index) !== id) reject();
      seen.set(index, id!); indices.push(index);
    }
    pages.push({ top: grid.scrollTop, indices });
    diagnostics.pages.push({ step, top: grid.scrollTop, bottom, headerBottom, indices });
    if (seen.size === count) break;
    // 按完整行高推进，避免短视口的半行在相邻两页都被裁掉。
    const next = Math.min(content - height, grid.scrollTop + Math.floor((bottom - headerBottom) / 32) * 32);
    diagnostics.phase = 'page-bound';
    if (step === 7) reject();
    diagnostics.phase = 'scroll-progress';
    if (!Number.isFinite(next) || next <= grid.scrollTop) reject();
    grid.scrollTo({ top: next, left: 0, behavior: 'instant' });
  }
  diagnostics.phase = 'complete-order';
  if (seen.size !== count) reject();
  const ids = Array.from({ length: count }, (_, index) => seen.get(index)!);
  if (new Set(ids).size !== count) reject();
  // 成功后回到首行，后续控件和选择继续走正常页面；失败不追加滚动或收尾。
  grid.scrollTo({ top: 0, left: 0, behavior: 'instant' }); await frames(); current();
  return { ids, dataRows: count, viewportHeight: height, contentHeight: content, pages };
}
