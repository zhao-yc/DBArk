type Environment = Record<string, string | undefined>;
const keys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;
/** 独立用途只接受Root本轮显式明文5.7.44目标；注册固定身份，等待中变化后不可重绑定。 */
export function bindTableCreateMysql57Target(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const key of keys) if (!Object.hasOwn(raw, key) || !Object.hasOwn(helper, key) || typeof raw[key] !== 'string' || raw[key] !== helper[key]) throw Error('新表5.7.44验收缺少本轮显式一致配置');
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13357' || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)) throw Error('新表5.7.44验收目标尚未准备');
  const fixed = Object.freeze(Object.fromEntries(keys.map(key => [key, raw[key]])));
  const target = Object.freeze({ host: fixed.DBARK_TEST_HOST!, port: 13357, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, uuid: fixed.DBARK_TEST_EXPECTED_SERVER_UUID! });
  let changed = false;
  return { target, assertCurrent() {
    if (changed) throw Error('新表5.7.44验收身份已变化，保留现场');
    const current = readRaw();
    for (const key of keys) if (!Object.hasOwn(current, key) || !Object.hasOwn(helper, key) || current[key] !== fixed[key] || helper[key] !== fixed[key]) { changed = true; throw Error('新表5.7.44验收身份已变化，保留现场'); }
  } };
}
