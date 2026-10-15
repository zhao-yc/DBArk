import{z}from'zod';
import type{CellValue}from'./contracts';
import type{DataSearchTarget}from'./dataSearch';

/** 导航只接受引擎签发的随机引用，不接受渲染进程提供SQL、表名、键或对象身份证明。 */
export const dataSearchRecordReadSchema=z.object({connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),recordRef:z.string().uuid()}).strict();
export const dataSearchRecordsReleaseSchema=z.object({connectionId:z.string().min(1).max(200),sourceTaskId:z.string().uuid()}).strict();
export const dataSearchRecordLimits={references:4000,bytes:32*1024*1024,retentionMs:5*60000,recordBytes:1024*1024,fieldCharacters:4096,definitionBytes:2*1024*1024}as const;
export type DataSearchRecordReadInput=z.infer<typeof dataSearchRecordReadSchema>;
export type DataSearchRecordsReleaseInput=z.infer<typeof dataSearchRecordsReleaseSchema>;
export type DataSearchNavigationReason='no-key'|'identity-permission'|'identity-unproven'|'budget';
export interface DataSearchRecordField{name:string;dataType:string;value:CellValue;characters:string|null;truncated:boolean;binary:boolean}
export interface DataSearchRecord{target:DataSearchTarget;fields:DataSearchRecordField[];timeZone:'+00:00';searchedAt:string;readAt:string;readOnly:true}
