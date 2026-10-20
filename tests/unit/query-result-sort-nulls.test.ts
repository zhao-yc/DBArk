import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultSort, type QueryResultSortRule } from '../../src/renderer/queryResultSort';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';

/** 常量快照保留原位置及类型；不使用数据库、浮点转换或产品比较器生成期待。 */
function fixture(type:string,values:CellValue[]){
  const source:QueryResult={columns:[{key:'k',name:'同名',type},{key:'id',name:'同名',type:'BIGINT'}],rows:values.map((k,index)=>({k,id:String(index)})),truncated:true,statement:'SELECT 原文',elapsedMs:0};
  const controller=new QueryResultSort(),binding=controller.bind(source,[])!;
  return{source,controller,binding,apply:(rules:QueryResultSortRule[])=>controller.apply(binding,controller.view(binding)!,rules)};
}

describe('本地多列排序显式NULL位置',()=>{
  it.each([
    ['ASC','FIRST',[1,3,2,0]],['DESC','FIRST',[1,3,0,2]],
    ['ASC','LAST',[2,0,1,3]],['DESC','LAST',[0,2,1,3]],
  ] as const)('%s／%s不把升降序应用到显式NULL位置', (direction,nulls,expected)=>{
    const f=fixture('BIGINT',['18446744073709551615',null,'9007199254740993',null]),saved=structuredClone(f.source);
    const rules:QueryResultSortRule[]=[{column:'k',direction,nulls}],view=f.apply(rules);
    expect(view.sourceIndices).toEqual(expected);expect(f.source).toEqual(saved);
    expect(view.rules).toEqual(rules);expect(Object.isFrozen(view.rules[0])).toBe(true);
    rules[0].nulls=nulls==='FIRST'?'LAST':'FIRST';expect(view.rules[0].nulls).toBe(nulls);
    view.sourceIndices.forEach((index,position)=>expect(view.result.rows[position]).toBe(f.source.rows[index]));
  });
  it.each([
    ['DECIMAL',['0.12345678901234567891',null,'0.12345678901234567890']],
    ['DATETIME',['2026-10-21 12:00:00.000002',null,'2026-10-21 12:00:00.000001']],
    ['TIME',['-99:59:59.999999',null,'-100:00:00.000001']],
    ['TEXT',['NULL',null,'']],['DOUBLE',[2,null,-0]],
  ] as [string,CellValue[]][])('%s仍按原精确非NULL键比较，空串和NULL字样保持独立',(type,values)=>{
    const f=fixture(type,values);
    expect(f.apply([{column:'k',direction:'ASC',nulls:'LAST'}]).sourceIndices).toEqual([2,0,1]);
    expect(f.apply([{column:'k',direction:'DESC',nulls:'FIRST'}]).sourceIndices).toEqual([1,0,2]);
  });
  it('两个NULL继续按下一优先级，提升规则和各列独立空值位置均使用完整规则',()=>{
    const f=fixture('TEXT',[null,null,'A','A']);f.source.rows[0].id='9007199254740993';f.source.rows[1].id='18446744073709551615';
    expect(f.apply([{column:'k',direction:'ASC',nulls:'LAST'},{column:'id',direction:'DESC',nulls:'FIRST'}]).sourceIndices).toEqual([3,2,1,0]);
    expect(f.apply([{column:'id',direction:'ASC',nulls:'FIRST'},{column:'k',direction:'DESC',nulls:'LAST'}]).sourceIndices).toEqual([2,3,0,1]);
  });
  it('默认位置保留旧语义，切回默认及清除返回准确原source',()=>{
    const f=fixture('TEXT',['',null,'NULL',null]);
    expect(f.apply([{column:'k',direction:'ASC'}]).sourceIndices).toEqual([1,3,0,2]);
    expect(f.apply([{column:'k',direction:'DESC'}]).sourceIndices).toEqual([2,0,1,3]);
    f.apply([{column:'k',direction:'DESC',nulls:'FIRST'}]);
    expect(f.apply([{column:'k',direction:'DESC'}]).sourceIndices).toEqual([2,0,1,3]);
    expect(f.apply([]).result).toBe(f.source);
  });
  it.each(['first','',null,0,true])('无效位置%s完整拒绝，不发布部分结果或覆盖原规则',nulls=>{
    const f=fixture('BIGINT',[null,'2','1']),view=f.apply([{column:'k',direction:'ASC',nulls:'LAST'}]);
    expect(()=>f.apply([{column:'k',direction:'DESC',nulls} as unknown as QueryResultSortRule])).toThrow(text.nullsInvalid);
    expect(f.controller.view(f.binding)).toBe(view);
  });
  it('全NULL、空结果与非NULL并列保持原位置，不引入伪造主键',()=>{
    for(const values of [[],[null,null],['1','01']] as CellValue[][]){const f=fixture('BIGINT',values);expect(f.apply([{column:'k',direction:'DESC',nulls:'FIRST'}]).sourceIndices).toEqual(values.map((_,index)=>index));}
  });
  it('显式NULL位置仍拒绝旧视图和活动键漂移，不能恢复旧复制来源',()=>{
    const f=fixture('BIGINT',[null,'1']),old=f.controller.view(f.binding)!;f.apply([{column:'k',direction:'ASC',nulls:'LAST'}]);
    expect(()=>f.controller.apply(f.binding,old,[{column:'k',direction:'ASC',nulls:'FIRST'}])).toThrow(text.stale);
    f.source.rows[0].k='2';expect(f.controller.current(f.binding)).toBe(false);f.source.rows[0].k=null;
    expect(f.controller.view(f.binding)).toBeUndefined();
  });
});
