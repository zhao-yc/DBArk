import type { ConnectionProfile } from '../shared/contracts';
import type { ConnectionFileRequirement } from '../shared/connectionTransfer';

export interface SelectedFile { path: string; purpose: string; format?: string; revokedConnections?: ReadonlySet<string>; }

/** 授权原属窗口；受控替换仅撤销这些目标对既有认证选择的使用，不影响其它连接或源文件令牌。 */
export function revokeConnectionFiles(ids: readonly string[], files: Map<string, SelectedFile>): void {
  for (const [token, file] of files) if (file.purpose === 'key' || file.purpose === 'certificate') files.set(token, { ...file, revokedConnections: new Set([...file.revokedConnections ?? [], ...ids]) });
}

/** 仅解析当前窗口原生对话框创建且用途匹配的令牌，路径永远由主进程注入。 */
export function resolveFileToken(files: ReadonlyMap<string, SelectedFile>, token: string, purpose: 'import' | 'export' | 'query' | 'connection-import' | 'connection-export', format?: string): string {
  const selected = files.get(token);
  if (!selected || selected.purpose !== purpose) throw new Error('文件访问未授权，请通过文件对话框重新选择');
  if (format && selected.format !== format) throw new Error('文件类型未授权，请重新选择用途匹配的文件');
  return selected.path;
}

/** 旧缺文件标记不能通过漏传字段移除；仅本窗口对应用途的原生选择授权可完成重新配置。 */
export function confirmConnectionFiles(input: ConnectionProfile, previous: ConnectionProfile | undefined, files: ReadonlyMap<string, SelectedFile>): ConnectionProfile {
  const pending = new Set<ConnectionFileRequirement>([...previous?.pendingFiles ?? [], ...input.pendingFiles ?? []]);
  const paths: Record<ConnectionFileRequirement, string | undefined> = { sshPrivateKey: input.ssh?.privateKeyPath, tlsCa: input.tls?.caPath, tlsCert: input.tls?.certPath, tlsKey: input.tls?.keyPath };
  for (const item of pending) {
    const purpose = item === 'sshPrivateKey' || item === 'tlsKey' ? 'key' : 'certificate';
    if (paths[item] && [...files.values()].some(file => file.purpose === purpose && file.path === paths[item] && !file.revokedConnections?.has(input.id))) pending.delete(item);
  }
  return { ...input, pendingFiles: pending.size ? [...pending] : undefined };
}
