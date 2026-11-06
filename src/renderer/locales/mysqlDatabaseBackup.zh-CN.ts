import { mysqlDatabaseBackupTitle, mysqlDumpToolTitle } from '../../shared/mysqlDatabaseBackup';

export const mysqlDatabaseBackupZh = {
  title: mysqlDatabaseBackupTitle,
  tool: mysqlDumpToolTitle,
  connection: '来源连接',
  database: '备份数据库',
  scope: '通过直连或 SSH 从 MySQL 或 MariaDB 导出带建库语句的 UTF-8 SQL。请选择与服务器系列和主版本匹配的官方客户端工具。',
  snapshot: 'InnoDB 数据来自一致性快照。备份期间请避免建表、改表、删除或修改例程等结构操作。',
  confirm: '我已核对来源，并确认备份期间会避免修改数据库结构',
  format: '备份格式',
  sql: 'SQL 脚本',
  archive: 'tabrelio ZIP 归档',
  archiveScope: 'ZIP 归档保存原始 SQL 和可见对象清单，可在归档窗口校验及导出 SQL。',
  archiveHash: '归档 SHA-256',
  choose: '选择保存位置',
  start: '开始备份',
  running: '正在检查来源并流式生成备份',
  cancelling: '正在等待原备份任务结束',
  cancel: '取消备份',
  close: '关闭',
  saved: (bytes: number, version: string, archive: boolean) => `已保存${archive ? '整库 ZIP 归档' : '整库 SQL'} · ${bytes.toLocaleString()} 字节 · 工具 ${version}`,
} as const;
