import { posix, win32 } from 'node:path';

const gate = 'DBARK_FILE_FIRST_MODEL_NATIVE_TEST', approved = 'DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED';
/** 默认/list先短路，只看数据属性，禁止声明阶段触发访问器或原生模块。 */
export function fileFirstModelActive(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && Object.getOwnPropertyDescriptor(env, gate)?.value === '1' && Object.getOwnPropertyDescriptor(env, approved)?.value === '1';
}
/** 独立双门只消费Root未来批准，不创建清单，不复用旧R1900或其他专项开关。 */
export function bindFileFirstModelEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  /** 每次复核同一声明环境，拒绝访问器及其他资源入口，不触碰清单内容。 */
  function inspect() {
    const { env, args, platform } = read(), paths = platform === 'win32' ? win32 : posix;
    if (!['win32', 'darwin'].includes(platform) || !fileFirstModelActive(env, args) || Object.getOwnPropertyDescriptor(env, 'DBARK_INTEGRATION_ENABLED')?.value !== '0') throw Error('文件首次模型专项须独立双门、integration=0和Windows/macOS');
    const allowed = [gate, approved, 'DBARK_INTEGRATION_ENABLED', 'DBARK_FILE_FIRST_MODEL_MANIFEST', 'DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256', 'DBARK_EXECUTABLE_PATH'];
    const values: [string, string][] = [];
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
      if (!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)) continue;
      if (!allowed.includes(key) || !('value' in descriptor) || typeof descriptor.value !== 'string') throw Error('文件首次模型拒绝其他门、认证、预加载、外部入口或大小写别名');
      values.push([key, descriptor.value]);
    }
    if (!env.DBARK_FILE_FIRST_MODEL_MANIFEST || !paths.isAbsolute(env.DBARK_FILE_FIRST_MODEL_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256 ?? '')) throw Error('缺少Root未来批准的绝对清单和原SHA256');
    if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !paths.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口须为绝对路径');
    for (const [index, value] of args.entries()) {
      if (['--config', '-c', '--ui', '--debug'].includes(value.split('=')[0]) || /^-c./.test(value)) throw Error('文件首次模型拒绝配置或交互覆盖');
      for (const option of ['trace', 'screenshot', 'video']) if (value === '--' + option && args[index + 1] !== 'off' || value.startsWith('--' + option + '=') && value !== '--' + option + '=off') throw Error('文件首次模型禁止录制');
    }
    return { signature: JSON.stringify([platform, args, values.sort(([a], [b]) => a.localeCompare(b))]), manifestPath: env.DBARK_FILE_FIRST_MODEL_MANIFEST, approvedHash: env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256! };
  }
  const original = inspect(); let retained = false;
  return Object.freeze({ approval: Object.freeze({ manifestPath: original.manifestPath, approvedHash: original.approvedHash }), assertCurrent() { try { if (retained || inspect().signature !== original.signature) throw Error('文件首次模型原环境已失效'); } catch (reason) { retained = true; throw reason; } } });
}
