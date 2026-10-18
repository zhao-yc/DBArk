import { createHash } from 'node:crypto';
import { win32, posix } from 'node:path';
import { assertQueryFileNativeKeyApproval } from './query-file-native-key-protocol';
export { assertQueryFileNativeKeyApproval } from './query-file-native-key-protocol';

/** Root审核的是固定合成正文/路径配方，实际绝对路径只能由本run私有userdata派生。 */
export const queryFileNativeRecipe = Object.freeze({
  version: 1, directory: 'query-file-native-fixture', name: '关联保存-中文.sql', encoding: 'utf8', bom: 'utf8', eol: 'crlf', openSelections: 1, saveSelections: 0,
  initial: "SELECT '900719925474099312345', '中文😀';\n-- 初始合成文件，不执行\n",
  saved: "SELECT '900719925474099312345', '中文😀';\n-- 首次真实CtrlS写回\n",
  draft: "SELECT '900719925474099312345', '中文😀';\n-- 后续编辑必须保持\n",
  external: "SELECT '900719925474099312345', '外部合成😀';\n-- 外改冲突不得覆盖\n",
  restarted: "SELECT '900719925474099312345', '中文😀';\n-- 独立重启后真实保存\n",
} as const);
export type QueryFileNativeStage = 'initial' | 'saved' | 'draft' | 'external' | 'restarted';
/** 字节期望始终由固定配方产生，不从UI或当前文件反推；UTF-8 BOM与CRLF均逐字核对。 */
export function queryFileNativeBytes(stage: QueryFileNativeStage): Buffer { return Buffer.from('\ufeff' + queryFileNativeRecipe[stage].replaceAll('\n', '\r\n'), 'utf8'); }
/** 配方摘要独立于运行身份清单，须由Root显式核准，不能在运行时重新签名接受改动。 */
export function queryFileNativeRecipeHash(): string { return createHash('sha256').update(JSON.stringify(queryFileNativeRecipe)).digest('hex'); }
/** 默认与RAM模拟list只登记定义，不加载fixture/runtime、访问目录或触发端口预检。 */
export function queryFileNativeActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean { return env.DBARK_QUERY_FILE_NATIVE_TEST === '1' && !args.some(value => value === '--list' || value.startsWith('--list=')); }
/** 只接受独立身份与固定配方，沿已有危险环境规则，不伪造旧缩进/分栏开关。 */
export function assertQueryFileNativeEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (!['win32', 'darwin'].includes(platform)) throw Error('文件原生专项仅支持Windows/macOS');
  if (env.DBARK_QUERY_FILE_NATIVE_TEST !== '1' || env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('文件原生专项须独立门=1且integration=0');
  if (Object.keys(env).some(key => key.toUpperCase().startsWith('DBARK_QUERY_FILE_NATIVE_KEYS'))) assertQueryFileNativeKeyApproval(env, platform);
  for (const prefix of ['DBARK_EDITOR_INDENT', 'DBARK_QUERY_LAYOUT']) {
    if (Object.hasOwn(env, prefix + '_NATIVE_TEST') && env[prefix + '_NATIVE_TEST'] !== '0') throw Error('旧原生门必须关闭');
    if (Object.hasOwn(env, prefix + '_MANIFEST') || Object.hasOwn(env, prefix + '_MANIFEST_SHA256')) throw Error('文件专项只能使用独立批准清单');
  }
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if ((normalized.startsWith('DBARK_') || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(normalized)) && key !== normalized) throw Error('文件原生专项拒绝大小写环境别名');
    if (['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) throw Error('文件原生专项拒绝外部renderer、用户目录或预加载环境');
    const alias = key === 'DBARK_C02_EXECUTABLE_PATH' && !!env.DBARK_EXECUTABLE_PATH && env[key] === env.DBARK_EXECUTABLE_PATH;
    if (!alias && /^DBARK_(?:TEST_|C02_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|SECRET|CERT|CA_PATH|PRIVATE_KEY)/.test(key)) throw Error('文件原生专项拒绝实库或认证参数，空值同样拒绝');
  }
  const path = platform === 'win32' ? win32 : posix;
  if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !path.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口必须为非空绝对路径');
  if (!env.DBARK_QUERY_FILE_MANIFEST || !path.isAbsolute(env.DBARK_QUERY_FILE_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_QUERY_FILE_MANIFEST_SHA256 ?? '')) throw Error('文件专项须Root批准的独立绝对清单和SHA256');
  if (env.DBARK_QUERY_FILE_FIXTURE_SHA256 !== queryFileNativeRecipeHash()) throw Error('文件专项须Root批准的固定fixture配方摘要');
  for (const [index, value] of args.entries()) {
    if (value === '--config' || value === '-c' || value.startsWith('--config=') || /^-c./.test(value) || ['--ui', '--debug'].includes(value)) throw Error('文件原生专项拒绝CLI替换配置或交互运行器');
    if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('文件原生专项禁止开启trace');
  }
}
/** 环境或配方摘要出现一次漂移即永久停链，不能恢复原字符串后继续领取资源。 */
export function bindQueryFileNativeEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const value = read(); assertQueryFileNativeEnvironment(value.env, value.args, value.platform); return JSON.stringify([value.platform, value.args, Object.keys(value.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, value.env[key]])]); };
  const original = signature(); let retained = false;
  return { assertCurrent() { if (retained) throw Error('文件原生专项配置已失效，保留资源'); try { if (signature() !== original) throw Error('文件原生专项配置漂移'); } catch (reason) { retained = true; throw reason; } } };
}
