/** 当前网格行号从 1 开始，与服务器分页页码分开。 */
export const gridRowJumpZh = {
  open: '跳到行',
  shortcut: '跳到行（Ctrl+G）',
  row: '当前网格行号',
  go: '定位',
  close: '取消跳转',
  range: (count: number) => `范围 1–${count}`,
};
