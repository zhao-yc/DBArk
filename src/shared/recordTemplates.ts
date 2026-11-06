import { z } from 'zod';
import { sqliteEditValueSchema } from './sqliteTableEdit';

export const recordTemplateLimits = { name: 80, fields: 1024, valueUnits: 65536, entryBytes: 512 * 1024, perTarget: 20, targets: 200, entries: 200, totalBytes: 8 * 1024 * 1024, copies: 100 } as const;

/** 名称和值必须是完整Unicode；NUL可作为字段值保留，名称不接受NUL。 */
function unicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const low = value.charCodeAt(++i); if (!(low >= 0xdc00 && low <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const identifier = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'), '模板字段或目标名称无效');
const label = z.string().min(1).max(recordTemplateLimits.name).refine(value => unicode(value) && !!value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), '模板名称不能为空或包含控制字符');
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().max(recordTemplateLimits.valueUnits).refine(unicode, '模板值包含不完整Unicode');
const base64 = text.refine(value => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  && (!value.endsWith('==') || /[AQgw]==$/.test(value)) && (!value.endsWith('=') || value.endsWith('==') || /[AEIMQUYcgkosw048]=$/.test(value)), '模板二进制值无效');
const mysqlValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('null') }).strict(), z.object({ kind: z.literal('text'), value: text }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(), z.object({ kind: z.literal('binary'), value: base64 }).strict(),
  // 数字用可逆词法文本存盘，特别保留JSON本身无法保存的负零；字符串大数始终仍为text。
  z.object({ kind: z.literal('number'), value: z.string().max(100).refine(value => value === '-0' || Number.isFinite(Number(value)) && String(Number(value)) === value, '模板数字必须可无损往返') }).strict(),
]);
const postgresValue = mysqlValue.refine(value => value.kind === 'null' || value.kind === 'binary' ||
  value.kind === 'text' && !value.value.includes('\0'), 'PostgreSQL 模板值必须是文本、二进制或 NULL');
const dialect = z.enum(['mysql', 'sqlite', 'postgresql']);
const dialectValue = { mysql: mysqlValue, sqlite: sqliteEditValueSchema, postgresql: postgresValue };
export const recordTemplateTargetSchema = z.object({ connectionId: z.string().min(1).max(200), database: identifier, table: identifier }).strict();
const field = z.object({ name: identifier, signature: z.string().min(1).max(8192).refine(unicode), value: z.union([mysqlValue, sqliteEditValueSchema]) }).strict();
const contentShape = z.object({ version: z.literal(1), dialect, fields: z.array(field).min(1).max(recordTemplateLimits.fields) }).strict().superRefine((value, context) => {
  if (new Set(value.fields.map(field => field.name)).size !== value.fields.length) context.addIssue({ code: 'custom', message: '模板字段不能重复' });
  for (const field of value.fields) {
    if (!dialectValue[value.dialect].safeParse(field.value).success) context.addIssue({ code: 'custom', message: '模板字段类型与数据库驱动不匹配' });
    if ('value' in field.value && typeof field.value.value === 'string' && !unicode(field.value.value)) context.addIssue({ code: 'custom', message: '模板值包含不完整Unicode' });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > recordTemplateLimits.entryBytes) context.addIssue({ code: 'custom', message: '单项记录模板超过512 KiB上限' });
});

/** IPC先检查普通自有数据属性，不允许getter、稀疏数组、隐藏字段或巨量长度触发复制。 */
function object(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('记录模板结构无效');
  const keys = Reflect.ownKeys(value), output: Record<string, unknown> = Object.create(null);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw Error('记录模板存在未知字段');
  for (const key of keys as string[]) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error('记录模板不能包含访问器或隐藏字段'); output[key] = descriptor.value; }
  if (required.some(key => !Object.hasOwn(output, key))) throw Error('记录模板缺少必要字段');
  return output;
}
/** 每个值先按自身kind所需字段复制，数组预算先于任何索引读取。 */
function contentInput(value: unknown): unknown {
  const content = object(value, ['version', 'dialect', 'fields']), fields = content.fields;
  if (!Array.isArray(fields) || Object.getPrototypeOf(fields) !== Array.prototype || fields.length < 1 || fields.length > recordTemplateLimits.fields || Reflect.ownKeys(fields).length !== fields.length + 1) throw Error('记录模板字段数组无效或超限');
  let units = 0;
  return { ...content, fields: Array.from({ length: fields.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(fields, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error('记录模板字段数组不能稀疏或包含访问器');
    const field = object(descriptor.value, ['name', 'signature', 'value']), raw = object(field.value, ['kind', 'value'], ['kind']);
    units += typeof raw.value === 'string' ? raw.value.length : 0;
    if (units > recordTemplateLimits.entryBytes) throw Error('记录模板值超过预算');
    return { ...field, value: raw };
  }) };
}
export const recordTemplateContentSchema = z.unknown().transform((input, context): z.output<typeof contentShape> => {
  try { return contentShape.parse(contentInput(input)); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '记录模板格式无效' }); return z.NEVER; }
});
const entry = z.object({ id: z.string().uuid(), name: label, connectionDigest: digest, content: recordTemplateContentSchema }).strict();
export const recordTemplateDocumentSchema = z.object({ version: z.literal(1), target: recordTemplateTargetSchema, revision, entries: z.array(entry).max(recordTemplateLimits.perTarget) }).strict().superRefine((value, context) => {
  if (new Set(value.entries.map(item => item.id)).size !== value.entries.length || new Set(value.entries.map(item => item.name)).size !== value.entries.length) context.addIssue({ code: 'custom', message: '记录模板名称或编号重复' });
});
export const recordTemplateSourceSchema = z.object({ connectionRevision: revision, connectionDigest: digest, dialect }).strict();
const checked = recordTemplateTargetSchema.extend({ expectedRevision: revision, source: recordTemplateSourceSchema, bindingToken: z.string().uuid() }).strict();
export const recordTemplateSaveSchema = checked.extend({ name: label, content: recordTemplateContentSchema, replaceId: z.string().uuid().optional() }).strict();
export const recordTemplateSelectSchema = checked.extend({ id: z.string().uuid() }).strict();
export const recordTemplateRenameSchema = recordTemplateSelectSchema.extend({ name: label }).strict();
export const recordTemplateSnapshotSchema = z.object({ target: recordTemplateTargetSchema, revision, source: recordTemplateSourceSchema, bindingToken: z.string().uuid(), entries: z.array(z.object({ id: z.string().uuid(), name: label, dialect, columns: z.array(identifier).max(recordTemplateLimits.fields), sourceCurrent: z.boolean() }).strict()).max(recordTemplateLimits.perTarget) }).strict();
export type RecordTemplateTarget = z.infer<typeof recordTemplateTargetSchema>;
export type RecordTemplateContent = z.infer<typeof recordTemplateContentSchema>;
export type RecordTemplateField = RecordTemplateContent['fields'][number];
export type RecordTemplateDocument = z.infer<typeof recordTemplateDocumentSchema>;
export type RecordTemplateSource = z.infer<typeof recordTemplateSourceSchema>;
export type RecordTemplateSnapshot = z.infer<typeof recordTemplateSnapshotSchema>;
export type RecordTemplateSave = z.infer<typeof recordTemplateSaveSchema>;
export type RecordTemplateSelect = z.infer<typeof recordTemplateSelectSchema>;
export type RecordTemplateRename = z.infer<typeof recordTemplateRenameSchema>;
export type RecordTemplateStored = Omit<RecordTemplateSnapshot, 'bindingToken'>;

/** 只返回名称和字段概要，模板里的真实记录值须通过显式read和来源校验领取。 */
export function recordTemplateSummary(document: RecordTemplateDocument, source: RecordTemplateSource): RecordTemplateStored {
  return { target: document.target, revision: document.revision, source, entries: document.entries.map(entry => ({ id: entry.id, name: entry.name, dialect: entry.content.dialect, columns: entry.content.fields.map(field => field.name), sourceCurrent: entry.connectionDigest === source.connectionDigest })) };
}
