export type TableCopyStructureTargetKey = 'mysql84' | 'mysql80';
type Environment = Record<string, string | undefined>;
const mysql84 = Object.freeze({ version: '8.4.11', port: 13384, versionPattern: /^8\.4\.11(?:[-+].*)?$/ });
const mysql80 = Object.freeze({ version: '8.0.46', port: 13380, versionPattern: /^8\.0\.46(?:[-+].*)?$/ });

/** 未来正式例只接受Root显式指定的准确端口和UUID；不使用helper默认目标或原型属性。 */
export function tableCopyStructureTarget(key: TableCopyStructureTargetKey, raw: Environment, environment: Environment) {
  const profile = key === 'mysql84' ? mysql84 : key === 'mysql80' ? mysql80 : undefined;
  if (!profile) throw Error('未准备该复制结构版本');
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== String(profile.port) || ![undefined, '0'].includes(raw.DBARK_TEST_TLS)) throw Error('复制结构UI须显式绑定200明文准确版本端口');
  for (const name of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const) {
    if (raw[name] !== environment[name]) throw Error('复制结构原始目标与helper配置不一致');
  }
  if (!environment.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('须Root提供已有测试账号并先核对、绑定本轮服务器UUID');
  return profile;
}
