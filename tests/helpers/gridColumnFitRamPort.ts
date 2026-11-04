import { vi } from 'vitest';
import type { MemoryDocument } from '../fixtures/memory-dom';

/** 只合成字体与canvas文本测量端口；列范围、抽样及草稿更新仍执行产品代码。 */
export function installGridColumnFitRamPort(document: MemoryDocument) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ fontFamily: '内存字体' }) });
  const measure = vi.fn((value: string) => ({ width: value.length * 8 }));
  const create = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation(name => {
    const node = create(name);
    if (name === 'canvas') Object.assign(node, { getContext: () => ({ font: '', measureText: measure }) });
    return node;
  });
  return { measure, restore() {
    spy.mockRestore();
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous);
    else Reflect.deleteProperty(globalThis, 'getComputedStyle');
  } };
}
