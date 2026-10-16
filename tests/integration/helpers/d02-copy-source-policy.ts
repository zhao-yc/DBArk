import { isAbsolute } from 'node:path';
import { C02FixtureError, c02Failure, c02Names, cleanupC02, type C02Ownership } from './c02-mtls-policy';

export class D02FixtureError extends C02FixtureError {}
export interface D02CopyConfig {
  host: '192.168.31.200'; port: 13384 | 13484; serverUuid: string;
  user: string; password: string; tls: boolean; caPath?: string; caSha256?: string;
}
export type D02Ownership = C02Ownership;

/** 默认只读两个开关；未同时开启时不读取其他配置、文件或加载数据库模块。 */
export function d02CopyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_D02_COPY_SOURCE_ENABLED === '1';
}

/** 只接受ROOT本轮显式注入值；不读取.env、SSH或既有ROOT凭据，不推测实例UUID。 */
export function d02CopyConfig(env: NodeJS.ProcessEnv): D02CopyConfig {
  if (!d02CopyEnabled(env)) throw new D02FixtureError('完整复制源真实验收尚未显式启用');
  const port = env.DBARK_TEST_PORT;
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || !['13384', '13484'].includes(port ?? '') || env.DBARK_D02_COPY_ROOT_CONFIRM !== `server-200/192.168.31.200:${port}/d02-copy-source`) throw new D02FixtureError('只允许ROOT核对的server-200及13384或13484');
  if (env.DBARK_TEST_SSH === '1') throw new D02FixtureError('本片不允许SSH转发或替换目标');
  const serverUuid = env.DBARK_D02_COPY_SERVER_UUID ?? '';
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid)) throw new D02FixtureError('必须显式提供本轮实际MySQL实例UUID');
  if (!env.DBARK_TEST_USER || !env.DBARK_TEST_PASSWORD) throw new D02FixtureError('必须由ROOT显式注入本轮既有观察账号和密码');
  const tls = port === '13484' || env.DBARK_TEST_TLS === '1';
  const caPath = env.DBARK_TEST_CA, caSha256 = env.DBARK_D02_COPY_CA_SHA256;
  if (tls && (env.DBARK_TEST_TLS !== '1' || !caPath || !isAbsolute(caPath) || /[\r\n\0]/.test(caPath) || !/^[a-f0-9]{64}$/i.test(caSha256 ?? ''))) throw new D02FixtureError('严格TLS必须显式启用并提供原CA绝对路径及已核对SHA256，禁止降级或替换CA');
  return { host: '192.168.31.200', port: Number(port) as 13384 | 13484, serverUuid: serverUuid.toLowerCase(), user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, tls, ...(tls ? { caPath, caSha256: caSha256!.toLowerCase() } : {}) };
}

/** 沿用已授权cp_十二位后缀及精确subject表；不允许外部传入库名或账号。 */
export function d02CopyNames(suffix: string, limited: boolean) {
  const names = c02Names(suffix);
  return { ...names, database: limited ? names.database : `dbark_e2e_d02_${suffix}` };
}

/** 一切断言只输出固定说明，不让Vitest把真实行、凭据或驱动sql对象展开。 */
export function d02Fact(condition: unknown, message: string): asserts condition { if (!condition) throw new D02FixtureError(message); }

/** 继承已审过的安全因果链保留逻辑；不直接展示驱动消息、SQL、参数或返回内容。 */
export function d02Failure(stage: string, reason: unknown): Error { return c02Failure(stage, reason); }

/** 单表归属令牌必须保持，空库只允许由已确认CREATE且没有未知后续写操作的状态调用。 */
export function d02OwnsTables(rows: { name: unknown; comment: unknown }[], owner: string): boolean {
  return /^[a-f0-9]{32}$/.test(owner) && rows.length <= 1 && rows.every(row => row.name === 'subject' && row.comment === `dbark-d02-owner:${owner}`);
}

/** 复用已审过的清理顺序；CREATE/授权/其它夹具写响应未知均保留资源，不重放写操作。 */
export async function cleanupD02Copy(actions: Parameters<typeof cleanupC02>[0], uncertainWrite: boolean, failure?: unknown): Promise<void> {
  await cleanupC02({ ...actions, ...(uncertainWrite ? { database: 'unknown', user: actions.user === 'absent' ? 'absent' : 'unknown' } : {}) }, failure);
}
