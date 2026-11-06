import { postgresDataCompareZh, tableDataCompareRequestSchema } from './postgresDataCompare';

export const mysqlDataCompareSchema = tableDataCompareRequestSchema.refine(({ source, target }) =>
  source.connectionId !== target.connectionId || source.database !== target.database || source.table !== target.table,
'请选择不同的 MySQL／MariaDB 比较目标');

export const mysqlDataCompareZh = {
  ...postgresDataCompareZh,
  title: '比较 MySQL／MariaDB 表数据',
  intro: '按同名主键比较 InnoDB 表。每侧最多 10,000 行及 8 MiB，可用同一文本筛选缩小范围。',
  shared: '两张表使用同一个 InnoDB 只读快照。',
  running: '正在读取 MySQL／MariaDB 表快照',
  cancelled: 'MySQL／MariaDB 数据比较已取消',
  timeout: 'MySQL／MariaDB 数据比较超时，请缩小筛选范围',
} as const;
