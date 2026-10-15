import {z} from 'zod';
import {searchIdentifier} from './databaseSearch';
import {databaseSearchPatternSchema} from './databaseSearchPattern';
import type {CellValue} from './contracts';
import type{DataSearchNavigationReason}from'./dataSearchRecords';

/** 数据搜索的预算在查询生成前固定，字段预览和可靠键分别计量，原值不会被预览取代。 */
export const dataSearchLimits={targets:64,columns:4096,projectionColumns:16,totalColumns:16384,previewCharacters:128,keyBytes:8192,rowBytes:32*1024,batchBytes:128*1024,batchRows:50,rows:1000,indexRows:256,metadataBytes:128*1024,resultBytes:32*1024*1024,acknowledgementMs:60000,active:4,retained:32,retentionMs:5*60000} as const;
export const dataSearchColumnSchema=z.object({name:searchIdentifier,representation:z.enum(['text','hex'])}).strict();
export const dataSearchTargetSchema=z.object({database:searchIdentifier,table:searchIdentifier,kind:z.enum(['table','view']),columns:z.array(dataSearchColumnSchema).min(1).max(dataSearchLimits.projectionColumns).refine(columns=>new Set(columns.map(column=>column.name)).size===columns.length,'搜索字段不能重复')}).strict();
/** 用户可选择宽表的全部字段；执行器再按有界投影分块，不能悄悄忽略第17列之后的选择。 */
export const dataSearchScopeSchema=dataSearchTargetSchema.extend({columns:z.array(dataSearchColumnSchema).min(1).max(dataSearchLimits.columns).refine(columns=>new Set(columns.map(column=>column.name)).size===columns.length,'搜索字段不能重复')});
export const dataSearchMatcherSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('text'),pattern:databaseSearchPatternSchema}).strict(),
  z.object({kind:z.literal('null')}).strict(),
]);
export const dataSearchInputSchema=z.object({
  connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),targets:z.array(dataSearchScopeSchema).min(1).max(dataSearchLimits.targets),
  matcher:dataSearchMatcherSchema,maxResults:z.number().int().min(1).max(dataSearchLimits.rows),allowViews:z.boolean(),onError:z.enum(['stop','continue']),
}).strict().superRefine((input,context)=>{
  if(new Set(input.targets.map(target=>JSON.stringify([target.database,target.table]))).size!==input.targets.length)context.addIssue({code:'custom',message:'数据搜索目标不能重复'});
  if(input.targets.reduce((count,target)=>count+target.columns.length,0)>dataSearchLimits.totalColumns)context.addIssue({code:'custom',message:'全部目标最多选择16384个字段'});
  if(!input.allowViews&&input.targets.some(target=>target.kind==='view'))context.addIssue({code:'custom',message:'所选视图可能执行其中的函数，请明确确认视图范围'});
});
export type DataSearchTarget=z.infer<typeof dataSearchTargetSchema>;
export type DataSearchScope=z.infer<typeof dataSearchScopeSchema>;
export type DataSearchMatcher=z.infer<typeof dataSearchMatcherSchema>;
export type DataSearchInput=z.infer<typeof dataSearchInputSchema>;
export const dataSearchNextSchema=z.object({connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),sequence:z.number().int().min(1).max(100000)}).strict();
export const dataSearchReleaseSchema=dataSearchNextSchema.omit({sequence:true});
export type DataSearchNext=z.infer<typeof dataSearchNextSchema>;
export interface DataSearchColumnMetadata{name:string;dataType:string;binary:boolean;nullable:boolean}
export interface DataSearchTargetMetadata{target:DataSearchTarget;columns:DataSearchColumnMetadata[];keyColumns:DataSearchColumnMetadata[];keyUnavailableReason?:'no-key'|'unsupported-key-type'|'key-not-selectable';indexMetadataIncomplete:boolean}
export interface DataSearchCell{matched:boolean;preview:string|null;characters:string|null;truncated:boolean}
export interface DataSearchRow{cells:DataSearchCell[];keyValues:CellValue[]|null;keyUnavailableReason?:'no-key'|'unsupported-key-type'|'key-too-large'|'key-not-selectable';timestampEpochs?:(string|null)[]}
/** 每处匹配单元格为一个命中；同一行多个字段分别列出，候选键与预览保持独立。 */
export interface DataSearchHit{columnIndex:number;cell:DataSearchCell;keyValues:CellValue[]|null;keyUnavailableReason?:DataSearchRow['keyUnavailableReason'];recordRef?:string;navigationReason?:DataSearchNavigationReason}
export interface DataSearchProgress{phase:'preparing'|'scanning'|'waiting'|'releasing';targetIndex:number;targets:number;processedBlocks:number;blocks:number;failedBlocks:number;hits:number;bytes:number;sequence:number;limitReached:boolean;limitReason?:'hits'|'bytes';peakBufferedRows:number;peakBufferedBytes:number}
export type DataSearchReply=
  |{kind:'batch';sequence:number;targetIndex:number;columnOffset:number;metadata:DataSearchTargetMetadata;hits:DataSearchHit[];progress:DataSearchProgress}
  |{kind:'error';sequence:number;targetIndex:number;columnOffset:number;message:string;discardedHits:number;progress:DataSearchProgress}
  |{kind:'terminal';status:'completed'|'failed'|'cancelled';progress:DataSearchProgress;error?:string};

/** 逐块保留原字段位置，每次最多16个投影；调用方据此将每处匹配关联回原选择。 */
export function* dataSearchBlocks(raw:DataSearchScope):Generator<{target:DataSearchTarget;columnOffset:number}>{
  const scope=dataSearchScopeSchema.parse(raw);
  for(let columnOffset=0;columnOffset<scope.columns.length;columnOffset+=dataSearchLimits.projectionColumns)yield{target:{...scope,columns:scope.columns.slice(columnOffset,columnOffset+dataSearchLimits.projectionColumns)},columnOffset};
}
