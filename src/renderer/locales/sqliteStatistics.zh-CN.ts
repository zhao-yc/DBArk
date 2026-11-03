export const sqliteStatisticsZh = {
  entry: '字段概况', title: 'SQLite 全筛选字段概况', column: '统计字段', read: '开始统计', stop: '取消统计', close: '关闭',
  readRowCount: '只统计匹配行数', rowCountResult: (rows: string) => `匹配总行数：${rows}`,
  countEntry: '统计匹配行数', countTitle: 'SQLite 统计匹配行数', recentCount: (rows: string) => `最近统计 ${rows} 行`,
  hint: '统计已应用筛选的全部数据库记录，使用独立只读快照。当前页、未应用条件、未提交草稿和查询事务不参与统计。',
  types: 'SQLite 声明类型不决定实际存储类型。不同值数和极值按存储类型分别计算，保留该字段的排序规则；INTEGER 与 REAL 不合并。不会将 TEXT 隐式转为数值，暂不提供求和、平均值或数值直方图。',
  stale: '原表页、筛选或连接配置已变化，请关闭后重新打开统计窗口。', loading: '正在统计全部匹配行…', stopping: '正在等待原统计和取消完成…', empty: '没有匹配记录。',
  rows: '匹配记录', nonNull: '非空记录', nulls: 'NULL 记录', declared: '声明类型', dynamic: '未声明', kind: '实际存储类型', count: '记录数', distinct: '类型内不同值数', min: '最小值', max: '最大值',
  unavailable: '原统计结果或任务已失效。',
} as const;
