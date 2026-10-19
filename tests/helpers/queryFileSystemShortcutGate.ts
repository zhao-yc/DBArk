import { win32 } from 'node:path';

export const systemShortcutCase = '单次系统Ctrl+S：Root原生输入、UTF16LE来源完整保存及独立重启';
const gate = 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_TEST', approval = 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_APPROVED';
/** 默认/list只登记，不读目录、清单、live或进程；访问器不构成批准。 */
export function systemShortcutActive(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && Object.getOwnPropertyDescriptor(env, gate)?.value === '1' && Object.getOwnPropertyDescriptor(env, approval)?.value === '1';
}
/** 手工系统输入只接受本clone固定nonce目录；不允许参数指定任意ready/ack文件。 */
export function bindSystemShortcutEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string; cwd: string }) {
  function inspect() {
    const { env, args, platform, cwd } = read();
    const ci = Object.getOwnPropertyDescriptor(env, 'CI');
    if (platform !== 'win32' || !systemShortcutActive(env, args) || Object.getOwnPropertyDescriptor(env, 'DBARK_INTEGRATION_ENABLED')?.value !== '0' || ci && (!Object.hasOwn(ci, 'value') || ci.value)) throw Error('系统快捷键须Windows本地手工双批准门、integration=0，禁止CI执行');
    const allowed = [gate, approval, 'DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST', 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST_SHA256', 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE', 'DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE', 'DBARK_EXECUTABLE_PATH'];
    const values: [string, string][] = [];
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
      if (!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)) continue;
      if (!allowed.includes(key) || !('value' in property) || typeof property.value !== 'string') throw Error('系统快捷键拒绝其它门、认证、预加载、访问器或大小写别名');
      values.push([key, property.value]);
    }
    const nonce = env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE, directory = env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce ?? '') || !/^[A-Za-z]:\\/.test(cwd) || win32.resolve(cwd) !== cwd || directory !== win32.join(cwd, '.cache', 'system-shortcut-handshake', nonce!)) throw Error('系统握手须Root预批的本clone规范绝对nonce目录');
    const manifestPath = env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST, approvedHash = env.DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST_SHA256;
    if (!manifestPath || !win32.isAbsolute(manifestPath) || !/^[a-f0-9]{64}$/.test(approvedHash ?? '')) throw Error('系统快捷键缺少Root批准的原清单及SHA256');
    if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !win32.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口须为绝对路径');
    for (const [index, value] of args.entries()) {
      if (['--config', '-c', '--ui', '--debug'].includes(value.split('=')[0]) || /^-c./.test(value)) throw Error('系统快捷键拒绝配置或交互运行器覆盖');
      for (const option of ['trace', 'screenshot', 'video']) if (value === '--' + option && args[index + 1] !== 'off' || value.startsWith('--' + option + '=') && value !== '--' + option + '=off') throw Error('系统快捷键禁止Playwright录制');
    }
    return { signature: JSON.stringify([platform, cwd, ci?.value, args, values.sort(([a], [b]) => a.localeCompare(b))]), manifestPath, approvedHash: approvedHash!, nonce: nonce!, directory: directory!, cwd };
  }
  const original = inspect(); let retained = false;
  return Object.freeze({
    approval: Object.freeze({ manifestPath: original.manifestPath, approvedHash: original.approvedHash }),
    handshake: Object.freeze({ nonce: original.nonce, directory: original.directory, cwd: original.cwd }),
    assertCurrent() { try { if (retained || inspect().signature !== original.signature) throw Error('系统快捷键原环境已失效'); } catch (reason) { retained = true; throw reason; } },
  });
}
