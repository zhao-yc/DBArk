import {z} from 'zod';

/** 全库搜索只验证匹配参数；不在浏览器运行服务器正则或改写用户输入。 */
export const databaseSearchPatternLimits={units:4096,bytes:8*1024} as const;
export const databaseSearchModes=['contains','whole','prefix','regexp'] as const;
export type DatabaseSearchMode=typeof databaseSearchModes[number];

/** 拒绝孤立代理项，避免UTF-8编码替换字符后搜索了另一个值；合法补充平面字符保留。 */
function wellFormed(value:string):boolean{
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
}

export const databaseSearchPatternSchema=z.object({
  mode:z.enum(databaseSearchModes),
  text:z.string().max(databaseSearchPatternLimits.units,'搜索文字最多4096个UTF-16单元'),
  caseSensitive:z.boolean(),
}).strict().superRefine((value,context)=>{
  // 长度检查失败也可能继续refine；先界定扫描和编码工作，不能为超大输入再分配UTF-8数组。
  if(value.text.length>databaseSearchPatternLimits.units)return;
  if(!wellFormed(value.text)){context.addIssue({code:'custom',path:['text'],message:'搜索文字含无效Unicode代理项'});return;}
  if(new TextEncoder().encode(value.text).length>databaseSearchPatternLimits.bytes)context.addIssue({code:'custom',path:['text'],message:'搜索文字的UTF-8编码最多8KiB'});
  if(value.mode!=='whole'&&value.text.length===0)context.addIssue({code:'custom',path:['text'],message:'当前匹配方式需要搜索文字；查找空字符串请选择完整值'});
});
export type DatabaseSearchPattern=z.infer<typeof databaseSearchPatternSchema>;

/** 保留原始空格、NUL、反斜线与数字文本；正则是否合法由实际服务器判定。 */
export function validateDatabaseSearchPattern(value:unknown):DatabaseSearchPattern{return databaseSearchPatternSchema.parse(value);}
