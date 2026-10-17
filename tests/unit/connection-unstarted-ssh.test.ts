import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ConnectionResourceRecovery} from '../../src/engine/connectionResourceState';
const ports=vi.hoisted(()=>({create:vi.fn(),ssh:vi.fn(),read:vi.fn()}));
vi.mock('mysql2',()=>({default:{createConnection:ports.create}}));
vi.mock('ssh2',()=>({Client:ports.ssh}));
vi.mock('node:fs/promises',()=>({readFile:ports.read}));
import {connect} from '../../src/engine/connection';
const profile={id:'unstarted-ssh',name:'未开始SSH的RAM流程',group:'',color:'',dialect:'mysql' as const,host:'no-network.invalid',port:1,user:'unit',ssh:{enabled:true,host:'no-ssh.invalid',port:1,user:'unit',hostFingerprint:'SHA256:unit',privateKeyPath:'合成路径，不读取真实文件'}};
/** 未connect的ssh2 Client没有socket，destroy不产生close；此处不伪造关闭成功。 */
function client(){const value=Object.assign(new EventEmitter(),{connect:vi.fn(),destroy:vi.fn(),end:vi.fn(),forwardOut:vi.fn()});ports.ssh.mockImplementation(function(){return value;});return value;}
beforeEach(()=>{ports.create.mockReset();ports.ssh.mockReset();ports.read.mockReset();});
afterEach(()=>vi.useRealTimers());
describe('SSH对象创建与真正资源分配的准确边界',()=>{
  it('私钥读取失败前没有开始网络分配，零网络资源封账不等待client close',async()=>{
    const ssh=client(),failure=Error('合成读取失败');let receipt!:ConnectionResourceRecovery;ports.read.mockRejectedValueOnce(failure);
    await expect(connect(profile,undefined,undefined,value=>{receipt=value;})).rejects.toBe(failure);
    expect(ssh.connect).not.toHaveBeenCalled();expect(ssh.forwardOut).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();
    expect(receipt.snapshot()).toMatchObject({confirmedClosed:true,ownedResources:0,pendingKinds:[],allocationSettled:true});expect(await receipt.recover()).toMatchObject({state:{confirmedClosed:true},timedOut:false});
  });
  it('私钥读取期间取消，未开始的client不能变成永久隔离资源',async()=>{
    const ssh=client(),controller=new AbortController();let receipt!:ConnectionResourceRecovery;
    ports.read.mockImplementation((_path:string,{signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('合成读取取消')),{once:true})));
    const pending=connect(profile,undefined,controller.signal,value=>{receipt=value;}).catch(error=>error);expect(ports.read).toHaveBeenCalledOnce();controller.abort();expect(await pending).toBeInstanceOf(Error);
    expect(ssh.connect).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();expect(receipt.snapshot()).toMatchObject({confirmedClosed:true,ownedResources:0,pendingAllocations:0});expect((await receipt.recover()).timedOut).toBe(false);
  });
  it('真正connect同步交付首个close时，登记已生效且不漏掉实际资源',async()=>{
    const ssh=client(),failure=Error('合成同步连接关闭');let receipt!:ConnectionResourceRecovery;ports.read.mockResolvedValueOnce(Buffer.from('仅RAM占位，不读取私钥'));
    ssh.connect.mockImplementation(()=>{expect(receipt.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:1,pendingKinds:['ssh-client']});ssh.emit('close');ssh.emit('error',failure);});
    await expect(connect(profile,undefined,undefined,value=>{receipt=value;})).rejects.toBe(failure);
    expect(ssh.connect).toHaveBeenCalledOnce();expect(ssh.forwardOut).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();expect(receipt.snapshot()).toMatchObject({confirmedClosed:true,ownedResources:1,pendingKinds:[]});
  });
});
