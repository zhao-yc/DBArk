import {z} from 'zod';
import {databaseSearchPatternSchema} from './databaseSearchPattern';
import type {SavedQuery} from './contracts';
import type {QueryDatabaseContext} from './queryContext';
import type { QuerySourceBinding } from './queryBinding';

export const savedQuerySearchLimits={pageQueries:25,pageBytes:128*1024,maxHits:1000,cursors:16,cursorMs:5*60000,active:2,recordBytes:128*1024*1024,sqlUnits:20_000_000,matchMs:2000,initializationMs:5000,previewUnits:256}as const;
const id=z.string().min(1).max(200),name=z.string().min(1).max(256);
export const savedQueryContextSchema=z.discriminatedUnion('state',[z.object({state:z.literal('known'),database:name.refine(value=>!value.includes('\0'),'默认库不能含NUL').nullable()}).strict(),z.object({state:z.literal('unknown')}).strict()]);
export const savedQueryRecordSchema=z.object({id,name,connectionId:id.optional(),database:name.optional(),databaseContext:savedQueryContextSchema.optional(),sql:z.string().max(savedQuerySearchLimits.sqlUnits),updatedAt:z.string().max(256)}).strict();
export const savedQuerySearchInputSchema=z.object({taskId:z.string().uuid(),scope:z.discriminatedUnion('kind',[z.object({kind:z.literal('all')}).strict(),z.object({kind:z.literal('connection'),connectionId:id}).strict(),z.object({kind:z.literal('unbound')}).strict()]),database:z.discriminatedUnion('kind',[z.object({kind:z.literal('all')}).strict(),z.object({kind:z.literal('known'),database:name.nullable()}).strict(),z.object({kind:z.literal('unknown')}).strict(),z.object({kind:z.literal('legacy')}).strict()]),fields:z.array(z.enum(['name','sql'])).min(1).max(2).refine(values=>new Set(values).size===values.length,'搜索字段不能重复'),pattern:databaseSearchPatternSchema,maxResults:z.number().int().min(1).max(savedQuerySearchLimits.maxHits),onError:z.enum(['stop','continue'])}).strict();
export const savedQuerySearchNextSchema=z.object({taskId:z.string().uuid(),cursor:z.string().uuid()}).strict();
export const savedQuerySearchReleaseSchema=z.object({cursor:z.string().uuid()}).strict();
export const savedQueryReadSchema=z.object({id,digest:z.string().regex(/^[a-f0-9]{64}$/),connectionId:id}).strict();
export type SavedQuerySearchInput=z.infer<typeof savedQuerySearchInputSchema>;
export type SavedQuerySearchNext=z.infer<typeof savedQuerySearchNextSchema>;
export interface SavedQueryMatch{field:'name'|'sql';line:number;column:number;offset:number;length:number;preview:string;previewTruncated:boolean}
export interface SavedQuerySearchHit{query:Omit<SavedQuery,'sql'>;digest:string;matches:SavedQueryMatch[]}
export interface SavedQuerySearchPage{hits:SavedQuerySearchHit[];failures:{id:string;message:string}[];scanned:number;totalHits:number;limitReached:boolean;stoppedOnError:boolean;cursor?:string;expiresAt?:string}
export interface SavedQueryOpenResult{query:SavedQuery;connectionId:string;database?:string;databaseContext?:QueryDatabaseContext;contextChanged:boolean;sourceBinding?:QuerySourceBinding}
