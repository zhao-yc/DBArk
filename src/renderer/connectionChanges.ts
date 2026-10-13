import type { AppSettings, ConnectionProfile } from '../shared/contracts';
import { connectionTransportChanged } from '../shared/connectionProfile';
import { zh } from './locales/zh-CN';

/** 已有工作区标签时拒绝切换连接参数，保持标签中的会话、事务和数据草稿完整。 */
export function assertConnectionUpdateAllowed(previous: ConnectionProfile | undefined, next: ConnectionProfile, tabs: AppSettings['tabs']): void {
  if (previous && tabs.some(tab => tab.connectionId === previous.id) && connectionTransportChanged(previous, next)) {
    throw new Error(zh.connections.openTabsBlockChanges);
  }
}
