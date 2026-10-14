import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as treeText } from '../../src/renderer/locales/recordProjections.zh-CN';
import { recordDocumentZh as documentText } from '../../src/renderer/locales/recordDocument.zh-CN';
import { recordJsonNodeInputZh as text } from '../../src/renderer/locales/recordJsonNodeInput.zh-CN';
import { test, expect, page, desktop, closed, answerDialogs, requestQuit } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 只连接200隔离测试实例；认证不进入跟踪或测试附件，不新增权限用户。
test.use({trace:'off'});
const table=()=>page.locator('.table-tab:visible');
const panel=()=>table().getByRole('complementary',{name:formText.title,exact:true});
const tree=()=>panel().getByRole('list',{name:treeText.lexicalTree,exact:true});
const input=()=>panel().getByRole('textbox',{name:text.label,exact:true});
const leave=()=>page.getByRole('dialog',{name:formText.leaveTitle,exact:true});
const preview=()=>page.getByRole('dialog',{name:'确认数据修改',exact:true});
const qualified=(context:LiveContext,name='record_nodes')=>`\`${context.database}\`.\`${name}\``;
type Probe={calls:string[];restore():void};type ProbeGlobal=typeof globalThis&{__recordNodeProbe?:Probe};

/** 只旁观原生产handler命令名，不记录值、认证或SQL，不替换真实返回。 */
async function observe(){await desktop.evaluate(({ipcMain})=>{
  type Handler=(event:Electron.IpcMainInvokeEvent,payload:{command:string})=>Promise<unknown>;
  const handlers=(ipcMain as typeof ipcMain&{_invokeHandlers:Map<string,Handler>})._invokeHandlers,original=handlers.get('dbark:request');if(!original)throw Error('没有真实IPC');
  const state:Probe={calls:[],restore:()=>handlers.set('dbark:request',original)};(globalThis as ProbeGlobal).__recordNodeProbe=state;
  handlers.set('dbark:request',(event,payload)=>{if(/^(?:table\.|metadata\.|query\.)/.test(payload.command))state.calls.push(payload.command);return original(event,payload);});
});}
async function calls(){return desktop.evaluate(()=>(globalThis as ProbeGlobal).__recordNodeProbe?.calls??[]);}
/** 每例结束先恢复生产handler，原实库夹具负责退出及精确清理本例随机库。 */
async function withDatabase(body:(context:LiveContext)=>Promise<void>,info:TestInfo){await isolatedDatabase(async context=>{try{await body(context);}catch(reason){if(!closed)await info.attach('节点编辑命令名',{body:JSON.stringify(await calls()),contentType:'application/json'}).catch(()=>undefined);throw reason;}finally{if(!closed)await desktop.evaluate(()=>{const root=globalThis as ProbeGlobal;root.__recordNodeProbe?.restore();delete root.__recordNodeProbe;});}},info);}
/** 所有入口经真实对象树、分页、网格选择及表单按钮。 */
async function openTable(context:LiveContext,name='record_nodes'){
  const connection=page.locator('.connection-node').filter({has:page.getByRole('button',{name:context.connectionName,exact:true})});
  await connection.getByRole('button',{name:context.connectionName,exact:true}).focus();await connection.getByRole('button',{name:'刷新连接',exact:true}).click();
  await connection.locator('.database-row').getByRole('button',{name:context.database,exact:true}).click();await connection.locator('.object-row').getByText(name,{exact:true}).click();
  await expect(table().locator('.context-bar')).toContainText(name);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);
}
async function cell(name='note',row=2):Promise<Locator>{const header=table().getByRole('columnheader',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});const index=await header.getAttribute('aria-colindex');if(!index)throw Error('缺少列坐标');const result=table().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);await result.scrollIntoViewIfNeeded();return result;}
async function openPanel(row=2){await(await cell('note',row)).click();if(!(await panel().isVisible()))await table().getByRole('button',{name:formText.title,exact:true}).click();await panel().getByRole('button',{name:treeText.tree,exact:true}).click();await expect(panel()).toBeVisible();}
async function parseColumn(name='body',native=false){const field=panel().getByRole('list',{name:treeText.fields,exact:true}).locator(':scope > li').filter({has:page.getByRole('heading',{name:new RegExp('^'+name+'$|^'+name+'\\s')})});await field.getByRole('button',{name:native?treeText.parse:treeText.parseExplicit,exact:true}).click();await expect(tree()).toBeVisible();}
/** 成员按完整序号选择，重复名称始终不能用名称单独定位。 */
function member(index:number,key:string){return tree().locator(':scope > li').filter({has:page.getByText(`成员 #${index} · ${JSON.stringify(key)}`,{exact:true})});}
async function editMember(index=2,key='n'){await member(index,key).getByRole('button',{name:text.edit,exact:true}).click();await expect(input()).toBeVisible();}
async function stage(){await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toHaveCount(0);await expect(panel().getByRole('status')).toHaveText(formText.stagedNotice);await expect(input()).toHaveCount(0);}
async function showPreview(){await table().getByRole('button',{name:'预览并提交',exact:true}).click();await expect(preview()).toBeVisible();await expect(preview().locator('.monaco-editor .view-lines')).toContainText(/UPDATE|INSERT/);}
async function submit(){await preview().getByRole('button',{name:'确认提交',exact:true}).click();await expect(preview()).toBeHidden({timeout:20000});await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);}
const original=' {"n":9007199254740993,"n":-0,"__proto__":1e999,"list":[1,{"x.y":2}]}\n';
/** 已有两行及原生JSON，用服务器实际返还的表示验证，不猜测Maria别名类型。 */
async function fixture(context:LiveContext){
  await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,note TEXT,body LONGTEXT,native_json JSON,\`generated\` LONGTEXT GENERATED ALWAYS AS(body) STORED) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context)}(id,note,body,native_json) VALUES(1,'原第一',?,'{"n":9007199254740993,"text":"中文"}'),(2,'原第二','{"n":2}','null')`,[original]);await openTable(context);
}
async function read(context:LiveContext){return(await context.observer.query<RowDataPacket[]>(`SELECT note,body FROM ${qualified(context)} ORDER BY id`))[0];}

test.describe('JSON节点编辑：精确词法与同页草稿',()=>{
  test.skip(!enabled,'需要明确启用200隔离实库');test.setTimeout(120000);
  test.beforeEach(()=>{if(environment.DBARK_TEST_HOST!=='192.168.31.200')throw Error('只允许200');const port=process.env.DBARK_RECORD_VIEWS_TEST_PORT??process.env.DBARK_TEST_PORT??'13384';if(!['13357','13380','13384','13310','13311'].includes(port))throw Error('未授权端口');environment.DBARK_TEST_PORT=port;});

  test('精确替换第二个同名成员，保留网格草稿和其它token，预览零写且仅确认后提交一次',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await(await cell()).dblclick();await table().getByRole('textbox',{name:'编辑 note',exact:true}).fill('已有网格草稿');await table().getByRole('textbox',{name:'编辑 note',exact:true}).press('Enter');await openPanel();await observe();await parseColumn();await editMember();await expect(input()).toHaveValue('-0');
    await input().fill('1.2300e+09');const bounds=await panel().getByRole('button',{name:formText.stage,exact:true}).boundingBox(),panelBounds=await panel().boundingBox();expect(bounds).not.toBeNull();expect(panelBounds).not.toBeNull();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(panelBounds!.y+panelBounds!.height);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));await info.attach('JSON节点实际输入',{body:await page.screenshot(),contentType:'image/png'});await input().press(modifier+'+Enter');await expect(input()).toHaveCount(0);await expect(panel().locator('.error-box')).toHaveCount(0);expect(await calls()).toEqual([]);expect((await read(context))[0]).toMatchObject({note:'原第一',body:original});
    const changed=original.replace('"n":-0','"n":1.2300e+09');await showPreview();expect(await calls()).toEqual(['table.preview']);expect((await read(context))[0].body).toBe(original);await submit();expect((await read(context))[0]).toMatchObject({note:'已有网格草稿',body:changed});expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);
  },info);});

  test('非法节点和合并预算错误不部分暂存，三选失败保留原文与首次模式意图',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await parseColumn();await editMember();
    for(const value of ['{','['+'0,'.repeat(2048)+'0]','['.repeat(64)+'0'+']'.repeat(64)]){await input().fill(value);await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toBeVisible();await expect(input()).toHaveValue(value);}
    await panel().getByRole('button',{name:documentText.input,exact:true}).click();await expect(leave()).toBeVisible();await leave().getByRole('button',{name:formText.stageContinue,exact:true}).click();await expect(leave()).toBeVisible();await expect(leave().locator('.error-box')).toBeVisible();await leave().getByRole('button',{name:formText.stay,exact:true}).click();await expect(input()).toBeVisible();
    await panel().getByRole('button',{name:documentText.input,exact:true}).click();await leave().getByRole('button',{name:formText.discardContinue,exact:true}).click();const document=JSON.parse(await panel().getByRole('textbox',{name:documentText.label,exact:true}).inputValue());expect(document.fields.find((field:{name:string})=>field.name==='body').text).toBe(original);expect(await calls()).toEqual([]);expect((await read(context))[0].body).toBe(original);
  },info);});

  test('节点导航三选与字段到树的暂存共享本页，关闭输入再重开使用新基线',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await parseColumn();await editMember();await input().fill('7');await panel().getByRole('button',{name:formText.next,exact:true}).click();await leave().getByRole('button',{name:formText.stay,exact:true}).click();await expect(input()).toHaveValue('7');
    await panel().getByRole('button',{name:formText.next,exact:true}).click();await leave().getByRole('button',{name:formText.stageContinue,exact:true}).click();await expect(input()).toHaveCount(0);await panel().getByRole('button',{name:formText.previous,exact:true}).click();await parseColumn();await editMember();await expect(input()).toHaveValue('7');await input().fill('8');await panel().getByRole('button',{name:text.close,exact:true}).click();await leave().getByRole('button',{name:formText.discardContinue,exact:true}).click();await editMember();await expect(input()).toHaveValue('7');
    await panel().getByRole('button',{name:text.close,exact:true}).click();await panel().getByRole('button',{name:treeText.form,exact:true}).click();const note=panel().getByRole('region',{name:'note',exact:true});await note.getByRole('button',{name:'编辑字段',exact:true}).click();await note.getByRole('textbox').fill('字段缓冲');await panel().getByRole('button',{name:treeText.tree,exact:true}).click();await leave().getByRole('button',{name:formText.stageContinue,exact:true}).click();await expect(await cell()).toHaveText('字段缓冲');expect(await calls()).toEqual([]);expect((await read(context))[0]).toMatchObject({note:'原第一',body:original});
  },info);});

  test('根对象数组及特殊成员可整体替换，SQL NULL与JSON null保持独立',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await parseColumn();await editMember(3,'__proto__');await input().fill('{"x":9007199254740995,"x":1e999}');await stage();await parseColumn();await member(3,'__proto__').getByRole('button',{name:treeText.expand,exact:true}).click();await editMember(2,'x');await expect(input()).toHaveValue('1e999');await input().fill('null');await stage();
    await parseColumn();await member(4,'list').getByRole('button',{name:treeText.expand,exact:true}).click();await tree().locator(':scope > li').filter({has:page.getByText('元素 [1]',{exact:true})}).getByRole('button',{name:text.edit,exact:true}).click();await input().fill('[true,"中文",-0]');await stage();await parseColumn();await tree().locator(':scope > li').first().getByRole('button',{name:text.edit,exact:true}).click();await input().fill('null');await stage();expect(await calls()).toEqual([]);await showPreview();await submit();expect((await read(context))[0].body).toBe(' null\n');
  },info);});

  test('隐藏标签及原生退出取消保留非法节点缓冲，刷新确认放弃后才撤下并重新读取',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await context.observer.query(`CREATE TABLE ${qualified(context,'other')}(id INT PRIMARY KEY) ENGINE=InnoDB`);await openPanel();await parseColumn();await editMember();await input().fill('{ 未完成');await observe();await openTable(context,'other');await page.locator('.tab-select').filter({hasText:/^record_nodes$/}).click();await expect(input()).toHaveValue('{ 未完成');await expect(table().locator('.table-action-bar')).toContainText(formText.inputDirty);
    await answerDialogs([0]);await requestQuit('window');await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);expect(closed).toBe(false);await expect(input()).toHaveValue('{ 未完成');
    /** 原生同步确认只替换用户答案，不替换应用刷新或查询。 */
    async function answer(response:0|1){await answerDialogs([response]);await desktop.evaluate(({dialog},fallback)=>{dialog.showMessageBoxSync=((...args:unknown[])=>{const options=args.at(-1) as Electron.MessageBoxSyncOptions;const response=globalThis.__dbarkE2EDialogs.answers.shift()??fallback;globalThis.__dbarkE2EDialogs.calls.push({title:options.title,message:options.message,buttons:options.buttons,response});return response;}) as typeof dialog.showMessageBoxSync;},response);}
    await answer(1);const before=(await calls()).length;await table().getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);await expect(input()).toHaveValue('{ 未完成');expect((await calls()).length).toBe(before);await answer(0);await table().getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(async()=>(await calls()).filter(name=>name==='table.page').length).toBe(2);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(input()).toHaveCount(0);expect((await calls()).filter(name=>name==='table.apply'||name==='table.preview')).toEqual([]);
  },info);});

  test('并发修改使两行节点草稿整批回滚，失败预览不能再次提交',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await openPanel();await observe();await parseColumn();await editMember();await input().fill('10');await stage();await panel().getByRole('button',{name:formText.next,exact:true}).click();await parseColumn();await editMember(1);await input().fill('20');await stage();await showPreview();await context.observer.query(`UPDATE ${qualified(context)} SET note='并发第二' WHERE id=2`);await preview().getByRole('button',{name:'确认提交',exact:true}).click();await expect(preview().locator('.error-box')).toContainText(/并发|已被其他/);await expect(preview().getByRole('button',{name:'确认提交',exact:true})).toBeDisabled();await preview().getByRole('button',{name:'确认提交',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);expect((await read(context)).map(row=>[row.note,row.body])).toEqual([['原第一',original],['并发第二','{"n":2}']]);await preview().getByRole('button',{name:'返回编辑',exact:true}).click();await expect(await cell('body')).toContainText('"n":10');await expect(await cell('body',3)).toContainText('"n":20');
  },info);});

  test('只读对象生成列禁用节点编辑，删除撤销清除旧节点输入而普通查看继续可用',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await context.observer.query(`CREATE VIEW ${qualified(context,'readonly_view')} AS SELECT id,note,body FROM ${qualified(context)}`);await context.observer.query(`CREATE TABLE ${qualified(context,'no_key')}(note TEXT,body LONGTEXT) ENGINE=InnoDB`);await context.observer.query(`INSERT INTO ${qualified(context,'no_key')} VALUES('无键','{"n":1}')`);await context.observer.query(`CREATE TABLE ${qualified(context,'nontransaction')}(id INT PRIMARY KEY,note TEXT,body LONGTEXT) ENGINE=MyISAM`);await context.observer.query(`INSERT INTO ${qualified(context,'nontransaction')} VALUES(1,'非事务','{"n":1}')`);
    for(const name of ['readonly_view','no_key','nontransaction']){await openTable(context,name);await openPanel();await parseColumn();for(const button of await tree().getByRole('button',{name:text.edit,exact:true}).all())await expect(button).toBeDisabled();await expect(input()).toHaveCount(0);}
    await openTable(context);await openPanel();await observe();await parseColumn('generated');for(const button of await tree().getByRole('button',{name:text.edit,exact:true}).all())await expect(button).toBeDisabled();await parseColumn();await editMember();await table().getByRole('button',{name:'删除',exact:true}).click();await expect(input()).toHaveCount(0);await expect(tree()).toHaveCount(0);await table().getByRole('button',{name:'删除',exact:true}).click();await parseColumn();await editMember();await expect(input()).toHaveValue('-0');expect(await calls()).toEqual([]);expect((await read(context))[0].body).toBe(original);
  },info);});

  test('原生JSON按实际元数据选择入口，精确大整数经过原字段预览提交保持',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);const [metadata]=await context.observer.query<RowDataPacket[]>('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[context.database,'record_nodes','native_json']);await openPanel();await observe();await parseColumn('native_json',String(metadata[0].DATA_TYPE).toLowerCase()==='json');await editMember(1);await expect(input()).toHaveValue('9007199254740993');await input().fill('9007199254740995');await stage();expect(await calls()).toEqual([]);await showPreview();await submit();const [rows]=await context.observer.query<RowDataPacket[]>(`SELECT CAST(native_json AS CHAR) AS raw FROM ${qualified(context)} WHERE id=1`);expect(rows[0].raw).toContain('9007199254740995');expect(rows[0].raw).not.toContain('9007199254740996');
  },info);});
});
