import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteTableRebuildTargetSchema, type SqliteTableRebuildTarget } from '../shared/sqliteTableRebuild';
import { sqliteTableRebuildZh as text } from './locales/sqliteTableRebuild.zh-CN';
import type { useWorkspace } from './store';

type Workspace = ReturnType<typeof useWorkspace.getState>;
/** 重建会改变同文件目录和页面快照；任何 main 表页草稿或活动任务都须先处理。只读连接仍可预览。 */
export function assertSqliteTableRebuildTargetAvailable(raw: SqliteTableRebuildTarget, workspace: Workspace): SqliteConnectionProfile {
  const target = sqliteTableRebuildTargetSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length || /^sqlite_/i.test(target.table)) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if (tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id] || workspace.tableLayoutDrafts?.[tab.id])) throw Error(text.busyTarget);
  return profile;
}
