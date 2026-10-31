import type { ConnectionProfile, NetworkConnectionProfile } from '../../src/shared/contracts';
import type { ExportedConnectionProfile, ExportedNetworkConnectionProfile } from '../../src/shared/connectionTransfer';

/** 旧网络专项必须明确拒绝意外SQLite，不能通过过滤悄悄跳过错误目标。 */
export function assertNetworkProfile(profile: ConnectionProfile | undefined): NetworkConnectionProfile {
  if (!profile || profile.dialect === 'sqlite') throw new Error('网络连接专项收到非网络连接，停止当前验收');
  return profile;
}

/** 交换概要没有秘密与本机路径，单独保留其真实类型，不能伪装完整配置。 */
export function assertNetworkExportedProfile(profile: ExportedConnectionProfile | undefined): ExportedNetworkConnectionProfile {
  if (!profile || profile.dialect === 'sqlite') throw new Error('网络交换专项收到非网络连接概要，停止当前验收');
  return profile;
}
