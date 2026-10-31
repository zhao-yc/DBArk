/** 补全只接收有界目录，不发送用户SQL、会话编号或可执行文本。 */
export const completionLimits={entries:256,prefixUnits:64,aliasUnits:256,sourceUnits:262144,tokens:16384,depth:64,cacheBytes:4*1024*1024,cacheEntries:64,suggestions:256} as const;
export type CompletionObjectKind='relation'|'function'|'procedure';
export type CompletionDirectoryRequest={prefix:string}&({kind:'databases'}|{kind:'objects';database:string;objectKind:CompletionObjectKind}|{kind:'columns';database:string;table:string;details?:true});
export type CompletionMetadataInput=CompletionDirectoryRequest&{connectionId:string;taskId:string};
export interface CompletionColumnDetails{type:string;nullable:boolean;defaultValue:string|null;extra:string;comment:string}
export interface CompletionMetadataEntry{name:string;kind:'database'|'table'|'view'|'function'|'procedure'|'column';dataType?:string;visible?:boolean;sessionObject?:'temporary'|'unconfirmed';details?:CompletionColumnDetails}
export interface CompletionMetadataOutput{entries:CompletionMetadataEntry[];incomplete:boolean;sessionUncertain?:boolean}
/** null表示已确认无默认库；databaseKnown=false时不携带过期名称。模式缺省表示待确认。 */
export interface CompletionSessionState{database?:string|null;databaseKnown:boolean;ansiQuotes?:boolean;noBackslashEscapes?:boolean;dialect?:'mysql'|'mariadb'|'sqlite';serverVersion?:string;objectsRevision?:number;broken:boolean;busy:boolean}
