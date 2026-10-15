import {z} from 'zod';
import {searchIdentifier} from './databaseSearch';

/** 目录只按页返回当前账号可见名称，不把补全的截断列表冒充完整搜索范围。 */
export const dataSearchCatalogueLimits={entries:100,pageBytes:128*1024} as const;
const base={connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),prefix:z.string().max(64).refine(value=>!/[\0\ud800-\udfff]/.test(value),'目录前缀含无效字符')};
export const dataSearchCatalogueSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('databases'),after:searchIdentifier.optional()}).strict(),
  z.object({...base,kind:z.literal('objects'),database:searchIdentifier,after:searchIdentifier.optional()}).strict(),
  z.object({...base,kind:z.literal('columns'),database:searchIdentifier,table:searchIdentifier,objectKind:z.enum(['table','view']),after:z.string().regex(/^[1-9][0-9]{0,3}$/).refine(value=>Number(value)<=4096).optional()}).strict(),
]);
export type DataSearchCatalogueInput=z.infer<typeof dataSearchCatalogueSchema>;
export interface DataSearchCatalogueEntry{name:string;kind:'database'|'table'|'view'|'column';dataType?:string;binary?:boolean;ordinal?:number}
export interface DataSearchCataloguePage{kind:DataSearchCatalogueInput['kind'];entries:DataSearchCatalogueEntry[];next?:string;hasMore:boolean}
