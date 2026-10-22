import{z}from'zod';
import { canonicalHistoryInstant } from './historyTimeRange';
import { historyDurationRangeSchema } from './historyDurationRange';
import type{QueryDatabaseContext}from'./queryContext';
import{savedQueryContextSchema,savedQuerySearchLimits}from'./savedQuerySearch';
import{localSqlPageLimits,type LocalSqlPage}from'./localSqlPages';

/** 沿用最近1000条存储保留；分页限制传输，不扩大或截断旧记录正文。 */
export const historyPageLimits={...localSqlPageLimits,retained:1000,errorPreviewUnits:256,errorUnits:20_000_000}as const;
const id=z.string().min(1).max(200),digest=z.string().regex(/^[a-f0-9]{64}$/),name=z.string().min(1).max(256);
export const historyRecordSchema=z.object({id,connectionId:z.string().max(200).optional(),database:name.optional(),databaseContext:savedQueryContextSchema.optional(),sql:z.string().max(savedQuerySearchLimits.sqlUnits),startedAt:z.string().min(1).max(256),elapsedMs:z.number().finite(),success:z.boolean(),error:z.string().max(historyPageLimits.errorUnits).nullable().optional()}).strict();
/** 端点只接收规范UTC绝对时间，开始包含、结束不包含；空对象和倒序不降级为不限。 */
export const historyTimeRangeSchema=z.object({from:z.string().length(24).refine(canonicalHistoryInstant,'开始时间必须是规范UTC绝对时刻').optional(),until:z.string().length(24).refine(canonicalHistoryInstant,'结束时间必须是规范UTC绝对时刻').optional()}).strict().refine(value=>value.from!==undefined||value.until!==undefined,'时间范围至少填写一个端点').refine(value=>!value.from||!value.until||value.from<value.until,'开始时间必须早于结束时间');
export const historyPageInputSchema=z.object({taskId:z.string().uuid(),search:z.string().max(512),fields:z.array(z.enum(['sql','error'])).min(1).max(2).refine(value=>new Set(value).size===value.length,'历史搜索字段不能重复'),scope:z.discriminatedUnion('kind',[z.object({kind:z.literal('all')}).strict(),z.object({kind:z.literal('connection'),connectionId:id}).strict(),z.object({kind:z.literal('unbound')}).strict()]),status:z.enum(['all','success','failed']),timeRange:historyTimeRangeSchema.optional(),durationRange:historyDurationRangeSchema.optional(),onError:z.enum(['stop','continue'])}).strict();
export const historyReadSchema=z.object({id,digest,connectionId:id}).strict();
export const historyErrorReadSchema=z.object({id,digest}).strict();
export type HistoryRecord=z.infer<typeof historyRecordSchema>;
export type HistoryPageInput=z.infer<typeof historyPageInputSchema>;
export interface HistoryPagePosition{id:string;startedAt:string;connectionId:string}
export interface HistoryPageEntry{entry:Omit<HistoryRecord,'sql'|'error'>;digest:string;sqlPreview:string;sqlUnits:number;previewTruncated:boolean;errorPreview?:string;errorUnits:number;errorTruncated:boolean}
export type HistoryPage=LocalSqlPage<HistoryPageEntry>;
export interface HistoryOpenResult{entry:Omit<HistoryRecord,'error'>;connectionId:string;database?:string;databaseContext?:QueryDatabaseContext;contextChanged:boolean}
