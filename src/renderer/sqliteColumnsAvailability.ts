import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteColumnsTargetSchema, type SqliteColumnsTarget } from '../shared/sqliteColumns';
import type { useWorkspace } from './store';
import { sqliteColumnsZh as text } from './locales/sqliteColumns.zh-CN';

type Workspace = ReturnType<typeof useWorkspace.getState>;
/** 字段入口只保护准确原表，不能覆盖其它表页的未提交草稿或作业。 */
export function assertSqliteColumnsTargetAvailable(raw: SqliteColumnsTarget, workspace: Workspace): SqliteConnectionProfile {
  const target = sqliteColumnsTargetSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length || /^sqlite_/i.test(target.table)) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if (tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && tab.table === target.table && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id])) throw Error(text.busyTarget);
  return profile;
}
