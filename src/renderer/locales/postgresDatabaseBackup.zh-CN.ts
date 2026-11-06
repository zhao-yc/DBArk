import { postgresDatabaseBackupPickToolTitle, postgresDatabaseBackupTitle } from '../../shared/postgresDatabaseBackup';

export const postgresDatabaseBackupZh = {
  title: postgresDatabaseBackupTitle, tool: postgresDatabaseBackupPickToolTitle,
  connection: '来源连接', database: '来源数据库', choose: '选择备份文件', start: '确认并开始备份', close: '关闭',
  cancel: '取消备份', running: '正在从同一只读快照生成整库备份', cancelling: '正在等待备份进程及连接结束',
  scope: '使用本机 PostgreSQL 安装中的 pg_dump，将所选数据库保存为 UTF-8 纯文本 SQL。建议使用与源库相同主版本的 pg_dump。备份可在「执行 PostgreSQL SQL 文件」中恢复。',
  portable: '省略所有者和授权',
  portableHint: '迁往角色配置不同的服务器时可勾选。集群级角色及表空间定义需单独准备。',
  done: (bytes: number, version: string) => '已保存 ' + bytes.toLocaleString('zh-CN') + ' B · pg_dump ' + version,
  warnings: 'pg_dump 提示',
} as const;
