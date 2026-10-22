import type { ConnectionProfile } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { qisLifetime, type QisContext } from './queryInsertIntegration';
import { closeEmptyDefaultStream } from './tableCreateEmptyDefault';

export const databaseDropGate = 'DBARK_DATABASE_DROP_TEST';
const versions = { '13357': ['mysql', '5.7.44'], '13380': ['mysql', '8.0.46'], '13384': ['mysql', '8.4.11'], '13310': ['mariadb', '10.11.19'], '13311': ['mariadb', '11.4.13'], '13484': ['mysql', '8.4.11'] } as const;
type Environment = Record<string, string | undefined>;

/** 只在测试体内读取明确双门和六实例身份，不加载凭据文件或用其它专项开关补本门。 */
export function bindDatabaseDropTarget(read: () => Environment, id: string) {
  const raw = read(), port = raw.DBARK_TEST_PORT;
  if (!port || !Object.hasOwn(versions, port)) throw Error('删除数据库验收没有准确隔离端口');
  const [dialect, version] = versions[port as keyof typeof versions];
  const keys = ['DBARK_INTEGRATION_ENABLED', databaseDropGate, 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID', 'DBARK_TEST_EXPECTED_SERVER_PORT', ...(dialect === 'mysql' ? ['DBARK_TEST_EXPECTED_SERVER_UUID'] : []), ...(port === '13484' ? ['DBARK_TEST_CA'] : [])];
  if (keys.some(key => !Object.hasOwn(raw, key) || typeof raw[key] !== 'string') || raw.DBARK_INTEGRATION_ENABLED !== '1' || raw[databaseDropGate] !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(raw.DBARK_TEST_HOST!) || !raw.DBARK_TEST_USER || !raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME || !/^\d{1,10}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_ID!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_ID) > 4294967295 || !/^[1-9]\d{0,4}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_PORT!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_PORT) > 65535 || raw.DBARK_TEST_TLS !== (port === '13484' ? '1' : '0') || port === '13484' && !raw.DBARK_TEST_CA!.trim() || dialect === 'mysql' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)) throw Error('删除数据库验收目标、身份或严格TLS未显式准备');
  const forbidden = ['DBARK_TEST_SSH', 'DBARK_TEST_CERT', 'DBARK_TEST_KEY', 'DBARK_TEST_DATABASE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'DBARK_DATABASE_DEFAULT_ENCODING_TEST', 'DBARK_TABLE_RENAME_MATRIX_TEST'];
  if (forbidden.some(key => Object.hasOwn(raw, key) && raw[key] !== undefined && raw[key] !== '' && !(key === 'DBARK_TEST_SSH' && raw[key] === '0'))) throw Error('删除数据库验收存在旁路、其它专项开关或非本例数据库配置');
  const all = [...new Set([...keys, ...forbidden])], fixed = all.map(key => [key, Object.hasOwn(raw, key), raw[key]] as const); let retained = false;
  const assertCurrent = () => { const value = read(); if (retained || fixed.some(([key, own, expected]) => Object.hasOwn(value, key) !== own || value[key] !== expected)) { retained = true; throw Error('删除数据库验收配置漂移，保留原现场'); } };
  const profile: ConnectionProfile = Object.freeze({ id, name: '删除数据库隔离验收', group: '', color: '#123456', dialect, host: raw.DBARK_TEST_HOST!, port: Number(port), user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD!, ...(port === '13484' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: raw.DBARK_TEST_CA! } } : {}) });
  return { profile, dialect, version, hostname: raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME!, serverId: raw.DBARK_TEST_EXPECTED_SERVER_ID!, serverPort: raw.DBARK_TEST_EXPECTED_SERVER_PORT!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID, assertCurrent };
}
export type DatabaseDropBinding = ReturnType<typeof bindDatabaseDropTarget>;
/** 沿用真实Vitest起点和120秒sticky owner，收尾不得续签期限、重试或后台继续动作。 */
export function databaseDropLifetime(context: QisContext, binding: DatabaseDropBinding, retain: () => void) { return qisLifetime(context, binding, retain); }
export type DatabaseDropLifetime = ReturnType<typeof databaseDropLifetime>;

/** 先加载旁观connect模块，再载入真实Engine，默认与list路径不导入live模块。 */
export async function loadDatabaseDropModules() { const connection = await import('../../src/engine/connection'); const engine = await import('../../src/engine/index'); return { connection, engine }; }
/** 创建任何资源之前核对原会话的实际身份、Linux精确名称映射和严格TLS配置。 */
export function assertDatabaseDropIdentity(rows: unknown, binding: DatabaseDropBinding, status: ManagedConnection['status'], uuidRows?: unknown): void {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('删除数据库验收实际身份响应不完整');
  const row = rows[0] as Record<string, unknown>;
  if (row.hostname !== binding.hostname || String(row.serverId) !== binding.serverId || String(row.port) !== binding.serverPort || !['linux', 'debian-linux-gnu'].includes(String(row.os).toLowerCase()) || ![0, '0'].includes(row.lowerNames as number) || status.dialect !== binding.dialect || status.version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0] !== binding.version) throw Error('删除数据库验收实际hostname、版本、系统、大小写或server_id不符');
  if (binding.dialect === 'mysql' && (!Array.isArray(uuidRows) || uuidRows.length !== 1 || uuidRows[0]?.uuid !== binding.uuid)) throw Error('删除数据库验收实际MySQL UUID不符');
}

interface NativeStream { closed?: boolean; once(name: string, callback: () => void): unknown; }
interface Native { threadId: number; stream: NativeStream; query(...args: unknown[]): unknown; execute(...args: unknown[]): unknown; }
export interface DatabaseDropConnectionFact { managed: ManagedConnection; native: Native; stream: NativeStream; id: number; scope: string; pending: number; closeCalls: number; strict: boolean; closeReturned: boolean; closeFailed: boolean; closed: Promise<void>; sawClose: boolean; writes: string[]; }

/** 原方法真透传；仅本次允许的精确DROP可从Engine发出，拒绝ALTER/RENAME/CALL等替代写入。 */
export function watchDatabaseDropConnection(managed: ManagedConnection, scope: string, owner: DatabaseDropLifetime, allowedSql: () => string | undefined): DatabaseDropConnectionFact {
  const native = managed.connection as unknown as Native, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('删除数据库验收原生连接身份未知');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: DatabaseDropConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, writes: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check(); if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id || typeof args[0] !== 'string' || typeof args.at(-1) !== 'function') { owner.stop(); throw Error('删除数据库验收查询身份或回调漂移'); }
      const sql = args[0];
      if (/^(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|REPLACE|USE|RENAME|TRUNCATE|CALL|DO|LOAD|LOCK|UNLOCK|KILL|GRANT|REVOKE)\b/i.test(sql)) {
        fact.writes.push(sql);
        if (scope !== 'observer' && (sql !== allowedSql() || !/^DROP DATABASE `(?:[^`]|``)+`;$/u.test(sql) || fact.writes.length !== 1)) { owner.stop(); throw Error('删除数据库Engine投递了非本轮精确单次预览DROP'); }
      } else if (scope !== 'observer' && !/^(?:SELECT\s|SHOW\s|SET SESSION (?:sql_mode\s*=|sql_quote_show_create\s*=|foreign_key_checks\s*=|show_gipk_in_create_table_and_information_schema\s*=)|SET NAMES utf8mb4 COLLATE utf8mb4_bin\s*$)/i.test(sql)) { owner.stop(); throw Error('删除数据库Engine投递了未审计语句'); }
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
/** 原查询回调、原严格关闭及原物理流close必须都完成，不能把Promise完成视为真实释放。 */
export function assertDatabaseDropReleased(facts: readonly DatabaseDropConnectionFact[], strict: boolean): void {
  if (facts.some(fact => fact.managed.connection !== fact.native as unknown || fact.native.stream !== fact.stream || fact.native.threadId !== fact.id || fact.pending !== 0 || fact.closeCalls !== 1 || strict && !fact.strict || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true)) throw Error('删除数据库验收原任务或原生流未完成严格收尾，保留现场');
}
/** observer也等待原物理流关闭；失败不伪造原线程消失。 */
export async function closeDatabaseDropObserver(observer: ManagedConnection) { await closeEmptyDefaultStream(observer.connection, () => observer.close({ strict: true })); }
