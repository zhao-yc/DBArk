export const tabOrderZh = {
  strip: '工作台标签',
  hint: '拖动标签到另一标签的左半或右半可调整前后顺序；焦点在标签名称时，Ctrl / ⌘ + Shift + 左右键逐位移动，Home / End 移到首末。仅调整顺序，保留当前活动标签。',
  shortcut: 'Ctrl / ⌘ + Shift + ← / → / Home / End 调整标签顺序',
  moving: (name: string) => `正在移动标签：${name}；Escape 可取消。`,
  placed: (name: string) => `已调整标签顺序：${name}。`,
  boundary: '标签已在目标位置，顺序未改变。',
  cancelled: '已取消本次标签拖动，顺序未改变。',
  unavailable: '工作台标签身份或数量异常，当前仅展示完整标签列表；重排、激活和关闭已暂停，请重新载入工作区。',
} as const;
