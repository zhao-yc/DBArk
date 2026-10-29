import { clickSidebarAction } from './sidebar-menu';
import {test as baseTest,expect,type TestInfo,type Page} from '@playwright/test';
import type {RowDataPacket} from 'mysql2/promise';
import {columnPatchZh as text} from '../../src/renderer/locales/columnPatches.zh-CN';
type Desktop=typeof import('./desktop-fixture');type Live=typeof import('./live-helpers');
// 新切片独立关闭；收集先短路，不读取凭据、不加载真实桌面或数据库模块。
const listing=process.argv.includes('--list'),armed=!listing&&process.env.DBARK_COLUMN_ADD_ON_UPDATE_UI==='1'&&process.env.DBARK_INTEGRATION_ENABLED==='1';
if(armed&&(process.env.DBARK_TEST_HOST!=='192.168.31.200'||!['13357','13380','13384','13310','13311','13484'].includes(process.env.DBARK_TEST_PORT??'')))throw Error('新增自动时间验收须ROOT明确分配200单一目标');
const desktop:Desktop|undefined=armed?require('./desktop-fixture'):undefined,test=(desktop?.test??baseTest) as typeof baseTest;
// 新写入专项独立开启所属实例退出证明；失败或取消不能清理未确认的隔离现场。
if(desktop)desktop.test.use({preserveOnUnconfirmedExit:true});
test.skip(!armed,'默认关闭：须ROOT明确分配新增时间字段的真实GUI及六组合单一目标');test.use({trace:'off',screenshot:'off',video:'off'});test.setTimeout(180000);test.describe.configure({retries:0});
/** 本例页面只由显式owner提供，旧TestInfo及每次页面获取均须核归属。 */
interface CaseOwner{page:Page;assertCurrent():void;}
const page=(owner:CaseOwner)=>{owner.assertCurrent();return owner.page;},dialog=(owner:CaseOwner)=>page(owner).getByRole('dialog',{name:text.title,exact:true});

/** 实际字段表单分组定位，类型/默认值和自动更新时间精度分别输入，不注入内部状态。 */
async function fill(owner:CaseOwner,type:'DATETIME'|'TIMESTAMP',precision:number){
 await dialog(owner).getByRole('button',{name:text.add,exact:true}).click();owner.assertCurrent();await dialog(owner).getByRole('textbox',{name:text.name,exact:true}).fill('created_at');owner.assertCurrent();
 const typeFields=dialog(owner).locator('.column-patch-field').filter({has:page(owner).getByRole('checkbox',{name:text.modify+' '+text.type,exact:true})});await typeFields.getByRole('combobox').first().selectOption('temporal');owner.assertCurrent();await typeFields.getByRole('combobox').nth(1).selectOption(type);owner.assertCurrent();await typeFields.getByRole('spinbutton').fill(String(precision));owner.assertCurrent();
 const auto=dialog(owner).getByRole('checkbox',{name:text.modify+' '+text.onUpdate,exact:true});await expect(auto).toBeDisabled();owner.assertCurrent();
 if(type==='TIMESTAMP'){await dialog(owner).getByRole('combobox',{name:text.nullable,exact:true}).selectOption('false');owner.assertCurrent();await dialog(owner).getByRole('combobox',{name:text.default,exact:true}).selectOption('expression');owner.assertCurrent();const defaults=dialog(owner).locator('.column-patch-field').filter({has:page(owner).getByRole('checkbox',{name:text.modify+' '+text.default,exact:true})});await defaults.getByRole('spinbutton').fill(String(precision));owner.assertCurrent();}
 else {await dialog(owner).getByRole('combobox',{name:text.default,exact:true}).selectOption('null');owner.assertCurrent();}
 await auto.check();owner.assertCurrent();await dialog(owner).getByRole('combobox',{name:text.onUpdate,exact:true}).selectOption('expression');owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.rowSave,exact:true}).click();owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.edit,exact:true}).click();owner.assertCurrent();await expect(auto).toBeChecked();owner.assertCurrent();await expect(dialog(owner).getByRole('combobox',{name:text.onUpdate,exact:true})).toHaveValue('expression');owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.rowSave,exact:true}).click();owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.preview,exact:true}).click();owner.assertCurrent();await expect(dialog(owner).getByRole('heading',{name:text.fixedSql,exact:true})).toBeVisible();owner.assertCurrent();await expect(dialog(owner).locator('.monaco-editor')).toContainText(/ADD\s+COLUMN/);owner.assertCurrent();await expect(dialog(owner).locator('.monaco-editor')).toContainText(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/);owner.assertCurrent();
}

for(const[type,precision]of [['DATETIME',0],['DATETIME',6],['TIMESTAMP',6]] as const)test(type+'('+precision+')真实新增字段草稿、预览、单次ADD及自动时间数据行为',async({},info:TestInfo)=>{
 if(!desktop)throw Error('未取得本例窗口');
 const captured=desktop.ownedDesktopResources(info);
 const owner:CaseOwner={page:captured.page,assertCurrent:()=>{desktop.ownedDesktopResources(info);}};
 const live:Live=await import('./live-helpers');owner.assertCurrent();await live.isolatedDatabase(async c=>{
  owner.assertCurrent();
  /** 观察请求未知或失去归属即保留；只调用一次本例observer，不借退出收尾取消它。 */
  const observe = async <T>(request: () => Promise<T>): Promise<T> => {
    owner.assertCurrent();
    try { const value = await request(); owner.assertCurrent(); return value; }
    catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
  };
  const target='`'+c.database.replaceAll('`','``')+'`.`add_auto_time`';await observe(() => c.observer.query(`CREATE TABLE ${target}(id INT PRIMARY KEY,note VARCHAR(20),amount DECIMAL(30,6) DEFAULT 12345678901234567890.123456,empty_text VARCHAR(10) DEFAULT '',text_null VARCHAR(10) DEFAULT 'NULL') ENGINE=InnoDB`));owner.assertCurrent();await observe(() => c.observer.query(`INSERT INTO ${target}(id,note) VALUES(1,'原值')`));owner.assertCurrent();
  const read=async()=>{owner.assertCurrent();const[rows]=await observe(() => c.observer.query<RowDataPacket[]>(`SELECT id,note,CAST(amount AS CHAR) AS amount,empty_text,text_null FROM ${target} ORDER BY id`));owner.assertCurrent();return rows;},ddl=async()=>{owner.assertCurrent();const[rows]=await observe(() => c.observer.query<RowDataPacket[]>('SHOW CREATE TABLE '+target));owner.assertCurrent();return String(rows[0]['Create Table']);};const original=await ddl(),data=await read();owner.assertCurrent();
  const connection=page(owner).locator('.connection-node').filter({has:page(owner).locator('.connection-row').getByText(c.connectionName,{exact:true})});await connection.locator('.connection-row').hover();owner.assertCurrent();await clickSidebarAction(connection, {name:'刷新连接',exact:true});owner.assertCurrent();await connection.locator('.database-row').getByRole('button',{name:c.database,exact:true}).click();owner.assertCurrent();await connection.locator('.object-row').getByText('add_auto_time',{exact:true}).click();owner.assertCurrent();await expect(page(owner).locator('.table-tab:visible .loading-overlay')).toHaveCount(0);owner.assertCurrent();await page(owner).locator('.table-tab:visible').getByRole('button',{name:text.title,exact:true}).click();owner.assertCurrent();await fill(owner,type,precision);owner.assertCurrent();
  expect(await ddl()).toBe(original);owner.assertCurrent();expect(await read()).toEqual(data);owner.assertCurrent();await expect(dialog(owner).getByRole('button',{name:text.apply,exact:true})).toBeDisabled();owner.assertCurrent();for(const label of [text.ackImplicit,text.ackWindow]){await dialog(owner).getByRole('checkbox',{name:label,exact:true}).check();owner.assertCurrent();}await dialog(owner).getByRole('button',{name:text.apply,exact:true}).click();owner.assertCurrent();await expect(dialog(owner).getByRole('status')).toHaveText(text.succeeded);owner.assertCurrent();await expect(dialog(owner).getByRole('button',{name:text.apply,exact:true})).toBeDisabled();owner.assertCurrent();expect(await read()).toEqual(data);owner.assertCurrent();expect(await ddl()).toMatch(/ON UPDATE current_timestamp/i);owner.assertCurrent();
  await observe(() => c.observer.query(`INSERT INTO ${target}(id,note) VALUES(2,'新行')`));owner.assertCurrent();await observe(() => c.observer.query(`UPDATE ${target} SET created_at='2001-01-01 00:00:00' WHERE id=2`));owner.assertCurrent();const[before]=await observe(() => c.observer.query<RowDataPacket[]>(`SELECT CAST(created_at AS CHAR) AS value FROM ${target} WHERE id=2`));owner.assertCurrent();await observe(() => c.observer.query(`UPDATE ${target} SET note='触发自动更新' WHERE id=2`));owner.assertCurrent();const[after]=await observe(() => c.observer.query<RowDataPacket[]>(`SELECT CAST(created_at AS CHAR) AS value FROM ${target} WHERE id=2`));owner.assertCurrent();expect(after[0].value).not.toBe(before[0].value);
  const tasks=await page(owner).evaluate(()=>window.dbark.invoke('tasks.list',{}));owner.assertCurrent();expect(tasks.filter(task=>task.kind==='schema.columns.apply')).toHaveLength(1);await dialog(owner).getByRole('button',{name:text.close,exact:true}).click();owner.assertCurrent();
 },info);owner.assertCurrent();
});
