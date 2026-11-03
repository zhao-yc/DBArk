export const queryLayoutZh = {
  separator: '调整 SQL 编辑区和结果区高度',
  hint: '拖动分隔条；方向键每次调整 10 像素，Shift 调整 50 像素，Home 恢复默认高度，Escape 取消拖动。',
  restore: '恢复默认高度',
  widthSeparator: '调整 SQL 编辑区和结果区宽度',
  widthHint: '左右拖动分隔条；左右方向键每次调整 10 像素，Shift 调整 50 像素，Home 恢复默认宽度，Escape 取消拖动。',
  widthRestore: '恢复默认宽度',
  width: (value: number) => `SQL 编辑区宽度 ${value} 像素`,
  widthLimited: (value: number, preferred: number) => `SQL 编辑区宽度 ${value} 像素，保存的宽度为 ${preferred} 像素`,
  placement: '查询结果布局', below: '结果在下方', beside: '结果在右侧', results: '仅显示结果',
  besideNarrow: '当前宽度不足，结果暂时显示在下方；空间足够后恢复到右侧。',
  height: (value: number) => `SQL 编辑区 ${value} 像素`,
  limited: (value: number, preferred: number) => `SQL 编辑区 ${value} 像素，已按窗口压缩；保存的高度为 ${preferred} 像素`,
} as const;
