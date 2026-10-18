import { createHash } from 'node:crypto';
import { open, lstat, realpath, type FileHandle } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
type Check = () => void;
export interface InsertUiFileIdentity { readonly dev: string; readonly ino: string; readonly size: number; readonly hash: string; }
export interface InsertUiFileReceipt { readonly handle: FileHandle; readonly sourcePath: string; readonly paths: readonly string[]; readonly identity: InsertUiFileIdentity; }
const releasedFiles=new WeakSet<InsertUiFileReceipt>();
/** Windows不能让测试持有的写/读句柄阻塞产品rename；只关闭原句柄，冻结身份永不更新。 */
export async function releaseInsertUiFile(receipt:InsertUiFileReceipt){if(releasedFiles.has(receipt))return;await receipt.handle.close();releasedFiles.add(receipt);}

/** 从原句柄按显式位置读取，不重新open路径；只允许本专项至多32KiB的小文件。 */
async function handleBytes(handle: FileHandle, size: number, check: Check) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 32768) throw Error('INSERT UI文件预算未知');
  const bytes=Buffer.alloc(size);let offset=0;
  while(offset<size){check();const part=await handle.read(bytes,offset,size-offset,offset);check();if(!part.bytesRead)throw Error('INSERT UI原句柄出现短读');offset+=part.bytesRead;}
  return bytes;
}
/** 原写句柄或pending原读句柄只冻结一次dev/ino；以后不能从目标路径重新签身份。 */
export async function captureInsertUiFile(path: string, handle: FileHandle, expected: Buffer, check: Check, publishPath?: string): Promise<InsertUiFileReceipt> {
  const sourcePath=resolve(path),paths=[sourcePath];
  if(publishPath){const destination=resolve(publishPath);if(dirname(destination)!==dirname(sourcePath)||!basename(sourcePath).startsWith(basename(destination)+'.dbark-')||!/\.dbark-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/.test(sourcePath))throw Error('INSERT UI发布路径未绑定原partial');paths.push(destination);}
  check();const stat=await handle.stat({bigint:true});check();
  if(!stat.isFile()||stat.nlink!==1n||Number(stat.size)!==expected.length)throw Error('INSERT UI原文件句柄类型或大小未知');
  const identity=Object.freeze({dev:String(stat.dev),ino:String(stat.ino),size:expected.length,hash:hash(expected)});
  const receipt=Object.freeze({handle,sourcePath,paths:Object.freeze(paths),identity});await verifyInsertUiFile(receipt,sourcePath,check);return receipt;
}
/** 发布核原partial回执，取消核原目标回执；同字节异inode也必须停链。 */
export async function verifyInsertUiFile(receipt: InsertUiFileReceipt, path: string, check: Check) {
  const location=resolve(path);if(!receipt.paths.includes(location))throw Error('INSERT UI拒绝未登记文件路径');
  check();const before=await lstat(location,{bigint:true});check();const canonical=await realpath(location);check();
  const same=(stat:typeof before)=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&String(stat.dev)===receipt.identity.dev&&String(stat.ino)===receipt.identity.ino&&Number(stat.size)===receipt.identity.size;
  if(canonical!==location||!same(before))throw Error('INSERT UI原文件对象身份变化');
  // 新read句柄只核已有冻结元组，不产生新的来源回执，不能把目标路径重签为原partial。
  let reader:FileHandle|undefined,first:unknown;
  try{
    reader=releasedFiles.has(receipt)?await open(location,'r'):receipt.handle;check();const handleBefore=await reader.stat({bigint:true});check();if(!same(handleBefore))throw Error('INSERT UI验证句柄不属原文件对象');
    const bytes=await handleBytes(reader,receipt.identity.size,check),after=await lstat(location,{bigint:true});check();const handleAfter=await reader.stat({bigint:true});check();const canonicalAfter=await realpath(location);check();
    if(!same(after)||!same(handleAfter)||canonicalAfter!==location||hash(bytes)!==receipt.identity.hash)throw Error('INSERT UI原文件对象或字节变化');return bytes;
  }catch(reason){first=reason;throw reason;}
  finally{if(reader&&reader!==receipt.handle)try{await reader.close();}catch(reason){throw first===undefined?reason:new AggregateError([first,reason],'INSERT UI原文件核验及验证句柄关闭均失败',{cause:first});}}
}

export interface InsertUiSocket { closed?: boolean; destroyed?: boolean; remoteAddress?: string; remotePort?: number; on(event: string, listener: (...values: any[]) => void): unknown; }
export interface InsertUiDriver<S> { stream?: S; threadId?: number; on(event: string, listener: (...values: any[]) => void): unknown; }
/** 先登记未连接Socket，再登记原driver/wrapper；任何失败留下原引用，不能再分配句柄续签。 */
export class InsertUiObserverReceipt<S extends InsertUiSocket, D extends InsertUiDriver<S>, W extends { connection: D }> {
  private originalSocket?:S;private originalDriver?:D;private originalWrapper?:W;
  get socket(){return this.originalSocket;}get driver(){return this.originalDriver;}get wrapper(){return this.originalWrapper;}
  private attempted=false; private acknowledged=false; private thread?: number; private retained=false; private normalClosed=false;private peer?:{address:string;port:number};
  constructor(private readonly retain:()=>void) {}
  private fail(reason: string): never { this.preserve();throw Error(reason); }
  preserve(){this.retained=true;try{this.retain();}catch{/* 通知失败不能解除原谱系墓碑。 */}}
  captureSocket(socket:S){if(this.socket||this.retained)this.fail('INSERT UI禁止重签Socket');this.originalSocket=socket;if(socket.remoteAddress||socket.remotePort||socket.closed||socket.destroyed)this.fail('INSERT UI原Socket必须尚未连接');socket.on('error',()=>this.preserve());}
  captureDriver(driver:D){if(this.driver||!this.socket||this.retained)this.fail('INSERT UI禁止重签driver');this.originalDriver=driver;if(driver.stream!==this.socket)this.fail('INSERT UI driver未使用原Socket');driver.on('error',()=>this.preserve());}
  captureWrapper(wrapper:W){if(this.wrapper||!this.driver||this.retained)this.fail('INSERT UI禁止重签wrapper');this.originalWrapper=wrapper;if(wrapper.connection!==this.driver)this.fail('INSERT UI wrapper未绑定原driver');}
  start(){this.assertCurrent();if(this.attempted||!this.socket||!this.driver||!this.wrapper)this.fail('INSERT UI连接回执未齐备');this.attempted=true;}
  connected(){this.assertCurrent();const thread=this.driver?.threadId;if(!this.attempted||this.acknowledged||!Number.isSafeInteger(thread)||!thread||thread<1||this.socket?.remotePort!==13384||!['192.168.31.200','::ffff:192.168.31.200'].includes(this.socket?.remoteAddress??''))this.fail('INSERT UI连接ACK身份未知');this.thread=thread;this.peer={address:this.socket!.remoteAddress!,port:13384};this.acknowledged=true;}
  assertCurrent(){if(this.retained||this.driver&&this.driver.stream!==this.socket||this.wrapper&&this.wrapper.connection!==this.driver||this.acknowledged&&this.driver?.threadId!==this.thread||this.socket?.closed&&!this.normalClosed||this.socket?.destroyed&&!this.normalClosed)this.fail('INSERT UI原观察谱系失效');if(this.acknowledged&&!this.normalClosed&&(this.socket?.remotePort!==13384||!['192.168.31.200','::ffff:192.168.31.200'].includes(this.socket?.remoteAddress??'')))this.fail('INSERT UI原观察peer变化');}
  assertConnected(){this.assertCurrent();if(!this.acknowledged||this.normalClosed)this.fail('INSERT UI没有原连接授权');}
  confirmClosed(){if(this.retained||!this.acknowledged||!this.socket?.closed||this.driver?.stream!==this.socket||this.wrapper?.connection!==this.driver||this.driver?.threadId!==this.thread)this.fail('INSERT UI原观察流正常close未知');this.normalClosed=true;}
  summary(){return{socketCaptured:!!this.socket,driverCaptured:!!this.driver,wrapperCaptured:!!this.wrapper,connectAttempted:this.attempted,acknowledged:this.acknowledged,frozenThread:this.thread,observedThread:this.driver?.threadId,peer:this.peer,streamSame:!!this.socket&&this.driver?.stream===this.socket,streamClosed:this.socket?.closed===true,streamDestroyed:this.socket?.destroyed===true,normalClosed:this.normalClosed,retained:this.retained};}
}

/** 构造失败也保留已登记Socket；原连接回调与Socket.connect都在三份回执齐备之后。 */
export async function connectInsertUiObserver<S extends InsertUiSocket,D extends InsertUiDriver<S>,W extends {connection:D}>(receipt:InsertUiObserverReceipt<S,D,W>,ports:{allocate():S;construct(socket:S):D;wrap(driver:D):W;register(driver:D,callback:(error?:unknown)=>void):void;connect(socket:S):void},check:Check){
  try{
    check();receipt.captureSocket(ports.allocate());check();receipt.captureDriver(ports.construct(receipt.socket!));check();receipt.captureWrapper(ports.wrap(receipt.driver!));check();receipt.start();
    await new Promise<void>((yes,no)=>{
      try{ports.register(receipt.driver!,error=>{try{if(error)throw error;check();receipt.connected();yes();}catch(reason){receipt.preserve();no(reason);}});check();ports.connect(receipt.socket!);}
      catch(reason){receipt.preserve();no(reason);}
    });check();receipt.assertConnected();return receipt.wrapper!;
  }catch(reason){receipt.preserve();throw reason;}
}

/** 首次写入前冻结随机库、nonce、用例摘要和完整表名集合，后续不能改名认领。 */
export function insertUiOwnershipPlan(scenario:number,nonce:string,caseHash:string){
  if(![0,1].includes(scenario)||!/^[a-f0-9]{32}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(caseHash))throw Error('INSERT UI资源计划身份无效');
  return Object.freeze({version:1,scenario,nonce,caseHash,database:'dbark_e2e_insert_'+nonce,tables:Object.freeze(['__insert_owner','insert_neighbor','insert_source','insert_target']),comment:'insert-ui:'+nonce});
}
export type InsertUiPlan=ReturnType<typeof insertUiOwnershipPlan>;
export const insertUiPreciseSource=[{id:1,note:null,big_value:'18446744073709551615',amount:'12345678901234567890.120000',doc:'9007199254740993',payload:'00FF'},{id:2,note:'',big_value:'9007199254740993',amount:'0.000001',doc:'null',payload:''}];
/** 当前UI2独立手写大整数JSON预期；旧abc黄金函数保留给原准备回归，绝不改写旧反例。 */
export function expectedPreciseInsertUiFile(database:string){
  if(!/^dbark_e2e_insert_[a-f0-9]{32}$/.test(database))throw Error('INSERT UI精确文件库名未知');
  const prefix='INSERT INTO `'+database+'`.`insert_target` (`note`, `big_value`, `amount`, `doc`, `payload`) VALUES ';
  return '-- 本次新执行的完整行结果；仅生成INSERT文件，不向目标表执行INSERT。\n'+prefix+"(NULL, _utf8mb4 X'3138343436373434303733373039353531363135', _utf8mb4 X'31323334353637383930313233343536373839302e313230303030', _utf8mb4 X'39303037313939323534373430393933', X'00ff');\n"+prefix+"(_utf8mb4 X'', _utf8mb4 X'39303037313939323534373430393933', _utf8mb4 X'302e303030303031', _utf8mb4 X'6e756c6c', X'');\n";
}

/** DROP前只认可原创建ACK、准确服务器、标记、完整集合及原数据，缺项/未知对象均拒绝。 */
export function assertInsertUiSchema(plan:InsertUiPlan,ack:boolean,proof:{server:unknown;marker:unknown;tables:unknown;source:unknown;target:unknown;neighbor:unknown;unknown:unknown;definitions:unknown},definitions:Readonly<Record<string,string>>){
  assert.equal(ack,true,'INSERT UI缺少原CREATE ACK');
  assert.deepEqual(proof.server,[{uuid:'f568f70e-c730-11f1-8190-3e6c830dde01',version:'8.4.11',os:'Linux',names:'0'}]);
  assert.deepEqual(proof.marker,[{nonce:plan.nonce,case_hash:plan.caseHash,scenario:plan.scenario}]);
  assert.deepEqual(proof.tables,plan.tables.map(name=>({name,kind:'BASE TABLE',comment:plan.comment})));
  assert.deepEqual(proof.source,insertUiPreciseSource);assert.deepEqual(proof.target,[{n:'0'}]);assert.deepEqual(proof.neighbor,[{id:7,nonce:plan.nonce}]);assert.deepEqual(proof.unknown,{triggers:[],routines:[],events:[]});
  assert.deepEqual(Object.keys(definitions).sort(),[...plan.tables]);assert.deepEqual(proof.definitions,definitions);
}

/** 日记持有最初wx+句柄，逐条核原inode与大小并fsync；只记录元数据，最多32KiB/48条。 */
export class InsertUiOwnershipJournal {
  handle?:FileHandle;private id='';private bytes=0;private count=0;
  constructor(readonly path:string,private readonly check:Check){}
  private async current(){this.check();if(!this.handle)throw Error('INSERT UI原日记句柄缺失');const own=await this.handle.stat({bigint:true});this.check();const entry=await lstat(this.path,{bigint:true});this.check();if(!own.isFile()||!entry.isFile()||entry.isSymbolicLink()||own.nlink!==1n||entry.nlink!==1n||String(own.dev)+':'+String(own.ino)!==this.id||own.dev!==entry.dev||own.ino!==entry.ino||Number(own.size)!==this.bytes||Number(entry.size)!==this.bytes||await realpath(this.path)!==resolve(this.path))throw Error('INSERT UI原日记身份变化');this.check();}
  async start(plan:InsertUiPlan){this.check();if(this.handle)throw Error('INSERT UI日记不能重签');this.handle=await open(this.path,'wx+');this.check();const stat=await this.handle.stat({bigint:true});this.check();this.id=String(stat.dev)+':'+String(stat.ino);await this.append('planned',plan);}
  async append(stage:string,metadata:object={}){await this.current();const value=Buffer.from(JSON.stringify({seq:this.count+1,stage,...metadata})+'\n');if(this.count>=48||this.bytes+value.length>32768)throw Error('INSERT UI日记超限');await this.handle!.writeFile(value);this.check();await this.handle!.sync();this.check();this.bytes+=value.length;this.count++;await this.current();}
  async snapshot(){await this.current();return handleBytes(this.handle!,this.bytes,this.check);}
  summary(){return{path:this.path,identity:this.id,bytes:this.bytes,records:this.count,handleCaptured:!!this.handle};}
}
