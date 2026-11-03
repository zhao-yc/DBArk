import type { DatabaseObject } from '../shared/contracts';
import { assertNetworkSchemaScript } from '../shared/networkSchemaScript';
import { errorMessage, invoke, uid } from './lib';
import { useWorkspace } from './store';
import { schemaScriptZh } from './locales/schemaScript.zh-CN';

export const schemaScriptLabel = schemaScriptZh.label;

/** 发布只绑定原连接、标签与选择。离开后即使切回也不会打开迟到草稿。 */
export async function openSchemaScriptDraft(connectionId: string, database: string, name: string, read: () => Promise<string>, sourceCurrent = () => true): Promise<void> {
  const workspace = useWorkspace.getState(), profile = workspace.connections.find(item => item.id === connectionId);
  if (!profile) return;
  const { activeTabId } = workspace.settings, selection = workspace.selection, version = workspace.connectionVersions[connectionId] ?? 0;
  let valid = true;
  const current = () => {
    const next = useWorkspace.getState();
    return valid && next.settings.activeTabId === activeTabId && next.selection === selection && next.connections.find(item => item.id === connectionId) === profile && (next.connectionVersions[connectionId] ?? 0) === version && sourceCurrent();
  };
  if (!current() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
  const unsubscribe = useWorkspace.subscribe(() => { if (!current()) valid = false; });
  try {
    const sql = await read();
    if (!current() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(schemaScriptZh.tabLimit);
    // 标签标题遵循工作区保存上限，完整对象名继续保留在脚本中。
    const suffix = ' · ' + schemaScriptLabel;
    const title = name.slice(0, 256 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
    useWorkspace.getState().openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title, sql });
  } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
  finally { unsubscribe(); }
}

/** 只读完整定义，当前表页的数据和查询会话由各自原标签继续持有。 */
export async function openNetworkSchemaScript(connectionId: string, database: string, object: DatabaseObject, sourceCurrent?: () => boolean): Promise<void> {
  const dialect = useWorkspace.getState().connections.find(item => item.id === connectionId)?.dialect;
  if ((dialect !== 'mysql' && dialect !== 'mariadb') || (object.kind !== 'table' && object.kind !== 'view')) return;
  const source = { connectionId, database, name: object.name, kind: object.kind, taskId: uid() };
  return openSchemaScriptDraft(connectionId, database, source.name, async () => assertNetworkSchemaScript(await invoke('metadata.schemaScript', source), source).sql, sourceCurrent);
}
