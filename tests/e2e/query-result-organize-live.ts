import { mkdir,readFile,stat } from 'node:fs/promises';
import { relative,isAbsolute } from 'node:path';
import mysql from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test,expect,dataDir,ownedDesktopResources,retainOwnedDesktopResources,confirmOwnedDesktopExit,pageErrors } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { QueryResultColumnsUiLifetime,assertQueryResultColumnsUiIdentity,closeQueryResultColumnsObserver,guardQueryResultColumnsExitAnswers,installQueryResultColumnsAudit,readQueryResultColumnsAudit,answerQueryResultColumnsSave,queryResultColumnsSql,verifyQueryResultColumnsCopy,verifyQueryResultColumnsFile,type QueryResultColumnsUiTarget } from '../helpers/queryResultColumnsUi';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultCopyZh as copyText } from '../../src/renderer/locales/queryResultCopy.zh-CN';

/** 仅双门和Root显式RAM绑定后注册；原native及owner强引用保留，失败不进入补清理。 */
export function registerQueryResultOrganizeUi(binding:QueryResultColumnsUiTarget):void {
 const cases=new Map<TestInfo,{life:QueryResultColumnsUiLifetime;observer?:mysql.Connection;native?:any;stream?:any}>();let halted=false;
 test.use({preserveOnUnconfirmedExit:true,trace:'off',screenshot:'off',video:'off'});test.setTimeout(120000);test.describe.configure({retries:0});
 test.afterEach(({},info)=>{const current=cases.get(info);if(!current){halted=true;retainOwnedDesktopResources(info);throw Error('结果列未建立本例owner，保留现场');}try{current.life.afterEach();cases.delete(info);}catch(reason){halted=true;throw reason;}});
 test('准确13384真实App多列排序与文本、区间、多值及分组筛选、空结果及CSV／JSON范围一致',async({trace,screenshot,video},info)=>{
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
   const tab=page.locator('.query-tab:visible');await observe(()=>tab.locator('.monaco-editor').getByRole('textbox').focus());await observe(()=>page.keyboard.press(`${process.platform==='darwin'?'Meta':'Control'}+A`));await observe(()=>page.keyboard.insertText(queryResultColumnsSql));
   let tabId='';await observe(()=>expect.poll(async()=>{const settings=await observe(()=>page.evaluate(()=>window.dbark.invoke('settings.get',{})));const own=settings.tabs.find(tab=>tab.id===settings.activeTabId);if(own?.kind==='query'&&own.connectionId===profile!.id&&own.sql===queryResultColumnsSql){tabId=own.id;return true;}return false;}).toBe(true));
   const ownerWindow=await observe(()=>application.browserWindow(page));const senderId=await observe(()=>ownerWindow.evaluate(window=>window.webContents.id));await observe(()=>ownerWindow.dispose());
   await observe(()=>application.evaluate(installQueryResultColumnsAudit,{senderId,profileId:profile!.id,tabId,sql:queryResultColumnsSql,deadline:(info as TestInfo&{_startWallTime?:number})._startWallTime!+120000}));armed=true;
   await observe(()=>tab.getByRole('button',{name:zh.query.text011,exact:true}).click());await observe(()=>expect(tab.getByRole('button',{name:zh.common.stop,exact:true})).toBeDisabled({timeout:20000}));await observe(()=>expect(tab.locator('.error-box')).toHaveCount(0));
   const before=await observe(()=>page.evaluate(async()=>(await window.dbark.invoke('history.list',{})).map(row=>row.id).sort()));expect((await observe(()=>application.evaluate(readQueryResultColumnsAudit))).queries).toBe(1);
   /** 只读真实DOM表头；数据列的原名与小号类型标签分离，不取内部网格props代替渲染验收。 */
   const headers=()=>observe(()=>tab.locator('.result-body .results-grid [role="columnheader"] .column-type').evaluateAll(nodes=>nodes.map(node=>node.parentElement?.firstChild?.textContent??'')));
   const manage=page.getByRole('dialog',{name:text.title,exact:true}),selected=tab.getByRole('button',{name:zh.resultExport.selectedTitle,exact:true});
   await observe(()=>tab.getByRole('button',{name:text.open,exact:true}).click());
   await observe(()=>manage.getByRole('checkbox',{name:text.visible(7),exact:true}).uncheck());
   for(let step=0;step<5;step++)await observe(()=>manage.getByRole('button',{name:text.up(6),exact:true}).click());
   await observe(()=>manage.getByRole('button',{name:text.apply,exact:true}).click());
   expect(await headers()).toEqual(['bytes','id','repeated','repeated','null_value','empty_value']);
   const grid=tab.locator('.result-body .results-grid'),heads=grid.locator('[role="columnheader"]:has(.column-type)');
   const modifier=process.platform==='darwin'?'Meta':'Control';
   /** 只读当前真实DOM顺序，不读取React内部行或复用产品比较器生成期望。 */
   const ids=()=>observe(()=>grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="3"]').allTextContents());
   await observe(()=>heads.nth(2).click());await observe(()=>expect.poll(ids).toEqual(['2','3','1']));
   await observe(()=>heads.nth(3).click({modifiers:[modifier]}));await observe(()=>expect(tab.getByRole('list',{name:sortText.priorities,exact:true}).getByRole('listitem')).toHaveCount(2));
   await observe(()=>expect.poll(ids).toEqual(['2','3','1']));
   await observe(()=>tab.getByRole('button',{name:sortText.earlier(2,'repeated'),exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3','2']));
   const panel=tab.getByRole('region',{name:filterText.title,exact:true});
   /** 通过真实受控条件输入修改草稿；字段按当前可见序号选择，重复别名不作身份。 */
   async function addRule(index:number,column:number,operator:string,value:string,upper?:string){
    await observe(()=>panel.getByRole('button',{name:filterText.add,exact:true}).click());
    await observe(()=>panel.getByRole('combobox',{name:filterText.column+' '+index,exact:true}).selectOption({index:column}));
    await observe(()=>panel.getByRole('combobox',{name:filterText.operator+' '+index,exact:true}).selectOption(operator));
    const range=operator==='between'||operator==='notBetween',input=panel.getByRole('textbox',{name:(range?filterText.lower:filterText.input)+' '+index,exact:true});
    if(['empty','notEmpty','null','notNull'].includes(operator)){
     await observe(()=>expect(input).toBeDisabled());await observe(()=>expect(input).toHaveValue(''));
    }else await observe(()=>input.fill(value));
    if(range)await observe(()=>panel.getByRole('textbox',{name:filterText.upper+' '+index,exact:true}).fill(upper!));
   }
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,3,'lte','1.00000000000000000001');
   await observe(()=>expect.poll(ids).toEqual(['1','3','2']));await observe(()=>panel.getByRole('button',{name:filterText.cancel,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3','2']));
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,3,'lte','1.00000000000000000001');await addRule(2,1,'eq','2');
   await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual([]));
   await observe(()=>expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(3,0)));await observe(()=>expect(tab.getByRole('button',{name:copyText.action,exact:true})).toBeDisabled());await observe(()=>expect(selected).toBeDisabled());
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('combobox',{name:filterText.mode,exact:true}).selectOption('OR'));await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('button',{name:filterText.remove(2),exact:true}).click());await observe(()=>panel.getByRole('combobox',{name:filterText.mode,exact:true}).selectOption('AND'));await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3']));
   await observe(()=>heads.nth(5).click());await observe(()=>heads.nth(3).click({modifiers:[modifier]}));await observe(()=>heads.nth(3).click({modifiers:[modifier]}));await observe(()=>expect(tab.getByRole('list',{name:sortText.priorities,exact:true}).getByRole('listitem')).toHaveCount(2));await observe(()=>expect.poll(ids).toEqual(['3','1']));
   await observe(()=>tab.getByRole('button',{name:sortText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3']));
   await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   // 复用原常量SQL中的CHAR编号与空文本列，逐项核新条件；不增加查询、目标或文件。
   for(const [column,operator,value,expected] of [
    [1,'notContains','2',['1','3']],[1,'startsWith','1',['1']],[1,'notStartsWith','1',['2','3']],
    [1,'endsWith','3',['3']],[1,'notEndsWith','3',['1','2']],[5,'empty','',['1','2','3']],[5,'notEmpty','',[]],
   ] as const){
    await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,column,operator,value);
    await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(expected));
    await observe(()=>expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(3,expected.length)));
    await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   }
   // 仍使用原三行常量、准确目标和一次SQL；大整数及高精度小数的两端独立输入，不增加文件任务。
   for(const [column,operator,lower,upper,expected] of [
    [2,'between','9007199254740993','18446744073709551615',['1','3']],
    [2,'notBetween','9007199254740993','18446744073709551615',['2']],
    [3,'between','0.12345678901234567890','1.00000000000000000001',['1','3']],
    [3,'notBetween','0.12345678901234567890','1.00000000000000000001',['2']],
    [3,'between','1.00000000000000000001','1.00000000000000000001',['3']],
   ] as const){
    await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,column,operator,lower,upper);
    await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(expected));
    await observe(()=>expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(3,expected.length)));
    await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   }
   // 颠倒端点不清空原视图；原面板修正后再应用，不能由产品偷偷交换边界。
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,2,'between','18446744073709551615','9007199254740993');
   await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect(tab).toContainText(filterText.rangeOrder));await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   await observe(()=>panel.getByRole('textbox',{name:filterText.upper+' 1',exact:true}).fill('18446744073709551615'));await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1']));
   await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   // 多值仍使用原常量三行和独立文本输入；不解析SQL列表，也不增加查询或文件任务。
   for(const [column,operator,values,expected] of [
    [1,'in',['1','3'],['1','3']],
    [2,'in',['18446744073709551615','9007199254740993'],['1','3']],
    [3,'notIn',['0.12345678901234567890','1.00000000000000000001'],['2']],
   ] as const){
    await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('button',{name:filterText.add,exact:true}).click());
    await observe(()=>panel.getByRole('combobox',{name:filterText.column+' 1',exact:true}).selectOption({index:column}));await observe(()=>panel.getByRole('combobox',{name:filterText.operator+' 1',exact:true}).selectOption(operator));
    for(let member=0;member<values.length;member++){if(member)await observe(()=>panel.getByRole('button',{name:filterText.addMember(1),exact:true}).click());await observe(()=>panel.getByRole('textbox',{name:filterText.member(1,member+1),exact:true}).fill(values[member]));}
    await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(expected));await observe(()=>expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(3,expected.length)));
    await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','2','3']));
   }
   /** 分组自带的条件只配置真实输入，不能调用根添加按钮改变所在组。 */
   async function configureGroupRule(index:number,column:number,operator:string,value:string){
    await observe(()=>panel.getByRole('combobox',{name:filterText.column+' '+index,exact:true}).selectOption({index:column}));await observe(()=>panel.getByRole('combobox',{name:filterText.operator+' '+index,exact:true}).selectOption(operator));await observe(()=>panel.getByRole('textbox',{name:filterText.input+' '+index,exact:true}).fill(value));
   }
   // （id=1或id=2）同时满足金额上限，只留下1；平铺AND或OR均不是这个结果。
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('button',{name:filterText.addGroup,exact:true}).click());await configureGroupRule(1,1,'eq','1');await observe(()=>panel.getByRole('button',{name:filterText.addInGroup('1'),exact:true}).click());await configureGroupRule(2,1,'eq','2');await addRule(3,3,'lte','1.00000000000000000001');await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1']));
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>expect(panel.getByRole('combobox',{name:filterText.groupMode('1'),exact:true})).toHaveValue('OR'));await observe(()=>panel.getByRole('button',{name:filterText.cancel,exact:true}).click());await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());
   // AND根内嵌OR组，再嵌AND子组；整数、小数仍走声明类型的原精确比较。
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('button',{name:filterText.addGroup,exact:true}).click());await configureGroupRule(1,1,'eq','1');await observe(()=>panel.getByRole('button',{name:filterText.addGroupInGroup('1'),exact:true}).click());await observe(()=>panel.getByRole('combobox',{name:filterText.groupMode('1.1'),exact:true}).selectOption('AND'));await configureGroupRule(2,1,'eq','3');await observe(()=>panel.getByRole('button',{name:filterText.addInGroup('1.1'),exact:true}).click());await configureGroupRule(3,3,'gt','0');await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3']));await observe(()=>tab.getByRole('button',{name:filterText.clear,exact:true}).click());
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await addRule(1,3,'lte','1.00000000000000000001');await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3']));
   // 保留原金额条件，再加入真实OR子组；后续原复制和两格式导出直接读取这棵已生效分组树。
   await observe(()=>tab.getByRole('button',{name:filterText.open,exact:true}).click());await observe(()=>panel.getByRole('button',{name:filterText.addGroup,exact:true}).click());await configureGroupRule(2,1,'eq','1');await observe(()=>panel.getByRole('button',{name:filterText.addInGroup('1'),exact:true}).click());await configureGroupRule(3,1,'eq','3');await observe(()=>panel.getByRole('button',{name:filterText.apply,exact:true}).click());await observe(()=>expect.poll(ids).toEqual(['1','3']));
   await observe(()=>expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(3,2)));
   for(const index of [3,2])await observe(()=>grid.locator('[role="row"][aria-rowindex="'+index+'"]').getByRole('checkbox').check());
   await observe(()=>expect(selected).toBeEnabled());
   // 合成copy事件只读取本页DataTransfer，不执行复制按钮或覆盖系统剪贴板。
   const cell=grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]');await observe(()=>cell.click());
   const copied=await observe(()=>cell.evaluate(cell=>{const data=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});if(event.clipboardData!==data)throw Error('合成ClipboardEvent未保留RAM数据');cell.dispatchEvent(event);return {prevented:event.defaultPrevented,typed:data.getData('application/x-dbark-cells'),text:data.getData('text/plain')};}));verifyQueryResultColumnsCopy(copied);
   for(const format of ['csv','json'] as const){
    await observe(()=>selected.click());const dialog=page.getByRole('dialog',{name:zh.resultExport.selectedTitle,exact:true});
    await observe(()=>expect(dialog).toContainText('勾选的 2 行'));await observe(()=>dialog.getByRole('combobox',{name:zh.resultExport.format,exact:true}).selectOption(format));await observe(()=>dialog.getByRole('combobox',{name:zh.resultExport.encoding,exact:true}).selectOption('utf8'));
    await observe(()=>application.evaluate(answerQueryResultColumnsSave,{senderId,path:binding.target[format]}));await observe(()=>dialog.locator('.file-picker').click());await observe(()=>dialog.getByRole('button',{name:zh.resultExport.start,exact:true}).click());await observe(()=>expect(dialog.locator('.success-box')).toHaveText('已导出 2 行已返回结果。'));
    if((await observe(()=>stat(binding.target[format]))).size>32768)throw Error('本例输出超出常量结果读取预算');verifyQueryResultColumnsFile(format,await observe(()=>readFile(binding.target[format])));await observe(()=>dialog.getByRole('button',{name:zh.common.done,exact:true}).click());
    if(format==='csv'){await observe(()=>expect(selected).toBeDisabled());for(const index of [3,2])await observe(()=>grid.locator('[role="row"][aria-rowindex="'+index+'"]').getByRole('checkbox').check());}
   }
   expect(await observe(()=>page.evaluate(async()=>(await window.dbark.invoke('history.list',{})).map(row=>row.id).sort()))).toEqual(before);const audit=await observe(()=>application.evaluate(readQueryResultColumnsAudit));expect(audit).toEqual({queries:1,exports:['csv','json'],pending:0,revision:0});expect(pageErrors).toEqual([]);
   await life.finish(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{})),()=>closeQueryResultColumnsObserver(current.observer! as mysql.Connection&{connection?:unknown},current.native,current.stream,()=>life.check(true),native=>closeMysqlConnection(native,true,false,life.remaining(1000))));
  }catch(reason){life.preserve();throw reason;}finally{life.endBody();}
 });
}
