import type { DatabaseObject } from '../shared/contracts';
import { errorMessage, invoke } from './lib';
import { useWorkspace } from './store';
import { sqliteSelectSource } from './sqliteWorkspace';
import { sqliteZh } from './locales/sqlite.zh-CN';

/** 文件表和视图沿原 table 标签打开只读浏览，触发器仍使用原定义草稿。 */
export function openSqliteObject(connectionId: string, database: string, object: DatabaseObject): boolean {
  const workspace = useWorkspace.getState();
  if (workspace.connections.find(profile => profile.id === connectionId)?.dialect !== 'sqlite') return false;
  if (database !== 'main') { workspace.notify(sqliteZh.mainOnly, true); return true; }
  if (object.kind === 'table' || object.kind === 'view') workspace.openTab({ kind: 'table', connectionId, database, title: object.name, table: object.name });
  else void openSqliteDefinition(connectionId, database, object);
  return true;
}
/** SELECT 是独立且未执行的原查询草稿，不能由表浏览或右键打开菜单暗中执行。 */
export function openSqliteSelect(connectionId: string, database: string, object: DatabaseObject): void {
  const workspace = useWorkspace.getState();
  if (workspace.connections.find(profile => profile.id === connectionId)?.dialect !== 'sqlite') return;
  if (database !== 'main') { workspace.notify(sqliteZh.mainOnly, true); return; }
  if (object.kind !== 'table' && object.kind !== 'view') return;
  workspace.openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title: object.name, sql: sqliteSelectSource(database, object) });
}
/** 定义只作为查询草稿打开；读取期间连接修订、标签或选择变化会撤销迟到导航。 */
export async function openSqliteDefinition(connectionId: string, database: string, object: DatabaseObject): Promise<void> {
  const workspace = useWorkspace.getState(), profile = workspace.connections.find(item => item.id === connectionId);
  if (profile?.dialect !== 'sqlite') return;
  const version = workspace.connectionVersions[connectionId] ?? 0, active = workspace.settings.activeTabId, selection = workspace.selection;
  const current = () => { const next = useWorkspace.getState(); return next.connections.find(item => item.id === connectionId) === profile && (next.connectionVersions[connectionId] ?? 0) === version && next.settings.activeTabId === active && next.selection === selection; };
  try {
    await invoke('connections.open', { id: connectionId }); if (!current()) return;
    const sql = await invoke('metadata.ddl', { connectionId, database, name: object.name, kind: object.kind }); if (!current()) return;
    useWorkspace.getState().openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title: object.name + ' · ' + sqliteZh.definition, sql });
  } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
}
