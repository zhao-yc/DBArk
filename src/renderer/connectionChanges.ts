import type { AppSettings, ConnectionProfile } from '../shared/contracts';
import { connectionTransportChanged } from '../shared/connectionProfile';
import { zh } from './locales/zh-CN';
import { invoke } from './lib';

export interface ConnectionSelection { connectionId: string; database?: string; }

/** 已有工作区标签时拒绝切换连接参数，保持标签中的会话、事务和数据草稿完整。 */
export function assertConnectionUpdateAllowed(previous: ConnectionProfile | undefined, next: ConnectionProfile, tabs: AppSettings['tabs']): void {
  if (previous && tabs.some(tab => tab.connectionId === previous.id) && connectionTransportChanged(previous, next)) {
    throw new Error(zh.connections.openTabsBlockChanges);
  }
}

/** 仅在连接配置确实保存成功后通知缓存失效；失败不动工作区，新连接和外观变更保留现有上下文。 */
export async function saveConnectionUpdate(previous: ConnectionProfile | undefined, next: ConnectionProfile, tabs: AppSettings['tabs'], onTransportChanged: (connectionId: string) => void): Promise<ConnectionProfile> {
  assertConnectionUpdateAllowed(previous, next, tabs);
  const transportChanged = previous !== undefined && connectionTransportChanged(previous, next);
  const saved = await invoke('connections.save', next);
  if (transportChanged) onTransportChanged(saved.id);
  return saved;
}

/** 新查询优先使用树选择；选择中无数据库时保留空值，禁止从另一连接的活动标签补入库名。 */
export function newQueryContext(selection: ConnectionSelection | undefined, activeTab: AppSettings['tabs'][number] | undefined, firstConnectionId: string): ConnectionSelection {
  if (selection) return { connectionId: selection.connectionId, database: selection.database };
  if (activeTab) return { connectionId: activeTab.connectionId, database: activeTab.database };
  return { connectionId: firstConnectionId };
}
