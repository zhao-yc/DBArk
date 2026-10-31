import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { assertDefaultEncodingLiveTarget } from './tableDefaultEncodingTarget';

export const copyInsertReplayModes = [
  { name: '普通模式', sqlMode: 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION' },
  { name: 'ANSI_QUOTES与NO_BACKSLASH_ESCAPES', sqlMode: 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,ANSI_QUOTES,NO_BACKSLASH_ESCAPES' }
] as const;

/** 显式列表参数先短路；这里只读两个开关，其余配置留到Vitest不会在list中运行的准备钩子。 */
export function copyInsertReplayEnabled(env: NodeJS.ProcessEnv, argv: readonly string[]): boolean {
  return !argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_COPY_INSERT_REPLAY_ENABLED === '1';
}

/** 只复用Root显式注入的既有管理员profile；六实例共用已有目标门，不回填配置。 */
export function copyInsertReplayProfile(env: NodeJS.ProcessEnv, id: string): ConnectionProfile {
  if (!copyInsertReplayEnabled(env, [])) throw Error('INSERT回放尚未显式启用');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || env.DBARK_TEST_SSH === '1') throw Error('INSERT回放仅接受本轮200既有直连测试profile');
  if (!['0', '1'].includes(env.DBARK_TEST_TLS ?? '')) throw Error('INSERT回放必须显式指定原TLS策略');
  const profile: ConnectionProfile = { id, name: '复制INSERT精度回放隔离验证', group: '', color: '#345678', dialect: 'mysql', host: env.DBARK_TEST_HOST, port: Number(env.DBARK_TEST_PORT), user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD,
    ...(env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA } } : {}) };
  assertDefaultEncodingLiveTarget({ host: env.DBARK_TEST_HOST, port: env.DBARK_TEST_PORT, tlsFlag: env.DBARK_TEST_TLS, caPath: env.DBARK_TEST_CA }, profile);
  return profile;
}

/** 库名仅由本轮12位随机后缀生成，禁止接受外部库名或接管同名对象。 */
export function copyInsertReplayDatabase(suffix: string): string {
  if (!/^[a-f0-9]{12}$/.test(suffix)) throw Error('INSERT回放随机后缀无效');
  return 'dbark_colperm_' + suffix;
}

/** 严格限定两个普通表和本轮注释令牌；不把名称相同当作物理tableID归属证明。 */
export function assertCopyInsertReplayTables(rows: { name: unknown; kind: unknown; comment: unknown }[], owner: string): void {
  if (!/^[a-f0-9]{32}$/.test(owner) || rows.length !== 2 || new Set(rows.map(row => row.name)).size !== 2 || rows.some(row => typeof row.name !== 'string' || !['source', 'target'].includes(row.name) || row.kind !== 'BASE TABLE' || row.comment !== 'dbark-copy-insert-owner:' + owner)) throw Error('INSERT回放表归属未知，保留隔离库');
}
