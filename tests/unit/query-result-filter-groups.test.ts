import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter, queryResultFilterLimits, type QueryResultFilterGroup, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';

/** 仅RAM常量，覆盖真实控制器；不连接数据库或操作窗口、文件和剪贴板。 */
function fixture(empty=false){
  const source:QueryResult={columns:[{key:'id',name:'同名',type:'BIGINT'},{key:'kind',name:'同名',type:'TEXT'},{key:'amount',name:'金额',type:'DECIMAL'}],rows:empty?[]:[{id:'18446744073709551615',kind:'A',amount:'0.12345678901234567891'},{id:'9007199254740993',kind:'B',amount:'0.12345678901234567890'},{id:'2',kind:'A',amount:'-0.00000000000000000001'},{id:'3',kind:null,amount:null}],truncated:true,elapsedMs:1,statement:'原SQL'},filter=new QueryResultFilter(),binding=filter.bind(source,['RAM'])!;
  return{source,filter,binding,apply:(expression:QueryResultFilterGroup)=>filter.applyExpression(binding,filter.view(binding)!,expression)};
}
const rule=(column:string,value:string,operator:QueryResultFilterRule['operator']='eq'):QueryResultFilterRule=>({column,operator,value});
const group=(mode:'AND'|'OR',...children:(QueryResultFilterRule|QueryResultFilterGroup)[]):QueryResultFilterGroup=>({mode,children});

describe('已返回结果的有界分组条件',()=>{
  it('括号组合保留精确键及原行引用，不等价于整棵平铺AND或OR',()=>{
    const f=fixture(),saved=structuredClone(f.source),view=f.apply(group('AND',group('OR',rule('kind','A'),rule('kind','B')),rule('amount','0','gt')));
    expect(view.sourceIndices).toEqual([0,1]);expect(view.result.rows).toEqual([f.source.rows[0],f.source.rows[1]]);expect(view.result.rows[0]).toBe(f.source.rows[0]);expect(f.source).toEqual(saved);
    expect(f.apply(group('OR',rule('id','2'),group('AND',rule('kind','A'),rule('amount','0','gt')))).sourceIndices).toEqual([0,2]);
  });
  it('三层混合组合不把精确DECIMAL或大整数转成浮点，NULL只经显式条件纳入',()=>{
    const f=fixture();expect(f.apply(group('AND',group('OR',rule('id','18446744073709551615'),group('AND',rule('id','9007199254740993'),rule('amount','0.12345678901234567890'))),rule('kind','','notNull'))).sourceIndices).toEqual([0,1]);
    expect(f.apply(group('OR',group('AND',rule('kind','A','ne'),rule('amount','0','gt')),rule('kind','','null'))).sourceIndices).toEqual([1,3]);
  });
  it('已满足的OR以及零行仍拒绝后续坏成员或字段，失败保持旧视图',()=>{
    for(const empty of [false,true]){const f=fixture(empty),before=f.filter.view(f.binding)!;expect(()=>f.apply(group('OR',rule('kind','','notNull'),group('AND',{...rule('id','','in'),values:['2','坏值']})))).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);expect(()=>f.apply(group('AND',group('OR',rule('不存在','A'))))).toThrow(text.invalid);}
  });
  it('空根仍返回准确原source，空子组明确拒绝且不把它当恒真条件',()=>{
    const f=fixture();expect(f.apply(group('OR')).result).toBe(f.source);const previous=f.apply(group('AND',rule('kind','A')));expect(()=>f.apply(group('OR',rule('kind','B'),group('AND')))).toThrow(text.emptyGroup);expect(f.filter.view(f.binding)).toBe(previous);
  });
  it('自引用和间接循环不递归溢出，也不撤销原有效视图',()=>{
    const f=fixture(),before=f.filter.view(f.binding)!,a:QueryResultFilterGroup={mode:'AND',children:[]},b:QueryResultFilterGroup={mode:'OR',children:[a]};(a.children as QueryResultFilterGroup[]).push(b);expect(()=>f.apply(a)).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('深度和分组数分别受限，边界树仍可正常应用',()=>{
    const f=fixture();let expression=group('AND',rule('kind','A'));for(let i=1;i<queryResultFilterLimits.depth;i++)expression=group('OR',expression);expect(f.apply(expression).sourceIndices).toEqual([0,2]);expect(()=>f.apply(group('AND',expression))).toThrow(text.budget);
    expect(f.apply(group('OR',...Array.from({length:15},()=>group('AND',rule('kind','A'))))).sourceIndices).toEqual([0,2]);expect(()=>f.apply(group('OR',...Array.from({length:16},()=>group('AND',rule('kind','A')))))).toThrow(text.budget);
  });
  it('分散在各组的叶条件仍共同受32条限制，不能以分组扩大预算',()=>{
    const f=fixture(),branch=()=>group('OR',...Array.from({length:16},()=>rule('kind','A')));expect(f.apply(group('AND',branch(),branch())).sourceIndices).toEqual([0,2]);expect(()=>f.apply(group('AND',branch(),branch(),rule('kind','B')))).toThrow(text.budget);
  });
  it('分组、数组和叶字段访问器不执行，稀疏或带混合结构的节点拒绝',()=>{
    const f=fixture(),getter=vi.fn(()=>[]),bad=[Object.defineProperty({mode:'AND'},'children',{get:getter}),{mode:'AND',children:[Object.defineProperty(rule('kind','A'),'value',{get:getter})]},{mode:'AND',children:new Array(1)},{mode:'AND',children:[{...rule('kind','A'),mode:'OR'}]},{mode:'AND',children:[],column:'kind'}];
    for(const input of bad)expect(()=>f.apply(input as QueryResultFilterGroup)).toThrow(text.invalid);expect(getter).not.toHaveBeenCalled();
    const children=[rule('kind','A')];Object.defineProperty(children,'0',{get:getter});expect(()=>f.apply({mode:'AND',children})).toThrow(text.invalid);expect(getter).not.toHaveBeenCalled();
  });
  it('不调用子数组自定义迭代器，读取期间长度变化完整拒绝',()=>{
    const f=fixture(),iterator=vi.fn(()=>{throw Error('不应执行');}),children=[rule('kind','A')];Object.defineProperty(children,Symbol.iterator,{value:iterator});expect(f.apply({mode:'AND',children}).sourceIndices).toEqual([0,2]);expect(iterator).not.toHaveBeenCalled();
    const source=[rule('kind','A')],changing=new Proxy(source,{getOwnPropertyDescriptor(target,key){const value=Reflect.getOwnPropertyDescriptor(target,key);if(key==='0')target.push(rule('kind','B'));return value;}});expect(()=>f.apply({mode:'OR',children:changing})).toThrow(text.invalid);
  });
  it('超宽树在读取子节点前拒绝，循环和组数量不扩张原行比较预算',()=>{
    const f=fixture(),read=vi.fn(()=>rule('kind','A')),wide=new Array(49);Object.defineProperty(wide,0,{get:read});expect(()=>f.apply({mode:'AND',children:wide})).toThrow(text.budget);expect(read).not.toHaveBeenCalled();
    const source:QueryResult={...f.source,rows:Array.from({length:100000},()=>({id:null,kind:null,amount:null}))},filter=new QueryResultFilter(),binding=filter.bind(source,[])!,before=filter.view(binding)!;
    const expression=group('OR',group('AND',...Array.from({length:11},()=>rule('kind','','null'))),group('OR',...Array.from({length:10},()=>rule('kind','','null'))));expect(()=>filter.applyExpression(binding,before,expression)).toThrow(text.budget);expect(filter.view(binding)).toBe(before);
  });
  it('已应用树、叶和成员数组全部独立冻结，改原输入不改变已生效结果',()=>{
    const f=fixture(),values=['A'],leaf={...rule('kind','','in'),values},branch=group('OR',leaf),expression=group('AND',branch),view=f.apply(expression);values[0]='B';leaf.column='id';(branch.children as QueryResultFilterRule[]).push(rule('kind','B'));
    expect(view.sourceIndices).toEqual([0,2]);expect(view.expression).toEqual(group('AND',group('OR',{...rule('kind','','in'),values:['A']})));expect(Object.isFrozen(view.expression)).toBe(true);expect(Object.isFrozen(view.expression.children)).toBe(true);const saved=view.expression.children[0] as QueryResultFilterGroup;expect(Object.isFrozen(saved)).toBe(true);expect(saved.children[0]).toBe(view.rules[0]);expect(Object.isFrozen(view.rules[0].values)).toBe(true);
  });
  it('被排除行的活动条件仍观察漂移，旧分组不能复活或撤销较新租约',()=>{
    const f=fixture(),expression=group('AND',group('OR',rule('kind','A'))),view=f.apply(expression);f.source.rows[1].kind='A';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[1].kind='B';expect(()=>f.filter.applyExpression(f.binding,view,expression)).toThrow(text.stale);const next=f.filter.bind(f.source,['new'])!;expect(()=>f.filter.applyExpression(f.binding,view,expression)).toThrow(text.stale);expect(f.filter.current(next)).toBe(true);
  });
});
