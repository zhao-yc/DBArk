import { z } from 'zod';
import { filterRuleSchema, filterGroupSchema, assertFilterGroupInput, sortRulesSchema, validateFilterGroup, FILTER_LIMITS } from './filtering';
import { tablePreferencesLimits, tablePreferenceTargetSchema, type TablePreferences } from './tablePreferences';
import { postgresAdvancedTableFilterSchema, postgresQuickTableFilterSchema, postgresTableLayoutPreferencesSchema, postgresTablePageSchema, postgresTableSortRules, postgresTableSortSchema, postgresTableTargetSchema, type PostgresTablePage, type PostgresTablePageInput } from './postgresTable';
import { postgresPresetIdFromTab } from './postgresPresetTab';

export const tablePresetLimits = { name:80, perTarget:20, targets:500, entries:500, entryBytes:65536, totalBytes:4*1024*1024 } as const;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const configurationShape = z.object({ filters:z.array(filterRuleSchema).max(FILTER_LIMITS.conditions), filterMode:z.enum(['all','any']), filterGroup:filterGroupSchema.optional(), sort:sortRulesSchema }).strict().superRefine((value,context)=>{
  try { validateFilterGroup(value.filters,value.filterMode,value.filterGroup); }
  catch(reason){context.addIssue({code:'custom',message:reason instanceof Error?reason.message:'筛选条件无效'});}
});
/** 先核原始自有分组，不允许对象schema把继承或访问器变成缺省平铺；旧缺项不补树。 */
export const tablePresetConfigurationSchema = z.unknown().transform((input,context):z.output<typeof configurationShape>=>{
  try { assertFilterGroupInput(input);return configurationShape.parse(input); }
  catch(reason){context.addIssue({code:'custom',message:reason instanceof Error?reason.message:'筛选条件无效'});return z.NEVER;}
});
const name = z.string().min(1).max(tablePresetLimits.name).refine(value=>value.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(value),'方案名不能为空或包含控制字符');
/** PostgreSQL 快速筛选沿用原始子串语义，不能转换为 LIKE 或与高级规则混用。 */
const postgresConfiguration = configurationShape.safeExtend({ quickFilter: postgresQuickTableFilterSchema.optional() }).superRefine((value, context) => {
  if ((value.quickFilter && (value.filters.length || value.filterGroup)) || !postgresTableSortSchema.safeParse(value.sort).success ||
      (value.filters.length > 0 && !postgresAdvancedTableFilterSchema.safeParse({ rules: value.filters, mode: value.filterMode, group: value.filterGroup }).success)) {
    context.addIssue({ code: 'custom', message: 'PostgreSQL 方案的筛选或排序无效' });
  }
});
/** 布局保存在独立补充表，旧筛选方案文档继续用原严格形状读取。 */
const postgresPresetLayout = postgresTableLayoutPreferencesSchema.refine(value => value.columns.length > 0 &&
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= tablePreferencesLimits.entryBytes, '方案布局须包含显示列且不能超过512 KiB');
const postgresProfile = postgresConfiguration.safeExtend({ layout: postgresPresetLayout.optional() });
const postgresTablePresetConfigurationSchema = z.unknown().transform((input, context): z.output<typeof postgresProfile> => {
  try { assertFilterGroupInput(input); return postgresProfile.parse(input); }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : 'PostgreSQL 方案无效' }); return z.NEVER; }
});
export const postgresPresetLayoutsSchema = z.array(z.object({ id: z.uuid(), digest, layout: postgresPresetLayout }).strict())
  .max(tablePresetLimits.perTarget).refine(items => new Set(items.map(item => item.id)).size === items.length, '方案布局编号重复');

/** 两种持久化格式复用预算和修订规则，既有文档仍按原格式校验。 */
function presetDocument<T extends TablePresetConfiguration>(configuration: z.ZodType<T>) {
  const entry = z.object({ id: z.string().uuid(), name, connectionDigest: digest, configuration }).strict().superRefine((value, context) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > tablePresetLimits.entryBytes) context.addIssue({ code: 'custom', message: '单项方案超过64 KiB字节上限' });
  });
  return z.object({ version: z.literal(1), revision, entries: z.array(entry).max(tablePresetLimits.perTarget) }).strict().superRefine((value, context) => {
    if (new Set(value.entries.map(item => item.name)).size !== value.entries.length || new Set(value.entries.map(item => item.id)).size !== value.entries.length) context.addIssue({ code: 'custom', message: '方案名称或编号重复' });
  });
}
export const tablePresetDocumentSchema = presetDocument(tablePresetConfigurationSchema);
export const postgresTablePresetDocumentSchema = presetDocument(z.unknown().transform((input, context): z.output<typeof postgresConfiguration> => {
  try { assertFilterGroupInput(input); return postgresConfiguration.parse(input); }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : 'PostgreSQL 方案无效' }); return z.NEVER; }
}));
export const tablePresetSourceSchema = z.object({connectionRevision:revision,connectionDigest:digest}).strict();
export const tablePresetListSchema = tablePreferenceTargetSchema;
const checked = tablePreferenceTargetSchema.extend({expectedRevision:revision,source:tablePresetSourceSchema,bindingToken:z.string().uuid()}).strict();
export const tablePresetSaveSchema = checked.extend({name,configuration:tablePresetConfigurationSchema,replaceId:z.string().uuid().optional()}).strict();
export const tablePresetSelectSchema = checked.extend({id:z.string().uuid()}).strict();
export const tablePresetApplySchema = tablePresetSelectSchema.extend({taskId:z.string().uuid()}).strict();
export const postgresTablePresetListSchema = postgresTableTargetSchema.pick({ connectionId: true, database: true, table: true });
const postgresChecked = postgresTablePresetListSchema.extend({ expectedRevision: revision, source: tablePresetSourceSchema, bindingToken: z.string().uuid() }).strict();
export const postgresTablePresetSaveSchema = postgresChecked.extend({ name, configuration: postgresTablePresetConfigurationSchema, replaceId: z.string().uuid().optional() });
export const postgresTablePresetSelectSchema = postgresChecked.extend({ id: z.string().uuid() });
/** 只为绑定了此方案的独立标签签发首屏；禁止传入额外筛选、偏移或草稿原页。 */
export const postgresTablePresetOpenSchema = postgresTablePresetSelectSchema.extend({
  tabId: postgresTablePageSchema.shape.tabId,
  limit: postgresTablePageSchema.shape.limit,
}).refine(value => postgresPresetIdFromTab(value.tabId) === value.id, '方案与目标标签不匹配');
export type PostgresTablePresetOpen = z.infer<typeof postgresTablePresetOpenSchema>;
export interface PostgresTablePresetOpening { page: PostgresTablePage; configuration: TablePresetConfiguration; }
export type TablePresetConfiguration = z.output<typeof postgresProfile>;
type StoredPresetDocument = z.infer<typeof postgresTablePresetDocumentSchema>;
export type TablePresetDocument = Omit<StoredPresetDocument, 'entries'> & {
  entries: Array<Omit<StoredPresetDocument['entries'][number], 'configuration'> & { configuration: TablePresetConfiguration }>;
};
export type TablePresetSource = z.infer<typeof tablePresetSourceSchema>;
export type TablePresetStoredSnapshot = TablePresetDocument & {source:TablePresetSource};
export type TablePresetSnapshot = TablePresetStoredSnapshot & {bindingToken:string};
export type TablePresetSave = z.infer<typeof postgresTablePresetSaveSchema>;
export type TablePresetSelect = z.infer<typeof tablePresetSelectSchema>;
export type TablePresetApply = z.infer<typeof tablePresetApplySchema>;
export type TablePresetTarget = z.infer<typeof tablePresetListSchema>;

/** 预算针对所有目标键和JSON方案内容的UTF-8字节，不代表SQLite文件或堆内存硬上限。 */
export function validateTablePresetBudget(targets:number,entries:number,bytes:number):void {
  if(![targets,entries,bytes].every(value=>Number.isSafeInteger(value)&&value>=0)||targets>tablePresetLimits.targets||entries>tablePresetLimits.entries||bytes>tablePresetLimits.totalBytes)throw Error('命名方案超过500个目标、500项或4 MiB本机内容上限');
}

/** 缺任意字段就拒整份；值保持原字符串及NULL操作符语义，不删条件或强转数值。 */
export function validateTablePresetColumns(raw:TablePresetConfiguration,columns:readonly string[], postgres = false):TablePresetConfiguration {
  const configuration: TablePresetConfiguration = (postgres ? postgresTablePresetConfigurationSchema : tablePresetConfigurationSchema).parse(raw), available = new Set(columns);
  if ([...configuration.filters, ...configuration.sort, ...(configuration.quickFilter ? [configuration.quickFilter] : [])].some(item => !available.has(item.column))) throw Error('方案字段已不存在，整份方案未应用');
  return configuration;
}

/** 捕获已应用的条件，快速输入框和高级筛选面板的未应用草稿独立保留。 */
export function postgresTablePresetConfiguration({ filter, sort }: Pick<PostgresTablePageInput, 'filter' | 'sort'>, layout?: TablePreferences): TablePresetConfiguration {
  const advanced = filter && 'rules' in filter ? filter : undefined;
  return { filters: advanced?.rules ?? [], filterMode: advanced?.mode ?? 'all', sort: postgresTableSortRules(sort),
    ...(advanced?.group ? { filterGroup: advanced.group } : {}), ...(filter && 'text' in filter ? { quickFilter: filter } : {}),
    ...(layout ? { layout } : {}) };
}

/** 载入时恢复原快速筛选或完整高级条件。页码和页长继续由当前表页管理。 */
export function postgresTablePresetOptions({ filters, filterMode, filterGroup, sort, quickFilter }: TablePresetConfiguration): Pick<PostgresTablePageInput, 'filter' | 'sort'> {
  return { sort, filter: quickFilter ?? (filters.length ? { rules: filters, mode: filterMode, ...(filterGroup ? { group: filterGroup } : {}) } : undefined) };
}
