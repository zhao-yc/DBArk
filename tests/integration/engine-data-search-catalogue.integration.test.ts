import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import mysql from 'mysql2';
import {Engine} from '../../src/engine';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {qualified,identifier} from '../../src/engine/sql';
import type {ConnectionProfile,TaskEvent} from '../../src/shared/contracts';
import type {DataSearchCatalogueInput,DataSearchCataloguePage} from '../../src/shared/dataSearchCatalogue';
import type {DataSearchReply,DataSearchTargetMetadata,DataSearchHit} from '../../src/shared/dataSearch';
const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1',suffix=randomUUID().replaceAll('-','').slice(0,12),database='dbark_colperm_'+suffix,user='cp_'+suffix,password=randomUUID()+randomUUID();
const profile:ConnectionProfile={id:randomUUID(),name:'搜索范围目录隔离验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const engine=new Engine(),drivers=new Set<ReturnType<typeof mysql.createConnection>>();let observer:ManagedConnection|undefined,restricted:ConnectionProfile,restore:(()=>void)|undefined;
/** 仅随机隔离库夹具使用旁观账号；搜索目录本身必须由实际搜索账号读取。 */
async function sql(statement:string,values:(string|number)[]=[]){return(await execute<Record<string,unknown>[]>(observer!,statement,values)).rows;}
/** 公开输入形状原样经过Engine，不向目录查询提供任意SQL或补权限。 */
type CatalogueSelection<T=DataSearchCatalogueInput>=T extends DataSearchCatalogueInput?Omit<T,'connectionId'|'taskId'>:never;
async function read(patch:CatalogueSelection,connection=profile):Promise<DataSearchCataloguePage>{return engine.handle('search.catalogue',{...patch,connectionId:connection.id,taskId:randomUUID(),profile:connection});}
/** 按真实ACK读取受限账号的命中；旁观高权限只布置夹具，不补查任何键值。 */
async function searchRestricted(column='c204'){
 const taskId=randomUUID(),metadata:DataSearchTargetMetadata[]=[],hits:DataSearchHit[]=[],failures:string[]=[];
 try{
  let reply:DataSearchReply=await engine.handle('search.dataStart',{connectionId:restricted.id,taskId,profile:restricted,targets:[{database,table:'subject',kind:'table',columns:[{name:column,representation:'text'}]}],matcher:{kind:'text',pattern:{mode:'whole',text:column==='id'?'1':'204',caseSensitive:true}},maxResults:10,allowViews:false,onError:'stop'});
  while(reply.kind!=='terminal'){if(reply.kind==='batch'){metadata.push(reply.metadata);hits.push(...reply.hits);}else failures.push(reply.message);reply=await engine.handle('search.dataNext',{connectionId:restricted.id,taskId,sequence:reply.sequence});}
  return{terminal:reply,metadata,hits,failures};
 }finally{await engine.handle('search.dataRelease',{connectionId:restricted.id,taskId});}
}
describe.skipIf(!enabled)('200隔离实例：数据搜索分页范围目录',()=>{
 beforeAll(async()=>{
  if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('仅允许已核对200隔离实例');
  const create=mysql.createConnection,recording=vi.spyOn(mysql,'createConnection').mockImplementation((...args:Parameters<typeof mysql.createConnection>)=>{const driver=create(...args);drivers.add(driver);return driver;});restore=()=>recording.mockRestore();observer=await connect(profile);
  await sql('CREATE DATABASE '+identifier(database)+' CHARACTER SET utf8mb4');
  await sql('CREATE TABLE '+qualified(database,'subject')+'(id INT PRIMARY KEY,'+Array.from({length:205},(_,index)=>identifier('c'+String(index).padStart(3,'0'))+' INT'+(index===204?' NOT NULL DEFAULT 0':'')).join(',')+','+identifier('a%_!')+' TEXT,x_bin BLOB,UNIQUE KEY readable_key(c204)) ENGINE=InnoDB');
  await sql('INSERT INTO '+qualified(database,'subject')+'(id,c000,c204) VALUES(1,0,204)');
  await sql('CREATE VIEW '+qualified(database,'slow_view')+' AS SELECT SLEEP(15) AS slow_value FROM '+qualified(database,'subject'));
  if(!/^[0-9a-f-]{72}$/.test(password))throw Error('隔离随机认证格式不符');try{await sql("CREATE USER '"+user+"'@'%' IDENTIFIED BY '"+password+"'");}catch{throw Error('隔离账号创建失败，认证细节未写入报告');}
  await sql('GRANT SELECT(c000,c204) ON '+qualified(database,'subject')+" TO '"+user+"'@'%'");restricted={...profile,id:randomUUID(),user,password};
 },60000);
 afterAll(async()=>{
  const failures:unknown[]=[];
  try{await engine.closeAll();}catch(error){failures.push(error);}
  try{if(observer){if(!/^cp_[a-f0-9]{12}$/.test(user)||!/^dbark_colperm_[a-f0-9]{12}$/.test(database))throw Error('拒绝清理非本例资源');try{await sql("DROP USER IF EXISTS '"+user+"'@'%'");}catch(error){failures.push(error);}try{await sql('DROP DATABASE IF EXISTS '+identifier(database));}catch(error){failures.push(error);}expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database])).toHaveLength(0);expect(await sql('SELECT User FROM mysql.user WHERE User=?',[user])).toHaveLength(0);const ids=[...drivers].filter(driver=>driver!==observer!.connection).map(driver=>driver.threadId).filter((id):id is number=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0);expect(ids.length).toBeGreaterThan(0);expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids)).toHaveLength(0);console.log(JSON.stringify({验收说明:'分页目录真实驱动逐ID清理',连接数量:ids.length,残留数量:0}));}}finally{try{await observer?.close({strict:true});}finally{restore?.();}}
  expect(failures).toEqual([]);
 },60000);
 it('205字段100/100/5分页无丢失，最后一列和目录顺序完整',async()=>{const names:string[]=[],sizes:number[]=[];let after:string|undefined;for(let turn=0;turn<5;turn++){const page=await read({kind:'columns',database,table:'subject',objectKind:'table',prefix:'c',...(after?{after}:{})});sizes.push(page.entries.length);names.push(...page.entries.map(entry=>entry.name));if(!page.hasMore)break;expect(page.next).toBeTruthy();after=page.next;}expect(sizes).toEqual([100,100,5]);expect(names).toEqual(Array.from({length:205},(_,index)=>'c'+String(index).padStart(3,'0')));});
 it('数据库和对象明确类别，特殊前缀不是LIKE通配符且二进制默认HEX',async()=>{expect((await read({kind:'databases',prefix:database})).entries.map(entry=>entry.name)).toEqual([database]);const objects=await read({kind:'objects',database,prefix:''});expect(objects.entries).toEqual([{name:'slow_view',kind:'view'},{name:'subject',kind:'table'}]);expect((await read({kind:'columns',database,table:'subject',objectKind:'table',prefix:'a%_!'})).entries.map(entry=>entry.name)).toEqual(['a%_!']);expect((await read({kind:'columns',database,table:'subject',objectKind:'table',prefix:'x_bin'})).entries[0]).toMatchObject({name:'x_bin',dataType:'blob',binary:true});});
 it('列级SELECT仅返回实际可见两列，不借高权限读取其它列或视图',async()=>{const objects=await read({kind:'objects',database,prefix:''},restricted);expect(objects.entries).toEqual([{name:'subject',kind:'table'}]);const page=await read({kind:'columns',database,table:'subject',objectKind:'table',prefix:''},restricted);expect(page.entries.map(entry=>entry.name)).toEqual(['c000','c204']);expect(page.hasMore).toBe(false);});
 it('视图目录不执行SLEEP，类别失效时拒绝继续',async()=>{const started=Date.now(),page=await read({kind:'columns',database,table:'slow_view',objectKind:'view',prefix:''});expect(Date.now()-started).toBeLessThan(10000);expect(page.entries.map(entry=>entry.name)).toEqual(['slow_value']);await expect(read({kind:'columns',database,table:'slow_view',objectKind:'table',prefix:''})).rejects.toThrow('类别已变化');});
 it('准备阶段取消目录任务，不继续建连或留下未结束任务',async()=>{const events:TaskEvent[]=[],taskId=randomUUID();let cancellation:Promise<unknown>|undefined;const instance=new Engine(event=>{events.push(event);if(event.taskId===taskId&&event.status==='running'&&!cancellation)cancellation=instance.handle('query.cancel',{taskId});});try{await expect(instance.handle('search.catalogue',{connectionId:profile.id,taskId,kind:'databases',prefix:database,profile})).rejects.toThrow('取消');await cancellation;expect(events.filter(event=>event.taskId===taskId).at(-1)?.status).toBe('cancelled');}finally{await instance.closeAll();}});
 it('不可SELECT的主键不阻断所选字段搜索，仍选择其它实际可读唯一键',async()=>{
  // INSERT(id)在既有隔离subject授权内，仅用于让目录显示id；被测搜索账号仍不能读取id。
  await sql('GRANT INSERT(id) ON '+qualified(database,'subject')+" TO '"+user+"'@'%'");
  try{
   expect((await read({kind:'columns',database,table:'subject',objectKind:'table',prefix:'id'},restricted)).entries.map(column=>column.name)).toEqual(['id']);
   const probe=await connect(restricted);try{await expect(execute(probe,'SELECT id FROM '+qualified(database,'subject')+' LIMIT 0')).rejects.toMatchObject({errno:1143});}finally{await probe.close({strict:true});}
   const result=await searchRestricted();expect(result.failures).toEqual([]);expect(result.terminal.status).toBe('completed');expect(result.hits.map(hit=>hit.keyValues)).toEqual([['204']]);expect(result.metadata).toHaveLength(1);expect(result.metadata[0].keyColumns.map(column=>column.name)).toEqual(['c204']);
  }finally{await sql('REVOKE INSERT(id) ON '+qualified(database,'subject')+" FROM '"+user+"'@'%'");}
 });
 it('所有可靠键都不可读时仍返回所选字段命中，明确没有可用定位键',async()=>{
  await sql('GRANT INSERT(id) ON '+qualified(database,'subject')+" TO '"+user+"'@'%'");
  try{
   await sql('ALTER TABLE '+qualified(database,'subject')+' DROP INDEX readable_key');
   try{const result=await searchRestricted();expect(result.failures).toEqual([]);expect(result.terminal.status).toBe('completed');expect(result.hits.map(hit=>({keyValues:hit.keyValues,reason:hit.keyUnavailableReason}))).toEqual([{keyValues:null,reason:'key-not-selectable'}]);expect(result.metadata[0].keyColumns).toEqual([]);expect(result.metadata[0].keyUnavailableReason).toBe('key-not-selectable');}
   finally{await sql('ALTER TABLE '+qualified(database,'subject')+' ADD UNIQUE KEY readable_key(c204)');}
  }finally{await sql('REVOKE INSERT(id) ON '+qualified(database,'subject')+" FROM '"+user+"'@'%'");}
 });
 it('用户明确选择不可读字段时仍失败，不把SELECT权限拒绝伪装成无命中',async()=>{
  await sql('GRANT INSERT(id) ON '+qualified(database,'subject')+" TO '"+user+"'@'%'");
  try{const result=await searchRestricted('id');expect(result.terminal.status).toBe('failed');expect(result.hits).toEqual([]);expect(result.failures).toHaveLength(1);expect(result.failures[0]).toMatch(/SELECT.*denied/i);}
  finally{await sql('REVOKE INSERT(id) ON '+qualified(database,'subject')+" FROM '"+user+"'@'%'");}
 });
});
