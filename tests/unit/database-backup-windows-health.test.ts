import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DatabaseBackupWindowsFiles, DatabaseBackupWindowsFilesOwners, databaseBackupWindowsFilesLaunch, databaseBackupWindowsFilesSource } from '../../src/engine/databaseBackupWindowsFiles';
import { DatabaseBackupSecretFile, DatabaseBackupSecretFileOwners } from '../../src/engine/databaseBackupSecretFile';

const sid='S-1-5-21-100-200-300-1001';
// 所有句柄、进程、协议帧均在RAM中，不运行原生helper。
class Peer extends EventEmitter {
  stdout=new PassThrough({autoDestroy:false}); stderr=new PassThrough({autoDestroy:false});
  stdin:Writable; calls:number[]=[]; guards=0; writers=0; nonce=''; poisonClose=false; truncatedClose=false; aclExtra=false;
  constructor(){super();this.stdin=new Writable({autoDestroy:false,write:(frame:Buffer,_enc,done)=>{
    const n=frame.readUInt32LE(9),m=JSON.parse(frame.subarray(13,13+n).toString()),op=frame[8],seq=frame.readUInt32LE(4);this.nonce=m.owner;this.calls.push(op);let result:any={};
    switch(op){
      case 1:this.guards=3;this.writers=1;result={id:1,stamp:this.stamp(1)};break;
      case 2:result=this.stamp(m.id);break;
      case 3:this.guards++;this.writers++;result={id:2,stamp:this.stamp(2)};break;
      case 4:this.guards++;this.writers++;result={id:3,stamp:this.stamp(3)};break;
      case 5:case 6:result=this.acl(m.id);break;
      case 7:result={written:frame.length-13-n};break;
      case 8:result={synced:true};break;
      case 9:this.writers--;if(m.id===1)this.guards-=3;result={workClosed:true,guardHeld:m.id!==1};break;
      case 10:result={granted:true};break;
      case 11:case 12:this.guards--;result={identity:String(m.id).repeat(48),removed:true};break;
      case 14:result={shutdown:true};break;
      default:throw Error('测试夹具不接受此操作');
    }
    const reply=this.frame({seq,owner:m.owner,ok:true,result,counts:{guards:this.guards,writers:this.writers,failed:false}});
    if(op===9&&m.id===3&&this.poisonClose){const bad=Buffer.alloc(4);bad.writeUInt32LE(16385);this.stdout.write(Buffer.concat([reply,bad]));}
    else if(op===9&&m.id===3&&this.truncatedClose){this.stdout.write(Buffer.concat([reply,Buffer.from([0x20])]));this.stdout.end();}
    else this.stdout.write(reply);
    done();
  }});}
  stamp(id:number){return {identity:String(id).repeat(48),entryIdentity:String(id).repeat(48),kind:id===3?'file':'directory',unsafeLink:false};}
  acl(id:number){const aces=[sid,'S-1-5-18'].map(s=>({sid:s,allow:true,inherited:false,fullControl:true,containerInherit:id!==3,objectInherit:id!==3}));if(this.aclExtra)aces.push({...aces[0],sid:'S-1-1-0',allow:false});return {identity:String(id).repeat(48),ownerSid:sid,inheritanceDisabled:true,aces};}
  frame(value:unknown){const b=Buffer.from(JSON.stringify(value)),f=Buffer.alloc(b.length+4);f.writeUInt32LE(b.length);b.copy(f,4);return f;}
  dispose(){this.stdin.destroy();this.stdout.destroy();this.stderr.destroy();this.emit('close',0,null);}
}
function make(){const owner={taskId:'independent',planToken:'fixed'},peer=new Peer(),config={parentDirectory:'D:\\Private',directoryName:'ram-review',currentUserSid:sid,systemRoot:'C:\\Windows',sourcePath:'D:\\Fixed\\databaseBackupWindowsFiles.helper.cs',timeoutMs:50,startupTimeoutMs:50};let permits=0;
 const bridge=new DatabaseBackupWindowsFiles(owner,config,{spawn:(_r,c)=>{c(peer);return peer;},checkCancelled(){},cleanupPermit:async()=>{permits++;return {owner,originalOperationLeft:true,nativeClosed:true,streamsClosed:true};}},new DatabaseBackupWindowsFilesOwners());
 const secret=new DatabaseBackupSecretFile(owner,{platform:'win32',parentDirectory:config.parentDirectory,directoryName:config.directoryName,currentUserSid:sid},bridge.ports(),new DatabaseBackupSecretFileOwners());
 let takes=0;const source={takeText(){takes++;return '[client]\npassword="SYNTHETIC-E5"\n';}};bridge.start();return {owner,peer,config,bridge,secret,source,takes:()=>takes,permits:()=>permits};}

describe('员工5固定06a7c26协议反例专项',()=>{
 it('关闭成功回执后同一chunk协议错误不得使SecretFile进入ready',async()=>{
   const f=make();f.peer.poisonClose=true;try{let rejected=false;try{await f.secret.open(f.source);}catch{rejected=true;}
   expect(f.bridge.snapshot().unknown).toBe(true);expect(rejected).toBe(true);expect(f.secret.snapshot().ready).toBe(false);
   }finally{f.peer.dispose();}
 });
 it('关闭回执后截断额外帧并EOF必须使打开失败',async()=>{
   const f=make();f.peer.truncatedClose=true;try{let rejected=false;try{await f.secret.open(f.source);}catch{rejected=true;}
   await new Promise(r=>setImmediate(r));expect(rejected).toBe(true);expect(f.bridge.snapshot().unknown).toBe(true);
   }finally{f.peer.dispose();}
 });
 it('已ready后原helper错误必须阻断再次取得client路径',async()=>{
   const f=make();try{await f.secret.open(f.source);f.peer.emit('error',Error('合成原生错误'));
   expect(f.bridge.snapshot().unknown).toBe(true);expect(()=>f.secret.privateClientPath()).toThrow();
   }finally{f.peer.dispose();}
 });
 it('额外deny ACE整体拒绝且尚未消费秘密、申请清理或写payload',async()=>{
   const f=make();f.peer.aclExtra=true;try{await expect(f.secret.open(f.source)).rejects.toThrow();expect(f.takes()).toBe(0);expect(f.permits()).toBe(0);expect(f.peer.calls.some(x=>[7,10,11,12].includes(x))).toBe(false);}finally{f.peer.dispose();}
 });
 it('固定资源原字节摘要及启动参数边界保守有效',()=>{
   const f=make();try{const b=readFileSync(new URL('../../src/engine/databaseBackupWindowsFiles.helper.cs',import.meta.url));expect(createHash('sha256').update(b).digest('hex')).toBe(databaseBackupWindowsFilesSource.sha256);
   const launch=databaseBackupWindowsFilesLaunch(f.config);expect(launch.commandLineCharacters).toBeLessThanOrEqual(32767);expect(JSON.stringify(launch)).not.toContain('SYNTHETIC-E5');
   for(const change of [{parentDirectory:'D:\\Private\\..\\Foreign'},{parentDirectory:'\\\\server\\share'},{directoryName:'../other'},{sourcePath:'D:\\Fixed\\wrong.cs'},{currentUserSid:'S-1-5-18'}])expect(()=>databaseBackupWindowsFilesLaunch({...f.config,...change})).toThrow();
   }finally{f.peer.dispose();}
 });
});

// 独审RAM夹具补齐生产child的类型契约；意外调用kill直接使测试失败，保持前6388原字节不变。
interface Peer { kill(signal: 'SIGTERM'): boolean; }
Peer.prototype.kill = () => { throw Error('RAM协议专项禁止kill或自动清理'); };

/** 在原peer回执处理之后注入故障，覆盖response先resolve、await仍未返回的窗口。 */
function failAfterReply(f: ReturnType<typeof make>, opcode: number) {
  let fired = false;
  f.peer.stdout.on('data', () => {
    if (!fired && f.peer.calls.at(-1) === opcode) { fired = true; f.peer.emit('error', Error('合成迟到错误')); }
  });
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

describe('员工4健康门与原事件保留专项', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('关键操作%d的回执后失效不得继续open或自动清理', async opcode => {
    const f = make(); failAfterReply(f, opcode);
    try {
      await expect(f.secret.open(f.source)).rejects.toThrow();
      expect(f.bridge.snapshot().unknown).toBe(true); expect(f.secret.snapshot().ready).toBe(false);
      expect(() => f.secret.privateClientPath()).toThrow();
      expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.permits()).toBe(0);
      expect(f.peer.calls.at(-1)).toBe(opcode); expect(f.peer.calls.some(op => [10, 11, 12, 14].includes(op))).toBe(false);
    } finally { f.peer.dispose(); }
  });

  it.each(['error', 'exit', 'close', 'stdin-close', 'stdout-end', 'stdout-close', 'stderr-end', 'stderr-close', 'stderr-error'] as const)('已ready后%s立即撤销快照ready，拒绝路径和清理回执', async event => {
    const f = make();
    try {
      await f.secret.open(f.source); expect(f.secret.snapshot().ready).toBe(true); const calls = f.peer.calls.length;
      switch (event) {
        case 'error': f.peer.emit('error', Error('合成原生错误')); break;
        case 'exit': f.peer.emit('exit', 0, null); break;
        case 'close': f.peer.emit('close', 0, null); break;
        case 'stdin-close': f.peer.stdin.emit('close'); break;
        case 'stdout-end': f.peer.stdout.end(); await turn(); break;
        case 'stdout-close': f.peer.stdout.emit('close'); break;
        case 'stderr-end': f.peer.stderr.end(); await turn(); break;
        case 'stderr-close': f.peer.stderr.emit('close'); break;
        case 'stderr-error': f.peer.stderr.emit('error', Error('合成流错误')); break;
      }
      expect(f.bridge.snapshot().unknown).toBe(true); expect(f.secret.snapshot()).toMatchObject({ ready: false, failed: true });
      expect(() => f.secret.privateClientPath()).toThrow(); expect((await f.secret.cleanup()).state).toBe('unknown');
      expect(f.peer.calls).toHaveLength(calls); expect(f.permits()).toBe(0);
      f.peer.dispose(); await turn();
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, childClosed: true, stdinClosed: true, stdoutClosed: true, stderrClosed: true, guards: 5, helperLocalClosed: false });
      expect((await f.bridge.shutdown(0)).state).toBe('unknown');
    } finally { f.peer.dispose(); }
  });

  it('原write回调挂起时错误立即拒绝open，原frame和pending保留到原回调/实际close', async () => {
    const f = make(); const write = f.peer.stdin._write.bind(f.peer.stdin); let release: (() => void) | undefined, wire: Buffer | undefined;
    f.peer.stdin._write = (chunk: Buffer, encoding, done) => {
      if (chunk[8] !== 7) { write(chunk, encoding, done); return; }
      wire = chunk; write(chunk, encoding, () => { release = done; }); f.peer.emit('error', Error('合成原write在途错误'));
    };
    try {
      await expect(f.secret.open(f.source)).rejects.toThrow();
      expect(release).toBeTypeOf('function'); expect(wire!.some(byte => byte !== 0)).toBe(true);
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, pending: true, wireFrames: 1, registeredSlots: 3, guards: 5 });
      expect(f.secret.snapshot()).toMatchObject({ ready: false, fileAllocated: true, fileRemoved: false });
      expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.permits()).toBe(0);
      release!(); await turn(); expect(wire!.every(byte => byte === 0)).toBe(true);
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, pending: false, wireFrames: 0, registeredSlots: 3, guards: 5 });
      expect(f.peer.calls.some(op => [10, 11, 12].includes(op))).toBe(false);
    } finally { f.peer.dispose(); }
  });

  it('曾成功的close缓存、ACL及其余原facade不能在unknown后返回成功或分配新槽位', async () => {
    const f = make(), ports = f.bridge.ports();
    try {
      const parent = await ports.openParent(f.owner, f.config.parentDirectory);
      const directory = await parent.createDirectory(f.config.directoryName, 0o700);
      const file = await directory.openFile('client.cnf', { flags: 'wx', mode: 0o600 }); await file.close();
      f.peer.emit('error', Error('合成原close后错误')); const calls = f.peer.calls.length;
      await expect(file.close()).rejects.toThrow(); await expect(file.inspect()).rejects.toThrow();
      await expect(file.write(Buffer.from('合成'), 0, 1, 0)).rejects.toThrow(); await expect(file.sync()).rejects.toThrow();
      await expect(directory.inspect()).rejects.toThrow(); await expect(directory.inspectFile('client.cnf')).rejects.toThrow();
      await expect(directory.openFile('client.cnf', { flags: 'wx', mode: 0o600 })).rejects.toThrow();
      await expect(parent.createDirectory(f.config.directoryName, 0o700)).rejects.toThrow();
      await expect(ports.windows!.readDirectory(f.owner, parent)).rejects.toThrow();
      await expect(ports.windows!.protectDirectory(f.owner, directory)).rejects.toThrow();
      await expect(ports.windows!.protectFile(f.owner, file)).rejects.toThrow(); await expect(ports.cleanupPermit(f.owner)).rejects.toThrow();
      expect(f.peer.calls).toHaveLength(calls); expect(f.permits()).toBe(0); expect(f.bridge.snapshot().registeredSlots).toBe(3);
    } finally { f.peer.dispose(); }
  });

  it('清理许可回执或最终parent.close回执后失效不能返回confirmed或重试删除', async () => {
    for (const at of ['permit', 'parent-close']) {
      const f = make();
      try {
        await f.secret.open(f.source);
        f.peer.stdout.on('data', (bytes: Buffer) => {
          const parentClose = f.peer.calls.at(-1) === 9 && JSON.parse(bytes.subarray(4).toString()).result.guardHeld === false;
          if (at === 'permit' ? f.peer.calls.at(-1) === 10 : parentClose) f.peer.emit('error', Error('合成清理回执后错误'));
        });
        expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.secret.snapshot().closed).toBe(false);
        expect(f.bridge.snapshot().unknown).toBe(true); const calls = f.peer.calls.length;
        expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.peer.calls).toHaveLength(calls);
        if (at === 'permit') expect(f.peer.calls.some(op => [11, 12].includes(op))).toBe(false);
      } finally { f.peer.dispose(); }
    }
  });

  it('成功清理后迟到错误也使缓存confirmed及快照closed失效', async () => {
    const f = make();
    try {
      await f.secret.open(f.source); expect((await f.secret.cleanup()).state).toBe('confirmed');
      f.peer.emit('error', Error('合成迟到错误')); expect(f.secret.snapshot().closed).toBe(false);
      expect((await f.secret.cleanup()).state).toBe('unknown');
    } finally { f.peer.dispose(); }
  });

  it('取得缓存清理Promise后、await消费前的失效仍返回unknown，且不重新执行清理', async () => {
    const f = make();
    try {
      await f.secret.open(f.source); expect((await f.secret.cleanup()).state).toBe('confirmed');
      const calls = f.peer.calls.length, cached = f.secret.cleanup();
      f.peer.emit('error', Error('合成缓存交付前错误'));
      expect((await cached).state).toBe('unknown'); expect(f.peer.calls).toHaveLength(calls); expect(f.permits()).toBe(1);
      expect(f.secret.snapshot()).toMatchObject({ closed: false, portUnknown: true });
    } finally { f.peer.dispose(); }
  });

  it('正常shutdown回执后EOF/exit早于await返回可以接受，但仍等原child和三流close', async () => {
    const f = make();
    try {
      await f.secret.open(f.source); expect((await f.secret.cleanup()).state).toBe('confirmed');
      f.peer.stdout.on('data', () => { if (f.peer.calls.at(-1) === 14) { f.peer.stdout.end(); f.peer.stderr.end(); f.peer.emit('exit', 0, null); } });
      expect((await f.bridge.shutdown(0)).state).toBe('unknown'); await turn();
      expect(f.bridge.snapshot()).toMatchObject({ unknown: false, exitSeen: true, stdoutEnded: true, stderrEnded: true, childClosed: false });
      f.peer.dispose(); await turn(); expect((await f.bridge.shutdown(0)).state).toBe('confirmed');
      expect(f.peer.calls.filter(op => op === 14)).toHaveLength(1);
    } finally { f.peer.dispose(); }
  });

  it('shutdown成功回执附残帧并EOF时即使原三流全关闭也永久unknown', async () => {
    const f = make(); let fired = false;
    try {
      await f.secret.open(f.source); await f.secret.cleanup();
      f.peer.stdout.on('data', () => { if (!fired && f.peer.calls.at(-1) === 14) { fired = true; f.peer.stdout.write(Buffer.from([0x20])); f.peer.stdout.end(); } });
      expect((await f.bridge.shutdown(0)).state).toBe('unknown'); f.peer.dispose(); await turn();
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, childClosed: true, stdinClosed: true, stdoutClosed: true, stderrClosed: true, helperLocalClosed: false });
      expect((await f.bridge.shutdown(0)).state).toBe('unknown');
    } finally { f.peer.dispose(); }
  });

  it('原响应体截断EOF保持未完成RPC与句柄账本，原close不会补出成功响应', async () => {
    const f = make(), frame = f.peer.frame.bind(f.peer); let fired = false;
    f.peer.frame = value => f.peer.calls.at(-1) === 9 ? frame(value).subarray(0, 8) : frame(value);
    f.peer.stdout.on('data', () => { if (!fired && f.peer.calls.at(-1) === 9) { fired = true; f.peer.stdout.end(); } });
    try {
      await expect(f.secret.open(f.source)).rejects.toThrow();
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, pending: true, guards: 5, registeredSlots: 3 });
      expect(f.secret.snapshot()).toMatchObject({ ready: false, portUnknown: true, fileRemoved: false });
      f.peer.dispose(); await turn();
      expect(f.bridge.snapshot()).toMatchObject({ unknown: true, pending: true, guards: 5, childClosed: true, stdoutClosed: true });
      expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.permits()).toBe(0);
    } finally { f.peer.dispose(); }
  });
});
