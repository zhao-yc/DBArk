import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { installQueryResultColumnsAudit, readQueryResultColumnsAudit, queryResultColumnsSql } from '../helpers/queryResultColumnsUi';
import { queryResultPresetSnapshotSchema, queryResultPresetValueSchema } from '../../src/shared/queryResultPresets';

const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222',digest='a'.repeat(64);
const columns=Array.from({length:7},(_,index)=>({key:'c'+index,name:'字段'+index,type:'VAR_STRING'}));
/** 与真实查询无关的RAM固定值；审计必须自行检查全部局部边界，不能靠mock已检查的结论。 */
function value(){return queryResultPresetValueSchema.parse({columns,visible:columns.slice(0,6),configuration:{expression:{mode:'AND',children:[{mode:'OR',children:[{column:'c1',operator:'in',value:'',values:['1','3'],ignoreCase:true},{column:'c2',operator:'between',value:'9007199254740993',upper:'18446744073709551615',enabled:false}]}]},sort:[{column:'c1',direction:'ASC',nulls:'LAST',ignoreCase:true},{column:'c2',direction:'DESC',nulls:'FIRST'}]}});}
/** 只替换原主进程handler；被测审计函数真实序列化进入独立上下文。 */
function fixture(presets=true){
 let issued=0;
 let document=queryResultPresetSnapshotSchema.parse({version:1,revision:0,bindingToken:token,source:{connectionRevision:2,connectionDigest:digest},entries:[]});
 const original=vi.fn(async(_event:any,payload:any):Promise<any>=>{
  const {command,input}=payload;
  if(command==='sessions.open')return {ok:true,result:{sessionId:'ram-session'}};
  if(command==='query.execute')return {ok:true,result:{results:[{columns}],elapsedMs:1}};
  if(command==='result.presets.read')return {ok:true,result:structuredClone(document.entries[0].value)};
  if(command==='result.presets.save')document=queryResultPresetSnapshotSchema.parse({...document,revision:document.revision+1,entries:[{id,name:input.name,connectionDigest:digest,value:input.value}]});
  if(command==='result.presets.rename')document=queryResultPresetSnapshotSchema.parse({...document,revision:document.revision+1,entries:[{...document.entries[0],name:input.name}]});
  if(command==='result.presets.delete')document=queryResultPresetSnapshotSchema.parse({...document,revision:document.revision+1,entries:[]});
  document={...document,bindingToken:'33333333-3333-4333-8333-'+String(++issued).padStart(12,'0')};
  return {ok:true,result:structuredClone(document)};
 });
 const handlers=new Map([['dbark:request',original]]),context:any={Date:{now:()=>1000},ipcMain:{_invokeHandlers:handlers},target:{senderId:71,profileId:'ram-profile',tabId:'ram-tab',sql:queryResultColumnsSql,deadline:121000,...(presets?{presets:true}:{})}};
 runInNewContext(`(${installQueryResultColumnsAudit.toString()})({ipcMain},target)`,context);
 const wrapped=handlers.get('dbark:request')!,sender={id:71};
 const call=(command:string,input:any={})=>wrapped({sender},{command,input});
 const scope=()=>({connectionId:'ram-profile',source:document.source,expectedRevision:document.revision,bindingToken:document.bindingToken});
 const list=()=>call('result.presets.list',{connectionId:'ram-profile'});
 const save=()=>call('result.presets.save',{...scope(),name:'本例嵌套整理方案',value:value()});
 const prepare=async()=>{await call('sessions.open',{connectionId:'ram-profile'});await call('query.execute',{sessionId:'ram-session',sql:queryResultColumnsSql});};
 return {context,handlers,original,call,scope,list,save,prepare,state:context.__dbarkQueryResultColumnsAudit,read:()=>runInNewContext(`(${readQueryResultColumnsAudit.toString()})()`,context)};
}

it('默认审计拒绝命名方案；即使后来改授权字段也不扩大旧例权限',async()=>{
 const f=fixture(false);await f.prepare();f.context.target.presets=true;const count=f.original.mock.calls.length;
 await expect(f.list()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
});

it('可选审计真实委托固定八步并核对原source/token/CAS；计数只报告固定字段',async()=>{
 const f=fixture();await f.prepare();await f.list();await f.save();
 await f.call('result.presets.rename',{...f.scope(),id,name:'本例嵌套整理方案已改名'});await f.list();
 await f.call('result.presets.read',{...f.scope(),id});await f.list();
 await f.call('result.presets.save',{...f.scope(),replaceId:id,name:'本例嵌套整理方案已改名',value:value()});
 await f.call('result.presets.delete',{...f.scope(),id});
 expect(f.read()).toEqual({queries:1,exports:[],pending:0,revision:0,presets:{list:3,save:2,rename:1,read:1,delete:1,total:8}});
 const count=f.original.mock.calls.length;await expect(f.list()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
});

it.each(['connection','token','source','revision','extra','row','sql','field','visible','duplicateSort','nulls','case','condition','range','list','depth','budget','accessor','hole'] as const)('请求边界%s在原handler前永久拒绝，恢复原值也不能重试',async mode=>{
 const f=fixture();await f.prepare();await f.list();const input:any={...f.scope(),name:'本例嵌套整理方案',value:value()},getter=vi.fn(()=>{throw Error('不得读取');});
 if(mode==='connection')input.connectionId='other';if(mode==='token')input.bindingToken=id;if(mode==='source')input.source={...input.source,connectionDigest:'b'.repeat(64)};if(mode==='revision')input.expectedRevision++;
 if(mode==='extra')input.extra=true;if(mode==='row')input.value.rows=[];if(mode==='sql')input.value.sql='SELECT 禁止';if(mode==='field')input.value.columns[0].type='改变';if(mode==='visible')input.value.visible[0].name='改变';
 if(mode==='duplicateSort')input.value.configuration.sort.push(input.value.configuration.sort[0]);if(mode==='nulls')input.value.configuration.sort[0].nulls='UNKNOWN';if(mode==='case')input.value.configuration.sort[0].ignoreCase='yes';
 if(mode==='condition')input.value.configuration.expression.children[0].children[0].operator='UNKNOWN';if(mode==='range')delete input.value.configuration.expression.children[0].children[1].upper;if(mode==='list')input.value.configuration.expression.children[0].children[0].values=[];
 if(mode==='depth')for(let index=0;index<9;index++)input.value.configuration.expression={mode:'AND',children:[input.value.configuration.expression]};
 if(mode==='budget')input.value.configuration.expression.children[0].children[0].values=Array.from({length:128},()=> 'x'.repeat(4096));
 if(mode==='accessor')Object.defineProperty(input.value,'configuration',{enumerable:true,get:getter});if(mode==='hole')delete input.value.visible[0];
 const count=f.original.mock.calls.length;await expect(f.call('result.presets.save',input)).rejects.toThrow('永久');expect(getter).not.toHaveBeenCalled();expect(f.original).toHaveBeenCalledTimes(count);await expect(f.save()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
});

it.each(['shape','source','revision','entry','read','token'] as const)('成功回包%s不符合原请求时保留停链，不能据此绑定下一次请求',async mode=>{
 const f=fixture();await f.prepare();await f.list();
 if(mode==='read'){await f.save();await f.call('result.presets.rename',{...f.scope(),id,name:'本例嵌套整理方案已改名'});await f.list();const changed=value();changed.configuration.sort[0].direction='DESC';f.original.mockResolvedValueOnce({ok:true,result:changed});await expect(f.call('result.presets.read',{...f.scope(),id})).rejects.toThrow('永久');}
 else {
  const next:any={version:1,revision:1,bindingToken:token,source:{connectionRevision:2,connectionDigest:digest},entries:[{id,name:'本例嵌套整理方案',connectionDigest:digest,value:value()}]};
  if(mode==='shape')next.extra=true;if(mode==='source')next.source.connectionRevision++;if(mode==='revision')next.revision=0;if(mode==='entry')next.entries[0].value.configuration.sort[0].direction='DESC';if(mode==='token')next.bindingToken=f.scope().bindingToken;
  f.original.mockResolvedValueOnce({ok:true,result:next});await expect(f.save()).rejects.toThrow('永久');
 }
 expect(f.state.invalid).toBe(true);const count=f.original.mock.calls.length;await expect(f.list()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
});

it('并发方案请求不重复委托；停链后的迟到成功不能绑定快照或恢复权限',async()=>{
 const f=fixture();await f.prepare();let finish!:(value:any)=>void;f.original.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const first=f.list(),settled=Promise.allSettled([first]);
 const count=f.original.mock.calls.length;await expect(f.list()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
 finish({ok:true,result:{version:1,revision:0,bindingToken:token,source:{connectionRevision:2,connectionDigest:digest},entries:[]}});expect((await settled)[0].status).toBe('rejected');expect(f.state.presetSnapshot).toBeUndefined();
});

it('原handler归属变化后的迟到方案回包不能绑定；恢复handler也不能补写',async()=>{
 const f=fixture();await f.prepare();const wrapped=f.handlers.get('dbark:request')!;let finish!:(value:any)=>void;
 f.original.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const first=f.list(),rejected=expect(first).rejects.toThrow('永久');
 f.handlers.set('dbark:request',f.original);finish({ok:true,result:{version:1,revision:0,bindingToken:token,source:{connectionRevision:2,connectionDigest:digest},entries:[]}});await rejected;
 expect(f.state.presetSnapshot).toBeUndefined();f.handlers.set('dbark:request',wrapped);const count=f.original.mock.calls.length;await expect(f.save()).rejects.toThrow('永久');expect(f.original).toHaveBeenCalledTimes(count);
});
