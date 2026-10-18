import { BatchFillPreparation } from './tableBatchFillLive';

type Environment = Record<string, string | undefined>;
export const queryInsertUiCases = ['完整INSERT真实界面：一次新执行、精确样例及准确目标确认后发布原文件', '完整INSERT真实界面：等待确认时取消，原目标保持且原会话继续无重放'] as const;
// 沿Root已验后台专项的固定200服务器身份；不是任意合法UUID均可授权运行。
export const queryInsertUiUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
const keys = ['DBARK_INTEGRATION_ENABLED','DBARK_QUERY_INSERT_UI','DBARK_QUERY_INSERT_SERVER_VERIFIED','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_TLS','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_TEST_SSH'] as const;
/** 本专项只认本轮显式自有字符串，不读取.env，也不执行凭据访问器。 */
export function bindQueryInsertUiTarget(read: () => Environment, readArgs:()=>readonly string[]=()=>[]) {
  const argumentsSignature=()=>{const args=readArgs();for(const [index,value]of args.entries())if(value==='--config'||value==='-c'||value.startsWith('--config=')||/^-c./.test(value)||['--ui','--debug','--video','--screenshot'].includes(value.split('=')[0])||value==='--trace'&&args[index+1]!=='off'||value.startsWith('--trace=')&&value!=='--trace=off')throw Error('完整INSERT专项拒绝配置、交互或录制覆盖');return JSON.stringify(args);};
  const fixedArguments=argumentsSignature();
  const snapshot = () => {
    const env=read();
    for(const key of Object.keys(env)) {
      if(/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)&&key!==key.toUpperCase())throw Error('完整INSERT专项拒绝环境大小写别名');
      if(['DBARK_DEV_URL','DBARK_USER_DATA','DBARK_EXECUTABLE_PATH','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'].includes(key)||/^DBARK_TEST_/.test(key)&&!keys.includes(key as typeof keys[number]))throw Error('完整INSERT专项拒绝外部入口、预加载及非本例目标参数');
    }
    return keys.map(key=>{const property=Object.getOwnPropertyDescriptor(env,key);if(property&&(!Object.hasOwn(property,'value')||typeof property.value!=='string'))throw Error('完整INSERT专项参数必须为显式自有字符串');return {key,present:!!property,value:property?.value as string|undefined};});
  };
  const fixed=snapshot(),value=(key:typeof keys[number])=>fixed.find(item=>item.key===key)!.value;
  if(value('DBARK_INTEGRATION_ENABLED')!=='1'||value('DBARK_QUERY_INSERT_UI')!=='1'||value('DBARK_QUERY_INSERT_SERVER_VERIFIED')!=='1'||value('DBARK_TEST_HOST')!=='192.168.31.200'||value('DBARK_TEST_PORT')!=='13384'||value('DBARK_TEST_TLS')!=='0'||!value('DBARK_TEST_USER')||!fixed.find(item=>item.key==='DBARK_TEST_PASSWORD')!.present||value('DBARK_TEST_EXPECTED_SERVER_UUID')!==queryInsertUiUuid||![undefined,'0'].includes(value('DBARK_TEST_SSH')))throw Error('完整INSERT专项仅允许本轮已核200/13384、准确UUID及随机隔离库源模式');
  let invalid=false;
  return {target:Object.freeze({host:value('DBARK_TEST_HOST')!,port:13384,user:value('DBARK_TEST_USER')!,password:value('DBARK_TEST_PASSWORD')!,uuid:value('DBARK_TEST_EXPECTED_SERVER_UUID')!}),assertCurrent(){try{if(invalid||argumentsSignature()!==fixedArguments||JSON.stringify(snapshot())!==JSON.stringify(fixed))throw Error('漂移');}catch{invalid=true;throw Error('完整INSERT专项目标已失效，保留现场');}}};
}
export type QueryInsertUiTarget = ReturnType<typeof bindQueryInsertUiTarget>;
interface Clock { _startWallTime?: number; timeout: number; status?: string; }
interface Owner { assertCurrent(allowClosed: boolean): void; retain(): void; }
/** 复用批量填充原120秒起点；原TestInfo、目标和app/page归属跨每次await，失败永不复活。 */
export class QueryInsertUiScope {
  private readonly preparation: BatchFillPreparation;
  private retained=false;private ended=false;private pending=false;private finished=false;
  constructor(private readonly info:Clock,private readonly currentInfo:()=>Clock,private readonly binding:Pick<QueryInsertUiTarget,'assertCurrent'>,private readonly owner:Owner,now=()=>Date.now()){this.preparation=new BatchFillPreparation(info,now);}
  /** 保留先在本地落定，通知异常不能解除停链。 */
  preserve(){this.retained=true;try{this.owner.retain();}catch{/* 保留通知失败也不能恢复授权。 */}}
  /** 已确认退出后的收尾仍核同一TestInfo、原期限及原owner。 */
  assertCurrent(allowClosed=false){try{this.preparation.assertCurrent();this.binding.assertCurrent();if(this.retained||this.ended||this.currentInfo()!==this.info)throw Error('原用例失效');this.owner.assertCurrent(allowClosed);}catch(reason){this.preserve();throw reason;}}
  /** 不允许并行动作借原scope继续；迟到结果只能保留，不能进入下一写入。 */
  async step<T>(action:()=>Promise<T>,allowClosed=false):Promise<T>{this.assertCurrent(allowClosed);if(this.pending){this.preserve();throw Error('原动作尚未结束');}this.pending=true;try{const value=await action();this.assertCurrent(allowClosed);return value;}catch(reason){this.preserve();throw reason;}finally{this.pending=false;}}
  /** 仅所有显式收尾完成后登记body成功，不代替fixture的目录删除。 */
  complete(){this.assertCurrent(true);if(this.pending){this.preserve();throw Error('原资源操作未结束');}this.finished=true;}
  /** afterEach留下永久墓碑；未完成或在途操作不能继续清理。 */
  end(){this.ended=true;if(!this.finished||this.pending)this.preserve();}
}
/** 只允许本例随机库；所有动态名称只来自记录在先的隔离资源，不接收外部库名。 */
export function insertUiDatabase(database:string):string{if(!/^dbark_e2e_[a-z0-9_]+$/.test(database))throw Error('完整INSERT拒绝非本例随机库');return database;}
/** 手写两行文件预期，仅插入已校验的随机库名；不调用产品serializer或按驱动结果造答案。 */
export function expectedInsertUiFile(database:string):string {
  insertUiDatabase(database);
  const prefix='INSERT INTO `'+database+'`.`insert_target` (`note`, `big_value`, `amount`, `doc`, `payload`) VALUES ';
  return '-- 本次新执行的完整行结果；仅生成INSERT文件，不向目标表执行INSERT。\n'+
    prefix+"(NULL, _utf8mb4 X'3138343436373434303733373039353531363135', _utf8mb4 X'31323334353637383930313233343536373839302e313230303030', _utf8mb4 X'2261626322', X'00ff');\n"+
    prefix+"(_utf8mb4 X'', _utf8mb4 X'39303037313939323534373430393933', _utf8mb4 X'302e303030303031', _utf8mb4 X'6e756c6c', X'');\n";
}
