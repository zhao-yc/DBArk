export const gridRowHeights = [24, 32, 56] as const;
export type GridRowHeight = typeof gridRowHeights[number];
export const defaultGridRowHeight = 32;

/** 仅接受原始数字预设，旧布局没有行高时继续使用标准高度。 */
export function isGridRowHeight(value: unknown): value is GridRowHeight {
  return value === 24 || value === 32 || value === 56;
}

/** 虚拟网格和样式共用同一个高度来源。 */
export function readGridRowHeight(value: unknown): GridRowHeight {
  return isGridRowHeight(value) ? value : defaultGridRowHeight;
}
