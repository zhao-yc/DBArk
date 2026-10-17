/** 查询复制只新建独立草稿，不经过系统剪贴板或保存查询来源。 */
export const queryDuplicateZh = {
  action: '复制为新查询', hint: '复制当前 SQL 和明确数据库上下文，另建未保存的独立查询', suffix: '（副本）',
  unavailable: '当前查询不可复制，请等待编辑器就绪并确认连接仍有效。',
  changed: '原查询、连接或编辑器已变化，本次未新建查询，请重新复制。',
  contextUnknown: '当前默认库尚未明确，请先确认数据库上下文再复制查询。',
  tooLarge: '当前 SQL 超过查询草稿大小限制，未新建查询。',
  tooMany: '查询标签数量已达上限，请先关闭不需要的标签。',
} as const;
