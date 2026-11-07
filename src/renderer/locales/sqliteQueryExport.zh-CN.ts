import { postgresQueryExportZh } from './postgresQueryExport.zh-CN';

export const sqliteQueryExportZh = {
  ...postgresQueryExportZh,
  title: 'SQLite 完整查询导出',
  scope: '将在独立的只读连接执行一条 SELECT 或 WITH 查询，读取已提交的数据。原查询窗口的临时表与未提交变更无法在此使用。',
  formatHint: 'JSON 将数值写为字符串以保留精度，列名必须唯一。CSV 可保留重名列，Excel 会按列位置追加后缀。',
  parameterHint: '在查询中用 :name 表示一个值参数，重复名称共用一个值。',
  suggestedName: 'SQLite查询结果',
} as const;
