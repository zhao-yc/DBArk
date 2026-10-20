import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter, queryResultFilterLimits, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';

/** 只用RAM常量验证原控制器，不连接数据库或触及文件、窗口及系统剪贴板。 */
function fixture(values:CellValue[]=['Ark','ARK','ark','Bark','',null],type='TEXT'){
  const source:QueryResult={columns:[{key:'k',name:'文本',type}],rows:values.map(k=>({k})),elapsedMs:1,statement:'原SQL',truncated:true},filter=new QueryResultFilter(),binding=filter.bind(source,[])!;
  return{source,filter,binding,apply:(...rules:QueryResultFilterRule[])=>filter.apply(binding,filter.view(binding)!,rules,'AND')};
}
const rule=(operator:QueryResultFilterRule['operator']='eq',value='ARK'):QueryResultFilterRule=>({column:'k',operator,value,ignoreCase:true});

describe('已返回文本条件显式忽略大小写',()=>{
  it.each([
    ['eq',[0,1,2]],['ne',[3,4]],['contains',[0,1,2,3]],['notContains',[4]],
    ['startsWith',[0,1,2]],['notStartsWith',[3,4]],['endsWith',[0,1,2,3]],['notEndsWith',[4]],
  ] as const)('%s默认敏感，显式映射后按字面匹配且否定仍排除NULL',(operator,expected)=>{
    const f=fixture(),saved=structuredClone(f.source),input=rule(operator),view=f.apply(input);
    expect(view.sourceIndices).toEqual(expected);view.sourceIndices.forEach((index,i)=>expect(view.result.rows[i]).toBe(f.source.rows[index]));expect(f.source).toEqual(saved);
    input.ignoreCase=false;expect(f.apply(input).sourceIndices).toEqual(operator.startsWith('not')||operator==='ne'?[0,2,3,4]:[1]);
    expect(view.rules[0].ignoreCase).toBe(true);expect(Object.isFrozen(view.rules[0])).toBe(true);
  });
  it('混合敏感与不敏感规则各用自己的键，多值保持原文、空串与NULL独立',()=>{
    const f=fixture();expect(f.apply(rule(),{column:'k',operator:'eq',value:'Ark'}).sourceIndices).toEqual([0]);
    const values=['aRK',''],view=f.apply({...rule('in',''),values});expect(view.sourceIndices).toEqual([0,1,2,4]);expect(view.rules[0].values).toEqual(['aRK','']);values[0]='BARK';expect(view.rules[0].values).toEqual(['aRK','']);
    expect(f.apply({...rule('notIn',''),values:['aRK','']}).sourceIndices).toEqual([3]);
  });
  it('不做locale、重音去除、Unicode规范化或完整大小写折叠，不解析通配符',()=>{
    const f=fixture(['İ','I','i','i\u0307','é','É','e\u0301','ß','SS','%_.*']);
    expect(f.apply(rule('eq','İ')).sourceIndices).toEqual([0,3]);expect(f.apply(rule('eq','I')).sourceIndices).toEqual([1,2]);
    expect(f.apply(rule('eq','É')).sourceIndices).toEqual([4,5]);expect(f.apply(rule('eq','SS')).sourceIndices).toEqual([8]);expect(f.apply(rule('contains','%_.*')).sourceIndices).toEqual([9]);
  });
  it.each(['BIGINT','DECIMAL','DATETIME','BIT'])('%s拒绝隐藏大小写选项，零行也必须校验',type=>{
    const f=fixture([],type),before=f.filter.view(f.binding);expect(()=>f.apply(rule())).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('NULL和空文本判断拒绝隐藏选项，不执行大小写字段访问器',()=>{
    const f=fixture(),before=f.filter.view(f.binding);for(const operator of ['null','notNull','empty','notEmpty'] as const)expect(()=>f.apply(rule(operator,''))).toThrow(text.invalid);
    const getter=vi.fn(()=>true),input=Object.defineProperty(rule(),'ignoreCase',{get:getter});expect(()=>f.apply(input)).toThrow(text.invalid);expect(getter).not.toHaveBeenCalled();expect(f.filter.view(f.binding)).toBe(before);
    expect(()=>f.apply({...rule(),ignoreCase:'true'} as unknown as QueryResultFilterRule)).toThrow(text.invalid);
  });
  it('字节包装不能因忽略大小写转为字符串',()=>{
    const f=fixture([{type:'binary',base64:'QQ=='}],'BLOB');expect(()=>f.apply(rule('contains','A'))).toThrow(text.value);
  });
  it('映射扩展后的原值与输入都受4096单位限制，失败保持原视图',()=>{
    const f=fixture(['İ'.repeat(queryResultFilterLimits.valueUnits)]),before=f.filter.view(f.binding);expect(()=>f.apply(rule())).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
    const empty=fixture([]);expect(()=>empty.apply(rule('eq','İ'.repeat(queryResultFilterLimits.valueUnits)))).toThrow(text.budget);
  });
  it('原文加映射共同使用8Mi单位预算，同列重复条件只准备一套映射值',()=>{
    const value='A'.repeat(4096),f=fixture(Array.from({length:1022},()=>value));expect(f.apply(rule('eq',value),rule('eq',value)).sourceIndices).toHaveLength(1022);
    const large=fixture(Array.from({length:1023},()=>value));expect(()=>large.apply(rule('eq',value),rule('eq',value))).toThrow(text.budget);
  });
  it('过滤后的排序仍按原大小写，原值漂移撤销已生效键且恢复不能复活',()=>{
    const f=fixture(),view=f.apply(rule()),sort=new QueryResultSort(),binding=sort.bind(view.result,[])!;
    expect(sort.apply(binding,sort.view(binding)!,[{column:'k',direction:'ASC'}]).result.rows.map(row=>row.k)).toEqual(['ARK','Ark','ark']);
    f.source.rows[0].k='ark';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[0].k='Ark';expect(()=>f.filter.apply(f.binding,view,[rule()],'AND')).toThrow(text.stale);
  });
});
