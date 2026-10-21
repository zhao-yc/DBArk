import type {Locator} from '@playwright/test';
import {test,expect,ownedDesktopResources,retainOwnedDesktopResources,confirmOwnedDesktopExit,pageErrors} from './desktop-fixture';
import {insertRowAliasUiTarget} from './sql-completion-insert-row-alias-policy';

/** 专属入口：Root拥有数据库fixture；此用例只连接、编辑和接受补全，不执行正文或清理数据库。 */
export function registerInsertRowAliasUiTest(){
  insertRowAliasUiTarget(process.env);
  test.use({preserveOnUnconfirmedExit:true,trace:'off',screenshot:'off',video:'off'});
  test.describe.configure({timeout:120000,retries:0});
  test('UPSERT VALUES与SET新行别名：真实建议、接受及撤销重做，任务历史保持',async({trace,screenshot,video},info)=>{
    const captured=ownedDesktopResources(info);let exited=false;
    /** 每次异步交界核对捕获的同一应用和页面；失效即粘性保留，不切回全局句柄。 */
    const assertOwner=()=>{try{const now=ownedDesktopResources(info);if(now.application!==captured.application||now.page!==captured.page||!exited&&now.closed)throw Error('UPSERT本例桌面归属或存活状态失效');}catch(reason){retainOwnedDesktopResources(info);throw reason;}};
    const page=()=>{assertOwner();return captured.page;};
    /** 所有表单下拉均按角色及标签前缀定位，并核对唯一匹配和真实 value。 */
    const select=async(root:Locator,prefix:RegExp,value:string)=>{assertOwner();const field=root.getByRole('combobox',{name:prefix});await expect(field).toHaveCount(1);assertOwner();await field.selectOption(value);assertOwner();await expect(field).toHaveValue(value);assertOwner();};
    /** 只读当前草稿和上下文，返回布尔以免断言失败输出完整工作区。 */
    const savedSql=async(expected:string,connectionId:string,database:string)=>{assertOwner();const matches=await page().evaluate(async input=>{const settings=await window.dbark.invoke('settings.get',{}),tab=settings.tabs.find(item=>item.id===settings.activeTabId);return tab?.kind==='query'&&tab.connectionId===input.connectionId&&tab.database===input.database&&tab.sql?.replaceAll('\r\n','\n')===input.expected;},{expected,connectionId,database});assertOwner();return matches;};
    /** 仅比较任务身份／状态和历史编号；不返回SQL、错误正文或整个配置对象。 */
    const records=async()=>{assertOwner();const value=await page().evaluate(async()=>{const tasks=await window.dbark.invoke('tasks.list',{}),history=await window.dbark.invoke('history.list',{});return{tasks:tasks.map(({id,kind,status})=>({id,kind,status})).sort((a,b)=>a.id.localeCompare(b.id)),history:history.map(row=>row.id).sort(),pending:tasks.filter(row=>row.status==='running').length};});assertOwner();return value;};
    try{
      assertOwner();
      if(trace!=='off'||screenshot!=='off'||video!=='off')throw Error('本片拒绝采集轨迹、截图或视频的实际覆盖参数');
      const target=insertRowAliasUiTarget(process.env),name='UPSERT只读界面 '+target.database;
      await page().locator('.app-commandbar').getByRole('button',{name:'新建连接',exact:true}).click();assertOwner();
      const form=page().getByRole('dialog',{name:'新建连接',exact:true});
      await form.getByLabel('连接名称',{exact:true}).fill(name);assertOwner();
      await select(form,/^数据库类型/,'mysql');assertOwner();
      await form.getByLabel('主机地址',{exact:true}).fill(target.host);assertOwner();
      await form.getByLabel('端口',{exact:true}).fill('13384');assertOwner();
      await form.getByLabel('用户名',{exact:true}).fill(target.user);assertOwner();
      await form.getByLabel('数据库密码',{exact:true}).fill(target.password);assertOwner();
      await form.getByLabel('默认数据库（可选）',{exact:true}).fill(target.database);assertOwner();
      const remember=form.getByRole('checkbox',{name:'安全保存密码',exact:true});await remember.uncheck();assertOwner();await expect(remember).not.toBeChecked();assertOwner();
      await form.getByRole('button',{name:'测试连接',exact:true}).click();assertOwner();
      await expect(form.locator('.success-box')).toContainText(/MySQL.*8\.4\.11(?:\D|$)/,{timeout:20000});assertOwner();
      await form.getByRole('button',{name:'保存连接',exact:true}).click();assertOwner();await expect(form).toBeHidden();assertOwner();
      const saved=await page().evaluate(async input=>{const profiles=(await window.dbark.invoke('connections.list',{})).filter(item=>item.name===input.name);const profile=profiles[0];return{count:profiles.length,id:profiles.length===1?profile.id:undefined,matches:profiles.length===1&&profile.host===input.host&&profile.port===13384&&profile.dialect==='mysql'&&profile.database===input.database&&profile.rememberPassword===false&&!Object.hasOwn(profile,'password')};},{name,host:target.host,database:target.database});assertOwner();
      expect(saved.count).toBe(1);expect(saved.matches).toBe(true);if(!saved.id)throw Error('本例连接概要不唯一');const connectionId=saved.id;
      await page().locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();assertOwner();
      const dialog=page().getByRole('dialog',{name:'新建查询',exact:true});await select(dialog,/^数据库连接/,connectionId);assertOwner();
      const databaseField=dialog.getByRole('combobox',{name:/^默认数据库（可选）/});await expect(databaseField).toHaveCount(1);assertOwner();await databaseField.fill(target.database);assertOwner();await expect(databaseField).toHaveValue(target.database);assertOwner();
      // 新查询原流程负责打开连接和缓存实际版本；等待真实目录完成，不主动调用执行接口。
      await expect(databaseField).toHaveAttribute('placeholder','选择或输入数据库名称',{timeout:20000});assertOwner();await expect(dialog.locator('.error-box')).toHaveCount(0);assertOwner();
      await dialog.getByRole('button',{name:'打开查询',exact:true}).click();assertOwner();await expect(dialog).toBeHidden();assertOwner();
      const query=page().locator('.query-tab:visible'),editor=query.locator('.monaco-editor').getByRole('textbox');await expect(editor).toHaveCount(1);assertOwner();await expect(editor).toBeEditable();assertOwner();
      const modifier=process.platform==='darwin'?'Meta':'Control',table='`'+target.database+'`.`subject`';
      const scenarios=[
        {name:'VALUES原场景',prefix:'INSERT INTO '+table+"(id,note) VALUES(1,'仅编辑不执行') AS incoming ON DUPLICATE KEY UPDATE note=incoming"},
        {name:'SET普通赋值',prefix:'INSERT INTO '+table+" SET id=1,note='仅编辑不执行' AS incoming ON DUPLICATE KEY UPDATE note=incoming"},
        {name:'SET嵌套函数',prefix:'INSERT INTO '+table+" SET id=1,note=COALESCE(CAST('仅编辑不执行' AS CHAR),'备用') AS incoming ON DUPLICATE KEY UPDATE note=incoming"},
      ];
      const before=await records();expect(before.pending).toBe(0);
      for(const scenario of scenarios){
        const prefix=scenario.prefix,source=prefix+'.',expected=source+'`note`';
        await editor.focus();assertOwner();await page().keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');assertOwner();await page().keyboard.insertText(prefix);assertOwner();
        await expect.poll(()=>savedSql(prefix,connectionId,target.database),{timeout:5000}).toBe(true);assertOwner();
        // insertText和点号都是实际输入；点号触发产品 provider，不设置模型/光标，不读写剪贴板。
        await page().keyboard.type('.');assertOwner();
        const widget=page().locator('.suggest-widget.visible');await expect(widget).toHaveCount(1,{timeout:13000});assertOwner();
        const labels=widget.locator('.monaco-list-row .label-name');await expect.poll(async()=>{assertOwner();const names=await labels.allTextContents();assertOwner();return names.map(value=>value.trim()).sort();},{timeout:13000}).toEqual(['created_at','id','note']);assertOwner();
        for(let step=0;step<3;step++){const label=await widget.locator('.monaco-list-row.focused .label-name').textContent();assertOwner();if(label==='note')break;await page().keyboard.press('ArrowDown');assertOwner();}
        await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText('note');assertOwner();await page().keyboard.press('Enter');assertOwner();
        await expect(widget).toHaveCount(0);assertOwner();await expect.poll(()=>savedSql(expected,connectionId,target.database),{timeout:5000}).toBe(true);assertOwner();
        await page().keyboard.press(modifier+'+Z');assertOwner();await expect.poll(()=>savedSql(source,connectionId,target.database),{timeout:5000}).toBe(true);assertOwner();
        await page().keyboard.press(modifier+'+Shift+Z');assertOwner();await expect.poll(()=>savedSql(expected,connectionId,target.database),{timeout:5000}).toBe(true);assertOwner();
        expect(await records()).toEqual(before);
        await info.attach('UPSERT补全-'+scenario.name,{body:Buffer.from(JSON.stringify({scenario:scenario.name,columns:['created_at','id','note'],accepted:true,undo:true,redo:true,taskAndHistoryUnchanged:true})),contentType:'application/json'});assertOwner();
        await editor.press('Escape');assertOwner();
      }
      await expect(query.getByRole('button',{name:'停止',exact:true})).toBeDisabled();assertOwner();expect(pageErrors).toEqual([]);
      // 建议及插入只证明UI Promise交付，不冒充全部元数据任务或服务器线程终态。
      await confirmOwnedDesktopExit(info);exited=true;assertOwner();expect(ownedDesktopResources(info).closed).toBe(true);
    }catch(reason){retainOwnedDesktopResources(info);throw reason;}
  });
}
