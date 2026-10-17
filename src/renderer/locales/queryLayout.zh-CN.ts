export const queryLayoutZh = {
  separator: '调整 SQL 编辑区和结果区高度',
  hint: '拖动分隔条；方向键每次调整 10 像素，Shift 调整 50 像素，Home 恢复默认高度，Escape 取消拖动。',
  restore: '恢复默认高度',
  height: (value: number) => `SQL 编辑区 ${value} 像素`,
  limited: (value: number, preferred: number) => `SQL 编辑区 ${value} 像素，已按窗口压缩；保存的高度为 ${preferred} 像素`,
} as const;
