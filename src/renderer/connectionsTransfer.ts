import type { ConnectionProfile } from '../shared/contracts';
import { connectionsTransferZh as text } from './locales/connectionsTransfer.zh-CN';
import { formatText } from './locales/zh-CN';
import { copyConnectionProfile, type ConnectionFileRequirement } from '../shared/connectionTransfer';

export type PendingConnectionFile = ConnectionFileRequirement;
export type PendingConnectionProfile = ConnectionProfile;

/** 新表单只复制目标白名单，不通过展开原对象继承秘密、旧 ID 或文件认证。 */
export function copyConnectionOverview(profile: ConnectionProfile): ConnectionProfile {
  return { ...copyConnectionProfile(profile), name: formatText(text.copyName, profile.name) };
}

/** 仅原生文件选择和主进程路径授权成功后调用；手输路径不消除来源文件待补标记。 */
export function assignAuthorizedConnectionFile(profile: PendingConnectionProfile, kind: PendingConnectionFile, path: string): PendingConnectionProfile {
  const pendingFiles = profile.pendingFiles?.filter(item => item !== kind);
  const updated = kind === 'sshPrivateKey' ? { ...profile, ssh: { ...(profile.ssh ?? { enabled: false, host: '', port: 22, user: '' }), privateKeyPath: path } } : { ...profile, tls: { ...(profile.tls ?? { enabled: false, rejectUnauthorized: true }), [kind === 'tlsCa' ? 'caPath' : kind === 'tlsCert' ? 'certPath' : 'keyPath']: path } };
  return { ...updated, pendingFiles };
}
