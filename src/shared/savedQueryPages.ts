import {z} from 'zod';
import type {SavedQuery} from './contracts';

/** 列表按需取概要；正文只在明确打开时通过原摘要重新读取。 */
export const savedQueryPageLimits={records:25,bytes:128*1024,previewUnits:512,cursorMs:5*60000,cursors:16,active:2,recentTasks:256}as const;
export const savedQueryPageInputSchema=z.object({taskId:z.string().uuid(),search:z.string().max(512),onError:z.enum(['stop','continue'])}).strict();
export const savedQueryPageNextSchema=z.object({taskId:z.string().uuid(),cursor:z.string().uuid()}).strict();
export const savedQueryPageReleaseSchema=z.object({cursor:z.string().uuid()}).strict();
export const savedQueryDeleteCheckedSchema=z.object({id:z.string().min(1).max(200),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SavedQueryPageInput=z.infer<typeof savedQueryPageInputSchema>;
export interface SavedQueryPageEntry{query:Omit<SavedQuery,'sql'>;digest:string;sqlPreview:string;sqlUnits:number;previewTruncated:boolean}
export interface SavedQueryPage{items:SavedQueryPageEntry[];failures:{id:string;message:string}[];scanned:number;matched:number;failed:number;stoppedOnError:boolean;cursor?:string;expiresAt?:string}
export interface SavedQueryPagePosition{updatedAt:string;id:string}
