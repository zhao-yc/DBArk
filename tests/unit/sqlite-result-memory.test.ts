import { expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { captureQueryResultMemory, queryResultMemoryMatches } from '../../src/renderer/queryResultMemory';
import { prepareQueryResultOrganization, type QueryResultOrganization } from '../../src/renderer/queryResultHistory';

/** 类型条件与字节选择独立分组；同名字段和重排可见列只靠准确键定位。 */
function fixture(){
  const source:QueryResult={columns:['id','value','blob'].map(key=>({key,name:'同名',type:'SQLITE'})),rows:[{id:'9223372036854775807',value:'2',blob:{type:'binary',base64:'AP8='}},{id:'9007199254740993',value:'2',blob:{type:'binary',base64:'/wA='}},{id:'-9223372036854775808',value:null,blob:{type:'binary',base64:''}}],sqliteStorage:{version:1,rows:['iib','itb','inb']},statement:'不存入暂存的源SQL',elapsedMs:1,truncated:true};
  const visible=[source.columns[2],source.columns[1],source.columns[0]],configuration:QueryResultOrganization={expression:{mode:'AND',children:[{mode:'OR',children:[{column:'value',operator:'in',value:'',values:['2'],sqliteType:'integer'},{column:'value',operator:'in',value:'',values:['2'],sqliteType:'text'}]},{column:'blob',operator:'notIn',value:'',values:[''],sqliteType:'blob'}]},sort:[{column:'id',direction:'DESC',nulls:'LAST'},{column:'blob',direction:'ASC'}]};
  return{source,visible,configuration};
}
it('SQLite暂存只保存独立冻结配置，保留原类型与完整字节，不存原行、SQL或类型代码行',()=>{
  const f=fixture(),before=structuredClone(f.source),saved=captureQueryResultMemory(f.source,f.visible,f.configuration,'blob');
  expect(saved.configuration).toEqual(f.configuration);expect(saved.frozenThrough).toBe('blob');expect(Object.keys(saved).sort()).toEqual(['columns','configuration','frozenThrough','visible']);
  expect(JSON.stringify(saved)).not.toContain(f.source.statement);expect(JSON.stringify(saved)).not.toContain('sqliteStorage');expect(Object.isFrozen(saved.configuration.expression.children[0])).toBe(true);expect(Object.isFrozen(saved.configuration.sort)).toBe(true);expect(f.source).toEqual(before);
});
it('新结果沿新逐格类型应用原条件，精确整数排序与字节保持，不复用旧行',()=>{
  const f=fixture(),saved=captureQueryResultMemory(f.source,f.visible,f.configuration),next=structuredClone(f.source);
  next.rows=[{id:'9007199254740992',value:'2',blob:{type:'binary',base64:'AP8='}},{id:'9007199254740993',value:'2',blob:{type:'binary',base64:'/wA='}},{id:'-9223372036854775808',value:null,blob:{type:'binary',base64:''}}];next.sqliteStorage!.rows=['itb','iib','inb'];
  const visible=[next.columns[2],next.columns[1],next.columns[0]];expect(queryResultMemoryMatches(saved,next,visible)).toBe(true);const ready=prepareQueryResultOrganization(next,[],visible,saved.configuration),view=ready.sorter.view(ready.sortBinding)!;
  expect(view.result.rows).toEqual([next.rows[1],next.rows[0]]);expect(view.result.rows[0]).toBe(next.rows[1]);expect(view.result.sqliteStorage!.rows).toEqual(['iib','itb']);
});
it('字段相同而新值变为REAL时按原类型条件得空集，不猜测TEXT或回退全量',()=>{
  const f=fixture(),saved=captureQueryResultMemory(f.source,f.visible,f.configuration),next=structuredClone(f.source);next.sqliteStorage!.rows=['irb','irb','inb'];
  const ready=prepareQueryResultOrganization(next,[],[next.columns[2],next.columns[1],next.columns[0]],saved.configuration);expect(ready.sorter.view(ready.sortBinding)!.result.rows).toEqual([]);expect(ready.sorter.view(ready.sortBinding)!.result.truncated).toBe(true);
});
it.each(['missing','invalid'] as const)('新结果类型%s时完整拒绝试算，保留原暂存及当前原行',mode=>{
  const f=fixture(),saved=captureQueryResultMemory(f.source,f.visible,f.configuration),copy=structuredClone(saved),next=structuredClone(f.source);if(mode==='missing')delete next.sqliteStorage;else next.sqliteStorage!.rows[0]='itb';
  if(mode==='invalid')next.rows[0].value={type:'binary',base64:'AP8='};const before=structuredClone(next);
  expect(()=>prepareQueryResultOrganization(next,[],[next.columns[2],next.columns[1],next.columns[0]],saved.configuration)).toThrow();expect(saved).toEqual(copy);expect(next).toEqual(before);
});
