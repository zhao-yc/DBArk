import { tableCreatePreparationProfile } from '../../src/shared/tableCreateProfiles';

type Environment = Readonly<Record<string, string | undefined>>;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validUuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && uuidPattern.test(value);
const names = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;
export interface TableCreateMysql80Target {
  readonly host: '192.168.31.200'; readonly port: 13380; readonly tls: false;
  readonly serverUuid: string;
}

/** 原始凭据须自有属性且显式提供；helper不能回填或替换，显式空密码仍合法。返回值不含凭据。 */
export function tableCreateMysql80Target(raw: Environment, environment: Environment): Readonly<TableCreateMysql80Target> {
  for (const name of names) {
    if (!Object.hasOwn(raw, name) || !Object.hasOwn(environment, name) || typeof raw[name] !== 'string' || raw[name] !== environment[name]) throw Error('新建表8.0.46原始目标或显式凭据与helper不一致；未连接、未创建隔离库');
  }
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13380' || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER?.trim() || !validUuid(raw.DBARK_TEST_EXPECTED_SERVER_UUID)) throw Error('新建表8.0.46仅准备200明文13380及Root明确绑定UUID和账号');
  return Object.freeze({ host: '192.168.31.200', port: 13380, tls: false, serverUuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID! });
}

/** 一次完整只读事实必须准确匹配；缺项/目录形状未知不拼接默认值、不借8.4证据放行。 */
export function assertTableCreateMysql80Facts(rows: unknown, target: TableCreateMysql80Target): void {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('新建表8.0.46服务器事实不完整');
  const row = rows[0] as Record<string, unknown>;
  if (['dialect', 'version', 'os', 'names', 'uuid'].some(name => !Object.hasOwn(row, name)) || typeof row.dialect !== 'string' || typeof row.version !== 'string' || typeof row.os !== 'string') throw Error('新建表8.0.46服务器事实字段未知');
  const profile = tableCreatePreparationProfile(row.dialect, row.version);
  if (!profile.canReadFacts || profile.state !== 'prepared' || !validUuid(row.uuid) || row.uuid !== target.serverUuid || !['linux', 'debian-linux-gnu'].includes(String(row.os).toLowerCase()) || ![0, '0'].includes(row.names as number)) throw Error('新建表8.0.46实际版本、OS、名称模式或Root UUID不一致；未创建隔离库');
}

/** 仅供准备反例及后续接线复用；本片没有任何真实端口适配器，也不提供执行DDL的端口。 */
export interface TableCreateMysql80PreparationPorts {
  assertCurrent(): void;
  retain(): void;
  openReadonly(target: Readonly<TableCreateMysql80Target>, credentials: Readonly<{ user: string; password: string }>): Promise<{
    readFacts(): Promise<unknown>;
    closeStrict(): Promise<void>;
  }>;
}

/** 归属、读取、严格收尾任一未知即保留并停链；准备结果始终不可写，取消ACK不能替代closeStrict。 */
export async function prepareTableCreateMysql80(raw: Environment, environment: Environment, ports: TableCreateMysql80PreparationPorts) {
  const target = tableCreateMysql80Target(raw, environment);
  // 首await前固定已校验的凭据，仅给未来只读适配器；结果与错误文案均不返回凭据。
  const credentials = Object.freeze({ user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD! });
  const retain = () => { try { ports.retain(); } catch { /* 保留失败不能覆盖首因。 */ } };
  const current = () => { try { ports.assertCurrent(); } catch (reason) { retain(); throw reason; } };
  current();
  let connection: Awaited<ReturnType<TableCreateMysql80PreparationPorts['openReadonly']>>;
  try { connection = await ports.openReadonly(target, credentials); current(); } catch (reason) { retain(); throw reason; }
  let rows: unknown;
  try { current(); rows = await connection.readFacts(); current(); } catch (reason) { retain(); throw reason; }
  let mismatch: unknown;
  try { assertTableCreateMysql80Facts(rows, target); } catch (reason) { mismatch = reason; }
  try { current(); await connection.closeStrict(); current(); }
  catch (reason) { retain(); if (mismatch) throw new AggregateError([mismatch, reason], '原身份预检失败且严格收尾未知', { cause: mismatch }); throw reason; }
  if (mismatch) throw mismatch;
  return Object.freeze({ profile: tableCreatePreparationProfile('mysql', String((rows as Record<string, unknown>[])[0].version)), target, resourcesReleased: true as const, canWrite: false as const });
}
