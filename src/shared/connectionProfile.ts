import type { ConnectionProfile } from './contracts';

/** 只列出决定数据库目标和认证的字段，显示信息与秘密存在标记不参与路由比较。 */
function transport(profile: ConnectionProfile): unknown[] {
  if (profile.dialect === 'sqlite') return [[...profile.pendingFiles ?? []].sort(), profile.dialect,
    profile.sqlite.filePath ?? '', profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs];
  return [[...profile.pendingFiles ?? []].sort(), profile.dialect, profile.host, profile.port, profile.user, profile.database ?? '',
    profile.ssh?.enabled ?? false, profile.ssh?.host ?? '', profile.ssh?.port ?? 22, profile.ssh?.user ?? '', profile.ssh?.privateKeyPath ?? '', profile.ssh?.hostFingerprint ?? '',
    profile.tls?.enabled ?? false, profile.tls?.rejectUnauthorized ?? true, profile.tls?.caPath ?? '', profile.tls?.certPath ?? '', profile.tls?.keyPath ?? ''];
}

/** 编辑表单缺省秘密表示保留；主进程传入解密后的完整配置时使用精确比较模式。 */
export function connectionTransportChanged(previous: ConnectionProfile, next: ConnectionProfile, options: { preserveMissingSecrets?: boolean } = {}): boolean {
  if (JSON.stringify(transport(previous)) !== JSON.stringify(transport(next))) return true;
  if (previous.dialect === 'sqlite' || next.dialect === 'sqlite') return false;
  const preserve = options.preserveMissingSecrets !== false;
  /** 渲染进程看不到原秘密，显式重填按变更处理，不能误把清除当作保留。 */
  const changedSecret = (before: string | undefined, after: string | undefined, present?: boolean): boolean => {
    if (preserve && after === undefined) return false;
    if (!preserve) return (before ?? '') !== (after ?? '');
    if (after === '') return Boolean(before || present);
    return before === undefined ? Boolean(after || present) : before !== after;
  };
  return changedSecret(previous.password, next.password, previous.hasPassword)
    || changedSecret(previous.ssh?.password, next.ssh?.password, previous.ssh?.hasPassword)
    || changedSecret(previous.ssh?.passphrase, next.ssh?.passphrase, previous.ssh?.hasPassphrase)
    || changedSecret(previous.tls?.passphrase, next.tls?.passphrase, previous.tls?.hasPassphrase);
}
