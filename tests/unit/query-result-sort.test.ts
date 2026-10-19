import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultSort, queryResultSortLimits } from '../../src/renderer/queryResultSort';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';

/** 仅原数据对象和索引，不加载UI、数据库、编辑器或剪贴板。 */
function fixture(type: string, values: CellValue[]) {
  const source: QueryResult={columns:[{key:'k',name:'同名',type},{key:'__proto__',name:'同名',type:'TEXT'}],rows:values.map((k,i)=>({k,['__proto__']:String(i)})),truncated:true,statement:'SELECT 原SQL',elapsedMs:7};
  const controller=new QueryResultSort(),binding=controller.bind(source,['owner'])!;
  return {source,controller,binding,sort(direction:'ASC'|'DESC'='ASC') { return controller.apply(binding,controller.view(binding)!,{column:'k',direction}); }};
}
describe('已返回SQL结果精确比较及原行身份',()=>{
  it.each(['LONGLONG','BIGINT','DECIMAL','NEWDECIMAL','DECIMAL(65,30)'])('%s大数、负零、精确小数及相等键按原位置稳定，不用Number',type=>{
    const integer=/LONGLONG|BIGINT/.test(type), values=integer ? ['18446744073709551615','9007199254740993','-9007199254740993','0','-0','0000',null] : ['0.12345678901234567891','0.12345678901234567890','-0.00000000000000000001','0','-0.0','000.000',null];
    const f=fixture(type,values),saved=structuredClone(f.source),first=f.sort();expect(first.sourceIndices).toEqual([6,2,3,4,5,1,0]);
    expect(f.sort('DESC').sourceIndices).toEqual([0,1,3,4,5,2,6]);expect(f.source).toEqual(saved);expect(first.result.columns).toBe(f.source.columns);first.sourceIndices.forEach((original,i)=>expect(first.result.rows[i]).toBe(f.source.rows[original]));
    expect(f.controller.apply(f.binding,f.controller.view(f.binding)!).result).toBe(f.source);
  });
  it('TIME按负号、三位小时及微秒比较，不当日期或普通字符串',()=>{
    const f=fixture('TIME',['100:00:00.000001','99:59:59.999999','-100:00:00','-99:59:59.999999','00:00:00','-00:00:00','00:00:00.000001']);expect(f.sort().sourceIndices).toEqual([2,3,4,5,6,1,0]);
  });
  it('明确UNSIGNED元数据拒绝负值，正大整数及负零仍按精确值稳定排序',()=>{
    const f=fixture('BIGINT UNSIGNED',['18446744073709551615','9007199254740993','0','-0']);expect(f.sort().sourceIndices).toEqual([2,3,1,0]);
  });
  it.each(['DATETIME','TIMESTAMP'])('%s保留六位时间精度、不转换时区或Date',type=>{
    const f=fixture(type,['2026-10-19 12:00:00.000002','2026-10-19 12:00:00.000001','2026-10-19 12:00:00.1','2026-10-19 12:00:00.100000','0000-00-00 00:00:00']);expect(f.sort().sourceIndices).toEqual([4,1,0,2,3]);
  });
  it('DATE按原日期字段比较；FLOAT只接纳已经返回的有限number',()=>{
    expect(fixture('DATE',['2026-10-19','0000-00-00','2025-12-31']).sort().sourceIndices).toEqual([1,2,0]);expect(fixture('DOUBLE',[2,-0,0,-1,null]).sort().sourceIndices).toEqual([4,3,1,2,0]);
  });
  it('文本明确代码单元序，NULL、空串、大小写和JSON原文不混淆',()=>{
    const f=fixture('VAR_STRING',['z','',null,'A','a','A']);expect(f.sort().sourceIndices).toEqual([2,1,3,5,4,0]);expect(f.sort('DESC').sourceIndices).toEqual([0,4,3,5,1,2]);
    expect(fixture('JSON',['{"x":9007199254740993}','{"x":9007199254740992}']).sort().sourceIndices).toEqual([1,0]);
    expect(fixture('TEXT',['2','10']).sort().sourceIndices).toEqual([1,0]);expect(fixture('LONG',['2','10']).sort().sourceIndices).toEqual([0,1]);
  });
  it.each([['GEOMETRY',['a']],['未知',['1']],['BIT',[{type:'binary',base64:'AA=='}]],['BLOB',[{type:'binary',base64:''}]],['BIGINT',[9007199254740992]],['DECIMAL',[0.1]],['DOUBLE',['1e10']],['DATETIME',['2026-10-19T12:00:00Z']],['TIME',['839:00:00']],['DATE',['2026-13-01']],['INT',['']],['BIGINT UNSIGNED',['-1']],['TEXT',[NaN]]])('类型和值不能可靠比较则整列禁用：%s', (type,values)=>{
    const f=fixture(type as string,values as CellValue[]);expect(f.binding.reasons.get('k')).toBeTruthy();expect(()=>f.sort()).toThrow();expect(f.controller.view(f.binding)!.result).toBe(f.source);
  });
  it('原型同名内部key独立，隐藏列不读取，源行重复引用必须拒绝而非伪造位置',()=>{
    const f=fixture('BIGINT',['2','1']);const hidden=vi.fn(()=>{throw Error('不可读隐藏值');});f.source.columns.push({key:'secret',name:'秘密',type:'TEXT'});for(const row of f.source.rows)Object.defineProperty(row,'secret',{get:hidden});
    const controller=new QueryResultSort(),binding=controller.bind(f.source,[],[f.source.columns[0]])!;expect(controller.apply(binding,controller.view(binding)!,{column:'k',direction:'ASC'}).sourceIndices).toEqual([1,0]);expect(hidden).not.toHaveBeenCalled();
    const aliases=fixture('TEXT',['a','b']);aliases.source.rows[1]=aliases.source.rows[0];const bad=new QueryResultSort(),b=bad.bind(aliases.source,[])!;expect(b.reasons.get('k')).toBe(text.identity);
  });
  it('预算在排序前拒绝，原数据及超预算文本不复制、不截断',()=>{
    const f=fixture('TEXT',['x'.repeat(queryResultSortLimits.valueUnits+1)]);expect(f.binding.reasons.get('k')).toBe(text.budget);expect(()=>f.sort()).toThrow(text.budget);
    const c=new QueryResultSort(),source=fixture('INT',[1]).source;source.rows=Array.from({length:queryResultSortLimits.rows+1},()=>({k:1}));expect(c.bind(source,[])).toBeUndefined();
  });
  it('数值或getter协议未知不能在准入时执行访问器，原始列引用及投影索引不可串改',()=>{
    const f=fixture('INT',[2,1]),getter=vi.fn(()=>1);Object.defineProperty(f.source.rows[0],'k',{get:getter});const c=new QueryResultSort(),b=c.bind(f.source,[])!;expect(b.reasons.get('k')).toBe(text.value);expect(getter).not.toHaveBeenCalled();
    const p=fixture('INT',[2,1]),view=p.sort();expect(Object.isFrozen(view.sourceIndices)).toBe(true);expect(Object.isFrozen(view.result.rows)).toBe(true);expect(Object.isFrozen(p.source.rows)).toBe(false);expect(view.result.columns[0]).toBe(p.source.columns[0]);
  });
});
describe('结果排序租约与迟到闭包',()=>{
  it.each(['rows','append','column','metadata','visible','value','truncated'])('%s漂移即撤销，恢复后旧owner不复活',mode=>{
    const f=fixture('INT',[2,1]),view=f.sort(),oldRow=f.source.rows[0],oldColumn=f.source.columns[0];
    if(mode==='rows')f.source.rows[0]={...oldRow};if(mode==='append')f.source.rows.push({k:3});if(mode==='column')f.source.columns[0]={...oldColumn};if(mode==='metadata')oldColumn.type='TEXT';if(mode==='visible')f.binding.visible.reverse();if(mode==='value')oldRow.k=9;if(mode==='truncated')f.source.truncated=false;
    expect(f.controller.current(f.binding)).toBe(false);f.source.rows[0]=oldRow;f.source.columns[0]=oldColumn;oldColumn.type='INT';oldRow.k=2;f.source.truncated=true;expect(()=>f.controller.apply(f.binding,view)).toThrow(text.stale);
  });
  it('旧sort view不能重复提交，切结果/上下文后旧binding不影响新的有效owner',()=>{
    const f=fixture('INT',[2,1]),before=f.controller.view(f.binding)!;f.sort();expect(()=>f.controller.apply(f.binding,before)).toThrow();const newer=f.controller.bind(f.source,['new'])!;expect(()=>f.controller.apply(f.binding,before)).toThrow();expect(f.controller.current(newer)).toBe(true);
  });
  it('准入后但点击前出现坏值仍拒绝，不能用旧资格猜测或改原值',()=>{
    const f=fixture('BIGINT',['2','1']);f.source.rows[0].k='不是整数';expect(()=>f.sort()).toThrow(text.value);expect(f.source.rows[0].k).toBe('不是整数');
  });
});
