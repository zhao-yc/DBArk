import { z } from 'zod';
import type { TableColumnApplyProgress } from './tableColumnPatches';
import type { TableEncodingPair } from './tableDefaultEncoding';
const name = z.string().min(1).max(64).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(value) && !/\s$/u.test(value));
const columns = z.array(name).min(1).max(1000);
/** 原普通设计加新表专属可选配对；originalName、任意SQL和传输配置均不能混入新建能力。 */
export const tableCreateDesignSchema = z.object({
  database: name, name, engine: z.string().min(1).max(64), charset: z.string().min(1).max(64), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/).optional(), comment: z.string().max(65535),
  columns: z.array(z.object({ name, type: z.string().min(1).max(256), nullable: z.boolean(), defaultValue: z.string().max(65535).nullable().optional(), autoIncrement: z.boolean(), comment: z.string().max(65535) }).strict()).min(1).max(1000),
  indexes: z.array(z.object({ name, unique: z.boolean(), columns }).strict()).max(1000),
  foreignKeys: z.array(z.object({ name, columns, referencedDatabase: name, referencedTable: name, referencedColumns: columns, onUpdate: z.string().max(32), onDelete: z.string().max(32) }).strict()).max(1000),
}).strict();
export type TableCreateDesign = z.infer<typeof tableCreateDesignSchema>;
export interface TableCreateTarget { connectionId: string; database: string; table: string; }
export interface TableCreateEncodingCatalog { candidates: TableEncodingPair[]; digest?: string; warnings: string[]; reasons: string[]; }
export interface TableCreateGetInput { connectionId: string; database: string; taskId: string; includeEncodings?: boolean; }
export interface TableCreateGetOutput { target: { connectionId: string; database: string }; snapshotId: string; expiresAt: string; serverVersion: string; warnings: string[]; encodings?: TableCreateEncodingCatalog; }
export interface TableCreatePreviewInput { snapshotId: string; design: TableCreateDesign; taskId: string; }
export interface TableCreatePreviewOutput { target: TableCreateTarget; previewToken: string; expiresAt: string; designDigest: string; sql: string; warnings: string[]; requiredAcknowledgements: string[]; encoding?: { selection: TableEncodingPair; catalogDigest: string }; }
export const tableCreateAcknowledgements = ['ddl-implicit-commit', 'create-only-no-replay'] as const;
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
