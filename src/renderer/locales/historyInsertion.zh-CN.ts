export const historyInsertionZh = {
  insert: '插入当前查询选区',
  hint: '插入完整 SQL 到打开面板时的原查询选区，不自动执行；卡片连接仅用于打开新标签。',
  target: (title: string) => `插入目标：${title}`,
  unavailable: '打开历史面板时没有可编辑的活动查询，不能插入；仍可打开到新标签。',
  changed: '原查询、选区或编辑器已变化，本次插入已失效；请关闭历史面板后重新打开。',
  tooLarge: '插入后查询正文超过 20000000 个 UTF16 单元，未修改原查询。',
  failed: '编辑器未接受本次插入，请核对原查询；不会自动重试。',
} as const;
