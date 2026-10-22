import { z } from 'zod';
import type { TableColumnApplyProgress } from './tableColumnPatches';
import type { TableEncodingPair } from './tableDefaultEncoding';
import { columnOnUpdatePatchSchema } from './tableColumnPatches';
import { assertTableCreateColumnOnUpdate } from './tableCreateOnUpdate';
import { generatedColumnAcknowledgement, generatedColumnSchema } from './tableGeneratedColumn';
import { assertTableCreateGeneratedColumn } from './tableCreateGenerated';
const name = z.string().min(1).max(64).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(value) && !/\s$/u.test(value));
const columns = z.array(name).min(1).max(1000);
/** 原普通设计加新表专属可选配对；originalName、任意SQL和传输配置均不能混入新建能力。 */
export const tableCreateDesignSchema = z.object({
  database: name, name, engine: z.string().min(1).max(64), charset: z.string().min(1).max(64), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/).optional(), comment: z.string().max(65535),
  columns: z.array(z.object({ name, type: z.string().min(1).max(256), nullable: z.boolean(), defaultValue: z.string().max(65535).nullable().optional(), autoIncrement: z.boolean(), comment: z.string().max(65535), onUpdate: columnOnUpdatePatchSchema.optional(), generated: generatedColumnSchema.optional() }).strict().superRefine((column, context) => { try { assertTableCreateGeneratedColumn(column); assertTableCreateColumnOnUpdate(column); } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '新表字段属性无效' }); } })).min(1).max(1000),
  indexes: z.array(z.object({ name, unique: z.boolean(), columns }).strict()).max(1000),
  foreignKeys: z.array(z.object({ name, columns, referencedDatabase: name, referencedTable: name, referencedColumns: columns, onUpdate: z.string().max(32), onDelete: z.string().max(32) }).strict()).max(1000),
}).strict();
export type TableCreateDesign = z.infer<typeof tableCreateDesignSchema>;
/** 新表键部分独立于实际目录列；长度仅为待建请求，不能当作COLUMNS能力。 */
export const tableCreateKeyPartSchema = z.object({ columnName: name, prefixLength: z.number().int().min(1).max(4294967295).optional() }).strict();
/** 同一索引仅允许一种表示；旧整字段输入继续保持原合同。 */
export const tableCreateIndexSchema = z.union([
  z.object({ name, unique: z.boolean(), columns }).strict(),
  z.object({ name, unique: z.boolean(), keyParts: z.array(tableCreateKeyPartSchema).min(1).max(16) }).strict(),
]);
export const tableCreateDraftSchema = tableCreateDesignSchema.extend({ indexes: z.array(tableCreateIndexSchema).max(1000) });
export type TableCreateDraft = z.infer<typeof tableCreateDraftSchema>;
export type TableCreateIndex = z.infer<typeof tableCreateIndexSchema>;
export interface TableCreatePrefixFacts {
  dialect: 'mysql'; serverVersion: string; pageSize: 16384; defaultRowFormat: 'DYNAMIC';
  charsets: { name: string; maxBytes: number }[]; digest: string;
}
/** 复制键部分供新表规划，不构造已存在列的引用或目录事实。 */
export function tableCreateIndexParts(index: TableCreateIndex): { columnName: string; prefixLength?: number }[] {
  return 'keyParts' in index ? index.keyParts.map(part => ({ ...part })) : index.columns.map(columnName => ({ columnName }));
}
/** 仅实际指定前缀的请求启用专属能力读取，旧整字段输入不增加服务器限制。 */
export function tableCreateHasPrefix(design: TableCreateDraft): boolean { return design.indexes.some(index => tableCreateIndexParts(index).some(part => part.prefixLength !== undefined)); }
/** 省略新键保持旧创建行为，显式无效新键仍由严格合同拒绝。 */
export function tableCreateHasGenerated(design: Pick<TableCreateDraft, 'columns'>): boolean { return design.columns.some(column => Object.hasOwn(column, 'generated')); }
/** 只有全字段请求可进入旧生成/核验链，前缀不得被静默丢弃。 */
export function tableCreateLegacyDesign(input: TableCreateDraft): TableCreateDesign {
  const design = tableCreateDraftSchema.parse(input); if (tableCreateHasPrefix(design)) throw Error('前缀新表必须使用专属计划，不能降级为整字段索引');
  if (tableCreateHasGenerated(design)) throw Error('生成列新表必须使用专属计划，不能静默丢弃表达式');
  return { ...design, indexes: design.indexes.map(index => ({ name: index.name, unique: index.unique, columns: tableCreateIndexParts(index).map(part => part.columnName) })) };
}
export interface TableCreateTarget { connectionId: string; database: string; table: string; }
export interface TableCreateEncodingCatalog { candidates: TableEncodingPair[]; digest?: string; warnings: string[]; reasons: string[]; }
export interface TableCreateGetInput { connectionId: string; database: string; taskId: string; includeEncodings?: boolean; includePrefixFacts?: boolean; includeGeneratedFacts?: boolean; }
export interface TableCreateGetOutput { target: { connectionId: string; database: string }; snapshotId: string; expiresAt: string; serverVersion: string; warnings: string[]; encodings?: TableCreateEncodingCatalog; prefixFacts?: TableCreatePrefixFacts; generatedAccess?: { editable: boolean; reason?: string }; }
export interface TableCreatePreviewInput { snapshotId: string; design: TableCreateDraft; taskId: string; }
export interface TableCreatePreviewOutput { target: TableCreateTarget; previewToken: string; expiresAt: string; designDigest: string; sql: string; warnings: string[]; requiredAcknowledgements: string[]; encoding?: { selection: TableEncodingPair; catalogDigest: string }; }
export const tableCreateAcknowledgements = ['ddl-implicit-commit', 'create-only-no-replay'] as const;
/** 风险按原设计固定集合，不把服务器未知ID或其它生成流程确认混入CREATE。 */
export function tableCreateRequiredAcknowledgements(design: Pick<TableCreateDraft, 'columns'>): string[] { return [...tableCreateAcknowledgements, ...(tableCreateHasGenerated(design) ? [generatedColumnAcknowledgement] : [])]; }
export interface TableCreateApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface TableCreateApplyOutput { target: TableCreateTarget; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; resourcesReleased: boolean; warnings: string[]; }
export interface TableCreateReleaseInput { snapshotId?: string; previewToken?: string; }
export type TableCreateProgress = TableColumnApplyProgress;
/** 确认值不trim，数据库与表名分别保留，SQL仍由引擎分别引用。 */
export const tableCreateConfirmation = (target: Pick<TableCreateTarget, 'database' | 'table'>) => `${target.database}.${target.table}`;

/** 后端说明集中；DDL/默认值/驱动错误原文不进入持久任务说明。 */
export const tableCreateMessages = {
  warnings: ['只创建指定的新表，不覆盖、修改或自动删除任何已有表。', 'DDL可能隐式提交；取消、断线或关闭失败不代表创建未发生，不会自动重放。', '预览不能消除外部并发窗口；同名由服务器拒绝，不使用IF NOT EXISTS或自动改名。'],
  invalid: '新建表设计或准确目标无效，未发送DDL', stale: '新建表快照、连接修订或预览已失效，请重新准备；不会重放旧预览',
  identity: '实际服务器、数据库或会话模式已变化，未发送DDL', database: '无法确认准确的非系统数据库，未发送DDL',
  occupied: '同名表或视图已存在，不能覆盖或将其当成本请求创建', confirmation: '准确库.表名或DDL风险确认不完整；预览已消费，未发送DDL',
  busy: '同一目标正在创建或上次收尾未确认，不能继续投递', size: '新建表设计超过2MiB预算',
  ack: '未取得可确认的CREATE响应；结果未知，请核对实际对象，不要重复执行',
  verify: 'CREATE已收到成功响应，但新表完整定义未核验；不要重复创建', cleanup: 'CREATE已收到成功响应，但连接或资源收尾未确认；请核对资源，不要重复创建',
  foreignKeys: '外键按原设计器生成；完整定义、两套目录和全部索引均已证明才报完整核验，目录、模式或隐式索引未知时只保留CREATE完成事实。',
  serverWarning: '服务器返回CREATE警告，请核对实际定义和服务器提示；不会自动重放。',
  encodingUnavailable: '无法完整证明服务器支持的字符集与排序规则目录；显式配对不可用，可返回沿原草稿创建。',
  encodingInvalid: '必须选择本次实际目录中的完整字符集与排序规则配对，未发送DDL。',
  encodingStale: '服务器编码目录已变化，请重新读取并选择；未发送DDL。',
  labels: { get: '读取新表目标', preview: '预览新建表', apply: '创建新表' },
} as const;
