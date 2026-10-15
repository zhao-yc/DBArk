import {z} from 'zod';
import {validateDatabaseSearchPattern} from '../shared/databaseSearchPattern';
import {identifier} from './sql';

const name=z.string().min(1).max(64).refine(value=>!/[\0\ud800-\udfff]/.test(value),'搜索列名必须是1至64字的BMP标识符');
const columnSchema=z.object({column:name,qualifier:name.optional(),representation:z.enum(['text','hex']).default('text')}).strict();
export interface DatabaseSearchColumn{column:string;qualifier?:string;representation?:'text'|'hex'}
export interface DatabaseSearchPredicate{sql:string;params:string[]}

/** 名称只走逐段引用，值只走预处理参数；HEX表示搜索可见十六进制文本，不冒充字节边界查找。 */
export function databaseSearchMatch(columnInput:DatabaseSearchColumn,patternInput:unknown):DatabaseSearchPredicate{
  const column=columnSchema.parse(columnInput),pattern=validateDatabaseSearchPattern(patternInput);
  const qualified=(column.qualifier===undefined?'':identifier(column.qualifier)+'.')+identifier(column.column);
  const expression=column.representation==='hex'?'HEX('+qualified+')':qualified;
  const text='CONVERT('+expression+' USING utf8mb4)',parameter='CONVERT(? USING utf8mb4)';
  if(pattern.mode==='regexp'){
    // MySQL8正则拒绝二进制字符串；使用文本字符集和明确排序规则，保留各服务器自己的正则语义。
    const collation=pattern.caseSensitive?'utf8mb4_bin':'utf8mb4_unicode_ci';
    return{sql:text+' COLLATE '+collation+' REGEXP '+parameter+' COLLATE '+collation,params:[pattern.text]};
  }
  const left=pattern.caseSensitive?text:'LOWER('+text+')',right=pattern.caseSensitive?parameter:'LOWER('+parameter+')';
  if(pattern.mode==='whole'){
    // 完整值比较保留尾空格，不把PAD SPACE排序规则的等价值误报成原值相同。
    return{sql:'CAST('+left+' AS BINARY) = CAST('+right+' AS BINARY)',params:[pattern.text]};
  }
  const escaped=pattern.text.replace(/[!%_]/g,value=>'!'+value),value=(pattern.mode==='contains'?'%':'')+escaped+'%';
  return{sql:left+" COLLATE utf8mb4_bin LIKE "+right+" COLLATE utf8mb4_bin ESCAPE '!'",params:[value]};
}
