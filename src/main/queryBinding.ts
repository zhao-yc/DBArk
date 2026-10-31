import { createHash } from 'node:crypto';
import type { ConnectionProfile, SavedQuery } from '../shared/contracts';
import { savedQueryOriginContext, type QuerySourceBinding } from '../shared/queryBinding';

/** 仅对公开路由配置计算身份，不解密、读取或返回数据库/SSH 密码及证书内容。 */
export function queryConnectionDigest(profile: ConnectionProfile): string {
  const target = profile.dialect === 'sqlite'
    ? [profile.id, profile.dialect, profile.sqlite.filePath ?? '', profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs, [...profile.pendingFiles ?? []].sort()]
    : [profile.id, profile.dialect, profile.host, profile.port, profile.user, profile.database ?? null,
    [...profile.pendingFiles ?? []].sort(), profile.ssh?.enabled ?? false, profile.ssh?.host ?? '', profile.ssh?.port ?? 22,
    profile.ssh?.user ?? '', profile.ssh?.privateKeyPath ?? '', profile.ssh?.hostFingerprint ?? '',
    profile.tls?.enabled ?? false, profile.tls?.rejectUnauthorized ?? true, profile.tls?.caPath ?? '', profile.tls?.certPath ?? '', profile.tls?.keyPath ?? ''];
  return createHash('sha256').update(JSON.stringify(target)).digest('hex');
}
/** 摘要绑定真实存储原文，来源上下文来自记录自身；替代连接不能改写此身份。 */
export function bindSavedQuery(query: SavedQuery, raw: string, profile?: ConnectionProfile): QuerySourceBinding {
  return { id: query.id, digest: createHash('sha256').update(raw).digest('hex'),
    ...(query.connectionId ? { connectionId: query.connectionId } : {}),
    ...(profile ? { connectionDigest: queryConnectionDigest(profile) } : {}), context: savedQueryOriginContext(query.database, query.databaseContext) };
}
