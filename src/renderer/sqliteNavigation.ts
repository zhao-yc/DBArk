import type { DatabaseObject } from '../shared/contracts';
import { errorMessage, invoke } from './lib';
import { useWorkspace } from './store';
import { sqliteSelectSource } from './sqliteWorkspace';
import { sqliteZh } from './locales/sqlite.zh-CN';

/** 文件对象沿原查询标签生成草稿，不创建 MySQL 表数据标签，也不自动执行 SQL。 */
export function openSqliteObject(connectionId: string, database: string, object: DatabaseObject): boolean {
  const workspace = useWorkspace.getState();
  if (workspace.connections.find(profile => profile.id === connectionId)?.dialect !== 'sqlite') return false;
  if (database !== 'main') { workspace.notify(sqliteZh.mainOnly, true); return true; }
  if (object.kind === 'table' || object.kind === 'view') workspace.openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title: object.name, sql: sqliteSelectSource(database, object) });
  else void openSqliteDefinition(connectionId, database, object);
  return true;
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
