import { posix, win32 } from 'node:path';

export const shortcutNativeCase = '单次Ctrl或Cmd加S：被动事件分层、UTF16LE来源完整保存及独立重启';
const gate = 'DBARK_QUERY_FILE_SHORTCUT_NATIVE_TEST', approval = 'DBARK_QUERY_FILE_SHORTCUT_NATIVE_APPROVED';
/** 默认/list先短路，访问器也不读取；声明阶段不能加载runtime/清单/凭据或预检端口。 */
export function shortcutNativeActive(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && Object.getOwnPropertyDescriptor(env, gate)?.value === '1' && Object.getOwnPropertyDescriptor(env, approval)?.value === '1';
}
/** 独立批准门仅传原manifest参数；真正完整树和Main来源仍由原严格runtime核验。 */
export function bindShortcutNativeEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  function inspect() {
    const { env, args, platform } = read(), paths = platform === 'win32' ? win32 : posix;
    if (!['win32', 'darwin'].includes(platform) || !shortcutNativeActive(env, args) || Object.getOwnPropertyDescriptor(env, 'DBARK_INTEGRATION_ENABLED')?.value !== '0') throw Error('文件保存快捷键专项须双门、integration=0及Windows/macOS');
    const allowed = [gate, approval, 'DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_FILE_SHORTCUT_MANIFEST', 'DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256', 'DBARK_EXECUTABLE_PATH'];
    const values: [string, string][] = [];
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
      if (!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)) continue;
      if (!allowed.includes(key) || !('value' in property) || typeof property.value !== 'string') throw Error('文件保存快捷键专项拒绝其他门、认证、外部入口、预加载及大小写别名'); values.push([key, property.value]);
    }
    if (!env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST || !paths.isAbsolute(env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256 ?? '')) throw Error('缺少Root未来批准的绝对清单及原SHA256');
    if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !paths.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口须为绝对路径');
    for (const [index, value] of args.entries()) {
      if (['--config', '-c', '--ui', '--debug'].includes(value.split('=')[0]) || /^-c./.test(value)) throw Error('文件保存快捷键专项拒绝配置或交互覆盖');
      for (const option of ['trace', 'screenshot', 'video']) if (value === '--' + option && args[index + 1] !== 'off' || value.startsWith('--' + option + '=') && value !== '--' + option + '=off') throw Error('文件保存快捷键专项禁止录制');
    }
    return { signature: JSON.stringify([platform, args, values.sort(([a], [b]) => a.localeCompare(b))]), manifestPath: env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST, approvedHash: env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256! };
  }
  const original = inspect(); let retained = false;
  return Object.freeze({ approval: Object.freeze({ manifestPath: original.manifestPath, approvedHash: original.approvedHash }), assertCurrent() { try { if (retained || inspect().signature !== original.signature) throw Error('文件保存快捷键原环境已失效'); } catch (reason) { retained = true; throw reason; } } });
}
