import { expect, type Locator, type Page } from '@playwright/test';

/** 通过真实横向滚轮到达位置，等待实际滚动完成；不关闭虚拟化、不改DOM或投递业务请求。 */
async function scroll(page: Page, grid: Locator, target: number, check: () => void): Promise<void> {
  check(); await grid.hover(); check();
  const current = await grid.evaluate(node => node.scrollLeft); check();
  if (Math.abs(current - target) > 0.5) { await page.mouse.wheel(target - current, 0); check(); }
  await expect.poll(async () => { check(); const left = await grid.evaluate(node => node.scrollLeft); check(); return left; }).toBeCloseTo(target, 0);
  check();
}

/** 可写SQLite网格数据列为180px；先滚入真实视区，再由调用方核准确列头及aria位置。 */
export async function revealSqliteEditColumn(page: Page, grid: Locator, index: number, check: () => void): Promise<void> {
  if (!Number.isInteger(index) || index < 0 || index >= 1024) throw Error('SQLite网格列位置无效');
  check(); const maximum = await grid.evaluate(node => node.scrollWidth - node.clientWidth); check();
  await scroll(page, grid, Math.min(index * 180, maximum), check);
}

/** 逐段观察真实可见列头，按aria列号合并；不能把某一视区缺列当作列不存在。 */
export async function readSqliteGridHeaders(page: Page, grid: Locator, check: () => void): Promise<{ index: number; label: string }[]> {
  check(); const geometry = await grid.evaluate(node => ({ maximum: node.scrollWidth - node.clientWidth, step: Math.max(1, Math.floor(node.clientWidth / 2)) })); check();
  if (geometry.maximum < 0 || Math.ceil(geometry.maximum / geometry.step) > 32) throw Error('SQLite合成网格横向观察超出本例预算');
  const headers = new Map<number, string>();
  for (let target = 0;; target = Math.min(geometry.maximum, target + geometry.step)) {
    await scroll(page, grid, target, check);
    const visible = await grid.getByRole('columnheader').evaluateAll(nodes => nodes.map(node => ({ index: Number(node.getAttribute('aria-colindex')), label: node.textContent ?? '' }))); check();
    for (const header of visible) { if (!Number.isInteger(header.index) || header.index <= 0) throw Error('SQLite真实列头缺少准确aria位置'); const previous = headers.get(header.index); if (previous !== undefined) expect(header.label).toBe(previous); headers.set(header.index, header.label); }
    if (target === geometry.maximum) break;
  }
  return [...headers].sort((left, right) => left[0] - right[0]).map(([index, label]) => ({ index, label }));
}

/** 真实滚轮遍历本页虚拟行，按aria位置读完整列；不把当前视口当全页或从IPC补造显示值。 */
export async function readSqliteGridColumn(page: Page, grid: Locator, column: number, check: () => void): Promise<string[]> {
  if (!Number.isSafeInteger(column) || column < 1 || column > 1024) throw Error('SQLite合成网格列位置无效');
  check();
  const geometry = await grid.evaluate(node => ({ top: node.scrollTop, maximum: node.scrollHeight - node.clientHeight, step: Math.max(1, Math.floor(node.clientHeight / 2)), count: Number(node.getAttribute('aria-rowcount')) })); check();
  if (!Number.isSafeInteger(geometry.count) || geometry.count < 1 || geometry.count > 10001 || geometry.maximum < 0 || Math.ceil(geometry.maximum / geometry.step) > 32) throw Error('SQLite合成网格逐行观察超出本例预算');
  const values = new Map<number, string>();
  /** 只采集本轮真实渲染的准确列；交叠行原值变化即失败，不拼接两次不同结果。 */
  const collect = async () => {
    check();
    const rows = await grid.locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${column}"]`).evaluateAll(nodes => nodes.map(node => ({ index: Number(node.closest('[role="row"]')?.getAttribute('aria-rowindex')), value: node.textContent ?? '' }))); check();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.index) || row.index < 2 || row.index > geometry.count) throw Error('SQLite虚拟行缺少准确aria位置');
      if (values.has(row.index)) expect(row.value).toBe(values.get(row.index)); values.set(row.index, row.value);
    }
  };
  /** 原滚轮滚动当前网格，不设置scrollTop、修改产品DOM或向业务入口投递请求。 */
  const scroll = async (target: number) => {
    check(); await grid.hover(); check(); const top = await grid.evaluate(node => node.scrollTop); check();
    if (Math.abs(top - target) > 0.5) { await page.mouse.wheel(0, target - top); check(); }
    await expect.poll(async () => { check(); const top = await grid.evaluate(node => node.scrollTop); check(); return top; }).toBeCloseTo(target, 0); check();
  };
  await collect();
  if (values.size < geometry.count - 1) {
    for (let target = 0;; target = Math.min(geometry.maximum, target + geometry.step)) {
      await scroll(target); await collect();
      if (values.size === geometry.count - 1 || target === geometry.maximum) break;
    }
    expect(values.size, '滚动后仍须核全页原值，不能缩减预期行集合').toBe(geometry.count - 1);
    await scroll(geometry.top);
  }
  expect(await grid.getAttribute('aria-rowcount')).toBe(String(geometry.count)); check();
  return Array.from({ length: geometry.count - 1 }, (_, index) => {
    const value = values.get(index + 2); if (value === undefined) throw Error('SQLite虚拟行观察存在位置缺口'); return value;
  });
}
