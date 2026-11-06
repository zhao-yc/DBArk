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

export const mysqlDataSyncZh = {
  scope: '同步只修改所选右侧行，使用本次比较时的左侧原值。显式插入标识值可能推进右侧自增计数。',
  unavailable: '同步需要完整比较，并且右侧连接必须能够核实目标表和触发器目录。',
  stale: 'MySQL／MariaDB 差异或同步预览已失效，请重新比较',
} as const;
