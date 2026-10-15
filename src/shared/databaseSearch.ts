import {z} from 'zod';
import {databaseSearchPatternSchema} from './databaseSearchPattern';

/** 首批结构名称搜索按请求拉取一页，页间不保留数据库连接或未消费的结果批次。 */
export const structureSearchLimits={databases:32,pageHits:50,pageQueries:10,maxHits:1000,pageBytes:128*1024,cursors:32,cursorMs:5*60*1000} as const;
export const structureSearchKinds=['table','view','column','index','primaryKey','foreignKey','procedure','function','trigger','event'] as const;
export type StructureSearchKind=typeof structureSearchKinds[number];
export const searchIdentifier=z.string().min(1).max(64).refine(value=>!/[\0\ud800-\udfff]/.test(value),'名称必须是1至64字的BMP标识符');
const unique=<T>(values:T[])=>new Set(values).size===values.length;
export const structureSearchInputSchema=z.object({
  connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),
  databases:z.array(searchIdentifier).min(1).max(structureSearchLimits.databases).refine(unique,'数据库不能重复'),
  kinds:z.array(z.enum(structureSearchKinds)).min(1).max(structureSearchKinds.length).refine(unique,'对象类别不能重复'),
  pattern:databaseSearchPatternSchema,maxResults:z.number().int().min(1).max(structureSearchLimits.maxHits),
  onError:z.enum(['stop','continue']),
}).strict();
export const structureSearchContinueSchema=z.object({connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),cursor:z.string().uuid()}).strict();
export const structureSearchReleaseSchema=structureSearchContinueSchema.omit({taskId:true});
export type StructureSearchInput=z.infer<typeof structureSearchInputSchema>;
export type StructureSearchContinue=z.infer<typeof structureSearchContinueSchema>;
export interface StructureSearchHit{database:string;kind:StructureSearchKind;object:string;name:string;parentKind:'table'|'view'|'procedure'|'function'|'trigger'|'event'}
export interface StructureSearchFailure{database:string;kind:StructureSearchKind;message:string}
export interface StructureSearchPage{
  hits:StructureSearchHit[];failures:StructureSearchFailure[];totalHits:number;completedScopes:number;scopeCount:number;
  limitReached:boolean;stoppedOnError:boolean;cursor?:string;expiresAt?:string;
}
