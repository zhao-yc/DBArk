export const postgresTableExportZh = {
  open: '导出数据', title: '导出 PostgreSQL 表数据', source: '数据范围',
  all: '全部记录', filtered: '当前筛选的全部匹配记录',
  note: '沿用表页已应用的筛选和排序。导出读取数据库当前快照，可选择输出列。',
  format: '文件格式', encoding: '文件编码', columns: '输出列', choose: '选择保存位置',
  allColumns: '全选', noColumns: '清空', file: '目标文件', start: '开始导出', cancel: '取消导出', close: '关闭',
  progress: '正在读取并保存 PostgreSQL 数据', cancelling: '正在等待原导出任务结束',
  cancelled: '导出未完成，请核对所选文件。', stale: '原表页已变化，请刷新后重新发起导出。',
  saved: (rows: number) => '已保存 ' + rows + ' 行。',
} as const;
