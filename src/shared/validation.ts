import { z } from 'zod';
import { connectionFileRequirements, connectionImportApplySchema, connectionTransferLimits } from './connectionTransfer';
import type { Command, ResultExportData } from './contracts';
import { validateResultExportData } from './resultExport';
import { FILTER_LIMITS, validateFilterRules } from './filtering';
import { queryParameterTypes, validateQueryParameters } from './queryParameters';
import { snippetSchema } from './snippets';
import { validateReferenceValues } from './references';
import { queryStreamExportLimits } from './queryStreamExport';
import { tablePreferenceSaveSchema, tablePreferenceTargetSchema } from './tablePreferences';
import { validateColumnPatches } from './tableColumnPatches';
import { validateIndexPatches } from './tableIndexPatches';
import { validateForeignKeyPatches } from './tableForeignKeyPatches';
import { foreignKeyAcknowledgementIds, foreignKeyTaskLimits } from './tableForeignKeyTasks';
const foreignKeyTargetName = z.string().min(1).max(64).refine(value => !value.includes('\0'), '外键目标名称不能含 NUL');
import { indexAcknowledgementIds } from './tableIndexTasks';
import { completionLimits } from './sqlCompletion';
import {completionIdentifier} from './completionLexical';
import {structureSearchInputSchema,structureSearchContinueSchema,structureSearchReleaseSchema} from './databaseSearch';
import {dataSearchInputSchema,dataSearchNextSchema,dataSearchReleaseSchema} from './dataSearch';
const queryDatabaseContext=z.discriminatedUnion('state',[z.object({state:z.literal('known'),database:z.string().min(1).max(256).refine(value=>!value.includes('\0')).nullable()}).strict(),z.object({state:z.literal('unknown')}).strict()]);
const completionName=z.string().min(1).max(64).refine(completionIdentifier,'补全对象名必须是合法BMP标识符');
const completionPrefix=z.string().max(completionLimits.prefixUnits).refine(value=>value===''||completionIdentifier(value),'补全前缀含无效字符');

const id = z.string().min(1).max(200);
const name = z.string().min(1).max(256);
const text = z.string().max(20_000_000);
const empty = z.object({}).strict();
const port = z.number().int().min(1).max(65535);
const cell = z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.object({ type: z.literal('binary'), base64: z.string() }).strict()]);
/** 数据库列名和文件表头允许 __proto__；逐自有字段校验并安全重建，不读取继承属性或访问器。 */
function ownRecord<T>(valueSchema: z.ZodType<T>, label: string) { return z.unknown().transform((input, context): Record<string, T> => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    context.addIssue({ code: 'custom', message: `${label}必须是普通字段对象` }); return z.NEVER;
  }
  const entries: [string, T][] = [];
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      context.addIssue({ code: 'custom', message: `${label}只接受自有、可枚举的文本字段名和值` }); return z.NEVER;
    }
    const parsed = valueSchema.safeParse(descriptor.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: [key, ...issue.path], message: issue.message });
      return z.NEVER;
    }
    entries.push([key, parsed.data]);
  }
  return Object.fromEntries(entries);
}); }
const row = ownRecord(cell, '数据行');
const ssh = z.object({ enabled: z.boolean(), host: z.string().max(512), port, user: z.string().max(256), password: z.string().optional(), hasPassword: z.boolean().optional(), privateKeyPath: z.string().optional(), passphrase: z.string().optional(), hasPassphrase: z.boolean().optional(), hostFingerprint: z.string().optional() }).strict();
export const connectionSchema = z.object({ id: z.string().max(200), name, group: z.string().max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), dialect: z.enum(['mysql','mariadb']), host: z.string().min(1).max(512), port, user: z.string().max(256), database: z.string().max(256).optional(), pendingFiles: z.array(z.enum(connectionFileRequirements)).max(4).optional(), password: z.string().optional(), rememberPassword: z.boolean().optional(), hasPassword: z.boolean().optional(), ssh: ssh.optional(), tls: z.object({ enabled: z.boolean(), rejectUnauthorized: z.boolean(), caPath: z.string().optional(), certPath: z.string().optional(), keyPath: z.string().optional() }).strict().optional() }).strict();
const target = { connectionId: id, database: name, table: name };
const changes = z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('insert'), values: row }).strict(), z.object({ kind: z.literal('update'), before: row, values: row }).strict(), z.object({ kind: z.literal('delete'), before: row }).strict()])).min(1).max(5000);
/** IPC 允许当前两类驱动的最大尺度；实际执行还须按绑定会话的能力再校验。 */
const queryParameters = z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), type: z.enum(queryParameterTypes), value: z.string().max(65536).optional() }).strict()).max(200).superRefine((input, context) => {
  try { validateQueryParameters(input, 38, true); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '查询参数无效' }); }
});
const index = z.object({ name, unique: z.boolean(), columns: z.array(name).min(1) }).strict();
const foreignKey = z.object({ name, columns: z.array(name).min(1), referencedDatabase: name, referencedTable: name, referencedColumns: z.array(name).min(1), onUpdate: z.enum(['RESTRICT','CASCADE','SET NULL','NO ACTION']), onDelete: z.enum(['RESTRICT','CASCADE','SET NULL','NO ACTION']) }).strict();
const fileOptions = { ...target, fileToken: id, format: z.enum(['csv','json','sql']), encoding: z.enum(['utf8','utf16le','gb18030']), taskId: id };
/** custom 保留已校验结果引用，避免 Zod 深拷贝十万行；主进程仍完整校验每个字段。 */
const resultExportData = z.custom<ResultExportData>().superRefine((value, context) => {
  try { validateResultExportData(value); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '结果导出数据无效' }); }
});
const filterValue = z.string().max(FILTER_LIMITS.valueLength, `每个筛选值不能超过 ${FILTER_LIMITS.valueLength} 个字符`);
const filterRule = z.object({ column: name, operator: z.enum(['=','!=','>','>=','<','<=','LIKE','NOT LIKE','IN','NOT IN','BETWEEN','IS NULL','IS NOT NULL']), value: filterValue.optional(), values: z.array(filterValue).max(FILTER_LIMITS.setValues, `筛选集合不能超过 ${FILTER_LIMITS.setValues} 个值`).optional() }).strict();
/** IPC 同时约束单项形状及整个集合体积，错误由共享校验返回中文说明。 */
const tablePage = z.object({ ...target, page: z.number().int().min(1).max(10000000), pageSize: z.number().int().min(1).max(1000), filters: z.array(filterRule).max(FILTER_LIMITS.conditions), filterMode: z.enum(['all','any']).optional(), sort: z.array(z.object({ column: name, direction: z.enum(['ASC','DESC']) }).strict()).max(20) }).strict().superRefine((input, context) => {
  try { validateFilterRules(input.filters, input.filterMode); }
  catch (error) { context.addIssue({ code: 'custom', path: ['filters'], message: error instanceof Error ? error.message : '筛选条件无效' }); }
});
export const commandSchemas: Record<Command, z.ZodType> = {
  'table.preferences.get': tablePreferenceTargetSchema, 'table.preferences.save': tablePreferenceSaveSchema, 'table.preferences.reset': tablePreferenceTargetSchema,
  'app.info': empty,
  'app.setDirty': z.object({ dirty: z.boolean() }).strict(),
  'connections.export': z.object({ connectionIds: z.array(id).min(1).max(connectionTransferLimits.connections), fileToken: id }).strict(),
  'connections.importPreview': z.object({ fileToken: id }).strict(),
  'connections.importApply': connectionImportApplySchema,
  'connections.list': empty, 'connections.save': connectionSchema, 'connections.test': connectionSchema,
  'connections.delete': z.object({ id }).strict(), 'connections.open': z.object({ id }).strict(), 'connections.close': z.object({ id }).strict(),
  'metadata.databases': z.object({ connectionId: id }).strict(),
  'search.structure':structureSearchInputSchema,
  'search.structureContinue':structureSearchContinueSchema,
  'search.release':structureSearchReleaseSchema,
  'search.dataStart':dataSearchInputSchema,'search.dataNext':dataSearchNextSchema,'search.dataRelease':dataSearchReleaseSchema,
  'metadata.completion': z.discriminatedUnion('kind',[
    z.object({kind:z.literal('databases'),connectionId:id,taskId:id,prefix:completionPrefix}).strict(),
    z.object({kind:z.literal('objects'),connectionId:id,taskId:id,prefix:completionPrefix,database:completionName,objectKind:z.enum(['relation','function','procedure'])}).strict(),
    z.object({kind:z.literal('columns'),connectionId:id,taskId:id,prefix:completionPrefix,database:completionName,table:completionName}).strict(),
  ]),
  'metadata.objects': z.object({ connectionId: id, database: name }).strict(),
  'metadata.table': z.object({ ...target, taskId: id.optional() }).strict(),
  'metadata.ddl': z.object({ connectionId: id, database: name, name, kind: z.enum(['table','view','procedure','function','trigger','event']) }).strict(),
  'sessions.open': z.object({ connectionId: id, database: name.nullable().optional() }).strict(), 'sessions.close': z.object({ sessionId: id }).strict(),
  'query.execute': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.explain': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.parameterNames': z.object({ sessionId: id, sql: text.min(1) }).strict(),
  'query.sessionState': z.object({ sessionId: id }).strict(),
  'query.completionState':z.object({sessionId:id}).strict(),
  'query.temporaryState':z.object({sessionId:id}).strict(),
  'query.temporaryCompletion':z.discriminatedUnion('kind',[z.object({sessionId:id,database:completionName,prefix:completionPrefix,kind:z.literal('objects')}).strict(),z.object({sessionId:id,database:completionName,table:completionName,prefix:completionPrefix,kind:z.literal('columns')}).strict()]),
  'query.temporaryRead':z.object({sessionId:id,database:completionName,table:completionName,taskId:id}).strict(),
  'query.executeParameterized': z.object({ sessionId: id, sql: text.min(1), parameters: queryParameters, taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.exportStream': z.object({ sessionId: id, sql: text.min(1), taskId: id, fileToken: id, format: z.enum(['csv', 'json']), encoding: z.enum(['utf8', 'utf16le', 'gb18030']), protocol: z.enum(['text-strict', 'binary-explicit']), resultSelection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }).strict(), z.object({ kind: z.literal('row-result'), ordinal: z.number().int().min(1).max(queryStreamExportLimits.results) }).strict()]), parameters: queryParameters.optional() }).strict().superRefine((input, context) => {
    if (new TextEncoder().encode(input.sql).byteLength > queryStreamExportLimits.sqlBytes) context.addIssue({ code: 'custom', path: ['sql'], message: 'SQL 模板不能超过 20 MiB' });
    if ((input.format === 'json') !== (input.resultSelection.kind === 'all')) context.addIssue({ code: 'custom', path: ['resultSelection'], message: 'JSON 必须导出全部结果；CSV 必须指定行结果序号' });
  }),
  'query.cancel': z.object({ taskId: id }).strict(),
  'query.transaction': z.object({ sessionId: id, action: z.enum(['begin','commit','rollback']) }).strict(),
  'table.page': tablePage,
  'table.referencePage': tablePage.safeExtend({ foreignKeyName: name, matchValues: z.array(cell).optional(), taskId: id }).superRefine((input, context) => {
    if (input.matchValues !== undefined) try { validateReferenceValues(input.matchValues); } catch (error) { context.addIssue({ code: 'custom', path: ['matchValues'], message: error instanceof Error ? error.message : '关联值无效' }); }
  }),
  'table.preview': z.object({ ...target, changes }).strict(), 'table.apply': z.object({ ...target, changes, taskId: id }).strict(),
  'schema.preview': z.object({ connectionId: id, design: z.object({ database: name, name, originalName: name.optional(), engine: name, charset: name, comment: z.string(), columns: z.array(z.object({ name, originalName: name.optional(), type: name, nullable: z.boolean(), defaultValue: z.string().nullable().optional(), autoIncrement: z.boolean(), comment: z.string() }).strict()).min(1).max(1000), indexes: z.array(index), foreignKeys: z.array(foreignKey) }).strict() }).strict(),
  'schema.apply': z.object({ connectionId: id, database: z.string().max(256), sql: text.min(1), taskId: id }).strict(),
  'schema.columns.get': z.object({ connectionId: id, database: z.string().min(1).max(64), table: z.string().min(1).max(64), taskId: id }).strict(),
  'schema.columns.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateColumnPatches(value, 38)), taskId: id }).strict(),
  'schema.columns.apply': z.object({ previewToken: id, acknowledgements: z.array(z.string().min(1).max(100)).max(20), taskId: id }).strict(),
  'schema.columns.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的结构令牌'),
  'schema.indexes.get': z.object({ connectionId: id, database: z.string().min(1).max(64), table: z.string().min(1).max(64), taskId: id }).strict(),
  'schema.indexes.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateIndexPatches(value)), taskId: id }).strict(),
  'schema.indexes.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(indexAcknowledgementIds)).max(20).refine(value => new Set(value).size === value.length, '索引确认项不能重复'), taskId: id }).strict(),
  'schema.indexes.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的索引结构令牌'),
  'schema.foreignKeys.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id, parentTargets: z.array(z.object({ database: foreignKeyTargetName, table: foreignKeyTargetName }).strict()).max(foreignKeyTaskLimits.extraParents).optional() }).strict(),
  'schema.foreignKeys.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateForeignKeyPatches(value)), taskId: id }).strict(),
  'schema.foreignKeys.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(foreignKeyAcknowledgementIds)).max(20).refine(value => new Set(value).size === value.length, '外键确认项不能重复'), taskId: id }).strict(),
  'schema.foreignKeys.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的外键结构令牌'),
  'files.choose': z.object({ purpose: z.enum(['import','export','key','certificate','query','connection-import','connection-export']), format: z.string().optional(), suggestedName: z.string().optional() }).strict(),
  'files.path': z.object({ token: id }).strict(),
  'files.readQuery': z.object({ fileToken: id, encoding: z.enum(['utf8','utf16le','gb18030']) }).strict(),
  'files.writeQuery': z.object({ fileToken: id, encoding: z.enum(['utf8','utf16le','gb18030']), sql: text }).strict(),
  'files.preview': z.object({ fileToken: id, format: z.enum(['csv','json']), encoding: z.enum(['utf8','utf16le','gb18030']) }).strict(),
  'files.import': z.object({ ...fileOptions, mapping: ownRecord(z.string(), '导入映射') }).strict(),
  'files.export': z.object({ ...fileOptions, includeStructure: z.boolean(), includeData: z.boolean() }).strict(),
  'files.exportResult': z.object({ fileToken: id, format: z.enum(['csv','json']), encoding: z.enum(['utf8','utf16le','gb18030']), taskId: id, result: resultExportData }).strict(),
  'queries.list': empty, 'queries.save': z.object({ id, name, connectionId: id.optional(), database: name.optional(), databaseContext:queryDatabaseContext.optional(), sql: text, updatedAt: z.string() }).strict(), 'queries.delete': z.object({ id }).strict(),
  'snippets.list': empty, 'snippets.save': snippetSchema, 'snippets.delete': z.object({ id }).strict(),
  'history.list': z.object({ connectionId: id.optional() }).strict(), 'tasks.list': empty,
  'settings.get': empty, 'settings.save': z.object({ theme: z.enum(['dark','light']), sidebarWidth: z.number().min(180).max(600), resultLimit: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(1000), tabs: z.array(z.object({ id, kind: z.enum(['query','table']), title: name, connectionId: id, database: z.string().optional(), databaseContext:queryDatabaseContext.optional(), table: z.string().optional(), sql: text.optional() }).strict()).max(100), activeTabId: z.string().optional() }).strict()
};

/** 只接受已声明命令；剔除任意路径、原型字段和其他非约定输入。 */
export function validateCommand(command: string, input: unknown): unknown {
  if (!Object.hasOwn(commandSchemas, command)) throw new Error('不支持的客户端操作');
  const result = commandSchemas[command as Command].safeParse(input);
  if (!result.success) throw new Error(`参数无效：${result.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('；')}`);
  return result.data;
}
