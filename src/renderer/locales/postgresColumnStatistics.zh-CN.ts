export const postgresColumnStatisticsZh = {
  title: '字段概况',
  hint: '统计当前筛选匹配的全部已提交记录。当前页行数和未提交的草稿不影响统计。',
  field: '概况字段', read: '开始统计', loading: '正在统计字段…', close: '关闭',
  readHistogram: '读取数值分布',
  expired: '原表页或连接已变化，请重新打开字段概况。',
  metric: '统计项', value: '统计值', type: '字段类型',
  rows: '总记录数', nonNull: '非 NULL 数量', nulls: 'NULL 数量', empty: '空字符串数量',
  distinct: '不同值数量', unique: '仅出现一次的值', repeated: '重复出现的不同值',
  min: '最小值', max: '最大值', zero: '零值数量', nonFinite: 'NaN 与无穷值数量',
  sum: '有限值总和', average: '有限值平均值', deviation: '有限值总体标准差',
  countsOnly: '此字段类型提供总数与 NULL 统计。',
  clipped: '已截断预览',
} as const;
