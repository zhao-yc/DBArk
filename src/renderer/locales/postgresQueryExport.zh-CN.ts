export const postgresQueryExportZh = {
  open: '执行并导出完整结果',
  title: 'PostgreSQL 完整查询导出',
  source: '本次导出的 SQL',
  sourcePrefix: '显示 SQL 前 4000 个 UTF-16 单元',
  scope: '将在独立的只读会话执行一条无位置参数的 SELECT 或 WITH 查询。读取当前数据库的已提交数据，连接内的临时表和会话设置不随查询转移。',
  start: '执行查询并保存',
  changed: '原查询或连接已变化，请重新打开导出。',
  running: '正在执行并读取完整结果',
  cancelling: '正在取消导出',
  suggestedName: 'PostgreSQL查询结果',
  done: (rows: number) => `完整结果已保存，共 ${rows} 行。`,
  singleSource: '请输入查询或选择一段非空 SQL，导出只接受单一选区。',
} as const;
