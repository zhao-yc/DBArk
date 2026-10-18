import {afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile}from'node:fs/promises';
import{join}from'node:path';import{tmpdir}from'node:os';
import{QueryInsertConfirmations}from'../../src/engine/queryInsertConfirmations';
import{queryInsertLimits,type QueryInsertPending}from'../../src/shared/queryInsertExport';
import{queryInsertMain}from'../fixtures/query-insert-export';
import type{QueryFrameConsumer}from'../../src/engine/queryStreamProtocol';
const mocks=vi.hoisted(()=>({connect:vi.fn(),execute:vi.fn(),frames:vi.fn()}));
vi.mock('../../src/engine/connection',()=>({connect:mocks.connect,execute:mocks.execute}));
vi.mock('../../src/engine/queryStreamProtocol',()=>({consumeQueryFrames:mocks.frames}));
import{Engine}from'../../src/engine';
let engine:Engine,main:ReturnType<typeof queryInsertMain>,folder:string,path:string,sessionId:string;
const target={database:'库',table:'完整',columns:['编号','精确值']};
const input=()=>({sessionId,taskId:'insert-stream',sql:'SELECT value FROM source',fileToken:'',format:'sql',encoding:'utf8',protocol:'text-strict',resultSelection:{kind:'all'},insertTarget:target});
/** 通过正式Main事件的有界轮询等待RAM阶段，不访问服务或实际进程。 */
async function staged():Promise<QueryInsertPending>{let pending:QueryInsertPending|undefined;await vi.waitFor(()=>{pending=main.events.find(event=>event.queryInsert)?.queryInsert;expect(pending).toBeDefined();});return pending!;}
async function choose(){return main.invoke('files.choose',{purpose:'export',format:'sql',queryInsertExport:true});}
beforeEach(async()=>{
  folder=await mkdtemp(join(tmpdir(),'dbark-insert-stream-'));path=join(folder,'完整.sql');await writeFile(path,'原文件');
  mocks.connect.mockReset().mockResolvedValue({connection:{threadId:41,destroy:vi.fn()},profile:{id:'p'},status:{dialect:'mysql',version:'8.4'},sqlMode:'',serverStatus:2,transactionStateKnown:true,broken:false,close:vi.fn()});mocks.execute.mockReset().mockResolvedValue({rows:{},fields:[]});
  mocks.frames.mockReset().mockImplementation(async(_managed:unknown,_sql:string,_wire:string,consumer:QueryFrameConsumer)=>{
    const resultOrdinal=++consumer.ordinals.results;
    await consumer.consume({kind:'rows-start',resultOrdinal,statementOrdinal:consumer.statementOrdinal,rowResultOrdinal:++consumer.ordinals.rows,columns:[{position:1,key:'c0',name:'不猜来源',exportName:'c0',type:'LONG'},{position:2,key:'c1',name:'任意别名',exportName:'c1',type:'NEWDECIMAL'}]});
    for(let index=0;index<301;index++)await consumer.consume({kind:'row',resultOrdinal,values:[index,'9007199254740993.12345678901234567890']});
    await consumer.consume({kind:'rows-end',resultOrdinal});
  });
  engine=new Engine(event=>main?.emit(event));await engine.handle('connections.open',{id:'p',profile:{id:'p'}});sessionId=(await engine.handle('sessions.open',{connectionId:'p'})).sessionId;
  main=queryInsertMain(path,sessionId,(command,value)=>engine.handle(command as any,value));
});
afterEach(async()=>{await engine.closeAll();await rm(folder,{recursive:true,force:true});vi.useRealTimers();});
describe('正式Main到Engine的完整INSERT暂存发布',()=>{
  it('选择与预览不额外执行；暂存完整301行仍运行，确认后只发布同一内容，单次SQL且无新连接',async()=>{
    const file=await choose();expect(mocks.frames).not.toHaveBeenCalled();const connects=mocks.connect.mock.calls.length;
    const running=main.invoke('query.exportStream',{...input(),fileToken:file.token});const pending=await staged();
    expect(pending).toMatchObject({totalRows:301,shownRows:20,target,encoding:'utf8'});expect(await readFile(path,'utf8')).toBe('原文件');expect(main.tasks.get('insert-stream').status).toBe('running');
    const partial=(await readdir(folder)).find(name=>name.endsWith('.partial'))!,temporary=await readFile(join(folder,partial),'utf8');
    expect(Buffer.byteLength(temporary)).toBe(pending.bytes);expect(temporary.startsWith(pending.sql)).toBe(true);expect((temporary.match(/INSERT INTO/g)||[]).length).toBe(301);
    expect(mocks.frames.mock.calls.map(call=>call[1])).toEqual(['SELECT value FROM source']);
    await main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true});const output=await running;
    expect(await readFile(path,'utf8')).toBe(temporary);expect(output.fileCommitted).toBe(true);expect(output.preview.results[0].rows).toHaveLength(200);expect(mocks.connect).toHaveBeenCalledTimes(connects);expect(mocks.frames).toHaveBeenCalledOnce();expect(mocks.execute).not.toHaveBeenCalled();expect(await readdir(folder)).toEqual(['完整.sql']);
    expect(main.stored.every(record=>!('queryInsert'in record))).toBe(true);
    await expect(main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true})).rejects.toThrow();
  });
  it.each(['cancel','document','revision','session'] as const)('%s失效唤醒原任务并精确清理暂存，旧目标保持，不重放',async kind=>{
    const file=await choose(),running=main.invoke('query.exportStream',{...input(),fileToken:file.token}),rejected=expect(running).rejects.toThrow();const pending=await staged();
    if(kind==='cancel')await main.invoke('query.cancel',{taskId:'insert-stream'});
    else if(kind==='document'){main.state.current=false;main.insert.invalidateAll();}
    else{if(kind==='revision')main.state.revision++;else main.sessions.set(sessionId,{connectionId:'p'});expect(main.insert.receive('insert-stream')).toBe(false);}
    await rejected;expect(await readFile(path,'utf8')).toBe('原文件');expect(await readdir(folder)).toEqual(['完整.sql']);expect(mocks.frames).toHaveBeenCalledOnce();
    const delivered=main.events.length,status=main.tasks.get('insert-stream').status;main.emit({taskId:'insert-stream',status:'running',progress:0,message:'迟到样例',queryInsert:pending});expect(main.events).toHaveLength(delivered);expect(main.tasks.get('insert-stream').status).toBe(status);
    await expect(main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true})).rejects.toThrow();
  });
  it('第二个结果或状态包失败保旧目标，不能展示成功预览或执行第三条',async()=>{
    const file=await choose();await expect(main.invoke('query.exportStream',{...input(),fileToken:file.token,sql:'SELECT 1;SELECT 2;SELECT 3'})).rejects.toThrow('可能已执行');expect(mocks.frames).toHaveBeenCalledTimes(2);expect(main.events.some(event=>event.queryInsert)).toBe(false);expect(await readFile(path,'utf8')).toBe('原文件');expect(await readdir(folder)).toEqual(['完整.sql']);
  });
  it('普通SQL令牌或夹带路径不能用于INSERT执行，确认目标错误也不消费正确待发布能力',async()=>{
    const ordinary=await main.invoke('files.choose',{purpose:'export',format:'sql'});await expect(main.invoke('query.exportStream',{...input(),fileToken:ordinary.token})).rejects.toThrow();expect(mocks.frames).not.toHaveBeenCalled();
    const file=await choose(),running=main.invoke('query.exportStream',{...input(),taskId:'proper',fileToken:file.token});const pending=await staged();
    await expect(main.invoke('query.confirmInsertExport',{taskId:'proper',previewToken:pending.previewToken,confirmation:'别库.完整',acknowledged:true})).rejects.toThrow();expect(await readFile(path,'utf8')).toBe('原文件');
    await main.invoke('query.confirmInsertExport',{taskId:'proper',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true});await running;
  });
  it('暂存被改写时拒绝发布且不删除已不属于原内容代次的文件',async()=>{
    const file=await choose(),running=main.invoke('query.exportStream',{...input(),fileToken:file.token}),failure=expect(running).rejects.toThrow('身份');const pending=await staged();
    const partial=(await readdir(folder)).find(name=>name.endsWith('.partial'))!;await writeFile(join(folder,partial),'外来修改');await main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true});await failure;
    expect(await readFile(path,'utf8')).toBe('原文件');expect(await readFile(join(folder,partial),'utf8')).toBe('外来修改');expect(mocks.frames).toHaveBeenCalledOnce();
  });
  it('完整暂存后原物理会话断开，确认不得重连或继续发布',async()=>{
    const file=await choose(),running=main.invoke('query.exportStream',{...input(),fileToken:file.token}),failure=expect(running).rejects.toThrow('归属变化');const pending=await staged(),connects=mocks.connect.mock.calls.length;
    const managed=await mocks.connect.mock.results.at(-1)!.value;managed.broken=true;
    await main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true});await failure;expect(await readFile(path,'utf8')).toBe('原文件');expect(await readdir(folder)).toEqual(['完整.sql']);expect(mocks.connect).toHaveBeenCalledTimes(connects);expect(mocks.frames).toHaveBeenCalledOnce();
  });
  it('退出询问期间只阻止发布，选择继续工作后原待确认任务仍可单次发布',async()=>{
    const file=await choose(),running=main.invoke('query.exportStream',{...input(),fileToken:file.token}),pending=await staged();main.state.closing=true;
    main.emit({taskId:'insert-stream',status:'running',progress:0,message:'原进度'});
    await expect(main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true})).rejects.toThrow();expect(main.tasks.get('insert-stream').status).toBe('running');expect(await readFile(path,'utf8')).toBe('原文件');
    main.state.closing=false;await main.invoke('query.confirmInsertExport',{taskId:'insert-stream',previewToken:pending.previewToken,confirmation:'库.完整',acknowledged:true});expect((await running).fileCommitted).toBe(true);expect(mocks.frames).toHaveBeenCalledOnce();
  });
  it('TTL只撤销等待确认，不重新执行、自动发布或吞掉过期错误',async()=>{
    vi.useFakeTimers();const gate=new QueryInsertConfirmations();let pending!:QueryInsertPending;
    const waiting=gate.wait('t',{sql:'实际样例',shownRows:1,totalRows:1},target,'utf8',10,value=>pending=value),rejected=expect(waiting).rejects.toThrow('过期');
    await vi.advanceTimersByTimeAsync(queryInsertLimits.ttlMs);await rejected;expect(()=>gate.confirm({taskId:'t',previewToken:pending.previewToken,confirmation:'库.完整'})).toThrow();
  });
});
