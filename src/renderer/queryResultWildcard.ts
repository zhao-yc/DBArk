import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';

type Token = { kind:'many' } | { kind:'one' } | { kind:'literal'; value:string };

/** 固定语法转有界状态机；不编译用户正则，不受服务器sql_mode或collation影响。 */
export function compileQueryResultWildcard(pattern:string,spend:(work:number)=>void):(value:string)=>boolean {
  const tokens:Token[]=[];let escaped=false;
  for(const point of pattern){
    spend(point.length);
    if(escaped){
      if(point!=='%'&&point!=='_'&&point!=='\\')throw Error(text.patternInvalid);
      tokens.push({kind:'literal',value:point});escaped=false;
    }else if(point==='\\')escaped=true;
    else if(point==='%'){if(tokens.at(-1)?.kind!=='many')tokens.push({kind:'many'});}
    else if(point==='_')tokens.push({kind:'one'});
    else tokens.push({kind:'literal',value:point});
  }
  if(escaped)throw Error(text.patternInvalid);
  // 两个状态向量按条件复用；不按行分配，也不构造完整候选字符串数组。
  let previous=new Uint8Array(tokens.length+1),next=new Uint8Array(tokens.length+1);
  return value=>{
    spend(2*(tokens.length+1));previous.fill(0);previous[0]=1;
    for(let index=1;index<=tokens.length;index++)if(tokens[index-1].kind==='many')previous[index]=previous[index-1];
    for(const point of value){
      // 清空及逐状态转移都计入整次筛选共用预算，失败不发布部分结果。
      spend(2*(tokens.length+1));next.fill(0);
      for(let index=1;index<=tokens.length;index++){
        const token=tokens[index-1];
        next[index]=token.kind==='many'?Number(next[index-1]===1||previous[index]===1):token.kind==='one'||token.value===point?previous[index-1]:0;
      }
      const temporary=previous;previous=next;next=temporary;
    }
    return previous[tokens.length]===1;
  };
}
