import {z} from 'zod';
import {searchIdentifier,sqliteSearchName} from './databaseSearch';
import {postgresDataSearchName,postgresDataSearchRelation} from './dataSearch';

/** 目录只按页返回当前账号可见名称，不把补全的截断列表冒充完整搜索范围。 */
export const dataSearchCatalogueLimits={entries:100,pageBytes:128*1024} as const;
const base={connectionId:z.string().min(1).max(200),taskId:z.string().uuid(),dialect:z.enum(['postgresql','sqlite']).optional(),prefix:z.string().max(512).refine(value=>!/[\0\ud800-\udfff]/u.test(value),'目录前缀含无效字符')};
export const dataSearchCatalogueSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('databases'),after:postgresDataSearchName.optional()}).strict(),
  z.object({...base,kind:z.literal('objects'),database:postgresDataSearchName,after:postgresDataSearchRelation.optional()}).strict(),
  z.object({...base,kind:z.literal('columns'),database:postgresDataSearchName,table:postgresDataSearchRelation,objectKind:z.enum(['table','view']),after:z.string().regex(/^[1-9][0-9]{0,3}$/).refine(value=>Number(value)<=4096).optional()}).strict(),
]).superRefine((input, context) => {
  if (input.dialect === 'sqlite') {
    if (('database' in input && input.database !== 'main') || ('table' in input && !sqliteSearchName.safeParse(input.table).success) ||
        (input.kind === 'objects' && input.after !== undefined && !sqliteSearchName.safeParse(input.after).success))
      context.addIssue({ code:'custom', message:'SQLite 搜索目录只支持 main 中的准确对象名称' });
    return;
  }
  if (input.dialect) return;
  const identifiers = [input.after, 'database' in input ? input.database : undefined, 'table' in input ? input.table : undefined];
  if (input.prefix.length > 64 || /[\ud800-\udfff]/.test(input.prefix) ||
      identifiers.some(value => value !== undefined && !searchIdentifier.safeParse(value).success))
    context.addIssue({ code:'custom', message:'搜索范围目录包含无效的 MySQL 或 MariaDB 标识符' });
});
export type DataSearchCatalogueInput=z.infer<typeof dataSearchCatalogueSchema>;
export interface DataSearchCatalogueEntry{name:string;kind:'database'|'table'|'view'|'column';dataType?:string;binary?:boolean;ordinal?:number}
export interface DataSearchCataloguePage{kind:DataSearchCatalogueInput['kind'];entries:DataSearchCatalogueEntry[];next?:string;hasMore:boolean}
