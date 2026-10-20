import { mkdir,readFile,stat } from 'node:fs/promises';
import { relative,isAbsolute } from 'node:path';
import mysql from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test,expect,dataDir,ownedDesktopResources,retainOwnedDesktopResources,confirmOwnedDesktopExit,pageErrors } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { QueryResultColumnsUiLifetime,assertQueryResultColumnsUiIdentity,closeQueryResultColumnsObserver,guardQueryResultColumnsExitAnswers,installQueryResultColumnsAudit,readQueryResultColumnsAudit,answerQueryResultColumnsSave,type QueryResultColumnsUiTarget } from '../helpers/queryResultColumnsUi';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { queryResultSortCaseSql,queryResultSortCaseHeaders,verifyQueryResultSortCaseCopy,verifyQueryResultSortCaseFile } from '../helpers/queryResultSortCaseUi';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryLayoutZh as layoutText } from '../../src/renderer/locales/queryLayout.zh-CN';

/** 仅三门和Root显式RAM绑定后注册；原native及owner强引用保留，失败不进入补清理。 */
export function registerQueryResultSortCaseUi(binding:QueryResultColumnsUiTarget):void {
 const cases=new Map<TestInfo,{life:QueryResultColumnsUiLifetime;observer?:mysql.Connection;native?:any;stream?:any}>();let halted=false;
 test.use({preserveOnUnconfirmedExit:true,trace:'off',screenshot:'off',video:'off'});test.setTimeout(120000);test.describe.configure({retries:0});
 test.afterEach(({},info)=>{const current=cases.get(info);if(!current){halted=true;retainOwnedDesktopResources(info);throw Error('结果列未建立本例owner，保留现场');}try{current.life.afterEach();cases.delete(info);}catch(reason){halted=true;throw reason;}});
 test('准确13384真实App文本大小写、Unicode、NULL、精度及原文复制导出一致',async({trace,screenshot,video},info)=>{
  if(halted)throw Error('结果列前例已保留资源，停止后续用例');
  const captured=ownedDesktopResources(info),page=captured.page,application=captured.application,directory=dataDir;
  const life=new QueryResultColumnsUiLifetime({check(allowClosed){binding.assertCurrent();const now=ownedDesktopResources(info);if(now.page!==page||now.application!==application||!allowClosed&&now.closed)throw Error('结果列原owner已变化');},closed:()=>ownedDesktopResources(info).closed,retain:()=>{halted=true;retainOwnedDesktopResources(info);},async exit(){life.check();await application.evaluate(readQueryResultColumnsAudit);life.check();await application.evaluate(guardQueryResultColumnsExitAnswers);life.check();await confirmOwnedDesktopExit(info);}},info as TestInfo&{_startWallTime?:number});
  const current:{life:QueryResultColumnsUiLifetime;observer?:mysql.Connection;native?:any;stream?:any}={life};cases.set(info,current);let armed=false;
  /** 每步原期限与owner前后复核；审计已开启时同时核原handler及修订墓碑。 */
  const observe=<T,>(action:()=>Promise<T>)=>life.observe(async()=>{if(armed)await application.evaluate(readQueryResultColumnsAudit);const result=await action();if(armed)await application.evaluate(readQueryResultColumnsAudit);return result;});
  try{
   life.check();if(trace!=='off'||screenshot!=='off'||video!=='off')throw Error('结果列认证表单禁止trace／截图／视频');
   const nested=relative(directory,binding.target.output);if(!nested.startsWith('..')&&!isAbsolute(nested))throw Error('Root输出目录不得位于共享fixture会自动清理的userData内');
   await observe(()=>mkdir(binding.target.output,{recursive:false}));
   await observe(async()=>{current.observer=await mysql.createConnection({host:binding.target.host,port:binding.target.port,user:binding.target.user,password:binding.target.password,connectTimeout:15000});current.native=(current.observer as mysql.Connection&{connection?:any}).connection;current.stream=current.native?.stream;life.check();if(!current.native||!current.stream)throw Error('结果列观察流原生归属未知');});
   assertQueryResultColumnsUiIdentity(await observe(()=>current.observer!.query('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')),binding.target.uuid);
   const connectionName='结果列本例只读';await observe(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click());const form=page.getByRole('dialog',{name:zh.common.newConnection,exact:true});
   for(const[label,value]of [[zh.connections.text006,connectionName],[zh.connections.text009,binding.target.host],[zh.connections.text010,String(binding.target.port)],[zh.common.user,binding.target.user],[zh.connections.text011,binding.target.password],[zh.connections.text012,'']])await observe(()=>form.getByLabel(label,{exact:true}).fill(value));
   // 原生select的label文本可能包含option后代文字，按真实combobox角色与标签前缀定位。
   await observe(()=>form.getByRole('combobox',{name:new RegExp('^'+zh.connections.text008)}).selectOption('mysql'));await observe(()=>form.getByLabel(zh.connections.text016,{exact:true}).uncheck());await observe(()=>expect(form.getByLabel(zh.connections.text016,{exact:true})).not.toBeChecked());
   // 不测试连接或展开数据库树；实际查询负责本例唯一受管会话的建连。
   await observe(()=>form.getByRole('button',{name:zh.connections.text036,exact:true}).click());await observe(()=>expect(form).toBeHidden());
   const profiles=await observe(()=>page.evaluate(()=>window.dbark.invoke('connections.list',{}))),profile=profiles.length===1?profiles[0]:undefined;
   expect(Boolean(profile&&profile.name===connectionName&&profile.host===binding.target.host&&profile.port===binding.target.port&&profile.user===binding.target.user&&!profile.database&&profile.rememberPassword===false&&profile.password===undefined&&profile.hasPassword===Boolean(binding.target.password)&&!profile.tls?.enabled&&!profile.ssh?.enabled)).toBe(true);
   await observe(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newQuery,exact:true}).click());const query=page.getByRole('dialog',{name:zh.common.newQuery,exact:true});await observe(()=>query.getByRole('combobox',{name:new RegExp('^'+zh.app.text049)}).selectOption(profile!.id));await observe(()=>query.getByLabel(zh.app.text050,{exact:true}).fill(''));await observe(()=>query.getByRole('button',{name:zh.app.text053,exact:true}).click());await observe(()=>expect(query).toBeHidden());
   const tab=page.locator('.query-tab:visible'),input=tab.locator('.monaco-editor').getByRole('textbox');
   // 常量SQL走可见编辑器既有paste处理，避免把整段文本解释为逐字符输入；不访问系统剪贴板或修改模型。
   await observe(()=>input.focus());await observe(()=>page.keyboard.press(`${process.platform==='darwin'?'Meta':'Control'}+A`));await observe(()=>page.keyboard.press('Backspace'));
   await observe(()=>input.evaluate((element,sql)=>{const transfer=new DataTransfer();transfer.setData('text/plain',sql);const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});if(event.clipboardData!==transfer)throw Error('大小写排序准备事件未保留本页RAM数据');element.dispatchEvent(event);},queryResultSortCaseSql));
   let tabId='';await observe(()=>expect.poll(async()=>{const settings=await observe(()=>page.evaluate(()=>window.dbark.invoke('settings.get',{})));const own=settings.tabs.find(tab=>tab.id===settings.activeTabId);if(own?.kind==='query'&&own.connectionId===profile!.id&&own.sql===queryResultSortCaseSql){tabId=own.id;return true;}return false;}).toBe(true));
   // 只用正式分栏键盘入口缩小编辑区，为七行比较留出可读空间，不写布局DOM或显示模式。
   const separator=tab.getByRole('separator',{name:layoutText.separator,exact:true}),minimum=await observe(()=>separator.getAttribute('aria-valuemin'));
   if(minimum===null||!Number.isFinite(Number(minimum)))throw Error('大小写排序缺少可读分栏下限');
   await observe(()=>separator.focus());
   for(let step=0;step<12;step++){if(await observe(()=>separator.getAttribute('aria-valuenow'))===minimum)break;await observe(()=>page.keyboard.press('Shift+ArrowUp'));}
   await observe(()=>expect(separator).toHaveAttribute('aria-valuenow',minimum));
   const ownerWindow=await observe(()=>application.browserWindow(page));const senderId=await observe(()=>ownerWindow.evaluate(window=>window.webContents.id));await observe(()=>ownerWindow.dispose());
   await observe(()=>application.evaluate(installQueryResultColumnsAudit,{senderId,profileId:profile!.id,tabId,sql:queryResultSortCaseSql,deadline:(info as TestInfo&{_startWallTime?:number})._startWallTime!+120000}));armed=true;
   await observe(()=>tab.getByRole('button',{name:zh.query.text011,exact:true}).click());await observe(()=>expect(tab.getByRole('button',{name:zh.common.stop,exact:true})).toBeDisabled({timeout:20000}));await observe(()=>expect(tab.locator('.error-box')).toHaveCount(0));
   const before=await observe(()=>page.evaluate(async()=>(await window.dbark.invoke('history.list',{})).map(row=>row.id).sort()));expect((await observe(()=>application.evaluate(readQueryResultColumnsAudit))).queries).toBe(1);
   const grid=tab.locator('.result-body .results-grid'),heads=grid.locator('[role="columnheader"]:has(.column-type)');
   await observe(()=>expect.poll(()=>grid.evaluate(element=>element.clientHeight)).toBeGreaterThanOrEqual(264));
   const selected=tab.getByRole('button',{name:zh.resultExport.selectedTitle,exact:true}),manage=page.getByRole('dialog',{name:text.title,exact:true});
   const modifier=process.platform==='darwin'?'Meta':'Control';
   /** 固定ID始终为首数据列；只读真实DOM，不读取内部props或产品排序器。 */
   const ids=()=>observe(()=>grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents());
   /** 每次只显示本轮需要的列，避免依赖屏幕分辨率或横向虚拟列是否已挂载。 */
   async function columns(visible:readonly number[]):Promise<void>{
    await observe(()=>tab.getByRole('button',{name:text.open,exact:true}).click());
    for(let index=0;index<queryResultSortCaseHeaders.length;index++)await observe(()=>manage.getByRole('checkbox',{name:text.visible(index+1),exact:true}).setChecked(visible.includes(index)));
    await observe(()=>manage.getByRole('button',{name:text.apply,exact:true}).click());
    await observe(()=>expect.poll(ids).toEqual(['1','2','3','4','5','6','7']));
   }
   /** 原生combobox必须显示选择值；修改后同一ID矩阵给出排序行为证据。 */
   async function nulls(order:number,name:string,value:''|'FIRST'|'LAST'):Promise<void>{
    const control=tab.getByRole('combobox',{name:sortText.nulls(order,name),exact:true});
    await observe(()=>control.selectOption(value));await observe(()=>expect(control).toHaveValue(value));
   }
   const caseControl=(order:number)=>tab.getByRole('checkbox',{name:sortText.ignoreCase(order,'text_value'),exact:true});
   // 比较顺序全部手写；只读取真实网格DOM，Unicode的两个原文不得合并或回写。
   await columns([0,1,2,3]);await observe(()=>heads.nth(1).click());await observe(()=>expect.poll(ids).toEqual(['4','5','3','2','1','7','6']));
   await observe(()=>caseControl(1).check());await observe(()=>expect(caseControl(1)).toBeChecked());await observe(()=>expect.poll(ids).toEqual(['4','5','1','3','2','6','7']));
   await observe(()=>heads.nth(1).click());await observe(()=>expect(caseControl(1)).toBeChecked());await observe(()=>expect.poll(ids).toEqual(['6','7','2','1','3','5','4']));
   await nulls(1,'text_value','FIRST');await observe(()=>expect.poll(ids).toEqual(['4','6','7','2','1','3','5']));
   await observe(()=>tab.getByRole('button',{name:sortText.changeDirection(1,'text_value'),exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['4','5','1','3','2','6','7']));
   await nulls(1,'text_value','LAST');await observe(()=>expect.poll(ids).toEqual(['5','1','3','2','6','7','4']));
   // 两种精确后续键给出不同顺序；移优先级后保留原文本选项和NULL位置。
   await observe(()=>heads.nth(2).click({modifiers:[modifier]}));await observe(()=>expect.poll(ids).toEqual(['5','3','1','2','7','6','4']));
   await observe(()=>expect(tab.getByRole('checkbox',{name:sortText.ignoreCase(2,'big_value'),exact:true})).toHaveCount(0));
   await observe(()=>tab.getByRole('button',{name:sortText.earlier(2,'big_value'),exact:true}).click());await observe(()=>expect(caseControl(2)).toBeChecked());await observe(()=>expect.poll(ids).toEqual(['2','5','4','3','7','1','6']));
   await observe(()=>tab.getByRole('button',{name:sortText.earlier(2,'text_value'),exact:true}).click());await observe(()=>expect(caseControl(1)).toBeChecked());await observe(()=>expect(tab.getByRole('combobox',{name:sortText.nulls(1,'text_value'),exact:true})).toHaveValue('LAST'));
   await observe(()=>tab.getByRole('button',{name:sortText.remove(2,'big_value'),exact:true}).click());await observe(()=>heads.nth(3).click({modifiers:[modifier]}));await observe(()=>expect.poll(ids).toEqual(['5','1','3','2','7','6','4']));
   await observe(()=>tab.getByRole('button',{name:sortText.remove(2,'exact_value'),exact:true}).click());await observe(()=>caseControl(1).uncheck());await observe(()=>expect.poll(ids).toEqual(['5','3','2','1','7','6','4']));
   await observe(()=>heads.nth(1).click());await observe(()=>expect(caseControl(1)).not.toBeChecked());await observe(()=>expect.poll(ids).toEqual(['6','7','1','2','3','5','4']));
   await observe(()=>heads.nth(1).click());await observe(()=>expect(caseControl(1)).toHaveCount(0));await observe(()=>expect.poll(ids).toEqual(['1','2','3','4','5','6','7']));
   await observe(()=>heads.nth(1).click());await observe(()=>expect(caseControl(1)).not.toBeChecked());await observe(()=>expect(tab.getByRole('combobox',{name:sortText.nulls(1,'text_value'),exact:true})).toHaveValue(''));await observe(()=>expect.poll(ids).toEqual(['4','5','3','2','1','7','6']));
   await observe(()=>tab.getByRole('button',{name:sortText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3','4','5','6','7']));
   // 导出四个原文：a/A与İ/i+组合点；按明确成员选择，不从排序器生成文件期待。
   await columns([0,1,2,3,4,5,6,7]);await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());
   const panel=tab.getByRole('region',{name:filterText.title,exact:true});
   await observe(()=>panel.getByRole('button',{name:filterText.add,exact:true}).click());
   await observe(()=>panel.getByRole('combobox',{name:filterText.column+' 1',exact:true}).selectOption({index:0}));
   await observe(()=>panel.getByRole('combobox',{name:filterText.operator+' 1',exact:true}).selectOption('in'));
   for(const [member,value] of [[1,'1'],[2,'3'],[3,'6'],[4,'7']] as const){
    if(member>1)await observe(()=>panel.getByRole('button',{name:filterText.addMember(1),exact:true}).click());
    await observe(()=>panel.getByRole('textbox',{name:filterText.member(1,member),exact:true}).fill(value));
   }
   // 只复制真实条件草稿；改副本后AND交集必须生效，重开确认原成员未被改写。
   await observe(()=>panel.getByRole('button',{name:filterText.duplicate(1),exact:true}).click());
   for(const [member,value] of [[1,'1'],[2,'3'],[3,'6'],[4,'7']] as const)await observe(()=>expect(panel.getByRole('textbox',{name:filterText.member(2,member),exact:true})).toHaveValue(value));
   await observe(()=>panel.getByRole('textbox',{name:filterText.member(2,1),exact:true}).fill('5'));
   await observe(()=>expect(panel.getByRole('textbox',{name:filterText.member(1,1),exact:true})).toHaveValue('1'));
   await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['3','6','7']));
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());
   await observe(()=>expect(panel.getByRole('textbox',{name:filterText.member(1,1),exact:true})).toHaveValue('1'));await observe(()=>expect(panel.getByRole('textbox',{name:filterText.member(2,1),exact:true})).toHaveValue('5'));
   await observe(()=>panel.getByRole('button',{name:filterText.remove(2),exact:true}).click());
   await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3','6','7']));
   for(const index of [5,4,3,2])await observe(()=>grid.locator('[role="row"][aria-rowindex="'+index+'"]').getByRole('checkbox').check());
   await observe(()=>expect(selected).toBeEnabled());
   // 合成copy事件只读取本页DataTransfer，不执行复制按钮或覆盖系统剪贴板。
   const cell=grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]');await observe(()=>cell.click());
   const copied=await observe(()=>cell.evaluate(cell=>{const data=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});if(event.clipboardData!==data)throw Error('合成ClipboardEvent未保留RAM数据');cell.dispatchEvent(event);return {prevented:event.defaultPrevented,typed:data.getData('application/x-dbark-cells'),text:data.getData('text/plain')};}));verifyQueryResultSortCaseCopy(copied);
   for(const format of ['csv','json'] as const){
    await observe(()=>selected.click());const dialog=page.getByRole('dialog',{name:zh.resultExport.selectedTitle,exact:true});
    await observe(()=>expect(dialog).toContainText('勾选的 4 行'));await observe(()=>dialog.getByRole('combobox',{name:zh.resultExport.format,exact:true}).selectOption(format));await observe(()=>dialog.getByRole('combobox',{name:zh.resultExport.encoding,exact:true}).selectOption('utf8'));
    await observe(()=>application.evaluate(answerQueryResultColumnsSave,{senderId,path:binding.target[format]}));await observe(()=>dialog.locator('.file-picker').click());await observe(()=>dialog.getByRole('button',{name:zh.resultExport.start,exact:true}).click());await observe(()=>expect(dialog.locator('.success-box')).toHaveText('已导出 4 行已返回结果。'));
    if((await observe(()=>stat(binding.target[format]))).size>32768)throw Error('本例输出超出常量结果读取预算');verifyQueryResultSortCaseFile(format,await observe(()=>readFile(binding.target[format])));await observe(()=>dialog.getByRole('button',{name:zh.common.done,exact:true}).click());
    if(format==='csv'){await observe(()=>expect(selected).toBeDisabled());for(const index of [5,4,3,2])await observe(()=>grid.locator('[role="row"][aria-rowindex="'+index+'"]').getByRole('checkbox').check());}
   }
   expect(await observe(()=>page.evaluate(async()=>(await window.dbark.invoke('history.list',{})).map(row=>row.id).sort()))).toEqual(before);const audit=await observe(()=>application.evaluate(readQueryResultColumnsAudit));expect(audit).toEqual({queries:1,exports:['csv','json'],pending:0,revision:0});expect(pageErrors).toEqual([]);
   await life.finish(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{})),()=>closeQueryResultColumnsObserver(current.observer! as mysql.Connection&{connection?:unknown},current.native,current.stream,()=>life.check(true),native=>closeMysqlConnection(native,true,false,life.remaining(1000))));
  }catch(reason){life.preserve();throw reason;}finally{life.endBody();}
 });
}
