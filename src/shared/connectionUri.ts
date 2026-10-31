import type { ConnectionProfile, NetworkConnectionProfile } from './contracts';

export const connectionUriLimits = { units: 16 * 1024, password: 4096 } as const;
export const connectionUriErrors = {
  invalid: '连接URI格式无效。请使用mysql://用户:密码@主机:端口/数据库或mariadb://格式；保留字符需百分号编码。',
  options: '连接URI不接受查询参数或片段。请在表单中明确配置SSH／TLS，不会忽略这些选项。',
  budget: '连接URI或解码字段超出长度限制。',
} as const;
export type ConnectionUriTarget = Pick<NetworkConnectionProfile, 'dialect' | 'host' | 'port' | 'user' | 'password' | 'database'>;
/** 组件只解码一次；无效UTF-8、NUL和孤立代理项拒绝，错误不回显URI或秘密。 */
function decode(value: string): string {
  try {
    const result = decodeURIComponent(value);
    if (result.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result)) throw Error();
    return result;
  } catch { throw Error(connectionUriErrors.invalid); }
}
/** 本地解析只接受明确用户和单个目标，不读取环境、文件或建立连接。 */
export function parseConnectionUri(raw: string): ConnectionUriTarget {
  if (typeof raw !== 'string' || raw.length > connectionUriLimits.units) throw Error(connectionUriErrors.budget);
  if (/[?#]/u.test(raw)) throw Error(connectionUriErrors.options);
  if (!raw || /[\s\u0000-\u001f\u007f\\]/u.test(raw)) throw Error(connectionUriErrors.invalid);
  const match = /^(mysql|mariadb):\/\/([^/]+)(\/[^/]*)?$/iu.exec(raw);
  if (!match) throw Error(connectionUriErrors.invalid);
  const at = match[2].indexOf('@');
  if (at <= 0 || at !== match[2].lastIndexOf('@')) throw Error(connectionUriErrors.invalid);
  const auth = match[2].slice(0, at), authority = match[2].slice(at + 1), colon = auth.indexOf(':');
  const user = decode(colon < 0 ? auth : auth.slice(0, colon)), password = decode(colon < 0 ? '' : auth.slice(colon + 1));
  if (!user || !user.trim() || /[\u0000-\u001f\u007f]/u.test(user)) throw Error(connectionUriErrors.invalid);
  const hostParts = authority.startsWith('[') ? /^(\[[0-9a-f:.]+\])(?::([0-9]+))?$/iu.exec(authority) : /^([^:]+)(?::([0-9]+))?$/u.exec(authority);
  if (!hostParts) throw Error(connectionUriErrors.invalid);
  const port = hostParts[2] === undefined ? 3306 : Number(hostParts[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error(connectionUriErrors.invalid);
  let host: string;
  try {
    // 只对主机使用标准URL规范化，支持IDN及IPv6；数据库路径和认证不交给URL自动归一化。
    const parsed = new URL('http://' + hostParts[1] + '/');
    if (!parsed.hostname || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) throw Error();
    host = parsed.hostname.startsWith('[') ? parsed.hostname.slice(1, -1) : parsed.hostname;
  } catch { throw Error(connectionUriErrors.invalid); }
  const database = match[3] && match[3] !== '/' ? decode(match[3].slice(1)) : undefined;
  if (database && /[\u0000-\u001f\u007f/\\]/u.test(database)) throw Error(connectionUriErrors.invalid);
  if (host.length > 512 || user.length > 256 || password.length > connectionUriLimits.password || (database?.length ?? 0) > 256) throw Error(connectionUriErrors.budget);
  return { dialect: match[1].toLowerCase() as NetworkConnectionProfile['dialect'], host, port, user, password, ...(database ? { database } : {}) };
}
/** 新连接只保留名称分组颜色和新编号；不把复制来源的SSH、TLS、秘密标记或待补文件带往新目标。 */
export function connectionProfileFromUri(current: ConnectionProfile, raw: string): NetworkConnectionProfile {
  return { id: current.id, name: current.name, group: current.group, color: current.color, ...parseConnectionUri(raw), rememberPassword: false };
}
