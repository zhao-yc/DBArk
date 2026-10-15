import {positionMonacoCaret} from './monaco-caret';
import {randomUUID} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {test,expect,page,desktop,pageErrors,closed,answerDialogs,quitDesktop} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,executeSql,modifier} from './live-helpers';

// 真连接表单填写内存凭据，关闭轨迹；数据库、编辑器、Worker和IPC均使用实际产物。
test.use({trace:'off'});
const query=()=>page.locator('.query-tab:visible');
/** 真实粘贴保留引号及后缀，光标仅通过键盘移动，不直接调用Monaco模型。 */
async function atCaret(marked:string){return positionMonacoCaret(marked);}
/** 读真实保存草稿核对完整文本，不能仅以视口里相似的短行通过。 */
async function expectSql(source:string){await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');})).toBe(source.replaceAll('\r\n','\n'));}
/** Monaco各平台均使用Ctrl+空格触发，macOS不占用系统的Command+空格。 */
// 启动8秒与解析2秒分别由产品限时；断言另留3秒绘制余量，不重试触发或接受建议。
async function choose(label:string){await page.keyboard.press('Control+Space');const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText(label,{timeout:13000});await page.keyboard.press('Enter');await expect(widget).toHaveCount(0);}
/** 离线查询不可连接，CTE显式投影仍应通过安装包内Worker提供建议。 */
async function offlineQuery(){await page.locator('.app-commandbar').getByRole('button',{name:'新建连接',exact:true}).click();const modal=page.getByRole('dialog',{name:'新建连接',exact:true});await modal.getByLabel('连接名称',{exact:true}).fill('补全离线验收');await modal.getByLabel('主机地址',{exact:true}).fill('127.0.0.1');await modal.getByLabel('端口',{exact:true}).fill('1');await modal.getByLabel('用户名',{exact:true}).fill('offline');await modal.getByRole('button',{name:'保存连接',exact:true}).click();await page.locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();await page.getByRole('dialog',{name:'新建查询',exact:true}).getByRole('button',{name:'打开查询',exact:true}).click();await expect(query().locator('.monaco-editor')).toBeVisible();}
/** 第二库也使用唯一隔离前缀，先退出本例应用释放会话，再精确清理。 */
async function extraDatabase(observer:Connection,body:(database:string)=>Promise<void>){const database='dbark_colperm_'+randomUUID().replaceAll('-','').slice(0,12);await observer.query(`CREATE DATABASE \`${database}\``);try{await body(database);}finally{if(!closed){await answerDialogs([1,1]);await quitDesktop();}if(!/^dbark_colperm_[a-f0-9]{12}$/.test(database))throw Error('拒绝清理其它库');await observer.query(`DROP DATABASE IF EXISTS \`${database}\``);const[rows]=await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);expect(rows).toHaveLength(0);}}

test('离线语义补全：CTE投影、完整范围替换、键盘接受和撤销，不执行SQL',async({},info)=>{
  test.setTimeout(90000);await offlineQuery();
  // 三个独立编辑器分别首次加载真实Worker；不是失败重试，每次候选名不同以排除串模型。
  for(let cold=0;cold<3;cold++){
    if(cold){await page.locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();await page.getByRole('dialog',{name:'新建查询',exact:true}).getByRole('button',{name:'打开查询',exact:true}).click();await expect(query().locator('.monaco-editor')).toBeVisible();}
    const column='offline_column_'+cold,original=await atCaret(`WITH q AS (SELECT 1 AS ${column}) SELECT q.off|suffix FROM q`);
    try{await choose(column);await expectSql(`WITH q AS (SELECT 1 AS ${column}) SELECT q.\`${column}\` FROM q`);}
    catch(reason){await info.attach('离线补全阶段-'+cold,{body:JSON.stringify({cold,status:await query().getByLabel('SQL 补全状态',{exact:true}).allTextContents(),pageErrors}),contentType:'application/json'});await page.screenshot({path:info.outputPath('offline-startup-failure-'+cold+'.png')});throw reason;}
    await page.screenshot({path:info.outputPath('offline-completion-cold-'+cold+'.png')});await page.keyboard.press(`${modifier}+Z`);await expectSql(original);
  }
  const records=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));expect(records.tasks).toEqual([]);expect(records.history).toEqual([]);expect(pageErrors).toEqual([]);
});

test('离线输出别名：子句隔离、字符串引用、范围替换与撤销',async({},info)=>{
  test.setTimeout(90000);await offlineQuery();
  for(const[marked,label,expected]of[
    ['SELECT 1 AS projected_value ORDER BY proj|suffix','projected_value','SELECT 1 AS projected_value ORDER BY `projected_value`'],
    ["SELECT 1 AS '中文.别名' GROUP BY 中|suffix",'中文.别名',"SELECT 1 AS '中文.别名' GROUP BY `中文.别名`"],
    ['SELECT SUM(1) AS aggregated_total HAVING agg|suffix>0','aggregated_total','SELECT SUM(1) AS aggregated_total HAVING `aggregated_total`>0'],
    ['(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY fir|suffix','first_output','(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY `first_output`'],
  ]){const original=await atCaret(marked);await choose(label);await expectSql(expected);await page.keyboard.press(`${modifier}+Z`);await expectSql(original);}
  const records=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));expect(records.tasks).toEqual([]);expect(records.history).toEqual([]);expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('offline-output-alias.png')});
});

test.describe('200隔离实库：Monaco语义补全',()=>{
  test.skip(!enabled,'需要显式启用200隔离数据库');
  test('输出别名接受后真实执行，排序、分组、聚合和集合输出正确',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({database})=>{
      await openDatabaseQuery(database);
      for(const[marked,label,expected,value]of[
        ['SELECT a AS sorted_value FROM (SELECT 2 AS a UNION ALL SELECT 1)t ORDER BY sort|suffix','sorted_value','SELECT a AS sorted_value FROM (SELECT 2 AS a UNION ALL SELECT 1)t ORDER BY `sorted_value`','1,2'],
        ['SELECT a+1 AS grouped_value,COUNT(*) AS n FROM (SELECT 1 AS a UNION ALL SELECT 1)t GROUP BY group|suffix','grouped_value','SELECT a+1 AS grouped_value,COUNT(*) AS n FROM (SELECT 1 AS a UNION ALL SELECT 1)t GROUP BY `grouped_value`','2'],
        ['SELECT SUM(a) AS aggregate_value FROM (SELECT 1 AS a UNION ALL SELECT 2)t HAVING aggr|suffix>2','aggregate_value','SELECT SUM(a) AS aggregate_value FROM (SELECT 1 AS a UNION ALL SELECT 2)t HAVING `aggregate_value`>2','3'],
        ["SELECT a AS '带.点别名' FROM (SELECT 2 AS a UNION ALL SELECT 1)t ORDER BY 带|suffix",'带.点别名',"SELECT a AS '带.点别名' FROM (SELECT 2 AS a UNION ALL SELECT 1)t ORDER BY `带.点别名`",'1,2'],
        ['(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY fir|suffix','first_output','(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY `first_output`','1,2'],
      ]){
        const before=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));await atCaret(marked);await choose(label);await expectSql(expected);
        expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual(before);
        // 直接执行接受后的模型，不用再次写入预期SQL替换产品实际输出。
        await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled({timeout:20000});await expect(query().locator('.error-box')).toHaveCount(0);await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(value.split(','));
      }
      expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('live-output-alias.png')});
    },info);
  });
  test('别名与引用范围、后20张表、跨库目录按前缀读取，补全不产生用户任务',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY,note TEXT,\`__proto__\` TEXT)`);for(let i=0;i<25;i++)await observer.query(`CREATE TABLE \`${database}\`.lookup_${String(i).padStart(2,'0')}(id INT)`);await observer.query(`CREATE TABLE \`${database}\`.zz_later(tail_column INT)`);await openDatabaseQuery(database);
      const before=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));
      await atCaret('SELECT u.no|junk FROM subject AS u');await choose('note');await expectSql('SELECT u.`note` FROM subject AS u');
      await atCaret('SELECT u.`no|junk` FROM subject AS u');await choose('note');await expectSql('SELECT u.`note` FROM subject AS u');
      await atCaret('SELECT * FROM zz_la|');await choose('zz_later');await expectSql('SELECT * FROM `zz_later`');
      await atCaret(`SELECT z.tail| FROM \`${database}\`.zz_later z`);await choose('tail_column');await expectSql(`SELECT z.\`tail_column\` FROM \`${database}\`.zz_later z`);
      const after=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));expect(after).toEqual(before);await page.screenshot({path:info.outputPath('live-completion.png')});
    },info);
  });
  test('JOIN别名、派生投影、CTE与INSERT列清单使用各自来源',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
      await observer.query(`CREATE TABLE \`${database}\`.users(id INT,unique_name TEXT)`);await observer.query(`CREATE TABLE \`${database}\`.orders(id INT,order_value DECIMAL(40,12))`);await openDatabaseQuery(database);
      for(const[marked,label,expected]of[
        ['SELECT o.ord| FROM users u JOIN orders o ON o.id=u.id','order_value','SELECT o.`order_value` FROM users u JOIN orders o ON o.id=u.id'],
        ['SELECT d.ren| FROM (SELECT unique_name AS renamed FROM users) d','renamed','SELECT d.`renamed` FROM (SELECT unique_name AS renamed FROM users) d'],
        ['WITH q AS (SELECT unique_name AS cte_name FROM users) SELECT q.cte| FROM q','cte_name','WITH q AS (SELECT unique_name AS cte_name FROM users) SELECT q.`cte_name` FROM q'],
        ['INSERT INTO users (uni|) VALUES (1)','unique_name','INSERT INTO users (`unique_name`) VALUES (1)'],
      ]){await atCaret(marked);await choose(label);await expectSql(expected);}
    },info);
  });
  test('补全保留原查询事务、临时表和会话，观察连接看不到未提交写入',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY,note TEXT)`);await openDatabaseQuery(database);
      await executeSql('CREATE TEMPORARY TABLE marker(v BIGINT);INSERT INTO marker VALUES(9007199254740993);BEGIN;INSERT INTO subject(id,note) VALUES(1,\'尚未提交\');SELECT CONNECTION_ID() AS original_id,v FROM marker');
      // 多语句默认显示首个DDL结果，单独读取快照后才能比较真实会话编号和精确BIGINT。
      await executeSql('SELECT CONNECTION_ID() AS original_id,v FROM marker');
      await expect(query().locator('.result-body')).toContainText('9007199254740993');const before=await query().locator('.result-body').innerText();
      // 写入永久来源可能经过触发器，显式核对subject没有临时遮蔽并读回marker；事务和结果均保留。
      for(const name of ['subject','marker']){await query().getByRole('button',{name:'会话临时对象',exact:true}).click();const modal=page.getByRole('dialog',{name:'当前查询会话的临时对象',exact:true});await modal.getByLabel('数据库名称',{exact:true}).fill(database);await modal.getByLabel('表或视图名称',{exact:true}).fill(name);await modal.getByRole('button',{name:'读取会话结构',exact:true}).click();await expect(modal.locator('.success-box')).toContainText(name==='subject'?'该名称当前不是临时表':'已读取真实临时表字段');await modal.getByRole('button',{name:'关闭',exact:true}).click();}
      await atCaret('SELECT s.no| FROM subject s');await choose('note');
      const[rows]=await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`);expect(Number(rows[0].n)).toBe(0);await expect(query().getByRole('button',{name:'回滚',exact:true})).toBeEnabled();
      await executeSql('SELECT CONNECTION_ID() AS original_id,v FROM marker');await expect.poll(()=>query().locator('.result-body').innerText()).toBe(before);await query().getByRole('button',{name:'回滚',exact:true}).click();const[remaining]=await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`);expect(Number(remaining[0].n)).toBe(0);
    },info);
  });
  test('USE切库后的面包屑与字段采用真实默认库，已知ANSI模式支持双引号编辑',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>extraDatabase(observer,async other=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(a_column INT)`);await observer.query(`CREATE TABLE \`${other}\`.subject(b_column INT)`);await openDatabaseQuery(database);await executeSql(`USE \`${other}\``);await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(other);await atCaret('SELECT s.b_| FROM subject s');await choose('b_column');await expectSql('SELECT s.`b_column` FROM subject s');
      const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));expect(settings.tabs.find(tab=>tab.id===settings.activeTabId)?.database).toBe(other);expect(settings.tabs.find(tab=>tab.id===settings.activeTabId)?.databaseContext).toEqual({state:'known',database:other});
      await executeSql(`USE \`${database}\`;SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'`);await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(database);await atCaret('SELECT "s"."a_|suffix" FROM subject "s"');await choose('a_column');await expectSql('SELECT "s".`a_column` FROM subject "s"');await page.screenshot({path:info.outputPath('session-mode-completion.png')});
    }),info);
  });
  test('跟踪关闭后默认库未知，不回退旧库；显式来源可用，通知恢复后重新补全',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>extraDatabase(observer,async other=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(a_column INT)`);await observer.query(`CREATE TABLE \`${other}\`.subject(b_column INT)`);await openDatabaseQuery(database);await executeSql(`SET SESSION session_track_system_variables='';SET SESSION session_track_schema=OFF;USE \`${other}\``);await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText('默认库待确认');
      await atCaret('SELECT s.| FROM subject s');await page.keyboard.press('Control+Space');await expect(query().getByLabel('SQL 补全状态',{exact:true})).toHaveText('默认库待确认');await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0);
      await atCaret(`SELECT s.b_| FROM \`${other}\`.subject s`);await choose('b_column');await expectSql(`SELECT s.\`b_column\` FROM \`${other}\`.subject s`);
      await executeSql(`SET SESSION session_track_schema=ON;SET SESSION session_track_system_variables='sql_mode,session_track_schema,session_track_system_variables';USE \`${database}\``);await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(database);await atCaret('SELECT s.a_| FROM subject s');await choose('a_column');await expectSql('SELECT s.`a_column` FROM subject s');
    }),info);
  });
  test('两个查询标签保留不同默认库和模式，切换标签不串用旧模型候选',async({},info)=>{
    test.setTimeout(120000);await isolatedDatabase(async({observer,database})=>extraDatabase(observer,async other=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(a_column INT)`);await observer.query(`CREATE TABLE \`${other}\`.subject(b_column INT)`);await openDatabaseQuery(database);await executeSql(`USE \`${other}\`;SET SESSION sql_mode='ANSI_QUOTES'`);await openDatabaseQuery(database);await executeSql('SELECT 1');const tabs=page.locator('.tab-strip .tab-select');await expect(tabs).toHaveCount(2);
      await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(database);await atCaret('SELECT s.a_| FROM subject s');await choose('a_column');await tabs.nth(0).click();await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(other);await atCaret('SELECT "s".b_| FROM subject "s"');await choose('b_column');await expectSql('SELECT "s".`b_column` FROM subject "s"');await tabs.nth(1).click();await expectSql('SELECT s.`a_column` FROM subject s');await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(database);
    }),info);
  });
});
