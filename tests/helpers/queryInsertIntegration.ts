import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { emptyDefaultGuard } from './tableCreateEmptyDefault';

export const qisGate = 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED';
export const qisUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
export const qisCases = ['utf8', 'utf16le', 'gb18030', 'cancel', 'session-close', 'multi-result'] as const;
export type QisCase = typeof qisCases[number];
export const qisColumns = ['id', 'signed_value', 'amount', 'happened', 'clock_value', 'nullable_text', 'note', 'payload', 'doc'] as const;
/** list先于环境读取；默认只看双开关，不碰凭据或live模块。 */
export function qisEnabled(env: Record<string, string | undefined>, argv: readonly string[]) { return !argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env[qisGate] === '1'; }

const targetKeys = ['DBARK_INTEGRATION_ENABLED', qisGate, 'DBARK_QIS_RUN_NONCE', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;
/** 本轮显式200目标，绝不补账号、读.env或接纳SSH/TLS旁路；漂移后不复活。 */
export function bindQisTarget(read: () => Record<string, string | undefined>, id: string) {
  const env = read();
  if (targetKeys.some(key => !Object.hasOwn(env, key)) || !qisEnabled(env, []) || env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || env.DBARK_TEST_EXPECTED_SERVER_UUID !== qisUuid || !/^[a-f0-9]{32}$/.test(env.DBARK_QIS_RUN_NONCE ?? '')) throw Error('QIS缺少Root本轮准确目标或显式凭据');
  const fixed = targetKeys.map(key => [key, env[key]] as const); let retained = false;
  const assertCurrent = () => {
    const current = read();
    if (retained || fixed.some(([key, value]) => !Object.hasOwn(current, key) || current[key] !== value) || Object.keys(current).some(key => /^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase() || /^(DBARK_TEST_(?:SSH|CA|CERT|KEY)|DBARK_DEV_URL$|DBARK_USER_DATA$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key))) { retained = true; throw Error('QIS目标或环境漂移，保留现场'); }
  };
  assertCurrent();
  const profile: ConnectionProfile = Object.freeze({ id, name: '完整INSERT后台隔离准备', group: '', color: '', dialect: 'mysql', host: '192.168.31.200', port: 13384, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD });
  return { profile, runNonce: env.DBARK_QIS_RUN_NONCE!, assertCurrent };
}

export interface QisContext { task: { id: string; timeout: number; retry?: number; repeats?: number; concurrent?: boolean; result?: { startTime?: number; state?: string; retryCount?: number; repeatCount?: number } } }
/** 复用原sticky guard，期限来自Vitest实际result.startTime；不在收尾重签120秒。 */
export function qisLifetime(context: QisContext, binding: { assertCurrent(): void }, retain: () => void, now = () => Date.now()) {
  const task = context.task, result = task.result, start = result?.startTime, timeout = task.timeout; let ended = false, previous = now();
  const guard = emptyDefaultGuard({ now, retain, assertCurrent() {
    const instant = now(); binding.assertCurrent();
    if (ended || context.task !== task || task.result !== result || task.timeout !== timeout || timeout !== 120000 || task.concurrent || !result || result.startTime !== start || result.state !== 'run' || (task.retry ?? 0) !== 0 || (task.repeats ?? 0) !== 0 || (result.retryCount ?? 0) !== 0 || (result.repeatCount ?? 0) !== 0 || !Number.isFinite(start) || !Number.isFinite(instant) || instant < start! || instant < previous) throw Error('QIS原任务、时钟或120秒期限失效');
    previous = instant;
  } }, typeof start === 'number' ? start + 120000 : NaN);
  return { check: guard.check, stop: guard.stop, get state() { return guard.state; }, async step<T>(action: () => Promise<T>): Promise<T> { if (guard.state.pending) { guard.stop(); throw Error('QIS同一owner已有前台动作'); } return guard.run(action); }, finish: guard.finish, end() { ended = true; if (guard.state.active) guard.stop(); } };
}

/** 只接受本case随机身份；目标/目录/partial规则在任何资源创建前登记。 */
export function qisPlan(kind: QisCase, nonce: string, caseHash: string) {
  if (!qisCases.includes(kind) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(caseHash)) throw Error('QIS资源计划身份无效');
  return Object.freeze({ version: 1, kind, nonce, caseHash, database: 'dbark_qis_' + nonce, tables: ['__qis_owner', 'source', 'target', 'neighbor'], directory: 'dbark-qis-' + nonce, file: `qis-${nonce}-${kind}.sql`, serverUuid: qisUuid });
}

/** 独立手工造数，不使用导出器/SQL生成器生产期望；数值与日期始终是精确文本。 */
export function qisRows() {
  return Array.from({ length: 301 }, (_, index) => {
    const id = (18446744073709550000n + BigInt(index)).toString(), signed = (-9223372036854775808n + BigInt(index)).toString();
    const amount = (index % 2 ? '-' : '') + '12345678901234567890123456789012345.123456789012345678901234567890';
    const happened = '2026-10-18 01:02:03.' + String(index).padStart(6, '0'), clock = (index % 2 ? '-' : '') + '12:34:56.123456';
    const nullable = index % 3 === 0 ? null : index % 3 === 1 ? '' : 'NULL', note = `第${index}行 中文😀'"\\\0\r\n;-- \\N`;
    const payload = index % 3 === 0 ? null : index % 3 === 1 ? Buffer.alloc(0) : Buffer.from('0001ff805c27', 'hex');
    const doc = index % 3 === 0 ? null : index % 3 === 1 ? 'null' : `{"n":18446744073709551615,"i":${index},"text":"中文😀"}`;
    return { values: [id, signed, amount, happened, clock, nullable, note, payload, doc], expected: { id, signed_value: signed, amount, happened, clock_value: clock, nullable_text: nullable, note_hex: Buffer.from(note).toString('hex').toUpperCase(), payload_hex: payload === null ? null : payload.toString('hex').toUpperCase(), doc_kind: index % 3 === 0 ? null : index % 3 === 1 ? 'NULL' : 'OBJECT', doc_n: index % 3 === 2 ? '18446744073709551615' : null } };
  });
}

/** 取得句柄后所有检查都在finally范围；关闭失败不掩盖首因，迟到仅释放原句柄。 */
export async function qisUsingHandle<T>(handle: { close(): Promise<void> }, action: () => Promise<T>) {
  let failed = false, original: unknown;
  try { return await action(); } catch (reason) { failed = true; original = reason; throw reason; }
  finally { try { await handle.close(); } catch (closing) { if (failed) throw new AggregateError([original, closing], 'QIS原动作与原句柄关闭均失败', { cause: original }); throw closing; } }
}
