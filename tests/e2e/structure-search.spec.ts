import {test,expect,page,pageErrors} from './desktop-fixture';
import{enabled,isolatedDatabase,openDatabaseQuery,executeSql,modifier,readRenderedResult}from'./live-helpers';
import type {RowDataPacket} from 'mysql2/promise';

test.use({trace:'off'});
const search=()=>page.getByRole('dialog',{name:'全库搜索：结构名称',exact:true});
/** 所有搜索入口来自实际工具栏或平台快捷键，不替代搜索IPC和真实目录。 */
async function openSearch(database?:string){await page.locator('.app-commandbar').getByRole('button',{name:'全库搜索',exact:true}).click();await expect(search()).toBeVisible();if(database)await search().getByLabel('数据库范围（每行一个）',{exact:true}).fill(database);}
/** 等待原按钮重新可用即完整批次收尾，不用固定sleep或自动重跑搜索。 */
async function searchFor(value:string,mode='contains'){await search().getByLabel('搜索文字',{exact:true}).fill(value);await search().getByLabel('匹配方式',{exact:true}).selectOption(mode);await search().getByRole('button',{name:'开始搜索',exact:true}).click();await expect(search().getByRole('button',{name:'开始搜索',exact:true})).toBeEnabled({timeout:20000});await expect(search().locator('.error-box')).toHaveCount(0);}

test('离线工具栏和快捷键可打开，非法范围在访问数据库前拒绝且模态不穿透',async({},info)=>{
  await page.evaluate(()=>window.dbark.invoke('connections.save',{id:'',name:'离线搜索连接',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'}));await page.reload();await expect(page.locator('.app-statusbar')).toBeVisible();
  await page.keyboard.press(`${modifier}+Shift+F`);await expect(search()).toBeVisible();await search().getByLabel('数据库范围（每行一个）',{exact:true}).fill('离线库');
  await search().getByRole('button',{name:'开始搜索',exact:true}).click();await expect(search().locator('.error-box')).toContainText('请检查搜索条件');
  await page.keyboard.press(`${modifier}+t`);await expect(page.getByRole('dialog')).toHaveCount(1);
  const tasks=await page.evaluate(()=>window.dbark.invoke('tasks.list',{}));expect(tasks.filter(task=>task.kind.startsWith('search.'))).toEqual([]);
  await page.screenshot({path:info.outputPath('structure-search-offline-validation.png')});await search().getByRole('button',{name:'关闭',exact:true}).click();await expect(search()).toHaveCount(0);expect(pageErrors).toEqual([]);
});

test.describe('200实库：结构名称搜索入口',()=>{
  test.skip(!enabled,'需明确启用200隔离实库环境');
  test('有界续页和虚拟表格，四模式、上限、正则失败恢复及打开当前定义',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
      const columns=Array.from({length:65},(_,i)=>'`needle_'+String(i).padStart(3,'0')+'` INT').join(',');
      await observer.query('CREATE TABLE `'+database+'`.needle_table(id INT PRIMARY KEY,`a%_!` INT,'+columns+')');
      await openSearch(database);await searchFor('needle_');await expect(search().getByRole('status')).toContainText('命中 50');await expect(search().getByRole('button',{name:'继续搜索',exact:true})).toBeEnabled();
      await search().getByRole('button',{name:'继续搜索',exact:true}).click();await expect(search().getByRole('button',{name:'开始搜索',exact:true})).toBeEnabled();await expect(search().getByRole('status')).toContainText('命中 66');await expect(search().getByRole('status')).toContainText('已完成');expect(await search().locator('.rdg-row').count()).toBeLessThan(40);
      await searchFor('a%_!','contains');await expect(search().getByRole('status')).toContainText('命中 1');await expect(search().locator('.rdg-row')).toContainText('a%_!');
      await searchFor('NEEDLE_TABLE','whole');await expect(search().getByRole('status')).toContainText('命中 1');await search().getByLabel('区分大小写',{exact:true}).check();await searchFor('NEEDLE_TABLE','whole');await expect(search().getByRole('status')).toContainText('命中 0');await search().getByLabel('区分大小写',{exact:true}).uncheck();
      await searchFor('needle_00','prefix');await expect(search().getByRole('status')).toContainText('命中 10');await search().getByLabel('命中上限',{exact:true}).fill('3');await searchFor('needle_','prefix');await expect(search().getByRole('status')).toContainText('已达到命中上限');await expect(search().getByRole('button',{name:'继续搜索',exact:true})).toBeDisabled();
      await searchFor('[','regexp');await expect(search().locator('.database-search-failures')).toBeVisible();await expect(search().getByRole('status')).toContainText('已因错误停止');
      await search().getByLabel('命中上限',{exact:true}).fill('200');await searchFor('^needle_table$','regexp');await expect(search().getByRole('status')).toContainText('命中 1');await expect(search().locator('.database-search-failures')).toHaveCount(0);await page.screenshot({path:info.outputPath('structure-search-actual-results.png')});
      await search().locator('.rdg-row').dblclick();await expect(search()).toHaveCount(0);const definition=page.getByRole('dialog');await expect(definition.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE',{timeout:20000});await expect(definition.locator('.monaco-editor .view-lines')).toContainText('needle_table');await expect(definition.locator('.error-box')).toHaveCount(0);await expect(definition).toContainText('当前定义只读查看');await expect(definition.getByRole('button',{name:'执行 SQL',exact:true})).toHaveCount(0);await definition.getByRole('button',{name:'取消',exact:true}).click();
      const [rows]=await observer.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM `'+database+'`.needle_table');expect(Number(rows[0].n)).toBe(0);
      const tasks=await page.evaluate(()=>window.dbark.invoke('tasks.list',{}));expect(tasks.filter(task=>task.kind.startsWith('search.')).every(task=>!task.message.includes('needle')&&!task.message.includes(database))).toBe(true);
    },info);
  });
  test('搜索和关闭保持原查询正文、结果、事务与会话，未提交写入可真实回滚',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
      await observer.query('CREATE TABLE `'+database+'`.subject(id INT PRIMARY KEY,note TEXT) ENGINE=InnoDB');await observer.query('INSERT INTO `'+database+'`.subject VALUES(1,\'服务器原值\')');
      await openDatabaseQuery(database);await executeSql("START TRANSACTION;UPDATE subject SET note='原事务未提交' WHERE id=1;SELECT CONNECTION_ID() AS session_id,note FROM subject");
      await executeSql('SELECT CONNECTION_ID() AS session_id,note FROM subject');
      const query=page.locator('.query-tab:visible');
      // 查询完成后的上下文会独立确认并防抖落盘；先等原操作真正稳定，再比较搜索前后完整布局。
      await expect(query.getByLabel('当前查询默认库',{exact:true})).toContainText(database);
      await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.databaseContext;})).toEqual({state:'known',database});
      const before=await readRenderedResult(text=>text.includes('session_id')&&text.includes('原事务未提交')&&text.match(/\b\d+\b/g)?.length===1);await expect.poll(()=>page.evaluate(async()=>{const value=await window.dbark.invoke('settings.get',{});return value.tabs.find(tab=>tab.id===value.activeTabId)?.sql;})).toContain('SELECT CONNECTION_ID() AS session_id,note FROM subject');const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));
      await openSearch();await expect(search().getByLabel('数据库范围（每行一个）',{exact:true})).toHaveValue(database);await searchFor('subject','whole');await search().getByRole('button',{name:'关闭',exact:true}).click();
      await expect.poll(()=>query.locator('.result-body').innerText()).toBe(before);expect((await page.evaluate(()=>window.dbark.invoke('settings.get',{}))).tabs).toEqual(settings.tabs);
      const [uncommitted]=await observer.query<RowDataPacket[]>('SELECT note FROM `'+database+'`.subject');expect(uncommitted[0].note).toBe('服务器原值');
      await executeSql('SELECT CONNECTION_ID() AS session_id,note FROM subject');await expect.poll(()=>query.locator('.result-body').innerText()).toBe(before);await page.screenshot({path:info.outputPath('structure-search-original-transaction.png')});await executeSql('ROLLBACK');
      const [after]=await observer.query<RowDataPacket[]>('SELECT note FROM `'+database+'`.subject');expect(after[0].note).toBe('服务器原值');
    },info);
  });
  test('打开命中的当前定义后返回，原表格草稿仍在且服务器未被修改',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database,connectionName})=>{
      await observer.query('CREATE TABLE `'+database+'`.subject(id INT PRIMARY KEY,note TEXT) ENGINE=InnoDB');await observer.query('INSERT INTO `'+database+'`.subject VALUES(1,\'服务器原值\')');
      const connection=page.locator('.connection-node').filter({has:page.locator('.connection-row').getByText(connectionName,{exact:true})}),row=connection.locator('.connection-row');
      await row.getByRole('button',{name:connectionName,exact:true}).focus();await row.getByRole('button',{name:'刷新连接',exact:true}).click();const databaseRow=connection.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})});await databaseRow.getByRole('button',{name:database,exact:true}).click();await connection.locator('.object-row').getByText('subject',{exact:true}).click();
      const table=page.locator('.table-tab:visible');await expect(table.locator('.loading-overlay')).toHaveCount(0);await expect(table.locator('.results-grid')).toBeVisible();
      const index=await table.getByRole('columnheader',{name:/^note/}).getAttribute('aria-colindex'),cell=table.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="'+index+'"]');await cell.dblclick();const editor=table.getByRole('textbox',{name:'编辑 note',exact:true});await editor.fill('未提交表格草稿');await editor.press('Enter');await expect(cell).toHaveText('未提交表格草稿');
      await openSearch();await expect(search().getByLabel('数据库范围（每行一个）',{exact:true})).toHaveValue(database);await searchFor('subject','whole');await search().locator('.rdg-row').click();await search().getByRole('button',{name:'打开当前定义',exact:true}).click();const definition=page.getByRole('dialog');await expect(definition.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE',{timeout:20000});await expect(definition).toContainText('当前定义只读查看');await expect(definition.getByRole('button',{name:'执行 SQL',exact:true})).toHaveCount(0);await definition.getByRole('button',{name:'取消',exact:true}).click();
      await expect(cell).toHaveText('未提交表格草稿');const [rows]=await observer.query<RowDataPacket[]>('SELECT note FROM `'+database+'`.subject');expect(rows[0].note).toBe('服务器原值');await page.screenshot({path:info.outputPath('structure-search-table-draft-retained.png')});
    },info);
  });
});
