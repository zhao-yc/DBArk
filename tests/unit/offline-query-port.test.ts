import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source=readFileSync(new URL('../../scripts/check-offline-query-port.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('probe.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const method=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='requireOfflineQueryPort')!;
const cli=tree.statements.find(ts.isIfStatement)!;
const compile=(text:string)=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
beforeEach(()=>vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setImmediate','clearImmediate']}));
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()});

/** 原生产函数逐字抽取，唯一Socket构造器为RAM端口；从未导入node:net或发起真实连接。 */
function fixture(syncThrow=false){
  const socket=Object.assign(new EventEmitter(),{destroyed:false,connect:vi.fn(),destroy:vi.fn()});
  socket.destroy.mockImplementation(()=>{socket.destroyed=true;return socket});
  socket.connect.mockImplementation(options=>{
    for(const name of ['connect','error','close'])expect(socket.listenerCount(name),'connect前应登记原socket事件：'+name).toBe(1);
    expect(options).toEqual({host:'127.0.0.1',port:1,family:4});if(syncThrow)throw Error('RAM同步异常');return socket;
  });
  const Socket=vi.fn(function(){return socket});
  const pending=runInNewContext(compile(method.getText(tree))+'\nrequireOfflineQueryPort();',{Socket,setTimeout,clearTimeout,setImmediate,clearImmediate}) as Promise<void>;
  let state='等待中',message='';const result=Promise.resolve(pending).then(()=>{state='通过'},error=>{state='失败';message=error.message});
  return {socket,Socket,result,state:()=>state,message:()=>message};
}
const error=(code?:string)=>Object.assign(Error('不应原样输出的RAM错误'),code?{code}:{});

describe('固定离线查询端口的原socket事件证明',()=>{
  it('监听先于唯一固定connect；拒连本身不提前通过，原close后确认且释放计时器',async()=>{
    const f=fixture();expect(f.Socket).toHaveBeenCalledTimes(1);expect(f.socket.connect).toHaveBeenCalledTimes(1);
    f.socket.emit('error',error('ECONNREFUSED'));await vi.advanceTimersByTimeAsync(0);expect(f.state()).toBe('等待中');expect(f.socket.destroy).not.toHaveBeenCalled();
    f.socket.emit('close',true);expect(f.state()).toBe('等待中');await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('通过');expect(vi.getTimerCount()).toBe(0);
  });
  it('别的socket拒连/close不能代替原socket证明',async()=>{
    const f=fixture(),foreign=new EventEmitter();foreign.on('error',()=>{});foreign.emit('error',error('ECONNREFUSED'));foreign.emit('close');
    await vi.advanceTimersByTimeAsync(0);expect(f.state()).toBe('等待中');f.socket.emit('error',error('ECONNREFUSED'));f.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('通过');
  });
  it('ECONNREFUSED但没有原close，截止时间一直保留，3000毫秒明确失败且无重试',async()=>{
    const f=fixture();f.socket.emit('error',error('ECONNREFUSED'));expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(2999);expect(f.state()).toBe('等待中');
    await vi.advanceTimersByTimeAsync(1);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('未收到原socket close');expect(f.socket.connect).toHaveBeenCalledTimes(1);expect(f.socket.destroy).toHaveBeenCalledTimes(1);
    expect(()=>{f.socket.emit('error',error('ECONNREFUSED'));f.socket.emit('close')}).not.toThrow();expect(f.state()).toBe('失败');
  });
  it('无任何终态也在保持引用的截止时间失败，不会静默放行',async()=>{
    const f=fixture();expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(3000);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('未取得');expect(f.socket.destroy).toHaveBeenCalledTimes(1);
  });
  it('connect成功即失败，之后拒连close也不能翻成通过',async()=>{
    const f=fixture();f.socket.emit('connect');f.socket.emit('error',error('ECONNREFUSED'));f.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('存在监听');
  });
  it.each(['EACCES','ECONNRESET','ETIMEDOUT',undefined])('其它错误%s及其close一律失败',async code=>{
    const f=fixture();f.socket.emit('error',error(code));f.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('其它错误');expect(f.message()).not.toContain('不应原样输出');
  });
  it('原close没有前置error，迟到的拒连不能补造顺序',async()=>{
    const f=fixture();f.socket.emit('close');f.socket.emit('error',error('ECONNREFUSED'));await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('close前未收到');
  });
  it('拒连后关闭前的晚error不能遗漏',async()=>{
    const f=fixture();f.socket.emit('error',error('ECONNREFUSED'));f.socket.emit('error',error('ECONNRESET'));f.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('ECONNRESET');
  });
  it('拒连后的晚error且仍未close，不伪造关闭证明，到界仍保留首个失败',async()=>{
    const f=fixture();f.socket.emit('error',error('ECONNREFUSED'));await vi.advanceTimersByTimeAsync(2999);f.socket.emit('error',error('ECONNRESET'));expect(f.state()).toBe('等待中');
    await vi.advanceTimersByTimeAsync(1);await f.result;expect(f.state()).toBe('失败');expect(f.message()).toContain('ECONNRESET');expect(f.socket.connect).toHaveBeenCalledTimes(1);
  });
  it.each(['error','connect'] as const)('close之后确认之前的迟到%s也必须失败',async kind=>{
    const f=fixture();f.socket.emit('error',error('ECONNREFUSED'));f.socket.emit('close');if(kind==='error')f.socket.emit('error',error('ECONNRESET'));else f.socket.emit('connect');
    await vi.advanceTimersByTimeAsync(0);await f.result;expect(f.state()).toBe('失败');expect(()=>f.socket.emit('error',error('ECONNRESET'))).not.toThrow();expect(f.state()).toBe('失败');
  });
  it('socket超时及同步connect异常不可能通过',async()=>{
    const timeout=fixture();timeout.socket.emit('timeout');timeout.socket.emit('error',error('ECONNREFUSED'));timeout.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await timeout.result;expect(timeout.state()).toBe('失败');expect(timeout.message()).toContain('超时');
    const thrown=fixture(true);thrown.socket.emit('close');await vi.advanceTimersByTimeAsync(0);await thrown.result;expect(thrown.state()).toBe('失败');expect(thrown.message()).toContain('同步失败');
  });
  it.each([['--host','其它地址'],['--port','2'],['--help'],['任意参数']])('CLI拒绝参数%j且不创建预检连接',async(...args)=>{
    const invoke=vi.fn(),console={log:vi.fn(),error:vi.fn()},process={argv:['node','固定脚本',...args],exitCode:0};
    await runInNewContext('(async()=>{'+compile(cli.getText(tree))+'})()',{requireOfflineQueryPort:invoke,console,process});
    expect(invoke).not.toHaveBeenCalled();expect(process.exitCode).toBe(1);expect(console.error).toHaveBeenCalledWith(expect.stringContaining('不接受任何命令行参数'));
  });
});
