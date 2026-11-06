import { mysqlSqlFileTitle } from '../../shared/mysqlSqlFile';

export const mysqlSqlFileZh = {
  title: mysqlSqlFileTitle,
  connection: '执行连接',
  database: '初始数据库',
  noDatabase: '由脚本指定数据库',
  catalogue: '正在读取数据库列表',
  encoding: '文件编码',
  choose: '选择 SQL 文件',
  trust: '我确认脚本来源可信，并已核对其中的库名和操作',
  scope: '适用于整库 SQL 转储和迁移脚本。脚本以所选连接的权限执行，可以创建数据库或通过 USE 切换数据库。',
  transaction: 'DDL 或已提交的操作可能在失败或取消后保留。执行中断后请先核对目标库。',
  run: '执行文件',
  running: '正在流式执行 SQL 文件',
  cancel: '取消执行',
  cancelling: '已请求取消，正在等待原任务结束',
  close: '关闭',
} as const;
