import { connectionDatabase, connectionOverview } from '../../src/renderer/sqliteWorkspace';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';

/** 旧查询回归均使用网络连接；VM 保留真实方言分支及生产概要函数，不替换执行处理器。 */
export function queryDialectVm(profile: { dialect: 'mysql' | 'mariadb' | 'sqlite' } = { dialect: 'mysql' }) {
  return { sqlite: profile.dialect === 'sqlite', connectionDatabase, connectionOverview, sqliteZh };
}
