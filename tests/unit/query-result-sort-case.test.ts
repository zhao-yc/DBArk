import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultSort, queryResultSortSupportsIgnoreCase, type QueryResultSortRule } from '../../src/renderer/queryResultSort';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';

/** 人工常量给出顺序，不用产品比较器计算期待，也不访问数据库或桌面。 */
function fixture(type:string,values:CellValue[],ids=values.map((_,i)=>String(i)),idType='BIGINT'){
  const source:QueryResult={columns:[{key:'k',name:'原文',type},{key:'id',name:'编号',type:idType}],rows:values.map((k,i)=>({k,id:ids[i]})),truncated:false,statement:'SELECT 原文',elapsedMs:0};
  const controller=new QueryResultSort(),binding=controller.bind(source,[])!;
  return{source,controller,binding,apply:(rules:QueryResultSortRule[])=>controller.apply(binding,controller.view(binding)!,rules)};
}

describe('本地每列文本排序的大小写选项',()=>{
  it('默认保持原大小写顺序，明确选项才合并比较键，清除恢复准确原来源',()=>{
    const f=fixture('TEXT',['a','B','A','b',null,'']),saved=structuredClone(f.source);
    expect(f.apply([{column:'k',direction:'ASC'}]).sourceIndices).toEqual([4,5,2,1,0,3]);
    expect(f.apply([{column:'k',direction:'ASC',ignoreCase:true}]).sourceIndices).toEqual([4,5,0,2,1,3]);
    expect(f.apply([{column:'k',direction:'DESC',ignoreCase:true}]).sourceIndices).toEqual([1,3,0,2,5,4]);
    expect(f.apply([{column:'k',direction:'ASC',ignoreCase:false}]).sourceIndices).toEqual([4,5,2,1,0,3]);
    expect(f.apply([]).result).toBe(f.source);expect(f.source).toEqual(saved);
  });
  it('Unicode扩展按小写映射保留重音及组合形式，不把SS等同于德语字母',()=>{
    const f=fixture('VARCHAR',['İ','i\u0307','SS','ß','é','e\u0301']);
    const view=f.apply([{column:'k',direction:'ASC',ignoreCase:true}]);
    expect(view.sourceIndices).toEqual([5,0,1,2,3,4]);expect(view.result.rows.map(row=>row.k)).toEqual(['e\u0301','İ','i\u0307','SS','ß','é']);
    view.sourceIndices.forEach((index,i)=>expect(view.result.rows[i]).toBe(f.source.rows[index]));
  });
  it.each([
    ['ASC','FIRST',[2,4,0,1,3]],['ASC','LAST',[4,0,1,3,2]],
    ['DESC','FIRST',[2,3,0,1,4]],['DESC','LAST',[3,0,1,4,2]],
  ] as const)('%s/%s同时保留显式NULL位置、空串及原序稳定性',(direction,nulls,expected)=>{
    const f=fixture('TEXT',['a','A',null,'B','']);expect(f.apply([{column:'k',direction,nulls,ignoreCase:true}]).sourceIndices).toEqual(expected);
  });
  it('相同小写键继续比较精确BIGINT，不沿前次大小写顺序或转Number',()=>{
    const f=fixture('TEXT',['a','A','a'],['18446744073709551615','9007199254740993','2']);
    f.apply([{column:'k',direction:'ASC'}]);
    expect(f.apply([{column:'k',direction:'ASC',ignoreCase:true},{column:'id',direction:'ASC'}]).sourceIndices).toEqual([2,1,0]);
  });
  it('后续DECIMAL仍保留全部小数位，数值并列再按原位置稳定',()=>{
    const f=fixture('TEXT',['a','A','a'],['0.12345678901234567891','0.12345678901234567890','0.12345678901234567890'],'DECIMAL');
    expect(f.apply([{column:'k',direction:'ASC',ignoreCase:true},{column:'id',direction:'ASC'}]).sourceIndices).toEqual([1,2,0]);
  });
  it('空结果及全NULL不生成文本键或伪造行，仍保留原列和原行引用',()=>{
    for(const values of [[],[null,null]] as CellValue[][]){const f=fixture('TEXT',values),view=f.apply([{column:'k',direction:'DESC',ignoreCase:true,nulls:'LAST'}]);expect(view.sourceIndices).toEqual(values.map((_,i)=>i));expect(view.result.columns).toBe(f.source.columns);}
  });
  it('完整规则冻结，外部修改选项不能改变已应用视图，旧视图也不能重领',()=>{
    const f=fixture('TEXT',['a','B','A']),rules:QueryResultSortRule[]=[{column:'k',direction:'ASC',ignoreCase:true,nulls:'LAST'}],old=f.controller.view(f.binding)!;
    const view=f.apply(rules);rules[0].ignoreCase=false;
    expect(view.rules).toEqual([{column:'k',direction:'ASC',ignoreCase:true,nulls:'LAST'}]);expect(Object.isFrozen(view.rules[0])).toBe(true);
    expect(()=>f.controller.apply(f.binding,old,rules)).toThrow(text.stale);
  });
  it.each(['BIGINT','DECIMAL','DATETIME','TIME','DOUBLE'])('%s不获得文本比较资格，显式false也拒绝无关选项',type=>{
    const value=type==='DATETIME'?'2026-10-21 12:00:00':type==='TIME'?'12:00:00':type==='DOUBLE'?1:'1';
    const f=fixture(type,[value]);expect(queryResultSortSupportsIgnoreCase(f.source.columns[0])).toBe(false);const before=f.controller.view(f.binding);
    for(const ignoreCase of [true,false])expect(()=>f.apply([{column:'k',direction:'ASC',ignoreCase}])).toThrow(text.caseInvalid);
    expect(f.controller.view(f.binding)).toBe(before);
  });
  it.each([null,1,'true',{}])('拒绝非布尔选项%s且原视图保持',value=>{
    const f=fixture('TEXT',['a','B']),before=f.controller.view(f.binding);
    expect(()=>f.apply([{column:'k',direction:'ASC',ignoreCase:value as boolean}])).toThrow(text.caseInvalid);expect(f.controller.view(f.binding)).toBe(before);
  });
  it('源原文即使只改变大小写、比较键不变，也永久撤销旧租约',()=>{
    const f=fixture('TEXT',['a','B']);f.apply([{column:'k',direction:'ASC',ignoreCase:true}]);
    f.source.rows[0].k='A';expect(f.controller.current(f.binding)).toBe(false);f.source.rows[0].k='a';expect(f.controller.view(f.binding)).toBeUndefined();
  });
  it('转换产生的额外字符共同消耗原预算，超限保持先前大小写敏感视图',()=>{
    const f=fixture('TEXT',Array(1500).fill('İ'.repeat(2048)));const before=f.apply([{column:'k',direction:'ASC'}]);
    expect(()=>f.apply([{column:'k',direction:'ASC',ignoreCase:true}])).toThrow(text.budget);expect(f.controller.view(f.binding)).toBe(before);expect(f.source.rows[0].k).toBe('İ'.repeat(2048));
  });
});
