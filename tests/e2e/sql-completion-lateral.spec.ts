import {positionMonacoCaret} from './monaco-caret';
import type {RowDataPacket} from 'mysql2/promise';
import type {TestInfo} from '@playwright/test';
import {test,expect,page,desktop,closed,pageErrors} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,type LiveContext} from './live-helpers';

// 默认跳过早于桌面启动；连接资料只由统筹向既有环境变量注入。
test.skip(!enabled,'需要统筹显式启用200隔离实库与原生桌面');
test.use({trace:'off'});
const query=()=>page.locator('.query-tab:visible');
type Observation={command:string;settled:boolean};
type Probe={calls:Observation[];sessions:string[];restore():void};
type ProbeRoot=typeof globalThis&{__lateralUiProbe?:Probe};
type Reply={length:number;offset:number;enabled:boolean;status:string;reason?:string};

/** 只旁观真实主处理器命令和会话建立结果，不记录正文、认证或伪造返回。 */
async function observe(){
  await desktop.evaluate(({ipcMain})=>{
    type Handler=(event:Electron.IpcMainInvokeEvent,input:{command:string})=>Promise<any>;
    const handlers=(ipcMain as typeof ipcMain&{_invokeHandlers:Map<string,Handler>})._invokeHandlers,original=handlers.get('dbark:request');if(!original)throw Error('缺少真实IPC');
    const state:Probe={calls:[],sessions:[],restore:()=>handlers.set('dbark:request',original)};(globalThis as ProbeRoot).__lateralUiProbe=state;
    handlers.set('dbark:request',async(event,input)=>{
      const item={command:input.command,settled:false};state.calls.push(item);
      try{const result=await original(event,input);if(input.command==='sessions.open')state.sessions.push(result.sessionId);return result;}finally{item.settled=true;}
    });
  });
  // Worker仍运行安装资源中的解析器；包装仅记录能力快照和终态，不改请求或响应。
  await page.evaluate(()=>{
    const root=window as unknown as{__lateralReplies:Reply[]};root.__lateralReplies=[];const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);const requests=new Map<number,Omit<Reply,'status'|'reason'>>(),post=this.postMessage.bind(this);
        this.postMessage=(value:any,options?:any)=>{if(Number.isInteger(value?.id)&&typeof value.source==='string')requests.set(value.id,{length:value.source.length,offset:value.offset,enabled:value.capabilities?.lateralDerivedTables===true});post(value,options);};
        this.addEventListener('message',event=>{const pending=requests.get(event.data?.id);if(pending&&event.data?.result?.status){root.__lateralReplies.push({...pending,status:event.data.result.status,reason:event.data.result.reason});requests.delete(event.data.id);}});
      }
    };
  });
}
/** 命令计数不查询数据库，也不改变已建立会话的协议状态。 */
async function count(command:string,settled=false){return desktop.evaluate((_,input)=>(globalThis as ProbeRoot).__lateralUiProbe?.calls.filter(item=>item.command===input.command&&(!input.settled||item.settled)).length??0,{command,settled});}
/** 从持久化草稿核对完整SQL，不能只读取Monaco当前视口或改写模型。 */
async function currentSql(){return page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');});}
/** 全文经原生粘贴进入Monaco，光标用正常键盘移动并核对，不设置编辑器模型或位置。 */
async function atCaret(marked:string){const source=await positionMonacoCaret(marked);return{source,offset:marked.indexOf("|")};}
/** 等待真实Worker对本次快照的终态，避免把空建议窗口当成能力门已执行。 */
async function analyzed(source:string,offset:number,supported:boolean){
  await expect.poll(()=>page.evaluate(input=>(window as unknown as{__lateralReplies:Reply[]}).__lateralReplies.some(reply=>reply.length===input.length&&reply.offset===input.offset&&reply.enabled===input.supported&&reply.status===(input.supported?'ready':'blocked')&&(input.supported||reply.reason==='capability')),{length:source.length,offset,supported}),{timeout:13000}).toBe(true);
}
/** 只点执行当前草稿；不能用预期SQL覆盖实际候选插入结果后再执行。 */
async function executeCurrent(column:string,values:string[]){
  const previous=await count('query.execute',true);await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect.poll(()=>count('query.execute',true),{timeout:20000}).toBe(previous+1);
  await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled();await expect(query().locator('.error-box')).toHaveCount(0);
  const header=query().getByRole('columnheader',{name:new RegExp('^'+column)});await expect(header).toHaveCount(1);const index=await header.getAttribute('aria-colindex');if(!index)throw Error('实际输出缺少列坐标');
  await expect.poll(()=>query().locator(`[role=row][aria-rowindex]:not([aria-rowindex="1"]) [role=gridcell][aria-colindex="${index}"]`).allTextContents().then(texts=>texts.map(value=>value.trim()))).toEqual(values);
}
/** 首次执行后按既有界面显式确认来源，保留临时表遮蔽保护及零自动执行边界。 */
async function confirmSources(database:string){
  await query().getByRole('button',{name:'会话临时对象',exact:true}).click();const modal=page.getByRole('dialog',{name:'当前查询会话的临时对象',exact:true});
  for(const table of['users','orders']){await modal.getByLabel('数据库名称',{exact:true}).fill(database);await modal.getByLabel('表或视图名称',{exact:true}).fill(table);await modal.getByRole('button',{name:'读取会话结构',exact:true}).click();await expect(modal.locator('.success-box')).toContainText('该名称当前不是临时表',{timeout:20000});}
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
}
/** 表和样本仅由旁观连接建立，应用执行阶段始终只通过真实查询工作区。 */
async function fixture(context:LiveContext){
  await context.observer.query(`CREATE TABLE \`${context.database}\`.users(id INT PRIMARY KEY,user_value INT);`);
  await context.observer.query(`CREATE TABLE \`${context.database}\`.orders(id INT PRIMARY KEY,user_id INT,order_value INT);`);
  await context.observer.query(`INSERT INTO \`${context.database}\`.users VALUES(1,10),(2,20)`);await context.observer.query(`INSERT INTO \`${context.database}\`.orders VALUES(1,1,100),(2,2,200)`);
}
/** 任意失败先恢复原处理器，再让原helper关闭应用并精确删除本例随机库。 */
async function inDatabase(body:(context:LiveContext)=>Promise<void>,info:TestInfo){await isolatedDatabase(async context=>{try{await body(context);expect(pageErrors).toEqual([]);}finally{if(!closed)await desktop.evaluate(()=>{const root=globalThis as ProbeRoot;root.__lateralUiProbe?.restore();delete root.__lateralUiProbe;});}},info);}

test('按实际服务器验证新草稿和物理会话的LATERAL补全、接受与执行',async({},info)=>{
  test.setTimeout(180000);
  await inDatabase(async context=>{
    const baseline:Record<string,[string,boolean]>={'13357':['5.7.',false],'13380':['8.0.',true],'13384':['8.4.',true],'13310':['10.11.',false],'13311':['11.4.',false],'13484':['8.4.',true]},expected=baseline[process.env.DBARK_TEST_PORT??''];if(!expected)throw Error('拒绝未知隔离端口');
    const[versions]=await context.observer.query<RowDataPacket[]>('SELECT VERSION() AS version');const actualVersion=String(versions[0].version);expect(actualVersion.replace(/^5\.5\.5-/, '').startsWith(expected[0])).toBe(true);
    await fixture(context);await observe();await openDatabaseQuery(context.database);expect(await count('sessions.open')).toBe(0);expect(await count('query.execute')).toBe(0);
    const first='SELECT d.copied FROM users u JOIN LATERAL(SELECT u.use|suffix AS copied) d ON TRUE ORDER BY u.id',prepared=await atCaret(first),catalogs=await count('metadata.completion');
    await page.keyboard.press('Control+Space');await analyzed(prepared.source,prepared.offset,expected[1]);
    if(!expected[1]){
      await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0);expect(await currentSql()).toBe(prepared.source);expect(await count('metadata.completion')).toBe(catalogs);expect(await count('query.execute')).toBe(0);expect(await count('sessions.open')).toBe(0);
      await info.attach('实际版本能力关闭',{body:JSON.stringify({port:process.env.DBARK_TEST_PORT,version:actualVersion,lateralDerivedTables:false}),contentType:'application/json'});return;
    }
    const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText('user_value');await page.keyboard.press('Enter');await expect.poll(currentSql).toBe(first.replace('use|suffix','`user_value`'));expect(await count('query.execute')).toBe(0);expect(await count('sessions.open')).toBe(0);
    await executeCurrent('copied',['10','20']);expect(await count('sessions.open')).toBe(1);await confirmSources(context.database);
    const session=await desktop.evaluate(()=>(globalThis as ProbeRoot).__lateralUiProbe!.sessions[0]),snapshot=await page.evaluate(sessionId=>window.dbark.invoke('query.completionState',{sessionId}),session);expect(snapshot.serverVersion).toBe(actualVersion);expect(snapshot.dialect).toBe('mysql');
    for(const[marked,label,finished,column,values]of[
      ['SELECT d.cop|suffix FROM users u JOIN LATERAL(SELECT u.user_value AS copied) d ON TRUE ORDER BY u.id','copied','cop|suffix','copied',['10','20']],
      ['SELECT d.copied FROM users u JOIN LATERAL(SELECT u.ord|suffix AS copied FROM orders u WHERE u.id=1) d ON TRUE ORDER BY u.id','order_value','ord|suffix','copied',['100','100']],
      ['SELECT d.ord|suffix FROM users u JOIN LATERAL(SELECT o.* FROM orders o WHERE o.user_id=u.id) d ON TRUE ORDER BY u.id','order_value','ord|suffix','order_value',['100','200']],
    ]as const){
      await confirmSources(context.database);const value=await atCaret(marked),executions=await count('query.execute');await page.keyboard.press('Control+Space');await analyzed(value.source,value.offset,true);await expect(widget.locator('.monaco-list-row.focused')).toContainText(label);await page.keyboard.press('Enter');await expect.poll(currentSql).toBe(marked.replace(finished,'`'+label+'`'));expect(await count('query.execute')).toBe(executions);await executeCurrent(column,[...values]);
    }
    const invalid=await atCaret('SELECT * FROM users u JOIN LATERAL(SELECT later.|) d ON TRUE JOIN orders later ON TRUE'),before=await count('metadata.completion');await page.keyboard.press('Control+Space');
    await expect.poll(()=>page.evaluate(input=>(window as unknown as{__lateralReplies:Reply[]}).__lateralReplies.some(reply=>reply.length===input.length&&reply.offset===input.offset&&reply.status==='blocked'&&reply.reason==='syntax'),{length:invalid.source.length,offset:invalid.offset}),{timeout:13000}).toBe(true);await expect(widget.locator('.monaco-list-row')).toHaveCount(0);expect(await count('metadata.completion')).toBe(before);expect(await count('query.execute')).toBe(4);
    const history=await page.evaluate(()=>window.dbark.invoke('history.list',{}));expect(history).toHaveLength(4);await page.screenshot({path:info.outputPath('lateral-real-monaco.png')});
  },info);
});
