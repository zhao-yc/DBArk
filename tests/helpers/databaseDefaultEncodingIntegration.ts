import type { ConnectionProfile } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { qisLifetime, type QisContext } from './queryInsertIntegration';
import { closeEmptyDefaultStream } from './tableCreateEmptyDefault';

export const databaseEncodingGate = 'DBARK_DATABASE_DEFAULT_ENCODING_TEST';
const versions = { '13357': ['mysql', '5.7.44'], '13380': ['mysql', '8.0.46'], '13384': ['mysql', '8.4.11'], '13310': ['mariadb', '10.11.19'], '13311': ['mariadb', '11.4.13'], '13484': ['mysql', '8.4.11'] } as const;
type Environment = Record<string, string | undefined>;

/** 在测试体内才绑定本轮显式目标，六实例均核实际身份；不加载任何凭据文件。 */
export function bindDatabaseEncodingTarget(read: () => Environment, id: string) {
  const raw = read(), port = raw.DBARK_TEST_PORT;
  if (!port || !Object.hasOwn(versions, port)) throw Error('数据库编码验收没有准确隔离端口');
  const [dialect, version] = versions[port as keyof typeof versions];
  const keys = ['DBARK_INTEGRATION_ENABLED', databaseEncodingGate, 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID', 'DBARK_TEST_EXPECTED_SERVER_PORT', ...(dialect === 'mysql' ? ['DBARK_TEST_EXPECTED_SERVER_UUID'] : []), ...(port === '13484' ? ['DBARK_TEST_CA'] : [])];
  if (keys.some(key => !Object.hasOwn(raw, key) || typeof raw[key] !== 'string') || raw.DBARK_INTEGRATION_ENABLED !== '1' || raw[databaseEncodingGate] !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(raw.DBARK_TEST_HOST!) || !raw.DBARK_TEST_USER || !raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME || !/^\d{1,10}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_ID!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_ID) > 4294967295 || !/^[1-9]\d{0,4}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_PORT!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_PORT) > 65535 || raw.DBARK_TEST_TLS !== (port === '13484' ? '1' : '0') || port === '13484' && !raw.DBARK_TEST_CA!.trim() || dialect === 'mysql' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)) throw Error('数据库编码验收目标、身份或严格TLS未显式准备');
  const forbidden = ['DBARK_TEST_SSH', 'DBARK_TEST_CERT', 'DBARK_TEST_KEY', 'DBARK_TEST_DATABASE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'];
  if (forbidden.some(key => Object.hasOwn(raw, key) && raw[key] !== undefined && raw[key] !== '' && !(key === 'DBARK_TEST_SSH' && raw[key] === '0'))) throw Error('数据库编码验收存在旁路或非本例数据库配置');
  const all = [...new Set([...keys, ...forbidden])], fixed = all.map(key => [key, Object.hasOwn(raw, key), raw[key]] as const); let retained = false;
  const assertCurrent = () => { const current = read(); if (retained || fixed.some(([key, own, value]) => Object.hasOwn(current, key) !== own || current[key] !== value)) { retained = true; throw Error('数据库编码验收配置漂移，保留原现场'); } };
  const profile: ConnectionProfile = Object.freeze({ id, name: '数据库默认编码隔离验收', group: '', color: '#123456', dialect, host: raw.DBARK_TEST_HOST!, port: Number(port), user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD!, ...(port === '13484' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: raw.DBARK_TEST_CA! } } : {}) });
  return { profile, version, dialect, hostname: raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME!, serverId: raw.DBARK_TEST_EXPECTED_SERVER_ID!, serverPort: raw.DBARK_TEST_EXPECTED_SERVER_PORT!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID, assertCurrent };
}
export type DatabaseEncodingBinding = ReturnType<typeof bindDatabaseEncodingTarget>;
/** 复用既有原Vitest结果/120秒sticky门，不因收尾或迟到回包重签期限。 */
export function databaseEncodingLifetime(context: QisContext, binding: DatabaseEncodingBinding, retain: () => void) { return qisLifetime(context, binding, retain); }
export type DatabaseEncodingLifetime = ReturnType<typeof databaseEncodingLifetime>;

/** 只读事实验证在任何CREATE之前完成；端口和已配置文字均不能代替实际服务器。 */
export function assertDatabaseEncodingIdentity(rows: unknown, binding: DatabaseEncodingBinding, status: ManagedConnection['status'], uuidRows?: unknown) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('数据库编码验收实际身份响应不完整');
  const row = rows[0] as Record<string, unknown>;
  if (row.hostname !== binding.hostname || String(row.serverId) !== binding.serverId || String(row.port) !== binding.serverPort || !['linux', 'debian-linux-gnu'].includes(String(row.os).toLowerCase()) || ![0, '0'].includes(row.lowerNames as number) || status.dialect !== binding.dialect || status.version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0] !== binding.version) throw Error('数据库编码验收实际hostname、版本、系统、大小写或server_id不符');
  if (binding.dialect === 'mysql' && (!Array.isArray(uuidRows) || uuidRows.length !== 1 || uuidRows[0]?.uuid !== binding.uuid)) throw Error('数据库编码验收实际MySQL UUID不符');
}

interface NativeStream { closed?: boolean; once(name: string, callback: () => void): unknown; }
interface Native { threadId: number; stream: NativeStream; query(...args: unknown[]): unknown; execute(...args: unknown[]): unknown; }
export interface DatabaseEncodingConnectionFact { managed: ManagedConnection; native: Native; stream: NativeStream; id: number; scope: string; pending: number; closeCalls: number; strict: boolean; closeReturned: boolean; closeFailed: boolean; closed: Promise<void>; sawClose: boolean; writes: string[]; }

/** 原方法真透传，只记原线程/流/回调；Engine写入只允许Root本例精确预览SQL。 */
export function watchDatabaseEncodingConnection(managed: ManagedConnection, scope: string, owner: DatabaseEncodingLifetime, allowedSql: () => string | undefined): DatabaseEncodingConnectionFact {
  const native = managed.connection as unknown as Native, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('数据库编码验收原生连接身份未知');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: DatabaseEncodingConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, writes: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check(); if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id || typeof args[0] !== 'string' || typeof args.at(-1) !== 'function') { owner.stop(); throw Error('数据库编码验收查询身份或回调漂移'); }
      const sql = args[0];
      if (/^(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|REPLACE|USE)\b/i.test(sql)) { fact.writes.push(sql); if (scope !== 'observer' && sql !== allowedSql()) { owner.stop(); throw Error('数据库编码Engine投递了未授权目标或非预览写入'); } }
      const callback = args.at(-1) as (...result: unknown[]) => unknown; fact.pending++; let settled = false;
      const finish = () => { if (!settled) { settled = true; fact.pending--; } };
      args[args.length - 1] = function (this: unknown, ...result: unknown[]) { try { return callback.apply(this, result); } finally { finish(); } };
      try { return original.apply(native, args); } catch (reason) { finish(); throw reason; }
    };
  }
  const close = managed.close.bind(managed);
  managed.close = async options => { fact.closeCalls++; fact.strict = options?.strict === true; try { await close(options); fact.closeReturned = true; } catch (reason) { fact.closeFailed = true; throw reason; } };
  return fact;
}
/** 未观察到原流close的Promise完成不代表资源释放；调用方先等待原fact.closed。 */
export function assertDatabaseEncodingReleased(facts: readonly DatabaseEncodingConnectionFact[], strict: boolean): void {
  if (facts.some(fact => fact.managed.connection !== fact.native as unknown || fact.native.stream !== fact.stream || fact.native.threadId !== fact.id || fact.pending !== 0 || fact.closeCalls !== 1 || strict && !fact.strict || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true)) throw Error('数据库编码验收原任务或原生流未完成严格收尾，保留现场');
}
/** observer也复用已有原流严格关闭门，任何失败不伪造线程消失。 */
export async function closeDatabaseEncodingObserver(observer: ManagedConnection) { await closeEmptyDefaultStream(observer.connection, () => observer.close({ strict: true })); }
