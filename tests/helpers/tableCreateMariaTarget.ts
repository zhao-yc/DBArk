import { definitionOmittingSqlModes } from '../../src/shared/tableColumnPatches';
type Environment = Record<string, string | undefined>;
export type MariaCreateVersion = '10.11.19' | '11.4.13';
export const mariaCreateKeys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID'] as const;
const ports = { '10.11.19': '13310', '11.4.13': '13311' } as const;
/** 原始认证与helper必须为自有且一致的字符串；空密码明确合法，不从文件或默认账号补齐。 */
export function bindTableCreateMariaTarget(version: MariaCreateVersion, readRaw: () => Environment, helper: Environment) {
  if (!Object.hasOwn(ports, version)) throw Error('Maria新建表准确版本未知');
  const raw = readRaw();
  for (const key of mariaCreateKeys) if (!Object.hasOwn(raw, key) || !Object.hasOwn(helper, key) || typeof raw[key] !== 'string' || raw[key] !== helper[key]) throw Error('Maria新建表缺少本轮显式一致配置');
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== ports[version] || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER || !raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME || !/^[1-9]\d{0,9}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_ID!) || BigInt(raw.DBARK_TEST_EXPECTED_SERVER_ID!) > 4294967295n) throw Error('Maria新建表验收准确目标尚未准备');
  const fixed = Object.freeze(Object.fromEntries(mariaCreateKeys.map(key => [key, raw[key]])));
  const target = Object.freeze({ version, host: fixed.DBARK_TEST_HOST!, port: Number(ports[version]), user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, hostname: fixed.DBARK_TEST_EXPECTED_SERVER_HOSTNAME!, serverId: fixed.DBARK_TEST_EXPECTED_SERVER_ID! });
  let changed = false;
  return { target, assertCurrent() {
    if (changed) throw Error('Maria新建表本轮目标已变化，保留现场');
    const current = readRaw();
    for (const key of mariaCreateKeys) if (!Object.hasOwn(current, key) || !Object.hasOwn(helper, key) || current[key] !== fixed[key] || helper[key] !== fixed[key]) { changed = true; throw Error('Maria新建表本轮目标已变化，保留现场'); }
  } };
}
export const mariaCreateFactSql = 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@hostname AS hostname,@@port AS serverPort,@@server_id AS serverId,@@SESSION.sql_mode AS mode,@@SESSION.autocommit AS autocommit,@@innodb_strict_mode AS innodbStrict,@@sql_quote_show_create AS quoteShowCreate';
/** 只返回本轮RAM指纹；不把hostname/server_id的组合称为持久全局身份，不读取MySQL UUID/GIPK。 */
export function assertMariaCreateFacts(rows: unknown, target: ReturnType<typeof bindTableCreateMariaTarget>['target']): string {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('Maria新建表能力事实形状未知');
  const row = rows[0] as Record<string, unknown>;
  if (['version', 'os', 'names', 'hostname', 'serverPort', 'serverId', 'mode', 'autocommit', 'innodbStrict', 'quoteShowCreate'].some(key => !Object.hasOwn(row, key))) throw Error('Maria新建表能力事实不完整');
  // target.port是固定发布/代理连接端口；真实监听端口必须独立已知，不默认3306或拿外部值补齐。
  if (!['number', 'string'].includes(typeof row.serverPort) || !/^[1-9]\d{0,4}$/.test(String(row.serverPort)) || Number(row.serverPort) > 65535) throw Error('Maria服务端真实监听端口未知');
  const serverPort = String(row.serverPort);
  const version = String(row.version).replace(/^5\.5\.5-/, ''), expected = target.version.replaceAll('.', '\\.');
  if (typeof row.version !== 'string' || !new RegExp('^' + expected + '-MariaDB(?:[-+][^\\s]+)?$', 'i').test(version) || typeof row.os !== 'string' || !['linux', 'debian-linux-gnu'].includes(row.os.toLowerCase()) || ![0, '0'].includes(row.names as number) || row.hostname !== target.hostname || ![Number(target.serverId), target.serverId].includes(row.serverId as number) || typeof row.mode !== 'string' || !/^[A-Z0-9_,]+$/i.test(row.mode) || row.mode.split(',').some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode.toUpperCase()) || !['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES', 'ERROR_FOR_DIVISION_BY_ZERO', 'NO_AUTO_CREATE_USER', 'NO_ENGINE_SUBSTITUTION', 'ONLY_FULL_GROUP_BY', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE', 'NO_BACKSLASH_ESCAPES'].includes(mode.toUpperCase())) || ![1, '1'].includes(row.autocommit as number) || ![1, '1'].includes(row.innodbStrict as number) || ![1, '1'].includes(row.quoteShowCreate as number)) throw Error('Maria新建表本轮版本、指纹或普通建表能力未知');
  return JSON.stringify([row.version, row.os, row.names, row.hostname, serverPort, row.serverId, row.mode, row.autocommit, row.innodbStrict, row.quoteShowCreate]);
}
