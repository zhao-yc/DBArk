/** 会话视图专属文案，不扩展共享locale入口或服务端执行范围。 */
export const serverMonitorSessionsZh = {
  search: '筛选当前会话快照', placeholder: '用户、来源、库、状态或 SQL 摘要', clear: '清空筛选',
  sortBy: '会话本地排序', byId: '按会话 ID', bySeconds: '按持续秒数', ascending: '升序', descending: '降序', toAscending: '切换为升序', toDescending: '切换为降序',
  scope: '仅筛选本次已返回的有限会话快照；账号可见范围和完整性未确认。',
  sqlScope: 'SQL 搜索仅匹配已返回的摘要；摘要可能截断，不代表检索完整 SQL。',
  noMatches: '本次有限快照没有匹配项，不代表服务器没有其它会话。',
  counts: (filtered: number, returned: number) => `筛选后 ${filtered} / 本次返回 ${returned} 条`,
} as const;
