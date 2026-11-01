import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteObjectsTargetSchema, type SqliteObjectsTarget } from '../shared/sqliteObjects';
import type { useWorkspace, WorkspaceTab } from './store';
import { sqliteObjectsMessages as text } from '../shared/sqliteObjects';

type Workspace = ReturnType<typeof useWorkspace.getState>;
export type SqliteObjectsScope = Omit<SqliteObjectsTarget, 'name'> & { name?: string };
const scopeSchema = sqliteObjectsTargetSchema.partial({ name: true });
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
/** SQLite名称只折叠ASCII；同连接main视图页的大小写别名仍指向同一目标。 */
export function sqliteObjectsTabMatches(tab: WorkspaceTab, target: SqliteObjectsTarget): boolean {
  return target.kind === 'view' && tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && target.database === 'main' && typeof tab.table === 'string' && fold(tab.table) === fold(target.name);
}
/** 对象定义可能改变同文件视图和触发器行为，修改前保护所有main表页草稿和活动任务。 */
export function assertSqliteObjectsScopeAvailable(raw: SqliteObjectsScope, workspace: Workspace): SqliteConnectionProfile {
  const target = scopeSchema.parse(raw), profile = workspace.connections.find(value => value.id === target.connectionId);
  if (profile?.dialect !== 'sqlite' || !profile.sqlite.filePath || profile.pendingFiles?.length) throw Error(text.invalid);
  for (const tab of workspace.settings.tabs) if (tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && (workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id] || workspace.tableLayoutDrafts?.[tab.id])) throw Error(text.busyTarget);
  return profile;
}

/** 真正inspect目标仍须完整名称校验；create空名称只允许先打开本地草稿窗口。 */
export function assertSqliteObjectsTargetAvailable(raw: SqliteObjectsTarget, workspace: Workspace): SqliteConnectionProfile { return assertSqliteObjectsScopeAvailable(sqliteObjectsTargetSchema.parse(raw), workspace); }
