import{z}from'zod';

/** 本地SQL资料的共用有界页；句柄仅用于单次继续，不接受客户端索引位置。 */
export const localSqlPageLimits={records:25,bytes:128*1024,previewUnits:512,cursorMs:5*60000,cursors:16,active:2,recentTasks:256}as const;
export const localSqlPageNextSchema=z.object({taskId:z.string().uuid(),cursor:z.string().uuid()}).strict();
export const localSqlPageReleaseSchema=z.object({cursor:z.string().uuid()}).strict();
export interface LocalSqlPage<Entry>{items:Entry[];failures:{id:string;message:string}[];scanned:number;matched:number;failed:number;stoppedOnError:boolean;cursor?:string;expiresAt?:string}
