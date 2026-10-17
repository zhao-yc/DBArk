import {EventEmitter} from 'node:events';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ConnectionResourceOwner} from '../../src/engine/connectionResourceState';

/** 所有资源均为RAM端口；destroy只记录请求，close事件另行独立交付。 */
function resource() { return Object.assign(new EventEmitter(),{closed:false,destroy:vi.fn(),close:vi.fn(),incoming:{state:'open'},outgoing:{state:'open'}}); }
afterEach(()=>vi.useRealTimers());
describe('物理连接全部资源的独立终态与显式恢复',()=>{
  it('封账及实际流关闭前均未确认，end/destroyed不能代替close',()=>{
    const raw=resource(),owner=new ConnectionResourceOwner(()=>raw,()=>{});owner.captureTransport(true);
    raw.emit('end');Object.assign(raw,{destroyed:true});expect(owner.recovery.snapshot().confirmedClosed).toBe(false);
    raw.closed=true;expect(owner.recovery.snapshot().confirmedClosed).toBe(false);
    owner.seal();expect(owner.recovery.snapshot().confirmedClosed).toBe(true);
  });
  it('TLS替换前后的两个实际流都必须关闭，不能只看当前native.stream',()=>{
    const raw=resource(),tls=resource();let current=raw;const owner=new ConnectionResourceOwner(()=>current,()=>{});owner.captureTransport(true);current=tls;owner.captureTransport();owner.seal();
    tls.closed=true;expect(owner.recovery.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:2});raw.closed=true;expect(owner.recovery.snapshot().confirmedClosed).toBe(true);
  });
  it('SSH channel和client分别证明，EOF与client.closed属性均不能冒充client close事件',()=>{
    const channel=resource(),client=resource(),owner=new ConnectionResourceOwner(()=>channel,()=>{});owner.add('ssh-client',client);owner.add('ssh-channel',channel);owner.captureTransport(true);owner.seal();
    channel.incoming.state='eof';channel.outgoing.state='eof';channel.emit('end');client.closed=true;client.emit('end');expect(owner.recovery.snapshot().confirmedClosed).toBe(false);
    channel.incoming.state='closed';channel.outgoing.state='closed';expect(owner.recovery.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:2,pendingKinds:['ssh-client']});
    client.emit('close');expect(owner.recovery.snapshot().confirmedClosed).toBe(true);
  });
  it('迟到channel分配在回调交付并自身关闭前阻止确认',()=>{
    const client=resource(),late=resource(),owner=new ConnectionResourceOwner(()=>undefined,()=>{});owner.add('ssh-client',client);const allocated=owner.beginAllocation();owner.seal();client.emit('close');
    expect(owner.recovery.snapshot()).toMatchObject({confirmedClosed:false,pendingAllocations:1});owner.add('ssh-channel',late);allocated();allocated();
    expect(owner.recovery.snapshot()).toMatchObject({confirmedClosed:false,pendingAllocations:0});late.emit('close');expect(owner.recovery.snapshot().confirmedClosed).toBe(true);
  });
  it('缺失数据库流、不可观察属性及资源预算溢出不构造成功证明',()=>{
    const missing=new ConnectionResourceOwner(()=>undefined,()=>{});missing.captureTransport(true);missing.seal();expect(missing.recovery.snapshot()).toMatchObject({confirmedClosed:false,inventoryUnknown:true});
    const owner=new ConnectionResourceOwner(()=>undefined,()=>{});for(let i=0;i<9;i++){const closed=resource();closed.closed=true;owner.add('mysql-transport',closed);}owner.seal();
    expect(owner.recovery.snapshot()).toMatchObject({confirmedClosed:false,ownedResources:8,inventoryUnknown:true});
  });
  it('读取状态不会自动destroy；显式恢复并发合并，逐资源终态后才成功',async()=>{
    const raw=resource(),driver=vi.fn(),owner=new ConnectionResourceOwner(()=>raw,driver);owner.captureTransport(true);owner.seal();owner.recovery.snapshot();expect(driver).not.toHaveBeenCalled();
    const one=owner.recovery.recover(),two=owner.recovery.recover();expect(one).toBe(two);expect(driver).toHaveBeenCalledOnce();expect(raw.destroy).toHaveBeenCalledOnce();
    raw.emit('close');expect(await one).toMatchObject({state:{confirmedClosed:true},timedOut:false,actionFailed:false});
  });
  it('有界超时返回未知；迟到close独立更新状态，后续显式恢复无需重试缓存拒绝Promise',async()=>{
    vi.useFakeTimers();const raw=resource(),driver=vi.fn(),owner=new ConnectionResourceOwner(()=>raw,driver,25);owner.captureTransport(true);owner.seal();
    const pending=owner.recovery.recover();await vi.advanceTimersByTimeAsync(26);expect(await pending).toMatchObject({state:{confirmedClosed:false},timedOut:true});
    raw.emit('close');expect(owner.recovery.snapshot().confirmedClosed).toBe(true);expect(await owner.recovery.recover()).toMatchObject({state:{confirmedClosed:true},timedOut:false});expect(driver).toHaveBeenCalledOnce();
  });
  it('destroy抛错不泄露正文，全部同步close后也保留独立动作失败标志',async()=>{
    const raw=resource(),owner=new ConnectionResourceOwner(()=>raw,()=>{raw.emit('close');throw Error('私有驱动正文');});owner.captureTransport(true);owner.seal();
    const result=await owner.recovery.recover();expect(result).toMatchObject({state:{confirmedClosed:true},actionFailed:true});expect(JSON.stringify(result)).not.toContain('私有');
  });
  it('回执冻结，不向host暴露原资源对象或可变pending列表',()=>{
    const raw=resource(),owner=new ConnectionResourceOwner(()=>raw,()=>{});owner.captureTransport(true);owner.seal();const state=owner.recovery.snapshot();
    expect(Object.isFrozen(state)).toBe(true);expect(Object.isFrozen(state.pendingKinds)).toBe(true);expect(Object.values(state)).not.toContain(raw);expect(Object.keys(owner.recovery)).toEqual(['snapshot','recover']);
  });
});
