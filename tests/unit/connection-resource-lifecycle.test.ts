import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ConnectionProfile} from '../../src/shared/contracts';
import type {ConnectionResourceRecovery} from '../../src/engine/connectionResourceState';
const ports=vi.hoisted(()=>({create:vi.fn(),ssh:vi.fn()}));
vi.mock('mysql2',()=>({default:{createConnection:ports.create}}));
vi.mock('ssh2',()=>({Client:ports.ssh}));
import {connect} from '../../src/engine/connection';
const profile:ConnectionProfile={id:'resource-unit',name:'资源归属RAM',group:'',color:'',dialect:'mysql',host:'no-network.invalid',port:1,user:'unit'};
beforeEach(()=>{ports.create.mockReset();ports.ssh.mockReset();});
afterEach(()=>vi.useRealTimers());

/** destroy是否交付close由本端口独立指定，不能用调用次数伪造终态。 */
function transport(closeOnDestroy=true){
  const raw=Object.assign(new EventEmitter(),{closed:false,destroy:vi.fn(),end:vi.fn(),close:vi.fn(),incoming:{state:'open'},outgoing:{state:'open'}});
  raw.destroy.mockImplementation(()=>{if(closeOnDestroy){raw.closed=true;raw.emit('close');}});
  raw.end.mockImplementation((done?:()=>void)=>{done?.();raw.closed=true;raw.emit('close');});return raw;
}
/** 只给初始化两条SQL提供合成回包；未导入真实端点或认证文件。 */
function driver(raw=transport()){
  const native=Object.assign(new EventEmitter(),{stream:raw,threadId:7,connect:vi.fn(),end:vi.fn(),destroy:vi.fn(),query:vi.fn()});
  native.connect.mockImplementation((done:(error?:Error)=>void)=>queueMicrotask(()=>done()));
  native.end.mockImplementation((done:(error?:Error)=>void)=>done());
  native.destroy.mockImplementation(()=>native.stream.destroy());
  native.query.mockImplementation((sql:string,done:(error:null,rows:unknown,fields:unknown[])=>void)=>{done(null,sql.startsWith('SELECT VERSION')?[{version:'8.4.11',sqlMode:'STRICT_ALL_TABLES',currentDatabase:null,identifierCase:0}]:{affectedRows:0},[]);});
  ports.create.mockReturnValue(native);return native;
}
/** SSH client的end与destroy不默认证明close，便于分别验证隧道终态。 */
function ssh(channel:ReturnType<typeof transport>,closeOnDestroy=false){
  const client=Object.assign(new EventEmitter(),{connect:vi.fn(),forwardOut:vi.fn(),end:vi.fn(),destroy:vi.fn()});
  client.connect.mockImplementation(()=>queueMicrotask(()=>client.emit('ready')));
  client.forwardOut.mockImplementation((...args:unknown[])=>{(args.at(-1) as Function)(null,channel);});
  client.destroy.mockImplementation(()=>{if(closeOnDestroy)client.emit('close');});
  ports.ssh.mockImplementation(function(){return client;});return client;
}
const sshProfile={...profile,ssh:{enabled:true,host:'ssh.invalid',port:1,user:'unit',hostFingerprint:'SHA256:unit'}};

describe('真实connect与close资源回执接线（驱动替身，实际0）',()=>{
  it('分配前交付资源句柄，成功关闭后全部流确认且没有DDL',async()=>{
    const native=driver();let early:ConnectionResourceRecovery|undefined;
    const managed=await connect(profile,undefined,undefined,resources=>{early=resources;expect(ports.create).not.toHaveBeenCalled();expect(ports.ssh).not.toHaveBeenCalled();expect(resources.snapshot().allocationSettled).toBe(false);});
    expect(managed.resources).toBe(early);expect(early!.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:1,allocationSettled:true});
    await managed.close({strict:true});expect(early!.snapshot().confirmedClosed).toBe(true);expect(native.query.mock.calls.map(([sql])=>sql)).toHaveLength(2);expect(native.query.mock.calls.some(([sql])=>/^(ALTER|CREATE|KILL)/.test(sql))).toBe(false);
  });
  it('分配前登记拒绝时不创建任何驱动资源，零资源封账可确认',async()=>{
    let early:ConnectionResourceRecovery|undefined;const denied=Error('合成容量已满');
    await expect(connect(profile,undefined,undefined,resources=>{early=resources;throw denied;})).rejects.toBe(denied);
    expect(ports.create).not.toHaveBeenCalled();expect(ports.ssh).not.toHaveBeenCalled();expect(early!.snapshot()).toMatchObject({confirmedClosed:true,ownedResources:0});
  });
  it('严格close缓存拒绝不重试；显式资源恢复能独立确认，原close仍保持原错误',async()=>{
    vi.useFakeTimers();const raw=transport(false),native=driver(raw);native.end.mockImplementation((done:(error:Error)=>void)=>done(Error('合成QUIT私有错误')));
    const managedPromise=connect(profile);await vi.runAllTicks();const managed=await managedPromise;
    const pending=managed.close({strict:true}).catch(error=>error);await vi.advanceTimersByTimeAsync(1001);const failure=await pending;expect(failure).toBeInstanceOf(Error);expect(managed.resources!.snapshot().confirmedClosed).toBe(false);
    await expect(managed.close({strict:true})).rejects.toBe(failure);expect(native.end).toHaveBeenCalledOnce();
    raw.destroy.mockImplementation(()=>{raw.closed=true;raw.emit('close');});const result=await managed.resources!.recover();expect(result.state.confirmedClosed).toBe(true);
    await expect(managed.close({strict:true})).rejects.toBe(failure);expect(native.end).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('私有');
  });
  it('TLS升级前原流未关闭时，当前native流关闭也不构成完整资源证明',async()=>{
    const raw=transport(),secure=transport(),native=driver(raw);native.connect.mockImplementation((done:()=>void)=>{native.stream=secure;done();});
    const managed=await connect(profile);await managed.close({strict:true});expect(secure.closed).toBe(true);expect(raw.closed).toBe(false);
    expect(managed.resources!.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:2});expect((await managed.resources!.recover()).state.confirmedClosed).toBe(true);expect(raw.closed).toBe(true);
  });
  it('数据库流与channel已关但SSH client未close时不确认；迟到client close不重试原close',async()=>{
    vi.useFakeTimers();const channel=transport(),client=ssh(channel),native=driver(channel);
    const managedPromise=connect(sshProfile);await vi.runAllTicks();const managed=await managedPromise;
    const pending=managed.close({strict:true}).catch(error=>error);await vi.advanceTimersByTimeAsync(1001);expect(await pending).toBeInstanceOf(Error);expect(channel.closed).toBe(true);
    expect(managed.resources!.snapshot()).toMatchObject({confirmedClosed:false,pendingKinds:['ssh-client']});
    client.emit('close');expect(managed.resources!.snapshot().confirmedClosed).toBe(true);expect((await managed.resources!.recover()).state.confirmedClosed).toBe(true);expect(native.end).toHaveBeenCalledOnce();
  });
  it('SSH握手取消且client已close后不会再分配channel，不要求永不发生的ready回调',async()=>{
    const channel=transport(),client=ssh(channel,true),controller=new AbortController();client.connect.mockImplementation(()=>{});let early:ConnectionResourceRecovery|undefined;
    const pending=connect(sshProfile,undefined,controller.signal,resources=>{early=resources;}).catch(error=>error);controller.abort();expect(await pending).toBeInstanceOf(Error);
    expect(early!.snapshot()).toMatchObject({confirmedClosed:true,pendingAllocations:0});client.emit('ready');expect(client.forwardOut).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();
  });
  it('SSH转发取消后迟到channel仍登记并关闭，交付前不假报资源已释放',async()=>{
    const channel=transport(),client=ssh(channel,true),controller=new AbortController();let callback:Function|undefined,early:ConnectionResourceRecovery|undefined;
    client.forwardOut.mockImplementation((...args:unknown[])=>{callback=args.at(-1) as Function;});
    const pending=connect(sshProfile,undefined,controller.signal,resources=>{early=resources;}).catch(error=>error);await vi.waitFor(()=>expect(callback).toBeDefined());controller.abort();expect(await pending).toBeInstanceOf(Error);
    expect(early!.snapshot()).toMatchObject({confirmedClosed:false,pendingAllocations:1});callback!(null,channel);expect(channel.closed).toBe(true);expect(early!.snapshot()).toMatchObject({confirmedClosed:true,pendingAllocations:0});expect(ports.create).not.toHaveBeenCalled();
  });
  it('mysql握手取消后迟到TLS流仍需独立恢复，未返回Managed也保留可恢复句柄',async()=>{
    const raw=transport(),secure=transport(),native=driver(raw),controller=new AbortController();let callback:Function|undefined,early:ConnectionResourceRecovery|undefined;
    native.connect.mockImplementation((done:Function)=>{callback=done;});const pending=connect(profile,undefined,controller.signal,resources=>{early=resources;}).catch(error=>error);
    controller.abort();expect(await pending).toBeInstanceOf(Error);expect(early!.snapshot()).toMatchObject({confirmedClosed:false,pendingAllocations:1});
    native.stream=secure;callback!();expect(early!.snapshot()).toMatchObject({confirmedClosed:false,pendingAllocations:0,ownedResources:2});
    expect((await early!.recover()).state.confirmedClosed).toBe(true);expect(native.query).not.toHaveBeenCalled();
  });
});
