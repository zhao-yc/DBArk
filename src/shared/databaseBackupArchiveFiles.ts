import type { DatabaseBackupBlocker, DatabaseBackupManifest } from './databaseBackup';

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

export interface DatabaseBackupRestoreTargetAudit {
  family: DatabaseBackupManifest['family'];
  version: string;
  versionMatches: boolean;
  database: string;
  actualDatabase: string | null;
  state: 'absent' | 'empty' | 'occupied' | 'unknown';
  visible: { relations: number; views: number; routines: number; triggers: number; events: number } | null;
  scheduler: 'enabled' | 'disabled' | 'unknown';
  blockers: DatabaseBackupBlocker[];
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
  target: '恢复目标连接',
  targetPlaceholder: '选择已保存的 MySQL 或 MariaDB 连接',
  noTargets: '保存 MySQL 或 MariaDB 连接后，可以检查恢复目标。',
  audit: '检查目标',
  auditing: '正在只读检查恢复目标',
  auditResult: '目标检查结果',
  targetServer: '实际服务器',
  targetDatabase: '目标同名库',
  targetVersion: { match: '与清单版本一致', mismatch: '与清单版本不同' },
  targetState: { absent: '同名库未发现', empty: '同名库为空', occupied: '同名库已有对象', unknown: '同名库状态未知' },
  scheduler: '事件调度器',
  schedulerState: { enabled: '开启', disabled: '关闭', unknown: '未知' },
  visible: { relations: '表及其他关系', views: '视图', routines: '过程及函数', triggers: '触发器', events: '事件' },
  auditScope: '结果反映当前目录可见性与调度器状态。尚未确认来源实例、SQL 语义或恢复可用性。本次检查未执行归档 SQL。',
} as const;
