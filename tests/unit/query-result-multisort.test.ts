import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult, SortRule } from '../../src/shared/contracts';
import { QueryResultSort, queryResultSortLimits } from '../../src/renderer/queryResultSort';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';

/** 仅协议原值与RAM对象；组键故意与次级键相反，不能只排最后一列。 */
function fixture(type='DECIMAL', values:CellValue[]=['2','1','1',null]) {
  const source:QueryResult={columns:[{key:'group',name:'同名',type:'TEXT'},{key:'value',name:'同名',type},{key:'third',name:'末级',type:'BIGINT'}],rows:values.map((value,i)=>({group:i===values.length-1?'B':'A',value,third:String(i)})),truncated:true,statement:'SELECT 原语句',elapsedMs:1};
  const sorter=new QueryResultSort(),binding=sorter.bind(source,['owner'])!;
  return{source,sorter,binding,apply:(rules:SortRule[])=>sorter.apply(binding,sorter.view(binding)!,rules)};
}
const group:SortRule={column:'group',direction:'ASC'},value:SortRule={column:'value',direction:'ASC'},third:SortRule={column:'third',direction:'DESC'};

describe('多列优先级比较和来源身份',()=>{
  it('完整数组按优先级逐键比较，末级后并列保持原位置，调整优先级改变结果',()=>{
    const f=fixture(),raw=f.source.rows,saved=structuredClone(f.source),view=f.apply([group,value,third]);expect(view.sourceIndices).toEqual([2,1,0,3]);expect(view.rules).toEqual([group,value,third]);
    expect(f.apply([value,group,third]).sourceIndices).toEqual([3,2,1,0]);expect(f.apply([group,{...value,direction:'DESC'}]).sourceIndices).toEqual([0,1,2,3]);
    view.sourceIndices.forEach((index,i)=>expect(view.result.rows[i]).toBe(raw[index]));expect(view.result.columns).toBe(f.source.columns);expect(f.source).toEqual(saved);expect(f.apply([]).result).toBe(f.source);
  });
  it.each([
    ['BIGINT',['9007199254740993','9007199254740992','9007199254740992',null]],
    ['NEWDECIMAL',['0.12345678901234567891','0.12345678901234567890','0.12345678901234567890',null]],
    ['DATETIME',['2026-10-19 12:00:00.000002','2026-10-19 12:00:00.000001','2026-10-19 12:00:00.000001',null]],
    ['TIME',['-99:59:59.999999','-100:00:00.000001','-100:00:00.000001',null]],
    ['TEXT',['A','', '',null]],
  ] as [string,CellValue[]][])('%s次级键保留原精度/空值语义，三级键只打破真正相等值', (type,values)=>{
    const f=fixture(type,values);expect(f.apply([group,value,third]).sourceIndices).toEqual([2,1,0,3]);expect(f.apply([group,{...value,direction:'DESC'},third]).sourceIndices).toEqual([0,2,1,3]);
  });
  it('每一级NULL都遵守本级方向，所有级别相等时升降都保留原返回次序',()=>{
    const f=fixture('TEXT',[null,'','',null]);f.source.rows.forEach(row=>{row.group='A';row.third='0';});const b=f.sorter.bind(f.source,[])!;
    expect(f.sorter.apply(b,f.sorter.view(b)!,[group,value,third]).sourceIndices).toEqual([0,3,1,2]);expect(f.sorter.apply(b,f.sorter.view(b)!,[group,{...value,direction:'DESC'},third]).sourceIndices).toEqual([1,2,0,3]);
  });
  it('不能将多键拼成显示字符串，也不按列名反查重复别名',()=>{
    const f=fixture('TEXT',['bc','c','bc','a']);f.source.rows[0].group='a';f.source.rows[1].group='ab';f.source.rows[2].group='a';f.source.rows[3].group='B';expect(f.apply([group,value,third]).sourceIndices).toEqual([3,2,0,1]);
  });
  it('规则数组与规则项不可串改；兼容原单列内部入口，清除返回原对象',()=>{
    const f=fixture(),rules=[{...group},{...value}],view=f.apply(rules);rules.reverse();rules[0].direction='DESC';expect(view.rules).toEqual([group,value]);expect(Object.isFrozen(view.rules)).toBe(true);expect(Object.isFrozen(view.rules[0])).toBe(true);
    expect(f.sorter.apply(f.binding,view,value).rules).toEqual([value]);expect(f.apply([]).rules).toEqual([]);expect(f.apply([]).result).toBe(f.source);
  });
  it.each(['duplicate','hidden','unknown','direction'] as const)('%s非法规则原子拒绝，不部分采用或覆盖现有投影',mode=>{
    const f=fixture(),view=f.apply([group,value]);let rules:SortRule[]=[group,{...value}];if(mode==='duplicate')rules=[group,{...group}];if(mode==='hidden'){const b=f.sorter.bind(f.source,[],[f.source.columns[0]])!;const current=f.sorter.view(b)!;expect(()=>f.sorter.apply(b,current,[group,value])).toThrow();expect(f.sorter.view(b)).toBe(current);return;}
    if(mode==='unknown')rules[1].column='没有此列';if(mode==='direction')rules[1].direction='SIDEWAYS' as any;expect(()=>f.apply(rules)).toThrow();expect(f.sorter.view(f.binding)).toBe(view);
  });
});
describe('多列合计预算与每个活动键漂移',()=>{
  it('全部键共用8Mi文本预算，不按列分别放行，失败后不替换既有未排序视图',()=>{
    const f=fixture('TEXT',Array.from({length:1600},()=> 'x'));for(const row of f.source.rows){row.group='g'.repeat(3000);row.value='v'.repeat(3000);}const before=f.sorter.view(f.binding)!;
    expect(()=>f.apply([group,value])).toThrow(text.budget);expect(f.sorter.view(f.binding)).toBe(before);expect(f.apply([group]).rules).toEqual([group]);expect(()=>f.apply([group,value])).toThrow(text.budget);expect(f.sorter.view(f.binding)!.rules).toEqual([group]);expect(queryResultSortLimits.units).toBe(8*1024*1024);
  });
  it.each(['group','value','third'])('%s任一级漂移都立即永久撤销，即使前级原本已唯一决定行序',column=>{
    const f=fixture(),view=f.apply([group,value,third]),old=f.source.rows[0][column];f.source.rows[0][column]=column==='group'?'变化':'7';expect(f.sorter.view(f.binding)).toBeUndefined();f.source.rows[0][column]=old;expect(()=>f.sorter.apply(f.binding,view,[group,value])).toThrow(text.stale);expect(f.sorter.view(f.binding)).toBeUndefined();
  });
  it('准入后新增键变为坏值时整次拒绝；删除规则后只保留仍活动键的漂移检查',()=>{
    const f=fixture();f.source.rows[0].third='非整数';expect(()=>f.apply([group,value,third])).toThrow(text.value);expect(f.sorter.view(f.binding)!.result).toBe(f.source);f.source.rows[0].third='0';f.apply([group,value,third]);f.apply([group,value]);f.source.rows[0].third='已移除键';expect(f.sorter.view(f.binding)?.rules).toEqual([group,value]);
  });
  it('旧多列视图及旧owner不能覆盖新视图，恢复原对象也不重新领取',()=>{
    const f=fixture(),first=f.apply([group,value]);const next=f.apply([value]);expect(()=>f.sorter.apply(f.binding,first,[])).toThrow(text.stale);expect(f.sorter.view(f.binding)).toBe(next);const newer=f.sorter.bind(f.source,['new'])!;expect(()=>f.sorter.apply(f.binding,next,[group])).toThrow(text.stale);expect(f.sorter.current(newer)).toBe(true);
  });
});
