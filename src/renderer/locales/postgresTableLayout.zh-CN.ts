/** PostgreSQL 的显示布局独立于记录与筛选方案。 */
export const postgresTableLayoutZh = {
  entry: '列布局', title: 'PostgreSQL 表格列布局', reload: '重新读取已保存布局',
  hint: '可隐藏、重排、冻结和调整宽度。显示调整即时生效，点击保存后在本机按连接和关系恢复。筛选、排序、记录草稿和导出字段继续按表页原设置处理。',
  stale: '原 PostgreSQL 表页或连接已变化，请刷新表页后重试。',
  source: '连接配置已改变，当前显示默认布局。可检查后保存新的列布局。',
  reset: '恢复全部列、原顺序、默认列宽和行高，并清除已保存的冻结设置？',
  discard: '放弃本标签尚未保存的列布局，重新读取已保存的设置？',
} as const;
