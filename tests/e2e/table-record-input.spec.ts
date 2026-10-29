import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as projectionText } from '../../src/renderer/locales/recordProjections.zh-CN';
import { recordDocumentZh as text } from '../../src/renderer/locales/recordDocument.zh-CN';
import { test, expect, page, desktop, closed, answerDialogs, requestQuit } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 凭据只进入既有连接表单，禁止追踪和本机Docker；本套不创建权限用户。
test.use({trace:'off'});
const table=()=>page.locator('.table-tab:visible');
const panel=()=>table().getByRole('complementary',{name:formText.title,exact:true});
const editor=()=>panel().getByRole('textbox',{name:text.label,exact:true});
const leave=()=>page.getByRole('dialog',{name:formText.leaveTitle,exact:true});
const preview=()=>page.getByRole('dialog',{name:'确认数据修改',exact:true});
const qualified=(context:LiveContext,name='record_inputs')=>`\`${context.database}\`.\`${name}\``;
interface InputEntry { name:string;mode?:string;text?:string;locked?:true }
interface InputDocument {format:string;version:number;fields:InputEntry[]}
type Probe={calls:string[];restore():void};type ProbeGlobal=typeof globalThis&{__recordInputProbe?:Probe};

/** 旁观原生产handler命令名，不采集认证、SQL或行值，也不伪造返回。 */
async function observe(){await desktop.evaluate(({ipcMain})=>{
  type Handler=(event:Electron.IpcMainInvokeEvent,payload:{command:string})=>Promise<unknown>;
  const handlers=(ipcMain as typeof ipcMain&{_invokeHandlers:Map<string,Handler>})._invokeHandlers,original=handlers.get('dbark:request');if(!original)throw Error('缺少真实IPC');
  const state:Probe={calls:[],restore:()=>handlers.set('dbark:request',original)};(globalThis as ProbeGlobal).__recordInputProbe=state;
  handlers.set('dbark:request',(event,payload)=>{if(/^(?:table\.|metadata\.|query\.)/.test(payload.command))state.calls.push(payload.command);return original(event,payload);});
});}
/** 只返回脱敏命令名；失败也先恢复生产handler，再精确清理隔离库。 */
async function calls(){return desktop.evaluate(()=>(globalThis as ProbeGlobal).__recordInputProbe?.calls??[]);}
async function withDatabase(body:(context:LiveContext)=>Promise<void>,info:TestInfo){await isolatedDatabase(async context=>{try{await body(context);}catch(reason){if(!closed)await info.attach('整行输入命令名',{body:JSON.stringify(await calls()),contentType:'application/json'}).catch(()=>undefined);throw reason;}finally{if(!closed)await desktop.evaluate(()=>{const root=globalThis as ProbeGlobal;root.__recordInputProbe?.restore();delete root.__recordInputProbe;});}},info);}
/** 从真实对象树菜单刷新连接并进入表，等待原分页完成。 */
async function openTable(context:LiveContext,name='record_inputs'){
  const connection=page.locator('.connection-node').filter({has:page.getByRole('button',{name:context.connectionName,exact:true})});
  await connection.getByRole('button',{name:context.connectionName,exact:true}).focus();await clickSidebarAction(connection, {name:'刷新连接',exact:true});
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), {name:context.database,exact:true})).click();await connection.locator('.object-row').getByText(name,{exact:true}).click();
  await expect(table().locator('.context-bar')).toContainText(name);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);
}
/** 使用真实列头坐标查找虚拟网格，不按列名拼接选择器。 */
async function cell(name:string,row=2):Promise<Locator>{const header=table().getByRole('columnheader',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});await expect(header).toHaveCount(1);const index=await header.getAttribute('aria-colindex');if(!index)throw Error('缺少列坐标');const result=table().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);await result.scrollIntoViewIfNeeded();return result;}
async function openPanel(row=2){await(await cell('note',row)).click();if(!(await panel().isVisible()))await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:formText.title,exact:true})).click();await expect(panel()).toBeVisible();}
async function inputMode(){await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:text.input,exact:true})).click();await expect(editor()).toBeVisible();}
/** 对完整输入格式只修改条目文本；原数据库数值始终保持字符串。 */
async function document(){return JSON.parse(await editor().inputValue()) as InputDocument;}
async function change(values:Record<string,Partial<InputEntry>>){const value=await document();for(const field of value.fields)if(Object.hasOwn(values,field.name))Object.assign(field,values[field.name]);await editor().fill(JSON.stringify(value,null,2));}
async function stage(){await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.stage,exact:true})).click();await expect(panel().locator('.error-box')).toHaveCount(0);await expect(panel().getByRole('status')).toHaveText(formText.stagedNotice);}
async function showPreview(){await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'预览并提交',exact:true})).click();await expect(preview()).toBeVisible();await expect(preview().locator('.monaco-editor .view-lines')).toContainText(/UPDATE|INSERT/);}
async function submit(){await (await (await import('./navigation-menu')).navigationMenuItem(preview(), {name:'确认提交',exact:true})).click();await expect(preview()).toBeHidden({timeout:20000});await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);}
/** 明确两行独立旧值，生成列、特殊名称和精确类型均由真实数据库返还。 */
async function fixture(context:LiveContext){
  await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,note TEXT,big BIGINT DEFAULT 5,amount DECIMAL(30,6) DEFAULT 0,moment DATETIME(6),body LONGTEXT,payload BLOB,\`__proto__\` TEXT,\`generated\` INT GENERATED ALWAYS AS(id*2) STORED) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context)}(id,note,big,amount,moment,body,payload,\`__proto__\`) VALUES(1,'原第一',9007199254740993,12345678901234567890.120000,'2026-10-14 01:02:03.123456',?,X'00FF','原型一'),(2,'原第二',2,2,NULL,'{}',NULL,'原型二')`,[' {"n":9007199254740993,"n":1e999}\n']);await openTable(context);
}

test.describe('显式整行JSON编辑：同页草稿及原提交路径',()=>{
  test.skip(!enabled,'必须明确启用200隔离实库');test.setTimeout(120000);
  test.beforeEach(()=>{if(environment.DBARK_TEST_HOST!=='192.168.31.200')throw Error('只允许200');const port=process.env.DBARK_RECORD_VIEWS_TEST_PORT??process.env.DBARK_TEST_PORT??'13384';if(!['13357','13380','13384','13310','13311'].includes(port))throw Error('拒绝未授权端口');environment.DBARK_TEST_PORT=port;});

  test('网格草稿与整行精确文本共享，暂存预览零写，最终原路径仅提交一次',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await(await cell('note')).dblclick();await table().getByRole('textbox',{name:'编辑 note',exact:true}).fill('网格草稿');await table().getByRole('textbox',{name:'编辑 note',exact:true}).press('Enter');await openPanel();await observe();await inputMode();
    const value=await document();expect(value.format).toBe('DBArk-record-input');expect(value.fields.find(field=>field.name==='generated')).toEqual({name:'generated',locked:true});expect(value.fields.find(field=>field.name==='big')?.text).toBe('9007199254740993');
    const json=' {"n":9007199254740995,"n":1e999,"__proto__":1}\n';await change({big:{text:'9007199254740995'},amount:{text:'12345678901234567890.100001'},moment:{text:'2026-10-14 09:08:07.654321'},body:{mode:'json',text:json},payload:{mode:'binary',text:'0x00 ff 80 00'}});
    // 原型同名列通过精确数组条目修改，不在测试本身使用对象字面量的特殊__proto__语义。
    const changed=await document();changed.fields.find(field=>field.name==='__proto__')!.text='整行原型';await editor().fill(JSON.stringify(changed,null,2));await editor().press(modifier+'+Home');await info.attach('整行JSON实际界面',{body:await page.screenshot(),contentType:'image/png'});await editor().press(modifier+'+Enter');await expect(panel().locator('.error-box')).toHaveCount(0);expect(await calls()).toEqual([]);
    const read=async()=>(await context.observer.query<RowDataPacket[]>(`SELECT note,CAST(big AS CHAR) AS b,CAST(amount AS CHAR) AS a,CAST(moment AS CHAR) AS m,body,HEX(payload) AS p,\`__proto__\` AS proto FROM ${qualified(context)} WHERE id=1`))[0][0];
    expect((await read()).note).toBe('原第一');await showPreview();expect((await read()).note).toBe('原第一');expect(await calls()).toEqual(['table.preview']);await submit();
    expect(await read()).toMatchObject({note:'网格草稿',b:'9007199254740995',a:'12345678901234567890.100001',m:'2026-10-14 09:08:07.654321',body:json,p:'00FF8000',proto:'整行原型'});expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);
  },info);});

  test('非法重复遗漏和额外字段不部分暂存，离开三选保留原文且没有IPC',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await inputMode();const original=await editor().inputValue();
    const invalids=['{',original.replace(/"version":\s*1/,'"version":1,"version":1')];const duplicate=JSON.parse(original) as InputDocument;duplicate.fields[1]=duplicate.fields[0];invalids.push(JSON.stringify(duplicate));const missing=JSON.parse(original) as InputDocument;missing.fields.pop();invalids.push(JSON.stringify(missing));
    const unknown=JSON.parse(original) as InputDocument;unknown.fields[1].name='陌生字段';invalids.push(JSON.stringify(unknown));const extra=JSON.parse(original);extra.fields[1].extra=true;invalids.push(JSON.stringify(extra));
    for(const invalid of invalids){await editor().fill(invalid);await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.stage,exact:true})).click();await expect(panel().locator('.error-box')).toBeVisible();await expect(editor()).toHaveValue(invalid);}
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.tree,exact:true})).click();await expect(leave()).toBeVisible();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stageContinue,exact:true})).click();await expect(leave()).toBeVisible();await expect(leave().locator('.error-box')).toBeVisible();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stay,exact:true})).click();await expect(editor()).toHaveValue(invalids.at(-1)!);
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.tree,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.discardContinue,exact:true})).click();await expect(editor()).toHaveCount(0);await inputMode();await expect(editor()).toHaveValue(original);expect(await calls()).toEqual([]);
  },info);});

  test('切行和切模式的留在暂存放弃共享同一缓冲，已有页面草稿保持',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await inputMode();await change({note:{text:'本地第一'}});await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.next,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stay,exact:true})).click();expect((await document()).fields.find(field=>field.name==='note')?.text).toBe('本地第一');
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.next,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stageContinue,exact:true})).click();expect((await document()).fields.find(field=>field.name==='note')?.text).toBe('原第二');await expect(await cell('note')).toHaveText('本地第一');
    await change({note:{text:'放弃第二'}});await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.form,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.discardContinue,exact:true})).click();await inputMode();expect((await document()).fields.find(field=>field.name==='note')?.text).toBe('原第二');expect(await calls()).toEqual([]);
    expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context)} ORDER BY id`))[0].map(row=>row.note)).toEqual(['原第一','原第二']);
  },info);});

  test('隐藏标签和取消原生退出保留非法整行原文与全局未暂存保护',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await context.observer.query(`CREATE TABLE ${qualified(context,'other')}(id INT PRIMARY KEY) ENGINE=InnoDB`);await openPanel();await inputMode();await editor().fill('{ 未完成');await observe();await openTable(context,'other');await page.locator('.tab-select').filter({hasText:/^record_inputs$/}).click();await expect(editor()).toHaveValue('{ 未完成');await expect(table().locator('.table-action-bar')).toContainText(formText.inputDirty);
    await answerDialogs([0]);await requestQuit('window');await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);expect(closed).toBe(false);await expect(editor()).toHaveValue('{ 未完成');expect((await calls()).filter(name=>name==='table.apply'||name==='table.preview')).toEqual([]);
  },info);});

  test('原完整旧值冲突整批回滚，两个整行草稿保留且预览不重放',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await inputMode();await observe();await change({note:{text:'本地第一'}});await stage();await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.next,exact:true})).click();await change({note:{text:'本地第二'}});await stage();await showPreview();await context.observer.query(`UPDATE ${qualified(context)} SET \`__proto__\`='并发原型' WHERE id=2`);
    await (await (await import('./navigation-menu')).navigationMenuItem(preview(), {name:'确认提交',exact:true})).click();await expect(preview().locator('.error-box')).toContainText(/并发|已被其他/);await expect(preview().getByRole('button',{name:'确认提交',exact:true})).toBeDisabled();await preview().getByRole('button',{name:'确认提交',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);
    expect((await context.observer.query<RowDataPacket[]>(`SELECT note,\`__proto__\` AS p FROM ${qualified(context)} ORDER BY id`))[0].map(row=>[row.note,row.p])).toEqual([['原第一','原型一'],['原第二','并发原型']]);await (await (await import('./navigation-menu')).navigationMenuItem(preview(), {name:'返回编辑',exact:true})).click();await expect(await cell('note')).toHaveText('本地第一');await expect(await cell('note',3)).toHaveText('本地第二');
  },info);});

  test('新增整行区分DEFAULT空串文字NULL真正NULL与HEX，生成列保持锁定',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'新增',exact:true})).click();await openPanel(4);await observe();await inputMode();expect((await document()).fields.find(field=>field.name==='big')?.mode).toBe('default');await change({id:{mode:'text',text:'3'},note:{mode:'null',text:''},body:{mode:'text',text:'NULL'},payload:{mode:'binary',text:'0x0080ff00'}});await stage();expect(await calls()).toEqual([]);await showPreview();await submit();
    expect((await context.observer.query<RowDataPacket[]>(`SELECT note,big,amount,body,HEX(payload) AS b,\`generated\` FROM ${qualified(context)} WHERE id=3`))[0][0]).toMatchObject({note:null,big:'5',amount:'0.000000',body:'NULL',b:'0080FF00',generated:6});
  },info);});

  test('锁定超限大值不截断，伪造解锁拒绝，原页面完整值仍保留',async({},info)=>{await withDatabase(async context=>{
    await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,note TEXT,huge LONGTEXT) ENGINE=InnoDB`);await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,'原第一','服务器原值')`);await openTable(context);await observe();
    // 服务器原256KiB整行读取门不放宽；从生产网格编辑入口形成可保留的大值本地草稿。
    await(await cell('huge')).dblclick();const gridInput=table().getByRole('textbox',{name:'编辑 huge',exact:true});await gridInput.fill('x'.repeat(262145));await gridInput.press('Enter');await openPanel();await inputMode();const value=await document();expect(value.fields.find(field=>field.name==='huge')).toEqual({name:'huge',locked:true});
    const locked=value.fields.find(field=>field.name==='huge')!;delete locked.locked;locked.mode='text';locked.text='截断';await editor().fill(JSON.stringify(value));await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.stage,exact:true})).click();await expect(panel().locator('.error-box')).toContainText('locked');await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:formText.discard,exact:true})).click();await change({note:{text:'合法草稿'}});await stage();expect(await calls()).toEqual([]);
    const target=await cell('huge');await target.click();expect(await target.evaluate(element=>{const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));const value=JSON.parse(data.getData('application/x-dbark-cells')).rows[0][0];return{length:value.length,exact:/^x+$/.test(value)};})).toEqual({length:262145,exact:true});expect((await context.observer.query<RowDataPacket[]>(`SELECT note,huge FROM ${qualified(context)}`))[0][0]).toMatchObject({note:'原第一',huge:'服务器原值'});
  },info);});

  test('字段到整行的三选守卫及原生刷新确认统一保护，确认放弃后才读取新页',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();const section=panel().getByRole('region',{name:'note',exact:true});await (await (await import('./navigation-menu')).navigationMenuItem(section, {name:'编辑字段',exact:true})).click();await section.getByRole('textbox').fill('字段缓冲');await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:text.input,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stay,exact:true})).click();await expect(section.getByRole('textbox')).toHaveValue('字段缓冲');
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:text.input,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(leave(), {name:formText.stageContinue,exact:true})).click();expect((await document()).fields.find(field=>field.name==='note')?.text).toBe('字段缓冲');await editor().fill('{ 刷新前未完成');
    /** 覆盖原生confirm所用同步入口，记录真实文案与答案；不替换任何数据库结果。 */
    async function answer(response:0|1){await answerDialogs([response]);await desktop.evaluate(({dialog},fallback)=>{dialog.showMessageBoxSync=((...args:unknown[])=>{const options=args.at(-1) as Electron.MessageBoxSyncOptions;const response=globalThis.__dbarkE2EDialogs.answers.shift()??fallback;globalThis.__dbarkE2EDialogs.calls.push({title:options.title,message:options.message,buttons:options.buttons,response});return response;}) as typeof dialog.showMessageBoxSync;},response);}
    await answer(1);await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'刷新',exact:true})).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);await expect(editor()).toHaveValue('{ 刷新前未完成');await expect(await cell('note')).toHaveText('字段缓冲');expect(await calls()).toEqual([]);
    await answer(0);await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'刷新',exact:true})).click();await expect.poll(async()=>(await calls()).filter(name=>name==='table.page').length).toBe(1);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(editor()).toHaveCount(0);await expect(panel()).toContainText(formText.empty);await expect(await cell('note')).toHaveText('原第一');expect(await calls()).toEqual(['metadata.table','table.page']);
  },info);});

  test('只读展示切换保留已展开字段，删除撤销重建整行输入身份且始终零IPC',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();const section=panel().getByRole('region',{name:'note',exact:true});await (await (await import('./navigation-menu')).navigationMenuItem(section, {name:'编辑字段',exact:true})).click();await expect(section.getByRole('textbox')).toHaveValue('原第一');
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.tree,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.json,exact:true})).click();await (await (await import('./navigation-menu')).navigationMenuItem(panel(), {name:projectionText.form,exact:true})).click();await expect(section.getByRole('textbox')).toHaveValue('原第一');
    await inputMode();const before=await editor().inputValue();await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'删除',exact:true})).click();await expect(editor()).toHaveCount(0);await expect(panel()).toContainText(formText.deletedReadonly);await (await (await import('./navigation-menu')).navigationMenuItem(table(), {name:'删除',exact:true})).click();await expect(editor()).toHaveValue(before);await change({note:{text:'撤销后的合法输入'}});await stage();expect(await calls()).toEqual([]);expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context)} WHERE id=1`))[0][0].note).toBe('原第一');
  },info);});
});
