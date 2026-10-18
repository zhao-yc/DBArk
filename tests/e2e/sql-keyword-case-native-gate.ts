import { win32, posix } from 'node:path';

export const sqlKeywordCaseNativeGate = 'DBARK_SQL_KEYWORD_CASE_NATIVE_TEST';
/** 默认和列表只登记用例，不加载owner/runtime、读取文件或触发原端口预检。 */
export function sqlKeywordCaseNativeActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env[sqlKeywordCaseNativeGate] === '1';
}
/** 独立关键字大小写门沿原危险环境规则，直接使用自己的清单，不伪造旧缩进门=1。 */
export function assertSqlKeywordCaseNativeEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (!['win32', 'darwin'].includes(platform)) throw Error('关键字大小写原生专项仅支持Windows/macOS');
  if (env[sqlKeywordCaseNativeGate] !== '1' || env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('关键字大小写原生专项须独立门=1且integration=0');
  if (Object.hasOwn(env, 'DBARK_EDITOR_INDENT_NATIVE_TEST') && env.DBARK_EDITOR_INDENT_NATIVE_TEST !== '0') throw Error('旧缩进原生门必须关闭');
  if ((Object.hasOwn(env, 'DBARK_QUERY_LAYOUT_NATIVE_TEST') && env.DBARK_QUERY_LAYOUT_NATIVE_TEST !== '0') || Object.hasOwn(env, 'DBARK_QUERY_LAYOUT_MANIFEST') || Object.hasOwn(env, 'DBARK_QUERY_LAYOUT_MANIFEST_SHA256')) throw Error('关键字专项拒绝分栏开关或清单');
  if (Object.hasOwn(env, 'DBARK_EDITOR_INDENT_MANIFEST') || Object.hasOwn(env, 'DBARK_EDITOR_INDENT_MANIFEST_SHA256')) throw Error('关键字大小写专项只能使用独立批准清单');
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if ((normalized.startsWith('DBARK_') || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(normalized)) && key !== normalized) throw Error('关键字大小写原生专项拒绝大小写环境别名');
    if (['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) throw Error('关键字大小写原生专项拒绝外部renderer、用户目录或预加载环境');
    const alias = key === 'DBARK_C02_EXECUTABLE_PATH' && !!env.DBARK_EXECUTABLE_PATH && env[key] === env.DBARK_EXECUTABLE_PATH;
    if (!alias && /^DBARK_(?:TEST_|C02_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|SECRET|CERT|CA_PATH|PRIVATE_KEY)/.test(key)) throw Error('关键字大小写原生专项拒绝实库或认证参数，空值同样拒绝');
  }
  const path = platform === 'win32' ? win32 : posix;
  if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !path.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口必须为非空绝对路径');
  if (!env.DBARK_SQL_KEYWORD_CASE_MANIFEST || !path.isAbsolute(env.DBARK_SQL_KEYWORD_CASE_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256 ?? '')) throw Error('关键字大小写专项须Root批准的独立绝对清单和SHA256');
  for (const [index, value] of args.entries()) {
    if (value === '--config' || value === '-c' || value.startsWith('--config=') || /^-c./.test(value) || ['--ui', '--debug'].includes(value.split('=')[0])) throw Error('关键字大小写原生专项拒绝CLI替换配置或交互运行器');
    if ((value === '--trace' && args[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('关键字大小写原生专项禁止开启trace');
  }
}
/** 声明阶段捕获配置，观察到任何一次漂移便停链，即使恢复原字符串也不复活。 */
export function bindSqlKeywordCaseNativeEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const value = read(); assertSqlKeywordCaseNativeEnvironment(value.env, value.args, value.platform); return JSON.stringify([value.platform, value.args, Object.keys(value.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, value.env[key]])]); };
  const original = signature(); let retained = false;
  return { assertCurrent() { if (retained) throw Error('关键字大小写原生专项配置已失效，保留资源'); try { if (signature() !== original) throw Error('关键字大小写原生专项配置漂移'); } catch (reason) { retained = true; throw reason; } } };
}
