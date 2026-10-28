export const queryCloseZh = {
  menu: (title: string) => '查询标签操作：' + title, menuButton: (title: string) => '打开查询标签操作：' + title,
  left: '关闭左侧查询', right: '关闭右侧查询', menuCancel: '关闭标签操作菜单',
  sideHint: '只关闭锚点左侧或右侧的查询，保留所有表标签；逐项确认，取消或失败即停止。',
  menuChanged: '标签顺序、来源或连接已变化，请重新打开操作菜单。',
  others: '关闭其他查询', othersHint: '逐个确认关闭其他查询，保留当前查询和所有表标签；取消或失败即停止。',
  title: '关闭查询', hint: '关闭前可以保存当前 SQL，或明确放弃这个标签的草稿。',
  save: '保存后关闭', discard: '直接关闭', cancel: '取消',
  changed: '查询状态或草稿已变化，标签继续保留；不会自动关闭或重复保存。',
  unavailable: '编辑器尚未就绪，标签继续保留。',
  retained: '点击时的查询已保存；当前草稿或状态已变化，标签继续保留。',
};
