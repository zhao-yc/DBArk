import type { DatabaseBackupManifest } from './databaseBackup';

export interface DatabaseBackupArchiveView {
  token: string;
  name: string;
  manifest: DatabaseBackupManifest;
  archive: { bytes: string; sha256: string };
}

export interface DatabaseBackupSqlExport {
  name: string;
  bytes: string;
  sha256: string;
  cleanupPending: boolean;
}

export const databaseBackupArchiveZh = {
  title: '打开数据库备份归档',
  select: '选择备份归档',
  fileType: 'tabrelio 数据库备份归档',
  sqlType: 'SQL 脚本',
  defaultName: '备份内容.sql',
  export: '导出原始 SQL',
  checking: '正在核对归档和 SQL 摘要',
  exporting: '正在复核归档并导出原始 SQL',
  cancel: '取消任务',
  cancelled: '归档操作已取消',
  close: '关闭',
  checked: '归档字节完整性已通过',
  file: '归档文件',
  source: '清单中的数据库',
  bytes: 'SQL 字节数',
  hash: 'SQL SHA-256',
  archiveHash: '归档 SHA-256',
  objects: '清单对象',
  dependencies: '清单中的外部依赖',
  scope: '归档校验只核对容器和字节摘要。来源与恢复可用性须另行核对，导出不会执行 SQL。',
  saved: (name: string) => `已导出「${name}」`,
  cleanupPending: 'SQL 已导出，临时文件清理未确认',
  stale: '备份归档或原窗口已变化，请重新选择归档',
  existing: '目标文件已存在，请选择新的 SQL 文件名',
} as const;
