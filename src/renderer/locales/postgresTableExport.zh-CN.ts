export const postgresTableExportZh = {
  open: '导出数据', title: '导出 PostgreSQL 表数据', source: '数据范围',
  all: '全部记录', filtered: '当前筛选的全部匹配记录',
  note: '沿用表页已应用的筛选和排序。导出读取数据库当前快照，可选择输出列。',
  sqlHint: '生成 UTF-8 INSERT 数据脚本。回放请使用空闲连接和结构兼容的同名表，生成列由目标库重新计算。',
  copyFormat: 'COPY CSV（PostgreSQL 原生）',
  copyHint: '直接保存 PostgreSQL 生成的 UTF-8 CSV，含列名。NULL 为空字段，空字符串带引号。',
  generated: '由目标库生成',
  format: '文件格式', encoding: '文件编码', columns: '输出列', choose: '选择保存位置',
  allColumns: '全选', noColumns: '清空', file: '目标文件', start: '开始导出', cancel: '取消导出', close: '关闭',
  progress: '正在读取并保存 PostgreSQL 数据', cancelling: '正在等待原导出任务结束',
  cancelled: '导出未完成，请核对所选文件。', stale: '原表页已变化，请刷新后重新发起导出。',
  saved: (rows: number) => '已保存 ' + rows + ' 行。',
} as const;
