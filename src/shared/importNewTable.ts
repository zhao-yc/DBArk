import { z } from 'zod';
import type { DataRow, FileChoice } from './contracts';
import { csvImportDelimiters, type CsvImportDelimiter } from './csvImport';

export const importNewTableLimits = Object.freeze({ columns: 1000, sourceName: 256, sampleRows: 20, sampleBytes: 256 * 1024 });
export interface ImportFileSource { sha256: string; bytes: number; }
export interface ImportFileInspectInput { fileToken: string; taskId: string; format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030'; csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean; }
export interface ImportFileInspectOutput { columns: string[]; rows: DataRow[]; records: number; source: ImportFileSource; sampleOmitted: boolean; }
export interface ImportNewTableSeed { file: FileChoice; format: ImportFileInspectInput['format']; encoding: ImportFileInspectInput['encoding']; csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean; columns: string[]; expectedSource: ImportFileSource; mapping: Record<string, string>; }
const invalid = (): never => { throw Error('文件检查或新表导入配置无效，请重新选择文件并检查映射'); };

/** 只读取普通对象的自有数据属性，不执行getter、toJSON或继承字段。 */
function object(input: unknown, maximum: number, required?: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const keys = Reflect.ownKeys(input), result: Record<string, unknown> = Object.create(null);
  if (keys.length > maximum) return invalid();
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !('value' in descriptor) || required && !required.includes(key) && !optional.includes(key)) return invalid(); result[key] = descriptor.value; }
  if (required?.some(key => !Object.hasOwn(result, key))) return invalid(); return result;
}
/** 数组必须稠密且无额外属性；索引访问器与伪造长度不能绕过逐项检查。 */
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(input).length !== length + 1) return invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) { const descriptor = Object.getOwnPropertyDescriptor(input, String(index)); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid(); result.push(descriptor.value); } return result;
}
function string(input: unknown, minimum: number, maximum: number): string { if (typeof input !== 'string' || input.length < minimum || input.length > maximum || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) return invalid(); return input; }
/** JSON空键和原型同名键仍是源身份，目标名称由显式映射另行确定。 */
export function importSourceColumn(input: unknown): string { return string(input, 0, importNewTableLimits.sourceName); }
function columns(input: unknown): string[] { const result = array(input, importNewTableLimits.columns).map(importSourceColumn); if (new Set(result).size !== result.length) return invalid(); return result; }
function source(input: unknown): ImportFileSource { const value = object(input, 2, ['sha256', 'bytes']); if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0) return invalid(); return { sha256: value.sha256, bytes: value.bytes }; }
/** 显式undefined也算指定CSV专用配置；JSON不能借可选属性静默忽略它。 */
function options(value: Record<string, unknown>): Pick<ImportFileInspectInput, 'format' | 'encoding' | 'csvDelimiter' | 'csvHasHeader'> {
  if (!['csv', 'json'].includes(value.format as string) || !['utf8', 'utf16le', 'gb18030'].includes(value.encoding as string)) return invalid();
  const result: ReturnType<typeof options> = { format: value.format as ImportFileInspectInput['format'], encoding: value.encoding as ImportFileInspectInput['encoding'] };
  if (Object.hasOwn(value, 'csvDelimiter')) { if (value.format !== 'csv' || !csvImportDelimiters.includes(value.csvDelimiter as CsvImportDelimiter)) return invalid(); result.csvDelimiter = value.csvDelimiter as CsvImportDelimiter; }
  if (Object.hasOwn(value, 'csvHasHeader')) { if (value.format !== 'csv' || typeof value.csvHasHeader !== 'boolean') return invalid(); result.csvHasHeader = value.csvHasHeader; } return result;
}
function schema<T>(parse: (input: unknown) => T) { return z.unknown().transform((input, context): T => { try { return parse(input); } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '文件导入配置无效' }); return z.NEVER; } }); }
export const importFileSourceSchema = schema(source);
export const importFileInspectInputSchema = schema((input): ImportFileInspectInput => { const value = object(input, 7, ['fileToken', 'taskId', 'format', 'encoding'], ['csvDelimiter', 'csvHasHeader']); return { fileToken: string(value.fileToken, 1, 200), taskId: string(value.taskId, 1, 200), ...options(value) }; });

/** 有界计算完整JSON文字量大小，超预算即停止计量，不先分配巨大转义字符串。 */
function quotedBytes(value: string, maximum: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length && bytes <= maximum; index++) { const code = value.charCodeAt(index); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(); bytes += 4; } else if (code >= 0xdc00 && code <= 0xdfff) return invalid(); else bytes += code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : 3; } return bytes;
}
/** 样本按完整键、值、转义和分隔符计费；不会截断长值或把大数字转成number。 */
export function importFileSampleRowBytes(input: DataRow, maximum = importNewTableLimits.sampleBytes): number {
  const row = object(input, importNewTableLimits.columns); let bytes = 2, position = 0;
  for (const [key, value] of Object.entries(row)) {
    importSourceColumn(key); bytes += (position++ ? 1 : 0) + quotedBytes(key, maximum - bytes) + 1;
    if (value === null) bytes += 4;
    else if (typeof value === 'string') bytes += quotedBytes(value, maximum - bytes);
    else if (typeof value === 'boolean') bytes += value ? 4 : 5;
    else if (typeof value === 'number' && Number.isFinite(value)) bytes += String(value).length;
    else { const binary = object(value, 2, ['type', 'base64']); if (binary.type !== 'binary' || typeof binary.base64 !== 'string') return invalid(); bytes += 27 + quotedBytes(binary.base64, maximum - bytes); }
    if (bytes > maximum) return maximum + 1;
  } return bytes;
}
/** 样本先计量再克隆，回证只包含完整有限样本；全文件列集合可以超过样本中的键。 */
export const importFileInspectOutputSchema = schema((input): ImportFileInspectOutput => {
  const value = object(input, 5, ['columns', 'rows', 'records', 'source', 'sampleOmitted']), names = columns(value.columns), namesSet = new Set(names), rawRows = array(value.rows, importNewTableLimits.sampleRows), rows: DataRow[] = []; let bytes = 2;
  if (typeof value.records !== 'number' || !Number.isSafeInteger(value.records) || value.records < rawRows.length || typeof value.sampleOmitted !== 'boolean' || value.sampleOmitted !== (value.records > rawRows.length)) return invalid();
  for (const raw of rawRows) { const row = object(raw, importNewTableLimits.columns); if (Object.keys(row).some(key => !namesSet.has(key))) return invalid(); bytes += (rows.length ? 1 : 0) + importFileSampleRowBytes(row as DataRow, importNewTableLimits.sampleBytes - bytes); if (bytes > importNewTableLimits.sampleBytes) return invalid(); rows.push(Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell && typeof cell === 'object' ? { ...(cell as { type: 'binary'; base64: string }) } : cell])) as DataRow); }
  return { columns: names, rows, records: value.records, source: source(value.source), sampleOmitted: value.sampleOmitted };
});
/** 完整源目录与映射逐项一致，保留__proto__等自有源键并拒绝重复非空目标。 */
export const importNewTableSeedSchema = schema((input): ImportNewTableSeed => {
  const value = object(input, 9, ['file', 'format', 'encoding', 'columns', 'expectedSource', 'mapping'], ['csvDelimiter', 'csvHasHeader']), file = object(value.file, 2, ['token', 'name']), names = columns(value.columns), raw = object(value.mapping, importNewTableLimits.columns), mapping: Record<string, string> = Object.create(null), targets = new Set<string>();
  if (Object.keys(raw).length !== names.length || names.some(name => !Object.hasOwn(raw, name))) return invalid();
  for (const name of names) { const target = string(raw[name], 0, 64); if (target.includes('\0') || target !== '' && targets.has(target)) return invalid(); if (target) targets.add(target); mapping[name] = target; }
  return { file: { token: string(file.token, 1, 200), name: string(file.name, 1, 4096) }, ...options(value), columns: names, expectedSource: source(value.expectedSource), mapping };
});
