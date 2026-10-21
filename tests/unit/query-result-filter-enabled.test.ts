import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter, queryResultFilterLimits, type QueryResultFilterGroup, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';

/** 只使用RAM中的精确协议原值；不连接服务器、打开客户端或读取剪贴板。 */
function fixture() {
  const source:QueryResult={columns:[{key:'id',name:'编号',type:'BIGINT'},{key:'kind',name:'分类',type:'TEXT'},{key:'amount',name:'金额',type:'DECIMAL'}],rows:[{id:'18446744073709551615',kind:'A',amount:'0.12345678901234567891'},{id:'9007199254740993',kind:'B',amount:'0.12345678901234567890'},{id:'2',kind:'A',amount:null}],truncated:true,elapsedMs:1,statement:'原SQL'};
  const filter=new QueryResultFilter(),binding=filter.bind(source,['RAM'])!;
  return{source,filter,binding,apply:(expression:QueryResultFilterGroup)=>filter.applyExpression(binding,filter.view(binding)!,expression)};
}
const rule=(column:string,value:string,enabled?:boolean):QueryResultFilterRule=>({column,operator:'eq',value,...(enabled===undefined?{}:{enabled})});
const group=(mode:'AND'|'OR',...children:(QueryResultFilterRule|QueryResultFilterGroup)[]):QueryResultFilterGroup=>({mode,children});

describe('已返回结果条件启用与停用',()=>{
  it.each(['AND','OR'] as const)('%s移除停用叶的判断，保留精确原值和原行引用',mode=>{
    const f=fixture(),saved=structuredClone(f.source),view=f.apply(group(mode,rule('kind','B',false),rule('id','2')));
    expect(view.sourceIndices).toEqual([2]);expect(view.result.rows[0]).toBe(f.source.rows[2]);expect(f.source).toEqual(saved);
    expect(view.rules[0]).toMatchObject({enabled:false,value:'B'});expect(view.expression.children[0]).toBe(view.rules[0]);
  });
  it.each(['AND','OR'] as const)('%s中仅含停用条件的多层组被省略，不产生恒真或恒假副作用',mode=>{
    const f=fixture(),inactive=group('OR',group('AND',rule('kind','A',false)));
    expect(f.apply(group(mode,inactive,rule('kind','B'))).sourceIndices).toEqual([1]);
    expect(f.apply(group(mode,inactive)).result).toBe(f.source);
    expect(f.apply(group(mode,inactive)).sourceIndices).toEqual([0,1,2]);
  });
  it('全部停用保留可重启的冻结条件，结果直接使用原source',()=>{
    const f=fixture(),values=['A','B'],leaf:QueryResultFilterRule={column:'kind',operator:'in',value:'',values,enabled:false},view=f.apply(group('OR',leaf));
    values[0]='C';leaf.enabled=true;expect(view.result).toBe(f.source);expect(view.rules[0].values).toEqual(['A','B']);expect(view.rules[0].enabled).toBe(false);
    expect(Object.isFrozen(view.expression)).toBe(true);expect(Object.isFrozen(view.rules[0])).toBe(true);expect(Object.isFrozen(view.rules[0].values)).toBe(true);
    expect(f.apply(group('OR',{...view.rules[0],enabled:true})).sourceIndices).toEqual([0,1,2]);
  });
  it('停用的坏数值及通配草稿不解析，重新启用须校验且失败保持原视图',()=>{
    const f=fixture();
    for(const leaf of [rule('id','尚未填写',false),{column:'kind',operator:'like',value:'bad\\',enabled:false}] as QueryResultFilterRule[]){
      const view=f.apply(group('AND',rule('kind','A'),leaf));expect(view.sourceIndices).toEqual([0,2]);
      expect(()=>f.apply(group('AND',rule('kind','A'),{...leaf,enabled:true}))).toThrow();expect(f.filter.view(f.binding)).toBe(view);
    }
  });
  it('停用列不读取原单元格，重新启用才读取；失败不损坏原投影',()=>{
    const f=fixture(),read=vi.fn();f.source.rows[0]=new Proxy(f.source.rows[0],{getOwnPropertyDescriptor(target,key){if(key==='amount'){read();throw Error('仅重启后读取');}return Reflect.getOwnPropertyDescriptor(target,key);}});
    const binding=f.filter.bind(f.source,['new'])!,apply=(leaf:QueryResultFilterRule)=>f.filter.applyExpression(binding,f.filter.view(binding)!,group('AND',rule('id','2'),leaf));
    const view=apply(rule('amount','0',false));expect(view.sourceIndices).toEqual([2]);expect(read).not.toHaveBeenCalled();
    expect(()=>apply(rule('amount','0',true))).toThrow('仅重启后读取');expect(read).toHaveBeenCalledOnce();expect(f.filter.view(binding)).toBe(view);
  });
  it('停用键变化不撤销当前视图，任何生效键漂移仍永久撤销',()=>{
    const f=fixture(),view=f.apply(group('AND',rule('id','2'),rule('kind','A',false)));
    f.source.rows[0].kind='变更';expect(f.filter.view(f.binding)).toBe(view);
    f.source.rows[0].id='2';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[0].id='18446744073709551615';expect(f.filter.view(f.binding)).toBeUndefined();
  });
  it.each([null,'false',0,{}])('拒绝非布尔启用标记%j，不能隐藏结构错误',enabled=>{
    const f=fixture(),before=f.filter.view(f.binding);
    expect(()=>f.apply(group('AND',{...rule('kind','A'),enabled} as QueryResultFilterRule))).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('启用标记访问器不执行，分组不能伪装成带启停的叶',()=>{
    const f=fixture(),read=vi.fn(()=>false),leaf=rule('kind','A');Object.defineProperty(leaf,'enabled',{get:read});
    expect(()=>f.apply(group('AND',leaf))).toThrow(text.invalid);expect(read).not.toHaveBeenCalled();
    expect(()=>f.apply({...group('AND',rule('kind','A')),enabled:false} as QueryResultFilterGroup)).toThrow(text.invalid);
  });
  it('停用条件仍计数、限长并验证字段／操作符／成员结构',()=>{
    const f=fixture(),leaf=rule('kind','A',false);expect(f.apply(group('AND',...Array.from({length:32},()=>leaf))).result).toBe(f.source);
    expect(()=>f.apply(group('AND',...Array.from({length:33},()=>leaf)))).toThrow(text.budget);
    expect(()=>f.apply(group('AND',{...leaf,value:'x'.repeat(queryResultFilterLimits.valueUnits+1)}))).toThrow(text.budget);
    expect(()=>f.apply(group('AND',{...leaf,column:'隐藏字段'}))).toThrow(text.invalid);
    expect(()=>f.apply(group('AND',{...leaf,operator:'between'}))).toThrow(text.invalid);
    expect(()=>f.apply(group('AND',{...leaf,operator:'in',value:'',values:new Array(1)}))).toThrow(text.invalid);
  });
  it('停用成员保存不执行外部数组迭代器',()=>{
    const f=fixture(),values=['A'],iterate=vi.fn(()=>{throw Error('不得调用');});Object.defineProperty(values,Symbol.iterator,{value:iterate});
    expect(f.apply(group('AND',{column:'kind',operator:'in',value:'',values,enabled:false})).rules[0].values).toEqual(['A']);expect(iterate).not.toHaveBeenCalled();
  });
});
