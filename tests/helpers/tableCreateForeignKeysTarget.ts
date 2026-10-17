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
