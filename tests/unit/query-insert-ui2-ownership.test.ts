import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, unlink, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { QueryInsertUiScope } from '../helpers/queryInsertUiLive';
import { QueryInsertFile } from '../../src/engine/queryInsertFile';
import { captureInsertUiFile, verifyInsertUiFile, releaseInsertUiFile, InsertUiObserverReceipt, connectInsertUiObserver, insertUiOwnershipPlan, assertInsertUiSchema, insertUiPreciseSource, expectedPreciseInsertUiFile, InsertUiOwnershipJournal } from '../helpers/queryInsertUiOwnership';

const cache=resolve('.cache/insert-ui2-guards/tmp'),directories:string[]=[],handles:Awaited<ReturnType<typeof open>>[]=[],facts:object[]=[];
/** 所有实际文件仅在本隔离clone自有缓存，原审查材料不参与执行或覆盖。 */
async function directory(){await mkdir(cache,{recursive:true});const path=await mkdtemp(join(cache,'case-'));directories.push(path);return path;}
async function file(path:string,bytes:string){const handle=await open(path,'wx+');handles.push(handle);await handle.writeFile(bytes);await handle.sync();return handle;}
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const path of directories.splice(0)){if(!resolve(path).startsWith(cache+sep))throw Error('自有文件清理路径越界');await rm(path,{recursive:true,force:true});}});
afterAll(async()=>{await writeFile(resolve('.cache/insert-ui2-guards/new-counterexamples.json'),JSON.stringify(facts,null,2));});
/** 原120秒scope用于证明失败后的ABA恢复也不能重新得到资源权限。 */
function lifetime(){let now=1;const info={_startWallTime:0,timeout:120000,status:'passed'},retain=vi.fn(),scope=new QueryInsertUiScope(info,()=>info,{assertCurrent(){}},{assertCurrent(){},retain},()=>now);return{scope,retain,expire(){now=120000;},restore(){now=1;}};}

it('F1合法rename只能由原partial回执发布，目标不可重新签身份',async()=>{
  const dir=await directory(),target=join(dir,'target.sql'),partial=target+'.dbark-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.partial';
  const targetHandle=await file(target,'原目标'),writer=await file(partial,'合法SQL'),read=await open(partial,'r');handles.push(read);
  const before=await captureInsertUiFile(target,targetHandle,Buffer.from('原目标'),()=>{}),pending=await captureInsertUiFile(partial,read,Buffer.from('合法SQL'),()=>{},target);
  await releaseInsertUiFile(before);await releaseInsertUiFile(pending);await writer.close();
  await rename(partial,target);expect((await verifyInsertUiFile(pending,target,()=>{})).toString()).toBe('合法SQL');await expect(verifyInsertUiFile(before,target,()=>{})).rejects.toThrow();expect(Object.isFrozen(pending.identity)).toBe(true);expect(pending.handle).toBe(read);expect(writer).not.toBe(read);
});
it.each(['publish','cancel'] as const)('F1 %s原三门仍真但同字节异inode，新增门拒绝且原scope停链',async mode=>{
  const dir=await directory(),target=join(dir,'target.sql'),partial=target+'.dbark-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.partial',replacement=join(dir,'replacement.sql');
  const original=await file(target,'原目标'),pendingHandle=await file(partial,'合法SQL');
  const targetReceipt=await captureInsertUiFile(target,original,Buffer.from('原目标'),()=>{}),pending=await captureInsertUiFile(partial,pendingHandle,Buffer.from('合法SQL'),()=>{},target);
  await releaseInsertUiFile(targetReceipt);await releaseInsertUiFile(pending);
  if(mode==='publish')await rename(partial,target);else await unlink(partial);
  const expected=mode==='publish'?'合法SQL':'原目标',incoming=await file(replacement,expected);const incomingStat=await incoming.stat({bigint:true});await incoming.close();await rename(replacement,target);
  const oldBytes=(await readFile(target,'utf8'))===expected,oldNoPartial=!(await readdir(dir)).some(name=>name.endsWith('.partial')),receipt=mode==='publish'?pending:targetReceipt,life=lifetime();
  expect(oldBytes&&oldNoPartial).toBe(true);await expect(life.scope.step(()=>verifyInsertUiFile(receipt,target,()=>life.scope.assertCurrent()))).rejects.toThrow();
  life.restore();await expect(life.scope.step(async()=>1)).rejects.toThrow();expect(life.retain).toHaveBeenCalled();
  const now=incomingStat;expect(String(now.ino)+':'+String(now.dev)).not.toBe(receipt.identity.ino+':'+receipt.identity.dev);
  facts.push({finding:'F1',mode,oldBytes,oldNoPartial,newRejected:true,original:receipt.identity,replacement:{dev:String(now.dev),ino:String(now.ino)}});
});
it('F1首次捕获也必须绑定写句柄，不能把同字节的另一条路径封为原对象',async()=>{
  const dir=await directory(),first=await file(join(dir,'first.sql'),'相同'),second=await file(join(dir,'second.sql'),'相同');
  await expect(captureInsertUiFile(join(dir,'second.sql'),first,Buffer.from('相同'),()=>{})).rejects.toThrow('身份');expect(second).not.toBe(first);
});
it('F3写前日记先持有原wx句柄并落nonce/caseHash；句柄关闭后同字节替换不能重签追加',async()=>{
  const dir=await directory(),path=join(dir,'owner.ndjson'),plan=insertUiOwnershipPlan(0,'a'.repeat(32),'b'.repeat(64)),journal=new InsertUiOwnershipJournal(path,()=>{});
  await journal.start(plan);handles.push(journal.handle!);const snapshot=await journal.snapshot();expect(snapshot.toString()).toContain(plan.nonce);expect(snapshot.toString()).toContain(plan.caseHash);expect(journal.summary().records).toBe(1);
  const replacement=join(dir,'replacement'),incoming=await file(replacement,snapshot.toString());await incoming.close();await journal.handle!.close();await rename(replacement,path);await expect(journal.append('不应到达')).rejects.toThrow();
});

class RamSocket extends EventEmitter{closed=false;destroyed=false;remoteAddress:string|undefined;remotePort:number|undefined;}
class RamDriver extends EventEmitter{threadId:number|undefined;constructor(public stream:RamSocket){super();}}
/** 所有连接端口为RAM；阶段断言证明真实Socket.connect前原三对象已登记。 */
function observer(mode='normal'){
  const life=lifetime(),events:string[]=[],receipt=new InsertUiObserverReceipt<RamSocket,RamDriver,{connection:RamDriver}>(()=>life.scope.preserve());
  const socket=new RamSocket(),driver=new RamDriver(socket),wrapper={connection:driver};let callback!:(reason?:unknown)=>void;let connects=0;
  const ports={allocate(){events.push('allocate');return socket;},construct(value:RamSocket){events.push('construct');expect(receipt.socket).toBe(value);if(mode==='construct')throw Error('原构造错误');return driver;},wrap(value:RamDriver){events.push('wrapper');expect(receipt.driver).toBe(value);if(mode==='wrapper')throw Error('原初始化错误');return wrapper;},register(value:RamDriver,done:(reason?:unknown)=>void){events.push('register');expect(receipt.wrapper).toBe(wrapper);expect(value).toBe(driver);callback=done;if(mode==='register')throw Error('原回调登记错误');},connect(value:RamSocket){events.push('connect');connects++;expect(receipt.socket).toBe(value);expect(receipt.driver).toBe(driver);expect(receipt.wrapper).toBe(wrapper);if(mode==='connect')throw Error('原连接错误');socket.remoteAddress='192.168.31.200';socket.remotePort=13384;driver.threadId=7;if(mode!=='late')done();}};
  function done(){callback(mode==='callback'?Error('原握手失败'):undefined);}
  const start=()=>life.scope.step(()=>connectInsertUiObserver(receipt,ports,()=>life.scope.assertCurrent()));return{life,events,receipt,socket,driver,wrapper,start,done,connects:()=>connects};
}
it('F2原Socket、driver、wrapper均先登记，唯一connect后才取得thread授权',async()=>{
  const f=observer();expect(await f.start()).toBe(f.wrapper);expect(f.events).toEqual(['allocate','construct','wrapper','register','connect']);expect(f.receipt.summary()).toMatchObject({frozenThread:7,observedThread:7,acknowledged:true,retained:false});f.receipt.assertConnected();
});
it.each(['construct','wrapper','register','connect','callback'])('F2 %s失败保留准确原对象及阶段，禁止重签句柄',async mode=>{
  const f=observer(mode);await expect(f.start()).rejects.toThrow();expect(f.receipt.socket).toBe(f.socket);expect(f.receipt.summary().retained).toBe(true);expect(f.life.retain).toHaveBeenCalled();
  if(mode==='construct'){expect(f.receipt.driver).toBeUndefined();expect(f.connects()).toBe(0);}else expect(f.receipt.driver).toBe(f.driver);
  await expect(f.start()).rejects.toThrow();expect(()=>f.receipt.captureSocket(new RamSocket())).toThrow();expect(f.receipt.socket).toBe(f.socket);
  facts.push({finding:'F2',mode,actualNetwork:0,ramConnects:f.connects(),summary:f.receipt.summary()});
});
it('F2晚回ACK只能保留原thread线索，不在deadline后重新授权',async()=>{
  const f=observer('late'),pending=f.start(),rejection=expect(pending).rejects.toThrow();f.life.expire();f.done();await rejection;f.life.restore();expect(f.receipt.summary()).toMatchObject({observedThread:7,acknowledged:false,retained:true});expect(()=>f.receipt.assertConnected()).toThrow();await expect(f.start()).rejects.toThrow();
});
it.each(['stream','wrapper','thread','peer','closed','destroyed'])('F2 %s漂移后恢复原值仍无授权',async mode=>{
  const f=observer();await f.start();if(mode==='stream')f.driver.stream=new RamSocket();if(mode==='wrapper')f.wrapper.connection=new RamDriver(f.socket);if(mode==='thread')f.driver.threadId=8;if(mode==='peer')f.socket.remotePort=3306;if(mode==='closed')f.socket.closed=true;if(mode==='destroyed')f.socket.destroyed=true;
  expect(()=>f.receipt.assertConnected()).toThrow();f.driver.stream=f.socket;f.wrapper.connection=f.driver;f.driver.threadId=7;f.socket.remotePort=13384;f.socket.closed=f.socket.destroyed=false;expect(()=>f.receipt.assertConnected()).toThrow();
});
it('F2正常关闭只认可原driver的原Socket，之后不能复用查询授权',async()=>{
  const f=observer();await f.start();f.socket.closed=f.socket.destroyed=true;f.receipt.confirmClosed();f.receipt.assertCurrent();expect(f.receipt.summary().normalClosed).toBe(true);expect(()=>f.receipt.assertConnected()).toThrow();
});

function ownership(){const plan=insertUiOwnershipPlan(0,'a'.repeat(32),'b'.repeat(64)),definitions=Object.fromEntries(plan.tables.map(name=>[name,'本例原定义:'+name]));return{plan,definitions,proof:{server:[{uuid:'f568f70e-c730-11f1-8190-3e6c830dde01',version:'8.4.11',os:'Linux',names:'0'}],marker:[{nonce:plan.nonce,case_hash:plan.caseHash,scenario:0}],tables:plan.tables.map(name=>({name,kind:'BASE TABLE',comment:plan.comment})),source:structuredClone(insertUiPreciseSource),target:[{n:'0'}],neighbor:[{id:7,nonce:plan.nonce}],unknown:{triggers:[] as object[],routines:[] as object[],events:[] as object[]},definitions:{...definitions}}};}
it('F3原ACK、准确实例、标记、完整集合和源邻表均真才接纳',()=>{const f=ownership();expect(()=>assertInsertUiSchema(f.plan,true,f.proof,f.definitions)).not.toThrow();});
it.each(['ack','uuid','marker','hash','missing-marker','extra-table','missing-table','view','comment','definition','source','target','neighbor','trigger','routine','event'])('F3 %s未知停链，即使恢复快照也不能DROP',async mode=>{
  const f=ownership(),life=lifetime(),drop=vi.fn(),snapshot=structuredClone(f.proof);let ack=true;
  if(mode==='ack')ack=false;if(mode==='uuid')f.proof.server[0].uuid='另一实例';if(mode==='marker')f.proof.marker[0].nonce='c'.repeat(32);if(mode==='hash')f.proof.marker[0].case_hash='d'.repeat(64);if(mode==='missing-marker')f.proof.marker=[];if(mode==='extra-table')f.proof.tables.push({name:'unknown',kind:'BASE TABLE',comment:f.plan.comment});if(mode==='missing-table')f.proof.tables.pop();if(mode==='view')f.proof.tables[0].kind='VIEW';if(mode==='comment')f.proof.tables[0].comment='另一代';if(mode==='definition')f.proof.definitions.insert_source='另一代DDL';if(mode==='source')f.proof.source[0].doc='9007199254740992';if(mode==='target')f.proof.target[0].n='1';if(mode==='neighbor')f.proof.neighbor[0].nonce='另一代';if(mode==='trigger')f.proof.unknown.triggers=[{}];if(mode==='routine')f.proof.unknown.routines=[{}];if(mode==='event')f.proof.unknown.events=[{}];
  await expect(life.scope.step(async()=>{assertInsertUiSchema(f.plan,ack,f.proof,f.definitions);drop();})).rejects.toThrow();await expect(life.scope.step(async()=>{assertInsertUiSchema(f.plan,true,snapshot,f.definitions);drop();})).rejects.toThrow();expect(drop).not.toHaveBeenCalled();
  facts.push({finding:'F3',mode,randomNameGate:true,newRejected:true,dropCalls:0,restoredStillRetained:true});
});
it('F4两行原文JSON大整数及独立手写HEX能拒绝舍入后的值',async()=>{
  const plan=insertUiOwnershipPlan(0,'a'.repeat(32),'b'.repeat(64));const expected=expectedPreciseInsertUiFile(plan.database);expect(expected).toContain("_utf8mb4 X'39303037313939323534373430393933'");expect(insertUiPreciseSource[0].doc).toBe('9007199254740993');
  for(const doc of ['9007199254740993','9007199254740992']){const file=new QueryInsertFile({database:plan.database,table:'insert_target',columns:['note','big_value','amount','doc','payload']},async()=>{});await file.consume({kind:'rows-start',resultOrdinal:1,rowResultOrdinal:1,statementOrdinal:1,columns:['BLOB','LONGLONG','NEWDECIMAL','JSON','BLOB'].map((type,index)=>({position:index+1,key:'k'+index,name:'v'+index,exportName:'v'+index,type}))});await file.consume({kind:'row',resultOrdinal:1,values:[null,'18446744073709551615','12345678901234567890.120000',doc,{type:'binary',base64:'AP8='}]});await file.consume({kind:'row',resultOrdinal:1,values:['','9007199254740993','0.000001','null',{type:'binary',base64:''}]});await file.consume({kind:'rows-end',resultOrdinal:1});const sample=file.complete();expect(sample.totalRows).toBe(2);if(doc.endsWith('93'))expect(sample.sql).toBe(expected);else expect(sample.sql).not.toBe(expected);}
  facts.push({finding:'F4',rows:2,original:'9007199254740993',rounded:'9007199254740992',expectedHex:'39303037313939323534373430393933',roundedRejected:true,parsedForExpected:false});
});
it('实际live接线先写nonce日记再分配Socket，DROP只在原PID退出和完整namespaceProof之后',()=>{
  const live=readFileSync(new URL('../e2e/query-insert-ui-live.ts',import.meta.url),'utf8');const start=live.indexOf('scope.assertCurrent();',live.indexOf('const resourceCheck'));
  const order=['journal!.start(plan)','allocate:()=>new Socket()','receipt-unused','confirmOwnedDesktopExit(info)','namespaceProof(true)','DROP DATABASE'];const positions=order.filter(value=>value!=='receipt-unused').map(value=>live.indexOf(value,start));expect(positions.every(value=>value>=0)).toBe(true);expect([...positions].sort((a,b)=>a-b)).toEqual(positions);
  expect(live).toContain('originalFile(partialReceipt!,file)');expect(live).toContain('originalFile(targetReceipt!,file)');expect(live).toContain('captureInsertUiFile(file,targetHandle!');expect(live).toContain('captureInsertUiFile(temporary,partialHandle!');expect(live).toContain("CAST('9007199254740993' AS JSON)");expect(live).not.toMatch(/JSON\.parse|IF EXISTS|\.destroy\(/);
});
