import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteIndexesTargetSchema, type SqliteIndexesTarget } from '../shared/sqliteIndexes';
import type { useWorkspace } from './store';
import { sqliteIndexesZh as text } from './locales/sqliteIndexes.zh-CN';

type Workspace = ReturnType<typeof useWorkspace.getState>;
/** 索引入口只保护准确原表，不能覆盖其它表页的未提交草稿或作业。 */
export function assertSqliteIndexesTargetAvailable(raw: SqliteIndexesTarget, workspace: Workspace): SqliteConnectionProfile {
  const target = sqliteIndexesTargetSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length || /^sqlite_/i.test(target.table)) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if (tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && tab.table === target.table && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id])) throw Error(text.busyTarget);
  return profile;
}
