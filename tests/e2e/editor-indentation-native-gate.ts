import { win32, posix } from 'node:path';

export const editorIndentNativeGate = 'DBARK_EDITOR_INDENT_NATIVE_TEST';
/** 列表与默认关闭只登记定义，不能读取目录、探测端口或加载桌面owner。 */
export function editorIndentNativeActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env[editorIndentNativeGate] === '1';
}
/** 固定离线环境只接受正式源码/安装入口；大小写别名、实库、认证和录制覆盖均拒绝。 */
export function assertEditorIndentNativeEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (!['win32', 'darwin'].includes(platform)) throw Error('缩进原生专项仅支持Windows/macOS');
  if (env[editorIndentNativeGate] !== '1' || env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('缩进原生专项须独立门=1且integration=0');
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if ((normalized.startsWith('DBARK_') || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(normalized)) && key !== normalized) throw Error('缩进原生专项拒绝大小写环境别名');
    if (['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) throw Error('缩进原生专项拒绝外部renderer、用户目录或预加载环境');
    const alias = key === 'DBARK_C02_EXECUTABLE_PATH' && !!env.DBARK_EXECUTABLE_PATH && env[key] === env.DBARK_EXECUTABLE_PATH;
    if (!alias && /^DBARK_(?:TEST_|C02_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|SECRET|CERT|CA_PATH|PRIVATE_KEY)/.test(key)) throw Error('缩进原生专项拒绝实库或认证参数，空值同样拒绝');
  }
  if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH')) {
    const path = env.DBARK_EXECUTABLE_PATH;
    if (!path || !(platform === 'win32' ? win32 : posix).isAbsolute(path)) throw Error('缩进原生专项安装路径必须为非空绝对路径');
  }
  for (const [index, value] of args.entries()) {
    if (value === '--config' || value === '-c' || value.startsWith('--config=') || /^-c./.test(value) || ['--ui', '--debug'].includes(value)) throw Error('缩进原生专项拒绝CLI替换配置或交互运行器');
    if ((value === '--trace' && args[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('缩进原生专项禁止开启trace');
  }
}
/** 捕获声明时配置，每次资源操作前后复核；观察到漂移后即使改回也永久停链。 */
export function bindEditorIndentNativeEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const value = read(); assertEditorIndentNativeEnvironment(value.env, value.args, value.platform); return JSON.stringify([value.platform, value.args, Object.keys(value.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, value.env[key]])]); };
  const original = signature(); let retained = false;
  return { assertCurrent() { if (retained) throw Error('缩进原生专项配置已失效，保留本例资源'); try { if (signature() !== original) throw Error('缩进原生专项配置漂移'); } catch (reason) { retained = true; throw reason; } } };
}
