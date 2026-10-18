import { bindEditorIndentNativeCase, type IndentNativeTestInfo } from '../e2e/editor-indentation-native-gate';

export const v027RunGate = 'DBARK_V027_NATIVE_ACCEPTANCE';
export const v027ServerUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
export const v027Build = '50626ec69cc20df699c9073a29640510ef6bf36c';
export const v027CaseNames = ['0.27 CSV分隔符、映射失效与正式文件导入', '0.27 新表时间属性、前缀索引与单次CREATE'] as const;
/** 仅回答一次准确的返回草稿确认；真实按钮、草稿及DDL控制流不替换，调用时恢复原函数。 */
export function v027DraftConfirmation(expected: string) {
  const gate = { original: window.confirm, calls: 0, replacement: undefined as unknown as typeof window.confirm };
  gate.replacement = message => {
    if (window.confirm !== gate.replacement || gate.calls !== 0 || message !== expected) throw Error('0.27返回草稿确认提示或回答归属未知');
    gate.calls++; window.confirm = gate.original; return true;
  };
  window.confirm = gate.replacement; return gate;
}
/** list先返回，不访问任何环境值；默认只读两道开关，不碰凭据或live模块。 */
export function v027Active(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env[v027RunGate] === '1' && env.DBARK_INTEGRATION_ENABLED === '1';
}
const keys = [v027RunGate, 'DBARK_INTEGRATION_ENABLED', 'DBARK_V027_RUN_NONCE', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_V027_PRODUCT_BUILD', 'DBARK_V027_LAUNCH_MANIFEST', 'DBARK_V027_LAUNCH_SHA256', 'DBARK_EXECUTABLE_PATH'] as const;
/** 只收Root本轮显式环境，绝不读取.env、推断账号或替换目标；漂移后恢复也不能复活。 */
export function bindV027Target(read: () => Record<string, string | undefined>) {
  const raw = read();
  if (keys.some(key => key !== 'DBARK_EXECUTABLE_PATH' && !Object.hasOwn(raw, key)) || !v027Active(raw, []) || raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0' || raw.DBARK_TEST_EXPECTED_SERVER_UUID !== v027ServerUuid || raw.DBARK_V027_PRODUCT_BUILD !== v027Build || !/^[a-f0-9]{32}$/.test(raw.DBARK_V027_RUN_NONCE ?? '') || !raw.DBARK_TEST_USER || !Object.hasOwn(raw, 'DBARK_TEST_PASSWORD') || typeof raw.DBARK_TEST_PASSWORD !== 'string' || !raw.DBARK_V027_LAUNCH_MANIFEST || !/^[a-f0-9]{64}$/.test(raw.DBARK_V027_LAUNCH_SHA256 ?? '')) throw Error('0.27验收缺少Root本轮准确目标、构建或身份清单');
  const fixed = keys.map(key => [key, Object.hasOwn(raw, key), raw[key]] as const); let invalid = false;
  const check = () => {
    const current = read();
    const aliases = Object.keys(current).some(key => /^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase());
    if (invalid || aliases || fixed.some(([key, own, value]) => Object.hasOwn(current, key) !== own || current[key] !== value) || ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].some(key => Object.hasOwn(current, key))) { invalid = true; throw Error('0.27验收目标或启动环境变化，保留现场'); }
  };
  check();
  return { target: Object.freeze({ host: '192.168.31.200', port: 13384, user: raw.DBARK_TEST_USER, password: raw.DBARK_TEST_PASSWORD, uuid: v027ServerUuid, nonce: raw.DBARK_V027_RUN_NONCE, manifest: raw.DBARK_V027_LAUNCH_MANIFEST, sha256: raw.DBARK_V027_LAUNCH_SHA256! }), assertCurrent: check };
}

/** 沿已有原TestInfo/120秒门；正文结束后迟到动作无权继续，fixture仅保留原正常退出收尾。 */
export function v027Lifetime(info: IndentNativeTestInfo, binding: { assertCurrent(): void }, current: () => IndentNativeTestInfo, retain: () => void, now?: () => number) {
  const original = bindEditorIndentNativeCase(info, binding, current, now); let retained = false, bodyEnded = false, complete = false, pending = false;
  const stop = () => { retained = true; original.retain(); retain(); };
  const check = (fixture = false) => { try { original.assertCurrent(); if (retained || !fixture && bodyEnded) throw Error('0.27本例已停链或正文结束'); } catch (reason) { stop(); throw reason; } };
  return {
    check, stop,
    async step<T>(action: () => Promise<T>, fixture = false): Promise<T> {
      check(fixture); if (pending) { stop(); throw Error('0.27同一owner已有未结束动作'); } pending = true;
      try { const value = await action(); check(fixture); return value; } catch (reason) { stop(); throw reason; } finally { pending = false; }
    },
    finish() { check(); if (pending) { stop(); throw Error('0.27收尾仍有挂起动作'); } complete = true; },
    endBody() { bodyEnded = true; if (!complete || pending) stop(); },
    fixtureEnd() { try { check(true); if (!complete || pending) throw Error('0.27未完成原正常退出与精确清理'); } finally { bodyEnded = true; original.retain(); } },
    get snapshot() { return { retained, bodyEnded, complete, pending }; },
  };
}

/** 名字在首次写前固定并登记；只允许本case的合成资源，不接受外部数据库名。 */
export function v027Resources(kind: 'csv' | 'time', nonce: string, caseHash: string) {
  if (!/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(caseHash)) throw Error('0.27资源nonce或原case身份无效');
  return Object.freeze({ version: 1, kind, nonce, caseHash, schema: `dbark_v027_${kind}_${nonce}`, tables: kind === 'csv' ? ['__v027_owner', 'csv_target', 'neighbor'] : ['__v027_owner', 'time_defaults', 'neighbor'], files: kind === 'csv' ? [0, 1, 2].map(index => `v027_${nonce}_${index}.csv`) : [], expectedBuild: v027Build, serverUuid: v027ServerUuid });
}

export const v027CsvColumns = ['id', 'amount', 'nullable_text', 'empty_text', 'payload', 'note'] as const;
/** 固定小样本只作真实外部文件输入；不调用产品CSV编码器为产品结果自证。 */
export function v027CsvInput(delimiter: ',' | ';' | '\t', batch: number): { body: string; expected: Record<string, unknown>[] } {
  if (![',', ';', '\t'].includes(delimiter) || !Number.isInteger(batch) || batch < 0 || batch > 2) throw Error('0.27 CSV样本参数无效');
  const expected = [0, 1].map(row => ({ id: (18446744073709550000n + BigInt(batch * 10 + row)).toString(), amount: row ? '-123456789012345678.123456789012' : '123456789012345678.123456789012', nullable_text: row ? '\\N' : null, empty_text: '', payload: row ? '00FF10' : '0001FF', note: `第${batch}组${row}行,分号;Tab\t双引号"与\r\n换行🚢` }));
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const records = expected.map(row => [row.id, row.amount, row.nullable_text === null ? '\\N' : '\\\\N', '', 'base64:' + (row.payload === '00FF10' ? 'AP8Q' : 'AAH/'), row.note]);
  return { body: [v027CsvColumns, ...records].map(record => record.map(value => quote(String(value))).join(delimiter)).join('\r\n') + '\r\n', expected };
}
