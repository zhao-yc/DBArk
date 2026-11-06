import {z} from 'zod';
import {databaseSearchPatternSchema} from './databaseSearchPattern';
import type {DefinitionNavigationResult} from './definitionNavigation';

/** 首批结构名称搜索按请求拉取一页，页间不保留数据库连接或未消费的结果批次。 */
export const structureSearchLimits={databases:32,pageHits:50,pageQueries:10,maxHits:1000,pageBytes:128*1024,cursors:32,cursorMs:5*60*1000,definitionBytes:2*1024*1024,definitionPageObjects:10} as const;
export const structureSearchKinds=['table','view','column','index','primaryKey','foreignKey','procedure','function','trigger','event'] as const;
export const postgresStructureSearchKinds = ['table', 'view', 'column', 'index', 'primaryKey', 'foreignKey', 'uniqueKey', 'check', 'sequence', 'procedure', 'function'] as const;
export const definitionSearchKinds=['table','view','procedure','function','trigger','event'] as const;
export type DefinitionSearchKind=typeof definitionSearchKinds[number];
export type StructureSearchKind=typeof structureSearchKinds[number];
export type PostgresStructureSearchKind=typeof postgresStructureSearchKinds[number];
const searchableKinds = [...new Set([...structureSearchKinds, ...postgresStructureSearchKinds])] as [StructureSearchKind | PostgresStructureSearchKind, ...(StructureSearchKind | PostgresStructureSearchKind)[]];
export const searchIdentifier=z.string().min(1).max(64).refine(value=>!/[\0\ud800-\udfff]/.test(value),'名称必须是1至64字的BMP标识符');
const postgresSearchDatabase = z.string().min(1).max(128).refine(value => !/[\0\ud800-\udfff]/u.test(value) && [...value].length <= 64);
const unique=<T>(values:T[])=>new Set(values).size===values.length;
export const structureSearchInputSchema=z.object({
  connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),
  dialect: z.literal('postgresql').optional(),
  databases:z.array(postgresSearchDatabase).min(1).max(structureSearchLimits.databases).refine(unique,'数据库不能重复'),
  kinds:z.array(z.enum(searchableKinds)).min(1).max(searchableKinds.length).refine(unique,'对象类别不能重复'),
  pattern:databaseSearchPatternSchema,maxResults:z.number().int().min(1).max(structureSearchLimits.maxHits),
  onError:z.enum(['stop','continue']),
  searchIn:z.literal('definition').optional(),
}).strict().superRefine((value, context) => {
  const postgres = value.dialect === 'postgresql';
  const allowed: readonly string[] = postgres ? postgresStructureSearchKinds : value.searchIn === 'definition' ? definitionSearchKinds : structureSearchKinds;
  if (value.kinds.some(kind => !allowed.includes(kind))) context.addIssue({ code: 'custom', path: ['kinds'],
    message: value.searchIn === 'definition' ? '定义正文按表、视图、过程、函数、触发器或事件搜索；字段和约束包含在所属表定义中'
      : '对象类别超出当前搜索范围' });
  if (!postgres && value.databases.some(database => !searchIdentifier.safeParse(database).success))
    context.addIssue({ code: 'custom', path: ['databases'], message: '名称必须是1至64字的BMP标识符' });
  if (postgres && (value.searchIn || value.pattern.text.includes('\0')))
    context.addIssue({ code: 'custom', path: ['pattern'], message: 'PostgreSQL 结构名称搜索不接受 NUL 或定义正文模式' });
});
export const structureSearchContinueSchema=z.object({connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),cursor:z.string().uuid()}).strict();
export const structureSearchReleaseSchema=structureSearchContinueSchema.omit({taskId:true});
export type StructureSearchInput=z.infer<typeof structureSearchInputSchema>;
export type StructureSearchContinue=z.infer<typeof structureSearchContinueSchema>;
export interface StructureSearchHit{database:string;kind:StructureSearchKind | PostgresStructureSearchKind;object:string;name:string;parentKind:'table'|'view'|'procedure'|'function'|'trigger'|'event'|'sequence';dialect?:'postgresql';matchedIn?:'definition';definitionCharacters?:number;definitionNavigation?:DefinitionNavigationResult}
export interface StructureSearchFailure{database:string;kind:StructureSearchHit['kind'];object?:string;message:string}
export interface StructureSearchPage{
  hits:StructureSearchHit[];failures:StructureSearchFailure[];totalHits:number;completedScopes:number;scopeCount:number;
  limitReached:boolean;stoppedOnError:boolean;cursor?:string;expiresAt?:string;
  scannedDefinitions?:number;
}
