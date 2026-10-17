type Environment = Record<string, string | undefined>;
/** 只允许Root本轮显式指定的明文8.4.11实例；认证值仅用于连接，不进入错误或报告。 */
export function tableCreateForeignKeysTarget(raw: Environment, helper: Environment) {
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const) {
    if (!Object.hasOwn(raw, key) || typeof raw[key] !== 'string') throw Error('复合外键验收缺少本轮显式配置');
    if (!Object.hasOwn(helper, key) || raw[key] !== helper[key]) throw Error('复合外键验收原始配置与helper不一致');
  }
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || ![undefined, '0'].includes(raw.DBARK_TEST_TLS) || raw.DBARK_TEST_TLS !== helper.DBARK_TEST_TLS) throw Error('复合外键验收目标未准备');
  if (!raw.DBARK_TEST_USER!.length || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)) throw Error('复合外键验收账号或服务器绑定无效');
  return Object.freeze({ host: raw.DBARK_TEST_HOST, port: 13384, user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID! });
}

/** 本轮授权固定在注册时；每次读取实时raw和helper，任何身份变化都不能重绑定旧用例。 */
export function bindTableCreateForeignKeysTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw(), keys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_TLS'] as const;
  const target = tableCreateForeignKeysTarget(raw, helper), fixed = Object.freeze(Object.fromEntries(keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]])));
  const helperOwn = keys.map(key => Object.hasOwn(helper, key));
  let changed = false;
  return Object.freeze({ target, assertCurrent() {
    if (changed) throw Error('复合外键验收本轮身份或配置已变化，保留现场');
    const current = readRaw();
    try {
      for (const [index, key] of keys.entries()) if (Object.hasOwn(current, key) !== Object.hasOwn(fixed, key) || current[key] !== fixed[key] || Object.hasOwn(helper, key) !== helperOwn[index] || helper[key] !== fixed[key]) throw Error('身份变化');
      tableCreateForeignKeysTarget(fixed, helper);
    } catch { changed = true; throw Error('复合外键验收本轮身份或配置已变化，保留现场'); }
  } });
}
