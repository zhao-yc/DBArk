import { z } from 'zod';
import { filterRuleSchema, filterGroupSchema, assertFilterGroupInput, sortRulesSchema, validateFilterGroup, FILTER_LIMITS } from './filtering';
import { tablePreferenceTargetSchema } from './tablePreferences';

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
const entry = z.object({id:z.string().uuid(),name,connectionDigest:digest,configuration:tablePresetConfigurationSchema}).strict().superRefine((value,context)=>{
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>tablePresetLimits.entryBytes)context.addIssue({code:'custom',message:'单项方案超过64 KiB字节上限'});
});
export const tablePresetDocumentSchema = z.object({version:z.literal(1),revision,entries:z.array(entry).max(tablePresetLimits.perTarget)}).strict().superRefine((value,context)=>{
  if(new Set(value.entries.map(item=>item.name)).size!==value.entries.length||new Set(value.entries.map(item=>item.id)).size!==value.entries.length)context.addIssue({code:'custom',message:'方案名称或编号重复'});
});
export const tablePresetSourceSchema = z.object({connectionRevision:revision,connectionDigest:digest}).strict();
export const tablePresetListSchema = tablePreferenceTargetSchema;
const checked = tablePreferenceTargetSchema.extend({expectedRevision:revision,source:tablePresetSourceSchema,bindingToken:z.string().uuid()}).strict();
export const tablePresetSaveSchema = checked.extend({name,configuration:tablePresetConfigurationSchema,replaceId:z.string().uuid().optional()}).strict();
export const tablePresetSelectSchema = checked.extend({id:z.string().uuid()}).strict();
export const tablePresetApplySchema = tablePresetSelectSchema.extend({taskId:z.string().uuid()}).strict();
export type TablePresetConfiguration = z.infer<typeof tablePresetConfigurationSchema>;
export type TablePresetDocument = z.infer<typeof tablePresetDocumentSchema>;
export type TablePresetSource = z.infer<typeof tablePresetSourceSchema>;
export type TablePresetStoredSnapshot = TablePresetDocument & {source:TablePresetSource};
export type TablePresetSnapshot = TablePresetStoredSnapshot & {bindingToken:string};
export type TablePresetSave = z.infer<typeof tablePresetSaveSchema>;
export type TablePresetSelect = z.infer<typeof tablePresetSelectSchema>;
export type TablePresetApply = z.infer<typeof tablePresetApplySchema>;
export type TablePresetTarget = z.infer<typeof tablePresetListSchema>;

/** 预算针对所有目标键和JSON方案内容的UTF-8字节，不代表SQLite文件或堆内存硬上限。 */
export function validateTablePresetBudget(targets:number,entries:number,bytes:number):void {
  if(![targets,entries,bytes].every(value=>Number.isSafeInteger(value)&&value>=0)||targets>tablePresetLimits.targets||entries>tablePresetLimits.entries||bytes>tablePresetLimits.totalBytes)throw Error('命名方案超过500个目标、500项或4 MiB本机内容上限');
}

/** 缺任意字段就拒整份；值保持原字符串及NULL操作符语义，不删条件或强转数值。 */
export function validateTablePresetColumns(raw:TablePresetConfiguration,columns:readonly string[]):TablePresetConfiguration {
  const configuration=tablePresetConfigurationSchema.parse(raw),available=new Set(columns);
  if([...configuration.filters,...configuration.sort].some(item=>!available.has(item.column)))throw Error('方案字段已不存在，整份方案未应用');
  return configuration;
}
