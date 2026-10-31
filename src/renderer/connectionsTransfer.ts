import { sqliteZh } from './locales/sqlite.zh-CN';
import type { ConnectionProfile, NetworkConnectionProfile, SqliteConnectionProfile } from '../shared/contracts';
import { connectionsTransferZh as text } from './locales/connectionsTransfer.zh-CN';
import { formatText } from './locales/zh-CN';
import { copyConnectionProfile, type ConnectionFileRequirement } from '../shared/connectionTransfer';

export type PendingConnectionFile = ConnectionFileRequirement;
export type PendingConnectionProfile = ConnectionProfile;

/** 新表单只复制目标白名单，不通过展开原对象继承秘密、旧 ID 或文件认证。 */
export function copyConnectionOverview(profile: NetworkConnectionProfile): NetworkConnectionProfile;
export function copyConnectionOverview(profile: SqliteConnectionProfile): SqliteConnectionProfile;
export function copyConnectionOverview(profile: ConnectionProfile): ConnectionProfile;
export function copyConnectionOverview(profile: ConnectionProfile): ConnectionProfile {
  return { ...copyConnectionProfile(profile), name: formatText(text.copyName, profile.name) };
}

/** 仅原生文件选择和主进程路径授权成功后调用；手输路径不消除来源文件待补标记。 */
export function assignAuthorizedConnectionFile(profile: NetworkConnectionProfile, kind: Exclude<PendingConnectionFile, 'sqliteDatabase'>, path: string): NetworkConnectionProfile;
export function assignAuthorizedConnectionFile(profile: SqliteConnectionProfile, kind: PendingConnectionFile, path: string): SqliteConnectionProfile;
export function assignAuthorizedConnectionFile(profile: PendingConnectionProfile, kind: PendingConnectionFile, path: string): PendingConnectionProfile;
export function assignAuthorizedConnectionFile(profile: PendingConnectionProfile, kind: PendingConnectionFile, path: string): PendingConnectionProfile {
  if (profile.dialect === 'sqlite') return profile;
  if (kind === 'sqliteDatabase') throw new Error(sqliteZh.wrongFileKind);
  const pendingFiles = profile.pendingFiles?.filter(item => item !== kind);
  const updated = kind === 'sshPrivateKey' ? { ...profile, ssh: { ...(profile.ssh ?? { enabled: false, host: '', port: 22, user: '' }), privateKeyPath: path } } : { ...profile, tls: { ...(profile.tls ?? { enabled: false, rejectUnauthorized: true }), [kind === 'tlsCa' ? 'caPath' : kind === 'tlsCert' ? 'certPath' : 'keyPath']: path } };
  return { ...updated, pendingFiles };
}
