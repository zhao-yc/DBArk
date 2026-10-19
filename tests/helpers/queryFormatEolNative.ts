import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';

export const formatEolCases = ['按钮首次格式化：保存查询LF与模型实际EOL，单次Undo及重启', '快捷键首次格式化：保存查询LF与模型实际EOL，单次Undo及重启'] as const;
export const formatEolSource = 'select 1,2\nfrom sample where id=1;';
// 手写独立预期，不从formatter、模型结果或格式化后的store制造答案。
export const formatEolExpected = 'select\n  1,\n  2\nfrom\n  sample\nwhere\n  id = 1;';
const gate = 'DBARK_FORMAT_EOL_NATIVE_TEST', approval = 'DBARK_FORMAT_EOL_NATIVE_APPROVED';
/** 默认/list先短路，访问器也不读取；声明阶段不能加载runtime/清单/凭据或预检端口。 */
export function formatEolActive(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && Object.getOwnPropertyDescriptor(env, gate)?.value === '1' && Object.getOwnPropertyDescriptor(env, approval)?.value === '1';
}
/** 独立批准门仅传原manifest参数；真正完整树和Main来源仍由原严格runtime核验。 */
export function bindFormatEolEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  function inspect() {
    const { env, args, platform } = read(), paths = platform === 'win32' ? win32 : posix;
    if (!['win32', 'darwin'].includes(platform) || !formatEolActive(env, args) || Object.getOwnPropertyDescriptor(env, 'DBARK_INTEGRATION_ENABLED')?.value !== '0') throw Error('格式化EOL专项须双门、integration=0及Windows/macOS');
    const allowed = [gate, approval, 'DBARK_INTEGRATION_ENABLED', 'DBARK_FORMAT_EOL_MANIFEST', 'DBARK_FORMAT_EOL_MANIFEST_SHA256', 'DBARK_EXECUTABLE_PATH'];
    const values: [string, string][] = [];
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
      if (!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)) continue;
      if (!allowed.includes(key) || !('value' in property) || typeof property.value !== 'string') throw Error('格式化EOL专项拒绝其他门、认证、外部入口、预加载及大小写别名'); values.push([key, property.value]);
    }
    if (!env.DBARK_FORMAT_EOL_MANIFEST || !paths.isAbsolute(env.DBARK_FORMAT_EOL_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_FORMAT_EOL_MANIFEST_SHA256 ?? '')) throw Error('缺少Root未来批准的绝对清单及原SHA256');
    if (Object.hasOwn(env, 'DBARK_EXECUTABLE_PATH') && (!env.DBARK_EXECUTABLE_PATH || !paths.isAbsolute(env.DBARK_EXECUTABLE_PATH))) throw Error('安装入口须为绝对路径');
    for (const [index, value] of args.entries()) {
      if (['--config', '-c', '--ui', '--debug'].includes(value.split('=')[0]) || /^-c./.test(value)) throw Error('格式化EOL专项拒绝配置或交互覆盖');
      for (const option of ['trace', 'screenshot', 'video']) if (value === '--' + option && args[index + 1] !== 'off' || value.startsWith('--' + option + '=') && value !== '--' + option + '=off') throw Error('格式化EOL专项禁止录制');
    }
    return { signature: JSON.stringify([platform, args, values.sort(([a], [b]) => a.localeCompare(b))]), manifestPath: env.DBARK_FORMAT_EOL_MANIFEST, approvedHash: env.DBARK_FORMAT_EOL_MANIFEST_SHA256! };
  }
  const original = inspect(); let retained = false;
  return Object.freeze({ approval: Object.freeze({ manifestPath: original.manifestPath, approvedHash: original.approvedHash }), assertCurrent() { try { if (retained || inspect().signature !== original.signature) throw Error('格式化EOL原环境已失效'); } catch (reason) { retained = true; throw reason; } } });
}
export interface FormatEolModel { id: number; value: string; eol: string; version: number; changes: number; focused: boolean; selections: { start: number; end: number }[] | undefined; }
/** 原保存查询和Main草稿仍须是原LF；只把期望映射到已声明模型EOL，不改任一来源。 */
export function assertFormatEolInitial(saved: string, draft: string, model: FormatEolModel, platform: string) {
  assert.equal(saved, formatEolSource); assert.equal(draft, formatEolSource);
  assert.ok(model.eol === '\n' || model.eol === '\r\n'); assert.equal(model.value, formatEolSource.replaceAll('\n', model.eol));
  assert.ok(Number.isSafeInteger(model.id) && model.id > 0 && Number.isSafeInteger(model.version) && model.version > 0); assert.equal(model.changes, 0);
  if (platform === 'win32') assert.equal(model.eol, '\r\n', 'Windows本例必须实际观察CRLF；不能把LF/LF冒称修复差异覆盖');
  return Object.freeze({ savedLf: true, draftLf: true, modelEol: model.eol, mismatched: model.eol === '\r\n', userEditsBeforeFormat: 0 });
}
