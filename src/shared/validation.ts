import { editorFontLimits } from './editorFont';
import { tableCopyDataMode, tableCopyDataAcknowledgements } from './tableCopyData';
import { tableCreateDesignSchema, tableCreateDraftSchema, tableCreateAcknowledgements } from './tableCreate';
import { tableCopyStructureKnownAcknowledgements, validateTableCopyStructureName } from './tableCopyStructure';
import { z } from 'zod';
import { serverMonitorLimits, validateServerMonitorInput } from './serverMonitor';
import { csvExportFieldLimits } from './csvExportFields';
import { taskCancelInputSchema } from './taskCancelState';
import { tableApplyReceiptListSchema } from './tableApplyReceipt';
import { tlsPassphraseMaxLength, tlsCredentialMessages, validTlsPassphrase } from './tlsCredentials';
import { workbenchSaveSchema, workbenchTargetSchema } from './workbench';
import { schemaCompareInputSchema, schemaComparePreviewSchema, schemaCompareReleaseSchema } from './schemaCompare';
import { querySaveContentSchema, queryUpdateSourceSchema, querySourceBindingSchema } from './queryBinding';
import{savedQueryPageInputSchema,savedQueryPageNextSchema,savedQueryPageReleaseSchema,savedQueryDeleteCheckedSchema}from'./savedQueryPages';
import{historyPageInputSchema,historyReadSchema,historyErrorReadSchema}from'./historyPages';
import{localSqlPageNextSchema,localSqlPageReleaseSchema}from'./localSqlPages';
import { connectionFileRequirements, connectionImportApplySchema, connectionImportReviewSchema, connectionTransferLimits } from './connectionTransfer';
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
import { tableRenameAcknowledgements, validateTableRenameName } from './tableRename';
import { tableAutoIncrementKnownAcknowledgements, validateTableAutoIncrement } from './tableAutoIncrement';
import { tableCommentAcknowledgements, validateTableComment } from './tableComment';
import { tableDropAcknowledgements } from './tableDrop';
import { tableTruncateAcknowledgements } from './tableTruncate';
import { databaseCreateAcknowledgements, validateDatabaseCreateName } from './databaseCreate';
import { tableDefaultEncodingAcknowledgements } from './tableDefaultEncoding';
import { validateForeignKeyPatches } from './tableForeignKeyPatches';
import { foreignKeyAcknowledgementIds, foreignKeyTaskLimits } from './tableForeignKeyTasks';
const foreignKeyTargetName = z.string().min(1).max(64).refine(value => !value.includes('\0'), '外键目标名称不能含 NUL');
import { indexAcknowledgementIds } from './tableIndexTasks';
import { completionLimits } from './sqlCompletion';
import {completionIdentifier} from './completionLexical';
import {structureSearchInputSchema,structureSearchContinueSchema,structureSearchReleaseSchema} from './databaseSearch';
import {dataSearchInputSchema,dataSearchNextSchema,dataSearchReleaseSchema} from './dataSearch';
import {dataSearchCatalogueSchema} from './dataSearchCatalogue';
import{dataSearchRecordReadSchema,dataSearchRecordsReleaseSchema}from'./dataSearchRecords';
import { tableCopySourceReadSchema, tableCopySourceReleaseSchema } from './tableCopySource';
import { copyInsertSqlInputSchema } from './copyInsertSql';
import{savedQuerySearchInputSchema,savedQuerySearchNextSchema,savedQuerySearchReleaseSchema,savedQueryReadSchema}from'./savedQuerySearch';
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
export const connectionSchema = z.object({ id: z.string().max(200), name, group: z.string().max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), dialect: z.enum(['mysql','mariadb']), host: z.string().min(1).max(512), port, user: z.string().max(256), database: z.string().max(256).optional(), pendingFiles: z.array(z.enum(connectionFileRequirements)).max(4).optional(), password: z.string().optional(), rememberPassword: z.boolean().optional(), hasPassword: z.boolean().optional(), ssh: ssh.optional(), tls: z.object({ enabled: z.boolean(), rejectUnauthorized: z.boolean(), caPath: z.string().optional(), certPath: z.string().optional(), keyPath: z.string().optional(), passphrase: z.string().max(tlsPassphraseMaxLength, tlsCredentialMessages.invalid).refine(validTlsPassphrase, tlsCredentialMessages.invalid).optional(), hasPassphrase: z.boolean().optional() }).strict().optional() }).strict();
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
const excelSheet = { fileToken: id, sheetId: id, headerRow: z.number().int().min(1).max(1000).optional(), protocol: z.enum(['plain','dbark-v1']) };
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
  'table.copyInsertSql': copyInsertSqlInputSchema,
  'workbench.get': empty, 'workbench.save': workbenchSaveSchema, 'workbench.resolve': workbenchTargetSchema, 'workbench.copyUri': workbenchTargetSchema,
  'queries.create': querySaveContentSchema, 'queries.updateSource': queryUpdateSourceSchema,
  'table.preferences.get': tablePreferenceTargetSchema, 'table.preferences.save': tablePreferenceSaveSchema, 'table.preferences.reset': tablePreferenceTargetSchema,
  'schema.compare': schemaCompareInputSchema, 'schema.comparePreview': schemaComparePreviewSchema, 'schema.compareRelease': schemaCompareReleaseSchema,
  'app.info': empty,
  'app.setDirty': z.object({ dirty: z.boolean() }).strict(),
  'connections.export': z.object({ connectionIds: z.array(id).min(1).max(connectionTransferLimits.connections), fileToken: id }).strict(),
  'connections.importPreview': z.object({ fileToken: id }).strict(),
  'connections.importReview': connectionImportReviewSchema,
  'connections.importReviewRelease': z.object({ previewToken: id, confirmationToken: id }).strict(),
  'connections.importApply': connectionImportApplySchema,
  'connections.list': empty, 'connections.save': connectionSchema, 'connections.test': connectionSchema,
  'connections.delete': z.object({ id }).strict(), 'connections.open': z.object({ id }).strict(), 'connections.close': z.object({ id }).strict(),
  'serverMonitor.read': z.object({ connectionId: id, taskId: id, sessionLimit: z.number().int().min(1).max(serverMonitorLimits.sessions).optional() }).strict().superRefine((value, context) => {
    // IPC先拒绝额外范围，内核继续复用同一标识及预算校验。
    try { validateServerMonitorInput(value); } catch { context.addIssue({ code: z.ZodIssueCode.custom, message: '服务器监控参数无效' }); }
  }),
  'metadata.databases': z.object({ connectionId: id }).strict(),
  'search.structure':structureSearchInputSchema,
  'search.savedQueries':savedQuerySearchInputSchema,'search.savedQueriesContinue':savedQuerySearchNextSchema,'search.savedQueriesRelease':savedQuerySearchReleaseSchema,'queries.read':savedQueryReadSchema,
  'queries.page':savedQueryPageInputSchema,'queries.pageContinue':savedQueryPageNextSchema,'queries.pageRelease':savedQueryPageReleaseSchema,'queries.deleteChecked':savedQueryDeleteCheckedSchema,
  'search.structureContinue':structureSearchContinueSchema,
  'search.release':structureSearchReleaseSchema,
  'search.dataStart':dataSearchInputSchema,'search.dataNext':dataSearchNextSchema,'search.dataRelease':dataSearchReleaseSchema,
  'search.catalogue':dataSearchCatalogueSchema,
  'search.recordRead':dataSearchRecordReadSchema,'search.recordsRelease':dataSearchRecordsReleaseSchema,
  'metadata.completion': z.discriminatedUnion('kind',[
    z.object({kind:z.literal('databases'),connectionId:id,taskId:id,prefix:completionPrefix}).strict(),
    z.object({kind:z.literal('objects'),connectionId:id,taskId:id,prefix:completionPrefix,database:completionName,objectKind:z.enum(['relation','function','procedure'])}).strict(),
    z.object({kind:z.literal('columns'),connectionId:id,taskId:id,prefix:completionPrefix,database:completionName,table:completionName}).strict(),
  ]),
  'metadata.objects': z.object({ connectionId: id, database: name }).strict(),
  'metadata.table': z.object({ ...target, taskId: id.optional() }).strict(),
  'metadata.ddl': z.object({ connectionId: id, database: name, name, kind: z.enum(['table','view','procedure','function','trigger','event']) }).strict(),
  'sessions.open': z.object({ connectionId: id, database: name.nullable().optional() }).strict(), 'sessions.close': z.object({ sessionId: id }).strict(),
  'query.execute': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000), currentStatement: z.object({ offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().optional() }).strict().refine(value => value.currentStatement === undefined || value.currentStatement.offset <= value.sql.length, '当前语句光标超出完整正文范围'),
  'query.explain': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000), format: z.enum(['auto', 'text']).optional() }).strict(),
  'query.parameterNames': z.object({ sessionId: id, sql: text.min(1) }).strict(),
  'query.sessionState': z.object({ sessionId: id }).strict(),
  'query.completionState':z.object({sessionId:id}).strict(),
  'query.temporaryState':z.object({sessionId:id}).strict(),
  'query.temporaryCompletion':z.discriminatedUnion('kind',[z.object({sessionId:id,database:completionName,prefix:completionPrefix,kind:z.literal('objects')}).strict(),z.object({sessionId:id,database:completionName,table:completionName,prefix:completionPrefix,kind:z.literal('columns')}).strict()]),
  'query.temporaryRead':z.object({sessionId:id,database:completionName,table:completionName,taskId:id}).strict(),
  'query.executeParameterized': z.object({ sessionId: id, sql: text.min(1), parameters: queryParameters, taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.exportStream': z.object({ sessionId: id, sql: text.min(1), taskId: id, fileToken: id, format: z.enum(['csv', 'json', 'csv-zip']), encoding: z.enum(['utf8', 'utf16le', 'gb18030']), protocol: z.enum(['text-strict', 'binary-explicit']), resultSelection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }).strict(), z.object({ kind: z.literal('row-result'), ordinal: z.number().int().min(1).max(queryStreamExportLimits.results) }).strict()]), parameters: queryParameters.optional() }).strict().superRefine((input, context) => {
    if (new TextEncoder().encode(input.sql).byteLength > queryStreamExportLimits.sqlBytes) context.addIssue({ code: 'custom', path: ['sql'], message: 'SQL 模板不能超过 20 MiB' });
    if ((input.format !== 'csv') !== (input.resultSelection.kind === 'all')) context.addIssue({ code: 'custom', path: ['resultSelection'], message: 'JSON和CSV容器必须导出全部结果；单CSV必须指定行结果序号' });
  }),
  'query.cancel': z.object({ taskId: id }).strict(),
  'query.transaction': z.object({ sessionId: id, action: z.enum(['begin','commit','rollback']) }).strict(),
  'table.page': tablePage.safeExtend({ copySource: z.boolean().optional(), taskId: z.string().uuid().optional() }).superRefine((input, context) => {
    if (input.copySource && !input.taskId || input.taskId && !input.copySource) context.addIssue({ code: 'custom', message: '来源表页必须同时显式启用copySource并提供独立任务UUID' });
  }),
  'table.copySourceRead': tableCopySourceReadSchema,
  'table.copySourceRelease': tableCopySourceReleaseSchema,
  'table.referencePage': tablePage.safeExtend({ foreignKeyName: name, matchValues: z.array(cell).optional(), taskId: id }).superRefine((input, context) => {
    if (input.matchValues !== undefined) try { validateReferenceValues(input.matchValues); } catch (error) { context.addIssue({ code: 'custom', path: ['matchValues'], message: error instanceof Error ? error.message : '关联值无效' }); }
  }),
  'table.applyReceipt.list': tableApplyReceiptListSchema, 'table.applyReceipt.detail': z.object({ operationId: z.uuid() }).strict(),
  'table.preview': z.object({ ...target, changes }).strict(), 'table.apply': z.object({ ...target, changes, taskId: id, previewId: z.uuid().optional() }).strict(),
  'schema.preview': z.object({ connectionId: id, design: z.object({ database: name, name, originalName: name.optional(), engine: name, charset: name, comment: z.string(), columns: z.array(z.object({ name, originalName: name.optional(), type: name, nullable: z.boolean(), defaultValue: z.string().nullable().optional(), autoIncrement: z.boolean(), comment: z.string() }).strict()).min(1).max(1000), indexes: z.array(index), foreignKeys: z.array(foreignKey) }).strict() }).strict(),
  'schema.apply': z.object({ connectionId: id, database: z.string().max(256), sql: text.min(1), taskId: id }).strict(),
  'schema.columns.get': z.object({ connectionId: id, database: z.string().min(1).max(64), table: z.string().min(1).max(64), taskId: id }).strict(),
  'schema.columns.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateColumnPatches(value, 38)), taskId: id }).strict(),
  'schema.columns.apply': z.object({ previewToken: id, acknowledgements: z.array(z.string().min(1).max(100)).max(20), taskId: id }).strict(),
  'schema.columns.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的结构令牌'),
  'schema.indexes.get': z.object({ connectionId: id, database: z.string().min(1).max(64), table: z.string().min(1).max(64), taskId: id }).strict(),
  'schema.tableCopyData.get': z.object({ mode: z.literal(tableCopyDataMode), connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableCopyData.preview': z.object({ mode: z.literal(tableCopyDataMode), snapshotId: id, newName: z.string().max(64).transform(value => validateTableCopyStructureName(value)), taskId: id }).strict(),
  'schema.tableCopyData.apply': z.object({ mode: z.literal(tableCopyDataMode), previewToken: id, confirmation: z.string().min(3).max(129), acknowledgements: z.array(z.enum(tableCopyDataAcknowledgements)).length(5).refine(value => new Set(value).size === value.length), taskId: id }).strict(),
  'schema.tableCopyData.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!value.snapshotId || !!value.previewToken),
  'schema.tableCopyStructure.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableCopyStructure.preview': z.object({ snapshotId: id, newName: z.string().max(64).transform(value => validateTableCopyStructureName(value)), taskId: id }).strict(),
  'schema.tableCopyStructure.apply': z.object({ previewToken: id, confirmation: z.string().min(3).max(129), acknowledgements: z.array(z.enum(tableCopyStructureKnownAcknowledgements)).min(3).max(5).refine(value => new Set(value).size === value.length), taskId: id }).strict(),
  'schema.tableCopyStructure.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!value.snapshotId || !!value.previewToken),
  'schema.tableRename.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableRename.preview': z.object({ snapshotId: id, newName: z.string().max(64).transform(value => validateTableRenameName(value)), taskId: id }).strict(),
  'schema.tableRename.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(tableRenameAcknowledgements)).max(3).refine(value => new Set(value).size === value.length, '重命名确认项不能重复'), taskId: id }).strict(),
  'schema.tableRename.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的重命名令牌'),
  'schema.tableAutoIncrement.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableAutoIncrement.preview': z.object({ snapshotId: id, value: z.string().max(20).transform(value => validateTableAutoIncrement(value)), taskId: id }).strict(),
  'schema.tableAutoIncrement.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(tableAutoIncrementKnownAcknowledgements)).max(4).refine(value => new Set(value).size === value.length, '下一自增值确认项不能重复'), taskId: id }).strict(),
  'schema.tableAutoIncrement.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的下一自增值令牌'),
  'schema.tableComment.get': z.object({ connectionId: id, database: z.string().min(1).max(64), table: z.string().min(1).max(64), taskId: id }).strict(),
  'schema.tableDrop.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableDrop.preview': z.object({ snapshotId: id, taskId: id }).strict(),
  'schema.tableDrop.apply': z.object({ previewToken: id, confirmation: z.string().min(3).max(129), acknowledgements: z.array(z.enum(tableDropAcknowledgements)).length(3).refine(values => new Set(values).size === values.length), taskId: id }).strict(),
  'schema.tableDrop.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!value.snapshotId || !!value.previewToken),
  'schema.tableTruncate.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableTruncate.preview': z.object({ snapshotId: id, taskId: id }).strict(),
  'schema.tableTruncate.apply': z.object({ previewToken: id, confirmation: z.string().min(3).max(129), acknowledgements: z.array(z.enum(tableTruncateAcknowledgements)).length(3).refine(values => new Set(values).size === values.length), taskId: id }).strict(),
  'schema.tableTruncate.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!value.snapshotId || !!value.previewToken),
  'schema.tableCreate.get': z.object({ connectionId: id, database: tableCreateDesignSchema.shape.database, taskId: id, includeEncodings: z.boolean().optional(), includePrefixFacts: z.boolean().optional() }).strict(),
  'schema.tableCreate.preview': z.object({ snapshotId: id, design: tableCreateDraftSchema, taskId: id }).strict(),
  'schema.tableCreate.apply': z.object({ previewToken: id, confirmation: z.string().max(129), acknowledgements: z.array(z.enum(tableCreateAcknowledgements)).length(2).refine(value => new Set(value).size === 2), taskId: id }).strict(),
  'schema.tableCreate.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!(value.snapshotId || value.previewToken)),
  'schema.databaseCreate.get': z.object({ connectionId: id, taskId: id }).strict(),
  'schema.databaseCreate.preview': z.object({ snapshotId: id, name: z.string().max(64).refine(value => { try { validateDatabaseCreateName(value); return true; } catch { return false; } }, '数据库名称不在受控范围'), charset: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/), taskId: id }).strict(),
  'schema.databaseCreate.apply': z.object({ previewToken: id, confirmation: z.string().max(64), acknowledgements: z.array(z.enum(databaseCreateAcknowledgements)).max(2).refine(value => new Set(value).size === value.length, '确认项不能重复'), taskId: id }).strict(),
  'schema.databaseCreate.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的新建库令牌'),
  'schema.tableDefaultEncoding.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id }).strict(),
  'schema.tableDefaultEncoding.preview': z.object({ snapshotId: id, charset: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/), taskId: id }).strict(),
  'schema.tableDefaultEncoding.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(tableDefaultEncodingAcknowledgements)).max(3).refine(value => new Set(value).size === value.length, '表默认编码确认项不能重复'), taskId: id }).strict(),
  'schema.tableDefaultEncoding.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的表默认编码令牌'),
  'schema.tableComment.preview': z.object({ snapshotId: id, comment: z.string().max(4096).transform(value => validateTableComment(value)), taskId: id }).strict(),
  'schema.tableComment.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(tableCommentAcknowledgements)).max(2).refine(value => new Set(value).size === value.length, '表注释确认项不能重复'), taskId: id }).strict(),
  'schema.tableComment.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的表注释令牌'),
  'schema.indexes.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateIndexPatches(value)), taskId: id }).strict(),
  'schema.indexes.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(indexAcknowledgementIds)).max(20).refine(value => new Set(value).size === value.length, '索引确认项不能重复'), taskId: id }).strict(),
  'schema.indexes.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的索引结构令牌'),
  'schema.foreignKeys.get': z.object({ connectionId: id, database: foreignKeyTargetName, table: foreignKeyTargetName, taskId: id, parentTargets: z.array(z.object({ database: foreignKeyTargetName, table: foreignKeyTargetName }).strict()).max(foreignKeyTaskLimits.extraParents).optional() }).strict(),
  'schema.foreignKeys.preview': z.object({ snapshotId: id, patches: z.unknown().transform(value => validateForeignKeyPatches(value)), taskId: id }).strict(),
  'schema.foreignKeys.apply': z.object({ previewToken: id, acknowledgements: z.array(z.enum(foreignKeyAcknowledgementIds)).max(20).refine(value => new Set(value).size === value.length, '外键确认项不能重复'), taskId: id }).strict(),
  'schema.foreignKeys.release': z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => Boolean(value.snapshotId || value.previewToken), '缺少待释放的外键结构令牌'),
  'files.choose': z.object({ purpose: z.enum(['import','export','key','certificate','query','connection-import','connection-export']), format: z.string().optional(), suggestedName: z.string().optional() }).strict(),
  'files.path': z.object({ token: id }).strict(),
  'excel.sheets': z.object({ fileToken: id, taskId: id }).strict(),
  'excel.preview': z.object({ ...excelSheet, taskId: id }).strict(),
  'excel.import': z.object({ ...target, ...excelSheet, taskId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), mapping: z.array(z.object({ source: z.string().min(1).max(32767), target: name }).strict()).min(1).max(16384) }).strict().refine(value => new Set(value.mapping.map(item => item.source)).size === value.mapping.length && new Set(value.mapping.map(item => item.target)).size === value.mapping.length, '字段映射不能重复'),
  'excel.export': z.object({ ...target, fileToken: id, taskId: id, scope: z.enum(['sample','all']).optional() }).strict(),
  'files.readQuery': z.object({ fileToken: id, encoding: z.enum(['utf8','utf16le','gb18030']) }).strict(),
  'files.writeQuery': z.object({ fileToken: id, encoding: z.enum(['utf8','utf16le','gb18030']), sql: text }).strict(),
  'files.preview': z.object({ fileToken: id, format: z.enum(['csv','json']), encoding: z.enum(['utf8','utf16le','gb18030']) }).strict(),
  'files.import': z.object({ ...fileOptions, mapping: ownRecord(z.string(), '导入映射') }).strict(),
  'files.exportColumns': z.object({ ...target, taskId: id }).strict(),
  'files.releaseExportColumns': z.object({ catalogId: id }).strict(),
  'files.export': z.object({ ...fileOptions, includeStructure: z.boolean(), includeData: z.boolean(), csvSelection: z.object({ catalogId: id, columns: z.array(z.string().min(1).max(64).refine(value => !value.includes('\0'))).min(1).max(csvExportFieldLimits.columns).refine(value => new Set(value).size === value.length, 'CSV字段不能重复') }).strict().optional() }).strict().refine(value => !value.csvSelection || value.format === 'csv' && value.includeData, '字段选择只适用于CSV数据导出'),
  'files.exportResult': z.object({ fileToken: id, format: z.enum(['csv','json']), encoding: z.enum(['utf8','utf16le','gb18030']), taskId: id, result: resultExportData }).strict(),
  'queries.list': empty, 'queries.save': z.object({ id, name, connectionId: id.optional(), database: name.optional(), databaseContext:queryDatabaseContext.optional(), sql: text, updatedAt: z.string() }).strict(), 'queries.delete': z.object({ id }).strict(),
  'snippets.list': empty, 'snippets.save': snippetSchema, 'snippets.delete': z.object({ id }).strict(),
  'history.list': z.object({ connectionId: id.optional() }).strict(), 'tasks.list': empty, 'tasks.cancelState': taskCancelInputSchema,
  'history.page':historyPageInputSchema,'history.pageContinue':localSqlPageNextSchema,'history.pageRelease':localSqlPageReleaseSchema,'history.read':historyReadSchema,'history.readError':historyErrorReadSchema,
  'settings.get': empty, 'settings.save': z.object({ theme: z.enum(['dark','light']), sidebarWidth: z.number().min(180).max(600), resultLimit: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(1000), dataTypeColors: z.boolean().optional(), editorFontSize: z.number().int().min(editorFontLimits.min).max(editorFontLimits.max).optional(), editorWordWrap: z.boolean().optional(), tabs: z.array(z.object({ id, kind: z.enum(['query','table']), title: name, connectionId: id, database: z.string().optional(), databaseContext:queryDatabaseContext.optional(), table: z.string().optional(), sql: text.optional(), sourceBinding: querySourceBindingSchema.optional() }).strict()).max(100), activeTabId: z.string().optional() }).strict()
};

/** 只接受已声明命令；剔除任意路径、原型字段和其他非约定输入。 */
export function validateCommand(command: string, input: unknown): unknown {
  if (!Object.hasOwn(commandSchemas, command)) throw new Error('不支持的客户端操作');
  const result = commandSchemas[command as Command].safeParse(input);
  if (!result.success) throw new Error(`参数无效：${result.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('；')}`);
  return result.data;
}
