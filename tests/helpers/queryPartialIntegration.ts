import type { NetworkConnectionProfile as ConnectionProfile, QueryOutcome } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { qisLifetime, type QisContext } from './queryInsertIntegration';
import { assertDatabaseEncodingIdentity } from './databaseDefaultEncodingIntegration';
import { closeEmptyDefaultStream } from './tableCreateEmptyDefault';

export const queryPartialGate = 'DBARK_QUERY_PARTIAL_TEST';
const versions = { '13357': ['mysql', '5.7.44'], '13380': ['mysql', '8.0.46'], '13384': ['mysql', '8.4.11'], '13310': ['mariadb', '10.11.19'], '13311': ['mariadb', '11.4.13'], '13484': ['mysql', '8.4.11'] } as const;
/** list与关闭门只读开关，不接触密码、CA文件或引擎。 */
export function queryPartialEnabled(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env[queryPartialGate] === '1';
}
/** 六个隔离实例均要求显式实际身份；TLS仅13484且严格验证，不接SSH及环境旁路。 */
export function bindQueryPartialTarget(read: () => NodeJS.ProcessEnv, id: string) {
  const capture = () => {
    const env = read(), descriptors = Object.getOwnPropertyDescriptors(env), port = descriptors.DBARK_TEST_PORT?.value as string | undefined;
    if (!port || !Object.hasOwn(versions, port)) throw Error('部分查询验收缺少准确隔离端口');
    const [dialect, version] = versions[port as keyof typeof versions];
    const keys = ['DBARK_INTEGRATION_ENABLED', queryPartialGate, 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID', 'DBARK_TEST_EXPECTED_SERVER_PORT', ...(dialect === 'mysql' ? ['DBARK_TEST_EXPECTED_SERVER_UUID'] : []), ...(port === '13484' ? ['DBARK_TEST_CA'] : [])];
    const actual = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key));
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('部分查询验收拒绝额外认证、大小写别名或旁路参数');
    const value = (key: string): string => descriptors[key].value;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value(queryPartialGate) !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(value('DBARK_TEST_HOST')) || !value('DBARK_TEST_USER') || !value('DBARK_TEST_EXPECTED_SERVER_HOSTNAME') || !/^\d{1,10}$/.test(value('DBARK_TEST_EXPECTED_SERVER_ID')) || Number(value('DBARK_TEST_EXPECTED_SERVER_ID')) > 4294967295 || !/^[1-9]\d{0,4}$/.test(value('DBARK_TEST_EXPECTED_SERVER_PORT')) || Number(value('DBARK_TEST_EXPECTED_SERVER_PORT')) > 65535 || value('DBARK_TEST_TLS') !== (port === '13484' ? '1' : '0') || port === '13484' && !value('DBARK_TEST_CA').trim() || dialect === 'mysql' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value('DBARK_TEST_EXPECTED_SERVER_UUID'))) throw Error('部分查询验收目标、身份或严格TLS不完整');
    return { signature: JSON.stringify(keys.sort().map(key => [key, value(key)])), port, dialect, version, env: Object.fromEntries(keys.map(key => [key, value(key)])) };
  };
  const original = capture(); let retained = false;
  const assertCurrent = () => { if (retained) throw Error('部分查询原配置已永久停链'); try { if (capture().signature !== original.signature) throw Error('部分查询原配置已变化'); } catch (error) { retained = true; throw error; } };
  const env = original.env;
  const profile: ConnectionProfile = Object.freeze({ id, name: '首错保留完整前序隔离验收', group: '', color: '', dialect: original.dialect, host: env.DBARK_TEST_HOST, port: Number(original.port), user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, ...(original.port === '13484' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA } } : {}) });
  return { profile, dialect: original.dialect, version: original.version, hostname: env.DBARK_TEST_EXPECTED_SERVER_HOSTNAME, serverId: env.DBARK_TEST_EXPECTED_SERVER_ID, serverPort: env.DBARK_TEST_EXPECTED_SERVER_PORT, uuid: env.DBARK_TEST_EXPECTED_SERVER_UUID, assertCurrent };
}
export type QueryPartialBinding = ReturnType<typeof bindQueryPartialTarget>;
export function queryPartialLifetime(context: QisContext, binding: QueryPartialBinding, retain: () => void) { return qisLifetime(context, binding, retain); }
export type QueryPartialLifetime = ReturnType<typeof queryPartialLifetime>;
/** 先完成connect的真实旁观模块，再显式载入Engine，不并行导入目录模块。 */
export async function loadQueryPartialModules() { const connection = await import('../../src/engine/connection'); const engine = await import('../../src/engine/index'); return { connection, engine }; }
export const assertQueryPartialIdentity = assertDatabaseEncodingIdentity;

interface Stream { closed?: boolean; once(name: string, callback: (...args: any[]) => void): unknown; }
interface Query { on(name: string, callback: (...args: any[]) => void): Query; once(name: string, callback: (...args: any[]) => void): Query; }
interface Native { threadId: number; stream: Stream; query(...args: any[]): Query; execute(...args: any[]): Query; }
export interface QueryPartialCommandFact {
  sql: string; query?: Query; callback: boolean; callbackCalls: number; terminal: Promise<void>; ended: boolean;
  fields: number; rows: number; status: number; errors: { code?: string; errno?: number; message: string }[];
}
export interface QueryPartialConnectionFact {
  managed: ManagedConnection; native: Native; stream: Stream; id: number; scope: string; pending: number; commands: QueryPartialCommandFact[];
  closeCalls: number; closeReturned: boolean; closeFailed: boolean; sawClose: boolean; closed: Promise<void>; tailsBlocked: number;
}
export interface QueryPartialSqlPlan { allowed: ReadonlySet<string>; forbiddenTails: ReadonlySet<string>; }
/** 原query对象、callback的this/实参及所有事件完全透传；只在原end终包后结算，不补发语句。 */
export function watchQueryPartialConnection(managed: ManagedConnection, scope: string, owner: Pick<QueryPartialLifetime, 'check' | 'stop'>, plan: () => QueryPartialSqlPlan): QueryPartialConnectionFact {
  const native = managed.connection as unknown as Native, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId <= 0) throw Error('部分查询原线程或流未知');
  let closed!: () => void;
  const fact: QueryPartialConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, commands: [], closeCalls: 0, closeReturned: false, closeFailed: false, sawClose: false, closed: new Promise(resolve => { closed = resolve; }), tailsBlocked: 0 };
  stream.once('close', () => { fact.sawClose = true; closed(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...incoming: unknown[]) {
      owner.check();
      if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id) { owner.stop(); throw Error('部分查询原会话身份变化'); }
      const first = incoming[0], descriptor = first && typeof first === 'object' ? Object.getOwnPropertyDescriptor(first, 'sql') : undefined;
      const sql = typeof first === 'string' ? first : descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      if (typeof sql !== 'string') { owner.stop(); throw Error('部分查询拒绝未知query调用形状'); }
      const current = plan();
      if (current.forbiddenTails.has(sql)) { fact.tailsBlocked++; owner.stop(); throw Error('首错后的禁止尾句被请求；已在原驱动前阻断并保留现场'); }
      if (!current.allowed.has(sql)) { owner.stop(); throw Error('部分查询发出了计划外SQL，原驱动未调用'); }
      let ended!: () => void;
      const command: QueryPartialCommandFact = { sql, callback: typeof incoming.at(-1) === 'function', callbackCalls: 0, terminal: new Promise(resolve => { ended = resolve; }), ended: false, fields: 0, rows: 0, status: 0, errors: [] };
      fact.commands.push(command); fact.pending++;
      const args = [...incoming];
      if (command.callback) {
        const callback = args.at(-1) as (...args: unknown[]) => unknown;
        args[args.length - 1] = function (this: unknown, ...values: unknown[]) { command.callbackCalls++; return callback.apply(this, values); };
      }
      const finish = () => { if (!command.ended) { command.ended = true; fact.pending--; ended(); } };
      try {
        const query = original.apply(native, args); command.query = query;
        if (!query || typeof query.once !== 'function' || typeof query.on !== 'function') { owner.stop(); throw Error('部分查询原驱动没有返回原query对象'); }
        query.on('fields', (fields: unknown) => { if (fields !== undefined) command.fields++; });
        query.on('result', (row: unknown) => { if (Array.isArray(row)) command.rows++; else command.status++; });
        query.on('error', (error: { code?: string; errno?: number; message?: string }) => { command.errors.push({ code: error.code, errno: error.errno, message: error.message ?? '' }); });
        query.once('end', finish); return query;
      } catch (error) { finish(); throw error; }
    };
  }
  const originalClose = managed.close;
  managed.close = async function (options) { fact.closeCalls++; try { await originalClose.call(this, options); fact.closeReturned = true; } catch (error) { fact.closeFailed = true; throw error; } };
  return fact;
}
/** 会话存续与任务终态分开核对；单条脚本返回不能被当作整个会话已关闭。 */
export function assertQueryPartialCommands(facts: readonly QueryPartialConnectionFact[]): void {
  if (facts.some(fact => fact.managed.connection !== fact.native as unknown || fact.native.stream !== fact.stream || fact.native.threadId !== fact.id || fact.pending || fact.tailsBlocked || fact.commands.some(command => !command.ended || command.callback && command.callbackCalls !== 1))) throw Error('部分查询原query终包或原会话身份尚未确认');
}
/** 所有原raw stream.closed和资源facade都必须确认，不能拿end或新连接替代。 */
export function assertQueryPartialClosed(facts: readonly QueryPartialConnectionFact[]): void {
  assertQueryPartialCommands(facts);
  if (facts.some(fact => fact.closeCalls !== 1 || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true || fact.managed.resources?.snapshot().confirmedClosed !== true)) throw Error('部分查询原连接及物理资源未全部关闭');
}
export async function closeQueryPartialObserver(observer: ManagedConnection) { await closeEmptyDefaultStream(observer.connection, () => observer.close({ strict: true })); }

/** 精度期望由固定文字定义，不能调用产品序列化器自证。 */
export const queryPartialValues = Object.freeze({ big: '18446744073709551615', signed: '-9223372036854775808', decimal: '-12345678901234567890123456789012345.123456789012345678901234567890', happened: '2026-10-22 01:02:03.123456', note: "中文😀'\"\\\0\r\n", blobHex: '00ff805c27', parameter: '仅合成参数不进入错误摘要_中文😀' });
/** 只验证prefix中的完整精度行与重复alias，失败语句的结果不得混入。 */
export function verifyQueryPartialPrecision(outcome: QueryOutcome, expectedResults: number): void {
  if (outcome.results.length !== expectedResults) throw Error('首错回包混入不完整语句或丢失完整前序结果');
  const result = outcome.results[0], row = result.rows[0], v = queryPartialValues;
  if (result.truncated || result.rows.length !== 1 || result.columns.map(column => column.name).join('|') !== 'repeated|repeated|amount|happened|note|nullable_value|payload' || result.columns.map(column => column.key).join('|') !== 'c0|c1|c2|c3|c4|c5|c6' || JSON.stringify(row) !== JSON.stringify({ c0: v.big, c1: v.signed, c2: v.decimal, c3: v.happened, c4: v.note, c5: null, c6: { type: 'binary', base64: 'AP+AXCc=' } })) throw Error('完整前序结果精度、重复列、NULL或BLOB不符');
}
