export const tableFilteredSelectZh = {
  entry: '从当前筛选生成 SELECT', title: '当前筛选 SELECT 草稿', preview: '当前筛选 SELECT 预览',
  hint: '仅在本地生成已应用筛选和排序的 SELECT 草稿。筛选面板尚未添加的条件、表格待提交修改和当前页行值不会写入 SQL。',
  scope: (limit: number) => `从完整匹配范围的第一页开始，LIMIT ${limit}；不携带当前页 OFFSET。生成、预览和打开新查询均不会执行 SQL。`,
  independent: '新查询使用同一连接和明确数据库，首次执行时建立独立会话；不继承表页数据草稿、事务或保存来源。',
  conditions: '已应用筛选', noConditions: '未设置筛选，匹配整个表或视图。', sorts: '已应用排序', noSorts: '未指定显式排序；可靠定位键的稳定补序由原表页规则决定。',
  disabledRule: '（已停用）', columns: 'SELECT 字段', filterColumns: '搜索 SELECT 字段',
  changed: '原表页、结构、筛选、排序或结果上限已变化，请关闭后重新生成。',
  invalid: '未能确认当前已载入页及完整已应用条件，未生成 SELECT。',
  tabs: '查询标签已达100个，请先关闭部分标签。',
  queryTitle: (table: string) => `${table} · 筛选 SELECT`,
} as const;
