import type { DatabaseObject } from '../shared/contracts';
import { errorMessage, invoke } from './lib';
import { useWorkspace } from './store';
import { sqliteSelectSource } from './sqliteWorkspace';
import { sqliteZh } from './locales/sqlite.zh-CN';
import { assertSqliteSchemaScript } from '../shared/sqliteSchemaScript';

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

/** 结构脚本从独立目录快照取得，只打开新查询；切换来源后迟到结果不再打开标签。 */
export async function openSqliteSchemaScript(connectionId: string, database: string, object: DatabaseObject, sourceCurrent = () => true): Promise<void> {
  const workspace = useWorkspace.getState(), profile = workspace.connections.find(item => item.id === connectionId);
  if (profile?.dialect !== 'sqlite' || database !== 'main' || object.kind !== 'table' && object.kind !== 'view') return;
  const { activeTabId } = workspace.settings, selection = workspace.selection, version = workspace.connectionVersions[connectionId] ?? 0;
  const source = { connectionId, database, table: object.name, kind: object.kind } as const;
  let valid = true;
  const current = () => {
    const next = useWorkspace.getState();
    return valid && next.settings.activeTabId === activeTabId && next.selection === selection && next.connections.find(item => item.id === connectionId) === profile && (next.connectionVersions[connectionId] ?? 0) === version && sourceCurrent();
  };
  if (!current()) return;
  const unsubscribe = useWorkspace.subscribe(() => { if (!current()) valid = false; });
  try {
    const output = await invoke('sqlite.schemaScript', source);
    if (!current() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const { sql } = assertSqliteSchemaScript(output, source);
    // 标签标题遵循工作区保存上限，完整对象名继续保留在脚本中。
    const suffix = ' · ' + sqliteZh.structureScript;
    const title = source.table.slice(0, 256 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
    useWorkspace.getState().openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title, sql });
  } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
  finally { unsubscribe(); }
}
