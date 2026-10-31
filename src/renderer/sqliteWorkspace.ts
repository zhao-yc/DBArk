import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';

/** 文件概要只展示最后一级名称；跨平台路径均不当作网络地址。 */
export function sqliteFileName(value?: string): string { return value?.split(/[\\/]/).at(-1) ?? ''; }
/** 连接概要按实际变体取字段，SQLite 永远不读取 host/user 等网络配置。 */
export function connectionOverview(profile: ConnectionProfile): string {
  return profile.dialect === 'sqlite' ? 'SQLite · ' + (profile.sqlite.fileName || sqliteFileName(profile.sqlite.filePath))
    : profile.dialect + ' · ' + profile.host + ':' + profile.port + ' · ' + profile.user + ' · ' + (profile.database ?? '');
}
/** SQLite 标识符用双引号且逐个转义；只生成草稿，不能自动执行。 */
export function sqliteSelectSource(database: string, object: Pick<DatabaseObject, 'name'>): string {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  return 'SELECT * FROM ' + quote(database) + '.' + quote(object.name) + ' LIMIT 100;';
}

/** SQLite 文件会话始终从真实 main 目录开始，网络连接沿用保存的默认库。 */
export function connectionDatabase(profile?: { dialect?: ConnectionProfile['dialect']; database?: string }): string | undefined { return profile?.dialect === 'sqlite' ? 'main' : profile?.database; }
