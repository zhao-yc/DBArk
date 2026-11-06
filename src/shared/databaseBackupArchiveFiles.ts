import type { DatabaseBackupBlocker, DatabaseBackupKind, DatabaseBackupManifest } from './databaseBackup';

/** ZIP64 容器兼容旧清单。用户选取的程序只记录实际可执行文件摘要，目录记录可见对象。 */
export type DatabaseBackupSelectedToolManifest = Omit<DatabaseBackupManifest,
  'schemaVersion' | 'toolSuiteSha256' | 'toolRegistryRevision' | 'consistency' | 'externalDependencies' | 'resourcesConfirmed'> & {
  schemaVersion: 2;
  toolExecutableSha256: string;
  consistency: { mode: 'innodb-consistent-read'; startedAt: string; completedAt: string; allObjectsFrozen: false };
  resourcesConfirmed: true;
};
export type DatabaseBackupFileManifest = DatabaseBackupManifest | DatabaseBackupSelectedToolManifest;

export interface DatabaseBackupArchiveView {
  token: string;
  name: string;
  manifest: DatabaseBackupFileManifest;
  archive: { bytes: string; sha256: string };
}

export interface DatabaseBackupSqlExport {
  name: string;
  bytes: string;
  sha256: string;
  cleanupPending: boolean;
}

export interface DatabaseBackupSqlInventory {
  state: 'matches' | 'differs' | 'partial';
  statements: number;
  dataStatements: number;
  definitions: number;
  otherStatements: number;
  databases: string[];
  definers: string[];
  missing: { total: number; items: { kind: DatabaseBackupKind; name: string }[] };
  extra: { total: number; items: { kind: DatabaseBackupKind; name: string }[] };
  reason: 'encoding' | 'lexical' | 'budget' | 'version' | null;
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
  snapshotScope: '清单记录可见对象与 InnoDB 数据快照，外部依赖需另行核对。',
  executableHash: '转储工具 SHA-256',
  scope: '归档校验只核对容器和字节摘要。来源与恢复可用性须另行核对，导出不会执行 SQL。',
  saved: (name: string) => `已导出「${name}」`,
  cleanupPending: 'SQL 已导出，临时文件清理未确认',
  stale: '备份归档或原窗口已变化，请重新选择归档',
  existing: '目标文件已存在，请选择新的 SQL 文件名',
  inspectSql: '检查 SQL 对象',
  inspectingSql: '正在复核归档并核对 SQL 对象',
  sqlInventory: 'SQL 对象检查结果',
  sqlInventoryState: { matches: '识别到的对象类型和名称均与清单一致', differs: '识别到的对象或目标库与清单不同', partial: '只取得部分 SQL 对象检查结果' },
  sqlInventoryCounts: (definitions: number, statements: number, inserts: number) => `定义对象 ${definitions} · SQL 语句 ${statements} · 数据写入语句 ${inserts}`,
  sqlDatabases: '脚本显式指定的目标库',
  sqlDefiners: '脚本显式声明的 DEFINER',
  sqlMissing: '清单中有，脚本定义未找到',
  sqlExtra: '脚本中有，清单未列出',
  sqlTable: '表',
  sqlOther: (amount: number) => `有 ${amount} 条语句无法归入已识别的转储语法。`,
  sqlReason: { encoding: '脚本编码无法按 UTF-8 完整读取。', lexical: '脚本语句边界或会话词法条件无法完整解析。', budget: '脚本超过对象检查预算。', version: '清单中的服务器版本无法用于判断条件注释。' },
  sqlScope: '检查只核对显式语句和定义名称。结果以清单声明的方言与版本解释条件注释，完整依赖、定义内容及恢复可用性仍待验证。',
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
