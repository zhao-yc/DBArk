import {afterEach,describe,it,expect,vi} from 'vitest';
import {CompletionWorkerClient} from '../../src/renderer/completionWorkerClient';
import {completionLimits} from '../../src/shared/sqlCompletion';
/** 模拟线程传输和终止时序；语义结果的正确性由实际解析器测试验证。 */
function fixture(){
  const ports:{postMessage:ReturnType<typeof vi.fn>;terminate:ReturnType<typeof vi.fn>;onmessage:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onmessageerror:((event:any)=>void)|null}[]=[];
  const create=vi.fn(()=>{const port={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null,onerror:null,onmessageerror:null};ports.push(port);return port;});
  const client=new CompletionWorkerClient(create,100,500);
  const ready=(index=0,version=1)=>ports[index].onmessage?.({data:{type:'dbark-completion-ready',version}});
  return{client,ports,create,ready,reply:(index=0,result={status:'blocked',reason:'syntax'})=>{ready(index);const port=ports[index],id=port.postMessage.mock.lastCall?.[0].id;port.onmessage?.({data:{id,result}});}};
}

afterEach(()=>vi.useRealTimers());
describe('编辑器补全线程生命周期',()=>{
  it('等待就绪时能力也固定为独立快照，调用方修改不能开启或关闭旧请求',async()=>{
    const f=fixture(),capabilities={lateralDerivedTables:true,windowFunctions:true},request=f.client.analyze('SELECT correlated',4,{},undefined,capabilities);
    capabilities.lateralDerivedTables=false;capabilities.windowFunctions=false;expect(f.ports[0].postMessage).not.toHaveBeenCalled();f.ready();
    const actual=f.ports[0].postMessage.mock.lastCall?.[0].capabilities;expect(actual).toEqual({lateralDerivedTables:true,windowFunctions:true});expect(actual).not.toBe(capabilities);
    f.reply();await request;f.client.dispose();
  });
  it('替换旧能力请求后迟到线程不能交付给关闭能力的新请求',async()=>{
    const f=fixture(),first=f.client.analyze('old',0,{},undefined,{lateralDerivedTables:true}),old=f.ports[0].onmessage,next=f.client.analyze('new',0,{},undefined,{lateralDerivedTables:false});
    await expect(first).resolves.toMatchObject({reason:'replaced'});old?.({data:{type:'dbark-completion-ready',version:1}});expect(f.ports[1].postMessage).not.toHaveBeenCalled();f.ready(1);
    expect(f.ports[1].postMessage.mock.lastCall?.[0]).toMatchObject({source:'new',capabilities:{lateralDerivedTables:false}});f.reply(1);await next;f.client.dispose();
  });
  it('解析器初始化失败时不发送正文、不自动重试，迟到就绪也不能复活旧线程',async()=>{
    vi.useFakeTimers();const f=fixture(),request=f.client.analyze('private user statement',0),old=f.ports[0].onmessage;old?.({data:{type:'dbark-completion-unavailable',version:1}});await expect(request).resolves.toEqual({status:'blocked',reason:'worker'});expect(f.ports[0].postMessage).not.toHaveBeenCalled();expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);old?.({data:{type:'dbark-completion-ready',version:1}});expect(f.create).toHaveBeenCalledTimes(1);const next=f.client.analyze('next explicit request',0);f.reply(1);await next;f.client.dispose();
  });
  it('按需创建，交付后复用空闲线程，不在客户端保留SQL快照',async()=>{const f=fixture();expect(f.create).not.toHaveBeenCalled();const first=f.client.analyze('SELECT 1',0);f.reply();await expect(first).resolves.toEqual({status:'blocked',reason:'syntax'});const second=f.client.analyze('SELECT 2',0);f.reply();await second;expect(f.create).toHaveBeenCalledTimes(1);expect(f.ports[0].terminate).not.toHaveBeenCalled();f.client.dispose();expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);});
  it('新分析终止活动旧线程，旧消息无法完成新请求',async()=>{const f=fixture(),first=f.client.analyze('old',0),old=f.ports[0].onmessage,second=f.client.analyze('new',0);await expect(first).resolves.toEqual({status:'blocked',reason:'replaced'});expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);let settled=false;void second.then(()=>{settled=true;});old?.({data:{id:1,result:{status:'blocked',reason:'old'}}});await Promise.resolve();expect(settled).toBe(false);f.reply(1);await second;f.client.dispose();});
  it('外部取消立即终止线程，下一次触发可重新创建',async()=>{const f=fixture(),controller=new AbortController(),request=f.client.analyze('SELECT 1',0,{},controller.signal);controller.abort();await expect(request).resolves.toEqual({status:'blocked',reason:'cancelled'});expect(f.ports[0].onmessage).toBeNull();const next=f.client.analyze('SELECT 2',0);f.reply(1);await next;f.client.dispose();});
  it('超时释放占用并交付有限结果，不自动重试旧SQL',async()=>{vi.useFakeTimers();const f=fixture(),request=f.client.analyze('SELECT long',0);f.ready();await vi.advanceTimersByTimeAsync(100);await expect(request).resolves.toEqual({status:'blocked',reason:'timeout'});expect(f.ports[0].postMessage).toHaveBeenCalledTimes(1);expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);f.client.dispose();});
  it('成功后移除取消监听和计时器，不终止后续空闲线程',async()=>{vi.useFakeTimers();const f=fixture(),controller=new AbortController(),remove=vi.spyOn(controller.signal,'removeEventListener'),request=f.client.analyze('SQL',0,{},controller.signal);f.reply();await request;expect(remove).toHaveBeenCalledTimes(1);controller.abort();await vi.advanceTimersByTimeAsync(200);expect(f.ports[0].terminate).not.toHaveBeenCalled();f.client.dispose();});
  it('卸载时结束活动请求，再次调用不创建线程',async()=>{const f=fixture(),request=f.client.analyze('SQL',0);f.client.dispose();await expect(request).resolves.toEqual({status:'blocked',reason:'disposed'});await expect(f.client.analyze('SQL',0)).resolves.toEqual({status:'blocked',reason:'disposed'});expect(f.create).toHaveBeenCalledTimes(1);});
  it('已取消和超预算文本不传给线程',async()=>{const f=fixture(),controller=new AbortController();controller.abort();await expect(f.client.analyze('SQL',0,{},controller.signal)).resolves.toMatchObject({reason:'cancelled'});await expect(f.client.analyze(' '.repeat(completionLimits.sourceUnits+1),0)).resolves.toMatchObject({reason:'budget'});expect(f.create).not.toHaveBeenCalled();f.client.dispose();});
  it('线程异常不回显错误或SQL，恢复只等待下次人工编辑触发',async()=>{const f=fixture(),request=f.client.analyze('SQL private',0),preventDefault=vi.fn();f.ports[0].onerror?.({preventDefault,message:'private'});await expect(request).resolves.toEqual({status:'blocked',reason:'worker'});expect(preventDefault).toHaveBeenCalledTimes(1);expect(f.create).toHaveBeenCalledTimes(1);f.client.dispose();});
  it('传输失败和创建异常同样结束计时器，不留悬挂请求',async()=>{const client=new CompletionWorkerClient(()=>{throw Error('无法创建');});await expect(client.analyze('SQL',0)).resolves.toEqual({status:'blocked',reason:'worker'});client.dispose();});

  it('启动耗时超过解析期限仍可就绪，用户SQL在有效就绪前不传给线程',async()=>{
    vi.useFakeTimers();const f=fixture(),request=f.client.analyze('SELECT cold',0);await vi.advanceTimersByTimeAsync(450);expect(f.ports[0].postMessage).not.toHaveBeenCalled();f.reply();await expect(request).resolves.toEqual({status:'blocked',reason:'syntax'});expect(f.ports[0].postMessage).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);f.client.dispose();
  });
  it('启动超时不传SQL并释放线程，下一次明确请求才可重新建立',async()=>{
    vi.useFakeTimers();const f=fixture(),request=f.client.analyze('SELECT cold',0);await vi.advanceTimersByTimeAsync(500);await expect(request).resolves.toEqual({status:'blocked',reason:'startup-timeout'});expect(f.ports[0].postMessage).not.toHaveBeenCalled();expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);expect(f.create).toHaveBeenCalledTimes(1);const next=f.client.analyze('SELECT retry',0);f.reply(1);await next;f.client.dispose();
  });
  it('重复就绪不能延长已开始的解析期限，也不能重复发送正文',async()=>{
    vi.useFakeTimers();const f=fixture(),request=f.client.analyze('SELECT slow',0);f.ready();await vi.advanceTimersByTimeAsync(90);f.ready();await vi.advanceTimersByTimeAsync(10);await expect(request).resolves.toEqual({status:'blocked',reason:'timeout'});expect(f.ports[0].postMessage).toHaveBeenCalledTimes(1);expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);f.client.dispose();
  });
  it('错误的握手版本在发送正文前拒绝，后续迟到就绪不复活线程',async()=>{
    const f=fixture(),request=f.client.analyze('SQL private',0),old=f.ports[0].onmessage;f.ready(0,2);await expect(request).resolves.toEqual({status:'blocked',reason:'worker'});expect(f.ports[0].postMessage).not.toHaveBeenCalled();old?.({data:{type:'dbark-completion-ready',version:1}});expect(f.ports[0].postMessage).not.toHaveBeenCalled();f.client.dispose();
  });
  it('等待启动时绑定模式快照，调用方后续修改对象不改变引号解释',async()=>{
    const f=fixture(),mode={ansiQuotes:true,noBackslashEscapes:false},request=f.client.analyze('SELECT quoted',4,mode);mode.ansiQuotes=false;mode.noBackslashEscapes=true;f.ready();expect(f.ports[0].postMessage.mock.lastCall?.[0].mode).toEqual({ansiQuotes:true,noBackslashEscapes:false});f.reply();await request;f.client.dispose();
  });
  it('旧线程迟到的就绪消息不能启动新模型的待发正文',async()=>{
    const f=fixture(),first=f.client.analyze('old private',0),old=f.ports[0].onmessage,next=f.client.analyze('new private',0);await expect(first).resolves.toMatchObject({reason:'replaced'});old?.({data:{type:'dbark-completion-ready',version:1}});expect(f.ports[1].postMessage).not.toHaveBeenCalled();f.reply(1);await next;expect(f.ports[1].postMessage.mock.lastCall?.[0].source).toBe('new private');f.client.dispose();
  });
});
