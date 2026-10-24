import { z } from 'zod';
import { csvImportDelimiters, type CsvImportDelimiter } from './csvImport';

export interface ImportPresetConfiguration {
  format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030';
  csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean; columns: string[]; mapping: Record<string, string>;
}
export interface ImportPresetEntry { id: string; name: string; configuration: ImportPresetConfiguration; createdAt: string; updatedAt: string; }
export interface ImportPresetSnapshot { generation: string; revision: number; entries: ImportPresetEntry[]; }
export interface ImportPresetDocument { version: 1; revision: number; entries: ImportPresetEntry[]; }
export interface ImportPresetSaveInput { generation: string; revision: number; id?: string; name: string; configuration: ImportPresetConfiguration; }
export interface ImportPresetDeleteInput { generation: string; revision: number; id: string; }
export const importPresetLimits = { name: 80, columns: 4096, sourceUnits: 4096, targetUnits: 64, entries: 100, configurationBytes: 256 * 1024, documentBytes: 4 * 1024 * 1024 } as const;
export const importPresetText = {
  invalid: '导入配置结构或字段无效', stale: '导入配置已变化，请刷新后重试', duplicate: '同名导入配置已存在，请更名或明确覆盖',
  missing: '导入配置已删除，请刷新后重试', configurationBudget: '单份导入配置超过256 KiB上限', documentBudget: '导入配置超过100项或4 MiB总量上限',
} as const;
const invalid = (): never => { throw Error(importPresetText.invalid); };

/** 原对象只读取自有可枚举数据属性，拒绝访问器、符号、隐藏字段及继承配置。 */
function record(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return invalid();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) return invalid();
  return output;
}

/** 数组先核长度和每个索引描述符，稀疏、额外属性与索引getter不能被map跳过。 */
function array(input: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum || Reflect.ownKeys(input).length !== length + 1) return invalid();
  const output: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    output.push(descriptor.value);
  }
  return output;
}

/** 保留字符串原文并拒绝孤立代理，UTF-8预算不能以替换字符掩盖非法输入。 */
function string(input: unknown, minimum: number, maximum: number): string {
  if (typeof input !== 'string' || input.length < minimum || input.length > maximum) return invalid();
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = input.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(); }
    else if (code >= 0xdc00 && code <= 0xdfff) return invalid();
  }
  return input;
}
/** 只对已校验的独立副本计算含转义和标点的完整JSON字节。 */
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function uuid(input: unknown): string { return z.string().uuid().parse(string(input, 36, 36)); }
function revision(input: unknown): number { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) return invalid(); return input; }
function name(input: unknown): string { const value = string(input, 1, importPresetLimits.name); if (value.trim() !== value || !value.trim().length || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalid(); return value; }
function date(input: unknown): string { const value = string(input, 24, 24); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return invalid(); return value; }

/** 配置仅含文件解释、源列身份及显式映射，不接收路径、行值、SQL或任何连接身份。 */
function configuration(input: unknown): ImportPresetConfiguration {
  const source = record(input, ['format', 'encoding', 'csvDelimiter', 'csvHasHeader', 'columns', 'mapping'], ['format', 'encoding', 'columns', 'mapping']);
  if (source.format !== 'csv' && source.format !== 'json' || !['utf8', 'utf16le', 'gb18030'].includes(source.encoding as string)) return invalid();
  let units = 0;
  const columns = array(source.columns, importPresetLimits.columns, 1).map(value => {
    const column = string(value, 1, importPresetLimits.sourceUnits); units += column.length * 2;
    // 源键在columns和mapping各出现一次；先按最小字节计费，避免构造超大JSON后才拒绝。
    if (units > importPresetLimits.configurationBytes) throw Error(importPresetText.configurationBudget);
    return column;
  });
  if (new Set(columns).size !== columns.length) return invalid();
  const rawMapping = record(source.mapping, columns), mapping: Record<string, string> = Object.create(null), targets = new Set<string>();
  for (const column of columns) {
    const target = string(rawMapping[column], 0, importPresetLimits.targetUnits);
    units += target.length; if (units > importPresetLimits.configurationBytes) throw Error(importPresetText.configurationBudget);
    if (target.includes('\0') || target !== '' && targets.has(target)) return invalid();
    if (target !== '') targets.add(target); mapping[column] = target;
  }
  if (!targets.size) return invalid();
  const output: ImportPresetConfiguration = { format: source.format, encoding: source.encoding as ImportPresetConfiguration['encoding'], columns, mapping };
  if (Object.hasOwn(source, 'csvDelimiter')) {
    if (source.format !== 'csv' || !csvImportDelimiters.includes(source.csvDelimiter as CsvImportDelimiter)) return invalid();
    output.csvDelimiter = source.csvDelimiter as CsvImportDelimiter;
  }
  if (Object.hasOwn(source, 'csvHasHeader')) {
    if (source.format !== 'csv' || typeof source.csvHasHeader !== 'boolean') return invalid();
    output.csvHasHeader = source.csvHasHeader;
  }
  if (bytes(output) > importPresetLimits.configurationBytes) throw Error(importPresetText.configurationBudget);
  return output;
}

/** 每项时间与编号独立验证；名称保持原文，精确同名冲突由集合校验拒绝。 */
function entry(input: unknown): ImportPresetEntry {
  const source = record(input, ['id', 'name', 'configuration', 'createdAt', 'updatedAt']);
  const output = { id: uuid(source.id), name: name(source.name), configuration: configuration(source.configuration), createdAt: date(source.createdAt), updatedAt: date(source.updatedAt) };
  if (output.updatedAt < output.createdAt) return invalid(); return output;
}
function entries(input: unknown): ImportPresetEntry[] {
  let total = 0;
  const output = array(input, importPresetLimits.entries).map(value => {
    const checked = entry(value); total += bytes(checked);
    if (total > importPresetLimits.documentBytes) throw Error(importPresetText.documentBudget);
    return checked;
  });
  if (new Set(output.map(item => item.id)).size !== output.length || new Set(output.map(item => item.name)).size !== output.length) return invalid();
  return output;
}
/** 文档预算也包含空集合修订墓碑，删空不能把CAS修订重置成零。 */
function document(input: unknown): ImportPresetDocument {
  const source = record(input, ['version', 'revision', 'entries']); if (source.version !== 1) return invalid();
  const output: ImportPresetDocument = { version: 1, revision: revision(source.revision), entries: entries(source.entries) };
  if (bytes(output) > importPresetLimits.documentBytes) throw Error(importPresetText.documentBudget); return output;
}
/** 包装所有原始数据检查，使safeParse也只报告失败、不触发用户getter。 */
function guarded<T>(parse: (input: unknown) => T) {
  return z.unknown().transform((input, context): T => { try { return parse(input); } catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : importPresetText.invalid }); return z.NEVER; } });
}
export const importPresetConfigurationSchema = guarded(configuration);
export const importPresetEntrySchema = guarded(entry);
export const importPresetDocumentSchema = guarded(document);
export const importPresetListSchema = guarded(input => { record(input, []); return {}; });
export const importPresetSaveSchema = guarded((input): ImportPresetSaveInput => {
  const source = record(input, ['generation', 'revision', 'id', 'name', 'configuration'], ['generation', 'revision', 'name', 'configuration']);
  return { generation: uuid(source.generation), revision: revision(source.revision), name: name(source.name), configuration: configuration(source.configuration), ...(Object.hasOwn(source, 'id') ? { id: uuid(source.id) } : {}) };
});
export const importPresetDeleteSchema = guarded((input): ImportPresetDeleteInput => { const source = record(input, ['generation', 'revision', 'id']); return { generation: uuid(source.generation), revision: revision(source.revision), id: uuid(source.id) }; });
export const importPresetSnapshotSchema = guarded((input): ImportPresetSnapshot => {
  const source = record(input, ['generation', 'revision', 'entries']);
  const checked = document({ version: 1, revision: source.revision, entries: source.entries });
  return { generation: uuid(source.generation), revision: checked.revision, entries: checked.entries };
});
