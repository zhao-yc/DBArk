import { posix, win32 } from 'node:path';

export const queryFilesNativeCases = ['最近SQL文件明确重开、取消和失效保持及独立重启', '来源文件UTF16LE保存、外改拒绝与重读新草稿及独立重启'] as const;
const gate = 'DBARK_SQL_FILES_NATIVE_TEST', approval = 'DBARK_SQL_FILES_NATIVE_APPROVED';
/** 默认/list先短路；不读取清单、凭据、owner或端口，也不以单个字符串代替批准清单。 */
export function queryFilesNativeActive(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && Object.getOwnPropertyDescriptor(env, gate)?.value === '1' && Object.getOwnPropertyDescriptor(env, approval)?.value === '1';
}
/** 只接受本专项明确环境；真正启动身份仍由原manifest字节/完整集合与实际Main来源门证明。 */
export function bindQueryFilesNativeEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  function inspect() {
    const { env, args, platform } = read(), paths = platform === 'win32' ? win32 : posix;
    if (!['win32', 'darwin'].includes(platform) || !queryFilesNativeActive(env, args) || env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('SQL文件专项须双门=1、integration=0及Windows/macOS');
    const allowed = [gate, approval, 'DBARK_INTEGRATION_ENABLED', 'DBARK_SQL_FILES_MANIFEST', 'DBARK_SQL_FILES_MANIFEST_SHA256', 'DBARK_EXECUTABLE_PATH'];
    const values: [string, string][] = [];
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
      if (!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)) continue;
      if (!allowed.includes(key) || !('value' in descriptor) || typeof descriptor.value !== 'string') throw Error('SQL文件专项拒绝外部入口、认证参数、预加载、其他门及大小写别名');
      values.push([key, descriptor.value]);
    }
    if (!env.DBARK_SQL_FILES_MANIFEST || !paths.isAbsolute(env.DBARK_SQL_FILES_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_SQL_FILES_MANIFEST_SHA256 ?? '')) throw Error('必须提供Root未来批准的绝对清单及原SHA256');
    if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !paths.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装路径须为非空绝对路径');
    for (const [index, value] of args.entries()) {
      if (value === '--config' || value === '-c' || value.startsWith('--config=') || /^-c./.test(value) || ['--ui', '--debug'].includes(value)) throw Error('SQL文件专项拒绝替换配置或交互运行器');
      for (const option of ['trace', 'screenshot', 'video']) if (value === '--' + option && args[index + 1] !== 'off' || value.startsWith('--' + option + '=') && value !== '--' + option + '=off') throw Error('SQL文件专项禁止录制覆盖');
    }
    return { signature: JSON.stringify([platform, args, values.sort(([a], [b]) => a.localeCompare(b))]), manifestPath: env.DBARK_SQL_FILES_MANIFEST, approvedHash: env.DBARK_SQL_FILES_MANIFEST_SHA256! };
  }
  const original = inspect(); let retained = false;
  return Object.freeze({ approval: Object.freeze({ manifestPath: original.manifestPath, approvedHash: original.approvedHash }), assertCurrent() { try { if (retained || inspect().signature !== original.signature) throw Error('SQL文件专项原环境已失效'); } catch (reason) { retained = true; throw reason; } } });
}
