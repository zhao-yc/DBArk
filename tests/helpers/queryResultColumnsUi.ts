import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
type Environment = Record<string, string | undefined>;
export const queryResultColumnsUiKeys = ['DBARK_INTEGRATION_ENABLED','DBARK_QUERY_RESULT_COLUMNS_UI','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_TLS','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_TEST_SSH','DBARK_TEST_DATABASE','DBARK_TEST_CA','DBARK_QUERY_COLUMNS_OUT_DIR','DBARK_QUERY_COLUMNS_CSV_PATH','DBARK_QUERY_COLUMNS_JSON_PATH'] as const;

/** 默认/列表不调用本门；只接受同一轮raw/helper显式RAM配置，不读取文件或补造认证。 */
export function bindQueryResultColumnsUiTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const [index, key] of queryResultColumnsUiKeys.entries()) if (Object.hasOwn(raw,key) !== Object.hasOwn(helper,key) || raw[key] !== helper[key] || index < 8 && (!Object.hasOwn(raw,key) || typeof raw[key] !== 'string')) throw Error('结果列验收缺少本轮显式一致配置');
  if (raw.DBARK_INTEGRATION_ENABLED !== '1' || raw.DBARK_QUERY_RESULT_COLUMNS_UI !== '1' || raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!) || ![undefined,'','0'].includes(raw.DBARK_TEST_SSH) || raw.DBARK_TEST_DATABASE || raw.DBARK_TEST_CA) throw Error('结果列验收仅允许200/13384明文准确目标，不指定数据库或SSH/TLS');
  const output=raw.DBARK_QUERY_COLUMNS_OUT_DIR,csv=raw.DBARK_QUERY_COLUMNS_CSV_PATH,json=raw.DBARK_QUERY_COLUMNS_JSON_PATH;
  if(!output||!isAbsolute(output)||resolve(output)!==output||dirname(output)===output||!/^dbark-query-columns-[a-f0-9]{32}$/.test(basename(output))||csv!==join(output,'visible-selected.csv')||json!==join(output,'visible-selected.json'))throw Error('结果列验收缺少Root本例独占输出目录及两条准确保存答案');
  const fixed = queryResultColumnsUiKeys.map(key => ({ key, present: Object.hasOwn(raw,key), value: raw[key] })); let invalid = false;
  return { target: Object.freeze({ host: raw.DBARK_TEST_HOST, port: 13384, user: raw.DBARK_TEST_USER, password: raw.DBARK_TEST_PASSWORD!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID!,output,csv:csv!,json:json! }),
    assertCurrent() { const current = readRaw(); if (invalid || fixed.some(({key,present,value}) => Object.hasOwn(current,key) !== present || Object.hasOwn(helper,key) !== present || current[key] !== value || helper[key] !== value)) { invalid = true; throw Error('结果列验收配置已变化，永久停链'); } } };
}
export type QueryResultColumnsUiTarget = ReturnType<typeof bindQueryResultColumnsUiTarget>;
export interface QueryResultColumnsUiInfo { readonly _startWallTime?: number; readonly timeout: number; readonly status?: string; }
export interface QueryResultColumnsUiOwner { check(allowClosed: boolean): void; closed(): boolean; retain(): void; exit(): Promise<void>; }

/** 所属App只允许一条常量查询与两个格式文件成功，任务不能借空列表或失败终态补证。 */
export function queryResultColumnsUiTasks(tasks:unknown):void {
  if(!Array.isArray(tasks)||tasks.length!==3||new Set(tasks.map(task=>task?.id)).size!==3||tasks.some(task=>!task||typeof task.id!=='string'||!task.id||task.status!=='completed')||tasks.filter(task=>task.kind==='query.execute').length!==1||tasks.filter(task=>task.kind==='files.exportResult').length!==2)throw Error('结果列本例任务未确认准确完成');
}
/** 只读身份结果不能代替连接/资源终态；仅为正式UI前的准确服务器准备门。 */
export function assertQueryResultColumnsUiIdentity(result: unknown, uuid: string): void {
  const row = Array.isArray(result) && Array.isArray(result[0]) && result[0].length === 1 ? result[0][0] : undefined;
  if (!row || typeof row.version !== 'string' || !/^8\.4\.11(?:[-+][^\s]+)?$/.test(row.version) || /mariadb/i.test(row.version) || row.os !== 'Linux' || String(row.names) !== '0' || row.uuid !== uuid) throw Error('结果列只读预检服务器身份不符');
}

/** 只管理原TestInfo/原窗口；保留本地锁先落定，通知throw/noop也不能恢复退出权限。 */
export class QueryResultColumnsUiLifetime {
  readonly state = { active: true, pending: 0, retained: false, tasksChecked: false, windowClosed: false, observerClosed: false };
  private readonly start: number;
  private readonly deadline: number;
  private last: number;
  private ended?: number;
  constructor(private readonly owner: QueryResultColumnsUiOwner, private readonly info: QueryResultColumnsUiInfo, private readonly now: () => number = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.deadline = this.start + 120000; this.last = this.start; }
  preserve(): void { if (this.state.retained) return; this.state.retained = true; try { this.owner.retain(); } catch { /* 本地永久锁优先于共享通知，不覆盖原失败。 */ } }
  /** 不从helper启动重计时；预算变化、原框架终态和时钟倒退均停止。 */
  check(allowClosed = false): void {
    try { const now = this.now(); if (this.state.retained || !this.state.active || !Number.isFinite(this.start) || this.start < 0 || !Number.isFinite(now) || now < this.last || now >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('结果列本例已停链或原120秒期限失效'); this.last = now; this.owner.check(allowClosed); if (!allowClosed && this.owner.closed()) throw Error('结果列本例窗口已关闭'); }
    catch (reason) { this.preserve(); throw reason; }
  }
  /** 动作前后核同一owner；未知保留原错误与句柄，不自动重试或退出。 */
  async observe<T>(action: () => Promise<T>, allowClosed = false): Promise<T> { this.check(allowClosed); this.state.pending++; try { const result = await action(); this.check(allowClosed); return result; } catch (reason) { this.preserve(); throw reason; } finally { this.state.pending--; } }
  /** 原生严格关闭也不得借独立超时越过原期限。 */
  remaining(maximum: number): number { this.check(true); return Math.max(1,Math.min(maximum,this.deadline-this.last)); }
  /** 仅在任务、窗口和原观察流都确定时完成；失败不进入finally补清理。 */
  async finish(readTasks: () => Promise<unknown>, closeObserver: () => Promise<void>): Promise<void> {
    try {
      this.check(); if (this.state.pending) throw Error('结果列仍有未结束动作'); queryResultColumnsUiTasks(await this.observe(readTasks)); this.state.tasksChecked = true;
      await this.observe(() => this.owner.exit(),true); if (!this.owner.closed()) throw Error('结果列原窗口退出未确认'); this.state.windowClosed = true;
      await this.observe(closeObserver,true); this.state.observerClosed = true;
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** finally只关闭活动门，不执行退出、原生关闭或目录清理。 */
  endBody(): void { if (!this.state.retained && this.state.pending === 0 && this.state.tasksChecked && this.state.windowClosed && this.state.observerClosed) { try { this.check(true); this.ended = this.last; } catch { /* 原失败由动作门保留。 */ } } this.state.active = false; }
  /** 超时/仍活动先保留；正常afterEach只核原期限内已完成事实，不重新开放动作。 */
  afterEach(): void {
    try { if (this.state.retained || this.state.active || this.state.pending || this.ended === undefined || this.ended >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed' || !this.state.tasksChecked || !this.state.windowClosed || !this.state.observerClosed) throw Error('结果列本例收尾未确认，保留所属资源'); this.owner.check(true); if (!this.owner.closed()) throw Error('结果列原窗口close事实失效'); }
    catch (reason) { this.preserve(); throw reason; }
  }
}

export interface QueryResultColumnsObserver { connection?: unknown; }
/** Promise end不是关闭证明；严格函数必须处理捕获原native并确认同一stream的close终态。 */
export async function closeQueryResultColumnsObserver(raw: QueryResultColumnsObserver, native: any, stream: any, check: () => void, closeStrict: (native: any) => Promise<void>): Promise<void> {
  check(); if (!native || raw.connection !== native || !stream || native.stream !== stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || ['once','removeListener','end','destroy'].some(key => typeof stream[key] !== 'function')) throw Error('结果列观察连接原生归属未知');
  await closeStrict(native); check(); if (raw.connection !== native || native.stream !== stream || stream.closed !== true) throw Error('结果列观察连接同流严格关闭未确认');
}

/** 仅序列化到本例Electron主进程：共享退出助手的自动答案只能返回工作台，不能强制退出未知资源。 */
export function guardQueryResultColumnsExitAnswers(_electron?: unknown): void {
  const root = globalThis as unknown as Record<string,unknown>, key = '__dbarkE2EDialogs', descriptor = Object.getOwnPropertyDescriptor(root,key);
  if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) throw Error('结果列退出答案归属未知');
  const safe = (value: unknown) => { const record = value as { answers?: unknown; calls?: unknown }; if (!record || !Array.isArray(record.answers) || !Array.isArray(record.calls)) throw Error('结果列退出答案形状未知'); return { ...record, answers: record.answers.map(() => 0) }; };
  let current = safe(descriptor?.value ?? { answers:[], calls:[] });
  Object.defineProperty(root,key,{configurable:true,enumerable:true,get:()=>current,set:(value:unknown)=>{current=safe(value);}});
}


// 只有常量SELECT，三行全部为自带值；不读表、库、文件或执行存储函数。
export const queryResultColumnsSql = "SELECT CAST('1' AS CHAR) AS id,CAST('18446744073709551615' AS UNSIGNED) AS repeated,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS repeated,NULL AS null_value,CAST('' AS CHAR) AS empty_value,X'00ff' AS bytes,'HIDDEN_SENTINEL' AS hidden_value UNION ALL SELECT CAST('2' AS CHAR),CAST('2' AS UNSIGNED),CAST('2.00000000000000000000' AS DECIMAL(30,20)),NULL,'',NULL,'HIDDEN_SENTINEL' UNION ALL SELECT CAST('3' AS CHAR),CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),NULL,'',X'','HIDDEN_SENTINEL' ORDER BY id";
export const queryResultColumnsHeaders=['bytes','id','repeated','repeated [4]','null_value','empty_value'];
/** 独立人工期望，不调用产品列映射、剪贴板编码或文件读取器生成答案。 */
export function verifyQueryResultColumnsFile(format:'csv'|'json',bytes:Buffer):void {
  if(bytes.length>32768)throw Error('本例常量结果输出大小异常');
  if(format==='csv')assert.deepEqual(parse(bytes,{encoding:'utf8',bom:true,columns:false,cast:false}),[
    queryResultColumnsHeaders,['base64:AP8=','1','18446744073709551615','0.12345678901234567890','\\N',''],['base64:','3','9007199254740993','1.00000000000000000001','\\N',''],
  ]);
  else { const text=bytes.toString('utf8').replace(/^\uFEFF/,''),rows=JSON.parse(text);assert.deepEqual(rows,[
    {bytes:{type:'binary',base64:'AP8='},id:'1',repeated:'18446744073709551615',['repeated [4]']:'0.12345678901234567890',null_value:null,empty_value:''},
    {bytes:{type:'binary',base64:''},id:'3',repeated:'9007199254740993',['repeated [4]']:'1.00000000000000000001',null_value:null,empty_value:''},
  ]);for(const row of rows)assert.deepEqual(Object.keys(row),queryResultColumnsHeaders); }
  if(bytes.includes(Buffer.from('HIDDEN_SENTINEL')))throw Error('隐藏列不得进入文件');
}
/** 合成ClipboardEvent只读RAM回包，NULL、空串、精确字符串及二进制对象逐项独立核验。 */
export function verifyQueryResultColumnsCopy(value:unknown):void {
  const record=value as {prevented?:boolean;typed?:string;text?:string};assert.equal(record?.prevented,true);
  assert.deepEqual(JSON.parse(record.typed??''),{version:1,rows:[[{type:'binary',base64:'AP8='},'1','18446744073709551615','0.12345678901234567890',null,''],[{type:'binary',base64:''},'3','9007199254740993','1.00000000000000000001',null,'']]});
  assert.equal(record.text,'0x00ff\t1\t18446744073709551615\t0.12345678901234567890\tNULL\t\n0x\t3\t9007199254740993\t1.00000000000000000001\tNULL\t');
}

export interface QueryColumnsAuditTarget { senderId:number;profileId:string;tabId:string;sql:string;deadline:number;presets?:true;excel?:true; }
/** 仅序列化至本例Electron主进程，旁观原handler真实结果；未知/写请求在原处理器前拒绝，不伪造成功。 */
export function installQueryResultColumnsAudit({ipcMain}: {ipcMain:any},target:QueryColumnsAuditTarget):void {
  const root=globalThis as any,handlers=ipcMain._invokeHandlers,original=handlers?.get('dbark:request');
  if(!Number.isSafeInteger(target.senderId)||target.senderId<=0||typeof target.profileId!=='string'||!target.profileId||typeof target.tabId!=='string'||!target.tabId||typeof target.sql!=='string'||!target.sql||!Number.isFinite(target.deadline)||target.deadline<=Date.now()||typeof original!=='function'||root.__dbarkQueryResultColumnsAudit)throw Error('结果列IPC观察器归属未知');
  const state:any={invalid:false,revision:0,pending:0,queries:0,exports:[] as string[],chosen:[] as string[],session:'',sessionClaim:undefined,tokens:{} as Record<string,string>,last:Date.now(),check:undefined};
  // 只保留首次拒绝的固定分类，不记录请求、SQL、配置、文件路径或服务端错误正文。
  const reject=(reason='既有停链')=>{state.invalid=true;state.failure??=reason;throw Error('结果列原目标／修订／IPC已变化，永久停链：'+state.failure);};
  // 可选方案流程只允许真实UI的固定八步；默认用例没有任何方案命令授权。
  const presetSteps=['list','save','rename','list','read','list','save','delete'];
  const presetTokens=new Set<string>();
  if(target.presets!==undefined&&target.presets!==true)reject('方案授权形状');
  // 独立三门XLSX例仅替换第二个文件格式；默认旧例仍只授权CSV和JSON。
  if(target.excel!==undefined&&target.excel!==true||target.excel&&target.presets)reject('Excel授权形状');
  const exportFormats=target.excel?['csv','xlsx']:['csv','json'];
  if(target.presets)state.presets={list:0,save:0,rename:0,read:0,delete:0,total:0};
  /** 描述符先行读取并复制普通数据，拒绝访问器、额外字段和循环；后续只序列化可信副本。 */
  const dataRecord=(value:any,allowed:string[],required=allowed):any=>{
    if(!value||typeof value!=='object'||Array.isArray(value))reject('方案对象边界');
    const prototype=Object.getPrototypeOf(value);if(prototype!==null&&Object.getPrototypeOf(prototype)!==null)reject('方案对象原型');
    const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=='string'||!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))reject('方案对象字段');
    const copy:any={};for(const key of keys as string[]){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)reject('方案访问器');Object.defineProperty(copy,key,{value:descriptor!.value,enumerable:true,writable:true});}return copy;
  };
  const dataArray=(value:any,max:number,min=0):any[]=>{
    if(!Array.isArray(value))reject('方案数组');const prototype=Object.getPrototypeOf(value);if(!prototype||Object.getPrototypeOf(Object.getPrototypeOf(prototype))!==null)reject('方案数组原型');const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
    if(!Number.isSafeInteger(length)||length<min||length>max||Reflect.ownKeys(value).length!==length+1)reject('方案数组边界');
    const copy=[];for(let index=0;index<length;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)reject('方案数组访问器');copy.push(descriptor!.value);}return copy;
  };
  const string=(value:any,min:number,max:number):string=>{if(typeof value!=='string'||value.length<min||value.length>max)reject('方案文本边界');return value;};
  const revision=(value:any):number=>{if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)reject('方案修订');return value;};
  const uuid=(value:any):string=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))reject('方案编号');return value;};
  const digest=(value:any):string=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))reject('方案来源摘要');return value;};
  const source=(value:any):any=>{const copy=dataRecord(value,['connectionRevision','connectionDigest']);return {connectionRevision:revision(copy.connectionRevision),connectionDigest:digest(copy.connectionDigest)};};
  const name=(value:any):string=>{const copy=string(value,1,80);if(copy!==copy.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(copy))reject('方案名称');return copy;};
  /** 本地配置不含SQL、行、路径；字段来自原查询真实回包，表达式和排序保持有界完整结构。 */
  const presetValue=(value:any):any=>{
    const copy=dataRecord(value,['columns','visible','configuration']);let units=0,groups=0,rules=0;const seen=new Set();
    const literal=(value:any,min=0,max=4096)=>{const result=string(value,min,max);units+=result.length;if(units>128*1024)reject('方案文本预算');return result;};
    const columns=(value:any)=>{const result=dataArray(value,1024,1).map(item=>{const c=dataRecord(item,['key','name','type']);return {key:literal(c.key,1),name:literal(c.name),type:literal(c.type,0,256)};});if(new Set(result.map(c=>c.key)).size!==result.length)reject('方案重复字段');return result;};
    const all=columns(copy.columns),visible=columns(copy.visible),available=new Set(visible.map(c=>c.key));
    if(!state.queryColumns||JSON.stringify(all)!==JSON.stringify(state.queryColumns)||visible.some(c=>!all.some(other=>other.key===c.key&&other.name===c.name&&other.type===c.type)))reject('方案原查询字段');
    const operators=['contains','notContains','startsWith','notStartsWith','endsWith','notEndsWith','like','notLike','empty','notEmpty','eq','ne','gt','gte','lt','lte','between','notBetween','in','notIn','null','notNull'];
    const group=(value:any,depth:number):any=>{
      if(depth>8||++groups>16||seen.has(value))reject('方案分组预算');seen.add(value);
      const g=dataRecord(value,['mode','children']);if(!['AND','OR'].includes(g.mode))reject('方案分组模式');
      const children=dataArray(g.children,48,depth===1?0:1).map(child=>{
        if(child&&typeof child==='object'&&Object.hasOwn(child,'children'))return group(child,depth+1);
        if(++rules>32)reject('方案条件预算');const r=dataRecord(child,['column','operator','value','upper','values','ignoreCase','enabled'],['column','operator','value']);
        const column=literal(r.column,1),operator=string(r.operator,1,32),result:any={column,operator,value:literal(r.value)};
        if(!available.has(column)||!operators.includes(operator))reject('方案条件字段');
        const range=['between','notBetween'].includes(operator),list=['in','notIn'].includes(operator);
        if(range)result.upper=literal(r.upper);else if(r.upper!==undefined)reject('方案区间字段');
        if(list)result.values=dataArray(r.values,128,1).map(item=>literal(item));else if(r.values!==undefined)reject('方案集合字段');
        if((list||['null','notNull','empty','notEmpty'].includes(operator))&&result.value!=='')reject('方案空条件值');
        for(const option of ['ignoreCase','enabled'])if(r[option]!==undefined){if(typeof r[option]!=='boolean')reject('方案条件选项');result[option]=r[option];}return result;
      });seen.delete(value);return {mode:g.mode,children};
    };
    const config=dataRecord(copy.configuration,['expression','sort']),expression=group(config.expression,1),sort=dataArray(config.sort,1024).map(item=>{
      const r=dataRecord(item,['column','direction','nulls','ignoreCase'],['column','direction']),result:any={column:literal(r.column,1),direction:r.direction};
      if(!available.has(result.column)||!['ASC','DESC'].includes(r.direction))reject('方案排序字段');
      if(r.nulls!==undefined){if(!['FIRST','LAST'].includes(r.nulls))reject('方案NULL位置');result.nulls=r.nulls;}
      if(r.ignoreCase!==undefined){if(typeof r.ignoreCase!=='boolean')reject('方案排序选项');result.ignoreCase=r.ignoreCase;}return result;
    });if(new Set(sort.map(r=>r.column)).size!==sort.length)reject('方案重复排序');
    const result={columns:all,visible,configuration:{expression,sort}};if(JSON.stringify(result).length>128*1024)reject('方案总文本预算');return result;
  };
  const presetSnapshot=(value:any):any=>{
    const copy=dataRecord(value,['version','revision','entries','source','bindingToken']);if(copy.version!==1)reject('方案版本');
    const entries=dataArray(copy.entries,100).map(item=>{const e=dataRecord(item,['id','name','connectionDigest','value']);return {id:uuid(e.id),name:name(e.name),connectionDigest:digest(e.connectionDigest),value:presetValue(e.value)};});
    if(new Set(entries.map(e=>e.id)).size!==entries.length||new Set(entries.map(e=>e.name)).size!==entries.length)reject('方案重复条目');
    return {version:1,revision:revision(copy.revision),entries,source:source(copy.source),bindingToken:uuid(copy.bindingToken)};
  };
  /** 每步在await前消费；token/source/CAS只取原handler已成功返回的快照。 */
  const presetRequest=(command:string,input:any):any=>{
    const kind=command.slice('result.presets.'.length),counts=state.presets,previous=state.presetSnapshot;
    if(!counts||state.presetPending||presetSteps[counts.total]!==kind||state.queries!==1)reject('方案命令授权或次数');
    const fields=kind==='list'?['connectionId']:['connectionId','source','expectedRevision','bindingToken',...(kind==='save'?['name','value',...(counts.save?['replaceId']:[])]:kind==='rename'?['id','name']:['id'])];
    const copy=dataRecord(input,fields);if(copy.connectionId!==target.profileId)reject('方案原连接');
    if(kind!=='list'){
      if(!previous||revision(copy.expectedRevision)!==previous.revision||uuid(copy.bindingToken)!==previous.bindingToken||JSON.stringify(source(copy.source))!==JSON.stringify(previous.source))reject('方案CAS或绑定');
      if(kind==='save'){copy.value=presetValue(copy.value);if(name(copy.name)!==(counts.save?'本例嵌套整理方案已改名':'本例嵌套整理方案'))reject('方案保存名称');if(counts.save&&uuid(copy.replaceId)!==previous.entries[0]?.id)reject('方案覆盖编号');}
      else if(uuid(copy.id)!==previous.entries[0]?.id)reject('方案所选编号');
      if(kind==='rename'&&name(copy.name)!=='本例嵌套整理方案已改名')reject('方案重命名');
    }
    counts[kind]++;counts.total++;state.presetPending=true;return {kind,input:copy,previous};
  };
  const presetReply=(claim:any,response:any):void=>{
    const {kind,input,previous}=claim;
    if(kind==='read'){if(JSON.stringify(presetValue(response))!==JSON.stringify(previous.entries[0].value))reject('方案读取完整值');}
    else {
      const next=presetSnapshot(response);
      if(presetTokens.has(next.bindingToken))reject('方案回包旧令牌');presetTokens.add(next.bindingToken);
      if(kind==='list'){
        if(!previous){if(next.entries.length)reject('方案本例初始非空');}
        else if(next.revision!==previous.revision||JSON.stringify(next.source)!==JSON.stringify(previous.source)||JSON.stringify(next.entries)!==JSON.stringify(previous.entries))reject('方案列表漂移');
      }else{
        if(next.revision!==previous.revision+1||JSON.stringify(next.source)!==JSON.stringify(previous.source))reject('方案变更修订');
        const expected=kind==='delete'?[]:kind==='rename'?[{...previous.entries[0],name:input.name}]:[{id:input.replaceId??next.entries[0]?.id,name:input.name,connectionDigest:previous.source.connectionDigest,value:input.value}];
        if(JSON.stringify(next.entries)!==JSON.stringify(expected))reject('方案真实变更回包');
      }
      state.presetSnapshot=next;
    }
    state.presetPending=false;
  };
  // 主进程失败回包只有文本；仅精确识别已证实的固定错误，不读取访问器或回显任意正文。
  const replyFailure=(response:unknown):string=>{
    if(!response||typeof response!=='object')return '';
    const error=Object.getOwnPropertyDescriptor(response,'error');
    return error&&Object.hasOwn(error,'value')&&error.value==="Illegal mix of collations for operation 'UNION'"?'（UNION文本排序规则冲突）':'';
  };
  state.check=()=>{const now=Date.now();if(state.invalid)reject();if(root.__dbarkQueryResultColumnsAudit!==state||handlers.get('dbark:request')!==wrapped)reject('审计归属');if(!Number.isFinite(target.deadline)||!Number.isFinite(now)||now<state.last||now>=target.deadline)reject('原期限或时钟');state.last=now;};
  const wrapped=async(event:any,payload:any)=>{
    if(event.sender?.id!==target.senderId)return original(event,payload);
    state.check();const command=payload?.command,input=payload?.input;let sessionClaim:any,presetClaim:any;
    // 所有连接修改和其它执行路径均永久撤销；不依赖配置改回后的相等值推断原修订。
    if(typeof command!=='string'||!input)reject('请求形状');
    if(['result.presets.list','result.presets.save','result.presets.rename','result.presets.read','result.presets.delete'].includes(command))presetClaim=presetRequest(command,input);
    else if(command==='settings.save'){const tab=input.tabs?.find((tab:any)=>tab.id===target.tabId);if(input.activeTabId!==target.tabId||tab?.kind!=='query'||tab.connectionId!==target.profileId||tab.sql!==target.sql){state.revision++;reject('工作区目标');}}
    else if(command==='connections.open'){if(input.id!==target.profileId)reject('连接目标');}
    else if(command==='sessions.open'){
      if(input.connectionId!==target.profileId||input.database||state.session||state.sessionClaim)reject('会话领取');
      // 首次委托前同步消费，失败或迟到均不回退；重复请求不能穿过await窗口。
      sessionClaim={sender:event.sender,senderId:target.senderId,profileId:target.profileId,revision:state.revision,response:undefined,returnedSessionId:''};
      state.sessionClaim=sessionClaim;
    }
    else if(command==='query.execute'){if(input.sql!==target.sql||!state.session||input.sessionId!==state.session||state.queries!==0)reject('查询目标或次数');state.queries++;}
    else if(command==='files.choose'){if(input.purpose!=='export'||!exportFormats.includes(input.format)||state.chosen.includes(input.format))reject('文件选择');state.chosen.push(input.format);}
    else if(command==='files.exportResult'){if(!exportFormats.includes(input.format)||state.exports.includes(input.format)||!state.chosen.includes(input.format)||input.encoding!=='utf8'||input.fileToken!==state.tokens[input.format]||input.format==='xlsx'&&(input.csvDelimiter!==undefined||input.sql!==undefined))reject('文件导出');state.exports.push(input.format);}
    else if(['query.completionState','sessions.close'].includes(command)){if(!state.session||input.sessionId!==state.session)reject('会话目标');}
    else if(command==='metadata.completion'){if(input.connectionId!==target.profileId)reject('元数据目标');}
    else if(!['settings.get','connections.list','history.list','tasks.list'].includes(command)){
      if(command.startsWith('connections.'))state.revision++;
      // 只显示固定的已知协议名称，任意请求字符串不能借诊断进入报告；名单不授予委托权限。
      const known=['query.sessionState','query.parameterNames','query.executeParameterized','query.explain','query.cancel','query.temporaryRead','query.transaction','query.exportStream','connections.save','connections.delete','metadata.databases','metadata.tables','schema.apply','snippets.list'];
      reject('未许可命令'+(known.includes(command)?'：'+command:''));
    }
    state.pending++;
    try {const response=await original(event,payload);
      // 先保留原回包和句柄，再核归属：停链后的真实资源仍留在原claim，不绑定、不补关。
      if(sessionClaim){sessionClaim.response=response;if(typeof response?.result?.sessionId==='string')sessionClaim.returnedSessionId=response.result.sessionId;}
      state.check();
      if(sessionClaim&&(state.sessionClaim!==sessionClaim||event.sender!==sessionClaim.sender||event.sender?.id!==sessionClaim.senderId||target.senderId!==sessionClaim.senderId||target.profileId!==sessionClaim.profileId||input.connectionId!==sessionClaim.profileId||input.database||state.revision!==sessionClaim.revision))reject('会话回包归属');
      if(response?.ok!==true)reject('原处理器失败回包：'+command+replyFailure(response));
      if(command==='query.execute'&&target.presets){const result=response.result?.results;if(!Array.isArray(result)||result.length!==1||!Array.isArray(result[0]?.columns)||result[0].columns.length!==7)reject('方案原查询回包');state.queryColumns=result[0].columns.map((column:any)=>{const c=dataRecord(column,['key','name','type']);return {key:string(c.key,1,4096),name:string(c.name,0,4096),type:string(c.type,0,256)};});}
      if(presetClaim)presetReply(presetClaim,response.result);
      if(command==='files.choose'){if(typeof response.result?.token!=='string'||!response.result.token||response.result.name!=='visible-selected.'+input.format)reject('文件选择回包');state.tokens[input.format]=response.result.token;}if(command==='sessions.open'){if(typeof response.result?.sessionId!=='string'||!response.result.sessionId)reject('会话回包');state.session=response.result.sessionId;}if(command==='connections.open'&&(response.result?.dialect!=='mysql'||!/^8\.4\.11(?:[-+][^\s]+)?$/.test(response.result?.version??'')))reject('连接方言或版本回包');return response;}
    catch(reason){state.invalid=true;state.failure??='原处理器抛出：'+command;throw reason;}finally{state.pending--;}
  };
  root.__dbarkQueryResultColumnsAudit=state;handlers.set('dbark:request',wrapped);state.check();
}
/** 读取本例活审计状态，不从任务名字猜测执行次数，也不输出认证或查询内容。 */
export function readQueryResultColumnsAudit():{queries:number;exports:string[];pending:number;revision:number;presets?:{list:number;save:number;rename:number;read:number;delete:number;total:number}} {
 const state=(globalThis as any).__dbarkQueryResultColumnsAudit;if(!state||typeof state.check!=='function')throw Error('结果列IPC观察器失去归属');state.check();return {queries:state.queries,exports:[...state.exports],pending:state.pending,revision:state.revision,...(state.presets?{presets:{...state.presets}}:{})};
}

/** Root显式保存答案仅供捕获窗口使用一次；恢复原函数，不授予其它窗口或任意路径。 */
export function answerQueryResultColumnsSave({dialog}:{dialog:any},target:{senderId:number;path:string}):void {
 const root=globalThis as any,state=root.__dbarkQueryResultColumnsAudit;state?.check();if(!state||root.__dbarkQueryColumnsSaveAnswer)throw Error('结果列保存答案归属未知');
 const original=dialog.showSaveDialog;if(typeof original!=='function')throw Error('原生保存对话框不可用');const token={};root.__dbarkQueryColumnsSaveAnswer=token;
 dialog.showSaveDialog=async(...args:any[])=>{dialog.showSaveDialog=original;if(root.__dbarkQueryColumnsSaveAnswer!==token)throw Error('结果列保存答案已变化');delete root.__dbarkQueryColumnsSaveAnswer;state.check();if(args[0]?.webContents?.id!==target.senderId){state.invalid=true;throw Error('拒绝其它窗口使用本例保存答案');}return {canceled:false,filePath:target.path};};
}
