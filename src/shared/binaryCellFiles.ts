import { z } from 'zod';

export const binaryCellFileLimits = { openBytes: 131071, saveBytes: 2 * 1024 * 1024, nameUnits: 255 } as const;
export const binaryCellFileText = {
  openTitle: '载入二进制单元格文件', saveTitle: '另存二进制单元格原字节', allFiles: '所有文件', defaultName: 'binary-cell.bin',
  shuttingDown: '客户端正在退出，不能读写二进制单元格文件', invalid: '二进制单元格文件参数无效', invalidBase64: '二进制值不是完整规范的 Base64',
  busy: '正在处理二进制单元格文件，请等待当前操作结束',
  openLimit: '载入编辑文件不能超过131071字节，未截断文件', saveLimit: '另存二进制值不能超过2 MiB，未截断原值',
  ordinary: '请选择普通文件，不能使用目录或符号链接', changed: '读取过程中原文件已变化或被替换，请重新选择',
  readFailed: '二进制文件读取或关闭失败，未载入原值', writeFailed: '二进制文件保存失败，原目标未替换', targetChanged: '保存目标或父目录已变化，原目标未替换',
} as const;
export type BinaryCellFileOpenInput = Record<string, never>;
export type BinaryCellFileOpenOutput = { base64: string; bytes: number; name: string } | null;
export interface BinaryCellFileSaveInput { base64: string; suggestedName?: string; }
export type BinaryCellFileSaveOutput = { bytes: number; name: string } | null;

/** 不解码、不分配字节数组就核完整Base64，包括padding零位；空串代表零字节而非NULL。 */
export function binaryCellFileBytes(input: unknown, maximum: number = binaryCellFileLimits.saveBytes): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > binaryCellFileLimits.saveBytes) throw Error(binaryCellFileText.invalid);
  if (typeof input !== 'string' || input.length % 4) throw Error(binaryCellFileText.invalidBase64);
  if (input.length > Math.ceil(maximum / 3) * 4) throw Error(maximum === binaryCellFileLimits.openBytes ? binaryCellFileText.openLimit : binaryCellFileText.saveLimit);
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0, bytes = input.length / 4 * 3 - padding;
  if (bytes < 0) throw Error(binaryCellFileText.invalidBase64);
  if (bytes > maximum) throw Error(maximum === binaryCellFileLimits.openBytes ? binaryCellFileText.openLimit : binaryCellFileText.saveLimit);
  let last = 0;
  for (let index = 0; index < input.length - padding; index++) {
    const code = input.charCodeAt(index);
    last = code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 71 : code >= 48 && code <= 57 ? code + 4 : code === 43 ? 62 : code === 47 ? 63 : -1;
    if (last < 0) throw Error(binaryCellFileText.invalidBase64);
  }
  if (padding === 2 && (last & 15) || padding === 1 && (last & 3)) throw Error(binaryCellFileText.invalidBase64);
  return bytes;
}

/** 所有IPC层先读自有数据描述符，访问器/符号/隐藏或继承字段不能被schema提升为可信数据。 */
function record(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error(binaryCellFileText.invalid);
  const keys = Reflect.ownKeys(input), output: Record<string, unknown> = Object.create(null);
  if (keys.length > allowed.length) throw Error(binaryCellFileText.invalid);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw Error(binaryCellFileText.invalid);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(binaryCellFileText.invalid);
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) throw Error(binaryCellFileText.invalid);
  return output;
}
/** 文件名原文不做trim或路径截取，非法Unicode及路径分量必须明确拒绝。 */
function name(input: unknown, suggested: boolean): string {
  if (typeof input !== 'string' || !input.length || input.length > binaryCellFileLimits.nameUnits || input.includes('/') || input.includes('\0')) throw Error(binaryCellFileText.invalid);
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = input.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error(binaryCellFileText.invalid); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw Error(binaryCellFileText.invalid);
  }
  if (suggested && (input === '.' || input === '..' || /[\\:\u0000-\u001f\u007f-\u009f]/u.test(input))) throw Error(binaryCellFileText.invalid);
  return input;
}
/** safeParse和parse共享同一原始数据防线，不执行用户getter或隐式数值转换。 */
function guarded<T>(parse: (input: unknown) => T) {
  return z.unknown().transform((input, context): T => { try { return parse(input); } catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : binaryCellFileText.invalid }); return z.NEVER; } });
}
export const binaryCellFileOpenSchema = guarded((input): BinaryCellFileOpenInput => { record(input, []); return {}; });
export const binaryCellFileSaveSchema = guarded((input): BinaryCellFileSaveInput => {
  const source = record(input, ['base64', 'suggestedName'], ['base64']); binaryCellFileBytes(source.base64);
  return { base64: source.base64 as string, ...(Object.hasOwn(source, 'suggestedName') ? { suggestedName: name(source.suggestedName, true) } : {}) };
});
export const binaryCellFileOpenOutputSchema = guarded((input): BinaryCellFileOpenOutput => {
  if (input === null) return null; const source = record(input, ['base64', 'bytes', 'name']);
  const bytes = binaryCellFileBytes(source.base64, binaryCellFileLimits.openBytes); if (source.bytes !== bytes) throw Error(binaryCellFileText.invalid);
  return { base64: source.base64 as string, bytes, name: name(source.name, false) };
});
export const binaryCellFileSaveOutputSchema = guarded((input): BinaryCellFileSaveOutput => {
  if (input === null) return null; const source = record(input, ['bytes', 'name']);
  if (typeof source.bytes !== 'number' || !Number.isSafeInteger(source.bytes) || source.bytes < 0 || source.bytes > binaryCellFileLimits.saveBytes) throw Error(binaryCellFileText.invalid);
  return { bytes: source.bytes, name: name(source.name, false) };
});
