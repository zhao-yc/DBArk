import{beforeEach,describe,it,expect,vi}from'vitest';
import type{FieldPacket}from'mysql2';
import{readDataSearchTarget}from'../../src/engine/dataSearchPlan';
import{completionQuery}from'../../src/engine/completionQuery';
import type{ManagedConnection}from'../../src/engine/connection';

vi.mock('../../src/engine/completionQuery',()=>({completionQuery:vi.fn()}));
const target={database:'d',table:'t',kind:'table',columns:[{name:'note',representation:'text'}]};
const column=(name:string)=>({name,data_type:name==='id'?'bigint':'varchar',character_set:name==='id'?null:'utf8mb4',nullable:name==='note'?'YES':'NO'});
let keys:string[][],fail:Map<string,Error>,sent:string[],cancelled:boolean;
const managed={broken:false}as ManagedConnection;
/** 控制边界保留取消优先级；字段协议描述由查询实际投影生成，不按固定调用次数放行。 */
const control={checkCancelled(){if(cancelled)throw Error('任务已取消');},commandStarted:()=>()=>{}};
beforeEach(()=>{
 keys=[['id'],['code']];fail=new Map([['id',Object.assign(Error('SELECT denied'),{code:'ER_COLUMNACCESS_DENIED_ERROR',errno:1143})]]);sent=[];cancelled=false;managed.broken=false;
 vi.mocked(completionQuery).mockImplementation(async(_managed,_control,sql,values)=>{
  sent.push(sql);let rows:Record<string,unknown>[]=[],fields:FieldPacket[]=[];
  if(sql.includes('information_schema.TABLES'))rows=[{kind:'BASE TABLE'}];
  else if(sql.includes('information_schema.STATISTICS'))rows=keys.flatMap((names,index)=>names.map((name,ordinal)=>({index_name:index===0?'PRIMARY':'u'+index,column_name:name,ordinal:ordinal+1,prefix_length:null})));
  else if(sql.includes('information_schema.COLUMNS'))rows=['id','code','note'].filter(name=>values.slice(2).includes(name)).map(column);
  else{const projection=sql.slice(0,sql.indexOf(' FROM ')),names=[...projection.matchAll(/`([^`]+)`/g)].map(match=>match[1]);for(const name of names)if(fail.has(name)){if(fail.get(name)!.message==='取消时权限拒绝')cancelled=true;throw fail.get(name);}fields=names.map(name=>({name,characterSet:45}as FieldPacket));}
  return{rows,fields};
 });
});
describe('数据搜索候选键的真实SELECT边界',()=>{
 it('所选列先验证，不可读主键只弃用该候选，采用可读替代唯一键',async()=>{const result=await readDataSearchTarget(managed,target,control);expect(result.keyColumns.map(column=>column.name)).toEqual(['code']);expect(sent.filter(sql=>sql.endsWith('LIMIT 0'))).toEqual(['SELECT `note` FROM `d`.`t` LIMIT 0','SELECT `id` FROM `d`.`t` LIMIT 0','SELECT `code` FROM `d`.`t` LIMIT 0']);});
 it('无可读替代键保持真实命中可用，但明确没有可用于定位的键',async()=>{keys=[['id']];const result=await readDataSearchTarget(managed,target,control);expect(result.keyColumns).toEqual([]);expect(result.keyUnavailableReason).toBe('key-not-selectable');});
 it('所选搜索字段无SELECT权限必须失败，不能降级或读取其它字段',async()=>{fail.set('note',Object.assign(Error('note SELECT denied'),{errno:1143}));await expect(readDataSearchTarget(managed,target,control)).rejects.toThrow('note SELECT denied');expect(sent.filter(sql=>sql.endsWith('LIMIT 0'))).toEqual(['SELECT `note` FROM `d`.`t` LIMIT 0']);});
 it.each([{code:'PROTOCOL_CONNECTION_LOST',errno:2013},{code:'ER_PARSE_ERROR',errno:1064}])('候选读取的$code传播，不能当作权限不足继续',async failure=>{fail.set('id',Object.assign(Error('真实失败'),failure));await expect(readDataSearchTarget(managed,target,control)).rejects.toThrow('真实失败');expect(sent.some(sql=>sql.startsWith('SELECT `code`'))).toBe(false);});
 it('取消与权限错误同时出现时先确认取消，不继续下一个候选',async()=>{fail.set('id',Object.assign(Error('取消时权限拒绝'),{errno:1143}));await expect(readDataSearchTarget(managed,target,control)).rejects.toThrow('任务已取消');expect(sent.some(sql=>sql.startsWith('SELECT `code`'))).toBe(false);});
 it('已验证的所选列可作为替代键，不重复查询，也不把不可读复合键拆开使用',async()=>{keys=[['id','code'],['code']];const result=await readDataSearchTarget(managed,{...target,columns:[{name:'code',representation:'text'}]},control);expect(result.keyColumns.map(column=>column.name)).toEqual(['code']);expect(sent.filter(sql=>sql.endsWith('LIMIT 0'))).toEqual(['SELECT `code` FROM `d`.`t` LIMIT 0','SELECT `id` FROM `d`.`t` LIMIT 0']);});
 it('复合键包含NULL列时整组弃用，不能把其它前导列误当唯一键',async()=>{keys=[['id','note']];const result=await readDataSearchTarget(managed,target,control);expect(result.keyColumns).toEqual([]);expect(result.keyUnavailableReason).toBe('no-key');expect(sent.filter(sql=>sql.endsWith('LIMIT 0'))).toEqual(['SELECT `note` FROM `d`.`t` LIMIT 0']);});
});
