import type { QueryLayoutLease } from './components/QueryLayoutSplitter';

/** UI租约只比较布局身份与原偏好，不复制正文、标题或查询来源。 */
export interface QueryLayoutSnapshot<T> { state: T; key: string; value: number; available: boolean; }
interface Port<T> {
  read(): QueryLayoutSnapshot<T>;
  subscribe(changed: () => void): () => void;
  write(current: T, value: number): boolean;
}
/** 工作台订阅同步撤销A→B→A；提交给write的是结束时的最新状态，不是开始时的tabs。 */
export function beginQueryLayoutLease<T>(port: Port<T>, limits: { min: number; max: number }, cancel: () => void): QueryLayoutLease | null {
  const original = port.read(); if (!original.available) return null;
  let active = true, unsubscribe: (() => void) | undefined;
  /** 先永久停用再退订，取消回调重入也不能重新保存。 */
  function dispose() { if (!active) return; active = false; unsubscribe?.(); }
  /** 同步读取当前身份；观察到一次漂移便撤销，恢复原值不能复活。 */
  function current(): boolean {
    if (!active) return false;
    const next = port.read();
    if (next.available && next.key === original.key && next.value === original.value) return true;
    dispose(); cancel(); return false;
  }
  const lease: QueryLayoutLease = { value: original.value, current, dispose,
    commit(value) {
      if (!Number.isInteger(value) || value < limits.min || value > limits.max || !current()) return false;
      const latest = port.read(); dispose();
      if (value === latest.value) return true;
      return port.write(latest.state, value);
    },
  };
  unsubscribe = port.subscribe(current);
  // 防止订阅建立期间发生同步变化后遗留监听；实际Zustand订阅不立即写入状态。
  if (!active) { unsubscribe(); return null; }
  if (!current()) return null;
  return lease;
}
