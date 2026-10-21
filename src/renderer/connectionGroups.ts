import type { ConnectionProfile } from '../shared/contracts';

/** 分组身份取原始名称；空值不能与恰好命名为“未分组”的真实分组混合。 */
export function connectionGroups(connections: readonly ConnectionProfile[]): { name: string; connections: ConnectionProfile[] }[] {
  const groups = new Map<string, ConnectionProfile[]>();
  for (const connection of connections) {
    const name = connection.group ?? '';
    const members = groups.get(name);
    if (members) members.push(connection); else groups.set(name, [connection]);
  }
  return Array.from(groups, ([name, members]) => ({ name, connections: members }));
}
