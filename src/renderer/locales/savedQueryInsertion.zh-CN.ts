export const savedQueryInsertionZh = {
  insert: '插入当前查询选区',
  hint: '按所见摘要重新读取完整的已保存 SQL，插入打开面板时的原查询选区；不执行 SQL，保留目标查询的连接、默认库和来源绑定。来源连接已删除也可插入；卡片的连接选择仅用于打开新标签。',
  target: (title: string) => `插入目标：${title}`,
  unavailable: '打开面板时没有可编辑的活动查询，不能插入；仍可打开到新标签。',
  changed: '原查询选区、插入目标或所见查询列表已变化，本次插入已失效；请重新选择，目标查询变化时需关闭面板后重新打开。',
  pending: '搜索条件尚未应用，请先重新搜索后再插入完整 SQL。',
  cleanupFailed: '查询库读取或释放尚未完成，未插入 SQL：',
} as const;
