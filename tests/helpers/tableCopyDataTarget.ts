import { tableCopyStructureTarget } from './tableCopyStructureTarget';

type Environment = Record<string, string | undefined>;
const keys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;

/** 本轮身份在注册时固定；空密码是显式值，目标、UUID和凭据不能由原型或默认值回填。 */
export function bindTableCopyDataTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const key of keys) {
    if (key === 'DBARK_TEST_TLS' && !Object.hasOwn(raw, key) && !Object.hasOwn(helper, key)) continue;
    if (!Object.hasOwn(raw, key) || !Object.hasOwn(helper, key) || typeof raw[key] !== 'string' || raw[key] !== helper[key]) throw Error('结构及数据复制验收缺少本轮显式一致配置');
  }
  const profile = tableCopyStructureTarget('mysql84', raw, helper);
  const fixed = Object.freeze(Object.fromEntries(keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]])));
  const helperOwn = keys.map(key => Object.hasOwn(helper, key));
  const target = Object.freeze({ host: fixed.DBARK_TEST_HOST!, port: profile.port, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, uuid: fixed.DBARK_TEST_EXPECTED_SERVER_UUID! });
  let changed = false;
  return Object.freeze({ target, assertCurrent() {
    if (changed) throw Error('结构及数据复制验收本轮身份或配置已变化，保留现场');
    const current = readRaw();
    for (const [index, key] of keys.entries()) {
      if (Object.hasOwn(current, key) !== Object.hasOwn(fixed, key) || current[key] !== fixed[key] || Object.hasOwn(helper, key) !== helperOwn[index] || helper[key] !== fixed[key]) {
        changed = true; throw Error('结构及数据复制验收本轮身份或配置已变化，保留现场');
      }
    }
  } });
}
