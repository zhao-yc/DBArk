import { z } from 'zod';
import type { TableColumnApplyProgress } from './tableColumnPatches';

/** 所有预算先于目录投影和DDL构造检查，不静默截断检查约束。 */
export const tableCheckLimits = { checks: 512, expressionUnits: 32768, expressionBytes: 65536, ddlBytes: 256 * 1024, metadataBytes: 2 * 1024 * 1024 } as const;
export const tableCheckAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'check-existing-rows', 'check-removal', 'check-disabled'] as const;
export type TableCheckAcknowledgement = typeof tableCheckAcknowledgements[number];
const validUnicode = (value: string) => !/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(256).refine(value => validUnicode(value) && [...value].length <= 64 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !/\s$/u.test(value), '检查约束名称无效或超过64个字符');
const id = z.string().min(1).max(200);
const expression = z.string().min(1).max(tableCheckLimits.expressionUnits).refine(value => validUnicode(value) && new TextEncoder().encode(value).length <= tableCheckLimits.expressionBytes, '检查表达式编码无效或超过预算');
export const tableCheckTargetSchema = z.object({ connectionId: id, database: name, table: name }).strict();
export const tableCheckChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), name, expression, enforced: z.boolean() }).strict(),
  z.object({ op: z.literal('drop'), checkRef: id }).strict(),
  z.object({ op: z.literal('replace'), checkRef: id, name, expression, enforced: z.boolean() }).strict(),
  z.object({ op: z.literal('enforcement'), checkRef: id, enforced: z.boolean() }).strict(),
]);
export type TableCheckChange = z.infer<typeof tableCheckChangeSchema>;
export type TableCheckTarget = z.infer<typeof tableCheckTargetSchema>;
export const tableCheckGetSchema = tableCheckTargetSchema.extend({ taskId: id });
export const tableCheckPreviewSchema = z.object({ snapshotId: id, change: tableCheckChangeSchema, taskId: id }).strict();
export const tableCheckApplySchema = z.object({ previewToken: id, databaseConfirmation: name, tableConfirmation: name, acknowledgements: z.array(z.enum(tableCheckAcknowledgements)).max(tableCheckAcknowledgements.length).refine(value => new Set(value).size === value.length, '检查约束确认项不能重复'), taskId: id }).strict();
export const tableCheckReleaseSchema = z.object({ snapshotId: id.optional(), previewToken: id.optional() }).strict().refine(value => !!(value.snapshotId || value.previewToken), '缺少待释放的检查约束令牌');
export type TableCheckGetInput = z.infer<typeof tableCheckGetSchema>;
export type TableCheckPreviewInput = z.infer<typeof tableCheckPreviewSchema>;
export type TableCheckApplyInput = z.infer<typeof tableCheckApplySchema>;
export type TableCheckReleaseInput = z.infer<typeof tableCheckReleaseSchema>;
export type TableCheckProgress = TableColumnApplyProgress;
export interface TableCheckAccess { allowed: boolean; reasons: string[]; }
/** 名称和表达式来自实际目录/定义；引用只由Engine签发，renderer不能以原文定位DROP。 */
export interface TableCheckView {
  checkRef: string; name: string; expression: string; location: 'table' | 'column'; columnName?: string;
  enforced: boolean | null; reasons: string[];
  access: { drop: TableCheckAccess; replace: TableCheckAccess; enforcement: TableCheckAccess };
}
export interface TableCheckGetOutput {
  target: TableCheckTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  serverVersion: string; dialect: 'mysql' | 'mariadb'; sqlMode: string;
  coverage: 'complete' | 'unknown'; checks: TableCheckView[]; columns: string[];
  writable: boolean; allowsNotEnforced: boolean; reasons: string[]; warnings: string[];
}
export interface TableCheckPreviewOutput {
  target: TableCheckTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; change: TableCheckChange; before?: TableCheckView; after?: { name: string; expression: string; enforced: boolean };
  warnings: string[]; requiredAcknowledgements: TableCheckAcknowledgement[];
}
export interface TableCheckApplyOutput {
  target: TableCheckTarget; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; resourcesReleased: true;
  warnings: string[]; after?: { ddlHash: string; checks: TableCheckView[] }; verificationError?: string;
}

/** 新增/重新启用可能扫描既有行；删除/替换与停用需要分别确认弱化约束的风险。 */
export function tableCheckRequiredAcknowledgements(change: TableCheckChange): TableCheckAcknowledgement[] {
  const result: TableCheckAcknowledgement[] = ['ddl-implicit-commit', 'external-ddl-window'];
  if (change.op === 'drop' || change.op === 'replace') result.push('check-removal');
  if (change.op !== 'drop') result.push(change.enforced ? 'check-existing-rows' : 'check-disabled');
  return result;
}
/** 名称确认逐段精确比较，不trim、不拼成可能有歧义的库.表字符串。 */
export function tableCheckConfirmationsMatch(input: Pick<TableCheckApplyInput, 'databaseConfirmation' | 'tableConfirmation'>, target: TableCheckTarget): boolean {
  return input.databaseConfirmation === target.database && input.tableConfirmation === target.table;
}

export const tableCheckMessages = {
  invalid: '检查约束请求或准确目标无效', stale: '检查约束快照、预览或目标已变化，请重新读取；不会重放旧变更',
  readonly: '当前目标的检查约束能力未能完整证明，仅可查看', incomplete: '检查约束目录与完整定义不能一一核对，不把未知范围当作没有约束',
  unsupported: '当前版本不能证明实施CHECK约束；MySQL 5.7等旧版本可能仅解析而忽略CHECK，不能在此提交',
  expression: '表达式必须是有界且闭合的单个CHECK表达式，不能包含外部语句或可执行注释；是否可用仍由服务器检验',
  noChange: '检查约束没有实际变更，未生成DDL', confirmation: '准确数据库、表名或风险确认不完整；本次预览已消费，未发送DDL',
  unknown: '未取得可确认的DDL响应，结果未知；请核对实际约束，不要重复执行',
  verify: 'DDL已返回完成，但完整约束及未修改结构尚未核验；请重新读取并核对，不要重复提交',
  cleanup: '结构任务资源收尾尚未确认，请核对连接和任务；不会自动重放DDL',
  refresh: '表结构可能已改变，请重新读取并核对；不要重复提交旧变更。',
  warnings: ['DDL可能隐式提交、扫描已有行或等待元数据锁，不能依赖事务回滚。', '新增或启用约束不证明其它会话的检查开关始终开启，现有数据不满足条件时服务器可能拒绝。', '执行前会复核完整定义及物理表身份，仍存在外部DDL并发窗口；取消或断线不表示未执行，不会自动重放。', '删除、替换或停用会改变数据完整性保护；MariaDB的列级JSON_VALID检查可能参与JSON别名语义。'],
  labels: { get: '读取检查约束', preview: '预览检查约束', apply: '修改检查约束' },
} as const;
