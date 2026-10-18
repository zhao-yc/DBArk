import type { ConnectionProfile } from '../../src/shared/contracts';
import { qisLifetime, qisUsingHandle } from './queryInsertIntegration';

export const qcsvGate = 'DBARK_QUERY_CSV_INTEGRATION_ENABLED';
export const qcsvUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
export const qcsvCases = Object.freeze((['csv', 'csv-zip'] as const).flatMap(format => (['utf8', 'utf16le', 'gb18030'] as const).flatMap(encoding => (['default', 'semicolon', 'tab'] as const).map(separator => Object.freeze({ id: `${format}/${encoding}/${separator}`, format, encoding, separator, delimiter: separator === 'default' ? ',' as const : separator === 'semicolon' ? ';' as const : '\t' as const })))));
export type QcsvCase = typeof qcsvCases[number];
export const qcsvColumns = ['id', 'signed_value', 'amount', 'happened', 'clock_value', 'nullable_text', 'empty_text', 'slash_text', 'punctuation', 'payload', 'doc'] as const;
export const qcsvHeaders = ['无符号,大数', '有符号;大数', '精确\t小数', '微秒日期', '微秒时间', '可空', '空串', '首斜线', '标点,;\t"\r\n', '二进制', 'JSON大整数'] as const;
export const qcsvEmptyHeader = '空行集,;\t"\r\n';

/** list先于所有环境getter；收集阶段仅看双门，不加载live或读取凭据。 */
export function qcsvEnabled(env: Record<string, string | undefined>, argv: readonly string[]) { return !argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env[qcsvGate] === '1'; }
const keys = ['DBARK_INTEGRATION_ENABLED', qcsvGate, 'DBARK_QCSV_RUN_NONCE', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;
/** 本轮准确200目标，没有.env、默认账号或旧授权回退；配置漂移后永不复活。 */
export function bindQcsvTarget(read: () => Record<string, string | undefined>, id: string) {
  const env = read();
  if (keys.some(key => !Object.hasOwn(env, key)) || !qcsvEnabled(env, []) || env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || env.DBARK_TEST_EXPECTED_SERVER_UUID !== qcsvUuid || !/^[a-f0-9]{32}$/.test(env.DBARK_QCSV_RUN_NONCE ?? '')) throw Error('QCSV缺少Root本轮准确目标或显式凭据');
  const fixed = keys.map(key => [key, env[key]] as const); let retained = false;
  const assertCurrent = () => {
    try {
      const current = read();
      if (retained || fixed.some(([key, value]) => !Object.hasOwn(current, key) || current[key] !== value) || Object.keys(current).some(key => /^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase() || /^(DBARK_TEST_(?:SSH|CA|CERT|KEY)|DBARK_DEV_URL$|DBARK_USER_DATA$|DBARK_EXECUTABLE_PATH$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key))) throw Error('QCSV目标或环境漂移，保留现场');
    } catch (reason) { retained = true; throw reason; }
  };
  assertCurrent();
  const profile: ConnectionProfile = Object.freeze({ id, name: '完整CSV后台隔离验收准备', group: '', color: '', dialect: 'mysql', host: '192.168.31.200', port: 13384, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD });
  return { profile, runNonce: env.DBARK_QCSV_RUN_NONCE!, assertCurrent };
}

/** 原Vitest3.2.7 task.result.startTime/120秒sticky门及原句柄finally合同直接复用，不重签期限或扩大旧授权。 */
export const qcsvLifetime = qisLifetime;
export const qcsvUsingHandle = qisUsingHandle;

/** 单例随机库、目录、目标及partial规则在写前登记；只接受18个已声明场景对象。 */
export function qcsvPlan(scenario: QcsvCase, nonce: string, caseHash: string) {
  if (!qcsvCases.includes(scenario) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(caseHash)) throw Error('QCSV资源计划身份无效');
  return Object.freeze({ version: 1, caseId: scenario.id, nonce, caseHash, database: 'dbark_qcsv_' + nonce, tables: Object.freeze(['__qcsv_owner', 'source', 'neighbor']), directory: 'dbark-qcsv-' + nonce, file: 'qcsv-' + nonce + (scenario.format === 'csv' ? '.csv' : '.zip'), serverUuid: qcsvUuid });
}

/** 手工样本与独立CAST/HEX预期；不经过产品导出器或数值JSON.parse。 */
export function qcsvRows() {
  return Array.from({ length: 301 }, (_, index) => {
    const id = (18446744073709550000n + BigInt(index)).toString(), signed = (-9223372036854775808n + BigInt(index)).toString();
    const amount = (index % 2 ? '-' : '') + '12345678901234567890123456789012345.123456789012345678901234567890';
    const happened = '2026-10-18 01:02:03.' + String(index).padStart(6, '0'), clock = (index % 2 ? '-' : '') + '12:34:56.123456';
    const nullable = index % 3 === 0 ? null : index % 3 === 1 ? '' : 'NULL', slash = index % 2 ? '\\开头\\文本' : '\\N', punctuation = `第${index}行 中文😀'"\r\n逗,号;Tab\t末`;
    const payload = index % 3 === 0 ? null : index % 3 === 1 ? Buffer.alloc(0) : Buffer.from('0001ff805c27', 'hex');
    const doc = index % 3 === 0 ? null : index % 3 === 1 ? 'null' : `{"n":18446744073709551615,"i":${index},"text":"中文😀"}`;
    return { values: [id, signed, amount, happened, clock, nullable, '', slash, punctuation, payload, doc], expected: { id, signed_value: signed, amount, happened, clock_value: clock, nullable_text: nullable, empty_text: '', slash_hex: Buffer.from(slash).toString('hex').toUpperCase(), punctuation_hex: Buffer.from(punctuation).toString('hex').toUpperCase(), payload_hex: payload === null ? null : payload.toString('hex').toUpperCase(), doc_kind: index % 3 === 0 ? null : index % 3 === 1 ? 'NULL' : 'OBJECT', doc_n: index % 3 === 2 ? '18446744073709551615' : null } };
  });
}

/** 只从独立SQL投影恢复CSV协议字段；CSV文法由独立csv-stringify/parse校验。 */
export function qcsvExpectedFields(row: Record<string, any>): string[] {
  const decode = (hex: string) => Buffer.from(hex, 'hex').toString('utf8');
  const slash = decode(row.slash_hex);
  return [row.id, row.signed_value, row.amount, row.happened, row.clock_value, row.nullable_text === null ? '\\N' : row.nullable_text, row.empty_text, '\\' + slash, decode(row.punctuation_hex), row.payload_hex === null ? '\\N' : 'base64:' + Buffer.from(row.payload_hex, 'hex').toString('base64'), row.doc_hex === null ? '\\N' : decode(row.doc_hex)];
}
