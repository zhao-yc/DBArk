import {z} from 'zod';
import type {SavedQuery} from './contracts';
import{localSqlPageLimits,localSqlPageNextSchema,localSqlPageReleaseSchema,type LocalSqlPage}from'./localSqlPages';

/** 列表按需取概要；正文只在明确打开时通过原摘要重新读取。 */
export const savedQueryPageLimits=localSqlPageLimits;
export const savedQueryPageInputSchema=z.object({taskId:z.string().uuid(),search:z.string().max(512),onError:z.enum(['stop','continue'])}).strict();
export const savedQueryPageNextSchema=localSqlPageNextSchema;
export const savedQueryPageReleaseSchema=localSqlPageReleaseSchema;
export const savedQueryDeleteCheckedSchema=z.object({id:z.string().min(1).max(200),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SavedQueryPageInput=z.infer<typeof savedQueryPageInputSchema>;
export interface SavedQueryPageEntry{query:Omit<SavedQuery,'sql'>;digest:string;sqlPreview:string;sqlUnits:number;previewTruncated:boolean}
export type SavedQueryPage=LocalSqlPage<SavedQueryPageEntry>;
export interface SavedQueryPagePosition{updatedAt:string;id:string}
