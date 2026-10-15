import {test,expect,page,pageErrors} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,executeSql,modifier} from './live-helpers';
import type {RowDataPacket} from 'mysql2/promise';

test.use({trace:'off'});
const search=()=>page.getByRole('dialog',{name:'全库搜索：数据',exact:true});
/** 模式切换走真实旧入口的收尾，不绕过工作台、范围目录或搜索IPC。 */
async function openSearch(){await page.locator('.app-commandbar').getByRole('button',{name:'全库搜索',exact:true}).click();await page.getByRole('dialog',{name:'全库搜索：结构名称',exact:true}).getByRole('button',{name:'搜索数据',exact:true}).click();await expect(search()).toBeVisible();}
/** 等目录真实短任务收尾后再操作，选定的库/表仍按服务器实际名字匹配。 */
async function directoryIdle(){await expect(search().getByRole('status')).not.toContainText('正在读取范围',{timeout:20000});}
async function chooseTable(database:string,table:string,prefix=''){
 await search().getByLabel('数据库名称前缀',{exact:true}).fill(database);await search().getByRole('button',{name:'读取数据库',exact:true}).click();await directoryIdle();await search().getByLabel('数据库',{exact:true}).selectOption(database);
 await search().getByLabel('对象名称前缀',{exact:true}).fill(table);await search().getByRole('button',{name:'读取对象',exact:true}).click();await directoryIdle();await search().getByLabel('表或视图',{exact:true}).selectOption(table);
 await search().getByLabel('字段名称前缀',{exact:true}).fill(prefix);await search().getByRole('button',{name:'读取字段',exact:true}).click();await directoryIdle();
}
/** 通过可见按钮运行并等确认循环及释放全部完成，不用固定延时假装完成。 */
async function run(value:string,mode='contains'){
 await search().getByLabel('搜索方式',{exact:true}).selectOption(mode);if(mode!=='null')await search().getByLabel('数据搜索文字',{exact:true}).fill(value);
 await search().getByRole('button',{name:'开始数据搜索',exact:true}).click();await expect(search().getByRole('button',{name:'开始数据搜索',exact:true})).toBeEnabled({timeout:30000});await expect(search().locator('.error-box')).toHaveCount(0);
}

test('离线可从工具栏与平台快捷键切换数据模式，无范围不发查询且模态不穿透',async({},info)=>{
 await page.evaluate(()=>window.dbark.invoke('connections.save',{id:'',name:'离线数据搜索',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'}));await page.reload();await expect(page.locator('.app-statusbar')).toBeVisible();await page.keyboard.press(`${modifier}+Shift+F`);await page.getByRole('dialog',{name:'全库搜索：结构名称',exact:true}).getByRole('button',{name:'搜索数据',exact:true}).click();
 await expect(search()).toBeVisible();await expect(search().getByRole('button',{name:'开始数据搜索',exact:true})).toBeDisabled();await page.keyboard.press(`${modifier}+t`);await expect(page.getByRole('dialog')).toHaveCount(1);expect((await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).filter(task=>task.kind.startsWith('search.'))).toEqual([]);await page.screenshot({path:info.outputPath('data-search-offline.png')});await search().getByRole('button',{name:'搜索结构名称',exact:true}).click();await expect(page.getByRole('dialog',{name:'全库搜索：结构名称',exact:true})).toBeVisible();await page.keyboard.press('Escape');expect(pageErrors).toEqual([]);
});

test.describe('200真实数据库：数据搜索界面',()=>{
 test.skip(!enabled,'未显式启用200隔离数据库');
 test('205字段跨页选择、126处命中分批确认，大字段尾部命中并打开真实所属表',async({},info)=>{
  test.setTimeout(150000);await isolatedDatabase(async({observer,database})=>{
   await observer.query('CREATE TABLE `'+database+'`.wide(id BIGINT PRIMARY KEY,'+Array.from({length:205},(_,index)=>'`c'+String(index).padStart(3,'0')+'` '+(index===0?'LONGTEXT':index===204?'TEXT':'INT')).join(',')+') ENGINE=InnoDB');
   for(let index=0;index<125;index++)await observer.query('INSERT INTO `'+database+'`.wide(id,c000,c204) VALUES(?,?,?)',[(9007199254740993n+BigInt(index)).toString(),index===0?'开头'+'中'.repeat(200000)+'needle_tail':null,'needle_tail']);
   await openSearch();await chooseTable(database,'wide','c');await search().getByRole('button',{name:'选中本页字段',exact:true}).click();const fieldPanel=search().locator('.data-search-catalogue section').nth(2);
   await fieldPanel.getByRole('button',{name:'下一页',exact:true}).click();await directoryIdle();await search().getByRole('button',{name:'选中本页字段',exact:true}).click();await fieldPanel.getByRole('button',{name:'下一页',exact:true}).click();await directoryIdle();await search().getByRole('button',{name:'选中本页字段',exact:true}).click();await expect(search()).toContainText('已选 1 个对象、205 个字段');await expect(search().getByLabel('搜索字段 c204',{exact:true})).toBeChecked();
   await run('needle_tail');await expect(search().getByRole('status')).toContainText('命中 126');await expect(search().getByRole('status')).toContainText('字段块 13/13');expect(await search().locator('.rdg-row').count()).toBeLessThan(126);await expect(search().locator('.rdg-row').filter({hasText:'c000'})).not.toContainText('needle_tail');const grid=search().locator('.rdg');await grid.scrollIntoViewIfNeeded();expect((await grid.boundingBox())!.height).toBeGreaterThanOrEqual(200);await page.screenshot({path:info.outputPath('data-search-wide-actual.png')});
   await search().getByLabel('命中上限',{exact:true}).fill('1');await run('needle_tail');await expect(search().getByRole('status')).toContainText('命中 1');await expect(search().getByRole('status')).toContainText('未完成范围');await search().getByLabel('命中上限',{exact:true}).fill('200');await run('needle_tail');
   const row=search().locator('.rdg-row').filter({hasText:'c204'}).first();await row.click();await search().getByRole('button',{name:'打开所属表',exact:true}).click();await expect(search()).toHaveCount(0);await expect(page.locator('.table-tab:visible .results-grid')).toBeVisible({timeout:20000});
   // 工作台先更新可见标签，再防抖保存布局；读取公开持久化接口时等待该真实边界。
   await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId);})).toMatchObject({kind:'table',database,table:'wide'});
   const tasks=await page.evaluate(()=>window.dbark.invoke('tasks.list',{}));expect(tasks.filter(task=>task.kind==='search.catalogue')).toEqual([]);expect(tasks.filter(task=>task.kind.startsWith('search.')).every(task=>!task.message.includes('needle_tail')&&!task.message.includes(database))).toBe(true);
  },info);
 });
 test('NULL与空串不混淆、二进制明确HEX，搜索不扰动原查询事务和结果',async({},info)=>{
  test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
   await observer.query('CREATE TABLE `'+database+'`.subject(id INT PRIMARY KEY,note TEXT,optional_text TEXT,empty_text TEXT,payload BLOB) ENGINE=InnoDB');await observer.query('INSERT INTO `'+database+'`.subject VALUES(1,?,NULL,?,?)',['服务器原值','',Buffer.from([0,65])]);await openDatabaseQuery(database);await executeSql("START TRANSACTION;UPDATE subject SET note='事务未提交' WHERE id=1;SELECT CONNECTION_ID(),note FROM subject");await executeSql('SELECT CONNECTION_ID(),note FROM subject');const query=page.locator('.query-tab:visible'),before=await query.locator('.result-body').innerText();
   await openSearch();await chooseTable(database,'subject');await search().getByLabel('搜索字段 payload',{exact:true}).check();await expect(search().getByLabel('字段表示 payload',{exact:true})).toHaveValue('hex');await run('0041','whole');await expect(search().getByRole('status')).toContainText('命中 1');await expect(search().locator('.rdg-row')).toContainText('0041');await search().getByLabel('搜索字段 optional_text',{exact:true}).check();await search().getByLabel('搜索字段 empty_text',{exact:true}).check();await run('','null');await expect(search().getByRole('status')).toContainText('命中 1');await expect(search().locator('.rdg-row')).toContainText('optional_text');await page.screenshot({path:info.outputPath('data-search-null-hex.png')});await search().getByRole('button',{name:'关闭',exact:true}).click();
   expect(await query.locator('.result-body').innerText()).toBe(before);const[rows]=await observer.query<RowDataPacket[]>('SELECT note FROM `'+database+'`.subject');expect(rows[0].note).toBe('服务器原值');await executeSql('SELECT CONNECTION_ID(),note FROM subject');expect(await query.locator('.result-body').innerText()).toBe(before);await executeSql('ROLLBACK');
  },info);
 });
 test('视图必须明确允许，真实长搜索取消后释放该服务器线程且可重新开始',async({},info)=>{
  test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
   await observer.query('CREATE TABLE `'+database+'`.subject(id INT PRIMARY KEY,note TEXT) ENGINE=InnoDB');for(let index=0;index<125;index++)await observer.query('INSERT INTO `'+database+'`.subject VALUES(?,?)',[index,'needle']);await observer.query('CREATE VIEW `'+database+'`.slow_view AS SELECT CONCAT(note,IF(SLEEP(0.1)=0,\'\',\'\')) AS note FROM `'+database+'`.subject');
   await openSearch();await chooseTable(database,'slow_view');await search().getByLabel('搜索字段 note',{exact:true}).check();await search().getByLabel('数据搜索文字',{exact:true}).fill('needle');await search().getByRole('button',{name:'开始数据搜索',exact:true}).click();await expect(search().locator('.error-box')).toContainText('请检查范围');expect((await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).filter(task=>task.kind==='search.dataStart')).toEqual([]);
   await search().getByLabel('允许搜索已选视图（视图处理可能执行函数）',{exact:true}).check();await search().getByRole('button',{name:'开始数据搜索',exact:true}).click();let ids:number[]=[];await expect.poll(async()=>{const[rows]=await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO IS NOT NULL AND LOWER(STATE) LIKE ? AND LOCATE(?,INFO)>0',['%sleep%','FROM `'+database+'`.`slow_view` WHERE']);ids=rows.map(row=>Number(row.ID));return ids.length;},{timeout:15000}).toBeGreaterThan(0);
   await search().getByRole('button',{name:'取消搜索',exact:true}).click();await expect(search().getByRole('button',{name:'开始数据搜索',exact:true})).toBeEnabled({timeout:15000});await expect(search().getByRole('status')).toContainText('已取消');const[remaining]=await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids);expect(remaining).toHaveLength(0);
   await search().getByRole('button',{name:'清空范围',exact:true}).click();await chooseTable(database,'subject');await search().getByLabel('搜索字段 note',{exact:true}).check();await run('needle');await expect(search().getByRole('status')).toContainText('命中 125');await expect(search().getByRole('status')).toContainText('所选字段块已处理');await expect(search().locator('.rdg-row')).not.toHaveCount(0);await search().getByRole('button',{name:'关闭',exact:true}).click();await expect(search()).toHaveCount(0);
  },info);
 });
 test('搜索命中打开已有表标签时保留单元格草稿，不刷新或提交服务器数据',async({},info)=>{
  test.setTimeout(120000);await isolatedDatabase(async({observer,database,connectionName})=>{
   await observer.query('CREATE TABLE `'+database+'`.subject(id INT PRIMARY KEY,note TEXT) ENGINE=InnoDB');await observer.query('INSERT INTO `'+database+'`.subject VALUES(1,\'服务器原值\')');
   const connection=page.locator('.connection-node').filter({has:page.locator('.connection-row').getByText(connectionName,{exact:true})}),row=connection.locator('.connection-row');await row.getByRole('button',{name:connectionName,exact:true}).focus();await row.getByRole('button',{name:'刷新连接',exact:true}).click();const databaseRow=connection.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})});await databaseRow.getByRole('button',{name:database,exact:true}).click();await connection.locator('.object-row').getByText('subject',{exact:true}).click();
   const table=page.locator('.table-tab:visible');await expect(table.locator('.loading-overlay')).toHaveCount(0);await expect(table.locator('.results-grid')).toBeVisible();const index=await table.getByRole('columnheader',{name:/^note/}).getAttribute('aria-colindex'),cell=table.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="'+index+'"]');await cell.dblclick();const editor=table.getByRole('textbox',{name:'编辑 note',exact:true});await editor.fill('搜索前的未提交草稿');await editor.press('Enter');await expect(cell).toHaveText('搜索前的未提交草稿');
   await openSearch();await chooseTable(database,'subject');await search().getByLabel('搜索字段 note',{exact:true}).check();await run('服务器原值');await expect(search().getByRole('status')).toContainText('命中 1');await search().locator('.rdg-row').click();await search().getByRole('button',{name:'打开所属表',exact:true}).click();await expect(search()).toHaveCount(0);await expect(page.locator('.table-tab')).toHaveCount(1);await expect(cell).toHaveText('搜索前的未提交草稿');const[rows]=await observer.query<RowDataPacket[]>('SELECT note FROM `'+database+'`.subject');expect(rows[0].note).toBe('服务器原值');await page.screenshot({path:info.outputPath('data-search-existing-table-draft.png')});
  },info);
 });
});
