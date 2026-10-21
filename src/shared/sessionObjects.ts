import type {CompletionMetadataOutput,CompletionColumnDetails} from './sqlCompletion';

/** 临时目录属于物理会话；完整属性仅由显式结构读取确认并按需提供，不保存DDL或行数据。 */
export const sessionObjectLimits={objects:256,columns:4096,bytes:4*1024*1024,sqlUnits:262144,metadataBytes:8*1024*1024}as const;
export interface SessionObjectColumn{name:string;dataType?:string;visible:boolean;details?:CompletionColumnDetails}
export interface SessionObjectSummary{database:string;name:string;known:boolean;complete:boolean;columnCount:number}
export interface SessionObjectSnapshot{revision:number;uncertain:boolean;caseMode:0|1|2;objects:SessionObjectSummary[];busy:boolean;broken:boolean}
export interface SessionObjectCompletion extends CompletionMetadataOutput{revision:number;caseMode:0|1|2;handled:boolean;shadowed:string[];uncertain:boolean}
export interface SessionObjectReadResult{temporary:boolean;objectKind:'temporary'|'table'|'view';database:string;table:string;revision:number;columns:number;complete:boolean;reason?:'hidden-generated-primary-key'|'metadata-visibility-unknown'}
