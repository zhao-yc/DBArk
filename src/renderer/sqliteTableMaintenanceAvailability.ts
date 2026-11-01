import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteTableMaintenanceTargetSchema, type SqliteTableMaintenanceTarget } from '../shared/sqliteTableMaintenance';
import type { useWorkspace, WorkspaceTab } from './store';
import { sqliteTableMaintenanceMessages as text } from '../shared/sqliteTableMaintenance';

type Workspace = ReturnType<typeof useWorkspace.getState>;
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
/** SQLite名称只折叠ASCII；同连接main普通表页的大小写别名仍指向同一目标。 */
export function sqliteTableMaintenanceTabMatches(tab: WorkspaceTab, target: SqliteTableMaintenanceTarget): boolean {
  return tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && target.database === 'main' && typeof tab.table === 'string' && fold(tab.table) === fold(target.table);
}
/** 原生触发器与FK可能影响同文件其它表，维护前保护所有main表页草稿和活动任务。 */
export function assertSqliteTableMaintenanceTargetAvailable(raw: SqliteTableMaintenanceTarget, workspace: Workspace): SqliteConnectionProfile {
  const target = sqliteTableMaintenanceTargetSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length || /^sqlite_/i.test(target.table)) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if (tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id] || workspace.tableLayoutDrafts?.[tab.id])) throw Error(text.busyTarget);
  return profile;
}
