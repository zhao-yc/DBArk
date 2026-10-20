import { expect,it } from 'vitest';
import type { CellValue,QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter,queryResultFilterLimits,type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';

/** 使用真实筛选控制器，人工原值及下标断言，不读取数据库或执行SQL。 */
function fixture(values:CellValue[],type='TEXT'){
  const source:QueryResult={columns:[{key:'text',name:'原文',type}],rows:values.map(value=>({text:value})),truncated:false,statement:'未执行',elapsedMs:0};
  const filter=new QueryResultFilter(),binding=filter.bind(source,[])!;
  const apply=(pattern:string,operator:'like'|'notLike'='like',ignoreCase=false)=>filter.apply(binding,filter.view(binding)!,[{column:'text',operator,value:pattern,...(ignoreCase?{ignoreCase:true}:{})}],'AND');
  return{source,filter,binding,apply};
}
it.each([
  ['', [0]],['%', [0,1,2,3,4,5,6,7]],['_', [1,2,4]],['__', [3,5,6]],
  ['a%', [1,3,5,7]],['%a', [1,6]],['a_b', [7]],['%_a', [6]],['%%%a%%', [1,3,5,6,7]],
] as const)('通配%j整段按Unicode码点匹配，NULL独立，原行身份保持', (pattern,expected)=>{
  const f=fixture(['','a','😀','ab','\n','a\n','😀a','a\nb',null]),saved=structuredClone(f.source);
  const view=f.apply(pattern);expect(view.sourceIndices).toEqual(expected);view.sourceIndices.forEach((index,position)=>expect(view.result.rows[position]).toBe(f.source.rows[index]));expect(f.source).toEqual(saved);
  const selected=new Set<number>(expected);expect(f.apply(pattern,'notLike').sourceIndices).toEqual([0,1,2,3,4,5,6,7].filter(index=>!selected.has(index)));
});
it('仅显式转义%、_、反斜杠，正则符号与空白均为普通字符',()=>{
  const f=fixture(['a%b','a_b','a\\b','a.*b',' a%b ',null]);
  expect(f.apply('a\\%b').sourceIndices).toEqual([0]);expect(f.apply('a\\_b').sourceIndices).toEqual([1]);
  expect(f.apply('a\\\\b').sourceIndices).toEqual([2]);expect(f.apply('a.*b').sourceIndices).toEqual([3]);
  expect(f.apply('%a\\%b%').sourceIndices).toEqual([0,4]);
});
it.each(['\\','a\\','\\q'])('非法转义%j在零行及普通结果上完整拒绝，保留已生效视图',pattern=>{
  for(const values of [[],['a',null]] as CellValue[][]){const f=fixture(values),before=f.filter.view(f.binding);expect(()=>f.apply(pattern)).toThrow(text.patternInvalid);expect(f.filter.view(f.binding)).toBe(before);}
});
it('忽略大小写先做既有Unicode映射，再按映射后的码点匹配，不归一化',()=>{
  const f=fixture(['Ark','ARK','İ','i\u0307','é','e\u0301',null]);
  expect(f.apply('a%').sourceIndices).toEqual([]);expect(f.apply('a%','like',true).sourceIndices).toEqual([0,1]);
  expect(f.apply('_','like',true).sourceIndices).toEqual([4]);expect(f.apply('__','like',true).sourceIndices).toEqual([2,3,5]);
  expect(f.apply('İ','like',true).sourceIndices).toEqual([2,3]);expect(f.apply('é','like',true).sourceIndices).toEqual([4]);
});
it.each(['BIGINT','DECIMAL','DATETIME','BIT','未知'])('%s不因通配匹配扩大准入',type=>{
  const f=fixture([null],type),before=f.filter.view(f.binding);expect(()=>f.apply('%')).toThrow(text.invalid);expect(()=>f.apply('%','notLike')).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
});
it('BLOB字节、残留成员或上限拒绝，不解码、不清除原视图',()=>{
  const f=fixture([{type:'binary',base64:'AA=='},null],'BLOB'),before=f.filter.view(f.binding);expect(()=>f.apply('%')).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  const g=fixture(['a']),old=g.filter.view(g.binding)!;
  for(const extra of [{values:['a']},{upper:'z'}])expect(()=>g.filter.apply(g.binding,old,[{column:'text',operator:'like',value:'%',...extra}],'AND')).toThrow(text.invalid);
  expect(g.filter.view(g.binding)).toBe(old);
});
it('通配状态转移按全树累积预算拒绝，OR真值不能短路绕过，旧视图保持',()=>{
  const f=fixture(Array(100).fill('a'.repeat(1000))),before=f.filter.view(f.binding)!;
  const wildcard:QueryResultFilterRule={column:'text',operator:'like',value:'%a'.repeat(100)+'b'};
  expect(()=>f.filter.applyExpression(f.binding,before,{mode:'OR',children:[{column:'text',operator:'notNull',value:''},wildcard]})).toThrow(text.budget);
  expect(f.filter.view(f.binding)).toBe(before);expect(f.source.rows).toHaveLength(100);
  expect(f.apply('a%').sourceIndices).toHaveLength(100);
});
it('输入超限仍按旧门拒绝，不放大条件长度或原文预算',()=>{
  const f=fixture(['a']),before=f.filter.view(f.binding);expect(()=>f.apply('%'.repeat(queryResultFilterLimits.valueUnits+1))).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
});
it('被排除原行的条件值漂移也永久撤销通配视图，恢复值不能复活',()=>{
  const f=fixture(['a','b']),view=f.apply('a%');expect(view.sourceIndices).toEqual([0]);f.source.rows[1].text='c';expect(f.filter.current(f.binding)).toBe(false);f.source.rows[1].text='b';expect(f.filter.view(f.binding)).toBeUndefined();
});
it('短模式和Unicode短原文与独立有界正则预言机一致（正则仅在测试使用）',()=>{
  const values=['','a','b','%','_','\\','😀','\n','ab','a😀','😀a','a\nb'];
  const patterns=['','%','_','a','b','%a','a%','_%','a_b','\\%','\\_','\\\\','%%%','%a%a','_😀','%\\_%'];
  /** 模式来自上面固定小集合；宿主u/s正则仅作为独立比较算法，不接收用户输入。 */
  function oracle(pattern:string){let body='',escaped=false;for(const point of pattern){if(!escaped&&point==='\\'){escaped=true;continue;}body+=!escaped&&point==='%'?'.*':!escaped&&point==='_'?'.':point.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');escaped=false;}return new RegExp('^(?:'+body+')$(?!.)','us');}
  const f=fixture(values);for(const pattern of patterns)expect(f.apply(pattern).sourceIndices,pattern).toEqual(values.flatMap((value,index)=>oracle(pattern).test(value)?[index]:[]));
});
