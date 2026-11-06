export type SqliteDatabaseCopyInput = { mode: 'backup'; connectionId: string } | { mode: 'restore' };
export interface SqliteDatabaseCopyOutput { name: string; cleanupPending: boolean; }

export const sqliteDatabaseCopyZh = {
  backup: '备份 SQLite 整库',
  restore: '从 SQLite 备份恢复',
  chooseBackup: '选择 SQLite 备份文件',
  restoreAs: '恢复 SQLite 到新文件',
  fileType: 'SQLite 数据库',
  backupName: 'SQLite备份.sqlite',
  restoreName: '恢复的数据库.sqlite',
  running: '正在复制并校验 SQLite 整库',
  finished: 'SQLite 副本已校验并保存',
  cleanupPending: 'SQLite 副本已保存，暂存资源的清理未确认',
  cancelled: 'SQLite 整库复制已取消，目标文件未发布',
  failed: 'SQLite 整库复制失败，目标文件未发布',
  saved: (name: string) => `已保存 SQLite 文件「${name}」`,
  restored: (name: string) => `已恢复到「${name}」。可在新建 SQLite 连接时选择该文件`,
} as const;
