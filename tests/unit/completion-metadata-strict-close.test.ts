import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ConnectionProfile} from '../../src/shared/contracts';
const ports=vi.hoisted(()=>({create:vi.fn()}));
// 只替换驱动传输端口；Engine、connect、目录读取、关闭及资源账本均使用真实代码。
vi.mock('mysql2',async()=>{const original=await vi.importActual<any>('mysql2');return{...original,default:{...original.default,createConnection:ports.create}};});
import {Engine} from '../../src/engine';
const profile:ConnectionProfile={id:'strict-completion',name:'RAM补全收尾',group:'',color:'',dialect:'mysql',host:'never-connect.invalid',port:1,user:'RAM'};
const input={kind:'columns' as const,connectionId:profile.id,taskId:'columns',database:'dbark_upsert_'+('a'.repeat(32)),table:'subject',prefix:'',profile};
const rows=['id','note','created_at'].map(name=>({name,kind:'column',dataType:'varchar'}));
beforeEach(()=>ports.create.mockReset());afterEach(()=>vi.useRealTimers());

/** QUIT回调、写队列完成及原流close分开交付，不用调用次数伪造物理终态。 */
function driver(threadId:number,holdColumns=false,closeOnDestroy=true){
  let ended!:()=>void,columns!:()=>void,killed!:()=>void,flush:((error?:Error)=>void)|undefined,reply:((error:Error|null,rows:unknown,fields:unknown[])=>void)|undefined;
  const endSeen=new Promise<void>(resolve=>{ended=resolve;}),columnsSeen=new Promise<void>(resolve=>{columns=resolve;}),killSeen=new Promise<void>(resolve=>{killed=resolve;});
  const stream=Object.assign(new EventEmitter(),{closed:false,end:vi.fn(),destroy:vi.fn()});
  const close=()=>{if(!stream.closed){stream.closed=true;stream.emit('close');}};
  stream.end.mockImplementation((done:(error?:Error)=>void)=>{flush=done;ended();});stream.destroy.mockImplementation(()=>{if(closeOnDestroy)close();});
  const native=Object.assign(new EventEmitter(),{stream,threadId,connect:vi.fn(),query:vi.fn(),execute:vi.fn(),end:vi.fn(),destroy:vi.fn(()=>stream.destroy())});
  native.connect.mockImplementation((done:()=>void)=>done());native.end.mockImplementation((done:()=>void)=>done());
  native.query.mockImplementation((sql:string,done:(error:null,rows:unknown,fields:unknown[])=>void)=>{
    const result=sql.startsWith('SELECT VERSION')?[{version:'8.4.11',sqlMode:'',currentDatabase:null,identifierCase:0}]:sql.includes('lower_case_table_names')?[{mode:0}]:{affectedRows:0};done(null,result,[]);if(sql.startsWith('KILL CONNECTION'))killed();
  });
  native.execute.mockImplementation((_sql:string,_values:unknown[],done:typeof reply)=>{reply=done;columns();if(!holdColumns)done!(null,rows,[]);});ports.create.mockReturnValueOnce(native);
  return{native,stream,endSeen,columnsSeen,killSeen,close,flushOnly:()=>{const done=flush;flush=undefined;done?.();},finish:()=>{const done=flush;flush=undefined;done?.();close();},replyColumns:(error:Error|null)=>reply!(error,rows,[])};
}

it('查询成功及QUIT回调先到时保持未交付，原流close后才返回字段并释放任务号',async()=>{
  const f=driver(41),engine=new Engine(()=>{});let settled=false;
  const pending=engine.handle('metadata.completion',input).then(value=>{settled=true;return value;});await f.endSeen;
  expect(settled).toBe(false);expect(f.stream.closed).toBe(false);expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(true);
  expect(f.native.end).toHaveBeenCalledOnce();expect(f.native.execute).toHaveBeenCalledOnce();expect(f.native.destroy).not.toHaveBeenCalled();
  f.finish();const result=await pending;expect(result.entries).toEqual(rows);expect(settled).toBe(true);expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(false);expect(f.native.execute).toHaveBeenCalledOnce();
});

it('取消到达已完成动作的关闭间隙只等待原收尾，不开控制连接或重放目录',async()=>{
  const f=driver(42),engine=new Engine(()=>{}),pending=engine.handle('metadata.completion',input);await f.endSeen;let cancelled=false;
  const cancellation=engine.handle('query.cancel',{taskId:input.taskId}).then(()=>{cancelled=true;});await Promise.resolve();expect(cancelled).toBe(false);expect(ports.create).toHaveBeenCalledOnce();
  f.finish();await pending;await cancellation;expect(cancelled).toBe(true);expect(f.native.execute).toHaveBeenCalledOnce();expect(f.native.query.mock.calls.some(([sql])=>sql.startsWith('KILL'))).toBe(false);expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(false);
});

it('执行中取消等原命令终态及控制流close，KILL确认不提前交付取消成功',async()=>{
  const main=driver(43,true),control=driver(44),engine=new Engine(()=>{});const pending=engine.handle('metadata.completion',input),failure=expect(pending).rejects.toThrow('合成读取中断');await main.columnsSeen;let cancelled=false;
  const cancellation=engine.handle('query.cancel',{taskId:input.taskId}).then(()=>{cancelled=true;});await control.killSeen;await Promise.resolve();
  expect(cancelled).toBe(false);expect(main.native.end).not.toHaveBeenCalled();expect(control.native.end).not.toHaveBeenCalled();
  main.replyColumns(Error('合成读取中断'));await control.endSeen;expect(cancelled).toBe(false);expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(true);
  control.finish();await failure;await cancellation;expect(main.stream.closed).toBe(true);expect(control.stream.closed).toBe(true);expect(main.native.execute).toHaveBeenCalledOnce();expect(control.native.query.mock.calls.filter(([sql])=>sql.startsWith('KILL CONNECTION'))).toHaveLength(1);expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(false);
});

it('写队列完成但原流close未知时仍失败并保留资源账本，不返回目录或自动重放',async()=>{
  vi.useFakeTimers();const f=driver(45,false,false),engine=new Engine(()=>{}),pending=engine.handle('metadata.completion',input),failure=expect(pending).rejects.toThrow('物理终态尚未确认');await f.endSeen;
  f.flushOnly();expect(f.stream.closed).toBe(false);await vi.advanceTimersByTimeAsync(1001);await failure;
  expect(Reflect.get(engine,'independentResources').owns(input.taskId)).toBe(true);expect(f.native.execute).toHaveBeenCalledOnce();expect(ports.create).toHaveBeenCalledOnce();expect(f.native.destroy).toHaveBeenCalled();
});
