export const openTabSearchZh = {
  entry: '查找已打开标签', title: '查找已打开标签', shortcutHint: 'Ctrl / ⌘ Shift A',
  searchLabel: '搜索已打开标签', placeholder: '输入标题、连接、数据库、表名或类型；空格分隔的条件同时匹配',
  empty: '尚未打开标签。', noMatches: '没有匹配的已打开标签。', close: '取消',
  query: '查询', table: '表', current: '当前标签', unsaved: '有未提交或未保存内容',
  noConnection: '连接不可用', noDatabase: '无默认数据库', unknownDatabase: '数据库上下文未知',
  stale: '原标签已关闭或目标已变化，请重新选择当前列表中的标签。',
  count: (matched: number, total: number) => `匹配 ${matched} / ${total} 个已打开标签`,
  help: '↑ / ↓ 移动，Home / End 到首尾，Enter 切换，Esc 取消。只搜索标签信息，不读取 SQL。',
} as const;
