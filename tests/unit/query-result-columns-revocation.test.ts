import { describe,expect,it } from 'vitest';
import { ResultExportSelection } from '../../src/renderer/resultExport';
/** 独立合成原行，不读实跑环境、文件、剪贴板或数据库。 */
function fixture(label='原值'){
 const result={columns:[{key:'shown',name:'显示',type:'TEXT'},{key:'hidden',name:'隐藏',type:'TEXT'}],rows:[{shown:label,hidden:'隐藏原值'} as Record<string,string>],truncated:false,elapsedMs:0,statement:''};
 const columns=[result.columns[0]],owner=new ResultExportSelection(),binding=owner.bind(result,['current'],columns)!;
 expect(owner.select(binding,{scope:binding,rows:result.rows,columns,indices:new Set([0])})).toBe(true);
 return {owner,binding,result,columns};
}
describe('当前own结果绑定观测漂移后永久撤销',()=>{
 it.each(['hidden','extra'] as const)('%s变化被观测后再恢复，也不能复活旧选择／快照',change=>{
  const f=fixture();expect(f.owner.current(f.binding)).toBe(true);expect(f.owner.count(f.binding)).toBe(1);
  if(change==='hidden')f.result.rows[0].hidden='改变';else f.result.rows[0].extra='额外键';
  expect(f.owner.current(f.binding)).toBe(false);
  if(change==='hidden')f.result.rows[0].hidden='隐藏原值';else delete f.result.rows[0].extra;
  expect(f.owner.current(f.binding)).toBe(false);expect(f.owner.count(f.binding)).toBe(0);expect(()=>f.owner.snapshot(f.binding)).toThrow();
  expect(f.owner.select(f.binding,{scope:f.binding,rows:f.result.rows,columns:f.columns,indices:new Set([0])})).toBe(false);
 });
 it('检查漂移的旧binding不误撤销较新的owner；新owner正常选择与快照保持',()=>{
  const f=fixture(),nextResult={...f.result,columns:f.result.columns.map(c=>({...c})),rows:[{shown:'新值',hidden:'新隐藏值'}]},columns=[nextResult.columns[0]],next=f.owner.bind(nextResult,['next'],columns)!;
  expect(f.owner.select(next,{scope:next,rows:nextResult.rows,columns,indices:new Set([0])})).toBe(true);
  f.result.rows[0].hidden='旧行变化';expect(f.owner.current(f.binding)).toBe(false);f.result.rows[0].hidden='隐藏原值';expect(f.owner.current(f.binding)).toBe(false);
  expect(f.owner.current(next)).toBe(true);expect(f.owner.count(next)).toBe(1);expect(f.owner.snapshot(next).rows).toEqual([{shown:'新值'}]);
 });
});
