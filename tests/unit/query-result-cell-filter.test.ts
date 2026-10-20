import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { appendQueryResultFilterRule, QueryResultFilter, type QueryResultFilterGroup, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { captureQueryResultCellFilter, currentQueryResultCellFilter, queryResultCellFilterRule } from '../../src/renderer/queryResultCellFilter';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';

/** 只用原格RAM对象，验证协议精度和唯一键，不连接数据库或触碰文件及剪贴板。 */
function fixture(value:CellValue,type='TEXT'){
  const columns=[{key:'k',name:'重复别名',type},{key:'other',name:'重复别名',type:'TEXT'}],rows=[{k:value,other:'不能选择另一列'}],cell={index:0,row:rows[0],column:columns[0]};
  return{columns,rows,cell,capture:()=>captureQueryResultCellFilter(columns,rows,cell)};
}
describe('当前单元格筛选的精确原值捕获',()=>{
  it.each([
    ['BIGINT','18446744073709551615'],['DECIMAL','0.12345678901234567891'],['DATETIME','2026-10-20 12:00:00.123456'],['TIME','-100:00:00.000001'],['TEXT','  A,%_.*\nNULL  '],['TEXT',''],['DOUBLE',1.25],
  ] as [string,CellValue][])('%s只填当前唯一键及完整原值，正反条件不生成SQL',(type,value)=>{
    const f=fixture(value,type),capture=f.capture();expect(queryResultCellFilterRule(capture,'eq')).toEqual({column:'k',operator:'eq',value:String(value)});expect(queryResultCellFilterRule(capture,'ne').operator).toBe('ne');expect(currentQueryResultCellFilter(capture,f.columns,f.rows)).toBe(true);expect(capture.cell.row).toBe(f.rows[0]);expect(Object.isFrozen(capture)).toBe(true);
  });
  it.each(['TEXT','BIGINT','GEOMETRY'])('%s的NULL单独映射为NULL／非NULL，不写成字符串NULL',type=>{
    const f=fixture(null,type),capture=f.capture();expect(queryResultCellFilterRule(capture,'eq')).toEqual({column:'k',operator:'null',value:''});expect(queryResultCellFilterRule(capture,'ne')).toEqual({column:'k',operator:'notNull',value:''});
  });
  it.each([['BIGINT',9007199254740992],['TEXT',true],['GEOMETRY','原值'],['DECIMAL','坏值'],['DOUBLE',Infinity],['BLOB',{type:'binary',base64:'QQ=='}]] as [string,CellValue][])('%s不猜测不可靠或字节原值', (type,value)=>{
    const f=fixture(value,type);expect(()=>f.capture()).toThrow();
  });
  it('缺失、继承和访问器原格拒绝，不执行getter或解码字节',()=>{
    const f=fixture('A'),getter=vi.fn(()=> 'A');Object.defineProperty(f.rows[0],'k',{get:getter,configurable:true});expect(()=>f.capture()).toThrow(text.cellUnavailable);expect(getter).not.toHaveBeenCalled();
    const inherited=Object.create({k:'A'});expect(()=>captureQueryResultCellFilter(f.columns,[inherited],{...f.cell,row:inherited})).toThrow(text.cellUnavailable);
    const binary={type:'binary' as const,base64:''};Object.defineProperty(binary,'base64',{get:getter});expect(()=>fixture(binary,'BLOB').capture()).toThrow(text.cellUnavailable);expect(getter).not.toHaveBeenCalled();
  });
  it('行位置、可见列身份和元数据漂移都能识别，不索引重复别名',()=>{
    const f=fixture('A'),capture=f.capture();expect(currentQueryResultCellFilter(capture,[f.columns[1]],f.rows)).toBe(false);expect(currentQueryResultCellFilter(capture,f.columns,[{...f.rows[0]}])).toBe(false);
    f.columns[0].name='变更';expect(currentQueryResultCellFilter(capture,f.columns,f.rows)).toBe(false);f.columns[0].name=capture.name;f.rows[0].k='B';expect(currentQueryResultCellFilter(capture,f.columns,f.rows)).toBe(false);
    expect(()=>captureQueryResultCellFilter(f.columns,f.rows,{...f.cell,index:1})).toThrow(text.cellUnavailable);
  });
  it('过长原文完整拒绝，原型形状的唯一键仍按自有数据属性读取',()=>{
    expect(()=>fixture('A'.repeat(4097)).capture()).toThrow(text.budget);
    const column={key:'__proto__',name:'原型形状',type:'TEXT'},row=Object.defineProperty({},'__proto__',{value:'原文',enumerable:true});const capture=captureQueryResultCellFilter([column],[row],{index:0,row,column});expect(queryResultCellFilterRule(capture,'eq').value).toBe('原文');
  });
});

const rule=(value:string):QueryResultFilterRule=>({column:'k',operator:'eq',value});
const group=(mode:'AND'|'OR',...children:(QueryResultFilterRule|QueryResultFilterGroup)[]):QueryResultFilterGroup=>({mode,children});
/** 原控制器生成已生效树后再追加草稿，保持原投影直到显式应用。 */
function expressionFixture(expression:QueryResultFilterGroup){const source:QueryResult={columns:[{key:'k',name:'文本',type:'TEXT'}],rows:[{k:'A'},{k:'B'},{k:null}],elapsedMs:1,truncated:false,statement:'原SQL'},filter=new QueryResultFilter(),binding=filter.bind(source,[])!,view=filter.applyExpression(binding,filter.view(binding)!,expression);return{filter,binding,view};}
describe('单元格条件追加的AND括号与结构预算',()=>{
  it('原OR整体保留为子组，未应用不改变旧视图，最终不是追加OR',()=>{
    const f=expressionFixture(group('OR',rule('A'),rule('B'))),next=appendQueryResultFilterRule(f.view.expression,rule('A'));
    expect(next).toEqual(group('AND',group('OR',rule('A'),rule('B')),rule('A')));expect(f.filter.view(f.binding)).toBe(f.view);expect(f.filter.applyExpression(f.binding,f.view,next).sourceIndices).toEqual([0]);expect(f.view.expression.mode).toBe('OR');expect(Object.isFrozen(next)).toBe(true);
  });
  it('空根生成单个AND条件，已有AND不额外消耗组或深度',()=>{
    const empty=expressionFixture(group('OR'));expect(appendQueryResultFilterRule(empty.view.expression,rule('A'))).toEqual(group('AND',rule('A')));
    const f=expressionFixture(group('AND',rule('A')));expect(appendQueryResultFilterRule(f.view.expression,rule('B'))).toEqual(group('AND',rule('A'),rule('B')));
  });
  it('32条、16组和8层的边界拒绝新增扩张，不改变旧应用树',()=>{
    const full=expressionFixture(group('AND',...Array.from({length:32},()=>rule('A'))));expect(()=>appendQueryResultFilterRule(full.view.expression,rule('A'))).toThrow(text.budget);expect(full.filter.view(full.binding)).toBe(full.view);
    const many=expressionFixture(group('OR',...Array.from({length:15},()=>group('AND',rule('A')))));expect(()=>appendQueryResultFilterRule(many.view.expression,rule('A'))).toThrow(text.budget);
    let nested=group('OR',rule('A'));for(let i=1;i<8;i++)nested=group('OR',nested);const deep=expressionFixture(nested);expect(()=>appendQueryResultFilterRule(deep.view.expression,rule('A'))).toThrow(text.budget);
  });
  it('不执行组自定义迭代器或新增叶访问器，也不改已有大小写标记',()=>{
    const children=[{...rule('a'),ignoreCase:true}],iterator=vi.fn(()=>{throw Error('禁止调用');});Object.defineProperty(children,Symbol.iterator,{value:iterator});const next=appendQueryResultFilterRule({mode:'AND',children},rule('B'));expect((next.children[0] as QueryResultFilterRule).ignoreCase).toBe(true);expect(iterator).not.toHaveBeenCalled();
    const getter=vi.fn(()=> 'A');expect(()=>appendQueryResultFilterRule(group('AND'),Object.defineProperty(rule('A'),'value',{get:getter}))).toThrow(text.invalid);expect(getter).not.toHaveBeenCalled();
  });
});
