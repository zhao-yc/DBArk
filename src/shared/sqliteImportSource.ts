import { z } from 'zod';
import { importFileInspectInputSchema, importFileInspectOutputSchema, importNewTableLimits, type ImportFileInspectInput, type ImportFileInspectOutput } from './importNewTable';

/** 来源能力仅绑定文件及原SQLite连接，不绑定未创建的表；样本不能代替后续整文件预检。 */
export const sqliteImportSourceLimits = Object.freeze({
  sources: 64, sourceBytes: 64 * 1024 * 1024, sourceLifetimeMs: 30 * 60 * 1000,
  inspections: 64, inspectionBytes: 64 * 1024 * 1024, inspectionLifetimeMs: 30 * 60 * 1000,
  sourceColumns: importNewTableLimits.columns, sourceName: importNewTableLimits.sourceName,
  sampleRows: importNewTableLimits.sampleRows, sampleBytes: importNewTableLimits.sampleBytes, records: 10000000,
});
export type SqliteImportSourceInspectInput = ImportFileInspectInput & { connectionId: string; database: 'main' };
export interface SqliteImportSourceInspectOutput {
  sourceId: string; connectionId: string; database: 'main'; source: ImportFileInspectOutput['source'];
  sourceColumns: string[]; sample: ImportFileInspectOutput['rows']; records: number; sampleOmitted: boolean; expiresAt: string;
}
export interface SqliteImportSourceReleaseInput { sourceId: string; }
const identifier = z.string().min(1).max(200).refine(value => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const identitySchema = z.object({ sourceId: identifier, connectionId: identifier, database: z.literal('main'), expiresAt: z.string().datetime() }).strict();
const invalid = (): never => { throw Error('SQLite导入来源合同无效或超过预算，请重新选择并检查文件'); };
/** 先读取有界自有数据描述符，拒绝访问器、继承字段和未知属性，不先复制任意输入。 */
function fields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const keys = Reflect.ownKeys(input); if (keys.length > required.length + optional.length) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key) || !descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid(); result[key] = descriptor.value; }
  if (required.some(key => !Object.hasOwn(result, key))) return invalid(); return result;
}
/** 对外仅固定中文错误；原输入、路径或用户字段值不能进入解析诊断。 */
function schema<T>(parse: (input: unknown) => T) { return z.unknown().transform((input, context): T => { try { return parse(input); } catch { context.addIssue({ code: 'custom', message: 'SQLite导入来源合同无效或超过预算，请重新选择并检查文件' }); return z.NEVER; } }); }
export const sqliteImportSourceInspectSchema = schema((input): SqliteImportSourceInspectInput => {
  const raw = fields(input, ['connectionId', 'database', 'fileToken', 'format', 'encoding', 'taskId'], ['csvDelimiter', 'csvHasHeader', 'xmlOptions', 'txtOptions']);
  const connectionId = identifier.parse(raw.connectionId); if (raw.database !== 'main') return invalid();
  const selected = importFileInspectInputSchema.parse({ fileToken: raw.fileToken, format: raw.format, encoding: raw.encoding, taskId: raw.taskId, ...(Object.hasOwn(raw, 'csvDelimiter') ? { csvDelimiter: raw.csvDelimiter } : {}), ...(Object.hasOwn(raw, 'csvHasHeader') ? { csvHasHeader: raw.csvHasHeader } : {}), ...(Object.hasOwn(raw, 'xmlOptions') ? { xmlOptions: raw.xmlOptions } : {}), ...(Object.hasOwn(raw, 'txtOptions') ? { txtOptions: raw.txtOptions } : {}) });
  if (selected.xmlOptions?.binaryBase64) return invalid();
  return { connectionId, database: 'main', ...selected };
});
export const sqliteImportSourceInspectionSchema = schema((input): SqliteImportSourceInspectOutput => {
  const raw = fields(input, ['sourceId', 'connectionId', 'database', 'source', 'sourceColumns', 'sample', 'records', 'sampleOmitted', 'expiresAt']);
  const identity = identitySchema.parse({ sourceId: raw.sourceId, connectionId: raw.connectionId, database: raw.database, expiresAt: raw.expiresAt });
  // 原reader合同在克隆前检查稠密数组、列目录、每个样本值和完整UTF8预算，保留NULL/missing差别。
  const inspected = importFileInspectOutputSchema.parse({ source: raw.source, columns: raw.sourceColumns, rows: raw.sample, records: raw.records, sampleOmitted: raw.sampleOmitted });
  if (inspected.records > sqliteImportSourceLimits.records) return invalid();
  return { ...identity, source: inspected.source, sourceColumns: inspected.columns, sample: inspected.rows, records: inspected.records, sampleOmitted: inspected.sampleOmitted };
});
export const sqliteImportSourceReleaseSchema = schema((input): SqliteImportSourceReleaseInput => { const raw = fields(input, ['sourceId']); return { sourceId: identifier.parse(raw.sourceId) }; });
/** 两次检查只比较实际文件解释；省略CSV默认值与显式默认等价，false不能被吞掉。 */
export function sqliteImportSourceOptionsKey(input: Pick<SqliteImportSourceInspectInput, 'fileToken' | 'format' | 'encoding' | 'csvDelimiter' | 'csvHasHeader' | 'xmlOptions' | 'txtOptions'>): string {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const raw: Record<string, unknown> = { taskId: '内部来源解释核验' };
  for (const key of ['fileToken', 'format', 'encoding', 'csvDelimiter', 'csvHasHeader', 'xmlOptions', 'txtOptions']) {
    const item = Object.getOwnPropertyDescriptor(input, key);
    if (!item) { if (['fileToken', 'format', 'encoding'].includes(key)) return invalid(); continue; }
    if (!item.enumerable || !('value' in item)) return invalid(); raw[key] = item.value;
  }
  const selected = importFileInspectInputSchema.parse(raw), csv = selected.format === 'csv';
  if (selected.xmlOptions?.binaryBase64) return invalid();
  return JSON.stringify({ fileToken: selected.fileToken, format: selected.format, encoding: selected.encoding, csvDelimiter: csv ? selected.csvDelimiter ?? ',' : null, csvHasHeader: csv ? selected.csvHasHeader ?? true : null, ...(selected.xmlOptions ? { xmlOptions: selected.xmlOptions } : {}), ...(selected.txtOptions ? { txtOptions: selected.txtOptions } : {}) });
}
export const sqliteImportSourceMessages = {
  stale: 'SQLite原导入来源已失效，请重新检查文件；不会自动创建表或导入。',
  running: '正在完整检查SQLite导入来源；任务概要不保存路径、原值或SQL。',
  inspected: 'SQLite导入来源已完整检查，尚未创建表或写入记录。',
} as const;
