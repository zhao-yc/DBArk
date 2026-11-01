import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteTableRenameTargetSchema, type SqliteTableRenameTarget } from '../shared/sqliteTableRename';
import type { useWorkspace, WorkspaceTab } from './store';
import { sqliteTableRenameMessages as text } from '../shared/sqliteTableRename';

type Workspace = ReturnType<typeof useWorkspace.getState>;
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
/** SQLite名称只折叠ASCII；同连接main普通表页的大小写别名仍指向同一目标。 */
export function sqliteTableRenameTabMatches(tab: WorkspaceTab, target: SqliteTableRenameTarget): boolean {
  return tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && target.database === 'main' && typeof tab.table === 'string' && fold(tab.table) === fold(target.table);
}
/** 表重命名入口只保护准确原表，不能覆盖其它表页的未提交草稿或作业。 */
export function assertSqliteTableRenameTargetAvailable(raw: SqliteTableRenameTarget, workspace: Workspace, newName?: string): SqliteConnectionProfile {
  const target = sqliteTableRenameTargetSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length || /^sqlite_/i.test(target.table)) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if ((sqliteTableRenameTabMatches(tab, target) || newName !== undefined && sqliteTableRenameTabMatches(tab, { ...target, table: newName })) && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id] || workspace.tableLayoutDrafts?.[tab.id])) throw Error(text.busyTarget);
  return profile;
}
