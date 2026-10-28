import { z } from 'zod';
import type { CellValue, ColumnInfo, TableInfo } from './contracts';
import { FILTER_LIMITS, filterGroupSchema, filterRuleSchema, sortRulesSchema, validateFilterGroup } from './filtering';

// 确认列名经JSON编码每个UTF-16单元最坏占六字节；512KiB覆盖1024×64×6及库表名、标点和行数。
export const tableFilteredUpdateLimits = Object.freeze({ previews: 2, lifetimeMs: 600000, fieldBytes: 8 * 1024 * 1024, rowBytes: 16 * 1024 * 1024, spoolBytes: 10 * 1024 * 1024 * 1024, definitionBytes: 2 * 1024 * 1024, columns: 1024, shownRows: 10, previewSqlBytes: 256 * 1024, confirmationBytes: 512 * 1024 });
export const tableFilteredUpdateText = Object.freeze({
  invalid: '全部筛选行填充的目标、条件或值无效', stale: '填充预览已过期、使用或来源变化，请重新预览；不会自动重放',
  assignmentBudget: '填充值超过单字段8MiB或全部字段合计16MiB限制，未截断数据',
  budget: '完整旧值快照超过字段8MiB、行16MiB或总10GiB限制，或已有两份预览；未截断数据',
  unsupported: '仅支持具有可靠非空唯一键且完整定义可确认的InnoDB基本表',
  column: '只能填充未参与任何索引的普通非自增、非生成字段',
  indexDependencies: '无法证明全部索引依赖完整，或索引列会自动变化，不能保证本次填充只修改预览的目标表行',
  changed: '目标完整定义、实际服务器或会话时区已变化，未继续填充',
  triggers: '目标存在触发器或无法证明副作用与目录完整性，不能保证整批目标事务回滚',
  warnings: '服务器警告、并发修改或写入状态不明确，未继续提交',
  transaction: '无法确认原目标事务保护，未继续填充', unknown: '写入或提交结果未知，请核对目标表；不会自动重试或重放',
  spool: '完整旧值快照被修改、替换或未能严格关闭，未继续提交',
  timestamp: '无法取得非空TIMESTAMP的完整绝对时间，不能证明精确旧值定位；未继续填充',
  timeZone: '填充值中的TIMESTAMP按预览显示的源会话时区解释；原筛选保持该会话语义',
  rollbackScope: '整批回滚仅覆盖已证明的目标InnoDB事务；不承诺外部系统副作用可回滚',
  omitted: 'SQL仅展示有界样本，省略其余语句；执行以完整冻结快照为准',
});
const text = tableFilteredUpdateText, limits = tableFilteredUpdateLimits;
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const name = z.string().min(1).max(64).refine(value => !value.includes('\0') && unicode(value), text.invalid);
const connectionId = z.string().min(1).max(200), taskId = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);

/** 在schema读取前拒绝访问器、继承/隐藏属性、稀疏数组与循环；不执行未知迭代器。 */
export function assertTableFilteredUpdateData(input: unknown): void {
  const ancestors = new Set<object>(); let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    // 每个二进制赋值最多五个节点；另保留原筛选、输出和元数据的5000节点预算。
    if (++nodes > 5000 + limits.columns * 5 || depth > 24) throw Error(text.invalid);
    if (typeof value === 'string') { if (!unicode(value)) throw Error(text.invalid); return; }
    if (!value || typeof value !== 'object') return;
    if (ancestors.has(value) || (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw Error(text.invalid);
    ancestors.add(value); const keys = Reflect.ownKeys(value);
    if (keys.length > 1100) throw Error(text.invalid);
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1100 || keys.length !== length + 1) throw Error(text.invalid);
      // 逐个核自有索引，避免用同数量的额外属性掩盖空洞后触发继承getter。
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(text.invalid);
      }
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable && !(Array.isArray(value) && key === 'length')) throw Error(text.invalid);
      if (!(Array.isArray(value) && key === 'length')) visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }; visit(input, 0);
}
function guarded<S extends z.ZodType>(schema: S) { return z.unknown().transform((input, context): z.output<S> => { try { assertTableFilteredUpdateData(input); return schema.parse(input); } catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : text.invalid }); return z.NEVER; } }); }
export const tableFilteredUpdateTargetSchema = z.object({ connectionId, database: name, table: name }).strict();
export type TableFilteredUpdateTarget = z.infer<typeof tableFilteredUpdateTargetSchema>;
/** 逐字节核规范Base64及实际字节数，不对8MiB字段运行递归式正则。 */
export function tableFilteredUpdateBinaryBytes(value: string): number {
  if (value.length % 4 || value.length > Math.ceil(limits.fieldBytes / 3) * 4) throw Error(text.budget);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0, length = value.length / 4 * 3 - padding;
  if (length < 0 || length > limits.fieldBytes) throw Error(text.budget);
  let last = 0;
  for (let index = 0; index < value.length - padding; index++) { const code = value.charCodeAt(index); last = code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 71 : code >= 48 && code <= 57 ? code + 4 : code === 43 ? 62 : code === 47 ? 63 : -1; if (last < 0) throw Error(text.invalid); }
  if (padding === 2 && (last & 15) || padding === 1 && (last & 3)) throw Error(text.invalid); return length;
}
const cell = z.union([z.string().refine(value => unicode(value) && bytes(value) <= limits.fieldBytes, text.budget), z.number().finite(), z.boolean(), z.null(), z.object({ type: z.literal('binary'), base64: z.string().refine(value => { try { tableFilteredUpdateBinaryBytes(value); return true; } catch { return false; } }, text.invalid) }).strict()]);
const assignmentSchema = z.object({ column: name, value: cell }).strict();
export type TableFilteredUpdateAssignment = z.infer<typeof assignmentSchema>;
export type TableFilteredUpdateAssignmentInput = { column: string; value: CellValue; assignments?: never } | { assignments: readonly TableFilteredUpdateAssignment[]; column?: never; value?: never };
export type TableFilteredUpdateOutputColumnInput = { column: string; columns?: never } | { columns: readonly string[]; column?: never };
/** 预算统计原值实际字节，不把Base64表示体积误算为二进制大小；固定标量按有界存储计。 */
function assignmentBytes(value: CellValue): number {
  return typeof value === 'string' ? bytes(value) : value === null ? 0 : typeof value === 'number' ? 8 : typeof value === 'boolean' ? 1 : tableFilteredUpdateBinaryBytes(value.base64);
}
const assignmentsSchema = z.array(assignmentSchema).min(1).max(limits.columns).superRefine((assignments, context) => {
  if (new Set(assignments.map(assignment => assignment.column)).size !== assignments.length) context.addIssue({ code: 'custom', message: text.invalid });
  if (assignments.reduce((total, assignment) => total + assignmentBytes(assignment.value), 0) > limits.rowBytes) context.addIssue({ code: 'custom', message: text.assignmentBudget });
});
const outputColumnsSchema = z.array(name).min(1).max(limits.columns).refine(columns => new Set(columns).size === columns.length, text.invalid);
/** 返回全部赋值的独立副本；新旧形状互斥，即使新列表只有一项也不降为旧协议。 */
export function tableFilteredUpdateAssignments(input: TableFilteredUpdateAssignmentInput): TableFilteredUpdateAssignment[] {
  assertTableFilteredUpdateData(input);
  if (Object.hasOwn(input, 'assignments')) {
    if (Object.hasOwn(input, 'column') || Object.hasOwn(input, 'value')) throw Error(text.invalid);
    return assignmentsSchema.parse(input.assignments);
  }
  return assignmentsSchema.parse([{ column: input.column, value: input.value }]);
}
/** 输出只含完整列集合；不读取或泄露任何填充值，也不以首列替代整组。 */
export function tableFilteredUpdateOutputColumns(input: TableFilteredUpdateOutputColumnInput): string[] {
  assertTableFilteredUpdateData(input);
  if (Object.hasOwn(input, 'columns')) {
    if (Object.hasOwn(input, 'column')) throw Error(text.invalid);
    return outputColumnsSchema.parse(input.columns);
  }
  return outputColumnsSchema.parse([input.column]);
}
const previewInputBaseSchema = tableFilteredUpdateTargetSchema.extend({ taskId, metadataKey: z.string().min(1).refine(value => unicode(value) && bytes(value) <= limits.definitionBytes, text.budget), filters: z.array(filterRuleSchema).max(FILTER_LIMITS.conditions), filterMode: z.enum(['all', 'any']).optional(), filterGroup: filterGroupSchema.optional(), sort: sortRulesSchema });
export const tableFilteredUpdatePreviewInputSchema = guarded(z.union([previewInputBaseSchema.extend({ column: name, value: cell }).strict(), previewInputBaseSchema.extend({ assignments: assignmentsSchema }).strict()]).superRefine((input, context) => { try { validateFilterGroup(input.filters, input.filterMode, input.filterGroup); } catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : text.invalid }); } if (new Set(input.sort.map(rule => rule.column)).size !== input.sort.length) context.addIssue({ code: 'custom', message: text.invalid }); }));
export type TableFilteredUpdatePreviewInput = z.infer<typeof tableFilteredUpdatePreviewInputSchema>;
export const tableFilteredUpdateApplyInputSchema = guarded(z.object({ connectionId, taskId, previewToken: taskId, confirmation: z.string().min(1).max(limits.confirmationBytes).refine(value => unicode(value) && bytes(value) <= limits.confirmationBytes, text.invalid), acknowledged: z.literal(true) }).strict());
export type TableFilteredUpdateApplyInput = z.infer<typeof tableFilteredUpdateApplyInputSchema>;
export const tableFilteredUpdateReleaseInputSchema = guarded(z.object({ connectionId, previewToken: taskId }).strict());
export type TableFilteredUpdateReleaseInput = z.infer<typeof tableFilteredUpdateReleaseInputSchema>;
const rows = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const previewOutputBaseSchema = z.object({ previewToken: taskId, target: tableFilteredUpdateTargetSchema, rows, shownRows: z.number().int().min(0).max(limits.shownRows), sql: z.string().refine(value => unicode(value) && bytes(value) <= limits.previewSqlBytes, text.budget), sampleOmitted: z.boolean(), expiresAt: z.string().datetime(), definitionDigest: digest, assignmentDigest: digest, timeZone: z.string().min(1).max(100), warnings: z.array(z.string().max(2000)).max(32) });
export const tableFilteredUpdatePreviewOutputSchema = guarded(z.union([previewOutputBaseSchema.extend({ column: name }).strict(), previewOutputBaseSchema.extend({ columns: outputColumnsSchema }).strict()]));
export type TableFilteredUpdatePreviewOutput = z.infer<typeof tableFilteredUpdatePreviewOutputSchema>;
const applyOutputBaseSchema = z.object({ target: tableFilteredUpdateTargetSchema, rows, outcome: z.literal('committed'), commitAcknowledged: z.literal(true) });
export const tableFilteredUpdateApplyOutputSchema = guarded(z.union([applyOutputBaseSchema.extend({ column: name }).strict(), applyOutputBaseSchema.extend({ columns: outputColumnsSchema }).strict()]));
export type TableFilteredUpdateApplyOutput = z.infer<typeof tableFilteredUpdateApplyOutputSchema>;
export const tableFilteredUpdateProgressSchema = guarded(z.object({ phase: z.enum(['preparing', 'snapshotting', 'validating', 'updating', 'committing', 'rolling-back', 'releasing', 'finished']), rows, totalRows: rows, snapshotBytes: z.number().int().min(0).max(limits.spoolBytes), dmlMayHaveBeenSent: z.boolean(), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean(), transactionProtected: z.boolean(), outcome: z.enum(['not-sent', 'rolled-back', 'unknown', 'committed']) }).strict());
export type TableFilteredUpdateProgress = z.infer<typeof tableFilteredUpdateProgressSchema>;
/** 全范围填充保守排除所有索引列，避免非定位键的级联更新越出预览行数；引擎另核原DDL依赖。 */
export function tableFilteredUpdateColumns(info: TableInfo): ColumnInfo[] {
  const names = new Set(info.columns.map(column => column.name)), indexed = new Set<string>();
  if (!Array.isArray(info.indexes) || info.indexes.some(index => !index || !Array.isArray(index.columns) || !index.columns.length || new Set(index.columns).size !== index.columns.length || index.columns.some(name => !names.has(name)))) return [];
  for (const index of info.indexes) for (const name of index.columns) indexed.add(name);
  // 修改普通源列也可能重算索引生成列或自动更新时间；不把该间接变化伪装成单列事务范围。
  if (info.columns.some(column => indexed.has(column.name) && (column.generated || /\bon\s+update\b/i.test(column.extra)))) return [];
  return info.columns.filter(column => !indexed.has(column.name) && !column.generated && !/\bauto_increment\b/i.test(column.extra) && !info.primaryKey.includes(column.name) && !info.editableKey.includes(column.name));
}
/** 确认文本只作原文比对，永远不作为SQL来源。 */
export function tableFilteredUpdateConfirmation(input: { target: TableFilteredUpdateTarget; rows: number } & TableFilteredUpdateOutputColumnInput): string {
  const columns = tableFilteredUpdateOutputColumns(input);
  return `${input.target.database}.${input.target.table} / ${Object.hasOwn(input, 'columns') ? JSON.stringify(columns) : columns[0]} / ${input.rows}`;
}
